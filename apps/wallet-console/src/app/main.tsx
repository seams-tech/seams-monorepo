import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import '@fontsource/hanken-grotesk/300.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import { App } from './App';
import { parseWalletRoute } from '../marketing/i18n/locale';
import { readFrontendSiteLinks } from '../frontendConfig';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root container');
const route = parseWalletRoute(
  new URL(window.location.href),
  readFrontendSiteLinks(import.meta.env).walletPath,
);
if (route.kind === 'not-found') throw new Error('Unknown marketing page');
const application = (
  <React.StrictMode>
    <App state={route} />
  </React.StrictMode>
);
if (container.dataset.rendered === 'true') hydrateRoot(container, application);
else createRoot(container).render(application);
