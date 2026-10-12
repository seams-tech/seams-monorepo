import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletAuthorizationRelocation } from './authorizationRelocation';
import { WalletRelocationReceipt } from './relocation';
import type { WalletRelocationEffects } from './relocationCoordinator';
import { relocationManifestDigest, relocationParticipantDigests } from './relocationManifest';
import { WalletRelocationStageReceipts } from './relocationStageReceipts';
import { readPresignSnapshotInventory, presignInventoryJson } from './presignRelocationCommand';
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
    const receipts = new WalletRelocationStageReceipts(this.database);
    const existing = await receipts.read(move, 'source_fence');
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

    const sessions = await readPresignSnapshotInventory(this.database, move);
    const participants = await relocationParticipantDigests(authorization.manifest, native.snapshots, presignInventoryJson(sessions));
    const manifestDigest = await relocationManifestDigest(move, participants);
    const receipt = WalletRelocationReceipt.parse({
      kind: 'source_fence', wallet: move.wallet, moveId: move.moveId, home: move.source,
      generation: move.sourceGeneration, recordedAtMs: this.clock(), participants, manifestDigest,
    }, 'source_fence');
    if (!receipt.matches(move)) return { state: 'failed', code: 'receipt_conflict' };
    const stored = await receipts.record(move, attempt, receipt);
    if (!stored) return { state: 'failed', code: 'receipt_conflict' };
    return { state: 'frozen', receipt: stored };
  }
}
