import React from 'react';
import '@seams/wallet/react/styles';
import '@/app.css';
import { pageFromUrl } from '@/marketing/i18n/locale';
import { WalletPage } from '@/pages/wallet/page';

const PricingPage = React.lazy(() =>
  import('@/pages/pricing/page').then((module) => ({ default: module.PricingPage })),
);

// Links between pages use document navigation, so the page is read once.
const page = pageFromUrl(new URL(window.location.href));

export function WalletMarketingRoute(): React.JSX.Element {
  return page === 'pricing' ? <PricingPage /> : <WalletPage />;
}
