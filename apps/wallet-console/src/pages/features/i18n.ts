import { useMarketingPage } from '@/marketing/context';
import { translate, type MessageKey } from './catalog';

export function useFeaturesTranslation(): (key: MessageKey) => string {
  return translate.bind(null, useMarketingPage().locale);
}
