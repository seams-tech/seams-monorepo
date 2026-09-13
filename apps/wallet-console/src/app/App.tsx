import React from 'react';
import { DashboardPage } from '@core/dashboard/page';
import { DashboardLoginPage } from '@core/dashboard/login/page';
import { DashboardToaster } from '@core/dashboard/components/DashboardToaster';
import { normalizePathname } from '@core/router/siteRouting';
import { DASHBOARD_COMPOSITION } from './dashboardConfig';

const WalletMarketingRoute = React.lazy(() =>
  import('../marketing/WalletMarketingRoute').then((module) => ({
    default: module.WalletMarketingRoute,
  })),
);

function WalletMarketingPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={null}>
      <WalletMarketingRoute />
    </React.Suspense>
  );
}

function readConsoleLocation(): string {
  if (typeof window === 'undefined') return '/';
  const pathname = normalizePathname(window.location.pathname);
  const location = `${pathname}${window.location.search}${window.location.hash}`;
  if (pathname !== window.location.pathname) {
    window.history.replaceState(window.history.state, '', location);
  }
  return location;
}

function useConsoleLocation(): string {
  const [location, setLocation] = React.useState(readConsoleLocation);
  React.useEffect(() => {
    const onNavigate = () => setLocation(readConsoleLocation());
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('site:navigate', onNavigate);
    return () => {
      window.removeEventListener('popstate', onNavigate);
      window.removeEventListener('site:navigate', onNavigate);
    };
  }, []);
  return location;
}

// Static composition of the customer Console: core routes plus the Wallet
// Console route group registered in dashboardConfig. No SeamsWebProvider,
// no Wallet theme bridge — the Console owns its shell.
function AppRoute({ pathname }: { pathname: string }): React.JSX.Element {
  if (pathname === '/') {
    return <WalletMarketingPage />;
  }
  if (pathname === '/dashboard/login') {
    return <DashboardLoginPage />;
  }
  if (
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname.startsWith('/platform/')
  ) {
    return <DashboardPage composition={DASHBOARD_COMPOSITION} pathname={pathname} />;
  }
  return <WalletMarketingPage />;
}

export function App(): React.JSX.Element {
  const location = useConsoleLocation();
  const pathname = normalizePathname(location);
  return (
    <>
      <AppRoute pathname={pathname} />
      <DashboardToaster />
    </>
  );
}
