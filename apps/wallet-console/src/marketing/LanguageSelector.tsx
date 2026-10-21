import React from 'react';
import { LanguageSelector as SiteLanguageSelector } from '@seams-internal/site-navbar';
import { getWalletLanguageHref } from '@/app/router/siteRouting';
import { locale, t } from './i18n/browser';
import type { Locale } from './i18n/locale';

function changeLanguage(language: Locale): void {
  window.location.assign(getWalletLanguageHref(language));
}

export function LanguageSelector({
  placement,
}: {
  placement: 'navbar' | 'footer';
}): React.JSX.Element {
  return (
    <SiteLanguageSelector
      placement={placement}
      locale={locale}
      label={t('language')}
      onChange={changeLanguage}
    />
  );
}
