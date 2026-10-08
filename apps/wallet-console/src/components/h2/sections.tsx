import React from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  KeyRound,
  ListChecks,
  ScrollText,
  Server,
  Share2,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { Theme, useSeams, type HostedAuthMenuMode } from '@seams/wallet/react';
import SeamsWordmark from '@/components/icons/SeamsWordmark';
import { EcosystemLattice } from '@/components/h2/EcosystemLattice';
import { WalletFigure, type WalletFigureName } from '@/components/h2/WalletFigure';
import { NETWORK_MARKS, NetworkMarkLockup } from '@/components/icons/NetworkMarks';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import {
  DEMO_THEME_PRESETS,
  demoIframeAppearance,
  demoReactTokens,
  type DemoThemeId,
} from '@/context/app-themes';
import '@/styles/h2.css';

/* Shared section library for the h2 marketing pages (/, /wallet, /ecommerce).
   Every component renders inside a `.h2-page > .h2-col` wrapper and styles
   itself from src/styles/h2.css. */

// Defer the live passkey demo until after first paint/idle.
const DemoPasskeyColumnLazy = React.lazy(() =>
  import('@/components/DemoPasskeyColumn').then((m) => ({ default: m.DemoPasskeyColumn })),
);

/* ---------- demo hero (headline left, live product right) ---------- */

const demoPageNames = ['Login', 'Transactions', 'Account recovery'];

/* Compact product forks under the CTAs. Chips reuse the case-cover gradients
   so each product keeps one fabric. */
const productForks = [
  { label: 'Wallet', to: '/wallet', chip: 'h2-fork__chip--wallet' },
  { label: 'Harness', to: 'https://seams.sh/ecommerce', chip: 'h2-fork__chip--harness' },
  { label: 'API', to: '/docs/concepts/', chip: 'h2-fork__chip--api' },
];

/* Grab-and-drag horizontal scrolling for a single-line chip row. Dragging only
   engages past a small threshold, so a plain click still selects a chip; the
   click that trails a real drag is swallowed on the way up. */
function useDragScroll<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = React.useRef<T>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startScroll = 0;
    let down = false;
    let dragging = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      down = true;
      dragging = false;
      startX = event.clientX;
      startScroll = el.scrollLeft;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!down) return;
      const dx = event.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < 4) return;
        dragging = true;
        el.classList.add('is-dragging');
        el.setPointerCapture(event.pointerId);
      }
      el.scrollLeft = startScroll - dx;
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (dragging) {
        const swallowClick = (click: MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        el.addEventListener('click', swallowClick, true);
        window.setTimeout(() => el.removeEventListener('click', swallowClick, true), 0);
      }
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      down = false;
      dragging = false;
      el.classList.remove('is-dragging');
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
    };
  }, []);

  return ref;
}

export type H2DemoHeroProps = {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  authDefaultModeWhenNoDetectedAccount?: HostedAuthMenuMode;
};

export function H2DemoHero({
  title = (
    <>
      {/* non-breaking hyphen keeps "policy-based" on one line */}
      Secure commerce accounts with policy{'‑'}based permissions
    </>
  ),
  sub = (
    <>
      One SDK for authentication, wallets, credentials, and delegated access, wherever people and AI
      agents act on your store. Register with a passkey right here and you have a working account:
      wallet included, recovery built in, every action signed.
    </>
  ),
  authDefaultModeWhenNoDetectedAccount,
}: H2DemoHeroProps = {}): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const { seams, loginState } = useSeams();
  const [demoPage, setDemoPage] = React.useState(0);
  const [demoTheme, setDemoTheme] = React.useState<DemoThemeId>('paper');
  const themeTrackRef = useDragScroll<HTMLDivElement>();
  const activePreset =
    DEMO_THEME_PRESETS.find((theme) => theme.id === demoTheme) ?? DEMO_THEME_PRESETS[0];
  const activeWalletId = loginState?.isLoggedIn ? loginState.walletId || '' : '';
  const startProps = linkProps('/docs/');
  const authProps = linkProps('/docs/guides/authentication');

  React.useEffect(() => {
    try {
      seams.setAppearance(demoIframeAppearance(activePreset));
    } catch {}
  }, [seams, activePreset, loginState?.isLoggedIn, activeWalletId]);

  // The Transactions / Account recovery screens need an unlocked wallet,
  // mirroring the carousel's own page gating.
  const maxPage = loginState?.isLoggedIn ? demoPageNames.length - 1 : 0;

  return (
    <header className="h2-hero" aria-labelledby="h2-hero-title">
      <div className="h2-hero__split">
        <div className="h2-hero__main">
          <h1 id="h2-hero-title" className="h2-display h2-hero__title">
            {title}
          </h1>
          <p className="h2-hero__sub">{sub}</p>
          <div className="h2-hero__ctas">
            <a
              className="h2-btn h2-btn--primary h2-btn--lg"
              href={startProps.href}
              onClick={startProps.onClick}
            >
              Start building
            </a>
            <a className="h2-btn h2-btn--outline" href={authProps.href} onClick={authProps.onClick}>
              How auth works
            </a>
          </div>
          <div className="h2-hero__forks" aria-label="Products">
            {productForks.map((fork) => {
              const forkProps = linkProps(fork.to);
              return (
                <a
                  key={fork.label}
                  className="h2-fork"
                  href={forkProps.href}
                  onClick={forkProps.onClick}
                >
                  <span className={`h2-fork__chip ${fork.chip}`} aria-hidden />
                  {fork.label}
                </a>
              );
            })}
          </div>
        </div>

        <div className="h2-hero__demo">
          <p className="h2-demo-label">Live Demo</p>
          <Theme
            theme={activePreset.mode}
            tokens={demoReactTokens(activePreset)}
            tag="div"
            className="h2-demo-theme-root"
            style={{ display: 'contents' }}
          >
            {/* SDK card renders in its own px; scoped scaling keeps the designed
                hero proportion now that the page-level zoom is gone */}
            <div className="h2-sdk-zoom">
              <React.Suspense fallback={<div className="h2-demo__placeholder" />}>
                <DemoPasskeyColumnLazy
                  currentPage={demoPage}
                  onCurrentPageChange={setDemoPage}
                  defaultModeWhenNoDetectedAccount={authDefaultModeWhenNoDetectedAccount}
                />
              </React.Suspense>
            </div>
          </Theme>
          <div className="h2-themeswitch">
            <span className="h2-themeswitch__label">Themes</span>
            <div
              ref={themeTrackRef}
              className="h2-themeswitch__track"
              role="group"
              aria-label="Preview theme"
            >
              {DEMO_THEME_PRESETS.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={`h2-themeswitch__btn${demoTheme === theme.id ? ' is-active' : ''}`}
                  aria-pressed={demoTheme === theme.id}
                  onClick={() => setDemoTheme(theme.id)}
                >
                  <span className="h2-themeswitch__swatch" style={{ background: theme.swatch }} />
                  {theme.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Pager lives at the split level so it sits on the divider/border junction */}
        <div className="h2-pager" role="group" aria-label="Demo screens">
          <button
            type="button"
            className="h2-pager__btn"
            aria-label="Previous demo screen"
            disabled={demoPage === 0}
            onClick={() => setDemoPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft aria-hidden />
          </button>
          <span className="h2-pager__dots">
            {demoPageNames.map((name, i) => (
              <span
                key={name}
                className={`h2-pager__dot${i === demoPage ? ' is-active' : ''}`}
                title={name}
              />
            ))}
          </span>
          <button
            type="button"
            className="h2-pager__btn"
            aria-label="Next demo screen"
            disabled={demoPage >= maxPage}
            onClick={() => setDemoPage((p) => Math.min(maxPage, p + 1))}
          >
            <ChevronRight aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------- ecosystem (commerce-stack lattice + networks) ---------- */

export function H2Ecosystem(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const docsProps = linkProps('/docs/concepts/');

  return (
    <section className="h2-section h2-rule" aria-labelledby="h2-eco-title">
      <div className="h2-shell">
        <div className="h2-eco__head">
          <div>
            <p className="h2-kicker" style={{ marginBottom: 11 }}>
              Ecosystem
            </p>
            <h2 id="h2-eco-title" className="h2-display h2-eco__title">
              Plugs into the tools stores already run
            </h2>
            <p className="h2-eco__copy">
              Storefronts, payments, messaging, and support, connected through scoped credentials,
              so every action stays inside policy.
            </p>
          </div>
          <a className="h2-btn h2-btn--outline" href={docsProps.href} onClick={docsProps.onClick}>
            Read the docs
          </a>
        </div>
        <EcosystemLattice />
      </div>
    </section>
  );
}

export function H2Networks(): React.JSX.Element {
  return (
    <section className="h2-section h2-rule h2-logos" aria-label="Supported networks">
      <div className="h2-shell">
        <div className="h2-logos__row" aria-label="Supported networks">
          {NETWORK_MARKS.map((mark) => (
            <span key={mark.name} className="h2-logo">
              <NetworkMarkLockup mark={mark} />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- wallet UI showcase (the SDK's own surfaces on sample data) ---------- */

/* Each frame is a separate page under showcase/ that renders the installed
   SDK release's wallet UI on sample data, so the page shows what ships. The
   pages sit under the app's base path, which is not the site root locally. */
const showcaseViews = [
  {
    title: 'Transaction confirmer',
    copy: 'Every signature starts with a review your users can read: amount, recipient, network and fee, approved with their passkey. A receipt then follows the transaction until the network confirms it.',
    frame: `${import.meta.env.BASE_URL}showcase/transaction/`,
    frameTitle: 'Transaction confirmer demo',
  },
  {
    title: 'Your review, then the wallet',
    copy: 'Render your own checkout inside the wallet modal. When the buyer confirms, the same dialog hands off to the wallet approval, in your brand colors.',
    frame: `${import.meta.env.BASE_URL}showcase/checkout/`,
    frameTitle: 'Custom review demo',
  },
];

/* Copy and tabs on the left, like the custody section; the demo stage on the
   right, like the hero's. The stage only changes on request: each view is a
   live demo, and paging it away mid-click would lose the user's place. */
export function H2Showcase(): React.JSX.Element {
  const [view, setView] = React.useState(0);
  const step = (delta: number) =>
    setView((current) => (current + delta + showcaseViews.length) % showcaseViews.length);

  return (
    <section className="h2-rule h2-showcase__split" aria-labelledby="h2-showcase-title">
      <div className="h2-showcase__main">
        <h2 id="h2-showcase-title" className="h2-display h2-security__title">
          What your users see when they approve
        </h2>
        <p className="h2-showcase__copy">
          These are the wallet&rsquo;s own screens running on sample data. Click through them;
          nothing is signed or sent.
        </p>
        {showcaseViews.map((item, i) => (
          <button
            key={item.frame}
            type="button"
            className={`h2-security__item h2-showcase__item${i === view ? ' is-active' : ''}`}
            aria-pressed={i === view}
            onClick={() => setView(i)}
          >
            <h3>{item.title}</h3>
            <p>{item.copy}</p>
          </button>
        ))}
      </div>
      <div className="h2-showcase__stage">
        {showcaseViews.map((item, i) => (
          <div
            key={item.frame}
            className={`h2-showcase__view${i === view ? ' is-active' : ''}`}
            aria-hidden={i !== view}
          >
            <iframe
              className="h2-showcase__frame"
              src={item.frame}
              title={item.frameTitle}
              loading="lazy"
              tabIndex={i === view ? undefined : -1}
            />
          </div>
        ))}
      </div>
      <div className="h2-pager" role="group" aria-label="Wallet screens">
        <button
          type="button"
          className="h2-pager__btn"
          aria-label="Previous wallet screen"
          onClick={() => step(-1)}
        >
          <ChevronLeft aria-hidden />
        </button>
        <span className="h2-pager__dots">
          {showcaseViews.map((item, i) => (
            <span
              key={item.frame}
              className={`h2-pager__dot${i === view ? ' is-active' : ''}`}
              title={item.title}
            />
          ))}
        </span>
        <button
          type="button"
          className="h2-pager__btn"
          aria-label="Next wallet screen"
          onClick={() => step(1)}
        >
          <ChevronRight aria-hidden />
        </button>
      </div>
    </section>
  );
}

export function H2Trusted(): React.JSX.Element {
  return (
    <section className="h2-section h2-rule h2-trusted" aria-labelledby="h2-trusted-title">
      <div className="h2-shell">
        <h2 id="h2-trusted-title" className="h2-display h2-trusted__title">
          Built for teams shipping the future of commerce
        </h2>
        <p className="h2-trusted__copy">
          Seams gives merchants and platforms secure accounts, scoped credentials, and wallet
          access, with approval rules and an audit trail for every action.
        </p>
      </div>
    </section>
  );
}

/* ---------- platform pillars ---------- */

/* Split-key visual (home duo card + Embedded Wallets pillar tab): a soft
   isometric stack of the two key shares with floating labeled chips, resolving
   into one green signature chip. Reference language: layered-asset cards in
   the dynamic.xyz style, translated to the site's paper + evergreen palette. */
export function SplitKeyVisual(): React.JSX.Element {
  return (
    <div
      className="h2-splitkey"
      role="img"
      aria-label="Two key shares — one on the user's device, one on your infrastructure — combine into one signature; neither share signs alone"
    >
      <svg className="h2-splitkey__stack" viewBox="0 0 168 194" aria-hidden>
        <defs>
          <linearGradient id="h2sk-slab-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#eeebe7" />
            <stop offset="100%" stopColor="#d3cec7" />
          </linearGradient>
          <linearGradient id="h2sk-slab-b" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#dfdad3" />
            <stop offset="100%" stopColor="#b6b0a7" />
          </linearGradient>
          <linearGradient id="h2sk-slab-c" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c8c2b9" />
            <stop offset="100%" stopColor="#948d84" />
          </linearGradient>
        </defs>
        {/* each slab: an offset underside that reads as the slab's edge and
            contact shadow, under a white-outlined sage face. Drawn bottom-up,
            and the 54u pitch is shorter than the 68u diamond, so each slab
            overlaps and occludes the tip of the one beneath it */}
        <path d="M84 122 L152 156 L84 190 L16 156 Z" fill="#7a736b" />
        <path
          d="M84 114 L152 148 L84 182 L16 148 Z"
          fill="url(#h2sk-slab-c)"
          stroke="#ffffff"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        <path d="M84 68 L152 102 L84 136 L16 102 Z" fill="#a29b91" />
        <path
          d="M84 60 L152 94 L84 128 L16 94 Z"
          fill="url(#h2sk-slab-b)"
          stroke="#ffffff"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        <path d="M84 14 L152 48 L84 82 L16 48 Z" fill="#c0b9b1" />
        <path
          d="M84 6 L152 40 L84 74 L16 40 Z"
          fill="url(#h2sk-slab-a)"
          stroke="#ffffff"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      <div className="h2-splitkey__chips">
        <span className="h2-splitkey__chip">
          <span className="h2-splitkey__ico">
            <Smartphone aria-hidden />
          </span>
          User{'’'}s device
        </span>
        <span className="h2-splitkey__chip">
          <span className="h2-splitkey__ico">
            <Server aria-hidden />
          </span>
          Your infrastructure
        </span>
        <span className="h2-splitkey__chip h2-splitkey__chip--sig">
          <span className="h2-splitkey__ico">
            <Check aria-hidden />
          </span>
          One signature
        </span>
      </div>
    </div>
  );
}

type Pillar = {
  id: string;
  label: string;
  icon: React.ComponentType<{ 'aria-hidden'?: boolean }>;
  copy: React.ReactNode;
  mock: React.ReactNode;
};

const pillars: Pillar[] = [
  {
    id: 'auth',
    label: 'Authentication',
    icon: Fingerprint,
    copy: (
      <>
        <strong>Passkeys, biometric login, and account recovery.</strong> One identity layer for
        merchants, staff, and the agents working on their behalf.
      </>
    ),
    mock: (
      <div className="h2-mockcard" role="img" aria-label="Sign-in methods list">
        <p className="h2-mockcard__title">Sign in to your store</p>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Passkey
            <small>face_id · this device</small>
          </span>
          <span className="h2-chip h2-chip--green">Ready</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Email one-time code
            <small>otp · 10 min expiry</small>
          </span>
          <span className="h2-chip h2-chip--plain">Fallback</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Account recovery
            <small>email + linked device</small>
          </span>
          <span className="h2-chip h2-chip--plain">Configured</span>
        </div>
      </div>
    ),
  },
  {
    id: 'wallets',
    label: 'Embedded Wallets',
    icon: Wallet,
    copy: (
      <>
        <strong>Non-custodial embedded wallets and signed customer actions.</strong> Keys are split
        between the user&rsquo;s device and your infrastructure: neither can sign alone.
      </>
    ),
    mock: <SplitKeyVisual />,
  },
  {
    id: 'permissions',
    label: 'Credentials & permissions',
    icon: ListChecks,
    copy: (
      <>
        <strong>Limits, approvals, roles, and audit.</strong> Configurable policy decides what each
        credential can do before anything executes.
      </>
    ),
    mock: (
      <div className="h2-mockcard" role="img" aria-label="Policy rules list">
        <p className="h2-mockcard__title">Store policy</p>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Discounts up to 10%
            <small>role: support</small>
          </span>
          <span className="h2-chip h2-chip--green">Allowed</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Refunds over ¥50,000
            <small>role: any</small>
          </span>
          <span className="h2-chip h2-chip--amber">Needs approval</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Price changes
            <small>role: owner only</small>
          </span>
          <span className="h2-chip h2-chip--amber">Step-up auth</span>
        </div>
      </div>
    ),
  },
  {
    id: 'delegated',
    label: 'Delegated access',
    icon: Share2,
    copy: (
      <>
        <strong>Credential delegation for staff, and agent identity for attribution.</strong> The
        Seams Harness gives every agent its own scoped credentials and a full evidence trail.
      </>
    ),
    mock: (
      <div className="h2-mockcard" role="img" aria-label="Delegated credentials list">
        <p className="h2-mockcard__title">Delegated credentials</p>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Support agent (AI)
            <small>emails + refunds ≤ ¥10,000</small>
          </span>
          <span className="h2-chip h2-chip--green">Active</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Ops staff: Kenji
            <small>listings + inventory</small>
          </span>
          <span className="h2-chip h2-chip--green">Active</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Pricing agent (AI)
            <small>expired 2 days ago</small>
          </span>
          <span className="h2-chip h2-chip--plain">Revoked</span>
        </div>
      </div>
    ),
  },
];

export function H2Pillars(): React.JSX.Element {
  const [active, setActive] = React.useState(0);
  const pillar = pillars[active];

  return (
    <section className="h2-section h2-rule" aria-labelledby="h2-pillars-title">
      <div className="h2-shell">
        <div className="h2-split-head">
          <p className="h2-kicker">Platform</p>
          <h2 id="h2-pillars-title" className="h2-display">
            One SDK for the whole account stack
          </h2>
          <p className="h2-split-head__copy">
            Authentication, wallets, credentials, and delegated access share one policy model, so
            nothing acts on your store outside the rules you set.
          </p>
        </div>
        <div className="h2-pillars">
          <div className="h2-pillars__list" role="tablist" aria-label="Platform pillars">
            {pillars.map((p, i) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className={`h2-pillar${i === active ? ' is-active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  <span className="h2-pillar__icon" aria-hidden>
                    <Icon />
                  </span>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="h2-pillars__panel" role="tabpanel" aria-label={pillar.label}>
            <p className="h2-pillars__panel-copy">{pillar.copy}</p>
            <div className="h2-pillars__mock">{pillar.mock}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- bento band (control plane) ---------- */

function PreflightMock(): React.JSX.Element {
  return (
    <div className="h2-mockcard" role="img" aria-label="Preflight checks before an agent action">
      <p className="h2-mockcard__title">Preflight checks: send discount offer</p>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">Credentials valid</span>
        <span className="h2-chip h2-chip--green">Pass</span>
      </div>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">Agent identity verified</span>
        <span className="h2-chip h2-chip--green">Pass</span>
      </div>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">Discount permission</span>
        <span className="h2-chip h2-chip--amber">Admin approval</span>
      </div>
      <div className="h2-mockbtns" aria-hidden>
        <span className="h2-mockbtn h2-mockbtn--approve">Approve</span>
        <span className="h2-mockbtn h2-mockbtn--cancel">Cancel</span>
      </div>
    </div>
  );
}

function ApprovalGateMock(): React.JSX.Element {
  return (
    <div className="h2-mockcard" role="img" aria-label="Approval gate requiring passkey">
      <p className="h2-mockcard__title">Approval gate</p>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Order inventory restock
          <small>¥180,000 · supplier: Kyoto Craft Co.</small>
        </span>
        <span className="h2-chip h2-chip--amber">Held</span>
      </div>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Confirm with passkey
          <small>owner presence required</small>
        </span>
        <span className="h2-chip h2-chip--plain">Waiting</span>
      </div>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Decision logged to audit trail
          <small>evidence retained</small>
        </span>
        <span className="h2-chip h2-chip--plain">Auto</span>
      </div>
    </div>
  );
}

export function H2Bento(): React.JSX.Element {
  return (
    <section className="h2-section h2-section--bento h2-rule" aria-labelledby="h2-bento-title">
      <div className="h2-shell">
        <div className="h2-split-head">
          <p className="h2-kicker">Control plane</p>
          <h2 id="h2-bento-title" className="h2-display">
            Agents act only inside policy
          </h2>
          <p className="h2-split-head__copy">
            Every action from an agent or staff member runs through the same checks: permissions,
            limits, thresholds, expiry. Risky actions route to a human.
          </p>
        </div>
        <div className="h2-bento">
          <div className="h2-bento__card h2-bento__card--lg">
            <div className="h2-bento__visual">
              <PreflightMock />
            </div>
            <div>
              <h3 className="h2-bento__title">Checks before execution</h3>
              <p className="h2-bento__copy">
                The Seams harness verifies credentials, identity, and permissions before an action
                runs and emits a log either way.
              </p>
            </div>
          </div>
          <div className="h2-bento__card h2-bento__card--lg">
            <div className="h2-bento__visual">
              <ApprovalGateMock />
            </div>
            <div>
              <h3 className="h2-bento__title">Human approval where it matters</h3>
              <p className="h2-bento__copy">
                Funds, pricing, and public actions can require passkey or biometric confirmation
                from the owner before they go through.
              </p>
            </div>
          </div>
          <div className="h2-bento__card h2-bento__card--sm">
            <span className="h2-bento__icon h2-bento__icon--blue-red" aria-hidden>
              <ListChecks />
            </span>
            <div>
              <h3 className="h2-bento__title">Roles &amp; limits</h3>
              <p className="h2-bento__copy">
                Scope what support, ops, and agents can each do: amounts, actions, expiry.
              </p>
            </div>
          </div>
          <div className="h2-bento__card h2-bento__card--sm">
            <span className="h2-bento__icon h2-bento__icon--ember-moss" aria-hidden>
              <ScrollText />
            </span>
            <div>
              <h3 className="h2-bento__title">Audit trail</h3>
              <p className="h2-bento__copy">
                Every decision, allowed, held, or blocked, lands in an evidence trail you can
                export.
              </p>
            </div>
          </div>
          <div className="h2-bento__card h2-bento__card--sm">
            <span className="h2-bento__icon h2-bento__icon--sage-charcoal" aria-hidden>
              <KeyRound />
            </span>
            <div>
              <h3 className="h2-bento__title">Recovery built in</h3>
              <p className="h2-bento__copy">
                Accounts recover through email and linked devices: no seed phrases, no lockouts.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- workflows (canvas + use-case covers) ---------- */

const useCases = [
  {
    title: 'Automate storefront ops',
    coverClass: 'h2-case__cover--ops',
    coverLabel: 'Storefront ops',
    copy: 'Let an agent watch cart abandonment, inventory alerts, and support tickets, then follow up, prepare refunds, and update listings inside the limits you set.',
  },
  {
    title: 'Delegate to staff safely',
    coverClass: 'h2-case__cover--staff',
    coverLabel: 'Staff delegation',
    copy: 'Give part-time staff and contractors scoped credentials instead of shared logins. Limits and roles apply automatically; access expires on schedule.',
  },
  {
    title: 'Agent checkout with mandates',
    coverClass: 'h2-case__cover--checkout',
    coverLabel: 'Agent checkout',
    copy: 'Buyer-side agents purchase under signed mandates with per-week budgets: merchants see verified identity and a clean audit trail on every order.',
  },
];

export function H2WorkflowCanvas(): React.JSX.Element {
  return (
    <div className="h2-flow">
      <div
        className="h2-flow__canvas"
        role="img"
        aria-label="A storefront event flowing through preflight checks into a signed action"
      >
        <span className="h2-flow__tag">Seams Harness &middot; cart-recovery flow</span>
        <div className="h2-flow__row">
          <div className="h2-mockcard h2-flow__node h2-flow__node--first">
            <p className="h2-mockcard__title">Storefront event</p>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">
                Cart abandoned
                <small>3 items &middot; ¥12,400</small>
              </span>
              <span className="h2-chip h2-chip--plain">New</span>
            </div>
          </div>
          <span className="h2-flow__link" aria-hidden />
          <div className="h2-mockcard h2-flow__node">
            <p className="h2-mockcard__title">Preflight checks</p>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">Credentials valid</span>
              <span className="h2-chip h2-chip--green">Pass</span>
            </div>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">Agent identity</span>
              <span className="h2-chip h2-chip--green">Pass</span>
            </div>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">Discount 10%</span>
              <span className="h2-chip h2-chip--amber">Owner approval</span>
            </div>
          </div>
          <span className="h2-flow__link" aria-hidden />
          <div className="h2-mockcard h2-flow__node h2-flow__node--last">
            <p className="h2-mockcard__title">Action</p>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">
                Offer email sent
                <small>sig 0x8c31…f27</small>
              </span>
              <span className="h2-chip h2-chip--green">Signed</span>
            </div>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">Logged to audit trail</span>
              <span className="h2-chip h2-chip--plain">Auto</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function H2Cases(): React.JSX.Element {
  return (
    <section className="h2-section h2-rule" aria-labelledby="h2-cases-title">
      <div className="h2-shell">
        <div className="h2-split-head">
          <p className="h2-kicker">Workflows</p>
          <h2 id="h2-cases-title" className="h2-display">
            Turn store operations into governed workflows
          </h2>
          <p className="h2-split-head__copy">
            The Seams harness turns commerce events into policy-checked actions: agents watch the
            store, prepare responses, and act inside the limits you set, with human approval where
            it matters.
          </p>
        </div>

        <H2WorkflowCanvas />

        <div className="h2-cases">
          {useCases.map((c) => (
            <div className="h2-case" key={c.title}>
              <div className={`h2-case__cover ${c.coverClass}`} aria-hidden>
                <span>{c.coverLabel}</span>
              </div>
              <h3 className="h2-case__title">{c.title}</h3>
              <p className="h2-case__copy">{c.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- security ---------- */

type SecurityView = 'features' | 'signing';
const walletCapabilities: ReadonlyArray<{ figure: WalletFigureName; label: string }> = [
  { figure: 'keychain', label: 'Keys you control' },
  { figure: 'interlock', label: 'Scoped permissions' },
  { figure: 'devices', label: 'Linked devices' },
  { figure: 'infrastructure', label: 'Self-hostable' },
];

function WalletCapability({
  figure,
  label,
}: {
  figure: WalletFigureName;
  label: string;
}): React.JSX.Element {
  return (
    <div className="h2-security__cell">
      <WalletFigure figure={figure} />
      <span>{label}</span>
    </div>
  );
}

function renderWalletCapability(capability: {
  figure: WalletFigureName;
  label: string;
}): React.JSX.Element {
  return (
    <WalletCapability key={capability.figure} figure={capability.figure} label={capability.label} />
  );
}

export function H2Security(): React.JSX.Element {
  const [view, setView] = React.useState<SecurityView>('features');
  return (
    <section
      id="wallet-security"
      className="h2-section h2-rule"
      aria-labelledby="h2-security-title"
    >
      <div className="h2-shell">
        <div className="h2-security">
          <div>
            <h2 id="h2-security-title" className="h2-display h2-security__title">
              Custody and control, engineered in
            </h2>
            <div className="h2-security__item">
              <h3>Non-custodial by design</h3>
              <p>
                Signing authority is split between the user&rsquo;s device and your infrastructure.
                Neither can sign alone. Exporting keys requires fresh authorization.
              </p>
            </div>
            <div className="h2-security__item">
              <h3>Permissions, enforced</h3>
              <p>
                Scope what apps and agents can do. Approvals, budgets, and revocation checks run
                before transactions are signed.
              </p>
            </div>
            <div className="h2-security__item">
              <h3>Your wallet, across devices</h3>
              <p>
                Link another device to your wallet for access and recovery. Keep control as you move
                between devices.
              </p>
            </div>
            <div className="h2-security__item">
              <h3>Your infrastructure. Your control.</h3>
              <p>Run threshold signing on your own serverless infrastructure.</p>
            </div>
          </div>
          <div className="h2-security__visuals">
            <div className="h2-security__switch" role="group" aria-label="Custody illustrations">
              <button
                type="button"
                aria-pressed={view === 'features'}
                onClick={setView.bind(null, 'features')}
              >
                Wallet capabilities
              </button>
              <button
                type="button"
                aria-pressed={view === 'signing'}
                onClick={setView.bind(null, 'signing')}
              >
                How signing works
              </button>
            </div>
            <div className="h2-security__stage">
              {view === 'features' ? (
                <div className="h2-security__grid">
                  {walletCapabilities.map(renderWalletCapability)}
                </div>
              ) : (
                <div className="h2-security__signing">
                  <WalletFigure figure="signing" />
                </div>
              )}
            </div>
            <p className="h2-security__hint">Hover or tap an illustration to explore.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- get started band (stacked two-column rows) ---------- */

/* The console band's two screens: the legend rows and the stage cards are
   driven from one list so a label can never name the screen beside it. */
const CONSOLE_SCREENS = [
  {
    id: 'overview' as const,
    label: 'Overview',
    blurb: 'Wallets, approvals, and team activity at a glance',
    src: '/wallet-preview/wallet-console-dashboard.png?v=1',
  },
  {
    id: 'audit' as const,
    label: 'Audit logs',
    blurb: 'Every action attributed, timestamped, and exportable',
    src: '/wallet-preview/wallet-console-audit.png?v=1',
  },
];

export function H2Start(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const dashboardProps = linkProps('/dashboard');
  const docsProps = linkProps('/docs/concepts/');
  const contactProps = linkProps('/contact/');
  /* Which console screen sits in front. CSS `:has(:hover)` cannot express
     this: it only knows what the pointer is on *now*, so leaving either card
     snapped the stage back to its rest state and the right screen animated
     forward on every mouse-out. Holding the last hover here leaves the card
     the reader was just looking at in front. */
  const [consoleFocus, setConsoleFocus] = React.useState<'overview' | 'audit'>('audit');

  return (
    <section
      className="h2-section h2-section--flush-bottom h2-rule"
      aria-labelledby="h2-start-title"
    >
      <div className="h2-shell">
        <div className="h2-eco__head h2-starthead">
          <div>
            <h2 id="h2-start-title" className="h2-display h2-eco__title">
              Start in the wallet console, or build it into your product
            </h2>
            <a
              className="h2-btn h2-btn--primary h2-starthead__cta"
              href={docsProps.href}
              onClick={docsProps.onClick}
            >
              Explore documentation
            </a>
          </div>
        </div>
      </div>

      {/* row 1: accounts & wallets API */}
      <div className="h2-startrow h2-rule h2-rule--midtick">
        <div className="h2-shell h2-startrow__grid">
          <div className="h2-startrow__text">
            <h3>Accounts &amp; Wallets API</h3>
            <p>
              Register a passkey and get a working account: non-custodial wallet included, recovery
              built in, every action signed.
            </p>
            <div className="h2-startrow__notes">
              <div>
                <strong>Passkey register</strong>
                <span>One call to a working wallet</span>
              </div>
              <div>
                <strong>Recovery</strong>
                <span>Email + linked devices, no seed phrases</span>
              </div>
            </div>
          </div>
          <div className="h2-code h2-code--lg" aria-label="Register a wallet with the SDK">
            <span className="tok-kw">import</span>
            {' { SeamsClient } '}
            <span className="tok-kw">from</span> <span className="tok-str">'@seams/wallet'</span>
            {';\n\n'}
            <span className="tok-kw">const</span>
            {' seams = '}
            <span className="tok-kw">new</span>
            {' SeamsClient({ '}
            <span className="tok-prop">apiKey</span>
            {': '}
            <span className="tok-str">'YOUR_API_KEY'</span>
            {' });\n\n'}
            <span className="tok-kw">const</span>
            {' account = '}
            <span className="tok-kw">await</span>
            {' seams.register({\n  '}
            <span className="tok-prop">method</span>
            {': '}
            <span className="tok-str">'passkey'</span>
            {',\n  '}
            <span className="tok-prop">policy</span>
            {': '}
            <span className="tok-str">'starter-store'</span>
            {',\n});'}
          </div>
        </div>
      </div>

      {/* row 2: policy & delegation API */}
      <div className="h2-startrow h2-rule h2-rule--midtick">
        <div className="h2-shell h2-startrow__grid">
          <div className="h2-startrow__text">
            <h3>Policy &amp; Delegation API</h3>
            <p>
              Grant staff and agents scoped credentials with limits and expiry. Risky actions route
              to the owner for passkey approval.
            </p>
            <div className="h2-startrow__notes">
              <div>
                <strong>Scoped credentials</strong>
                <span>Per-action limits and expiry</span>
              </div>
              <div>
                <strong>Approval gates</strong>
                <span>Owner passkey for risky actions</span>
              </div>
            </div>
          </div>
          <div className="h2-code h2-code--lg" aria-label="Grant a scoped credential with the SDK">
            <span className="tok-kw">const</span>
            {' grant = '}
            <span className="tok-kw">await</span>
            {' seams.delegation.grant({\n  '}
            <span className="tok-prop">to</span>
            {': '}
            <span className="tok-str">'support-agent'</span>
            {',\n  '}
            <span className="tok-prop">scopes</span>
            {': ['}
            <span className="tok-str">'refunds:issue'</span>
            {', '}
            <span className="tok-str">'emails:send'</span>
            {'],\n  '}
            <span className="tok-prop">limit</span>
            {': { '}
            <span className="tok-prop">perAction</span>
            {': '}
            <span className="tok-str">'¥10,000'</span>
            {', '}
            <span className="tok-prop">expires</span>
            {': '}
            <span className="tok-str">'30d'</span>
            {' },\n});\n\n'}
            <span className="tok-cm">{'// risky actions route to the owner\n'}</span>
            <span className="tok-kw">await</span>
            {' seams.approvals.require('}
            <span className="tok-str">'discounts:over-10'</span>
            {');'}
          </div>
        </div>
      </div>

      {/* row 3: wallet console — two console pages staged side by side,
          the right one cropped by the panel (elevenlabs.io-style band) */}
      <div className="h2-startrow h2-rule h2-rule--midtick">
        <div className="h2-shell h2-consoleband">
          <div className="h2-startrow__text">
            <h3 className="h2-consoleband__title">Wallet console</h3>
            <p>
              Manage wallets, signing policy, team access, and pending approvals from one dashboard.
              Invite staff and agents without writing code.
            </p>
            <div className="h2-startrow__ctas">
              <a
                className="h2-btn h2-btn--primary"
                href={dashboardProps.href}
                onClick={dashboardProps.onClick}
              >
                Open wallet console
              </a>
              <a
                className="h2-btn h2-btn--outline"
                href={contactProps.href}
                onClick={contactProps.onClick}
              >
                Talk to us
              </a>
            </div>
          </div>
          {/* The legend doubles as the control: each row brings its own screen
              to the front, so the labels are the same affordance as hovering
              the cards themselves. `aria-pressed` rather than tabs — both
              screens stay on stage, only their order changes. */}
          <div
            className="h2-startrow__notes h2-consoleband__legend"
            role="group"
            aria-label="Bring a console screen to the front"
          >
            {CONSOLE_SCREENS.map((screen) => {
              const selected = consoleFocus === screen.id;
              return (
                <button
                  key={screen.id}
                  type="button"
                  className={`h2-consoleband__tab${selected ? ' is-active' : ''}`}
                  aria-pressed={selected}
                  onClick={() => setConsoleFocus(screen.id)}
                >
                  <span className="h2-consoleband__tab-copy">
                    <strong>{screen.label}</strong>
                    <span>{screen.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div
            className="h2-consoleband__stage"
            data-focus={consoleFocus}
            role="img"
            aria-label="Wallet console overview and audit log pages"
          >
            {CONSOLE_SCREENS.map((screen) => (
              <div
                key={screen.id}
                className={`h2-consoleband__screen h2-consoleband__screen--${screen.id}`}
                onPointerEnter={() => setConsoleFocus(screen.id)}
              >
                <img
                  src={screen.src}
                  alt=""
                  width={2970}
                  height={1680}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

type FaqItem = {
  q: string;
  a: string;
};

type H2FaqProps = {
  audience: 'home' | 'wallet';
};

const faqs: Record<H2FaqProps['audience'], readonly FaqItem[]> = {
  home: [
    {
      q: 'What is Seams?',
      a: 'Seams is key and credential infrastructure for ecommerce: one SDK for authentication, non-custodial wallets, a credentials and permissions layer, and delegated access for staff and AI agents.',
    },
    {
      q: 'What can AI agents do with Seams?',
      a: 'Agents get their own identity and scoped credentials. They can act on commerce events: follow-ups, refunds, listing updates, but only inside the merchant’s policy. Risky actions route to a human approval gate with passkey or biometric confirmation.',
    },
    {
      q: 'How do merchants stay in control?',
      a: 'Policy runs before anything executes: roles, amount limits, thresholds, expiry, and revocation. Every decision is attributed and logged, and delegated credentials can be revoked at any time.',
    },
    {
      q: 'How do we get started?',
      a: 'The SDK is self-serve: install it, register an account with a passkey, and apply a policy template. For marketplaces and merchant fleets, contact us and we’ll plan the rollout together.',
    },
  ],
  wallet: [
    {
      q: 'Is Seams custodial?',
      a: 'No. Signing keys are split between the user’s device and your infrastructure: neither side can sign alone, and exporting a key always requires a fresh authorized flow from the owner.',
    },
    {
      q: 'How does API authentication work?',
      a: 'Your backend authenticates with API keys; end users and agents authenticate with passkeys and scoped credentials. Signing always requires the user-side key share, so API keys alone can never move funds or export keys.',
    },
    {
      q: 'Which networks does Seams support?',
      a: 'Ethereum and EVM networks, NEAR, Stripe Tempo, Circle Arc, Hyperliquid, and Polygon today, with more networks added as merchant demand grows.',
    },
    {
      q: 'How is usage metered?',
      a: 'Plans are based on monthly active wallets, with overage pricing as you grow: from a free tier for launch through usage-based Growth and Professional plans. See the pricing page for details.',
    },
  ],
};

function renderFaqItem(item: FaqItem): React.JSX.Element {
  return (
    <details key={item.q}>
      <summary>{item.q}</summary>
      <p>{item.a}</p>
    </details>
  );
}

export function H2Faq({ audience }: H2FaqProps): React.JSX.Element {
  return (
    <section className="h2-section h2-rule" aria-labelledby="h2-faq-title">
      <div className="h2-shell">
        <div className="h2-faq">
          <h2 id="h2-faq-title" className="h2-display h2-faq__title">
            Frequently asked questions
          </h2>
          <div className="h2-faq__list">{faqs[audience].map(renderFaqItem)}</div>
        </div>
      </div>
    </section>
  );
}

/* ---------- footer ---------- */

type H2FooterLink = {
  label: string;
  to: string;
  external?: boolean;
};

const footerGroups: { heading: string; links: H2FooterLink[] }[] = [
  {
    heading: 'Products',
    links: [
      { label: 'Embedded Wallet', to: '/wallet' },
      { label: 'Ecommerce Agents', to: 'https://seams.sh/ecommerce' },
      { label: 'Custody Model', to: '/docs/concepts/custody/' },
      { label: 'Wallet Sessions', to: '/docs/concepts/sessions/wallet-sessions' },
    ],
  },
  {
    heading: 'Platform',
    links: [
      { label: 'Authentication', to: '/docs/concepts/auth-methods/' },
      { label: 'Passkeys', to: '/docs/concepts/auth-methods/passkeys' },
      { label: 'Wallets & Signatures', to: '/docs/concepts/threshold-signing/' },
      { label: 'Permissions & Policy', to: '/docs/concepts/policy/mandates' },
    ],
  },
  {
    heading: 'Developers',
    links: [
      { label: 'Documentation', to: '/docs/concepts/' },
      { label: 'Architecture', to: '/docs/concepts/architecture' },
      { label: 'Wallet Iframe', to: '/docs/concepts/custody/wallet-iframe' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Guides', to: '/docs/guides/' },
      { label: 'Use Cases', to: '/docs/use-cases/' },
      { label: 'Pricing', to: '/pricing/' },
    ],
  },
  {
    heading: 'Socials',
    links: [
      { label: 'X', to: 'https://x.com/lowerarchy', external: true },
      { label: 'GitHub', to: 'https://github.com/seams-tech', external: true },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', to: '/company/' },
      { label: 'Blog', to: '/company/#blog' },
      { label: 'Contact', to: '/contact/' },
    ],
  },
];

export function H2Footer(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const homeProps = linkProps('https://seams.sh/');

  return (
    <footer className="h2-footer h2-rule" aria-label="Site footer">
      <div className="h2-footer__inner">
        <div className="h2-footer__grid">
          <div className="h2-footer__brand">
            <a href={homeProps.href} onClick={homeProps.onClick} aria-label="Seams home">
              <SeamsWordmark height={20} />
            </a>
          </div>

          <div className="h2-footer__links">
            {footerGroups.map((group) => (
              <div className="h2-footer__col" key={group.heading}>
                <h3>{group.heading}</h3>
                {group.links.map((link) => {
                  const props = linkProps(link.to);
                  return (
                    <a
                      key={link.label}
                      href={props.href}
                      onClick={props.onClick}
                      {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : null)}
                    >
                      {link.label}
                    </a>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
