export type Locale = 'en' | 'ja';
export type TranslatedPage = 'home' | 'ecommerce' | 'company';

export const translatedPages: readonly TranslatedPage[] = ['home', 'ecommerce', 'company'];
export const locales: readonly Locale[] = ['en', 'ja'];

/* A translated page has its own document per locale, with its own metadata.
   Every other path (redirects, the 404 page) takes its locale from a /ja/ prefix. */
export type SitePage =
  | { kind: 'translated'; page: TranslatedPage; locale: Locale }
  | { kind: 'untranslated'; pathname: string; locale: Locale };

const PAGE_SEGMENTS: Record<TranslatedPage, string> = {
  home: '',
  ecommerce: 'ecommerce',
  company: 'company',
};

function stripLocalePrefix(pathname: string): { locale: Locale; rest: string } {
  if (pathname === '/ja' || pathname.startsWith('/ja/')) {
    return { locale: 'ja', rest: pathname.slice(3) || '/' };
  }
  return { locale: 'en', rest: pathname || '/' };
}

export function parseSitePage(pathname: string): SitePage {
  const { locale, rest } = stripLocalePrefix(pathname);
  const segment = rest.replace(/^\/+|\/+$/g, '');
  for (const page of translatedPages) {
    if (PAGE_SEGMENTS[page] === segment) return { kind: 'translated', page, locale };
  }
  return { kind: 'untranslated', pathname, locale };
}

export function pagePath(page: TranslatedPage, locale: Locale): string {
  const segment = PAGE_SEGMENTS[page];
  const prefix = locale === 'ja' ? '/ja/' : '/';
  return segment ? `${prefix}${segment}/` : prefix;
}

/* The same page in the other language. An untranslated path keeps its rest and
   swaps only the /ja/ prefix, so a 404 stays a 404 in the new language. */
export function localizedPath(page: SitePage, locale: Locale): string {
  if (page.kind === 'translated') return pagePath(page.page, locale);
  const { rest } = stripLocalePrefix(page.pathname);
  return locale === 'ja' ? `/ja${rest === '/' ? '/' : rest}` : rest;
}

export function languageUrl(url: URL, page: SitePage, locale: Locale): string {
  const destination = new URL(url);
  destination.pathname = localizedPath(page, locale);
  return destination.href;
}
