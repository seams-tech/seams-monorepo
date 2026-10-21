import * as React from 'react';
import { isHttpUrl, resolveHref } from './siteRouting';
import { useLocale } from '@/i18n/browser';

type GoFn = (to: string) => void;

export function isModifiedClick(e: React.MouseEvent<HTMLElement>): boolean {
  return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

function navigateInternal(href: string): void {
  const currentHref = window.location.pathname + window.location.search + window.location.hash;
  const target = new URL(href, window.location.origin);

  if (currentHref === href) {
    // A hash link must act even when the URL already has its hash, e.g. a
    // #contact link while the URL ends in #contact but the modal is closed.
    if (target.hash) window.dispatchEvent(new Event('site:navigate'));
    // Allow same-route nav clicks (for routes like /pricing) to reset scroll.
    else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    return;
  }

  window.history.pushState({}, '', href);
  window.dispatchEvent(new Event('site:navigate'));
  if (!target.hash) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function requiresDocumentNavigation(href: string): boolean {
  if (isHttpUrl(href)) return true;
  const pathname = new URL(href, window.location.origin).pathname;
  return pathname === '/dashboard' || pathname.startsWith('/dashboard/');
}

export function useSiteRouter(): {
  go: GoFn;
  linkProps: (to: string) => {
    href: string;
    onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  };
} {
  const locale = useLocale();
  const go = React.useCallback<GoFn>(
    (to: string) => {
      const href = resolveHref(to, locale);
      if (requiresDocumentNavigation(href)) {
        window.location.href = href;
        return;
      }
      navigateInternal(href);
    },
    [locale],
  );

  const linkProps = React.useCallback(
    (to: string) => {
      const href = resolveHref(to, locale);
      return {
        href,
        onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
          if (isModifiedClick(e)) return;
          const target = (e.currentTarget.getAttribute('target') || '').toLowerCase();
          if (target && target !== '_self') return;
          if (requiresDocumentNavigation(href)) return;
          e.preventDefault();
          navigateInternal(href);
        },
      };
    },
    [locale],
  );

  return { go, linkProps };
}

export default useSiteRouter;
