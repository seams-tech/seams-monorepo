import { translate, type MessageKey } from './catalog';
import { pagePath, type Locale, type SitePage, type TranslatedPage } from './locale';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const PAGE_TEXT: Record<TranslatedPage, { title: MessageKey; description: MessageKey }> = {
  company: { title: 'companyPageTitle', description: 'companyDescription' },
};

export function pageTitle(page: TranslatedPage, locale: Locale): string {
  return translate(locale, PAGE_TEXT[page].title);
}

export function metadataTags(page: TranslatedPage, locale: Locale, origin: string): string {
  const english = escapeHtml(new URL(pagePath(page, 'en'), origin).href);
  const japanese = escapeHtml(new URL(pagePath(page, 'ja'), origin).href);
  const canonical = locale === 'ja' ? japanese : english;
  const description = escapeHtml(translate(locale, PAGE_TEXT[page].description));
  return `
    <meta data-site-meta name="description" content="${description}" />
    <link data-site-meta rel="canonical" href="${canonical}" />
    <link data-site-meta rel="alternate" hreflang="en" href="${english}" />
    <link data-site-meta rel="alternate" hreflang="ja" href="${japanese}" />
    <link data-site-meta rel="alternate" hreflang="x-default" href="${english}" />`;
}

export function languageHtml(
  html: string,
  page: TranslatedPage,
  locale: Locale,
  origin: string,
): string {
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${locale}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(pageTitle(page, locale))}</title>`)
    .replace(/\s*<(?:meta|link) data-site-meta[^>]*>/g, '')
    .replace('</head>', `${metadataTags(page, locale, origin)}\n  </head>`);
}

export function updateDocumentMetadata(page: SitePage, origin: string): void {
  document.documentElement.lang = page.locale;
  for (const element of document.head.querySelectorAll('[data-site-meta]')) element.remove();
  if (page.kind === 'english') {
    document.title = 'Satyr by Seams | Ecommerce suite for cafés and pâtisseries';
    return;
  }
  document.title = pageTitle(page.page, page.locale);
  document.head.insertAdjacentHTML('beforeend', metadataTags(page.page, page.locale, origin));
}
