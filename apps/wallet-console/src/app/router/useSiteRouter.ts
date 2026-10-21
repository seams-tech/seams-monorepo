import type { SiteNavbarRouter } from '@seams-internal/site-navbar';
import { resolveHref } from './siteRouting';

function go(to: string): void {
  window.location.assign(resolveHref(to));
}

function linkProps(to: string): { href: string } {
  return { href: resolveHref(to) };
}

export function useSiteRouter(): SiteNavbarRouter {
  // The wallet page is a separate app. Let the server load each destination's app.
  return { go, linkProps };
}

export default useSiteRouter;
