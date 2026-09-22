import React from 'react';

import { useSiteTheme } from '@/shared/hooks/useSiteTheme';
import { normalizePathname } from '@/app/router/siteRouting';
import { PAPER_LIGHT_COLORS } from '@/context/app-themes';

const HomePage = React.lazy(() =>
  import('@/pages/home2/page').then((module) => ({ default: module.HomePage })),
);
const Home2Page = React.lazy(() =>
  import('@/pages/home2/page').then((module) => ({ default: module.Home2Page })),
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
const ContactPage = React.lazy(() =>
  import('@/pages/contact/page').then((module) => ({ default: module.ContactPage })),
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

function DocumentThemeTokenBridge(): null {
  const { theme } = useSiteTheme();

  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-w3a-theme', theme);
    document.body.setAttribute('data-w3a-theme', theme);
    for (const [name, value] of Object.entries(PAPER_LIGHT_COLORS)) {
      root.style.setProperty(`--w3a-colors-${name}`, value);
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
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('site:navigate', onChange as EventListener);
    };
  }, [read]);

  return pathname;
}

export const App: React.FC = () => {
  const pathname = usePathname();

  const page = React.useMemo(() => {
    switch (pathname) {
      case '/':
        return <HomePage />;
      case '/home2':
        return <Home2Page />;
      case '/wallet':
        return <WalletProductRedirect />;
      case '/ecommerce':
        return <EcommercePage />;
      case '/pricing':
        return <PricingPage />;
      case '/company':
        return <CompanyPage />;
      case '/contact':
        return <ContactPage />;
      default:
        return <NotFoundPage />;
    }
  }, [pathname]);

  return (
    <>
      <DocumentThemeTokenBridge />
      <React.Suspense fallback={null}>{page}</React.Suspense>
    </>
  );
};

export default App;
