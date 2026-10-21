import { localeFromUrl } from './locale';
import { translate, type MessageKey } from './catalog';

// Language changes use document navigation, just like the marketing router.
export const locale = localeFromUrl(new URL(window.location.href));
document.documentElement.lang = locale;

export function t(key: MessageKey): string {
  return translate(locale, key);
}
