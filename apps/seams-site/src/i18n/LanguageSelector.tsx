import React from 'react';
import { LanguageSelector as SiteLanguageSelector } from '@seams-internal/site-navbar';
import { useLocale, useTranslation } from './browser';
import { languageUrl, type Locale, type TranslatedPage } from './locale';

function changeLanguage(page: TranslatedPage, locale: Locale): void {
  window.location.assign(languageUrl(new URL(window.location.href), page, locale));
}

export function LanguageSelector({
  page,
  placement,
}: {
  page: TranslatedPage;
  placement: 'navbar' | 'footer';
}): React.JSX.Element {
  const locale = useLocale();
  const t = useTranslation();
  return (
    <SiteLanguageSelector
      locale={locale}
      label={t('language')}
      onChange={changeLanguage.bind(null, page)}
      placement={placement}
    />
  );
}
