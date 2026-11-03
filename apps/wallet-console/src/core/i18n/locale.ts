export type ConsoleLocale = 'en' | 'ja';
export const consoleLocales: readonly ConsoleLocale[] = ['en', 'ja'];

const LOCALE_STORAGE_KEY = 'seams-console-locale-v1';

function isConsoleLocale(value: unknown): value is ConsoleLocale {
  return value === 'en' || value === 'ja';
}

function readStoredLocale(): ConsoleLocale | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isConsoleLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function readBrowserLocale(): ConsoleLocale {
  const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const language of languages) {
    const primary = language.toLowerCase().split('-')[0];
    if (isConsoleLocale(primary)) return primary;
  }
  return 'en';
}

/** The saved choice wins. Without one, the browser language decides. Node has no window: English. */
export function resolveConsoleLocale(): ConsoleLocale {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'en';
  return readStoredLocale() ?? readBrowserLocale();
}

/** Saves the choice and reloads, because the labels in the page configuration are read once at load. */
export function saveConsoleLocaleAndReload(locale: ConsoleLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Without storage the choice lasts until the reload only.
  }
  window.location.reload();
}

export function languageToggleLabel(locale: ConsoleLocale): string {
  return locale === 'ja' ? 'English' : '日本語';
}
