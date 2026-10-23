import React from 'react';
import { Fingerprint, PenLine, Slack, Store } from 'lucide-react';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import {
  DashboardWindow,
  H2SceneHero,
  IntegrationsWindow,
  WalletTransactionPreview,
  type HeroScene,
} from '@/components/h2/SceneHero';
import { SeamsAuthMenuMock } from '@/components/h2/SeamsAuthMenuMock';
import {
  H2Cta,
  H2Duo,
  H2Ecosystem,
  H2Footer,
  H2Pillars,
  H2Security,
} from '@/components/h2/sections';
import '@/styles/h2.css';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

/* Umbrella front page, set like the wallet site: a split hero that pages
   through both products on a moving gradient, then banner-headed bands that
   route each ICP to its page. */

const heroScenes: readonly HeroScene[] = [
  { id: 'wallet', label: 'Wallet', icon: Fingerprint, view: <SeamsAuthMenuMock /> },
  { id: 'store', label: 'Store', icon: Store, view: <DashboardWindow /> },
  { id: 'approvals', label: 'Approvals', icon: Slack, view: <IntegrationsWindow /> },
  { id: 'signing', label: 'Signing', icon: PenLine, view: <WalletTransactionPreview /> },
];

export function HomePage(): React.JSX.Element {
  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <H2SceneHero
          titleId="h2-home-title"
          title="Ecommerce on autopilot. Embedded wallets made simple."
          sub="Auth, wallets, credentials, and delegated access in one SDK. Policy checks every action before it runs."
          primary={{ label: 'Start building', to: '/docs/concepts/' }}
          secondary={{ label: 'Contact sales', to: CONTACT_LINK_TARGET }}
          field="teal-peach"
          scenes={heroScenes}
        />
        <H2Duo />
        <H2Ecosystem />
        <H2Pillars />
        <H2Security />
        <H2Cta audience="home" />
        <H2Footer faq="home" />
      </div>
    </div>
  );
}
