import { messages, type MessageKey } from './catalog';
import { resolveConsoleLocale, type ConsoleLocale } from './locale';

export type { ConsoleLocale } from './locale';
export type { MessageKey } from './catalog';
export { languageToggleLabel, saveConsoleLocaleAndReload } from './locale';

// Like the marketing pages, a language change reloads the page, so one locale holds for the whole run.
export const consoleLocale: ConsoleLocale = resolveConsoleLocale();
if (typeof document !== 'undefined') document.documentElement.lang = consoleLocale;

export function t(key: MessageKey): string {
  return messages[key][consoleLocale];
}
