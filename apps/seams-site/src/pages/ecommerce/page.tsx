import React from 'react';
import { Activity, Croissant, Inbox, Slack, Store } from 'lucide-react';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { ovenArmScene, rackRunnerScene } from '@/components/h2/ink/bakeryRobotScenes';
import { InkDrawing } from '@/components/h2/ink/InkScene';
import { goatWalkScene } from '@/components/h2/ink/ledRobotScene';
import { cobotScene, windScene } from '@/components/h2/ink/scenes';
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
import { useSiteCopy } from '@/i18n/browser';
import type { SiteCopy } from '@/i18n/siteCopy';
import '@/styles/h2.css';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

/* Satyr product page (ICP: café and pâtisserie owners), set like the wallet
   site: a split hero on a moving field, then banner-headed bands for the
   suite, the workflows, Satyr Kitchen and the approvals, each with its own ink
   drawing. Each band has an anchor
   (#suite, #workflows, #kitchen, #control) that the navbar and footer use. */

function getHeroScenes(copy: SiteCopy): readonly HeroScene[] {
  const views = copy.ecommerceHero.views;
  return [
    {
      id: 'portal',
      label: views.portal.label,
      icon: Store,
      view: <PortalShot shot="agents" alt={views.portal.alt} className="h2-shot--card" eager />,
    },
    {
      id: 'activity',
      label: views.activity.label,
      icon: Activity,
      view: <PortalShot shot="activity" alt={views.activity.alt} className="h2-shot--card" />,
    },
    {
      id: 'inbox',
      label: views.inbox.label,
      icon: Inbox,
      view: (
        <PortalShot
          shot="inbox-draft"
          alt={views.inbox.alt}
          className="h2-shot--card h2-shot--tall"
        />
      ),
    },
    { id: 'slack', label: views.slack.label, icon: Slack, view: <IntegrationsWindow /> },
    {
      id: 'kitchen',
      label: views.kitchen.label,
      icon: Croissant,
      view: <PortalShot shot="bakery-details" alt={views.kitchen.alt} className="h2-shot--card" />,
    },
  ];
}

export function EcommercePage(): React.JSX.Element {
  React.useEffect(startSiteAnchorScroll, []);
  const copy = useSiteCopy();
  const heroScenes = React.useMemo(() => getHeroScenes(copy), [copy]);
  return (
    <div className="h2-page">
      <NavbarCompact />
      <div className="h2-col">
        <H2SceneHero
          titleId="h2-eco-hero-title"
          title={copy.ecommerceHero.title}
          sub={copy.ecommerceHero.sub}
          primary={{ label: copy.common.talkToUs, to: CONTACT_LINK_TARGET }}
          secondary={{ label: copy.ecommerceHero.secondary, to: '#suite' }}
          field="mauve-ember"
          scenes={heroScenes}
        />
        <H2Pillars
          link={false}
          drawing={<InkDrawing scene={windScene} className="h2-ink--banner" />}
        />
        <H2Cases drawing={<InkDrawing scene={rackRunnerScene} className="h2-ink--banner" />} />
        <H2Production drawing={<InkDrawing scene={cobotScene} className="h2-ink--banner" />} />
        <H2Bento drawing={<InkDrawing scene={ovenArmScene} className="h2-ink--banner" />} />
        <H2Cta
          audience="ecommerce"
          drawing={
            <InkDrawing scene={goatWalkScene} className="h2-ink--banner h2-ink--beside-actions" />
          }
        />
        <H2Footer faq="ecommerce" />
      </div>
    </div>
  );
}

export default EcommercePage;
