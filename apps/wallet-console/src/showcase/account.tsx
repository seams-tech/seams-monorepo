import './embeddedFocus';
import { locale } from '@/marketing/i18n/browser';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import { showcasePreset } from './showcaseTheme';
import '@seams/wallet/react/styles';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import './showcase.css';
import './playbackFocus.css';
import './account.css';

// The mock sets its own theme scope, so the preset's colors go on the menu itself.
function presetColorVariables(): React.CSSProperties {
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(showcasePreset.colors)) {
    variables[`--seams-colors-${name}`] = value;
  }
  return variables;
}

const root = document.getElementById('root');
if (!root) throw new Error('Account showcase requires a root element.');
createRoot(root).render(
  <AccountMenuButtonMock
    locale={locale}
    className="account-showcase"
    theme={showcasePreset.mode}
    style={{ ...presetColorVariables(), width: '100%' }}
  />,
);
