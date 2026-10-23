import React from 'react';
import { ChevronLeft, ChevronRight, Slack, Store, Wallet } from 'lucide-react';
import { GrainField } from '@seams-internal/grain-field';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import {
  DashboardWindow,
  IntegrationsWindow,
  WalletTransactionPreview,
} from '@/components/h2/SceneHero';
import { PolicyFeed } from '@/components/h2/PolicyFeed';
import { SeamsAuthMenuMock } from '@/components/h2/SeamsAuthMenuMock';
import { useSiteRouter } from '@/app/router/useSiteRouter';
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

/* Umbrella front page: a simple headline, then a paged two-panel scene band
   showing the products (mock placeholders with the same footprint as the real
   screenshots/videos that will replace them), and the
   two-platforms split that routes each ICP to its page. */

type HeroWalletPreview =
  | {
      kind: 'createWallet';
      sub: string;
    }
  | {
      kind: 'transactionConfirm';
      sub: string;
    };

const createWalletPreview: HeroWalletPreview = {
  kind: 'createWallet',
  sub: 'Non-custodial wallets, opened with a passkey',
};

const transactionWalletPreview: HeroWalletPreview = {
  kind: 'transactionConfirm',
  sub: 'Review a demo transaction before signing',
};

function assertNever(value: never): never {
  throw new Error(`Unhandled hero wallet preview: ${String(value)}`);
}

function renderHeroWalletPreview(preview: HeroWalletPreview): React.JSX.Element {
  switch (preview.kind) {
    case 'createWallet':
      return <SeamsAuthMenuMock />;
    case 'transactionConfirm':
      return <WalletTransactionPreview sheet />;
    default:
      return assertNever(preview);
  }
}

/* ---------- hero: headline + paged scenes ---------- */

/* The headline panel is teal-peach in a wisp shape: peach wisps cross a
   sky blue on a diagonal above the headline, over deep blue at the lower
   left. */
const HOME_HERO_FIELD = 'teal-peach-wisp';

/* half the site pace and flow, so the field stays calm behind the headline
   and the wisps keep their shape */
const HOME_HERO_FIELD_PACE = 0.5;
const HOME_HERO_FIELD_FLOW = 0.5;

type HeroScene = {
  id: string;
  icon: React.ComponentType<{ 'aria-hidden'?: boolean }>;
  title: string;
  sub: string;
  left: React.ReactNode;
  wallet: HeroWalletPreview;
};

/* Left column pages through views of the agents product; the wallet shell
   stays fixed in the right column, like the reference hero's assistant card. */
const heroScenes: HeroScene[] = [
  {
    id: 'dashboard',
    icon: Store,
    title: 'Ecommerce Agents',
    sub: 'Agents run your store: limits, approvals, and audit built in',
    left: <DashboardWindow />,
    wallet: createWalletPreview,
  },
  {
    id: 'integrations',
    icon: Slack,
    title: 'Integrations',
    sub: 'Approvals land where your team already works',
    left: <IntegrationsWindow />,
    wallet: transactionWalletPreview,
  },
];

function HomeHeroCurrent(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const startProps = linkProps('/docs/concepts/');
  const contactProps = linkProps(CONTACT_LINK_TARGET);
  const agentsProps = linkProps('/ecommerce');
  const walletProps = linkProps('/wallet');
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
              <span className="h2-hero-simple__title-muted">Embedded wallets made simple.</span>
            </h1>
            <p className="h2-hero-simple__sub">
              Auth, wallets, credentials, and delegated access in one SDK. Policy checks every
              action before it runs.
            </p>
            <div className="h2-hero-simple__ctas">
              <a
                className="h2-btn h2-btn--primary h2-btn--lg"
                href={startProps.href}
                onClick={startProps.onClick}
              >
                Start building
              </a>
              <a
                className="h2-btn h2-btn--outline h2-btn--lg"
                href={contactProps.href}
                onClick={contactProps.onClick}
              >
                Contact sales
              </a>
            </div>
          </div>
          <PolicyFeed />
        </div>
      </header>

      <section className="h2-heroscene h2-rule" aria-label="Product tour">
        <div className="h2-heroscene__split">
          {/* whole panel navigates; the pager is a sibling so it stays clickable */}
          <a
            className="h2-heroscene__stage"
            href={agentsProps.href}
            onClick={agentsProps.onClick}
            aria-label="Explore Ecommerce Agents"
          >
            <div className="h2-heroscene__intro h2-fadein" key={`intro-${scene.id}`}>
              <span className="h2-heroscene__intro-icon" aria-hidden>
                <scene.icon />
              </span>
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
            href={walletProps.href}
            onClick={walletProps.onClick}
            aria-label="Explore Embedded Wallet"
          >
            {/* confirmer scene: the merchant app fills the panel, blurred and
                dimmed under the drawer like a live bottom sheet */}
            {scene.wallet.kind === 'transactionConfirm' ? (
              <div className="h2-heroscene__aside-appback h2-fadein" aria-hidden>
                <DashboardWindow />
              </div>
            ) : null}
            <div className="h2-heroscene__intro h2-fadein" key={`aside-intro-${scene.wallet.kind}`}>
              <span className="h2-heroscene__intro-icon" aria-hidden>
                <Wallet />
              </span>
              <div>
                <p className="h2-heroscene__intro-title">Embedded Wallet</p>
                <p className="h2-heroscene__intro-sub">{scene.wallet.sub}</p>
              </div>
            </div>
            <div
              className="h2-heroscene__aside-body h2-fadein h2-fadein--late"
              key={`wallet-${scene.wallet.kind}`}
            >
              {renderHeroWalletPreview(scene.wallet)}
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
        <H2Security />
        <H2Cta audience="home" />
        <H2Footer faq="home" />
      </div>
    </div>
  );
}
