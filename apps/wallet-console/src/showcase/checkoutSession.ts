import OverlayController from '@wallet-ui/SeamsWeb/walletIframe/client/overlay/overlay-controller';
import {
  requestSurfaceIdentity,
  modalWalletIframeSurfacePresentation,
} from '@wallet-ui/SeamsWeb/walletIframe/client/surface/domain';
import {
  measuredWalletIframeSurfaceGeometry,
  isWalletIframeModalGeometry,
  type WalletIframeModalGeometry,
} from '@wallet-ui/SeamsWeb/walletIframe/client/surface/geometry';
import {
  walletIframeRequestIdFromBoundary,
  walletIframeSurfaceIdFromBoundary,
} from '@wallet-ui/core/types/walletIframeIdentity';
import type { TransactionReceiptView } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-receipt';
import { checkoutAppearance } from './checkoutAppearance';

type Phase = 'mounting' | 'review' | 'review_again' | 'preparing' | 'approval' | 'closed';

// The review, the wallet approval and its expanded receipt all take this
// width, so the handoff only changes the dialog's height. The toast takes the
// SDK's toast width. The wallet frame is told both widths up front, so its card
// lays out at the final width before the dialog animates to it, and it reports
// only its height.
const dialogWidthCssPx = 420;
const toastWidthCssPx = 360;

const confirmedMessage = 'Purchase confirmed. Nothing was signed or sent.';

/* Drives the SDK's production overlay through a custom review, its handoff to
   the wallet approval, and the receipt toast that follows. The approval runs
   in a sample-data frame that has no wallet provider, authentication or
   signing transport. */
export class CheckoutSession {
  readonly slot: HTMLElement;
  private readonly iframe = document.createElement('iframe');
  private readonly overlay: OverlayController;
  private readonly observer: ResizeObserver;
  private readonly identity = requestSurfaceIdentity({
    requestId: walletIframeRequestIdFromBoundary('checkout-showcase'),
    surfaceId: walletIframeSurfaceIdFromBoundary(crypto.randomUUID()),
  });
  private phase: Phase = 'mounting';
  private reviewHeightCssPx = 0;
  private walletHeightCssPx = 420;
  // Set once the wallet shows its receipt; null while it still asks for approval.
  private receiptView: TransactionReceiptView | null = null;

  constructor(private readonly onFinish: (message: string) => void) {
    this.overlay = new OverlayController({
      ensureIframe: () => this.iframe,
      // Escape or a backdrop click; once the receipt shows, the purchase is done.
      onDismiss: () => (this.receiptView ? this.finish(confirmedMessage) : this.cancel()),
    });
    this.slot = this.overlay.getTransactionReviewSlot();
    // Measure the review at its final width before the dialog opens.
    this.slot.classList.add('checkout-review-slot');
    this.slot.hidden = false;
    this.observer = new ResizeObserver(this.resize);
    // The dialog's shell paints the card for both the review and the wallet
    // frame after the handoff, so it takes the wallet's appearance.
    this.overlay.setReviewAppearance(checkoutAppearance());
    this.iframe.addEventListener('load', this.sendLayout);
    window.addEventListener('message', this.receive);
    window.addEventListener('resize', this.relayout);
  }

  readonly observe = (content: HTMLElement | null): void => {
    if (!content) return;
    this.observer.observe(content);
    if (this.phase !== 'mounting') return;
    this.phase = 'review';
    this.resize();
    content.querySelector<HTMLElement>('button')?.focus();
  };

  readonly continueToWallet = (): void => {
    if (this.phase === 'review_again') {
      this.phase = 'approval';
      this.resize();
      this.overlay.activateAfterReviewHandoff(this.focusWallet);
      return;
    }
    if (this.phase !== 'review') return;
    this.phase = 'preparing';
    this.iframe.src = `${import.meta.env.BASE_URL}showcase/checkout/wallet/`;
  };

  readonly cancel = (): void => this.finish('Checkout closed. Nothing was signed or sent.');

  readonly fail = (error: unknown): void =>
    this.finish(error instanceof Error ? error.message : 'The demo could not open.');

  readonly dispose = (): void => {
    this.phase = 'closed';
    this.observer.disconnect();
    window.removeEventListener('message', this.receive);
    window.removeEventListener('resize', this.relayout);
    this.overlay.dispose();
    this.iframe.remove();
  };

  private readonly resize = (): void => {
    if (this.phase === 'closed' || this.phase === 'mounting') return;
    const reviewing = this.phase !== 'approval';
    const content = this.slot.firstElementChild;
    if (!content) return;
    if (reviewing && !this.slot.hidden) {
      this.reviewHeightCssPx = content.getBoundingClientRect().height;
    }
    if (this.receiptView === 'toast') {
      this.overlay.apply({
        kind: 'compact_request_modal',
        presentation: modalWalletIframeSurfacePresentation('Transaction receipt'),
        geometry: this.toastGeometry(),
        focusTrap: false,
        identity: this.identity,
      });
      return;
    }
    const presentation = modalWalletIframeSurfacePresentation(
      reviewing ? 'Review purchase' : this.receiptView ? 'Transaction receipt' : 'Wallet approval',
    );
    const geometry = dialogGeometry(
      presentation,
      reviewing ? this.reviewHeightCssPx : this.walletHeightCssPx,
    );
    if (!geometry) return;
    this.overlay.apply({
      kind: reviewing ? 'compact_transaction_review' : 'compact_request_modal',
      presentation,
      geometry,
      focusTrap: true,
      identity: this.identity,
    });
  };

  private readonly relayout = (): void => {
    this.sendLayout();
    this.resize();
  };

  private readonly sendLayout = (): void => {
    const dialog = dialogGeometry(modalWalletIframeSurfacePresentation('Wallet approval'), 1);
    this.iframe.contentWindow?.postMessage(
      {
        type: 'checkout-layout',
        dialogWidthCssPx: dialog?.widthCssPx ?? dialogWidthCssPx,
        toastWidthCssPx: toastWidth(),
      },
      window.location.origin,
    );
  };

  // Docked in the bottom-right corner, as the SDK places its receipt toast.
  private toastGeometry(): WalletIframeModalGeometry {
    const widthCssPx = toastWidth();
    const heightCssPx = Math.min(this.walletHeightCssPx, Math.max(1, window.innerHeight - 32));
    return {
      kind: 'centered_modal',
      widthCssPx,
      heightCssPx,
      leftCssPx: window.innerWidth - widthCssPx - 16,
      topCssPx: window.innerHeight - heightCssPx - 16,
    };
  }

  private readonly focusWallet = (): void => {
    this.iframe.contentDocument
      ?.querySelector<HTMLElement>('.seams-confirmation-modal--hosted')
      ?.focus({ preventScroll: true });
  };

  private readonly receive = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.iframe.contentWindow || event.origin !== window.location.origin) {
      return;
    }
    const message = event.data;
    if (!isRecord(message)) return;
    if (message.type === 'checkout-back' && this.phase === 'approval') {
      this.phase = 'review_again';
      this.resize();
    } else if (message.type === 'checkout-finished' && typeof message.confirmed === 'boolean') {
      this.finish(
        message.confirmed
          ? confirmedMessage
          : 'Declined in the wallet. Nothing was signed or sent.',
      );
    } else if (
      message.type === 'checkout-receipt-view' &&
      (message.view === 'expanded' || message.view === 'toast') &&
      isPositiveNumber(message.heightCssPx) &&
      this.phase === 'approval'
    ) {
      // The new view and its height arrive together, so the dialog resizes once.
      this.receiptView = message.view;
      this.walletHeightCssPx = message.heightCssPx;
      this.resize();
    } else if (message.type === 'checkout-height' && isPositiveNumber(message.heightCssPx)) {
      this.showWallet(message.heightCssPx);
    }
  };

  private showWallet(heightCssPx: number): void {
    this.walletHeightCssPx = heightCssPx;
    if (this.phase === 'preparing') {
      this.phase = 'approval';
      this.resize();
      this.overlay.activateAfterReviewHandoff(this.focusWallet);
    } else if (this.phase === 'approval') {
      this.resize();
    }
  }

  private finish(message: string): void {
    if (this.phase === 'closed') return;
    this.dispose();
    this.onFinish(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function dialogGeometry(
  presentation: ReturnType<typeof modalWalletIframeSurfacePresentation>,
  heightCssPx: number,
): WalletIframeModalGeometry | null {
  const geometry = measuredWalletIframeSurfaceGeometry(
    presentation,
    {
      widthCssPx: window.innerWidth,
      heightCssPx: window.innerHeight,
      offsetLeftCssPx: 0,
      offsetTopCssPx: 0,
    },
    { widthCssPx: dialogWidthCssPx, heightCssPx },
  );
  return isWalletIframeModalGeometry(geometry) ? geometry : null;
}

function toastWidth(): number {
  return Math.min(toastWidthCssPx, Math.max(1, window.innerWidth - 32));
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
