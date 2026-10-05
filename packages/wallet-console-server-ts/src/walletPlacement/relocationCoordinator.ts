import type {
  WalletRelocation,
  WalletRelocationReceipt,
  WalletRelocationRequest,
} from './relocation';
import type { WalletRelocationAttempt, WalletRelocationFailure } from './relocationExecution';
import { D1WalletRelocations, type WalletRelocationTransition } from './relocationStore';

type EffectContext = {
  readonly request: WalletRelocationRequest;
  readonly move: WalletRelocation;
  readonly attempt: WalletRelocationAttempt;
};
type EffectResult<Kind extends WalletRelocationReceipt['kind']> =
  | { readonly ok: true; readonly receipt: WalletRelocationReceipt<Kind>; readonly code?: never }
  | { readonly ok: false; readonly code: WalletRelocationFailure; readonly receipt?: never };

// Transport adapters authenticate every participant and aggregate their exact receipts.
// A successful effect must remain repeatable after its caller loses the response.
export interface WalletRelocationEffects {
  freeze(context: EffectContext): Promise<EffectResult<'source_fence'>>;
  transfer(
    context: EffectContext,
    sourceFence: WalletRelocationReceipt<'source_fence'>,
  ): Promise<EffectResult<'destination_verification'>>;
  activate(
    context: EffectContext,
    verification: WalletRelocationReceipt<'destination_verification'>,
  ): Promise<EffectResult<'destination_activation'>>;
  cleanup(
    context: EffectContext,
    activation: WalletRelocationReceipt<'destination_activation'>,
  ): Promise<EffectResult<'source_cleanup'>>;
}

// Each call advances one durable step. Activation returns before cleanup starts.
export class WalletRelocationCoordinator {
  constructor(
    private readonly journal: D1WalletRelocations,
    private readonly effects: WalletRelocationEffects,
    private readonly clock: () => number,
  ) {}

  async advance(
    request: WalletRelocationRequest,
    nextAttemptId: string,
  ): Promise<WalletRelocationTransition> {
    const current = await this.journal.find(request);
    if (!current) return { ok: false, code: 'not_found' };
    if (!current.matchesRequest(request, await request.digest()))
      return { ok: false, code: 'request_conflict' };
    const previous = current.progress;
    if (previous.state === 'completed') return { ok: true, move: current };
    const attemptId =
      previous.execution.state === 'running' ? previous.execution.attempt.id : nextAttemptId;
    const claimed = await this.journal.claimAttempt(
      request,
      previous.state,
      attemptId,
      this.clock(),
    );
    if (!claimed.ok) return claimed;
    const progress = claimed.move.progress;
    if (progress.state === 'completed') return claimed;
    if (progress.execution.state !== 'running') return { ok: false, code: 'attempt_conflict' };
    const context: EffectContext = {
      request,
      move: claimed.move,
      attempt: progress.execution.attempt,
    };
    let transition: WalletRelocationTransition;
    switch (progress.state) {
      case 'freezing': {
        const result = await this.effects.freeze(context);
        if (!result.ok) return this.fail(context, result.code);
        transition = await this.journal.recordSourceFence(request, context.attempt, result.receipt);
        break;
      }
      case 'copying': {
        const result = await this.effects.transfer(context, progress.sourceFence);
        if (!result.ok) return this.fail(context, result.code);
        transition = await this.journal.recordDestinationVerification(
          request,
          context.attempt,
          result.receipt,
        );
        break;
      }
      case 'verified':
        return this.journal.switchOwnership(request, context.attempt, this.clock());
      case 'cutover': {
        if (progress.activation.state === 'awaiting_activation') {
          const result = await this.effects.activate(context, progress.destinationVerification);
          if (!result.ok) return this.fail(context, result.code);
          transition = await this.journal.recordDestinationActivation(
            request,
            context.attempt,
            result.receipt,
          );
        } else {
          const result = await this.effects.cleanup(context, progress.activation.receipt);
          if (!result.ok) return this.fail(context, result.code);
          transition = await this.journal.complete(
            request,
            context.attempt,
            result.receipt,
            this.clock(),
          );
        }
        break;
      }
      default: {
        const unexpected: never = progress;
        throw new Error(`Unexpected relocation progress: ${String(unexpected)}`);
      }
    }
    if (!transition.ok && transition.code === 'receipt_conflict')
      return this.fail(context, 'receipt_conflict');
    return transition;
  }

  private fail(
    context: EffectContext,
    code: WalletRelocationFailure,
  ): Promise<WalletRelocationTransition> {
    return this.journal.failAttempt(context.request, context.attempt, code, this.clock());
  }
}
