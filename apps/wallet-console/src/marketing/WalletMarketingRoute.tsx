import React from 'react';
import '@seams/wallet/react/styles';
import '@/app.css';
import { SITE_APPEARANCE, SITE_THEME_TOKEN_OVERRIDES } from '@/context/siteThemeOverrides';
import { FrontendRuntimeProvider, FrontendSdkProvider } from '@/context/frontendRuntime';
import { WalletPage } from '@/pages/wallet/page';
import { useSiteTheme } from '@/shared/hooks/useSiteTheme';

export function WalletMarketingRoute(): React.JSX.Element {
  const { theme } = useSiteTheme();
  return (
    <FrontendRuntimeProvider>
      <FrontendSdkProvider
        eager
        appearance={SITE_APPEARANCE}
        theme={{ theme, tokens: SITE_THEME_TOKEN_OVERRIDES }}
      >
        <WalletPage />
      </FrontendSdkProvider>
    </FrontendRuntimeProvider>
  );
}
