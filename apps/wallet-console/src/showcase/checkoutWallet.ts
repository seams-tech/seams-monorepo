import { t } from '@/marketing/i18n/browser';
import './embeddedFocus';
import '@wallet-ui/sdk/wallet-ui.css';
import './checkoutWallet.css';
import {
  mountConfirmationSurface,
  type ConfirmSurfaceModel,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface';
import { attachConfirmSurfaceResizeChoreographer } from '@wallet-ui/core/signingEngine/uiConfirm/ui/confirm-surface-resize';
import { addSurfaceResizeBeginListener } from '@wallet-ui/core/signingEngine/uiConfirm/ui/surface-resize-events';
import { buildDisplayTreeFromModel } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-display/tree';
import { enrichDisplayModelWithAbi } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-display/abi/enrichDisplayModelWithAbi';
import { buildEvmDisplayModel } from '@wallet-ui/core/signingEngine/chains/evm/display/evmTx';
import type {
  TransactionReceiptState,
  TransactionReceiptView,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-receipt';
import { checkoutAppearance } from './checkoutAppearance';
import { showcasePreset } from './showcaseTheme';
import { playReceiptLifecycle } from './receiptLifecycle';
import { sendExplorerLinksHome } from './sampleExplorer';
import { market, sideFrom } from './checkoutMarket';

/* The wallet approval that the checkout demo hands off to: the SDK's confirmer
   on sample data, inside the overlay's frame. Confirming plays the receipt as
   a toast. The frame reports its card height and receipt view so the checkout
   page can place and size the overlay. Nothing is signed or sent. */

const side = sideFrom(new URLSearchParams(location.search).get('side'));

// The purchase is a call to the market contract. The wallet builds and decodes
// it the way it does any EIP-1559 request, so the details show the
// transaction's own fields.
const buyPositions = {
  type: 'function',
  name: 'buyPositions',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'outcome', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'minPositions', type: 'uint256' },
  ],
  outputs: [],
};
const buyPositionsSelector = '0xae8a354b';

function abiWord(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function baseUnits(amount: string): bigint {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole + fraction.padEnd(18, '0'));
}

const purchase = enrichDisplayModelWithAbi(
  buildEvmDisplayModel({
    signerAccount: `0x4201${'0'.repeat(32)}891c`,
    request: {
      chain: 'evm',
      kind: 'eip1559',
      senderSignatureAlgorithm: 'secp256k1',
      tx: {
        chainId: 84532,
        nonce: 7n,
        maxPriorityFeePerGas: 1_000_000n,
        maxFeePerGas: 1_200_000n,
        gasLimit: 180_000n,
        to: `0x5A1E${'0'.repeat(32)}0542`,
        value: 0n,
        data: `${buyPositionsSelector}${abiWord(side === 'Yes' ? 1n : 0n)}${abiWord(
          baseUnits(market.pay),
        )}${abiWord(baseUnits(market.outcomes[side].minimumPositions))}`,
        abi: [buyPositions],
      },
    },
  }),
);

const explorer = 'https://sepolia.basescan.org/';
sendExplorerLinksHome(document.body, explorer);

let receipt: TransactionReceiptState = { kind: 'signing' };
let view: TransactionReceiptView = 'toast';
let shownView: TransactionReceiptView | null = null;
type CheckoutLayout = {
  dialogWidthCssPx: number;
  dialogMaxHeightCssPx: number;
  toastWidthCssPx: number;
};

let layout: { kind: 'waiting' } | { kind: 'ready'; dimensions: CheckoutLayout } = {
  kind: 'waiting',
};

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
        heading: t('approvePurchase'),
        website: { kind: 'ready', text: 'shop.example.com' },
        chainDetails: { kind: 'ready', text: 'Base Sepolia' },
      },
      body: { kind: 'empty' },
      prompt: { kind: 'passkey' },
      transaction: {
        tree: null,
        theme: showcasePreset.mode,
        explorers: { near: 'https://testnet.nearblocks.io', evm: explorer },
        decision: { kind: 'ready', onConfirm: confirm },
        confirmText: t('confirmPasskey'),
        cancelText: t('cancel'),
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
    subject: 'transaction',
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
function receiveLayout(event: MessageEvent<unknown>): void {
  if (event.source !== window.parent || event.origin !== window.location.origin) return;
  const message = event.data;
  if (typeof message !== 'object' || message === null) return;
  if (!('type' in message) || message.type !== 'checkout-layout') return;
  if (
    !('dialogWidthCssPx' in message) ||
    !('dialogMaxHeightCssPx' in message) ||
    !('toastWidthCssPx' in message)
  )
    return;
  const { dialogWidthCssPx, dialogMaxHeightCssPx, toastWidthCssPx } = message;
  if (
    typeof dialogWidthCssPx !== 'number' ||
    !Number.isFinite(dialogWidthCssPx) ||
    dialogWidthCssPx <= 0
  )
    return;
  if (
    typeof dialogMaxHeightCssPx !== 'number' ||
    !Number.isFinite(dialogMaxHeightCssPx) ||
    dialogMaxHeightCssPx <= 0
  )
    return;
  if (
    typeof toastWidthCssPx !== 'number' ||
    !Number.isFinite(toastWidthCssPx) ||
    toastWidthCssPx <= 0
  )
    return;
  layout = {
    kind: 'ready',
    dimensions: { dialogWidthCssPx, dialogMaxHeightCssPx, toastWidthCssPx },
  };
  const root = document.documentElement.style;
  root.setProperty('--checkout-dialog-width', `${dialogWidthCssPx}px`);
  root.setProperty('--checkout-toast-width', `${toastWidthCssPx}px`);
  constrainTransactionDetails();
  post({ type: 'checkout-height', heightCssPx: cardHeight() });
}

function constrainTransactionDetails(): void {
  if (layout.kind === 'waiting') return;
  const card = handle.element.querySelector<HTMLElement>('.modal-container-root');
  const details = handle.element.querySelector<HTMLDetailsElement>('.seams-review-technical');
  const body = details?.lastElementChild;
  if (card === null || details === null || !(body instanceof HTMLElement)) return;
  const tree = body.firstElementChild;
  if (!(tree instanceof HTMLElement)) return;
  const bodyHeight = details.open ? body.getBoundingClientRect().height : 0;
  const surroundingHeight = card.getBoundingClientRect().height - bodyHeight;
  const style = getComputedStyle(body);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const available = Math.max(
    0,
    layout.dimensions.dialogMaxHeightCssPx - surroundingHeight - padding,
  );
  const root = document.documentElement.style;
  root.removeProperty('--checkout-details-height');
  const naturalHeight = tree.scrollHeight;
  root.setProperty('--checkout-details-height', `${Math.min(available, naturalHeight)}px`);
}

function prepareDetailsExpansion(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const details = event.target.closest('summary')?.parentElement;
  if (
    details instanceof HTMLDetailsElement &&
    details.classList.contains('seams-review-technical') &&
    !details.open
  ) {
    constrainTransactionDetails();
  }
}

function keepNestedDetailsLocal(event: Event): void {
  if (
    event.target instanceof Element &&
    event.target.closest('.seams-review-technical > div > .seams-review-detail')
  ) {
    event.stopPropagation();
  }
}

function reportHeight(): void {
  if (layout.kind === 'ready') post({ type: 'checkout-height', heightCssPx: cardHeight() });
}

window.addEventListener('message', receiveLayout);
handle.element.addEventListener('click', prepareDetailsExpansion, { capture: true });
addSurfaceResizeBeginListener(handle.element, keepNestedDetailsLocal, { capture: true });

// Report later height changes, such as opening the transaction details.
new ResizeObserver(reportHeight).observe(handle.element);
