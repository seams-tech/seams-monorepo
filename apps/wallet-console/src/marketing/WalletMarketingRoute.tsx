import React from 'react';
import '@seams/wallet/react/styles';
import '@/app.css';
import { pageFromUrl } from '@/marketing/i18n/locale';
import { WalletPage } from '@/pages/wallet/page';

const PricingPage = React.lazy(() =>
  import('@/pages/pricing/page').then((module) => ({ default: module.PricingPage })),
);
const FeaturesPage = React.lazy(() =>
  import('@/pages/features/page').then((module) => ({ default: module.FeaturesPage })),
);

// Links between pages use document navigation, so the page is read once.
const page = pageFromUrl(new URL(window.location.href));

export function WalletMarketingRoute(): React.JSX.Element {
  switch (page) {
    case 'pricing':
      return <PricingPage />;
    case 'features':
      return <FeaturesPage />;
    case 'home':
      return <WalletPage />;
  }
}
