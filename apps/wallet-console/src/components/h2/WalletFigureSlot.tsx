import React from 'react';
import { BrowserOnly } from '@/marketing/BrowserOnly';
import type { WalletFigure as Figure } from './WalletFigure';
export type { WalletFigureName } from './WalletFigure';

async function loadFigure() {
  const module = await import('./WalletFigure');
  return { default: module.WalletFigure };
}

const LiveFigure = React.lazy(loadFigure);

export function WalletFigure(props: React.ComponentProps<typeof Figure>): React.JSX.Element {
  const placeholder = (
    <div className="h2-wallet-figure" data-figure={props.figure} aria-hidden="true" />
  );
  return (
    <BrowserOnly fallback={placeholder}>
      <React.Suspense fallback={placeholder}>
        <LiveFigure {...props} />
      </React.Suspense>
    </BrowserOnly>
  );
}
