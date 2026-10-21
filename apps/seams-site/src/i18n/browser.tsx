import React from 'react';
import { translate, type MessageKey } from './catalog';
import type { Locale, SitePage } from './locale';

export const SitePageContext = React.createContext<SitePage>({
  kind: 'english',
  pathname: '/',
  locale: 'en',
});

export function useSitePage(): SitePage {
  return React.useContext(SitePageContext);
}

export function useLocale(): Locale {
  return useSitePage().locale;
}

export function useTranslation(): (key: MessageKey) => string {
  return translate.bind(null, useLocale());
}
