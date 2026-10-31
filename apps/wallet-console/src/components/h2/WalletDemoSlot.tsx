import { useTranslation } from '@/marketing/context';
import { BrowserOnly } from '@/marketing/BrowserOnly';
import React from 'react';
import type { HostedAuthMenuMode } from '@seams/wallet/react';
import { GrainField } from '@seams-internal/grain-field';

function loadWalletDemo() {
  return import('./WalletDemo');
}

const WalletDemo = React.lazy(loadWalletDemo);

type DemoState = { kind: 'ready' } | { kind: 'unavailable' };
type DemoProps = { authDefaultModeWhenNoDetectedAccount?: HostedAuthMenuMode };

/* the hero field moves at half the site pace, so the motion behind the
   card stays calm */
const HERO_FIELD_PACE = 0.5;

/* The hero's demo cell: the live card on a moving gradient. Every state of
   the cell (loading, ready, unavailable) uses it, so the gradient never
   drops out while the demo loads. */
export function HeroDemoCell({
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className="h2-hero__demo" {...rest}>
      <GrainField field="teal-peach" pace={HERO_FIELD_PACE} />
      {children}
    </div>
  );
}

function reloadPage(): void {
  window.location.reload();
}

function DemoUnavailable(): React.JSX.Element {
  const t = useTranslation();
  return (
    <HeroDemoCell>
      <div className="h2-demo__unavailable" role="status">
        <p>{t('demoUnavailable')}</p>
        <p>{t('demoExplore')}</p>
        <button className="h2-btn h2-btn--outline" type="button" onClick={reloadPage}>
          {t('reload')}
        </button>
      </div>
    </HeroDemoCell>
  );
}

function DemoLoading(): React.JSX.Element {
  const t = useTranslation();
  return <HeroDemoCell aria-label={t('demoLoading')} />;
}

export class WalletDemoSlot extends React.Component<DemoProps, DemoState> {
  state: DemoState = { kind: 'ready' };

  static getDerivedStateFromError(): DemoState {
    return { kind: 'unavailable' };
  }

  render(): React.ReactNode {
    if (this.state.kind === 'unavailable') return <DemoUnavailable />;
    return (
      <BrowserOnly fallback={<DemoLoading />}>
        <React.Suspense fallback={<DemoLoading />}>
          <WalletDemo {...this.props} />
        </React.Suspense>
      </BrowserOnly>
    );
  }
}
