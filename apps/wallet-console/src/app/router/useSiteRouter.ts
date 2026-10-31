import type { SiteNavbarRouter } from '@seams-internal/site-navbar';
import { resolveHref } from './siteRouting';
import { useMarketingPage, type MarketingPageState } from '@/marketing/context';

function go(state: MarketingPageState, to: string): void {
  window.location.assign(resolveHref(state, to));
}

function linkProps(state: MarketingPageState, to: string): { href: string } {
  return { href: resolveHref(state, to) };
}

export function useSiteRouter(): SiteNavbarRouter {
  // The wallet page is a separate app. Let the server load each destination's app.
  const state = useMarketingPage();
  return { go: go.bind(null, state), linkProps: linkProps.bind(null, state) };
}

export default useSiteRouter;
