import { useSitePage, useTranslation } from '@/i18n/browser';
import type { Translate } from '@/i18n/catalog';
import { LanguageSelector } from '@/i18n/LanguageSelector';
import React from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Croissant,
  KeyRound,
  ListChecks,
  Mail,
  MonitorSmartphone,
  ScrollText,
  Server,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Store,
} from 'lucide-react';
import { Theme, useSeams, type HostedAuthMenuMode } from '@seams/wallet/react';
import SeamsWordmark from '@/components/icons/SeamsWordmark';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { EcosystemLattice } from '@/components/h2/EcosystemLattice';
import { PortalShot, type PortalShotName } from '@/components/h2/SceneHero';
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
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

/* Shared section library for the h2 marketing pages (/, /ecommerce, /company).
   Every component renders inside a `.h2-page > .h2-col` wrapper and styles
   itself from src/styles/h2.css. */

// Defer the live passkey demo until after first paint/idle.
const DemoPasskeyColumnLazy = React.lazy(() =>
  import('@/components/DemoPasskeyColumn').then((m) => ({ default: m.DemoPasskeyColumn })),
);

/* ---------- demo hero (headline left, live product right) ---------- */

const demoPageNames = ['Login', 'Transactions', 'Account recovery'];

/* Compact product forks under the CTAs. Each chip draws its product's grain
   field, the same fields as the wallet console's forks. */
const productForks: readonly { label: string; to: string; field: GrainFieldName }[] = [
  { label: 'Wallet', to: '/wallet', field: 'teal-peach' },
  { label: 'Harness', to: '/ecommerce', field: 'mauve-ember' },
  { label: 'API', to: '/docs/concepts/', field: 'azure-coral' },
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
      seams.config.setAppearance(demoIframeAppearance(activePreset));
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
                  <span className="h2-fork__chip" aria-hidden>
                    <GrainField field={fork.field} />
                  </span>
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

/* ---------- banners and gradient tiles (as on the wallet site) ---------- */

type TileIcon = React.ComponentType<{ size?: number; strokeWidth?: number }>;

/* A white icon on a small tile of moving gradient, as in the navbar menus. */
export function FieldTile({ field, icon: Icon }: { field: GrainFieldName; icon: TileIcon }) {
  return (
    <span className="h2-fieldtile" aria-hidden>
      <GrainField field={field} />
      <Icon size={18} strokeWidth={1.7} />
    </span>
  );
}

/* A wide banner spreads each colour over its width, so the site's flow barely
   shows on it; this much more keeps its movement subtle but visible. */
const BANNER_FLOW = 3;

/* A grey banner that fades into a moving gradient while it is in view, and
   back to grey once it leaves. */
function FieldBanner({
  field,
  children,
}: {
  field: GrainFieldName;
  children: React.ReactNode;
}): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  const [lit, setLit] = React.useState(false);

  React.useEffect(() => {
    const banner = ref.current;
    if (!banner || typeof IntersectionObserver === 'undefined') return undefined;
    /* the viewport's bottom edge counts as 12rem higher, so the fade starts
       once the banner has scrolled that much further in */
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const observer = new IntersectionObserver(([entry]) => setLit(entry.isIntersecting), {
      rootMargin: `0px 0px ${-12 * rem}px 0px`,
      threshold: 0.5,
    });
    observer.observe(banner);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`h2-banner h2-banner--field${lit ? ' is-lit' : ''}`}>
      <GrainField field={field} playing={lit} flow={BANNER_FLOW} />
      {children}
    </div>
  );
}

/* A band heading: the banner card on its own ruled row, one inset inside
   the rules, with the heading left and the actions right. */
function BannerSection({
  id,
  anchor,
  field,
  title,
  sub,
  children,
}: {
  id: string;
  /* the fragment that links to this band, e.g. /ecommerce#bakeryos */
  anchor?: string;
  field: GrainFieldName;
  title: string;
  sub?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section id={anchor} className="h2-section h2-section--banner h2-rule" aria-labelledby={id}>
      <FieldBanner field={field}>
        <div>
          <h2 id={id} className="h2-display h2-banner__title">
            {title}
          </h2>
          {sub ? <p className="h2-banner__sub">{sub}</p> : null}
        </div>
        {children ? <div className="h2-banner__actions">{children}</div> : null}
      </FieldBanner>
    </section>
  );
}

/* ---------- ecosystem (commerce-stack lattice) ---------- */

export function H2Ecosystem(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const satyrProps = linkProps('/ecommerce');

  return (
    <>
      <BannerSection
        id="h2-eco-title"
        anchor="integrations"
        field="teal-peach"
        title="Connects to the tools a café already uses"
        sub="Slack, Gmail, Shopify, Square, Stripe and your files. Each connection has its own access, and you can disconnect it at any time."
      >
        <a className="h2-btn h2-btn--outline" href={satyrProps.href} onClick={satyrProps.onClick}>
          Explore Satyr
          <ArrowRightAnim size={12} />
        </a>
      </BannerSection>
      <section className="h2-section h2-section--band h2-rule" aria-labelledby="h2-eco-title">
        <div className="h2-shell">
          <EcosystemLattice />
        </div>
      </section>
    </>
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

export function SplitKeyVisual(): React.JSX.Element {
  return (
    <div
      className="h2-splitkey"
      role="img"
      aria-label="Two key shares — one on the user's device, one on your infrastructure — combine into one signature; neither share signs alone"
    >
      <svg className="h2-splitkey__stack" viewBox="0 0 168 194" aria-hidden>
        {/* Draw slabs bottom-up so each layer occludes the tip beneath it. */}
        <path className="h2-splitkey__edge" d="M16 148 L84 182 L152 148 V151 L84 185 L16 151 Z" />
        <path
          className="h2-splitkey__face h2-splitkey__face--base"
          d="M84 114 L152 148 L84 182 L16 148 Z"
        />
        <path className="h2-splitkey__edge" d="M16 94 L84 128 L152 94 V97 L84 131 L16 97 Z" />
        <path className="h2-splitkey__face" d="M84 60 L152 94 L84 128 L16 94 Z" />
        <path className="h2-splitkey__edge" d="M16 40 L84 74 L152 40 V43 L84 77 L16 43 Z" />
        <path className="h2-splitkey__face" d="M84 6 L152 40 L84 74 L16 40 Z" />
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
  icon: TileIcon;
  field: GrainFieldName;
  copy: React.ReactNode;
  mock: React.ReactNode;
};

/* The suite's areas, one tab each, with the Portal's own screen for each
   area. */
const pillars: Pillar[] = [
  {
    id: 'shop',
    label: 'Shop and menus',
    icon: Store,
    field: 'azure-coral',
    copy: (
      <>
        <strong>Menus, products and the storefront.</strong> Agents draft menus and product
        descriptions with you, and publish a menu when you approve it.
      </>
    ),
    mock: (
      <PortalShot
        shot="checkout"
        alt="The Checkout page of the Satyr Portal: how customers buy from the café’s storefront"
        className="h2-shot--card"
      />
    ),
  },
  {
    id: 'orders',
    label: 'Orders and payments',
    icon: ShoppingBag,
    field: 'slate-amber',
    copy: (
      <>
        <strong>Orders, payments, refunds and gift cards.</strong> Card payments go to your own
        Stripe or Square account. Ask in Slack for a brief on failed payments and late orders.
      </>
    ),
    mock: (
      <PortalShot
        shot="orders"
        alt="The Orders page of the Satyr Portal: customer orders and their state"
        className="h2-shot--card"
      />
    ),
  },
  {
    id: 'inbox',
    label: 'Inbox',
    icon: Mail,
    field: 'sky-sand',
    copy: (
      <>
        <strong>Customer and supplier mail, answered.</strong> The inbox agent drafts each reply
        with the sources it used, and links each sender to the right customer or supplier.
      </>
    ),
    mock: (
      <PortalShot
        shot="inbox"
        alt="The Satyr Inbox: a reply that an agent drafted waits for approval"
        className="h2-shot--card"
      />
    ),
  },
  {
    id: 'production',
    label: 'Production',
    icon: Croissant,
    field: 'apricot-beam',
    copy: (
      <>
        <strong>BakeryOS turns orders into a bake plan.</strong> One production run shows as a
        workflow, a timeline of ovens and staff, and a 3D view of the bakery.
      </>
    ),
    mock: (
      <PortalShot
        shot="bakery-timeline"
        alt="BakeryOS: a 3D view of the bakery above the timeline of three batches"
        className="h2-shot--card h2-shot--bottom"
      />
    ),
  },
  {
    id: 'vault',
    label: 'Vault',
    icon: KeyRound,
    field: 'mauve-ember',
    copy: (
      <>
        <strong>Logins and keys that agents use but never see.</strong> Keep them in the Satyr Vault
        or in your own 1Password.
      </>
    ),
    mock: (
      <PortalShot
        shot="vault"
        alt="The Vault page of the Satyr Portal: logins and API keys that agents use"
        className="h2-shot--card"
      />
    ),
  },
];

export function H2Pillars({ link = true }: { link?: boolean } = {}): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const satyrProps = linkProps('/ecommerce');
  const [active, setActive] = React.useState(0);
  const pillar = pillars[active];

  return (
    <>
      <BannerSection
        id="h2-pillars-title"
        anchor="suite"
        field="azure-coral"
        title="One suite for the whole business"
        sub="The online shop, the inbox and the kitchen work from the same orders."
      >
        {link ? (
          <a className="h2-btn h2-btn--primary" href={satyrProps.href} onClick={satyrProps.onClick}>
            Explore Satyr
            <ArrowRightAnim size={12} />
          </a>
        ) : null}
      </BannerSection>
      <section className="h2-section h2-section--band h2-rule" aria-labelledby="h2-pillars-title">
        <div className="h2-shell">
          <div className="h2-pillars">
            <div className="h2-pillars__list" role="tablist" aria-label="Suite areas">
              {pillars.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className={`h2-pillar${i === active ? ' is-active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  <FieldTile field={p.field} icon={p.icon} />
                  {p.label}
                </button>
              ))}
            </div>
            <div className="h2-pillars__panel" role="tabpanel" aria-label={pillar.label}>
              <p className="h2-pillars__panel-copy">{pillar.copy}</p>
              <div className="h2-pillars__mock">{pillar.mock}</div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------- bento band (approvals and receipts) ---------- */

function SlackApprovalMock(): React.JSX.Element {
  return (
    <div className="h2-mockcard" role="img" aria-label="Approval card in a Slack thread">
      <p className="h2-mockcard__title">Approval card · #cafe-ops</p>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Publish the autumn menu
          <small>prepared by the shop agent · 14 items</small>
        </span>
        <span className="h2-chip h2-chip--amber">Approval needed</span>
      </div>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Who can approve
          <small>an owner or an admin</small>
        </span>
        <span className="h2-chip h2-chip--plain">2 people</span>
      </div>
      <div className="h2-mockbtns" aria-hidden>
        <span className="h2-mockbtn h2-mockbtn--approve">Approve</span>
        <span className="h2-mockbtn h2-mockbtn--cancel">Decline</span>
      </div>
    </div>
  );
}

function MoneyGateMock(): React.JSX.Element {
  return (
    <div className="h2-mockcard" role="img" aria-label="A refund held for approval in the Portal">
      <p className="h2-mockcard__title">Refund ¥4,200 · order #2377</p>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Moves money
          <small>a chat card cannot approve it</small>
        </span>
        <span className="h2-chip h2-chip--amber">Held</span>
      </div>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Approve in the Portal
          <small>owner</small>
        </span>
        <span className="h2-chip h2-chip--plain">Waiting</span>
      </div>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Receipt
          <small>the provider's confirmation is kept</small>
        </span>
        <span className="h2-chip h2-chip--plain">Auto</span>
      </div>
    </div>
  );
}

export function H2Bento(): React.JSX.Element {
  return (
    <>
      <BannerSection
        id="h2-bento-title"
        anchor="control"
        field="mauve-ember"
        title="Agents act inside your rules"
        sub="Agents prepare the work. People approve the changes that matter, and every action leaves a receipt."
      />
      <section className="h2-section h2-section--bento h2-rule" aria-labelledby="h2-bento-title">
        <div className="h2-shell">
          <div className="h2-bento">
            <div className="h2-bento__card h2-bento__card--lg">
              <div className="h2-bento__visual">
                <SlackApprovalMock />
              </div>
              <div>
                <h3 className="h2-bento__title">Approve in the thread</h3>
                <p className="h2-bento__copy">
                  An agent posts each change to the shop as a card in Slack. An owner or admin
                  approves it there, and the agent goes on.
                </p>
              </div>
            </div>
            <div className="h2-bento__card h2-bento__card--lg">
              <div className="h2-bento__visual">
                <MoneyGateMock />
              </div>
              <div>
                <h3 className="h2-bento__title">Money moves only from the Portal</h3>
                <p className="h2-bento__copy">
                  A chat card cannot approve a refund or a payment. The approval happens in the
                  Portal, and Satyr keeps the provider&rsquo;s confirmation.
                </p>
              </div>
            </div>
            <div className="h2-bento__card h2-bento__card--sm">
              <FieldTile field="azure-coral" icon={ListChecks} />
              <div>
                <h3 className="h2-bento__title">Roles</h3>
                <p className="h2-bento__copy">
                  Owners, admins and members each get their own access to each connected tool.
                </p>
              </div>
            </div>
            <div className="h2-bento__card h2-bento__card--sm">
              <FieldTile field="mauve-ember" icon={ScrollText} />
              <div>
                <h3 className="h2-bento__title">Receipts</h3>
                <p className="h2-bento__copy">
                  Each action records who asked for it, what changed and what the provider
                  confirmed.
                </p>
              </div>
            </div>
            <div className="h2-bento__card h2-bento__card--sm">
              <FieldTile field="aqua-evergreen" icon={KeyRound} />
              <div>
                <h3 className="h2-bento__title">Secrets stay out</h3>
                <p className="h2-bento__copy">
                  Agents use logins and API keys from the Vault, but no key enters a prompt or a
                  transcript.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------- workflows (canvas + use-case covers) ---------- */

type UseCase = {
  title: string;
  field: GrainFieldName;
  coverLabel: string;
  cover: PortalShotName;
  copy: string;
};

const useCases: readonly UseCase[] = [
  {
    title: 'Run the online shop',
    field: 'sky-sand',
    coverLabel: 'Shop',
    cover: 'cover-shop',
    copy: 'Agents draft menus and product descriptions with you, and publish each menu to the storefront when you approve it.',
  },
  {
    title: 'Answer the inbox',
    field: 'aqua-evergreen',
    coverLabel: 'Inbox',
    cover: 'cover-inbox',
    copy: 'The inbox agent reads customer and supplier mail, drafts each reply with its sources, and moves spam out of the way.',
  },
  {
    title: 'Watch payments and orders',
    field: 'azure-coral',
    coverLabel: 'Orders',
    cover: 'cover-orders',
    copy: 'Ask in Slack for a brief on failed payments and late orders. Each item links to its order, and an agent can look into it for you.',
  },
];

function UseCaseCards({ cases }: { cases: readonly UseCase[] }): React.JSX.Element {
  return (
    <div className="h2-cases">
      {cases.map((c) => (
        <div className="h2-case" key={c.title}>
          <div className="h2-case__cover">
            <GrainField field={c.field} />
            <span aria-hidden>{c.coverLabel}</span>
            <PortalShot shot={c.cover} alt="" />
          </div>
          <h3 className="h2-case__title">{c.title}</h3>
          <p className="h2-case__copy">{c.copy}</p>
        </div>
      ))}
    </div>
  );
}

export function H2WorkflowCanvas(): React.JSX.Element {
  return (
    <div className="h2-flow">
      <div
        className="h2-flow__canvas"
        role="img"
        aria-label="A gift box order flowing through checks into the bake plan and a confirmation email"
      >
        <span className="h2-flow__tag">Satyr &middot; gift box order</span>
        <div className="h2-flow__row">
          <div className="h2-mockcard h2-flow__node h2-flow__node--first">
            <p className="h2-mockcard__title">New order</p>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">
                Gift boxes ×12
                <small>¥64,800 &middot; pickup Sat 10:30</small>
              </span>
              <span className="h2-chip h2-chip--plain">New</span>
            </div>
          </div>
          <span className="h2-flow__link" aria-hidden />
          <div className="h2-mockcard h2-flow__node">
            <p className="h2-mockcard__title">Checks</p>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">Stock for Saturday</span>
              <span className="h2-chip h2-chip--green">Pass</span>
            </div>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">Pickup slot</span>
              <span className="h2-chip h2-chip--green">Pass</span>
            </div>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">Company discount 10%</span>
              <span className="h2-chip h2-chip--amber">Owner approval</span>
            </div>
          </div>
          <span className="h2-flow__link" aria-hidden />
          <div className="h2-mockcard h2-flow__node h2-flow__node--last">
            <p className="h2-mockcard__title">Actions</p>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">
                Added to the bake plan
                <small>BakeryOS &middot; 2 trays</small>
              </span>
              <span className="h2-chip h2-chip--green">Planned</span>
            </div>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">Confirmation email</span>
              <span className="h2-chip h2-chip--green">Sent</span>
            </div>
            <div className="h2-mockrow">
              <span className="h2-mockrow__main">Receipt recorded</span>
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
    <>
      <BannerSection
        id="h2-cases-title"
        anchor="workflows"
        field="mauve-ember"
        title="Turn café work into agent workflows"
        sub="Agents watch the shop and the inbox, prepare the work, and act inside the limits that you set."
      />
      <section className="h2-section h2-section--band h2-rule" aria-labelledby="h2-cases-title">
        <div className="h2-shell">
          <H2WorkflowCanvas />
          <UseCaseCards cases={useCases} />
        </div>
      </section>
    </>
  );
}

/* ---------- BakeryOS (production inside the suite) ---------- */

const productionViews: readonly UseCase[] = [
  {
    title: 'Workflow canvas',
    field: 'apricot-beam',
    coverLabel: 'Workflow',
    cover: 'cover-workflow',
    copy: 'Draw each recipe as steps: mix, rest, fill, bake, cool and pack. Each step names its equipment and its time.',
  },
  {
    title: 'Resource timeline',
    field: 'slate-amber',
    coverLabel: 'Timeline',
    cover: 'cover-timeline',
    copy: 'See which oven, mixer and person each run uses, hour by hour, and find clashes before the shift starts.',
  },
  {
    title: '3D bakery',
    field: 'copper-mist',
    coverLabel: '3D view',
    cover: 'cover-floor',
    copy: 'Watch the run move through a 3D model of your kitchen before you bake it for real.',
  },
];

export function H2Production(): React.JSX.Element {
  return (
    <>
      <BannerSection
        id="h2-production-title"
        anchor="bakeryos"
        field="apricot-beam"
        title="BakeryOS: from orders to the oven"
        sub="BakeryOS is the production workspace inside Satyr. It turns orders and preorders into production runs, and it shows one run in three views."
      />
      <section
        className="h2-section h2-section--band h2-rule"
        aria-labelledby="h2-production-title"
      >
        <div className="h2-shell">
          <UseCaseCards cases={productionViews} />
        </div>
      </section>
    </>
  );
}

/* ---------- Seams Wallet (the other product, one band) ---------- */

export function H2WalletBand(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const walletProps = linkProps('/wallet');

  return (
    <BannerSection
      id="h2-wallet-title"
      field="teal-peach"
      title="Also from Seams: Seams Wallet"
      sub="A stablecoin wallet that opens with a passkey. Keys are split between the device and the server, so neither side can sign alone."
    >
      <a className="h2-btn h2-btn--outline" href={walletProps.href} onClick={walletProps.onClick}>
        Explore Seams Wallet
        <ArrowRightAnim size={12} />
      </a>
    </BannerSection>
  );
}

/* ---------- security ---------- */

type SecurityView = 'features' | 'signing';

/* `feature` names the capability whose figure leads the features view, and
   `trailing` the one before it while a play longer than the stagger runs
   out (-1 for none). Every change of lead takes a new `turn`, which restarts
   the progress line. */
type SecurityPosition = { view: SecurityView; feature: number; trailing: number; turn: number };

const SIGNING_VIEW_MS = 6000;
/* Each figure starts this long after the one before it. */
const FEATURE_STAGGER_MS = 3000;

function otherSecurityView(position: SecurityPosition): SecurityPosition {
  const view = position.view === 'features' ? 'signing' : 'features';
  return { view, feature: 0, trailing: -1, turn: position.turn + 1 };
}

function nextSecurityPosition(position: SecurityPosition): SecurityPosition {
  if (position.view === 'signing' || position.feature === walletCapabilities.length - 1) {
    return otherSecurityView(position);
  }
  const runsOn = walletCapabilities[position.feature].playMs > FEATURE_STAGGER_MS;
  return {
    view: 'features',
    feature: position.feature + 1,
    trailing: runsOn ? position.feature : -1,
    turn: position.turn + 1,
  };
}

function focusSecurityFeature(feature: number, position: SecurityPosition): SecurityPosition {
  return { view: 'features', feature, trailing: -1, turn: position.turn + 1 };
}

// Keeps the turn, so the progress line runs on.
function endTrailingPlay(position: SecurityPosition): SecurityPosition {
  return { ...position, trailing: -1 };
}

function releaseHoveredFeature(feature: number, hovered: number | null): number | null {
  return hovered === feature ? null : hovered;
}

function securityPositionMs(position: SecurityPosition): number {
  if (position.view === 'signing') return SIGNING_VIEW_MS;
  return FEATURE_STAGGER_MS;
}

const MOTION_ALLOWED = '(prefers-reduced-motion: no-preference)';

function watchMotionPreference(notify: () => void): () => void {
  const query = window.matchMedia(MOTION_ALLOWED);
  query.addEventListener('change', notify);
  return query.removeEventListener.bind(query, 'change', notify);
}

function motionAllowed(): boolean {
  return window.matchMedia(MOTION_ALLOWED).matches;
}

function serverMotionAllowed(): boolean {
  return false;
}

function notifySecurityFocusChanged(notify: () => void): void {
  // Wait for the parent document to identify the newly focused iframe.
  window.requestAnimationFrame(notify);
}

function stopWatchingSecurityFocus(changed: () => void): void {
  window.removeEventListener('blur', changed);
  window.removeEventListener('focus', changed);
  document.removeEventListener('focusin', changed);
}

function watchSecurityFocus(notify: () => void): () => void {
  const changed = notifySecurityFocusChanged.bind(null, notify);
  window.addEventListener('blur', changed);
  window.addEventListener('focus', changed);
  document.addEventListener('focusin', changed);
  return stopWatchingSecurityFocus.bind(null, changed);
}

function securityFigureHasFocus(): boolean {
  // CSS :focus-within does not cross an iframe boundary.
  return document.activeElement?.matches('#wallet-security iframe') ?? false;
}

function securityServerHasFocus(): boolean {
  return false;
}

/* The bullets and the figure grid come from one list, so a bullet can never
   light up beside another capability's figure. */
type WalletCapability = {
  figure: WalletFigureName;
  label: string;
  title: string;
  copy: string;
  /* the row's tile; the copy fits one line beside it, so rows match */
  icon: TileIcon;
  field: GrainFieldName;
  /* How long the figure plays from the start of its turn: its play, then a
     beat to read it. Turns start FEATURE_STAGGER_MS apart, so a longer play
     runs on beside the next figure. */
  playMs: number;
};

const walletCapabilities: readonly WalletCapability[] = [
  {
    figure: 'keychain',
    label: 'Keys you control',
    title: 'Nobody signs alone',
    copy: 'Keys split between user device and server.',
    icon: KeyRound,
    field: 'teal-peach',
    playMs: 3600,
  },
  {
    figure: 'interlock',
    label: 'Scoped permissions',
    title: 'Permissions',
    copy: 'Limit what apps and agents can sign.',
    icon: SlidersHorizontal,
    field: 'azure-coral',
    playMs: 3600,
  },
  {
    figure: 'devices',
    label: 'Linked devices',
    title: 'Wallets your users do not lose',
    copy: 'Link by QR. Recover with email or recovery codes.',
    icon: MonitorSmartphone,
    field: 'aqua-evergreen',
    playMs: 3600,
  },
  {
    figure: 'infrastructure',
    label: 'No lock-in',
    title: 'Own your accounts. Leave any time.',
    copy: 'Apache-2.0 open source with key export.',
    icon: Server,
    field: 'slate-amber',
    playMs: 3800,
  },
];

/* The title's button stretches over the whole row, so the row is one click
   target while the title stays a heading. */
function SecurityItem({
  capability,
  index,
  active,
  onPick,
}: {
  capability: WalletCapability;
  index: number;
  active: boolean;
  onPick: (index: number) => void;
}): React.JSX.Element {
  const picked = React.useCallback(() => onPick(index), [onPick, index]);
  return (
    <div className={`h2-security__item${active ? ' is-active' : ''}`}>
      <FieldTile field={capability.field} icon={capability.icon} />
      <div>
        <h3>
          <button
            type="button"
            className="h2-security__pick"
            aria-pressed={active}
            onClick={picked}
          >
            {capability.title}
          </button>
        </h3>
        <p>{capability.copy}</p>
      </div>
    </div>
  );
}

function WalletCapabilityCell({
  capability,
  index,
  playing,
  lead,
  onHover,
}: {
  capability: WalletCapability;
  index: number;
  playing: boolean;
  /* the figure of the lit row; a phone shows only this one */
  lead: boolean;
  onHover: (index: number, inside: boolean) => void;
}): React.JSX.Element {
  const hovered = React.useCallback((inside: boolean) => onHover(index, inside), [onHover, index]);
  return (
    <div
      className={`h2-security__cell${playing ? ' is-active' : ''}`}
      data-lead={lead || undefined}
    >
      <WalletFigure figure={capability.figure} playing={playing} onHover={hovered} />
      <span>{capability.label}</span>
    </div>
  );
}

export function H2Security(): React.JSX.Element {
  // The page opens on the signing diagram; the features view follows it.
  const [position, setPosition] = React.useState<SecurityPosition>({
    view: 'signing',
    feature: 0,
    trailing: -1,
    turn: 0,
  });
  const [paused, setPaused] = React.useState(false);
  // The page sees no pointer inside a figure's frame, so each frame reports it.
  const [hoveredFeature, setHoveredFeature] = React.useState<number | null>(null);
  // Reduced motion lights no row by itself, only the one a visitor picks.
  const [picked, setPicked] = React.useState(false);
  const figureFocused = React.useSyncExternalStore(
    watchSecurityFocus,
    securityFigureHasFocus,
    securityServerHasFocus,
  );
  const autoplay = React.useSyncExternalStore(
    watchMotionPreference,
    motionAllowed,
    serverMotionAllowed,
  );
  const { view, trailing } = position;
  // Reduced motion keeps every figure at rest and every bullet plain.
  const playingFeature = autoplay && view === 'features' ? position.feature : -1;
  const trailingFeature = autoplay && view === 'features' ? trailing : -1;
  // The figure before the lead finishes its play, then rests.
  React.useEffect(() => {
    if (trailing < 0) return undefined;
    const runsOnMs = walletCapabilities[trailing].playMs - FEATURE_STAGGER_MS;
    const timer = window.setTimeout(setPosition.bind(null, endTrailingPlay), runsOnMs);
    return () => window.clearTimeout(timer);
  }, [trailing]);
  const advance = setPosition.bind(null, nextSecurityPosition);
  const switchView = setPosition.bind(null, otherSecurityView);
  const progressStyle = {
    '--h2-security-progress-ms': `${securityPositionMs(position)}ms`,
  } as React.CSSProperties;
  // Hovering a figure hands it the turn and holds the timer until the mouse leaves.
  const focusFeature = React.useCallback((feature: number, inside: boolean) => {
    if (!inside) {
      setHoveredFeature(releaseHoveredFeature.bind(null, feature));
      return;
    }
    setHoveredFeature(feature);
    setPosition(focusSecurityFeature.bind(null, feature));
  }, []);
  // Picking a row hands its figure the turn and restarts the timer.
  const pickFeature = React.useCallback((feature: number) => {
    setPicked(true);
    setPosition(focusSecurityFeature.bind(null, feature));
  }, []);
  let litFeature = playingFeature;
  if (litFeature < 0 && picked && view === 'features') litFeature = position.feature;
  return (
    <section
      id="wallet-security"
      className="h2-section h2-rule h2-security-section"
      aria-labelledby="h2-security-title"
      data-view={view}
      data-paused={paused || figureFocused || hoveredFeature !== null}
    >
      <div className="h2-shell">
        <div className="h2-security">
          <div>
            <h2 id="h2-security-title" className="h2-display h2-security__title">
              Custody and control, built in
            </h2>
            <div className="h2-security__items">
              {walletCapabilities.map((capability, index) => (
                <SecurityItem
                  key={capability.figure}
                  capability={capability}
                  index={index}
                  active={index === litFeature}
                  onPick={pickFeature}
                />
              ))}
            </div>
          </div>
          <div className="h2-security__visuals">
            <div className="h2-security__stage">
              <div
                className={`h2-security__view h2-security__grid${view === 'features' ? ' is-active' : ''}`}
                aria-hidden={view !== 'features'}
              >
                {walletCapabilities.map((capability, index) => (
                  <WalletCapabilityCell
                    key={capability.figure}
                    capability={capability}
                    index={index}
                    playing={index === playingFeature || index === trailingFeature}
                    lead={index === litFeature}
                    onHover={focusFeature}
                  />
                ))}
              </div>
              {view === 'signing' && (
                <div className="h2-security__view h2-security__signing is-active">
                  <WalletFigure figure="signing" playing={autoplay} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="h2-security__progress" aria-hidden="true">
        <span
          key={position.turn}
          className="h2-security__progress-fill"
          style={progressStyle}
          onAnimationEnd={advance}
        />
      </div>
      <div className="h2-pager" role="group" aria-label="Custody views">
        <button
          type="button"
          className="h2-pager__btn"
          aria-label="Previous custody view"
          onClick={switchView}
        >
          <ChevronLeft aria-hidden />
        </button>
        <button
          type="button"
          className="h2-pager__dots h2-security__pause"
          aria-label={paused ? 'Resume automatic cycling' : 'Pause automatic cycling'}
          aria-pressed={paused}
          onClick={setPaused.bind(null, !paused)}
        >
          <span className={`h2-pager__dot${view === 'features' ? ' is-active' : ''}`} aria-hidden />
          <span className={`h2-pager__dot${view === 'signing' ? ' is-active' : ''}`} aria-hidden />
        </button>
        <button
          type="button"
          className="h2-pager__btn"
          aria-label="Next custody view"
          onClick={switchView}
        >
          <ChevronRight aria-hidden />
        </button>
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
    src: '/wallet-preview/wallet-console-dashboard.png?v=3',
  },
  {
    id: 'audit' as const,
    label: 'Audit logs',
    blurb: 'Every action attributed, timestamped, and exportable',
    src: '/wallet-preview/wallet-console-audit.png?v=6',
  },
];

export function H2Start(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const dashboardProps = linkProps('/dashboard');
  const docsProps = linkProps('/docs/concepts/');
  const contactProps = linkProps(CONTACT_LINK_TARGET);
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

/* ---------- two products: the shop and the kitchen ---------- */

export function H2Duo(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const satyrProps = linkProps('/ecommerce');
  const bakeryProps = linkProps('/ecommerce#bakeryos');

  return (
    <section className="h2-section h2-section--snug h2-rule" aria-labelledby="h2-duo-title">
      <div className="h2-shell">
        <div className="h2-duo__head">
          <h2 id="h2-duo-title" className="h2-display">
            From the shop to the oven
          </h2>
          <p className="h2-duo__copy">
            Satyr runs the sales side of the business, and BakeryOS plans what the kitchen makes.
            Both work from the same orders.
          </p>
        </div>
        <div className="h2-duo__grid">
          <a className="h2-duo__panel" href={satyrProps.href} onClick={satyrProps.onClick}>
            <h3 className="h2-duo__title">
              <FieldTile field="azure-coral" icon={Store} />
              Satyr
            </h3>
            <p className="h2-duo__panel-copy">
              Agents run the online shop, menus, orders, payments and the inbox. Changes wait for
              your approval in Slack or in the Portal.
            </p>
            <div className="h2-duo__visual">
              <div className="h2-chat" style={{ maxWidth: 324 }}>
                <div className="h2-chat__bubble">
                  <small>Satyr · 09:14</small>
                  Approval needed: autumn menu, 14 items, 3 new prices.
                </div>
                <div className="h2-chat__bubble h2-chat__bubble--reply">
                  Approved ✓ the menu is live
                </div>
              </div>
            </div>
            <span className="h2-duo__cta">
              Explore Satyr
              <ArrowRightAnim size={12} />
            </span>
          </a>
          <a className="h2-duo__panel" href={bakeryProps.href} onClick={bakeryProps.onClick}>
            <h3 className="h2-duo__title">
              <FieldTile field="apricot-beam" icon={Croissant} />
              BakeryOS
            </h3>
            <p className="h2-duo__panel-copy">
              Orders and preorders become production runs. See each run as a workflow, a timeline of
              ovens and staff, and a 3D view of the bakery.
            </p>
            <div className="h2-duo__visual">
              <div className="h2-chat" style={{ maxWidth: 324 }}>
                <div className="h2-chat__bubble">
                  <small>BakeryOS · 06:02</small>
                  Saturday plan ready: 6 runs from 212 preorders. Oven 1 starts at 07:10.
                </div>
                <div className="h2-chat__bubble h2-chat__bubble--reply">Looks good ✓</div>
              </div>
            </div>
            <span className="h2-duo__cta">
              Explore BakeryOS
              <ArrowRightAnim size={12} />
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

type FaqItem = {
  q: string;
  a: string;
  more?: { label: string; to: string };
};

/* one footer column: a grey heading over its questions */
type FaqGroup = {
  heading: string;
  items: readonly FaqItem[];
};

const whatIsSatyr: FaqItem = {
  q: 'What is Satyr?',
  a: 'Satyr is an ecommerce suite for cafés and pâtisseries. Agents run the online shop, menus, orders, payments, the inbox and the bake plan, and they work with your team in Slack and in the Portal.',
  more: { label: 'Explore Satyr', to: '/ecommerce' },
};

const agentsFaq: FaqItem = {
  q: 'What can the agents do?',
  a: 'They draft and publish menus and product descriptions, answer customer and supplier mail with drafts that cite their sources, report failed payments and late orders, and turn orders into a bake plan. They act only through the access that you give them.',
  more: { label: 'Agent workflows', to: '/ecommerce#workflows' },
};

const controlFaq: FaqItem = {
  q: 'How do I stay in control?',
  a: 'Agents prepare changes, and an owner or admin approves them from a Slack card or in the Portal. A change that moves money is approved only in the Portal. Every action leaves a receipt.',
  more: { label: 'Approvals and receipts', to: '/ecommerce#control' },
};

const secretsFaq: FaqItem = {
  q: 'Do agents see our passwords and keys?',
  a: 'No. Logins and API keys stay in the Vault: the Satyr Vault or your own 1Password. Agents use them without seeing them, and no key enters a prompt or a transcript.',
};

const toolsFaq: FaqItem = {
  q: 'Which tools does Satyr connect to?',
  a: 'Slack, Gmail, Shopify, Square, Stripe, Google Drive, Dropbox, Notion and Airtable. Card payments go to your own Stripe or Square account.',
  more: { label: 'Integrations', to: '/#integrations' },
};

const modelsFaq: FaqItem = {
  q: 'Which AI models does Satyr use?',
  a: 'You choose. Sign in with your ChatGPT account, add your own OpenAI API key, or use the models that Satyr provides.',
};

const startFaq: FaqItem = {
  q: 'How do we get started?',
  a: 'Talk to us. We connect your shop, your Slack workspace and your mailbox with you, and we set the first approval rules together.',
  more: { label: 'Contact us', to: CONTACT_LINK_TARGET },
};

const footerFaqs = {
  home: [
    { heading: 'Product', items: [whatIsSatyr, agentsFaq] },
    { heading: 'Control', items: [controlFaq, secretsFaq] },
    { heading: 'Getting started', items: [startFaq, modelsFaq] },
  ],
  ecommerce: [
    { heading: 'Agents', items: [agentsFaq, toolsFaq] },
    { heading: 'Control', items: [controlFaq, secretsFaq] },
    { heading: 'Getting started', items: [startFaq, modelsFaq] },
  ],
} satisfies Record<string, readonly FaqGroup[]>;

type FooterFaqAudience = keyof typeof footerFaqs;

type FaqPopFrame = { left: number; top: number; w: number; h: number };

/* The footer FAQ, set like the link columns under it: a grey heading over
   each column, and each question a row with a chevron. Every answer opens
   below its question in one shared popover that moves and resizes between
   questions, as the navbar menus do. A hover opens the card and the
   pointer can move into it to reach its link; a click pins it open. */
function H2FooterFaq({ groups }: { groups: readonly FaqGroup[] }): React.JSX.Element {
  const CLOSE_DELAY_MS = 120;
  /* the card's inner padding, so the answer text lines up with the question */
  const POP_INSET_PX = 20;

  const { linkProps } = useSiteRouter();
  const baseId = React.useId();
  const entries = React.useMemo(
    () => groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.heading }))),
    [groups],
  );
  const rootRef = React.useRef<HTMLElement | null>(null);
  const triggerRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const paneRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const closeTimerRef = React.useRef<number | null>(null);
  const prevOpenRef = React.useRef<number | null>(null);
  const lastPointerRef = React.useRef<string>('mouse');
  const [open, setOpen] = React.useState<number | null>(null);
  const [pinned, setPinned] = React.useState<boolean>(false);
  const [frame, setFrame] = React.useState<FaqPopFrame | null>(null);
  // Move and resize only between questions; a first open snaps into place.
  const [morph, setMorph] = React.useState<boolean>(false);
  const [layoutTick, setLayoutTick] = React.useState<number>(0);

  const cancelClose = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(null);
      setPinned(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);

  React.useEffect(() => cancelClose, [cancelClose]);

  React.useLayoutEffect(() => {
    const previous = prevOpenRef.current;
    prevOpenRef.current = open;
    // Keep the last frame while closing so the card fades out in place.
    if (open === null) {
      setMorph(false);
      return;
    }
    const root = rootRef.current;
    const trigger = triggerRefs.current[open];
    const pane = paneRefs.current[open];
    if (!root || !trigger || !pane) return;
    const rootRect = root.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const w = pane.offsetWidth;
    const h = pane.offsetHeight;
    const left = Math.max(
      -POP_INSET_PX,
      Math.min(triggerRect.left - rootRect.left - POP_INSET_PX, rootRect.width - w + POP_INSET_PX),
    );
    // No gap: the card's padded top bridges the question to the card, so the
    // pointer never crosses the question below on its way in.
    const top = triggerRect.bottom - rootRect.top;
    setMorph(previous !== null && previous !== open);
    setFrame({ left, top, w, h });
  }, [open, layoutTick]);

  React.useEffect(() => {
    if (open === null) return;
    const onResize = () => setLayoutTick((tick) => tick + 1);
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(null);
      setPinned(false);
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const closeOnLeave = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse' || pinned) return;
    scheduleClose();
  };

  const close = () => {
    setOpen(null);
    setPinned(false);
  };

  let entryIndex = 0;

  return (
    <section
      ref={rootRef}
      className="h2-footer__faq"
      aria-labelledby={`${baseId}-title`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || open === null) return;
        triggerRefs.current[open]?.focus();
        close();
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && rootRef.current?.contains(next)) return;
        close();
      }}
    >
      <h2 id={`${baseId}-title`} className="h2-footer__faq-title">
        FAQs
      </h2>

      <div className="h2-footer__links">
        {groups.map((group) => (
          <div className="h2-footer__col" key={group.heading}>
            <h3>{group.heading}</h3>
            {group.items.map((item) => {
              const index = entryIndex++;
              return (
                <button
                  key={item.q}
                  ref={(el) => {
                    triggerRefs.current[index] = el;
                  }}
                  type="button"
                  id={`${baseId}-q-${index}`}
                  className={`h2-footer__faq-q${open === index ? ' is-open' : ''}`}
                  aria-expanded={open === index}
                  aria-controls={`${baseId}-a-${index}`}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'mouse') return;
                    cancelClose();
                    // a pinned card stays put while the pointer travels to it
                    if (pinned && open === index) return;
                    setPinned(false);
                    setOpen(index);
                  }}
                  onPointerLeave={closeOnLeave}
                  onPointerDown={(event) => {
                    lastPointerRef.current = event.pointerType;
                  }}
                  onClick={(event) => {
                    cancelClose();
                    // A mouse click pins the hover preview; a second click,
                    // like a keyboard or touch press, toggles it closed.
                    const isMouse = lastPointerRef.current === 'mouse' && event.detail > 0;
                    if (open === index && (pinned || !isMouse)) {
                      close();
                      return;
                    }
                    setOpen(index);
                    setPinned(true);
                  }}
                >
                  <span>{item.q}</span>
                  <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div
        className={`h2-faq-pop${open !== null ? ' is-open' : ''}${morph ? ' is-morphing' : ''}`}
        style={frame ? { left: frame.left, top: frame.top } : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') cancelClose();
        }}
        onPointerLeave={closeOnLeave}
      >
        <div className="h2-faq-pop__card">
          <div
            className="h2-faq-pop__shell"
            style={frame ? { width: frame.w, height: frame.h } : undefined}
          >
            {entries.map((item, index) => {
              const state =
                open === index
                  ? 'is-active'
                  : open !== null && index < open
                    ? 'is-before'
                    : 'is-after';
              const moreProps = item.more ? linkProps(item.more.to) : null;
              return (
                <div
                  key={`${item.group}-${item.q}`}
                  ref={(el) => {
                    paneRefs.current[index] = el;
                  }}
                  id={`${baseId}-a-${index}`}
                  role="region"
                  aria-labelledby={`${baseId}-q-${index}`}
                  className={`h2-faq-pop__pane ${state}`}
                >
                  <p className="h2-faq-pop__heading">{item.group}</p>
                  <p className="h2-faq-pop__answer">{item.a}</p>
                  {item.more && moreProps ? (
                    <a
                      className="h2-faq-pop__more"
                      href={moreProps.href}
                      onClick={moreProps.onClick}
                      tabIndex={open === index ? 0 : -1}
                    >
                      {item.more.label}
                      <ArrowRightAnim size={10} />
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
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

function getFooterGroups(t: Translate): { heading: string; links: H2FooterLink[] }[] {
  return [
    {
      heading: t('products'),
      links: [
        { label: 'Satyr', to: '/ecommerce' },
        { label: 'BakeryOS', to: '/ecommerce#bakeryos' },
        { label: 'Seams Wallet', to: '/wallet' },
      ],
    },
    {
      heading: 'Satyr',
      links: [
        { label: t('theSuite'), to: '/ecommerce#suite' },
        { label: t('agentWorkflows'), to: '/ecommerce#workflows' },
        { label: t('approvalsReceipts'), to: '/ecommerce#control' },
        { label: t('integrations'), to: '/#integrations' },
      ],
    },
    {
      heading: 'Seams Wallet',
      links: [
        { label: t('custodyModel'), to: '/docs/concepts/custody/' },
        { label: t('passkeys'), to: '/docs/concepts/auth-methods/passkeys' },
        { label: t('walletsSignatures'), to: '/docs/concepts/threshold-signing/' },
        { label: t('permissionsPolicy'), to: '/docs/concepts/policy/mandates' },
      ],
    },
    {
      heading: t('developers'),
      links: [
        { label: t('documentation'), to: '/docs/concepts/' },
        { label: t('architecture'), to: '/docs/concepts/architecture' },
        { label: t('guides'), to: '/docs/guides/' },
      ],
    },
    {
      heading: t('socials'),
      links: [
        { label: 'X', to: 'https://x.com/lowerarchy', external: true },
        { label: 'GitHub', to: 'https://github.com/seams-tech', external: true },
      ],
    },
    {
      heading: t('company'),
      links: [
        { label: t('about'), to: '/company/' },
        { label: t('blog'), to: '/company/#blog' },
        { label: t('contact'), to: CONTACT_LINK_TARGET },
      ],
    },
  ];
}

/* ---------- closing call to action: the shared banner ---------- */

const ctaCopy = {
  home: {
    field: 'azure-coral',
    title: 'Put agents to work in your café',
    sub: 'We connect the shop, Slack and your mailbox with you, and we set the first approval rules together.',
    secondary: { label: 'Explore Satyr', to: '/ecommerce' },
    primary: { label: 'Talk to us', to: CONTACT_LINK_TARGET },
  },
  ecommerce: {
    field: 'mauve-ember',
    title: 'See Satyr run your shop',
    sub: 'Tell us what you sell and where. We show you Satyr on your own shop.',
    secondary: { label: 'See the integrations', to: '/#integrations' },
    primary: { label: 'Talk to us', to: CONTACT_LINK_TARGET },
  },
} satisfies Record<
  string,
  {
    field: GrainFieldName;
    title: string;
    sub: string;
    secondary: { label: string; to: string };
    primary: { label: string; to: string };
  }
>;

export function H2Cta({ audience }: { audience: keyof typeof ctaCopy }): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const copy = ctaCopy[audience];
  const secondaryProps = linkProps(copy.secondary.to);
  const primaryProps = linkProps(copy.primary.to);

  return (
    <BannerSection id="h2-cta-title" field={copy.field} title={copy.title} sub={copy.sub}>
      <a
        className="h2-btn h2-btn--outline"
        href={secondaryProps.href}
        onClick={secondaryProps.onClick}
      >
        {copy.secondary.label}
        <ArrowRightAnim size={12} />
      </a>
      <a className="h2-btn h2-btn--primary" href={primaryProps.href} onClick={primaryProps.onClick}>
        {copy.primary.label}
        <ArrowRightAnim size={12} />
      </a>
    </BannerSection>
  );
}

export function H2Footer({ faq }: { faq?: FooterFaqAudience } = {}): React.JSX.Element {
  const t = useTranslation();
  const page = useSitePage();
  const footerGroups = getFooterGroups(t);
  const { linkProps } = useSiteRouter();
  const homeProps = linkProps('/');

  return (
    <footer className="h2-footer h2-rule" aria-label={t('siteFooter')}>
      <div className="h2-footer__inner">
        <div className="h2-footer__brand">
          <a href={homeProps.href} onClick={homeProps.onClick} aria-label={t('seamsHome')}>
            <SeamsWordmark height={20} />
          </a>
          {page.kind === 'translated' ? (
            <LanguageSelector page={page.page} placement="footer" />
          ) : null}
        </div>

        {faq ? <H2FooterFaq groups={footerFaqs[faq]} /> : null}

        <nav className="h2-footer__main h2-footer__links" aria-label={t('footerNavigation')}>
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
        </nav>
      </div>
    </footer>
  );
}
