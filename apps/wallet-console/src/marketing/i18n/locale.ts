export type Locale = 'en' | 'ja';

export function localeFromUrl(url: URL): Locale {
  const path = url.pathname.replace(/\/$/, '');
  if (path.endsWith('/ja')) return 'ja';
  if (url.searchParams.get('lang') === 'ja' && path.includes('/showcase/')) return 'ja';
  return 'en';
}

export function walletLanguageUrl(url: URL, walletPath: string, locale: Locale): string {
  const destination = new URL(walletPath, url.origin);
  const base = destination.pathname.replace(/\/$/, '');
  destination.pathname = locale === 'ja' ? `${base}/ja/` : `${base}/`;
  destination.search = url.search;
  destination.hash = url.hash;
  return destination.href;
}
