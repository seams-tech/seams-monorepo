import '@wallet-ui/sdk/wallet-ui.css';
import './checkoutWallet.css';
import { mountConfirmUI } from '@wallet-ui/core/signingEngine/uiConfirm/ui/confirm-ui';
import { walletIframeRequestIdFromBoundary } from '@wallet-ui/core/types/walletIframeIdentity';
import type { WalletIframeSurfaceMeasurement } from '@wallet-ui/SeamsWeb/walletIframe/shared/messages';
import { paperIframeAppearance } from '@/context/app-themes';

/* The wallet approval that the checkout demo hands off to. It renders the SDK's
   confirmer on sample data inside the overlay's frame and reports back to the
   checkout page; nothing is signed or sent. */

function post(message: Record<string, unknown>): void {
  window.parent.postMessage(message, window.location.origin);
}

// The wallet takes the merchant's accent through the SDK appearance tokens.
function merchantAppearance(): ReturnType<typeof paperIframeAppearance> {
  const appearance = paperIframeAppearance();
  return {
    ...appearance,
    theme: {
      ...appearance.theme,
      colors: {
        ...appearance.theme.colors,
        buttonBackground: '#852f43',
        buttonHoverBackground: '#6e2537',
        focus: '#852f43',
      },
    },
  };
}

async function showApproval(): Promise<void> {
  if (window.parent === window) return;
  const handle = await mountConfirmUI({
    ctx: {
      surfaceMeasurementBinding: {
        kind: 'wallet_iframe',
        requestId: walletIframeRequestIdFromBoundary('checkout-showcase'),
        postMeasurement: (measurement: WalletIframeSurfaceMeasurement) =>
          post({ type: 'checkout-measurement', measurement }),
      },
    },
    summary: {
      title: 'Approve purchase',
      body: 'Sample data. Nothing is signed or sent.',
    },
    model: {
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
    },
    securityContext: { rpId: 'shop.example.com' },
    loading: false,
    theme: 'light',
    appearance: merchantAppearance(),
    uiMode: 'modal',
  });
  handle.element.setAttribute('data-seams-review-frame', '');
  handle.update({ onBack: () => post({ type: 'checkout-back' }) });
  const decision = await handle.takeDecision();
  handle.close(decision.kind === 'confirmed');
  post({ type: 'checkout-finished', confirmed: decision.kind === 'confirmed' });
}

showApproval().catch((error: unknown) =>
  post({
    type: 'checkout-error',
    message: error instanceof Error ? error.message : 'The wallet approval could not open.',
  }),
);
