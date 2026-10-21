import { pagePath, type Locale } from '@/i18n/locale';

const DOCS_PREFIX = '/docs';
const DOCS_ORIGIN = new URL(
  DOCS_PREFIX,
  String(import.meta.env.VITE_DOCS_ORIGIN || '').trim() || 'https://docs.localhost:4003/docs',
).href;

function stripTrailingSlash(path: string): string {
  if (path.length <= 1) return path;
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function getSiteBase(): string {
  const base = import.meta.env.BASE_URL || '/';
  return stripTrailingSlash(base) || '/';
}

export function getDocsOrigin(): string {
  return DOCS_ORIGIN;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function toSiteAbsolutePath(pathOrHash: string): string {
  if (!pathOrHash) return '/';
  if (pathOrHash.startsWith('#'))
    return `${window.location.pathname}${window.location.search}${pathOrHash}`;
  const normalized = pathOrHash.startsWith('/') ? pathOrHash : `/${pathOrHash}`;
  const base = getSiteBase();
  if (base === '/') return normalized;
  return `${base}${normalized}`;
}

export function maybeDocsHref(target: string, locale: Locale): string | null {
  if (!target.startsWith(DOCS_PREFIX)) return null;
  const docsOrigin = getDocsOrigin();
  const suffix = target === DOCS_PREFIX ? '/' : target.slice(DOCS_PREFIX.length);
  if (locale === 'ja' && normalizePathname(target) === DOCS_PREFIX) {
    return `${docsOrigin}/ja/${suffix.replace(/^\//, '')}`;
  }
  return `${docsOrigin}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function resolveHref(target: string, locale: Locale): string {
  if (isHttpUrl(target)) return target;

  const docsHref = maybeDocsHref(target, locale);
  if (docsHref) return docsHref;

  const url = new URL(target, window.location.origin);
  switch (normalizePathname(url.pathname)) {
    case '/pricing':
      return `${pagePath('pricing', locale)}${url.search}${url.hash}`;
    case '/company':
      return `${pagePath('company', locale)}${url.search}${url.hash}`;
    case '/wallet': {
      const wallet = new URL(
        import.meta.env.VITE_WALLET_SITE_ORIGIN || '/wallet/',
        window.location.origin,
      );
      const base = wallet.pathname.replace(/\/$/, '');
      wallet.pathname = locale === 'ja' ? `${base}/ja/` : `${base}/`;
      wallet.search = url.search;
      wallet.hash = url.hash;
      return wallet.href;
    }
  }

  return toSiteAbsolutePath(target);
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
  window.removeEventListener('site:navigate', listener);
  window.removeEventListener('popstate', listener);
  window.removeEventListener('hashchange', listener);
}

export function subscribeToSiteNavigation(listener: () => void): () => void {
  window.addEventListener('site:navigate', listener);
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  return unsubscribeFromSiteNavigation.bind(null, listener);
}

export function startSiteAnchorScroll(): () => void {
  scrollToSiteAnchor();
  return subscribeToSiteNavigation(scrollToSiteAnchor);
}
