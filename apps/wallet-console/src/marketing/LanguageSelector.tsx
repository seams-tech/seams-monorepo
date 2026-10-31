import React from 'react';
import { LanguageSelector as SiteLanguageSelector } from '@seams-internal/site-navbar';
import { getWalletLanguageHref } from '@/app/router/siteRouting';
import { useMarketingPage, useTranslation } from './context';
import { readFrontendSiteLinks } from '@/frontendConfig';
import { walletPagePath, type WalletPage } from './i18n/locale';
import type { Locale } from './i18n/locale';

function changeLanguage(page: WalletPage, language: Locale): void {
  window.location.assign(getWalletLanguageHref(page, language));
}

export function LanguageSelector({
  placement,
}: {
  placement: 'navbar' | 'footer';
}): React.JSX.Element {
  const { page, locale } = useMarketingPage();
  const t = useTranslation();
  const { walletPath } = readFrontendSiteLinks(import.meta.env);
  return (
    <>
      <SiteLanguageSelector
        placement={placement}
        locale={locale}
        label={t('language')}
        onChange={changeLanguage.bind(null, page)}
      />
      <noscript>
        <a href={walletPagePath(walletPath, page, 'en')} lang="en">
          English
        </a>{' '}
        /{' '}
        <a href={walletPagePath(walletPath, page, 'ja')} lang="ja">
          日本語
        </a>
      </noscript>
    </>
  );
}
