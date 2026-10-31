import React from 'react';
import { renderToString } from 'react-dom/server';
import { App } from '../app/App';
import type { MarketingPageState } from './context';

export function renderMarketingPage(state: MarketingPageState): string {
  return renderToString(
    <React.StrictMode>
      <App state={state} />
    </React.StrictMode>,
  );
}
