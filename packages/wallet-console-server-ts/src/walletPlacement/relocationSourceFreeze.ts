import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletAuthorizationRelocation } from './authorizationRelocation';
import { WalletRelocationReceipt } from './relocation';
import type { WalletRelocationEffects } from './relocationCoordinator';
import { preparationEvidenceDigest } from './relocationPreparation';
import { RuntimeRelocationFreeze } from './runtimeRelocationFreeze';

type Context = Parameters<WalletRelocationEffects['freeze']>[0];
type Result = Awaited<ReturnType<WalletRelocationEffects['freeze']>>;

export class WalletRelocationSourceFreeze {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly authorization: WalletAuthorizationRelocation,
    private readonly runtime: RuntimeRelocationFreeze,
    private readonly sourceWriter: TenantRuntimeWriterV1,
    private readonly clock: () => number,
  ) {}

  async freeze(context: Context): Promise<Result> {
    const { request, move, attempt } = context;
    if (!request.matches(move) || move.progress.state !== 'freezing' ||
        move.progress.execution.state !== 'running' || !move.progress.execution.attempt.matches(attempt))
      return { state: 'failed', code: 'identity_conflict' };
    const identity = [move.wallet.namespace, move.wallet.organizationId, move.wallet.projectId,
      move.wallet.environmentId, move.wallet.walletId, move.moveId];
    const existing = await this.read(identity);
    if (existing) return existing.matches(move)
      ? { state: 'frozen', receipt: existing }
      : { state: 'failed', code: 'receipt_conflict' };

    // Gateway closes ordinary admission before native participants settle work.
    // Pending Gateway work must not prevent those participants from advancing.
    const authorization = await this.authorization.freeze(move.wallet, attempt, this.sourceWriter);
    if (authorization.state === 'failed') return authorization;
    const native = await this.runtime.advance(move, attempt);
    if (native.state === 'failed') return native;
    if (authorization.state === 'pending' || native.state === 'pending') return { state: 'pending' };

    const sessions = await queryD1One(this.database, `SELECT json_group_array(receipt_json) AS receipts
      FROM (SELECT receipt_json FROM wallet_presign_snapshots
        WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 ORDER BY presign_session_id)`, identity);
    if (typeof sessions?.receipts !== 'string') return { state: 'failed', code: 'receipt_conflict' };
    const snapshots = native.snapshots;
    const participants = {
      gateway: authorization.manifest.digestHex,
      walletRuntime: await preparationEvidenceDigest(['seams/relocation/runtime-source/v1', authorization.manifest, snapshots]),
      router: await preparationEvidenceDigest(['seams/relocation/router-source/v1', snapshots.router]),
      deriverA: await preparationEvidenceDigest(['seams/relocation/deriver-a-source/v1', snapshots.deriverA]),
      deriverB: await preparationEvidenceDigest(['seams/relocation/deriver-b-source/v1', snapshots.deriverB]),
      signingWorker: await preparationEvidenceDigest(['seams/relocation/signing-worker-source/v1', snapshots.ed25519, snapshots.ecdsa]),
      presignSessions: await preparationEvidenceDigest(['seams/relocation/presign-source/v1', sessions.receipts]),
    };
    const manifestDigest = await preparationEvidenceDigest([
      'seams/wallet-relocation/source-manifest/v1', move.requestDigest,
      move.source, move.destination, move.sourceGeneration, move.destinationGeneration, participants,
    ]);
    const receipt = WalletRelocationReceipt.parse({
      kind: 'source_fence', wallet: move.wallet, moveId: move.moveId, home: move.source,
      generation: move.sourceGeneration, recordedAtMs: this.clock(), participants, manifestDigest,
    }, 'source_fence');
    if (!receipt.matches(move)) return { state: 'failed', code: 'receipt_conflict' };
    await this.database.prepare(`INSERT INTO wallet_relocation_source_manifests
      (namespace, organization_id, project_id, environment_id, wallet_id, move_id, receipt_json)
      SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id, ?7
      FROM wallet_relocations WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
        AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6
        AND state = 'freezing' AND execution_state = 'running'
        AND execution_revision = ?8 AND execution_attempt_id = ?9
      ON CONFLICT DO NOTHING`).bind(...identity, JSON.stringify(receipt), attempt.revision, attempt.id).run();
    const stored = await this.read(identity);
    if (!stored || !stored.matches(move) || stored.manifestDigest !== manifestDigest)
      return { state: 'failed', code: 'receipt_conflict' };
    return { state: 'frozen', receipt: stored };
  }

  private async read(identity: readonly string[]): Promise<WalletRelocationReceipt<'source_fence'> | null> {
    const row = await queryD1One(this.database, `SELECT receipt_json FROM wallet_relocation_source_manifests
      WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
        AND wallet_id = ?5 AND move_id = ?6`, identity);
    if (!row) return null;
    if (typeof row.receipt_json !== 'string') throw new Error('Stored source manifest is invalid');
    return WalletRelocationReceipt.parse(JSON.parse(row.receipt_json), 'source_fence');
  }
}
