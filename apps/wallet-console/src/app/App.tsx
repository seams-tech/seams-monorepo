import React from 'react';
import { DashboardToaster } from '@core/dashboard/components/DashboardToaster';

const WalletMarketingRoute = React.lazy(() =>
  import('../marketing/WalletMarketingRoute').then((module) => ({
    default: module.WalletMarketingRoute,
  })),
);

export function App(): React.JSX.Element {
  return (
    <>
      <React.Suspense fallback={null}>
        <WalletMarketingRoute />
      </React.Suspense>
      <DashboardToaster />
    </>
  );
}
