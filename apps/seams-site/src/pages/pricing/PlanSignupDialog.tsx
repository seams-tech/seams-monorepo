import { useTranslation } from '@/i18n/browser';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import React from 'react';
import { planSignupHref, walletConsoleOrigin, type SignupPlan } from './planSignup';

export type SignupOffer = {
  readonly id: SignupPlan;
  readonly name: string;
  readonly price: string;
  readonly unit: string;
  readonly field: GrainFieldName;
};

/*
 * The frame is the Wallet Console login page. It signs in, sets up the organization and
 * the first project, and starts Stripe card setup; this page only sizes the frame and
 * opens the next page in the whole tab. The messages come from
 * apps/wallet-console/src/core/dashboard/login/embeddedSignIn.ts.
 */
const EMBEDDED_SIGN_IN_SOURCE = 'seams-console-sign-in';
const STRIPE_CHECKOUT_ORIGIN = 'https://checkout.stripe.com';
const FRAME_DEFAULT_HEIGHT = 260;
const FRAME_MAX_HEIGHT = 720;

type EmbeddedSignInMessage =
  | { readonly kind: 'height'; readonly height: number }
  | { readonly kind: 'navigate'; readonly url: URL };

function readEmbeddedSignInMessage(data: unknown): EmbeddedSignInMessage | null {
  if (data === null || typeof data !== 'object') return null;
  if (Reflect.get(data, 'source') !== EMBEDDED_SIGN_IN_SOURCE) return null;
  const kind = Reflect.get(data, 'kind');
  if (kind === 'height') {
    const height = Reflect.get(data, 'height');
    return typeof height === 'number' && Number.isFinite(height) ? { kind, height } : null;
  }
  const url = Reflect.get(data, 'url');
  if (kind !== 'navigate' || typeof url !== 'string') return null;
  try {
    return { kind, url: new URL(url) };
  } catch {
    return null;
  }
}

/* Stripe Checkout, or a page of the Console itself, such as its dashboard. */
function isSignupDestination(url: URL, consoleOrigin: string): boolean {
  return url.origin === consoleOrigin || url.origin === STRIPE_CHECKOUT_ORIGIN;
}

export function PlanSignupDialog({
  offer,
  onClose,
}: {
  offer: SignupOffer | null;
  onClose: () => void;
}): React.JSX.Element {
  const t = useTranslation();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = React.useState(FRAME_DEFAULT_HEIGHT);
  const open = offer !== null;

  // Escape closes the dialog natively; keep the state in step
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [onClose]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setFrameHeight(FRAME_DEFAULT_HEIGHT);
  }, [open]);

  // Back from Stripe restores this page as it was left; start again from the cards
  React.useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) dialogRef.current?.close();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const consoleOrigin = walletConsoleOrigin();
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== consoleOrigin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = readEmbeddedSignInMessage(event.data);
      if (!message) return;
      if (message.kind === 'height') {
        setFrameHeight(Math.min(Math.max(Math.ceil(message.height), 120), FRAME_MAX_HEIGHT));
        return;
      }
      if (isSignupDestination(message.url, consoleOrigin)) {
        window.location.assign(message.url.href);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="h2-page plan-signup"
      aria-label={offer ? t('signupDialogLabel').replace('{plan}', offer.name) : undefined}
      onClick={(event) => {
        // a click on the backdrop lands on the dialog element itself
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      {offer ? (
        <div className="plan-signup__panel">
          <div className="plan-signup__band">
            <GrainField field={offer.field} />
            <span className="plan-signup__plan">{offer.name}</span>
            <span className="plan-signup__price">
              <strong>{offer.price}</strong> {offer.unit}
            </span>
          </div>
          <button
            type="button"
            className="plan-signup__close"
            aria-label={t('close')}
            onClick={() => dialogRef.current?.close()}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M3.5 3.5l9 9m0-9l-9 9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <iframe
            ref={frameRef}
            className="plan-signup__frame"
            src={planSignupHref(offer.id, 'dialog')}
            title={t('signupFrameTitle')}
            // Google sign-in runs in the frame through FedCM
            allow="identity-credentials-get"
            style={{ height: frameHeight }}
          />
        </div>
      ) : null}
    </dialog>
  );
}
