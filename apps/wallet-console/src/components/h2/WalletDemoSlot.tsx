import React from 'react';
import type { HostedAuthMenuMode } from '@seams/wallet/react';

function loadWalletDemo() {
  return import('./WalletDemo');
}

const WalletDemo = React.lazy(loadWalletDemo);

type DemoState = { kind: 'ready' } | { kind: 'unavailable' };
type DemoProps = { authDefaultModeWhenNoDetectedAccount?: HostedAuthMenuMode };

function reloadPage(): void {
  window.location.reload();
}

function DemoUnavailable(): React.JSX.Element {
  return (
    <div className="h2-hero__demo">
      <p className="h2-demo-label">Live demo</p>
      <div className="h2-demo__unavailable" role="status">
        <p>The live demo is temporarily unavailable.</p>
        <p>You can still explore the wallet features below.</p>
        <button className="h2-btn h2-btn--outline" type="button" onClick={reloadPage}>
          Reload page
        </button>
      </div>
    </div>
  );
}

export class WalletDemoSlot extends React.Component<DemoProps, DemoState> {
  state: DemoState = { kind: 'ready' };

  static getDerivedStateFromError(): DemoState {
    return { kind: 'unavailable' };
  }

  render(): React.ReactNode {
    if (this.state.kind === 'unavailable') return <DemoUnavailable />;
    return (
      <React.Suspense fallback={<div className="h2-hero__demo" aria-label="Loading live demo" />}>
        <WalletDemo {...this.props} />
      </React.Suspense>
    );
  }
}
