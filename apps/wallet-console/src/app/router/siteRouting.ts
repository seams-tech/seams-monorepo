import { FRONTEND_CONFIG } from '@/config';

const DOCS_PREFIX = '/docs';
const COMPANY_ROUTES = new Set(['/company', '/contact', '/ecommerce', '/pricing']);
const COMPANY_ORIGIN = String(import.meta.env.VITE_COMPANY_SITE_ORIGIN ?? '').replace(/\/$/, '');

function stripTrailingSlash(path: string): string {
  if (path.length <= 1) return path;
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function getSiteBase(): string {
  const base = FRONTEND_CONFIG.baseUrl;
  return stripTrailingSlash(base) || '/';
}

export function getDocsOrigin(): string {
  return stripTrailingSlash(FRONTEND_CONFIG.docsOrigin);
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function toSiteAbsolutePath(pathOrHash: string): string {
  if (!pathOrHash) return '/';
  if (pathOrHash.startsWith('#')) return `${window.location.pathname}${pathOrHash}`;
  const normalized = pathOrHash.startsWith('/') ? pathOrHash : `/${pathOrHash}`;
  const base = getSiteBase();
  if (base === '/') return normalized;
  return `${base}${normalized}`;
}

export function maybeDocsHref(target: string): string | null {
  if (!target.startsWith(DOCS_PREFIX)) return null;
  const docsOrigin = getDocsOrigin();
  const suffix = target === DOCS_PREFIX ? '/' : target.slice(DOCS_PREFIX.length);
  return `${docsOrigin}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function resolveHref(target: string): string {
  if (isHttpUrl(target)) return target;

  if (target === '/wallet') return getSiteBase();
  if (COMPANY_ROUTES.has(target)) {
    if (!COMPANY_ORIGIN) throw new Error('VITE_COMPANY_SITE_ORIGIN is required');
    return `${COMPANY_ORIGIN}${target}`;
  }

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
