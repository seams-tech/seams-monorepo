import React from 'react';
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Home,
  LayoutDashboard,
  ListChecks,
  Lock,
  Smartphone,
  Users,
  Wallet,
} from 'lucide-react';
import { SeamsAuthMenuMock } from './SeamsAuthMenuMock';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import SeamsWordmark from '@/components/icons/SeamsWordmark';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import {
  H2Cta,
  H2Faq,
  H2Footer,
  H2Reasons,
  H2Security,
  H2Start,
} from '@/components/h2/sections';
import '@/styles/h2.css';

/* Wallet front page: a simple headline, then a paged two-panel scene band
   (mock placeholders with the same footprint as the real screenshots/videos
   that will replace them), then the three reasons to choose Seams: a $0
   start, open-source code with no lock-in, and wallets users do not lose. */

/* ---------- hero scene mocks (placeholders for real product imagery) ---------- */

/* The developer's side of the product: an app console where wallets,
   linked devices, and recoveries show up as users act. */
function WalletConsoleWindow(): React.JSX.Element {
  return (
    <div className="h2-window" role="img" aria-label="Seams wallet console overview">
      <div className="h2-window__side">
        <div className="h2-window__brand">
          <SeamsWordmark height={14} />
        </div>
        <div className="h2-window__navitem is-active">
          <Home aria-hidden /> Home
        </div>
        <div className="h2-window__navitem">
          <Users aria-hidden /> Users
        </div>
        <div className="h2-window__navitem">
          <Wallet aria-hidden /> Wallets
        </div>
        <div className="h2-window__navitem">
          <Smartphone aria-hidden /> Devices
        </div>
        <div className="h2-window__navitem">
          <ListChecks aria-hidden /> Policies
        </div>
      </div>
      <div className="h2-window__main">
        <p className="h2-window__title">App overview</p>
        <div className="h2-stats">
          <span className="h2-stat">
            <small>Active users</small>
            <strong>4,812</strong>
          </span>
          <span className="h2-stat">
            <small>Linked devices</small>
            <strong>7,306</strong>
          </span>
          <span className="h2-stat">
            <small>Recoveries</small>
            <strong>14</strong>
          </span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Wallet created
            <small>passkey · Face ID</small>
          </span>
          <span className="h2-chip h2-chip--green">Active</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            New device linked
            <small>laptop · QR code from phone</small>
          </span>
          <span className="h2-chip h2-chip--plain">Linked</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Account recovered
            <small>email code · new passkey added</small>
          </span>
          <span className="h2-chip h2-chip--green">Recovered</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Transfer over daily limit
            <small>0.8 ETH · waiting on owner approval</small>
          </span>
          <span className="h2-chip h2-chip--amber">Held</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Payment signed · Tempo
            <small>sig 0x8c31…f27</small>
          </span>
          <span className="h2-chip h2-chip--plain">Logged</span>
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
  sub: 'Users create a wallet with a passkey',
};

const transactionWalletPreview: HeroWalletPreview = {
  kind: 'transactionConfirm',
  sub: 'Users confirm each transaction with Face ID or Touch ID',
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

/* Left column shows the developer's console; the right column pages through
   what the app's users see: wallet creation, then transaction approval. */
const heroScenes: HeroScene[] = [
  {
    id: 'create',
    icon: LayoutDashboard,
    title: 'Wallet console',
    sub: 'Users, linked devices, and recovery in one place',
    left: <WalletConsoleWindow />,
    wallet: createWalletPreview,
  },
  {
    id: 'sign',
    icon: ListChecks,
    title: 'Programmable rules',
    sub: 'Limits and approvals run before every signature',
    left: <WalletConsoleWindow />,
    wallet: transactionWalletPreview,
  },
];

function HomeHeroCurrent(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const startProps = linkProps('/dashboard');
  const docsProps = linkProps('/docs/concepts/');
  const consoleProps = linkProps('/dashboard');
  const walletProps = linkProps('/wallet');
  const [page, setPage] = React.useState(0);
  const scene = heroScenes[page];

  return (
    <>
      <header className="h2-hero-simple h2-hero-simple--sage" aria-labelledby="h2-home-title">
        <div className="h2-shell">
          <p className="h2-kicker">Embedded wallets</p>
          <h1 id="h2-home-title" className="h2-display h2-hero-simple__title">
            Wallets you own.
          </h1>
          <p className="h2-hero-simple__sub">
            Give every user a passkey wallet with device linking and recovery. Start free on our
            cloud. The code is open source, so you are never locked in.
          </p>
          <div className="h2-hero-simple__ctas">
            <a
              className="h2-btn h2-btn--primary h2-btn--lg"
              href={startProps.href}
              onClick={startProps.onClick}
            >
              Start free
            </a>
            <a
              className="h2-btn h2-btn--outline h2-btn--lg"
              href={docsProps.href}
              onClick={docsProps.onClick}
            >
              Read the docs
            </a>
          </div>
          <p className="h2-hero-simple__note">
            Free for up to 300 monthly active users. Development is always free.
          </p>
        </div>
      </header>

      <section className="h2-heroscene h2-rule" aria-label="Product tour">
        <div className="h2-heroscene__split">
          {/* whole panel navigates; the pager is a sibling so it stays clickable */}
          <a
            className="h2-heroscene__stage"
            href={consoleProps.href}
            onClick={consoleProps.onClick}
            aria-label="Open the wallet console"
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
                <WalletConsoleWindow />
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
        <H2Reasons />
        <H2Security />
        <H2Start />
        <H2Faq audience="home" />
        <H2Cta />
        <H2Footer />
      </div>
    </div>
  );
}
