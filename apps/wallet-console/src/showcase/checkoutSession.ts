import OverlayController from '@wallet-ui/SeamsWeb/walletIframe/client/overlay/overlay-controller';
import {
  requestSurfaceIdentity,
  modalWalletIframeSurfacePresentation,
} from '@wallet-ui/SeamsWeb/walletIframe/client/surface/domain';
import {
  measuredWalletIframeSurfaceGeometry,
  isWalletIframeModalGeometry,
} from '@wallet-ui/SeamsWeb/walletIframe/client/surface/geometry';
import {
  walletIframeRequestIdFromBoundary,
  walletIframeSurfaceIdFromBoundary,
} from '@wallet-ui/core/types/walletIframeIdentity';

type Phase = 'mounting' | 'review' | 'review_again' | 'preparing' | 'approval' | 'closed';
type Size = { widthCssPx: number; heightCssPx: number };

const reviewWidthCssPx = 440;

/* Drives the SDK's production overlay through a custom review and its handoff
   to the wallet approval. The approval runs in a sample-data frame that has no
   wallet provider, authentication or signing transport. */
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
  private approvalSize: Size = { widthCssPx: 480, heightCssPx: 420 };

  constructor(private readonly onFinish: (message: string) => void) {
    this.overlay = new OverlayController({
      ensureIframe: () => this.iframe,
      onDismiss: this.cancel,
    });
    this.slot = this.overlay.getTransactionReviewSlot();
    // Measure the review at its final width before the dialog opens.
    this.slot.classList.add('checkout-review-slot');
    this.slot.hidden = false;
    this.observer = new ResizeObserver(this.resize);
    this.overlay.setReviewAppearance({ theme: { id: 'showcase-light', mode: 'light' } });
    window.addEventListener('message', this.receive);
    window.addEventListener('resize', this.resize);
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
    window.removeEventListener('resize', this.resize);
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
    const presentation = modalWalletIframeSurfacePresentation(
      reviewing ? 'Review purchase' : 'Wallet approval',
    );
    const geometry = measuredWalletIframeSurfaceGeometry(
      presentation,
      {
        widthCssPx: window.innerWidth,
        heightCssPx: window.innerHeight,
        offsetLeftCssPx: 0,
        offsetTopCssPx: 0,
      },
      reviewing
        ? { widthCssPx: reviewWidthCssPx, heightCssPx: this.reviewHeightCssPx }
        : this.approvalSize,
    );
    if (!isWalletIframeModalGeometry(geometry)) return;
    this.overlay.apply({
      kind: reviewing ? 'compact_transaction_review' : 'compact_request_modal',
      presentation,
      geometry,
      focusTrap: true,
      identity: this.identity,
    });
  };

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
          ? 'Approved in the wallet. Nothing was signed or sent.'
          : 'Declined in the wallet. Nothing was signed or sent.',
      );
    } else if (message.type === 'checkout-error' && typeof message.message === 'string') {
      this.finish(message.message);
    } else if (message.type === 'checkout-measurement') {
      const size = measuredSize(message.measurement);
      if (size) this.showApproval(size);
    }
  };

  private showApproval(size: Size): void {
    this.approvalSize = size;
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

function measuredSize(value: unknown): Size | null {
  if (!isRecord(value)) return null;
  const { widthCssPx, heightCssPx } = value;
  if (typeof widthCssPx !== 'number' || typeof heightCssPx !== 'number') return null;
  if (!(widthCssPx > 0 && heightCssPx > 0 && Number.isFinite(widthCssPx + heightCssPx))) {
    return null;
  }
  return { widthCssPx, heightCssPx };
}
