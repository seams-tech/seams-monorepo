import React from 'react';
import { DashboardToaster } from '@core/dashboard/components/DashboardToaster';
import { normalizePathname } from '@core/router/siteRouting';

const WalletMarketingRoute = React.lazy(() =>
  import('../marketing/WalletMarketingRoute').then((module) => ({
    default: module.WalletMarketingRoute,
  })),
);
const PricingPage = React.lazy(() =>
  import('../pages/pricing/page').then((module) => ({ default: module.PricingPage })),
);
const CompanyPage = React.lazy(() =>
  import('../pages/company/page').then((module) => ({ default: module.CompanyPage })),
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

function AppRoute({ pathname }: { pathname: string }): React.JSX.Element {
  if (pathname === '/') {
    return <WalletMarketingPage />;
  }
  if (pathname === '/pricing') {
    return <PricingPage />;
  }
  if (pathname === '/company') {
    return <CompanyPage />;
  }
  return <WalletMarketingPage />;
}

export function App(): React.JSX.Element {
  const location = useConsoleLocation();
  const pathname = normalizePathname(location);
  return (
    <>
      <React.Suspense fallback={null}>
        <AppRoute pathname={pathname} />
      </React.Suspense>
      <DashboardToaster />
    </>
  );
}
