import { createRoot } from 'react-dom/client';
import { SeamsWebProvider, WalletSettingsPage, TransactionReviewHost } from '@seams/wallet/react';
import '@seams/wallet/react/styles';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import { loadWalletHostConfig } from '../src/frontendConfig';
import './styles.css';

async function mountWalletSettings(): Promise<void> {
  const element = document.getElementById('root');
  if (!element) throw new Error('Missing wallet settings root');
  const root = createRoot(element);
  try {
    const config = await loadWalletHostConfig(import.meta.env, window.location.origin);
    root.render(
      <SeamsWebProvider config={config}>
        <TransactionReviewHost>
          <WalletSettingsPage />
        </TransactionReviewHost>
      </SeamsWebProvider>,
    );
  } catch (error) {
    console.error('Unable to load wallet settings', error);
    root.render(
      <main className="wallet-load-error" role="alert">
        <h1>Wallet settings are unavailable</h1>
        <p>We could not connect to your wallet. Please reload this page to try again.</p>
      </main>,
    );
  }
}

void mountWalletSettings();
