import React from 'react';
import { Slack, Store } from 'lucide-react';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import {
  DashboardWindow,
  H2SceneHero,
  IntegrationsWindow,
  type HeroScene,
} from '@/components/h2/SceneHero';
import { H2Bento, H2Cases, H2Cta, H2Footer } from '@/components/h2/sections';
import '@/styles/h2.css';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

/* Ecommerce Agents product page (ICP: commerce automation buyers), set like
   the wallet site: a split hero on the Harness field, then banner-headed
   bands for the workflows and the control plane. */

const heroScenes: readonly HeroScene[] = [
  { id: 'store', label: 'Store', icon: Store, view: <DashboardWindow /> },
  { id: 'approvals', label: 'Approvals', icon: Slack, view: <IntegrationsWindow /> },
];

export function EcommercePage(): React.JSX.Element {
  return (
    <div className="h2-page">
      <NavbarCompact />
      <div className="h2-col">
        <H2SceneHero
          titleId="h2-eco-hero-title"
          title="AI agents that run your store, inside policy"
          sub="The Seams Harness gives every agent its own identity and scoped credentials: limits, approvals, and expiry checked before anything executes, with an evidence trail for every decision."
          primary={{ label: 'Start building', to: '/docs/concepts/policy/mandates' }}
          secondary={{ label: 'Talk to us', to: CONTACT_LINK_TARGET }}
          field="mauve-ember"
          scenes={heroScenes}
        />
        <H2Cases />
        <H2Bento />
        <H2Cta audience="ecommerce" />
        <H2Footer faq="ecommerce" />
      </div>
    </div>
  );
}

export default EcommercePage;
