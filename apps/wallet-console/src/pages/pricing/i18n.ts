import { locale } from '@/marketing/i18n/browser';
import { translate, type MessageKey } from './catalog';

export { locale };

// Language changes use document navigation, so the page keeps one locale.
export function t(key: MessageKey): string {
  return translate(locale, key);
}
