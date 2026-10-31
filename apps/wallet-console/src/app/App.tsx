import React from 'react';
import { WalletMarketingRoute } from '../marketing/WalletMarketingRoute';
import { MarketingContext, type MarketingPageState } from '../marketing/context';

export function App({ state }: { state: MarketingPageState }): React.JSX.Element {
  return (
    <MarketingContext.Provider value={state}>
      <WalletMarketingRoute />
    </MarketingContext.Provider>
  );
}
