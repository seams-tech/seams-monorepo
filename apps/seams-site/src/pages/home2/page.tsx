import React from 'react';
import { ChevronLeft, ChevronRight, Croissant, Slack, Store } from 'lucide-react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { DashboardWindow, IntegrationsWindow, ProductionRunMock } from '@/components/h2/SceneHero';
import { ShopOpsFeed } from '@/components/h2/ShopOpsFeed';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import {
  FieldTile,
  H2Cta,
  H2Duo,
  H2Ecosystem,
  H2Footer,
  H2Pillars,
  H2WalletBand,
} from '@/components/h2/sections';
import '@/styles/h2.css';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

/* Umbrella front page, led by Satyr: a simple headline over a café's live
   feed, then a paged two-panel scene band (Satyr's views at the left,
   BakeryOS at the right), the shop-to-oven split, the suite, and one band
   for Seams Wallet. The scenes are mock placeholders with the same footprint
   as the real screenshots/videos that will replace them. */

/* ---------- hero: headline + paged scenes ---------- */

/* The headline panel is teal-peach in a wisp shape: pink-peach wisps
   cross cerulean on a diagonal above the headline, over a deeper blue at
   the lower left. */
const HOME_HERO_FIELD = 'teal-peach-wisp';

/* half the site pace and flow, so the field stays calm behind the headline
   and the wisps keep their shape */
const HOME_HERO_FIELD_PACE = 0.5;
const HOME_HERO_FIELD_FLOW = 0.5;

type HeroScene = {
  id: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  field: GrainFieldName;
  title: string;
  sub: string;
  left: React.ReactNode;
};

/* Left column pages through Satyr's views; the BakeryOS plan stays fixed in
   the right column, like the reference hero's assistant card. */
const heroScenes: HeroScene[] = [
  {
    id: 'portal',
    icon: Store,
    field: 'azure-coral',
    title: 'Satyr',
    sub: 'Agents run the shop, the orders and the inbox',
    left: <DashboardWindow />,
  },
  {
    id: 'slack',
    icon: Slack,
    field: 'mauve-ember',
    title: 'Satyr in Slack',
    sub: 'Approvals land where your team already works',
    left: <IntegrationsWindow />,
  },
];

function HomeHeroCurrent(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const contactProps = linkProps(CONTACT_LINK_TARGET);
  const satyrProps = linkProps('/ecommerce');
  const bakeryProps = linkProps('/ecommerce#bakeryos');
  const [page, setPage] = React.useState(0);
  const scene = heroScenes[page];

  return (
    <>
      <header className="h2-hero-simple h2-hero-simple--panel" aria-labelledby="h2-home-title">
        <div className="h2-shell">
          <GrainField
            field={HOME_HERO_FIELD}
            flow={HOME_HERO_FIELD_FLOW}
            pace={HOME_HERO_FIELD_PACE}
          />
          <div className="h2-hero-simple__copy">
            <h1 id="h2-home-title" className="h2-display h2-hero-simple__title">
              <span>Ecommerce on autopilot.</span>{' '}
              <span className="h2-hero-simple__title-muted">For cafés and pâtisseries.</span>
            </h1>
            <p className="h2-hero-simple__sub">
              Satyr agents run the online shop, the inbox and the bake plan. They work with your
              team in Slack, and each change that matters waits for your approval.
            </p>
            <div className="h2-hero-simple__ctas">
              <a
                className="h2-btn h2-btn--primary h2-btn--lg"
                href={contactProps.href}
                onClick={contactProps.onClick}
              >
                Talk to us
              </a>
              <a
                className="h2-btn h2-btn--outline h2-btn--lg"
                href={satyrProps.href}
                onClick={satyrProps.onClick}
              >
                Explore Satyr
              </a>
            </div>
          </div>
          <ShopOpsFeed />
        </div>
      </header>

      <section className="h2-heroscene h2-rule" aria-label="Product tour">
        <div className="h2-heroscene__split">
          {/* whole panel navigates; the pager is a sibling so it stays clickable */}
          <a
            className="h2-heroscene__stage"
            href={satyrProps.href}
            onClick={satyrProps.onClick}
            aria-label="Explore Satyr"
          >
            <div className="h2-heroscene__intro h2-fadein" key={`intro-${scene.id}`}>
              <FieldTile field={scene.field} icon={scene.icon} />
              <div>
                <p className="h2-heroscene__intro-title">{scene.title}</p>
                <p className="h2-heroscene__intro-sub">{scene.sub}</p>
              </div>
            </div>
            <div
              className="h2-heroscene__frame h2-fadein h2-fadein--late"
              key={`frame-${scene.id}`}
            >
              {scene.left}
            </div>
          </a>

          <a
            className="h2-heroscene__aside"
            href={bakeryProps.href}
            onClick={bakeryProps.onClick}
            aria-label="Explore BakeryOS"
          >
            <div className="h2-heroscene__intro">
              <FieldTile field="apricot-beam" icon={Croissant} />
              <div>
                <p className="h2-heroscene__intro-title">BakeryOS</p>
                <p className="h2-heroscene__intro-sub">Orders become a bake plan for the kitchen</p>
              </div>
            </div>
            <div className="h2-heroscene__aside-body">
              <ProductionRunMock />
            </div>
          </a>

          {/* Pager sits on the divider/border junction, like the demo hero's */}
          <div className="h2-pager" role="group" aria-label="Product views">
            <button
              type="button"
              className="h2-pager__btn"
              aria-label="Previous product view"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft aria-hidden />
            </button>
            <span className="h2-pager__dots">
              {heroScenes.map((s, i) => (
                <span
                  key={s.id}
                  className={`h2-pager__dot${i === page ? ' is-active' : ''}`}
                  title={s.title}
                />
              ))}
            </span>
            <button
              type="button"
              className="h2-pager__btn"
              aria-label="Next product view"
              disabled={page >= heroScenes.length - 1}
              onClick={() => setPage((p) => Math.min(heroScenes.length - 1, p + 1))}
            >
              <ChevronRight aria-hidden />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

export function HomePage(): React.JSX.Element {
  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <HomeHeroCurrent />
        <H2Duo />
        <H2Ecosystem />
        <H2Pillars />
        <H2WalletBand />
        <H2Cta audience="home" />
        <H2Footer faq="home" />
      </div>
    </div>
  );
}
