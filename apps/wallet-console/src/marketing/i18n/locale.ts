export type Locale = 'en' | 'ja';
export type WalletPage = 'home' | 'pricing' | 'features';

/* Page paths under the site's base: /, /pricing/ and /features/, each also under /ja/. */
export const walletPages: readonly WalletPage[] = ['home', 'pricing', 'features'];
export const locales: readonly Locale[] = ['en', 'ja'];

export function assertNeverWalletPage(page: never): never {
  throw new Error(`Unexpected Wallet marketing page: ${String(page)}`);
}

export type WalletRoute =
  | { readonly kind: 'page'; readonly page: WalletPage; readonly locale: Locale }
  | { readonly kind: 'not-found'; readonly page?: never; readonly locale?: never };

export function parseWalletRoute(url: URL, walletPath: string): WalletRoute {
  const pathname = url.pathname.replace(/\/$/, '');
  for (const page of walletPages) {
    for (const locale of locales) {
      if (pathname === walletPagePath(walletPath, page, locale).replace(/\/$/, '')) {
        return { kind: 'page', page, locale };
      }
    }
  }
  return { kind: 'not-found' };
}

export function localeFromUrl(url: URL): Locale {
  const path = url.pathname.replace(/\/$/, '').replace(/\/(?:pricing|features)$/, '');
  if (path.endsWith('/ja')) return 'ja';
  if (url.searchParams.get('lang') === 'ja' && path.includes('/showcase/')) return 'ja';
  return 'en';
}

export function walletPagePath(walletPath: string, page: WalletPage, locale: Locale): string {
  const base = walletPath.replace(/\/$/, '');
  return `${base}${locale === 'ja' ? '/ja' : ''}${page === 'home' ? '' : `/${page}`}/`;
}

export function walletLanguageUrl(
  url: URL,
  walletPath: string,
  page: WalletPage,
  locale: Locale,
): string {
  const destination = new URL(url.origin);
  destination.pathname = walletPagePath(walletPath, page, locale);
  destination.search = url.search;
  destination.hash = url.hash;
  return destination.href;
}
