import React from 'react';
import { translate, type MessageKey } from './i18n/catalog';
import type { Locale, WalletPage } from './i18n/locale';

export type MarketingPageState = { readonly page: WalletPage; readonly locale: Locale };
export type MarketingTranslator = (key: MessageKey) => string;

export const MarketingContext = React.createContext<MarketingPageState | null>(null);

export function useMarketingPage(): MarketingPageState {
  const state = React.useContext(MarketingContext);
  if (state === null) throw new Error('Marketing components require a page and locale.');
  return state;
}

export function useTranslation(): MarketingTranslator {
  return translate.bind(null, useMarketingPage().locale);
}
