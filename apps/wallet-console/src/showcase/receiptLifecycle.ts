import { schedulePlayback } from './playbackClock';
import type { TransactionReceiptState } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-receipt';

/* Plays a simulated signing, broadcast and confirmation through the SDK's
   receipt states. Returns a function that stops it. */
class ReceiptPlayback {
  private step = 0;
  private cancelDelay: () => void = noDelay;
  private readonly lifecycle: readonly (readonly [TransactionReceiptState, number])[];

  constructor(
    private readonly show: (state: TransactionReceiptState) => void,
    hash: string,
  ) {
    // Each demo supplies its chain's transaction ID. Signing leads straight to broadcasting.
    this.lifecycle = [
      [{ kind: 'signing' }, 1100],
      [{ kind: 'broadcasting' }, 1200],
      [{ kind: 'submitted', hash }, 1500],
      [{ kind: 'confirmed', hash }, 0],
    ];
    this.play();
  }

  stop = (): void => {
    this.cancelDelay();
  };

  private play = (): void => {
    const [state, durationMs] = this.lifecycle[this.step];
    this.show(state);
    this.step += 1;
    if (durationMs > 0) this.cancelDelay = schedulePlayback(this.play, durationMs);
  };
}

function noDelay(): void {}

export function playReceiptLifecycle(
  show: (state: TransactionReceiptState) => void,
  hash: string,
): () => void {
  return new ReceiptPlayback(show, hash).stop;
}
