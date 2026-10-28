import React from 'react';
import { Brain, Croissant, Inbox, Slack, Store } from 'lucide-react';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import {
  H2SceneHero,
  IntegrationsWindow,
  PortalShot,
  type HeroScene,
} from '@/components/h2/SceneHero';
import {
  H2Bento,
  H2Cases,
  H2Cta,
  H2Footer,
  H2Pillars,
  H2Production,
} from '@/components/h2/sections';
import { startSiteAnchorScroll } from '@/app/router/siteRouting';
import '@/styles/h2.css';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

/* Satyr product page (ICP: café and pâtisserie owners), set like the wallet
   site: a split hero on a moving field, then banner-headed bands for the
   suite, the workflows, Satyr Kitchen and the approvals. Each band has an anchor
   (#suite, #workflows, #kitchen, #control) that the navbar and footer use. */

const heroScenes: readonly HeroScene[] = [
  {
    id: 'portal',
    label: 'Portal',
    icon: Store,
    view: (
      <PortalShot
        shot="agents"
        alt="The Agents page of the Satyr Portal: the café's merchant agent has a suggested change for review"
        className="h2-shot--card"
        eager
      />
    ),
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    icon: Brain,
    view: (
      <PortalShot
        shot="brain"
        alt="Satyr Knowledge: the memories that agents use, wait for review, or no longer use, on three rings"
        className="h2-shot--card"
      />
    ),
  },
  {
    id: 'inbox',
    label: 'Inbox',
    icon: Inbox,
    view: (
      <PortalShot
        shot="inbox-draft"
        alt="A reply that an agent drafted for a customer, with Approve and send, Edit and Reject"
        className="h2-shot--card h2-shot--tall"
      />
    ),
  },
  { id: 'slack', label: 'Slack', icon: Slack, view: <IntegrationsWindow /> },
  {
    id: 'kitchen',
    label: 'Kitchen',
    icon: Croissant,
    view: (
      <PortalShot
        shot="bakery-details"
        alt="Satyr Kitchen: a 3D view of the bakery with the details of one batch of financiers"
        className="h2-shot--card"
      />
    ),
  },
];

export function EcommercePage(): React.JSX.Element {
  React.useEffect(startSiteAnchorScroll, []);
  return (
    <div className="h2-page">
      <NavbarCompact />
      <div className="h2-col">
        <H2SceneHero
          titleId="h2-eco-hero-title"
          title="Agents that run your café’s shop, inside your rules"
          sub="Satyr connects the online shop, menus, payments, the inbox and the kitchen plan. Agents work with your team in Slack and in the Portal. Each change that matters waits for your approval, and every action leaves a receipt."
          primary={{ label: 'Talk to us', to: CONTACT_LINK_TARGET }}
          secondary={{ label: 'See the suite', to: '#suite' }}
          field="mauve-ember"
          scenes={heroScenes}
        />
        <H2Pillars link={false} />
        <H2Cases />
        <H2Production />
        <H2Bento />
        <H2Cta audience="ecommerce" />
        <H2Footer faq="ecommerce" />
      </div>
    </div>
  );
}

export default EcommercePage;
