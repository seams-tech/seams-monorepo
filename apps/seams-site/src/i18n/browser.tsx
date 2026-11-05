import React from 'react';
import { translate, type MessageKey } from './catalog';
import type { Locale, SitePage } from './locale';
import { siteCopy, type SiteCopy } from './siteCopy';

export const SitePageContext = React.createContext<SitePage>({
  kind: 'untranslated',
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

/* The structured copy of the home, Satyr and 404 pages in the current locale. */
export function useSiteCopy(): SiteCopy {
  return siteCopy[useLocale()];
}
