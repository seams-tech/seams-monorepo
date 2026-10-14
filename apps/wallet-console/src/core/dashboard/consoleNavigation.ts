import { getActiveFrontendDeployment } from '@core/runtime';
import type { DashboardExternalLink, TopbarContextState } from './types';

export function isSharedAccountPath(pathname: string): boolean {
  return (
    pathname === '/dashboard/onboarding' ||
    pathname === '/dashboard/account-settings' ||
    pathname === '/dashboard/team-members' ||
    pathname === '/platform/billing' ||
    /^\/dashboard\/(?:billing|invoices)(?:\/|$)/.test(pathname)
  );
}

function consoleOrigin(value: unknown, fallback: string): string {
  const origin = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const url = new URL(origin);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Console origin must be an HTTPS origin or a local development origin');
  }
  return url.origin;
}

export function platformConsoleHref(pathname: string): string {
  const fallback = import.meta.env.DEV ? 'http://localhost:4007' : 'https://console.seams.sh';
  const url = new URL(
    pathname,
    consoleOrigin(import.meta.env.VITE_PLATFORM_CONSOLE_ORIGIN, fallback),
  );
  url.searchParams.set('db_network', getActiveFrontendDeployment().network);
  return url.href;
}

export function walletConsoleHref(pathname: string): string {
  const fallback = import.meta.env.DEV
    ? 'http://localhost:4005'
    : 'https://console.wallet.seams.sh';
  return new URL(pathname, consoleOrigin(import.meta.env.VITE_WALLET_CONSOLE_ORIGIN, fallback))
    .href;
}

export function sharedAccountHref(pathname: string): string {
  return import.meta.env.MODE === 'wallet' && isSharedAccountPath(pathname.split('?')[0])
    ? platformConsoleHref(pathname)
    : pathname;
}

export function linksWithConsoleContext(
  links: readonly DashboardExternalLink[],
  context: TopbarContextState,
): DashboardExternalLink[] {
  const result: DashboardExternalLink[] = [];
  for (const link of links) {
    const url = new URL(link.href);
    url.searchParams.set('db_network', getActiveFrontendDeployment().network);
    if (context.organization) url.searchParams.set('db_org', context.organization);
    if (context.project) url.searchParams.set('db_project', context.project);
    result.push({ label: link.label, href: url.href, icon: link.icon });
  }
  return result;
}
