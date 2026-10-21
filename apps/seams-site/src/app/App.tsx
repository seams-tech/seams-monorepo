import React from 'react';

import { useSiteTheme } from '@/shared/hooks/useSiteTheme';
import { normalizePathname } from '@/app/router/siteRouting';
import { PAPER_LIGHT_COLORS } from '@/context/app-themes';
import { ContactModalHost } from '@/components/contact/ContactModal';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';
import { SitePageContext } from '@/i18n/browser';
import { parseSitePage } from '@/i18n/locale';
import { updateDocumentMetadata } from '@/i18n/metadata';
import '@/i18n/styles.css';

const HomePage = React.lazy(() =>
  import('@/pages/home2/page').then((module) => ({ default: module.HomePage })),
);
const EcommercePage = React.lazy(() =>
  import('@/pages/ecommerce/page').then((module) => ({ default: module.EcommercePage })),
);
const PricingPage = React.lazy(() =>
  import('@/pages/pricing/page').then((module) => ({ default: module.PricingPage })),
);
const CompanyPage = React.lazy(() =>
  import('@/pages/company/page').then((module) => ({ default: module.CompanyPage })),
);
const NotFoundPage = React.lazy(() =>
  import('@/pages/not-found/page').then((module) => ({ default: module.NotFoundPage })),
);

function WalletProductRedirect(): React.JSX.Element {
  React.useEffect(() => {
    const walletSiteOrigin = String(import.meta.env.VITE_WALLET_SITE_ORIGIN ?? '').trim();
    if (!walletSiteOrigin) throw new Error('VITE_WALLET_SITE_ORIGIN is required');
    window.location.replace(walletSiteOrigin);
  }, []);
  return <></>;
}

/* The contact page became a modal; old links open it over the home page. */
function ContactRedirect(): null {
  React.useEffect(() => {
    window.history.replaceState(window.history.state, '', `/${CONTACT_LINK_TARGET}`);
    window.dispatchEvent(new Event('site:navigate'));
  }, []);
  return null;
}

function DocumentThemeTokenBridge(): null {
  const { theme } = useSiteTheme();

  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-seams-theme', theme);
    document.body.setAttribute('data-seams-theme', theme);
    for (const [name, value] of Object.entries(PAPER_LIGHT_COLORS)) {
      root.style.setProperty(`--seams-colors-${name}`, value);
    }
  }, [theme]);

  return null;
}

function usePathname(): string {
  const read = React.useCallback(() => {
    if (typeof window === 'undefined') return '/';
    return normalizePathname(window.location.pathname);
  }, []);
  const [pathname, setPathname] = React.useState<string>(read);

  React.useEffect(() => {
    const onChange = () => setPathname(read());
    window.addEventListener('popstate', onChange);
    window.addEventListener('site:navigate', onChange as EventListener);
    // a redirect can change the URL before this listener is attached
    onChange();
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('site:navigate', onChange as EventListener);
    };
  }, [read]);

  return pathname;
}

export const App: React.FC = () => {
  const pathname = usePathname();
  const sitePage = React.useMemo(() => parseSitePage(pathname), [pathname]);
  const route = sitePage.kind === 'translated' ? `/${sitePage.page}` : pathname;

  React.useEffect(() => {
    updateDocumentMetadata(sitePage, import.meta.env.VITE_SITE_ORIGIN || 'https://seams.sh/');
  }, [sitePage]);

  const page = React.useMemo(() => {
    switch (route) {
      case '/':
        return <HomePage />;
      case '/wallet':
        return <WalletProductRedirect />;
      case '/ecommerce':
        return <EcommercePage />;
      case '/pricing':
        return <PricingPage />;
      case '/company':
        return <CompanyPage />;
      case '/contact':
        return <ContactRedirect />;
      default:
        return <NotFoundPage />;
    }
  }, [route]);

  return (
    <SitePageContext.Provider value={sitePage}>
      <DocumentThemeTokenBridge />
      <React.Suspense fallback={null}>{page}</React.Suspense>
      <ContactModalHost />
    </SitePageContext.Provider>
  );
};

export default App;
