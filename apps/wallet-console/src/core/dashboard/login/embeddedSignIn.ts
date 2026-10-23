/*
 * The pricing page on the company site shows the login page in a dialog
 * (`/dashboard/login?embed=1&plan=…&src=pricing_card`). The frame posts these messages to
 * the site, which sizes the dialog and opens each next page, such as Stripe Checkout, in
 * the whole tab. apps/seams-site/src/pages/pricing/PlanSignupDialog.tsx reads them.
 */
export const EMBEDDED_SIGN_IN_SOURCE = 'seams-console-sign-in';

export type EmbeddedSignInMessage =
  | {
      readonly source: typeof EMBEDDED_SIGN_IN_SOURCE;
      readonly kind: 'height';
      readonly height: number;
    }
  | {
      readonly source: typeof EMBEDDED_SIGN_IN_SOURCE;
      readonly kind: 'navigate';
      readonly url: string;
    };

function companySiteOrigin(): string {
  const configured = String(import.meta.env.VITE_COMPANY_SITE_ORIGIN ?? '').trim();
  if (configured) return new URL(configured).origin;
  return import.meta.env.DEV ? 'http://localhost:4001' : 'https://seams.sh';
}

/** True in the pricing page's dialog: a frame whose parent is the company site. Firefox
    does not list ancestor origins; there the target origin of each message still keeps
    it from any other parent. */
export function isEmbeddedSignIn(): boolean {
  if (window.parent === window) return false;
  if (new URLSearchParams(window.location.search).get('embed') !== '1') return false;
  const ancestors = (window.location as Partial<Location>).ancestorOrigins;
  return !ancestors?.length || ancestors.item(0) === companySiteOrigin();
}

export function postToCompanySite(
  message:
    | { readonly kind: 'height'; readonly height: number }
    | { readonly kind: 'navigate'; readonly url: string },
): void {
  const full: EmbeddedSignInMessage = { source: EMBEDDED_SIGN_IN_SOURCE, ...message };
  window.parent.postMessage(full, companySiteOrigin());
}
