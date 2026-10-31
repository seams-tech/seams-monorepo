import React from 'react';
import '@/app.css';
import { BrowserOnly } from './BrowserOnly';
import { useMarketingPage } from './context';
import { assertNeverWalletPage } from './i18n/locale';
import { WalletPage } from '@/pages/wallet/page';
import { PricingPage } from '@/pages/pricing/page';
import { FeaturesPage } from '@/pages/features/page';

async function loadContactModal() {
  const module = await import('@/components/contact/ContactModal');
  return { default: module.ContactModalHost };
}

const ContactModalHost = React.lazy(loadContactModal);

function MarketingPage(): React.JSX.Element {
  const { page } = useMarketingPage();
  switch (page) {
    case 'pricing':
      return <PricingPage />;
    case 'features':
      return <FeaturesPage />;
    case 'home':
      return <WalletPage />;
    default:
      return assertNeverWalletPage(page);
  }
}

// Every page opens the contact form while the URL hash is #contact.
export function WalletMarketingRoute(): React.JSX.Element {
  return (
    <>
      <MarketingPage />
      <BrowserOnly fallback={null}>
        <React.Suspense fallback={null}>
          <ContactModalHost />
        </React.Suspense>
      </BrowserOnly>
    </>
  );
}
