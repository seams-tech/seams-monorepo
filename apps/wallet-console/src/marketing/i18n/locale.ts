export type Locale = 'en' | 'ja';
export type WalletPage = 'home' | 'pricing';

/* Page paths under the site's base: /, /ja/, /pricing/ and /ja/pricing/. */
export function pageFromUrl(url: URL): WalletPage {
  return url.pathname.replace(/\/$/, '').endsWith('/pricing') ? 'pricing' : 'home';
}

export function localeFromUrl(url: URL): Locale {
  const path = url.pathname.replace(/\/$/, '').replace(/\/pricing$/, '');
  if (path.endsWith('/ja')) return 'ja';
  if (url.searchParams.get('lang') === 'ja' && path.includes('/showcase/')) return 'ja';
  return 'en';
}

export function walletPagePath(walletPath: string, page: WalletPage, locale: Locale): string {
  const base = walletPath.replace(/\/$/, '');
  return `${base}${locale === 'ja' ? '/ja' : ''}${page === 'pricing' ? '/pricing' : ''}/`;
}

export function walletLanguageUrl(url: URL, walletPath: string, locale: Locale): string {
  const destination = new URL(url.origin);
  destination.pathname = walletPagePath(walletPath, pageFromUrl(url), locale);
  destination.search = url.search;
  destination.hash = url.hash;
  return destination.href;
}
