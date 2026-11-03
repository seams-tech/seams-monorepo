import { messages, type MessageKey } from './catalog';
import { resolveConsoleLocale, type ConsoleLocale } from './locale';

export type { ConsoleLocale } from './locale';
export type { MessageKey } from './catalog';
export { languageToggleLabel, saveConsoleLocaleAndReload } from './locale';

// Like the marketing pages, a language change reloads the page, so one locale holds for the whole run.
export const consoleLocale: ConsoleLocale = resolveConsoleLocale();
if (typeof document !== 'undefined') document.documentElement.lang = consoleLocale;

export type MessageParams = Readonly<Record<string, string | number>>;

/** Looks up a message. `{name}` in the text is replaced by `params.name`. */
export function t(key: MessageKey, params?: MessageParams): string {
  const text: string = messages[key][consoleLocale];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}
