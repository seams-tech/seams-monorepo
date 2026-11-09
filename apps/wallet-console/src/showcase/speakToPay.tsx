import '@seams/wallet/react/styles';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@/app.css';
import './speakToPay.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { SeamsWebProvider, Theme } from '@seams/wallet/react';
import { speakToSign } from '@seams/speak-to-sign';
import {
  FRONTEND_CONFIG,
  buildSeamsSdkConfig,
  getFrontendDeployment,
  type FrontendConfig,
  type FrontendDeployment,
} from '@/config';
import { SITE_APPEARANCE, SITE_THEME_TOKEN_OVERRIDES } from '@/context/siteThemeOverrides';
import { SpeakToPayFlow } from './speakToPayFlow';

type Lane =
  | Readonly<{ kind: 'staging_testnet'; deployment: FrontendDeployment }>
  | Readonly<{ kind: 'unavailable' }>;

/* Only the staging Gateway serves the Speak-to-Sign verifier; production lanes
   reject it by design. A staging site runs only the testnet lane. */
function readLane(config: FrontendConfig): Lane {
  if (config.siteKind !== 'staging') return { kind: 'unavailable' };
  const deployment = getFrontendDeployment(config, 'testnet');
  if (deployment.nearNetwork !== 'testnet') return { kind: 'unavailable' };
  return { kind: 'staging_testnet', deployment };
}

function SpeakToPayPage({ lane }: { lane: Lane }): React.JSX.Element {
  const config = React.useMemo(
    () =>
      lane.kind === 'staging_testnet'
        ? {
            ...buildSeamsSdkConfig(lane.deployment),
            appearance: { ...SITE_APPEARANCE, locale: 'en' as const },
            transactionFeatures: [speakToSign({ network: 'testnet' })],
          }
        : null,
    [lane],
  );
  return (
    <Theme theme="light" tokens={SITE_THEME_TOKEN_OVERRIDES} tag="div" className="stp-theme">
      <main className="stp-page">
        <header className="stp-intro">
          <p className="stp-eyebrow">NEAR testnet only</p>
          <h1>Speak to pay</h1>
          <p>
            Pay any named NEAR account with your voice. An attested verifier checks your voice and
            your words, and your Wallet then pays from your own account with no confirm. Do not
            use real funds.
          </p>
        </header>
        {lane.kind === 'staging_testnet' && config ? (
          <SeamsWebProvider
            theme={{ theme: 'light', tokens: SITE_THEME_TOKEN_OVERRIDES }}
            config={config}
          >
            <div className="stp-flow">
              <SpeakToPayFlow rpcUrl={lane.deployment.nearRpcUrl} />
            </div>
          </SeamsWebProvider>
        ) : (
          <div className="stp-notice" data-tone="info" role="status">
            Speak to pay is not available on this lane. It runs only on the staging testnet lane.
          </div>
        )}
      </main>
      <Toaster position="bottom-right" theme="light" closeButton />
    </Theme>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Speak to pay requires a root element.');
createRoot(root).render(
  <React.StrictMode>
    <SpeakToPayPage lane={readLane(FRONTEND_CONFIG)} />
  </React.StrictMode>,
);
