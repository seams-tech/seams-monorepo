import '@wallet-ui/sdk/wallet-ui.css';
import './showcase.css';
import {
  mountConfirmationSurface,
  type ConfirmationSurfaceHandle,
  type ConfirmSurfaceModel,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface';
import { buildDisplayTreeFromModel } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-display/tree';
import type {
  TransactionReceiptState,
  TransactionReceiptView,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-receipt';
import type { TxDisplayModel } from '@wallet-ui/core/signingEngine/interfaces/display';
import { paperIframeAppearance } from '@/context/app-themes';

/* The SDK's transaction confirmer and receipt on sample data. Confirming plays
   a simulated signing and broadcast; nothing is signed or sent. */

const hash = `0x7a4b${'0'.repeat(56)}91c2`;

// Each simulated receipt state, and how long it shows before the next one.
const lifecycle: readonly (readonly [TransactionReceiptState, number])[] = [
  [{ kind: 'signing' }, 1100],
  [{ kind: 'signed' }, 700],
  [{ kind: 'broadcasting' }, 1200],
  [{ kind: 'submitted', hash }, 1500],
  [{ kind: 'confirmed', hash }, 0],
];

const transfer: TxDisplayModel = {
  chain: 'evm',
  chainId: 8453,
  signerAccount: `0x4201${'0'.repeat(32)}891c`,
  operations: [
    {
      id: 'transfer',
      kind: 'generic.contractCall',
      label: 'Transfer ETH',
      to: `0x2F01${'0'.repeat(32)}4EC9`,
    },
  ],
  totals: { nativeValue: '0.025', nativeSymbol: 'ETH', estimatedFee: '0.000001', feeSymbol: 'ETH' },
};

const stage = document.getElementById('root') as HTMLElement;
let handle: ConfirmationSurfaceHandle | null = null;
let receipt: TransactionReceiptState = lifecycle[0][0];
let view: TransactionReceiptView = 'expanded';
let timer = 0;

function model(): ConfirmSurfaceModel {
  return {
    appearance: paperIframeAppearance(),
    content: {
      kind: 'transaction',
      review: {
        model: transfer,
        tree: buildDisplayTreeFromModel(transfer),
        detailsInitiallyOpen: false,
      },
      header: {
        heading: 'Review your transfer',
        website: { kind: 'ready', text: 'shop.example.com' },
        chainDetails: { kind: 'ready', text: 'Base' },
      },
      body: { kind: 'empty' },
      prompt: { kind: 'passkey' },
      transaction: {
        tree: null,
        theme: 'light',
        explorers: { near: 'https://testnet.nearblocks.io' },
        decision: { kind: 'ready', onConfirm: confirm },
        confirmText: 'Confirm with passkey',
        cancelText: 'Cancel',
        onCancel: review,
      },
    },
  };
}

function review(): void {
  window.clearTimeout(timer);
  handle?.dispose();
  view = 'expanded';
  handle = mountConfirmationSurface({
    parent: stage,
    presentation: { variant: 'modal', context: 'wallet-iframe' },
    model: model(),
    onClosed: () => {},
  });
}

function confirm(): void {
  play(0);
}

function play(step: number): void {
  const [state, durationMs] = lifecycle[step];
  receipt = state;
  showReceipt();
  if (durationMs > 0) timer = window.setTimeout(play, durationMs, step + 1);
}

function showReceipt(): void {
  handle?.showReceipt({ state: receipt, view, onView: changeView, onDismiss: review });
}

function changeView(next: TransactionReceiptView): void {
  view = next;
  showReceipt();
}

review();
