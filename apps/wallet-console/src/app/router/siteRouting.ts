import { readFrontendSiteLinks } from '@/frontendConfig';
import { locale } from '@/marketing/i18n/browser';
import { walletLanguageUrl, walletPagePath, type Locale } from '@/marketing/i18n/locale';

const SITE_LINKS = readFrontendSiteLinks(import.meta.env);

const DOCS_PREFIX = '/docs';

function stripTrailingSlash(path: string): string {
  if (path.length <= 1) return path;
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function getDocsOrigin(): string {
  return stripTrailingSlash(SITE_LINKS.docsOrigin);
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

export function getWalletLanguageHref(language: Locale): string {
  return walletLanguageUrl(new URL(window.location.href), SITE_LINKS.walletPath, language);
}

function toSiteAbsolutePath(pathOrHash: string): string {
  if (!pathOrHash) return '/';
  if (pathOrHash.startsWith('#')) return `${window.location.pathname}${pathOrHash}`;
  return pathOrHash.startsWith('/') ? pathOrHash : `/${pathOrHash}`;
}

export function maybeDocsHref(target: string): string | null {
  if (!target.startsWith(DOCS_PREFIX)) return null;
  const docsOrigin = getDocsOrigin();
  const suffix = target === DOCS_PREFIX ? '/' : target.slice(DOCS_PREFIX.length);
  if (locale === 'ja' && normalizePathname(target) === DOCS_PREFIX) {
    return `${docsOrigin}/ja/${suffix.replace(/^\//, '')}`;
  }
  return `${docsOrigin}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function resolveHref(target: string): string {
  if (isHttpUrl(target)) return target;
  if (target.startsWith('#')) return toSiteAbsolutePath(target);

  if (normalizePathname(target) === '/wallet') {
    return walletLanguageUrl(
      new URL(target, window.location.origin),
      SITE_LINKS.walletPath,
      locale,
    );
  }

  const docsHref = maybeDocsHref(target);
  if (docsHref) return docsHref;

  const pathname = normalizePathname(target);
  switch (pathname) {
    case '/pricing': {
      const url = new URL(target, window.location.origin);
      return `${walletPagePath(SITE_LINKS.walletPath, 'pricing', locale)}${url.search}${url.hash}`;
    }
    case '/':
    case '/company':
    case '/ecommerce': {
      const base = SITE_LINKS.companyOrigin === '/' ? '' : SITE_LINKS.companyOrigin;
      if (locale === 'ja' && pathname === '/company') {
        const url = new URL(target, window.location.origin);
        return `${base}/ja${url.pathname}${url.search}${url.hash}`;
      }
      return `${base}${toSiteAbsolutePath(target)}`;
    }
    default:
      return toSiteAbsolutePath(target);
  }
}

export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const clean = pathname.split('?')[0].split('#')[0];
  const normalized = clean.startsWith('/') ? clean : `/${clean}`;
  return stripTrailingSlash(normalized) || '/';
}

function scrollToSiteAnchor(): void {
  const id = window.location.hash.slice(1);
  if (id) document.getElementById(id)?.scrollIntoView();
}

function unsubscribeFromSiteNavigation(listener: () => void): void {
  window.removeEventListener('popstate', listener);
  window.removeEventListener('hashchange', listener);
}

export function subscribeToSiteNavigation(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  return unsubscribeFromSiteNavigation.bind(null, listener);
}

export function startSiteAnchorScroll(): () => void {
  scrollToSiteAnchor();
  return subscribeToSiteNavigation(scrollToSiteAnchor);
}
