import React from 'react';
import {
  Bot,
  Box,
  ChevronLeft,
  ChevronRight,
  Hash,
  Home,
  ListChecks,
  Lock,
  ScrollText,
  ShieldCheck,
  Slack,
  Store,
  Wallet,
} from 'lucide-react';
import { SeamsAuthMenuMock } from './SeamsAuthMenuMock';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import SeamsWordmark from '@/components/icons/SeamsWordmark';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import {
  H2Cta,
  H2Duo,
  H2Ecosystem,
  H2Faq,
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

/* ---------- hero scene mocks (placeholders for real product imagery) ---------- */

function DashboardWindow(): React.JSX.Element {
  return (
    <div className="h2-window" role="img" aria-label="Seams merchant dashboard overview">
      <div className="h2-window__side">
        <div className="h2-window__brand">
          <SeamsWordmark height={14} />
        </div>
        <div className="h2-window__navitem is-active">
          <Home aria-hidden /> Home
        </div>
        <div className="h2-window__navitem">
          <Bot aria-hidden /> Agents
        </div>
        <div className="h2-window__navitem">
          <ListChecks aria-hidden /> Policies
        </div>
        <div className="h2-window__navitem">
          <ShieldCheck aria-hidden /> Approvals
        </div>
        <div className="h2-window__navitem">
          <ScrollText aria-hidden /> Audit
        </div>
      </div>
      <div className="h2-window__main">
        <p className="h2-window__title">Store overview</p>
        <div className="h2-stats">
          <span className="h2-stat">
            <small>Actions today</small>
            <strong>1,284</strong>
          </span>
          <span className="h2-stat">
            <small>Held for approval</small>
            <strong>3</strong>
          </span>
          <span className="h2-stat">
            <small>Agents active</small>
            <strong>2</strong>
          </span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Support agent (AI)
            <small>emails + refunds ≤ ¥10,000</small>
          </span>
          <span className="h2-chip h2-chip--green">Active</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Discount 12% · cart #8841
            <small>waiting on owner approval</small>
          </span>
          <span className="h2-chip h2-chip--amber">Held</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Restock order signed
            <small>sig 0x8c31…f27</small>
          </span>
          <span className="h2-chip h2-chip--plain">Logged</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Support inbox triaged
            <small>14 tickets · 2 escalated to owner</small>
          </span>
          <span className="h2-chip h2-chip--plain">Logged</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Price update · autumn catalog
            <small>runs 06:00 JST · within ±5% band</small>
          </span>
          <span className="h2-chip h2-chip--green">Scheduled</span>
        </div>
      </div>
    </div>
  );
}

function IntegrationsWindow(): React.JSX.Element {
  return (
    <div
      className="h2-window"
      role="img"
      aria-label="Approval request delivered to a Slack channel"
    >
      <div className="h2-window__side h2-window__side--slack">
        <div className="h2-window__brand">Kanda Goods</div>
        <div className="h2-window__navitem">
          <Hash aria-hidden /> general
        </div>
        <div className="h2-window__navitem is-active">
          <Hash aria-hidden /> store-ops
        </div>
        <div className="h2-window__navitem">
          <Hash aria-hidden /> support
        </div>
        <div className="h2-window__navitem">
          <Hash aria-hidden /> restocks
        </div>
      </div>
      <div className="h2-window__main">
        <p className="h2-window__title"># store-ops</p>
        <div className="h2-chat">
          <div className="h2-chat__bubble">
            <small>Seams Harness · APP · 09:14</small>
            Held for approval: support agent wants to send a 12% discount for cart #8841 (¥12,400).
            Policy: discounts over 10% need an owner.
          </div>
          <div className="h2-chat__bubble">
            <small>Seams Harness · APP · 09:14</small>
            Approve with your passkey to release the action.
          </div>
          <div className="h2-chat__bubble h2-chat__bubble--reply">
            Approved ✓ signed sig 0x8c31…f27, offer email sent
          </div>
          <div className="h2-chat__bubble">
            <small>Seams Harness · APP · 09:31</small>
            Daily digest: 1,284 actions inside policy, 3 held, 0 declined. Full audit trail on the
            dashboard.
          </div>
        </div>
      </div>
    </div>
  );
}

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

/* The signing drawer carries the scene as an HTML replica of the confirmer,
   showing a multi-step escrow release. Behind it, the merchant dashboard
   sits blurred and dimmed, the way the drawer actually overlays an app. */
function WalletTransactionPreview(): React.JSX.Element {
  return (
    <div
      className="h2-wallet-confirm"
      role="img"
      aria-label="Transaction confirmer drawer preview: escrow release for an order"
    >
      <div className="h2-wallet-confirm__card h2-wallet-confirm__card--front h2-txmock">
        <span className="h2-txmock__handle" />
        <p className="h2-txmock__title">Review transaction</p>
        <p className="h2-txmock__meta">
          <Lock aria-hidden /> localhost
          <Box aria-hidden /> Tempo | ChainID: 42431
        </p>
        <p className="h2-txmock__desc">Release escrow for order #8841: delivery confirmed.</p>
        <div className="h2-txmock__tree">
          <p>
            Transaction to contract <strong className="h2-txmock__addr">0xE5C7...F204</strong>
          </p>
          <p className="h2-txmock__step">
            Calling <strong>verifyDelivery()</strong>
            <span className="h2-txmock__args">{'{ "trackingId": "YMT-2984-8841" }'}</span>
          </p>
          <p className="h2-txmock__step">
            Calling <strong>swapUsdcToJpyc()</strong>
            <span className="h2-txmock__args">{'{ "rate": "155.2", "maxSlippage": "0.5%" }'}</span>
          </p>
          <p className="h2-txmock__step">
            Calling <strong>releaseEscrow()</strong>
            <span className="h2-txmock__args">
              {'{ "orderId": "#8841", "amount": 12_400, "currency": "JPYC" }'}
            </span>
          </p>
          <p className="h2-txmock__step">
            Calling <strong>closeOrder()</strong> using 180k gas
          </p>
        </div>
        <div className="h2-txmock__actions">
          <span className="h2-txmock__btn h2-txmock__btn--ghost">Cancel</span>
          <span className="h2-txmock__btn h2-txmock__btn--solid">Confirm</span>
        </div>
      </div>
    </div>
  );
}

function renderHeroWalletPreview(preview: HeroWalletPreview): React.JSX.Element {
  switch (preview.kind) {
    case 'createWallet':
      return <SeamsAuthMenuMock />;
    case 'transactionConfirm':
      return <WalletTransactionPreview />;
    default:
      return assertNever(preview);
  }
}

/* ---------- hero: headline + paged scenes ---------- */

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
      <header className="h2-hero-simple h2-hero-simple--sage" aria-labelledby="h2-home-title">
        <div className="h2-shell">
          <h1 id="h2-home-title" className="h2-display h2-hero-simple__title">
            Ecommerce on autopilot. Embedded wallets made simple.
          </h1>
          <p className="h2-hero-simple__sub">
            Auth, wallets, credentials, and delegated access in one SDK. Policy checks every action
            before it runs.
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
        <H2Faq audience="home" />
        <H2Cta />
        <H2Footer />
      </div>
    </div>
  );
}
