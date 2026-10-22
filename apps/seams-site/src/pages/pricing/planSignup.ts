/* Sign-up and the plan page live on the Platform Console. The build sets its origin from
   deployment/console/targets.json; local development runs it on port 4007. */
function platformConsoleOrigin(): string {
  const configured = String(import.meta.env.VITE_PLATFORM_CONSOLE_ORIGIN ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return import.meta.env.DEV ? 'http://localhost:4007' : 'https://console.seams.sh';
}

/** The Console sign-in for a plan card; the Console keeps the plan through sign-in. */
export function planSignupHref(plan: 'free' | 'growth' | 'pro'): string {
  const url = new URL('/dashboard/login', platformConsoleOrigin());
  url.searchParams.set('plan', plan);
  url.searchParams.set('src', 'pricing_card');
  return url.href;
}
