import React from 'react';
import { Toaster } from 'sonner';
import { WalletMarketingRoute } from '../marketing/WalletMarketingRoute';
import { MarketingContext, type MarketingPageState } from '../marketing/context';

export function App({ state }: { state: MarketingPageState }): React.JSX.Element {
  return (
    <MarketingContext.Provider value={state}>
      <WalletMarketingRoute />
      {/* The live demo reports signing results, failures included, as toasts. */}
      <Toaster position="bottom-right" theme="light" closeButton />
    </MarketingContext.Provider>
  );
}
