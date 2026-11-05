import React from 'react';
import { LanguageSelector as SiteLanguageSelector } from '@seams-internal/site-navbar';
import { useSitePage, useTranslation } from './browser';
import { languageUrl, type Locale } from './locale';

export function LanguageSelector({
  placement,
}: {
  placement: 'navbar' | 'footer';
}): React.JSX.Element {
  const page = useSitePage();
  const t = useTranslation();
  const changeLanguage = React.useCallback(
    (locale: Locale) => {
      window.location.assign(languageUrl(new URL(window.location.href), page, locale));
    },
    [page],
  );
  return (
    <SiteLanguageSelector
      locale={page.locale}
      label={t('language')}
      onChange={changeLanguage}
      placement={placement}
    />
  );
}
