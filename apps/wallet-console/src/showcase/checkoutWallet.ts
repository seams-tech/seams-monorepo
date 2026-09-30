import '@wallet-ui/sdk/wallet-ui.css';
import './checkoutWallet.css';
import {
  mountConfirmationSurface,
  type ConfirmSurfaceModel,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface';
import { attachConfirmSurfaceResizeChoreographer } from '@wallet-ui/core/signingEngine/uiConfirm/ui/confirm-surface-resize';
import { buildDisplayTreeFromModel } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-display/tree';
import type {
  TransactionReceiptState,
  TransactionReceiptView,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-receipt';
import type { TxDisplayModel } from '@wallet-ui/core/signingEngine/interfaces/display';
import { checkoutAppearance } from './checkoutAppearance';
import { playReceiptLifecycle } from './receiptLifecycle';
import { sendExplorerLinksHome } from './sampleExplorer';
import { market, sideFrom } from './checkoutMarket';

/* The wallet approval that the checkout demo hands off to: the SDK's confirmer
   on sample data, inside the overlay's frame. Confirming plays the receipt as
   a toast. The frame reports its card height and receipt view so the checkout
   page can place and size the overlay. Nothing is signed or sent. */

const side = sideFrom(new URLSearchParams(location.search).get('side'));

const purchase: TxDisplayModel = {
  chain: 'evm',
  chainId: 84532,
  operations: [
    {
      id: 'buy-yes',
      kind: 'generic.contractCall',
      label: `Buy ${side} positions`,
      fields: [
        { label: 'Market', value: market.lot },
        { label: 'You pay', value: `${market.pay} test units` },
        { label: 'Minimum positions', value: market.outcomes[side].minimumPositions },
      ],
    },
  ],
};

const explorer = 'https://sepolia.basescan.org/';
sendExplorerLinksHome(document.body, explorer);

let receipt: TransactionReceiptState = { kind: 'signing' };
let view: TransactionReceiptView = 'toast';
let shownView: TransactionReceiptView | null = null;
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
        explorers: { near: 'https://testnet.nearblocks.io', evm: explorer },
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
// Content that changes height, such as opening the transaction details, asks
// its host for room first. As the SDK's own wallet frame does, pin the card to
// its target height so the checkout page hears one height and eases once, then
// drive the content from the room this frame has actually been given.
attachConfirmSurfaceResizeChoreographer(handle.element);

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
  if (view !== shownView) settleReceiptMorph();
  shownView = view;
  // The card has already laid out at the new view's width, so its height here
  // is final and the checkout page can resize the dialog in one step.
  post({ type: 'checkout-receipt-view', view, heightCssPx: cardHeight() });
}

// On a view change the surface morphs a card-shaped layer between the old and
// new bounds inside this frame. That suits a fixed frame; here the checkout
// dialog already animates the card as it moves and resizes the frame, so two
// cards would move on different timings. Finish the surface's scripted motion
// and leave the dialog's as the only one. Updates within a view keep their
// motion, as do CSS animations such as the progress sweep and spinner.
function settleReceiptMorph(): void {
  for (const animation of handle.element.getAnimations({ subtree: true })) {
    if (animation instanceof CSSAnimation || animation instanceof CSSTransition) continue;
    animation.finish();
  }
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
