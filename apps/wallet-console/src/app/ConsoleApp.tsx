import React from 'react';
import { DashboardPage } from '@core/dashboard/page';
import { DashboardLoginPage } from '@core/dashboard/login/page';
import { DashboardToaster } from '@core/dashboard/components/DashboardToaster';
import { DashboardLoadingState } from '@core/dashboard/components/DashboardLoadingState';
import { normalizePathname } from '@core/router/siteRouting';
import { isSharedAccountPath, platformConsoleHref } from '@core/dashboard/consoleNavigation';
import type { DashboardComposition, DashboardRoute, SidebarGroupKey } from '@core/dashboard/types';

function readLocation(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

function subscribeLocation(update: () => void): () => void {
  window.addEventListener('popstate', update);
  window.addEventListener('site:navigate', update);
  return unsubscribeLocation.bind(null, update);
}

function unsubscribeLocation(update: () => void): void {
  window.removeEventListener('popstate', update);
  window.removeEventListener('site:navigate', update);
}

function redirectToAccount(href: string | null): void {
  if (href) window.location.replace(href);
}

export function ConsoleApp<Route extends string, Group extends string>({
  composition,
}: {
  readonly composition: DashboardComposition<DashboardRoute | Route, SidebarGroupKey | Group>;
}): React.JSX.Element {
  const location = React.useSyncExternalStore(subscribeLocation, readLocation, readLocation);
  const pathname = normalizePathname(location);
  const accountRedirect =
    import.meta.env.MODE === 'wallet' && isSharedAccountPath(pathname)
      ? platformConsoleHref(location)
      : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- The bound redirect is the complete effect input.
  React.useEffect(redirectToAccount.bind(null, accountRedirect), [accountRedirect]);
  if (accountRedirect) return <DashboardLoadingState title="Opening Platform Console..." />;
  if (pathname === '/dashboard/login') return <DashboardLoginPage />;
  return (
    <>
      <DashboardPage
        composition={composition}
        pathname={pathname === '/' ? '/dashboard' : pathname}
      />
      <DashboardToaster />
    </>
  );
}
