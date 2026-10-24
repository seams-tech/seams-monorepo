/*
 * The pricing page on the Wallet site shows the login page in a dialog
 * (`/dashboard/login?embed=1&plan=…&src=pricing_card`). The frame posts these messages to
 * the site, which sizes the dialog and opens each next page, such as Stripe Checkout, in
 * the whole tab. apps/wallet-console/src/pages/pricing/PlanSignupDialog.tsx reads them.
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

function walletSiteOrigin(): string {
  const configured = String(import.meta.env.VITE_WALLET_SITE_ORIGIN ?? '').trim();
  if (configured) return new URL(configured).origin;
  return import.meta.env.DEV ? 'http://localhost:4001' : 'https://wallet.seams.sh';
}

/** True in the pricing page's dialog: a frame whose parent is the Wallet site. Firefox
    does not list ancestor origins; there the target origin of each message still keeps
    it from any other parent. */
export function isEmbeddedSignIn(): boolean {
  if (window.parent === window) return false;
  if (new URLSearchParams(window.location.search).get('embed') !== '1') return false;
  const ancestors = (window.location as Partial<Location>).ancestorOrigins;
  return !ancestors?.length || ancestors.item(0) === walletSiteOrigin();
}

export function postToWalletSite(
  message:
    | { readonly kind: 'height'; readonly height: number }
    | { readonly kind: 'navigate'; readonly url: string },
): void {
  const full: EmbeddedSignInMessage = { source: EMBEDDED_SIGN_IN_SOURCE, ...message };
  window.parent.postMessage(full, walletSiteOrigin());
}
