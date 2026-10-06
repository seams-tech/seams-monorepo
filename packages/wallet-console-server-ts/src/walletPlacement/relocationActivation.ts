import { queryD1All, type D1DatabaseLike, type WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletAuthorizationRelocation } from './authorizationRelocation';
import { WalletRelocationReceipt, type WalletRelocation } from './relocation';
import type { WalletRelocationEffects } from './relocationCoordinator';
import { WalletRelocationStageReceipts } from './relocationStageReceipts';

type Context = Parameters<WalletRelocationEffects['activate']>[0];
type Result = Awaited<ReturnType<WalletRelocationEffects['activate']>>;
const participants = ['router', 'deriver-a', 'deriver-b', 'ed25519', 'ecdsa'] as const;

export class WalletRelocationActivation {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly authorization: WalletAuthorizationRelocation,
    private readonly destination: WalletRuntimeServiceBinding,
    private readonly destinationWriter: TenantRuntimeWriterV1,
    private readonly clock: () => number,
  ) {}

  async activate(context: Context, verification: WalletRelocationReceipt<'destination_verification'>): Promise<Result> {
    const { request, move, attempt } = context;
    if (!request.matches(move) || move.progress.state !== 'cutover' ||
        move.progress.activation.state !== 'awaiting_activation' ||
        move.progress.execution.state !== 'running' || !move.progress.execution.attempt.matches(attempt) ||
        !verification.matches(move) || JSON.stringify(move.progress.destinationVerification) !== JSON.stringify(verification))
      return { ok: false, code: 'identity_conflict' };
    const receipts = new WalletRelocationStageReceipts(this.database);
    const existing = await receipts.read(move, 'destination_activation');
    if (existing) return existing.manifestDigest === verification.manifestDigest
      ? { ok: true, receipt: existing }
      : { ok: false, code: 'receipt_conflict' };

    // Runtime records each authenticated native receipt before returning success.
    // Skip recorded participants after a lost reply, including when they are offline.
    const activated = await readActivatedParticipants(this.database, move);
    for (const participant of participants) {
      if (activated.has(participant)) continue;
      let response: Response;
      try {
        response = await this.destination.fetch(new Request(
          `https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/${participant}-activate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: move.wallet, attempt }),
          },
        ));
      } catch {
        return { ok: false, code: 'transport_unavailable' };
      }
      if (!response.ok) return { ok: false, code: response.status >= 500 ? 'transport_unavailable' : 'authority_unavailable' };
      const recorded = await readActivatedParticipants(this.database, move);
      if (!recorded.has(participant)) return { ok: false, code: 'receipt_conflict' };
    }

    // Presignature history is inert after relocation. It needs verification, not
    // activation. Gateway admission opens only after all native wallets activate.
    const authorization = await this.authorization.activate(move.wallet, attempt, this.destinationWriter);
    if (authorization.state === 'failed') return { ok: false, code: authorization.code };
    if (authorization.digestHex !== verification.participants.gateway)
      return { ok: false, code: 'content_conflict' };
    const receipt = WalletRelocationReceipt.parse({
      kind: 'destination_activation', wallet: move.wallet, moveId: move.moveId,
      home: move.destination, generation: move.destinationGeneration,
      recordedAtMs: this.clock(), participants: verification.participants,
      manifestDigest: verification.manifestDigest,
    }, 'destination_activation');
    const stored = await receipts.record(move, attempt, receipt);
    if (!stored) return { ok: false, code: 'receipt_conflict' };
    return { ok: true, receipt: stored };
  }
}

async function readActivatedParticipants(database: D1DatabaseLike, move: WalletRelocation): Promise<ReadonlySet<string>> {
  const wallet = move.wallet;
  // These append-only tables accept receipts only after participant identity,
  // prepared destination, source snapshot, and current attempt checks pass.
  const rows = await queryD1All(database, `SELECT participant FROM (
    SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id, 'router' AS participant FROM wallet_router_activations
    UNION ALL SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id,
      CASE role WHEN 'deriverA' THEN 'deriver-a' WHEN 'deriverB' THEN 'deriver-b' END FROM wallet_deriver_activations
    UNION ALL SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id, 'ed25519' FROM wallet_ed25519_activations
    UNION ALL SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id, 'ecdsa' FROM wallet_ecdsa_activations
  ) WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
    AND wallet_id = ?5 AND move_id = ?6`, [wallet.namespace, wallet.organizationId, wallet.projectId,
    wallet.environmentId, wallet.walletId, move.moveId]);
  const activated = new Set<string>();
  for (const row of rows) {
    if (typeof row.participant !== 'string') throw new Error('Stored relocation activation participant is invalid');
    activated.add(row.participant);
  }
  return activated;
}
