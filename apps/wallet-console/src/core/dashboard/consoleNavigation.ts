import { getActiveFrontendDeployment, selectNetwork } from '@core/runtime';
import type { DashboardExternalLink, TopbarContextState } from './types';
import {
  DASHBOARD_UI_QUERY_KEYS,
  persistDashboardSelectedContext,
  readPersistedDashboardSelectedContext,
} from './useDashboardUiPreferences';

/** Routes that only Platform Console serves. Onboarding stays on the Console
    origin that owns the signed-in session. */
export function isPlatformConsolePath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return (
    path === '/dashboard/invitations/accept' ||
    path === '/dashboard/billing/plan' ||
    path === '/platform/billing'
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

/** Wallet onboarding ends in Wallet Console with the organization and project it
    created. Other products keep onboarding flows of their own. */
export function walletConsoleOverviewHref(
  context: Pick<TopbarContextState, 'organization' | 'project'>,
): string {
  const url = new URL(walletConsoleHref('/dashboard/overview'));
  setConsoleContext(url, context);
  return url.href;
}

export function sharedAccountHref(pathname: string): string {
  return import.meta.env.MODE === 'wallet' && isPlatformConsolePath(pathname.split('?')[0])
    ? platformConsoleHref(pathname)
    : pathname;
}

export function rememberConsoleContext(): void {
  const parameters = new URLSearchParams(window.location.search);
  const previous = readPersistedDashboardSelectedContext();
  persistDashboardSelectedContext({
    organization:
      parameters.get(DASHBOARD_UI_QUERY_KEYS.organization) ?? previous.organization ?? '',
    project: parameters.get(DASHBOARD_UI_QUERY_KEYS.project) ?? previous.project ?? '',
  });
  selectNetwork(getActiveFrontendDeployment().network);
}

function setConsoleContext(
  url: URL,
  context: Pick<TopbarContextState, 'organization' | 'project'>,
): void {
  url.searchParams.set('db_network', getActiveFrontendDeployment().network);
  if (context.organization)
    url.searchParams.set(DASHBOARD_UI_QUERY_KEYS.organization, context.organization);
  if (context.project) url.searchParams.set(DASHBOARD_UI_QUERY_KEYS.project, context.project);
}

export function consoleSessionHref(
  pathname:
    | '/dashboard'
    | '/dashboard/login'
    | '/dashboard/onboarding'
    | '/dashboard/invitations/accept',
): string {
  const selected = readPersistedDashboardSelectedContext();
  const url = new URL(pathname, window.location.origin);
  setConsoleContext(url, {
    organization: selected.organization ?? '',
    project: selected.project ?? '',
  });
  return url.pathname + url.search;
}

export function linksWithConsoleContext(
  links: readonly DashboardExternalLink[],
  context: TopbarContextState,
): DashboardExternalLink[] {
  const result: DashboardExternalLink[] = [];
  for (const link of links) {
    const url = new URL(link.href);
    setConsoleContext(url, context);
    result.push({ label: link.label, href: url.href, icon: link.icon });
  }
  return result;
}
