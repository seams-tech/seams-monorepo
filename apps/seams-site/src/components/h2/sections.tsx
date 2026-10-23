import { useSitePage, useTranslation } from '@/i18n/browser';
import { translate, type Translate } from '@/i18n/catalog';
import type { Locale } from '@/i18n/locale';
import { LanguageSelector } from '@/i18n/LanguageSelector';
import React from 'react';
import {
  Bot,
  Check,
  ChevronDown,
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
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { EcosystemLattice } from '@/components/h2/EcosystemLattice';
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

/* Shared section library for the h2 marketing pages (/, /wallet, /ecommerce).
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

/* An icon on a small tile whose gradient field shows through only as a
   faint grey wash. */
function FieldTile({ field, icon: Icon }: { field: GrainFieldName; icon: TileIcon }) {
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
  field,
  title,
  sub,
  children,
}: {
  id: string;
  field: GrainFieldName;
  title: string;
  sub?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="h2-section h2-section--banner h2-rule" aria-labelledby={id}>
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
  const docsProps = linkProps('/docs/concepts/');

  return (
    <>
      <BannerSection
        id="h2-eco-title"
        field="teal-peach"
        title="Plugs into the tools stores already run"
        sub="Storefronts, payments, messaging, and support, connected through scoped credentials."
      >
        <a className="h2-btn h2-btn--outline" href={docsProps.href} onClick={docsProps.onClick}>
          Read the docs
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

type DrawPathProps = React.ComponentPropsWithoutRef<'path'>;
type DrawRectProps = React.ComponentPropsWithoutRef<'rect'>;
type DrawCircleProps = React.ComponentPropsWithoutRef<'circle'>;

function drawLayerClassName(className: string | undefined, layer: 'base' | 'overlay'): string {
  const prefix = className ? `${className} ` : '';
  return `${prefix}h2-draw__${layer}`;
}

function setDrawLength(element: SVGGeometryElement | null): void {
  if (!element) return;
  element.style.setProperty('--h2-draw-length', `${Math.ceil(element.getTotalLength()) + 2}px`);
}

function DrawPath({ className, ...props }: DrawPathProps): React.JSX.Element {
  return (
    <>
      <path {...props} pathLength={undefined} className={drawLayerClassName(className, 'base')} />
      <path
        {...props}
        pathLength={undefined}
        ref={setDrawLength}
        className={drawLayerClassName(className, 'overlay')}
      />
    </>
  );
}

function DrawRect({ className, ...props }: DrawRectProps): React.JSX.Element {
  return (
    <>
      <rect {...props} pathLength={undefined} className={drawLayerClassName(className, 'base')} />
      <rect
        {...props}
        pathLength={undefined}
        ref={setDrawLength}
        className={drawLayerClassName(className, 'overlay')}
      />
    </>
  );
}

function DrawCircle({ className, ...props }: DrawCircleProps): React.JSX.Element {
  return (
    <>
      <circle {...props} pathLength={undefined} className={drawLayerClassName(className, 'base')} />
      <circle
        {...props}
        pathLength={undefined}
        ref={setDrawLength}
        className={drawLayerClassName(className, 'overlay')}
      />
    </>
  );
}

const pairedKeyOutlinePath =
  'M16 0 A16 16 0 1 0 -16 0 A16 16 0 1 0 16 0 M0 16 V62 M-5 25 H5 M-4 33 H4 M0 52 H-6 M-6 48 V56';
const pairedKeyFirstPatternPath = 'M-12.8 -9.6 C2 -5 5 5 5 15.2 M-16 0 C-4 0 -5 9 -5 15.2';
const pairedKeySecondPatternPath = 'M12.8 -9.6 C-2 -5 -5 5 -5 15.2 M16 0 C4 0 5 9 5 15.2';

/* Two-lane MPC diagram (wallet page security section): the shares converge
   through a policy gate into one signed output. */
export function MpcSplitDiagram(): React.JSX.Element {
  return (
    <svg
      className="h2-mpc"
      viewBox="0 0 560 300"
      role="img"
      aria-label="A key split into two shares, one on the user's device and one in your infrastructure, combines through a policy check into a signature; 2-of-2 threshold, neither share signs alone"
    >
      {/* input lanes */}
      <text className="h2-mpc__kicker" x="28" y="54">
        USER{'’'}S DEVICE
      </text>
      <DrawRect
        className="h2-mpc__node"
        x="24"
        y="64"
        width="128"
        height="44"
        rx="12"
        pathLength="1"
      />
      <DrawPath
        className="h2-mpc__share-key-outline"
        d={pairedKeyOutlinePath}
        transform="translate(69 86) rotate(-90) scale(0.875)"
        vectorEffect="non-scaling-stroke"
        pathLength="1"
      />
      <DrawPath
        className="h2-mpc__share-key-detail"
        d={pairedKeyFirstPatternPath}
        transform="translate(69 86) rotate(-90) scale(0.875)"
        vectorEffect="non-scaling-stroke"
        pathLength="1"
      />

      <text className="h2-mpc__kicker" x="28" y="196">
        YOUR INFRASTRUCTURE
      </text>
      <DrawRect
        className="h2-mpc__node"
        x="24"
        y="206"
        width="128"
        height="44"
        rx="12"
        pathLength="1"
      />
      <DrawPath
        className="h2-mpc__share-key-outline"
        d={pairedKeyOutlinePath}
        transform="translate(69 228) rotate(-90) scale(0.875)"
        vectorEffect="non-scaling-stroke"
        pathLength="1"
      />
      <DrawPath
        className="h2-mpc__share-key-detail"
        d={pairedKeySecondPatternPath}
        transform="translate(69 228) rotate(-90) scale(0.875)"
        vectorEffect="non-scaling-stroke"
        pathLength="1"
      />

      <DrawCircle className="h2-mpc__terminal" cx="152" cy="86" r="2.5" />
      <DrawCircle className="h2-mpc__terminal" cx="152" cy="228" r="2.5" />
      <DrawPath className="h2-mpc__flow" d="M152 86 C214 86 226 148 268 151" />
      <DrawPath className="h2-mpc__flow" d="M152 228 C214 228 226 166 268 159" />
      <DrawCircle className="h2-mpc__terminal" cx="268" cy="151" r="2.5" />
      <DrawCircle className="h2-mpc__terminal" cx="268" cy="159" r="2.5" />

      {/* policy gate */}
      <DrawPath className="h2-mpc__guide" d="M300 112 V196" />
      <DrawPath
        className="h2-mpc__gate"
        d="M300 122 L328 132 V152 C328 168 316 180 300 186 C284 180 272 168 272 152 V132 L300 122"
        pathLength="1"
      />
      <DrawPath className="h2-mpc__gate-check" d="M290 152 L297 159 L311 143" pathLength="1" />
      <text className="h2-mpc__gatelabel" x="300" y="206" textAnchor="middle">
        policy check
      </text>

      {/* The approved path stays monochrome with the rest of the diagram. */}
      <DrawPath className="h2-mpc__out" d="M334 154 H414" pathLength="1" />
      <DrawPath className="h2-mpc__out" d="M408 148 L415 154 L408 160" pathLength="1" />
      <DrawRect
        className="h2-mpc__node h2-mpc__node--result"
        x="420"
        y="132"
        width="128"
        height="44"
        rx="12"
        pathLength="1"
      />
      <DrawPath
        className="h2-mpc__signature-mark"
        d="M450 161 C457 147 463 146 460 161 C469 153 476 148 473 160 C481 153 487 153 492 160 C499 166 506 151 514 157 M451 165 C471 162 493 164 518 161"
        pathLength="1"
      />
      <text className="h2-mpc__resultlabel" x="484" y="206" textAnchor="middle">
        Signed transaction
      </text>

      <text className="h2-mpc__note" x="280" y="284" textAnchor="middle">
        2-of-2 threshold {'·'} neither share signs alone
      </text>
    </svg>
  );
}

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

const pillars: Pillar[] = [
  {
    id: 'auth',
    label: 'Authentication',
    icon: Fingerprint,
    field: 'sky-sand',
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
    field: 'teal-peach',
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
    field: 'azure-coral',
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
    field: 'mauve-ember',
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
  const { linkProps } = useSiteRouter();
  const docsProps = linkProps('/docs/concepts/');
  const [active, setActive] = React.useState(0);
  const pillar = pillars[active];

  return (
    <>
      <BannerSection
        id="h2-pillars-title"
        field="teal-peach"
        title="One SDK for the whole account stack"
        sub="Authentication, wallets, credentials, and delegated access share one policy model."
      >
        <a className="h2-btn h2-btn--primary" href={docsProps.href} onClick={docsProps.onClick}>
          Explore documentation
          <ArrowRightAnim size={12} />
        </a>
      </BannerSection>
      <section className="h2-section h2-section--band h2-rule" aria-labelledby="h2-pillars-title">
        <div className="h2-shell">
          <div className="h2-pillars">
            <div className="h2-pillars__list" role="tablist" aria-label="Platform pillars">
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
    <>
      <BannerSection
        id="h2-bento-title"
        field="mauve-ember"
        title="Agents act only inside policy"
        sub="Every action runs through the same checks: permissions, limits, thresholds, expiry. Risky actions route to a human."
      />
      <section className="h2-section h2-section--bento h2-rule" aria-labelledby="h2-bento-title">
        <div className="h2-shell">
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
              <FieldTile field="azure-coral" icon={ListChecks} />
              <div>
                <h3 className="h2-bento__title">Roles &amp; limits</h3>
                <p className="h2-bento__copy">
                  Scope what support, ops, and agents can each do: amounts, actions, expiry.
                </p>
              </div>
            </div>
            <div className="h2-bento__card h2-bento__card--sm">
              <FieldTile field="mauve-ember" icon={ScrollText} />
              <div>
                <h3 className="h2-bento__title">Audit trail</h3>
                <p className="h2-bento__copy">
                  Every decision, allowed, held, or blocked, lands in an evidence trail you can
                  export.
                </p>
              </div>
            </div>
            <div className="h2-bento__card h2-bento__card--sm">
              <FieldTile field="aqua-evergreen" icon={KeyRound} />
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
    </>
  );
}

/* ---------- workflows (canvas + use-case covers) ---------- */

const useCases: readonly {
  title: string;
  field: GrainFieldName;
  coverLabel: string;
  copy: string;
}[] = [
  {
    title: 'Automate storefront ops',
    field: 'sky-sand',
    coverLabel: 'Storefront ops',
    copy: 'Let an agent watch cart abandonment, inventory alerts, and support tickets, then follow up, prepare refunds, and update listings inside the limits you set.',
  },
  {
    title: 'Delegate to staff safely',
    field: 'aqua-evergreen',
    coverLabel: 'Staff delegation',
    copy: 'Give part-time staff and contractors scoped credentials instead of shared logins. Limits and roles apply automatically; access expires on schedule.',
  },
  {
    title: 'Agent checkout with mandates',
    field: 'azure-coral',
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
  const { linkProps } = useSiteRouter();
  const docsProps = linkProps('/docs/concepts/policy/mandates');

  return (
    <>
      <BannerSection
        id="h2-cases-title"
        field="mauve-ember"
        title="Turn store operations into governed workflows"
        sub="Agents watch the store, prepare responses, and act inside the limits you set."
      >
        <a className="h2-btn h2-btn--primary" href={docsProps.href} onClick={docsProps.onClick}>
          Explore documentation
          <ArrowRightAnim size={12} />
        </a>
      </BannerSection>
      <section className="h2-section h2-section--band h2-rule" aria-labelledby="h2-cases-title">
        <div className="h2-shell">
          <H2WorkflowCanvas />

          <div className="h2-cases">
            {useCases.map((c) => (
              <div className="h2-case" key={c.title}>
                <div className="h2-case__cover" aria-hidden>
                  <GrainField field={c.field} />
                  <span>{c.coverLabel}</span>
                </div>
                <h3 className="h2-case__title">{c.title}</h3>
                <p className="h2-case__copy">{c.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------- security ---------- */

function LineArt({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" aria-hidden>
      {children}
    </svg>
  );
}

/* the right column pages between the capability grid and the signing diagram */
const securityViews = ['Custody primitives', 'Threshold signing'];
type SecurityView = 0 | 1;
const securityViewDurationMs = [6000, 6000] as const;

function nextSecurityView(view: SecurityView): SecurityView {
  return view === 0 ? 1 : 0;
}

export function H2Security(): React.JSX.Element {
  const [view, setView] = React.useState<SecurityView>(0);

  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timeout = window.setTimeout(
      () => setView((currentView) => nextSecurityView(currentView)),
      securityViewDurationMs[view],
    );

    return () => window.clearTimeout(timeout);
  }, [view]);

  return (
    <section
      className="h2-section h2-rule h2-section--pagerfoot"
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
              <h3>Policy checks before execution</h3>
              <p>
                Approvals, budgets, revocation, and replay checks run before transactions are
                signed, payments are sent, or API calls are made.
              </p>
            </div>
            <div className="h2-security__item">
              <h3>An audit trail for decisions</h3>
              <p>
                Review which actions were allowed, held, or blocked, with identity and policy
                context recorded in the audit log.
              </p>
            </div>
          </div>
          <div className="h2-security__stage">
            <div
              className={`h2-security__view${view === 0 ? ' is-active' : ''}`}
              aria-hidden={view !== 0}
            >
              <div className="h2-security__grid">
                <div className="h2-security__cell">
                  <LineArt>
                    <g strokeLinecap="round" strokeLinejoin="round">
                      <DrawPath
                        className="h2-lineart__primary"
                        d="M50 13 L80 30 V64 L50 81 L20 64 V30 Z"
                        pathLength="1"
                      />
                      <DrawPath
                        className="h2-lineart__hidden"
                        d="M50 13 V34 M20 64 L38 53.8 M62 53.8 L80 64"
                      />
                      <DrawPath
                        className="h2-lineart__secondary"
                        d="M20 30 L38 40.2 M62 40.2 L80 30 M50 62 V81"
                        pathLength="1"
                      />
                      <DrawPath
                        className="h2-lineart__share"
                        d="M50 34 L62 41 V55 L50 62 L38 55 V41 Z"
                        pathLength="1"
                      />
                      <DrawPath
                        className="h2-lineart__secondary"
                        d="M38 41 L50 48 L62 41 M50 48 V62"
                        pathLength="1"
                      />
                    </g>
                    <g className="h2-lineart__markers">
                      <DrawCircle className="h2-lineart__marker" cx="50" cy="13" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="20" cy="30" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="80" cy="30" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="20" cy="64" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="80" cy="64" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="50" cy="81" r="1.4" />
                    </g>
                  </LineArt>
                  <span>Split-key custody</span>
                </div>
                <div className="h2-security__cell">
                  <LineArt>
                    <DrawPath className="h2-lineart__guide" d="M50 7 V14 M50 84 V91" />
                    <g strokeLinecap="round" strokeLinejoin="round">
                      <DrawPath
                        className="h2-lineart__primary"
                        d="M50 14 L79 24 V46 C79 64 67 76 50 84 C33 76 21 64 21 46 V24 Z"
                        pathLength="1"
                      />
                      <DrawPath
                        className="h2-lineart__hidden"
                        d="M50 22 L72 30 V46 C72 59 63 69 50 76 C37 69 28 59 28 46 V30 Z"
                      />
                      <DrawPath
                        className="h2-lineart__accent"
                        d="M39 48 L47 56 L62 40"
                        pathLength="1"
                      />
                    </g>
                    <g className="h2-lineart__markers">
                      <DrawCircle className="h2-lineart__marker" cx="50" cy="14" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="50" cy="84" r="1.4" />
                    </g>
                  </LineArt>
                  <span>Policy engine</span>
                </div>
                <div className="h2-security__cell">
                  <LineArt>
                    <DrawPath
                      className="h2-lineart__guide"
                      d="M36 8 V15 M36 61 V68 M6 38 H13 M59 38 H66"
                    />
                    <DrawCircle className="h2-lineart__hidden" cx="36" cy="38" r="23" />
                    <g
                      transform="translate(36 38) rotate(-45)"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <DrawPath
                        className="h2-lineart__primary"
                        d={pairedKeyOutlinePath}
                        pathLength="1"
                      />
                      <DrawPath
                        className="h2-lineart__secondary"
                        d={pairedKeyFirstPatternPath}
                        pathLength="1"
                      />
                      <DrawPath
                        className="h2-lineart__secondary"
                        d={pairedKeySecondPatternPath}
                        pathLength="1"
                      />
                    </g>
                    <g className="h2-lineart__markers">
                      <DrawCircle className="h2-lineart__marker" cx="36" cy="15" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="13" cy="38" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="59" cy="38" r="1.4" />
                    </g>
                  </LineArt>
                  <span>Scoped credentials</span>
                </div>
                <div className="h2-security__cell">
                  <LineArt>
                    <g strokeLinecap="round" strokeLinejoin="round">
                      <DrawPath
                        className="h2-lineart__secondary"
                        d="M32 24 V14 H76 V76 H68"
                        pathLength="1"
                      />
                      <DrawPath className="h2-lineart__guide" d="M32 14 L24 24 M76 76 L68 86" />
                      <DrawPath
                        className="h2-lineart__primary"
                        d="M24 24 H55 L68 37 V86 H24 Z"
                        fill="var(--h2-bg)"
                        pathLength="1"
                      />
                      <DrawPath
                        className="h2-lineart__secondary"
                        d="M55 24 V37 H68 M31 35 H44"
                        pathLength="1"
                      />
                      <DrawPath
                        className="h2-lineart__secondary"
                        d="M37 45 H59 M37 55 H55 M37 65 H59 M37 75 H50"
                        pathLength="1"
                      />
                    </g>
                    <g className="h2-lineart__markers">
                      <DrawCircle className="h2-lineart__marker" cx="30" cy="45" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="30" cy="55" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="30" cy="65" r="1.4" />
                      <DrawCircle className="h2-lineart__marker" cx="30" cy="75" r="1.4" />
                    </g>
                  </LineArt>
                  <span>Audit log</span>
                </div>
              </div>
            </div>
            <div
              className={`h2-security__view${view === 1 ? ' is-active' : ''}`}
              aria-hidden={view !== 1}
            >
              <MpcSplitDiagram />
            </div>
          </div>
        </div>
      </div>
      {/* pager straddles the section's bottom rule, centered on the page */}
      <div className="h2-security__progress" aria-hidden="true">
        <span
          key={view}
          className="h2-security__progress-fill"
          style={{ animationDuration: `${securityViewDurationMs[view]}ms` }}
        />
      </div>
      <div className="h2-pager" role="group" aria-label="Custody views">
        <button
          type="button"
          className="h2-pager__btn"
          aria-label="Previous custody view"
          onClick={() => setView((currentView) => nextSecurityView(currentView))}
        >
          <ChevronLeft aria-hidden />
        </button>
        <span className="h2-pager__dots">
          {securityViews.map((name, i) => (
            <span
              key={name}
              className={`h2-pager__dot${i === view ? ' is-active' : ''}`}
              title={name}
            />
          ))}
        </span>
        <button
          type="button"
          className="h2-pager__btn"
          aria-label="Next custody view"
          onClick={() => setView((currentView) => nextSecurityView(currentView))}
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

/* ---------- two products, one account layer ---------- */

export function H2Duo(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const walletProps = linkProps('/wallet');
  const agentsProps = linkProps('/ecommerce');

  return (
    <>
      <BannerSection
        id="h2-duo-title"
        field="teal-peach"
        title="Two products, one account layer"
        sub="Built on the same keys, credentials, and policy engine."
      />
      <section className="h2-section h2-section--band h2-rule" aria-labelledby="h2-duo-title">
        <div className="h2-shell">
          <div className="h2-duo__grid">
            <a className="h2-duo__panel" href={walletProps.href} onClick={walletProps.onClick}>
              <h3 className="h2-duo__title">
                <FieldTile field="teal-peach" icon={Wallet} />
                Embedded Wallet
              </h3>
              <p className="h2-duo__panel-copy">
                Passkey-secured, non-custodial wallets for your users: recovery built in, every
                action signed, keys split so neither side can sign alone.
              </p>
              <div className="h2-duo__visual">
                <SplitKeyVisual />
              </div>
              <span className="h2-duo__cta">
                Explore Embedded Wallet
                <ArrowRightAnim size={12} />
              </span>
            </a>
            <a className="h2-duo__panel" href={agentsProps.href} onClick={agentsProps.onClick}>
              <h3 className="h2-duo__title">
                <FieldTile field="mauve-ember" icon={Bot} />
                Ecommerce Agents
              </h3>
              <p className="h2-duo__panel-copy">
                Give AI agents and staff scoped credentials to run your store: limits, approvals,
                and an audit trail on every action.
              </p>
              <div className="h2-duo__visual">
                <div className="h2-chat" style={{ maxWidth: 324 }}>
                  <div className="h2-chat__bubble">
                    <small>Seams Harness · 09:14</small>
                    Held: 12% discount for cart #8841 needs owner approval.
                  </div>
                  <div className="h2-chat__bubble h2-chat__bubble--reply">
                    Approved ✓ signed and sent
                  </div>
                </div>
              </div>
              <span className="h2-duo__cta">
                Explore Ecommerce Agents
                <ArrowRightAnim size={12} />
              </span>
            </a>
          </div>
        </div>
      </section>
    </>
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

const whatIsSeams: FaqItem = {
  q: 'What is Seams?',
  a: 'Seams is key and credential infrastructure for ecommerce: one SDK for authentication, non-custodial wallets, a credentials and permissions layer, and delegated access for staff and AI agents.',
  more: { label: 'Documentation', to: '/docs/concepts/' },
};

const agentsFaq: FaqItem = {
  q: 'What can AI agents do with Seams?',
  a: 'Agents get their own identity and scoped credentials. They can act on commerce events: follow-ups, refunds, listing updates, but only inside the merchant’s policy. Risky actions route to a human approval gate with passkey or biometric confirmation.',
  more: { label: 'Ecommerce Agents', to: '/ecommerce' },
};

const controlFaq: FaqItem = {
  q: 'How do merchants stay in control?',
  a: 'Policy runs before anything executes: roles, amount limits, thresholds, expiry, and revocation. Every decision is attributed and logged, and delegated credentials can be revoked at any time.',
  more: { label: 'Permissions & policy', to: '/docs/concepts/policy/mandates' },
};

const custodyFaq: FaqItem = {
  q: 'Is Seams custodial?',
  a: 'No. Signing keys are split between the user’s device and your infrastructure: neither side can sign alone, and exporting a key always requires a fresh authorized flow from the owner.',
  more: { label: 'Custody model', to: '/docs/concepts/custody/' },
};

const apiAuthFaq: FaqItem = {
  q: 'How does API authentication work?',
  a: 'Your backend authenticates with API keys; end users and agents authenticate with passkeys and scoped credentials. Signing always requires the user-side key share, so API keys alone can never move funds or export keys.',
  more: { label: 'Sign-in methods', to: '/docs/concepts/auth-methods/' },
};

const startFaq: FaqItem = {
  q: 'How do we get started?',
  a: 'The SDK is self-serve: install it, register an account with a passkey, and apply a policy template. For marketplaces and merchant fleets, contact us and we’ll plan the rollout together.',
  more: { label: 'Guides', to: '/docs/guides/' },
};

const meteringFaq: FaqItem = {
  q: 'How is usage metered?',
  a: 'Plans are based on monthly active users. Each user includes 300 signatures a month, pooled across your app. The first 300 users are free. See the pricing page for details.',
  more: { label: 'See pricing', to: '/pricing/' },
};

const footerFaqs = {
  home: [
    { heading: 'Product', items: [whatIsSeams, agentsFaq] },
    { heading: 'Security', items: [controlFaq, custodyFaq] },
    { heading: 'Getting started', items: [startFaq, meteringFaq] },
  ],
  ecommerce: [
    { heading: 'Agents', items: [agentsFaq, controlFaq] },
    { heading: 'Security', items: [custodyFaq, apiAuthFaq] },
    { heading: 'Getting started', items: [startFaq, meteringFaq] },
  ],
} satisfies Record<string, readonly FaqGroup[]>;

type FooterFaqAudience = keyof typeof footerFaqs;

function pricingFaqs(locale: Locale): readonly FaqItem[] {
  const t = translate.bind(null, locale);
  return [
    {
      q: t('faqUserQ'),
      a: t('faqUserA'),
    },
    {
      q: t('faqPoolQ'),
      a: t('faqPoolA'),
    },
    {
      q: t('faqDevQ'),
      a: t('faqDevA'),
    },
    {
      q: t('faqGasQ'),
      a: t('faqGasA'),
    },
    {
      q: t('faqGrowthQ'),
      a: t('faqGrowthA'),
    },
    {
      q: t('faqCardQ'),
      a: t('faqCardA'),
    },
    {
      q: t('faqOneQ'),
      a: t('faqOneA'),
    },
  ];
}

function renderFaqItem(item: FaqItem): React.JSX.Element {
  return (
    <details key={item.q}>
      <summary>{item.q}</summary>
      <p>{item.a}</p>
    </details>
  );
}

/* The pricing page's FAQ section; the product pages carry theirs in the
   footer. */
export function H2Faq(): React.JSX.Element {
  const t = useTranslation();
  const page = useSitePage();
  return (
    <section className="h2-section h2-rule" aria-labelledby="h2-faq-title">
      <div className="h2-shell">
        <div className="h2-faq">
          <h2 id="h2-faq-title" className="h2-display h2-faq__title">
            {t('faqTitle')}
          </h2>
          <div className="h2-faq__list">{pricingFaqs(page.locale).map(renderFaqItem)}</div>
        </div>
      </div>
    </section>
  );
}

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
        { label: t('embeddedWallet'), to: '/wallet' },
        { label: t('ecommerceAgents'), to: '/ecommerce' },
        { label: t('custodyModel'), to: '/docs/concepts/custody/' },
        { label: t('walletSessions'), to: '/docs/concepts/sessions/wallet-sessions' },
      ],
    },
    {
      heading: t('platform'),
      links: [
        { label: t('authentication'), to: '/docs/concepts/auth-methods/' },
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
        { label: t('walletIframe'), to: '/docs/concepts/custody/wallet-iframe' },
      ],
    },
    {
      heading: t('resources'),
      links: [
        { label: t('guides'), to: '/docs/guides/' },
        { label: t('useCases'), to: '/docs/use-cases/' },
        { label: t('pricing'), to: '/pricing/' },
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
    field: 'teal-peach',
    title: 'Build with the Seams SDK',
    sub: 'Passkey sign-in, split-key wallets, and account recovery. Free for up to 300 users.',
    secondary: { label: 'Explore docs', to: '/docs/' },
    primary: { label: 'Start building', to: '/dashboard' },
  },
  ecommerce: {
    field: 'mauve-ember',
    title: 'Put agents to work on your store',
    sub: 'Scoped credentials, approvals, and an audit trail on every action.',
    secondary: { label: 'Talk to us', to: CONTACT_LINK_TARGET },
    primary: { label: 'Start building', to: '/docs/concepts/policy/mandates' },
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
