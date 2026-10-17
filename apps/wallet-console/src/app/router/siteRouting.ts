import { readFrontendSiteLinks } from '@/frontendConfig';

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

function toSiteAbsolutePath(pathOrHash: string): string {
  if (!pathOrHash) return '/';
  if (pathOrHash.startsWith('#')) return `${window.location.pathname}${pathOrHash}`;
  return pathOrHash.startsWith('/') ? pathOrHash : `/${pathOrHash}`;
}

export function maybeDocsHref(target: string): string | null {
  if (!target.startsWith(DOCS_PREFIX)) return null;
  const docsOrigin = getDocsOrigin();
  const suffix = target === DOCS_PREFIX ? '/' : target.slice(DOCS_PREFIX.length);
  return `${docsOrigin}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function resolveHref(target: string): string {
  if (isHttpUrl(target)) return target;

  if (target === '/wallet') return SITE_LINKS.walletPath;

  const docsHref = maybeDocsHref(target);
  if (docsHref) return docsHref;

  return toSiteAbsolutePath(target);
}

export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const clean = pathname.split('?')[0].split('#')[0];
  const normalized = clean.startsWith('/') ? clean : `/${clean}`;
  return stripTrailingSlash(normalized) || '/';
}
