import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletAuthorizationManifest } from './authorizationManifest';
import { WalletAuthorizationRelocation } from './authorizationRelocation';
import { readPresignSnapshotInventory, presignInventoryJson, presignSnapshotMatches } from './presignRelocationCommand';
import { WalletRelocationReceipt } from './relocation';
import type { WalletRelocationEffects } from './relocationCoordinator';
import { relocationManifestDigest, relocationParticipantDigests } from './relocationManifest';
import { WalletRelocationStageReceipts } from './relocationStageReceipts';
import { RuntimeRelocationTransfer } from './runtimeRelocationTransfer';

type Context = Parameters<WalletRelocationEffects['transfer']>[0];
type Result = Awaited<ReturnType<WalletRelocationEffects['transfer']>>;

export class WalletRelocationTransfer {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly authorization: WalletAuthorizationRelocation,
    private readonly runtime: RuntimeRelocationTransfer,
    private readonly sourceWriter: TenantRuntimeWriterV1,
    private readonly destinationWriter: TenantRuntimeWriterV1,
    private readonly clock: () => number,
  ) {}

  async transfer(context: Context, sourceFence: WalletRelocationReceipt<'source_fence'>): Promise<Result> {
    const { request, move, attempt } = context;
    if (!request.matches(move) || move.progress.state !== 'copying' ||
        move.progress.execution.state !== 'running' || !move.progress.execution.attempt.matches(attempt) ||
        !sourceFence.matches(move) || JSON.stringify(move.progress.sourceFence) !== JSON.stringify(sourceFence))
      return { state: 'failed', code: 'identity_conflict' };
    const receipts = new WalletRelocationStageReceipts(this.database);
    const existing = await receipts.read(move, 'destination_verification');
    if (existing) return existing.manifestDigest === sourceFence.manifestDigest
      ? { state: 'verified', receipt: existing }
      : { state: 'failed', code: 'receipt_conflict' };
    const wallet = move.wallet;
    const authorization = await this.authorization.transfer(wallet, attempt, this.sourceWriter, this.destinationWriter);
    if (authorization.state === 'failed') return authorization;
    const router = await this.runtime.advance(wallet, attempt, { participant: 'router' });
    if (router.state === 'failed') return router;
    const deriverA = await this.runtime.advance(wallet, attempt, { participant: 'deriver-a' });
    if (deriverA.state === 'failed') return deriverA;
    const deriverB = await this.runtime.advance(wallet, attempt, { participant: 'deriver-b' });
    if (deriverB.state === 'failed') return deriverB;
    const ed25519 = await this.runtime.advance(wallet, attempt, { participant: 'ed25519' });
    if (ed25519.state === 'failed') return ed25519;
    const ecdsa = await this.runtime.advance(wallet, attempt, { participant: 'ecdsa' });
    if (ecdsa.state === 'failed') return ecdsa;
    const sessions = await readPresignSnapshotInventory(this.database, move);
    for (const entry of sessions) {
      const transferred = await this.runtime.advance(wallet, attempt, { participant: 'presign', session: entry.session });
      if (transferred.state === 'failed') return transferred;
      if (transferred.state === 'pending') return { state: 'pending' };
      if (!presignSnapshotMatches(JSON.parse(transferred.receiptJson), entry.receipt))
        return { state: 'failed', code: 'content_conflict' };
    }
    if (authorization.state !== 'verified' || router.state !== 'verified' || deriverA.state !== 'verified' ||
        deriverB.state !== 'verified' || ed25519.state !== 'verified' || ecdsa.state !== 'verified')
      return { state: 'pending' };
    const stored = await queryD1One(this.database, `SELECT authorization_manifest_json FROM wallet_relocations
      WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
        AND wallet_id = ?5 AND move_id = ?6`, [wallet.namespace, wallet.organizationId, wallet.projectId,
      wallet.environmentId, wallet.walletId, move.moveId]);
    if (typeof stored?.authorization_manifest_json !== 'string') return { state: 'failed', code: 'receipt_conflict' };
    const manifest = WalletAuthorizationManifest.parse(JSON.parse(stored.authorization_manifest_json));
    if (manifest.digestHex !== authorization.digestHex) return { state: 'failed', code: 'content_conflict' };
    const participants = await relocationParticipantDigests(manifest, {
      router: { receiptJson: router.receiptJson }, deriverA: { receiptJson: deriverA.receiptJson },
      deriverB: { receiptJson: deriverB.receiptJson }, ed25519: { receiptJson: ed25519.receiptJson },
      ecdsa: { receiptJson: ecdsa.receiptJson },
    }, presignInventoryJson(sessions));
    const manifestDigest = await relocationManifestDigest(move, participants);
    if (manifestDigest !== sourceFence.manifestDigest) return { state: 'failed', code: 'content_conflict' };
    const receipt = WalletRelocationReceipt.parse({
      kind: 'destination_verification', wallet, moveId: move.moveId, home: move.destination,
      generation: move.destinationGeneration, recordedAtMs: this.clock(), participants, manifestDigest,
    }, 'destination_verification');
    const recorded = await receipts.record(move, attempt, receipt);
    if (!recorded) return { state: 'failed', code: 'receipt_conflict' };
    return { state: 'verified', receipt: recorded };
  }
}
