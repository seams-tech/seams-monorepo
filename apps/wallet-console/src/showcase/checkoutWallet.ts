import '@wallet-ui/sdk/wallet-ui.css';
import './checkoutWallet.css';
import {
  mountConfirmationSurface,
  type ConfirmSurfaceModel,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface';
import { buildDisplayTreeFromModel } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-display/tree';
import type {
  TransactionReceiptState,
  TransactionReceiptView,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-receipt';
import type { TxDisplayModel } from '@wallet-ui/core/signingEngine/interfaces/display';
import { checkoutAppearance } from './checkoutAppearance';
import { playReceiptLifecycle } from './receiptLifecycle';

/* The wallet approval that the checkout demo hands off to: the SDK's confirmer
   on sample data, inside the overlay's frame. Confirming plays the receipt as
   a toast. The frame reports its card height and receipt view so the checkout
   page can place and size the overlay. Nothing is signed or sent. */

const purchase: TxDisplayModel = {
  chain: 'evm',
  chainId: 84532,
  operations: [
    {
      id: 'buy-yes',
      kind: 'generic.contractCall',
      label: 'Buy Yes positions',
      fields: [
        { label: 'Market', value: 'LOT 542 · Otsuka Lotec No.7.5' },
        { label: 'You pay', value: '0.1 test units' },
        { label: 'Minimum positions', value: '0.191400' },
      ],
    },
  ],
};

let receipt: TransactionReceiptState = { kind: 'signing' };
let view: TransactionReceiptView = 'toast';
let laidOut = false;

function post(message: Record<string, unknown>): void {
  window.parent.postMessage(message, window.location.origin);
}

function model(): ConfirmSurfaceModel {
  return {
    appearance: checkoutAppearance(),
    content: {
      kind: 'transaction',
      review: {
        model: purchase,
        tree: buildDisplayTreeFromModel(purchase),
        detailsInitiallyOpen: false,
      },
      header: {
        heading: 'Approve purchase',
        website: { kind: 'ready', text: 'shop.example.com' },
        chainDetails: { kind: 'ready', text: 'Base Sepolia' },
      },
      body: { kind: 'text', text: 'Sample data. Nothing is signed or sent.' },
      prompt: { kind: 'passkey' },
      transaction: {
        tree: null,
        theme: 'light',
        explorers: { near: 'https://testnet.nearblocks.io' },
        decision: { kind: 'ready', onConfirm: confirm },
        confirmText: 'Confirm with passkey',
        cancelText: 'Cancel',
        onCancel: () => post({ type: 'checkout-finished', confirmed: false }),
        onBack: () => post({ type: 'checkout-back' }),
      },
    },
  };
}

const handle = mountConfirmationSurface({
  parent: document.body,
  presentation: { variant: 'modal', context: 'wallet-iframe' },
  model: model(),
  onClosed: () => {},
});
// After a review handoff the checkout dialog's shell paints the card; this
// keeps the card inside the frame transparent so only one card shows.
handle.element.setAttribute('data-seams-review-frame', '');

function confirm(): void {
  playReceiptLifecycle((state) => {
    receipt = state;
    showReceipt();
  });
}

function showReceipt(): void {
  handle.showReceipt({
    state: receipt,
    view,
    onView: (next) => {
      view = next;
      showReceipt();
    },
    onDismiss: () => post({ type: 'checkout-finished', confirmed: true }),
  });
  // The card has already laid out at the new view's width, so its height here
  // is final and the checkout page can resize the dialog in one step.
  post({ type: 'checkout-receipt-view', view, heightCssPx: cardHeight() });
}

function cardHeight(): number {
  return handle.element.getBoundingClientRect().height;
}

// The checkout page sends the widths it gives this frame, so the card lays out
// at its final width before the dialog animates to it. Heights are reported
// only after that, so the first one is already final.
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return;
  const message = event.data;
  if (typeof message !== 'object' || message === null) return;
  const { type, dialogWidthCssPx, toastWidthCssPx } = message as Record<string, unknown>;
  if (type !== 'checkout-layout') return;
  if (typeof dialogWidthCssPx !== 'number' || typeof toastWidthCssPx !== 'number') return;
  const root = document.documentElement.style;
  root.setProperty('--checkout-dialog-width', `${dialogWidthCssPx}px`);
  root.setProperty('--checkout-toast-width', `${toastWidthCssPx}px`);
  laidOut = true;
  post({ type: 'checkout-height', heightCssPx: cardHeight() });
});

// Report later height changes, such as opening the transaction details.
new ResizeObserver(() => {
  if (laidOut) post({ type: 'checkout-height', heightCssPx: cardHeight() });
}).observe(handle.element);
