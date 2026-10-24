/* Sign-up runs in Wallet Console, whose dashboard ends the funnel, so its session is
   made there. The build sets its origin from deployment/console/targets.json; local
   development serves it on port 4001, beside this site. */
export function walletConsoleOrigin(): string {
  const configured = String(import.meta.env.VITE_WALLET_CONSOLE_ORIGIN ?? '').trim();
  if (configured) return new URL(configured).origin;
  return import.meta.env.DEV ? 'http://localhost:4001' : 'https://console.wallet.seams.sh';
}

/* The contact form is a dialog on the company site's home page. */
export const CONTACT_SALES_TARGET = '/#contact';

export type SignupPlan = 'free' | 'growth' | 'pro';

/** The Console login for a plan card. The pricing page shows it in a dialog (`embed=1`);
    the plain page is the link target without script, or in a new tab. */
export function planSignupHref(plan: SignupPlan, presentation: 'page' | 'dialog' = 'page'): string {
  const url = new URL('/dashboard/login', walletConsoleOrigin());
  url.searchParams.set('plan', plan);
  url.searchParams.set('src', 'pricing_card');
  if (presentation === 'dialog') url.searchParams.set('embed', '1');
  return url.href;
}
