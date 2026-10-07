import type { TransactionReceiptState } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-receipt';

const hash = `0x7a4b${'0'.repeat(56)}91c2`;

// Each simulated receipt state, and how long it shows before the next one. A
// signed transaction is broadcast at once, as the SDK does, so signing leads
// straight to broadcasting.
const lifecycle: readonly (readonly [TransactionReceiptState, number])[] = [
  [{ kind: 'signing' }, 1100],
  [{ kind: 'broadcasting' }, 1200],
  [{ kind: 'submitted', hash }, 1500],
  [{ kind: 'confirmed', hash }, 0],
];

/* Plays a simulated signing, broadcast and confirmation through the SDK's
   receipt states. Returns a function that stops it. */
export function playReceiptLifecycle(show: (state: TransactionReceiptState) => void): () => void {
  let timer = 0;
  const play = (step: number): void => {
    const [state, durationMs] = lifecycle[step];
    show(state);
    if (durationMs > 0) timer = window.setTimeout(play, durationMs, step + 1);
  };
  play(0);
  return () => window.clearTimeout(timer);
}
