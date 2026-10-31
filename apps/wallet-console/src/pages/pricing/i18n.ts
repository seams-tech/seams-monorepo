import { useMarketingPage } from '@/marketing/context';
import { translate, type MessageKey } from './catalog';

export type PricingTranslator = (key: MessageKey) => string;

export function usePricingTranslation(): PricingTranslator {
  return translate.bind(null, useMarketingPage().locale);
}
