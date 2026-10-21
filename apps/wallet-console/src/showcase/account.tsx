import './embeddedFocus';
import '@/marketing/i18n/browser';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import './showcase.css';
import './playbackFocus.css';
import './account.css';

const root = document.getElementById('root');
if (!root) throw new Error('Account showcase requires a root element.');
createRoot(root).render(
  <AccountMenuButtonMock className="account-showcase" theme="light" style={{ width: '100%' }} />,
);
