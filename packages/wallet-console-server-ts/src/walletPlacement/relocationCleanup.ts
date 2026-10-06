import { isPlainObject, type D1DatabaseLike, type WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletAuthorizationRelocation } from './authorizationRelocation';
import { authorizeRouterCleanup } from './routerRelocationReceipt';
import { authorizeDeriverTransfer } from './deriverRelocationReceipt';
import { authorizeEd25519Transfer } from './ed25519RelocationReceipt';
import { authorizeEcdsaTransfer } from './ecdsaRelocationReceipt';
import { authorizePresignTransfer, readPresignSnapshotInventory } from './presignRelocationCommand';
import { WalletRelocationReceipt } from './relocation';
import type { WalletRelocationEffects } from './relocationCoordinator';
import { WalletRelocationStageReceipts } from './relocationStageReceipts';

type Context = Parameters<WalletRelocationEffects['cleanup']>[0];
type Result = Awaited<ReturnType<WalletRelocationEffects['cleanup']>>;
type Target =
  | { readonly participant: 'router' | 'deriver-a' | 'deriver-b' | 'ed25519' | 'ecdsa'; readonly session?: never }
  | { readonly participant: 'presign'; readonly session: { readonly presignSessionId: string; readonly serverPresignatureId: string } };
type Progress = { readonly state: 'pending'; readonly code?: never }
  | { readonly state: 'cleaned'; readonly code?: never } | Extract<Result, { state: 'failed' }>;
const walletParticipants = ['router', 'deriver-a', 'deriver-b', 'ed25519', 'ecdsa'] as const;

export class WalletRelocationCleanup {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly authorization: WalletAuthorizationRelocation,
    private readonly source: WalletRuntimeServiceBinding,
    private readonly gatewayWriter: TenantRuntimeWriterV1,
    private readonly runtimeWriter: TenantRuntimeWriterV1,
    private readonly clock: () => number,
  ) {}

  async cleanup(context: Context, activation: WalletRelocationReceipt<'destination_activation'>): Promise<Result> {
    const { request, move, attempt } = context;
    if (!request.matches(move) || move.progress.state !== 'cutover' || move.progress.activation.state !== 'activated' ||
        move.progress.execution.state !== 'running' || !move.progress.execution.attempt.matches(attempt) ||
        !activation.matches(move) || JSON.stringify(move.progress.activation.receipt) !== JSON.stringify(activation))
      return { state: 'failed', code: 'identity_conflict' };
    const receipts = new WalletRelocationStageReceipts(this.database);
    const existing = await receipts.read(move, 'source_cleanup');
    if (existing) return existing.manifestDigest === activation.manifestDigest
      ? { state: 'cleaned', receipt: existing }
      : { state: 'failed', code: 'receipt_conflict' };

    // Use the sealed Console inventory after the source wallet removes its index.
    // Each participant performs one bounded deletion step before returning pending.
    const sessions = await readPresignSnapshotInventory(this.database, move);
    for (const entry of sessions) {
      const result = await this.cleanParticipant(context, { participant: 'presign', session: entry.session });
      if (result.state !== 'cleaned') return result;
    }
    for (const participant of walletParticipants) {
      const result = await this.cleanParticipant(context, { participant });
      if (result.state !== 'cleaned') return result;
    }
    const gateway = await this.authorization.cleanup(move.wallet, attempt, this.gatewayWriter);
    if (gateway.state !== 'cleaned') return gateway;
    const receipt = WalletRelocationReceipt.parse({
      kind: 'source_cleanup', wallet: move.wallet, moveId: move.moveId,
      home: move.source, generation: move.sourceGeneration, recordedAtMs: this.clock(),
      participants: activation.participants, manifestDigest: activation.manifestDigest,
    }, 'source_cleanup');
    const stored = await receipts.record(move, attempt, receipt);
    if (!stored) return { state: 'failed', code: 'receipt_conflict' };
    return { state: 'cleaned', receipt: stored };
  }

  private async cleanParticipant(context: Context, target: Target): Promise<Progress> {
    const authorized = await this.authorize(context, target);
    if (!authorized.ok) return { state: 'failed', code: 'authority_unavailable' };
    const command = authorized.command;
    const expected = 'activation' in command ? command.activation : command.receipt;
    const body = target.participant === 'presign'
      ? { wallet: context.move.wallet, attempt: context.attempt, session: target.session }
      : { wallet: context.move.wallet, attempt: context.attempt };
    let response: Response;
    try {
      response = await this.source.fetch(new Request(
        `https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/${target.participant}-cleanup`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        },
      ));
    } catch {
      return { state: 'failed', code: 'transport_unavailable' };
    }
    if (!response.ok) return { state: 'failed', code: response.status >= 500 ? 'transport_unavailable' : 'authority_unavailable' };
    let raw: unknown;
    try { raw = await response.json(); } catch { return { state: 'failed', code: 'receipt_conflict' }; }
    if (!isPlainObject(raw)) return { state: 'failed', code: 'receipt_conflict' };
    const state = target.participant === 'ed25519' ? raw.state : raw.kind;
    if (target.participant === 'presign' && state === 'cleaning' && Object.keys(raw).length === 1)
      return { state: 'pending' };
    const receipt = target.participant === 'router' ? raw.activation : raw.receipt;
    if (Object.keys(raw).length !== 2 || !sameReceipt(receipt, expected))
      return { state: 'failed', code: 'receipt_conflict' };
    if (state === 'cleaning') return { state: 'pending' };
    if (state === 'cleaned') return { state: 'cleaned' };
    return { state: 'failed', code: 'receipt_conflict' };
  }

  private authorize(context: Context, target: Target) {
    const wallet = context.move.wallet;
    const attempt = context.attempt;
    switch (target.participant) {
      case 'router': return authorizeRouterCleanup(this.database, wallet, this.runtimeWriter, attempt);
      case 'deriver-a': return authorizeDeriverTransfer(this.database, wallet, this.runtimeWriter, attempt, 'deriverA', { operation: 'cleanup' });
      case 'deriver-b': return authorizeDeriverTransfer(this.database, wallet, this.runtimeWriter, attempt, 'deriverB', { operation: 'cleanup' });
      case 'ed25519': return authorizeEd25519Transfer(this.database, wallet, this.runtimeWriter, attempt, { operation: 'cleanup' });
      case 'ecdsa': return authorizeEcdsaTransfer(this.database, wallet, this.runtimeWriter, attempt, { operation: 'cleanup' });
      case 'presign': return authorizePresignTransfer(this.database, wallet, this.runtimeWriter, attempt, { operation: 'cleanup', session: target.session });
      default: {
        const unexpected: never = target;
        throw new Error(`Unknown cleanup participant: ${String(unexpected)}`);
      }
    }
  }
}

// Native and Console encoders can order object fields differently.
function sameReceipt(raw: unknown, expected: unknown): boolean {
  if (!isPlainObject(expected)) return raw === expected;
  if (!isPlainObject(raw) || Object.keys(raw).length !== Object.keys(expected).length) return false;
  for (const key of Object.keys(expected)) if (!sameReceipt(raw[key], expected[key])) return false;
  return true;
}
