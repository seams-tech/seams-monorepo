export type Locale = 'en' | 'ja';
export type TranslatedPage = 'pricing' | 'company';

export type SitePage =
  | { kind: 'translated'; page: TranslatedPage; locale: Locale }
  | { kind: 'english'; pathname: string; locale: 'en' };

export function parseSitePage(pathname: string): SitePage {
  switch (pathname.replace(/\/$/, '')) {
    case '/pricing':
      return { kind: 'translated', page: 'pricing', locale: 'en' };
    case '/company':
      return { kind: 'translated', page: 'company', locale: 'en' };
    case '/ja/pricing':
      return { kind: 'translated', page: 'pricing', locale: 'ja' };
    case '/ja/company':
      return { kind: 'translated', page: 'company', locale: 'ja' };
    default:
      return { kind: 'english', pathname, locale: 'en' };
  }
}

export function pagePath(page: TranslatedPage, locale: Locale): string {
  return locale === 'ja' ? `/ja/${page}/` : `/${page}/`;
}

export function languageUrl(url: URL, page: TranslatedPage, locale: Locale): string {
  const destination = new URL(url);
  destination.pathname = pagePath(page, locale);
  return destination.href;
}
