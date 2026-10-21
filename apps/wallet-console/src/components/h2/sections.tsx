import React from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  LifeBuoy,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import type { HostedAuthMenuMode } from '@seams/wallet/react';
import { WalletDemoSlot } from './WalletDemoSlot';
import SeamsWordmark from '@/components/icons/SeamsWordmark';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { WalletFigure, type WalletFigureName } from '@/components/h2/WalletFigure';
import { NETWORK_MARKS, NetworkMarkLockup } from '@/components/icons/NetworkMarks';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import '@/styles/h2.css';

/* Shared section library for the h2 marketing pages (/, /wallet, /ecommerce).
   Every component renders inside a `.h2-page > .h2-col` wrapper and styles
   itself from src/styles/h2.css. */

/* ---------- demo hero ---------- */

/* Compact product forks under the CTAs, each on its own moving gradient chip */
const productForks: readonly { label: string; to: string; field: GrainFieldName }[] = [
  { label: 'Wallet', to: '/wallet', field: 'teal-peach' },
  { label: 'Harness', to: 'https://seams.sh/ecommerce', field: 'mauve-ember' },
  { label: 'API', to: '/docs/concepts/', field: 'azure-coral' },
];

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
  const startProps = linkProps('/docs/');
  const authProps = linkProps('/docs/guides/authentication');

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
              <ArrowRightAnim size={12} />
            </a>
            <a className="h2-btn h2-btn--outline" href={authProps.href} onClick={authProps.onClick}>
              How auth works
              <ArrowRightAnim size={12} />
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

        <WalletDemoSlot
          authDefaultModeWhenNoDetectedAccount={authDefaultModeWhenNoDetectedAccount}
        />
      </div>
    </header>
  );
}

/* ---------- networks ---------- */

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
  /* How long the figure plays from the start of its turn: its play, then a
     beat to read it. Turns start FEATURE_STAGGER_MS apart, so a longer play
     runs on beside the next figure. */
  playMs: number;
};

const walletCapabilities: readonly WalletCapability[] = [
  {
    figure: 'keychain',
    label: 'Keys you control',
    title: 'Non-custodial',
    copy: 'Neither the user’s device nor your infrastructure can sign alone.',
    playMs: 3600,
  },
  {
    figure: 'interlock',
    label: 'Scoped permissions',
    title: 'Permissions',
    copy: 'Set what apps and agents can do. Checks run before signing.',
    playMs: 5600,
  },
  {
    figure: 'devices',
    label: 'Linked devices',
    title: 'Multiple devices',
    copy: 'Link another device for access and recovery.',
    playMs: 3600,
  },
  {
    figure: 'infrastructure',
    label: 'Self-hostable',
    title: 'Self-hosted',
    copy: 'Run signing on your own serverless infrastructure.',
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
      <h3>
        <button type="button" className="h2-security__pick" aria-pressed={active} onClick={picked}>
          {capability.title}
        </button>
      </h3>
      <p>{capability.copy}</p>
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
    src: '/wallet-preview/wallet-console-dashboard.png?v=1',
  },
  {
    id: 'audit' as const,
    label: 'Observability',
    src: '/wallet-preview/wallet-console-audit.png?v=1',
    callout: 'Export to CSV in one click',
  },
];

type ConsoleScreenId = (typeof CONSOLE_SCREENS)[number]['id'];

type ApiNoteProps = {
  title: string;
  body: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  field: GrainFieldName;
};

const ACCOUNT_NOTES: readonly ApiNoteProps[] = [
  {
    title: 'Passkey sign-up',
    body: 'A non-custodial wallet in one call',
    icon: Fingerprint,
    field: 'sky-sand',
  },
  { title: 'Recovery', body: 'Email or a linked device', icon: LifeBuoy, field: 'glacier-ink' },
];

const POLICY_NOTES: readonly ApiNoteProps[] = [
  {
    title: 'Signing sessions',
    body: 'An expiry and a use limit per unlock',
    icon: Timer,
    field: 'azure-coral',
  },
  {
    title: 'Approvals',
    body: 'The owner confirms in the wallet',
    icon: ShieldCheck,
    field: 'mauve-ember',
  },
];

/* A note with its icon in white on a gradient tile that flows while it is
   on screen. */
function ApiNote({ title, body, icon: Icon, field }: ApiNoteProps): React.JSX.Element {
  return (
    <div className="h2-apinote">
      <div className="h2-apinote__tile" aria-hidden>
        <GrainField field={field} />
        <Icon size={18} strokeWidth={1.7} />
      </div>
      <div className="h2-apinote__text">
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
    </div>
  );
}

/* A wide banner spreads each colour over its width, so the site's flow barely
   shows on it; this much more keeps its movement subtle but visible. */
const BANNER_FLOW = 3;

/* A grey banner that fades into a moving gradient while it is in view, and
   back to grey once it leaves. */
export function FieldBanner({
  field,
  className,
  children,
}: {
  field: GrainFieldName;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  const [lit, setLit] = React.useState(false);

  React.useEffect(() => {
    const banner = ref.current;
    if (!banner) return undefined;
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
    <div
      ref={ref}
      className={`${className ? `${className} ` : ''}h2-banner h2-banner--field${lit ? ' is-lit' : ''}`}
    >
      <GrainField field={field} playing={lit} flow={BANNER_FLOW} />
      {children}
    </div>
  );
}

export function H2Start(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const dashboardProps = linkProps('/dashboard');
  const docsProps = linkProps('/docs/concepts/');
  /* Which console screen is on stage. The active tab's progress line is a
     CSS animation; its `animationend` advances to the next screen, so
     pausing the animation (pointer on the band, band off screen) pauses the
     cycle with no timer to keep in step. Reduced motion drops the animation,
     which leaves the tabs as plain manual controls. */
  const [consoleFocus, setConsoleFocus] = React.useState<ConsoleScreenId>('overview');
  const [consolePointerHeld, setConsolePointerHeld] = React.useState(false);
  const [consoleFocusHeld, setConsoleFocusHeld] = React.useState(false);
  const [consoleInView, setConsoleInView] = React.useState(false);
  const consoleBandRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const band = consoleBandRef.current;
    if (!band || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setConsoleInView(entry.isIntersecting), {
      threshold: 0.35,
    });
    observer.observe(band);
    return () => observer.disconnect();
  }, []);

  const advanceConsole = () => {
    const index = CONSOLE_SCREENS.findIndex((screen) => screen.id === consoleFocus);
    setConsoleFocus(CONSOLE_SCREENS[(index + 1) % CONSOLE_SCREENS.length].id);
  };

  return (
    <section
      className="h2-section h2-section--flush-bottom h2-section--banner h2-rule"
      aria-labelledby="h2-start-title"
    >
      <FieldBanner field="teal-peach" className="h2-starthead">
        <h2 id="h2-start-title" className="h2-display h2-banner__title">
          Add wallets and permissions with a few API calls
        </h2>
        <div className="h2-banner__actions">
          <a className="h2-btn h2-btn--primary" href={docsProps.href} onClick={docsProps.onClick}>
            Explore documentation
            <ArrowRightAnim size={12} />
          </a>
        </div>
      </FieldBanner>

      {/* row 1: accounts & wallets API */}
      <div className="h2-startrow h2-rule h2-rule--midtick">
        <div className="h2-shell h2-startrow__grid">
          <div className="h2-startrow__text">
            <h3>Accounts and Wallets API</h3>
            <p>One passkey creates the account and its wallet. Recovery is built in.</p>
            <div className="h2-startrow__notes">
              {ACCOUNT_NOTES.map((note) => (
                <ApiNote key={note.title} {...note} />
              ))}
            </div>
          </div>
          {/* the documented setup and registration calls of @seams/wallet
              (seams-wallet apps/docs/src/examples/setup.tsx and
              registration-input.ts) */}
          <div className="h2-code h2-code--lg" aria-label="Register a wallet with the SDK">
            <span className="tok-kw">import</span>
            {' {\n  seamsTestnetConfig,\n  useSeams,\n} '}
            <span className="tok-kw">from</span>{' '}
            <span className="tok-str">'@seams/wallet/react'</span>
            {';\n'}
            <span className="tok-kw">import</span>
            {' { parseWebAuthnRpId } '}
            <span className="tok-kw">from</span>{' '}
            <span className="tok-str">'@seams/wallet/advanced'</span>
            {';\n\n'}
            <span className="tok-kw">const</span>
            {' config = seamsTestnetConfig({\n  '}
            <span className="tok-prop">walletOrigin</span>
            {': '}
            <span className="tok-str">'https://wallet.example.com'</span>
            {',\n  '}
            <span className="tok-prop">relayerUrl</span>
            {': '}
            <span className="tok-str">'https://relayer.example.com'</span>
            {',\n  '}
            <span className="tok-prop">publishableKey</span>
            {': '}
            <span className="tok-str">'YOUR_PUBLISHABLE_KEY'</span>
            {',\n});\n\n'}
            <span className="tok-cm">{'// inside <SeamsWebProvider config={config}>\n'}</span>
            <span className="tok-kw">const</span>
            {' { registerWallet } = useSeams();\n'}
            <span className="tok-kw">const</span>
            {' rpId = parseWebAuthnRpId('}
            <span className="tok-str">'wallet.example.com'</span>
            {');\n'}
            <span className="tok-kw">if</span>
            {' (!rpId.ok) '}
            <span className="tok-kw">throw new</span>
            {' Error(rpId.error.message);\n\n'}
            <span className="tok-kw">const</span>
            {' result = '}
            <span className="tok-kw">await</span>
            {' registerWallet({\n  '}
            <span className="tok-prop">authMethod</span>
            {': { '}
            <span className="tok-prop">kind</span>
            {': '}
            <span className="tok-str">'passkey'</span>
            {', '}
            <span className="tok-prop">rpId</span>
            {': rpId.value },\n  '}
            <span className="tok-prop">wallet</span>
            {': { '}
            <span className="tok-prop">kind</span>
            {': '}
            <span className="tok-str">'server_allocated'</span>
            {' },\n  signerSelection, '}
            <span className="tok-cm">{'// which chain signers to create'}</span>
            {'\n});'}
          </div>
        </div>
      </div>

      {/* row 2: sessions and approvals API */}
      <div className="h2-startrow h2-rule h2-rule--midtick">
        <div className="h2-shell h2-startrow__grid">
          <div className="h2-startrow__text">
            <h3>Sessions and Approvals API</h3>
            <p>
              One unlock opens a signing session with limits. Transactions that matter wait for the
              owner.
            </p>
            <div className="h2-startrow__notes">
              {POLICY_NOTES.map((note) => (
                <ApiNote key={note.title} {...note} />
              ))}
            </div>
          </div>
          {/* the public unlock option and the documented confirmation config
              of @seams/wallet (seams-wallet core/types/sdkSentEvents.ts and
              apps/docs/src/examples/transaction-review.tsx) */}
          <div
            className="h2-code h2-code--lg"
            aria-label="Open a signing session and require approval"
          >
            <span className="tok-kw">import</span>
            {' { transfer, useSeams, useWallet } '}
            <span className="tok-kw">from</span>
            {'\n  '}
            <span className="tok-str">'@seams/wallet/react'</span>
            {';\n\n'}
            <span className="tok-kw">const</span>
            {' { unlock } = useSeams();\n'}
            <span className="tok-kw">const</span>
            {' { near } = useWallet();\n\n'}
            <span className="tok-cm">{'// a session: 15 minutes or 5 signatures\n'}</span>
            <span className="tok-kw">await</span>
            {' unlock(walletId, {\n  '}
            <span className="tok-prop">signingSession</span>
            {': { '}
            <span className="tok-prop">ttlMs</span>
            {': 15 * 60_000, '}
            <span className="tok-prop">remainingUses</span>
            {': 5 },\n});\n\n'}
            <span className="tok-cm">{'// the owner confirms this transfer\n'}</span>
            <span className="tok-kw">await</span>
            {' near.signAndSendTransaction({\n  '}
            <span className="tok-prop">receiverId</span>
            {': near.accountId,\n  '}
            <span className="tok-prop">actions</span>
            {': [transfer('}
            <span className="tok-str">'0'</span>
            {')],\n  '}
            <span className="tok-prop">options</span>
            {': {\n    '}
            <span className="tok-prop">confirmationConfig</span>
            {': {\n      '}
            <span className="tok-prop">uiMode</span>
            {': '}
            <span className="tok-str">'modal'</span>
            {',\n      '}
            <span className="tok-prop">behavior</span>
            {': '}
            <span className="tok-str">'requireClick'</span>
            {',\n    },\n  },\n});'}
          </div>
        </div>
      </div>

      {/* row 3: wallet console — a gradient heading banner, then tabs over a
          tinted stage that shows one console screen at a time, cropped by
          the open bottom edge. The banner row's top rule closes the split
          API rows above, so it carries their middle tick. */}
      <div className="h2-consolehead h2-rule h2-rule--midtick">
        <FieldBanner field="teal-peach">
          <div>
            <h3 className="h2-display h2-banner__title">Wallet console</h3>
            <p className="h2-banner__sub">
              Manage wallets, policies, and your team in one place. No code needed.
            </p>
          </div>
          <div className="h2-banner__actions">
            <a
              className="h2-btn h2-btn--primary"
              href={dashboardProps.href}
              onClick={dashboardProps.onClick}
            >
              Open wallet console
              <ArrowRightAnim size={12} />
            </a>
          </div>
        </FieldBanner>
      </div>
      {/* no rule above: the switch and stage read as the banner's own row */}
      <div className="h2-startrow">
        <div
          ref={consoleBandRef}
          className="h2-shell h2-consoleband"
          data-cycling={consoleInView && !consolePointerHeld && !consoleFocusHeld ? '' : undefined}
          onPointerEnter={() => setConsolePointerHeld(true)}
          onPointerLeave={() => setConsolePointerHeld(false)}
          // keyboard focus holds the screen; a clicked tab keeps focus after
          // the pointer leaves, so mouse focus must not
          onFocus={(event) => setConsoleFocusHeld(event.target.matches(':focus-visible'))}
          onBlur={() => setConsoleFocusHeld(false)}
        >
          {/* The switch sits on the stage's top border, as the component
              showcase's selector sits on its section rule. It lives outside
              the stage because the stage clips its cards. `aria-pressed`
              rather than tabs: the stage is an image, so there is no tab
              panel for a tab to own. */}
          <div className="h2-consoleband__stagewrap">
            <div className="h2-consoleband__switch" role="group" aria-label="Show a console screen">
              {CONSOLE_SCREENS.map((screen) => {
                const selected = consoleFocus === screen.id;
                return (
                  <button
                    key={screen.id}
                    type="button"
                    className={`h2-consoleband__choice${selected ? ' is-active' : ''}`}
                    aria-pressed={selected}
                    onClick={() => setConsoleFocus(screen.id)}
                  >
                    {selected ? (
                      <span
                        className="h2-consoleband__progress"
                        aria-hidden="true"
                        onAnimationEnd={advanceConsole}
                      />
                    ) : null}
                    <span className="h2-consoleband__dot" aria-hidden="true" />
                    {screen.label}
                  </button>
                );
              })}
            </div>
            <div
              className="h2-consoleband__stage"
              role="img"
              aria-label={`Wallet console overview and observability pages, ${CONSOLE_SCREENS.find((screen) => screen.id === consoleFocus)?.label} in front`}
            >
              {CONSOLE_SCREENS.map((screen) => (
                // the back card is a pointer shortcut to the same switch as
                // its button; the switch stays the accessible control
                <div
                  key={screen.id}
                  className={`h2-consoleband__screen${consoleFocus === screen.id ? ' is-active' : ''}`}
                  onClick={() => setConsoleFocus(screen.id)}
                >
                  <img
                    src={screen.src}
                    alt=""
                    width={2970}
                    height={1680}
                    loading="lazy"
                    decoding="async"
                  />
                  {'callout' in screen ? (
                    <span
                      className={`h2-consoleband__callout h2-consoleband__callout--${screen.id}`}
                    >
                      {screen.callout}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
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
  more?: { label: string; to: string };
};

/* one footer column: a grey heading over its questions */
type FaqGroup = {
  heading: string;
  items: readonly FaqItem[];
};

type FaqAudience = 'home' | 'wallet';

const faqs: Record<FaqAudience, readonly FaqGroup[]> = {
  home: [
    {
      heading: 'Seams',
      items: [
        {
          q: 'What is Seams?',
          a: 'Seams is key and credential infrastructure for ecommerce: one SDK for authentication, non-custodial wallets, a credentials and permissions layer, and delegated access for staff and AI agents.',
        },
        {
          q: 'How do we get started?',
          a: 'The SDK is self-serve: install it, register an account with a passkey, and apply a policy template. For marketplaces and merchant fleets, contact us and we’ll plan the rollout together.',
        },
      ],
    },
    {
      heading: 'Agents',
      items: [
        {
          q: 'What can AI agents do with Seams?',
          a: 'Agents get their own identity and scoped credentials. They can act on commerce events: follow-ups, refunds, listing updates, but only inside the merchant’s policy. Risky actions route to a human approval gate with passkey or biometric confirmation.',
        },
        {
          q: 'How do merchants stay in control?',
          a: 'Policy runs before anything executes: roles, amount limits, thresholds, expiry, and revocation. Every decision is attributed and logged, and delegated credentials can be revoked at any time.',
        },
      ],
    },
  ],
  wallet: [
    {
      heading: 'Security',
      items: [
        {
          q: 'Is Seams custodial?',
          a: 'No. Signing keys are split between the user’s device and your infrastructure: neither side can sign alone, and exporting a key always requires a fresh authorized flow from the owner.',
          more: { label: 'The custody model', to: '/docs/concepts/custody/' },
        },
        {
          q: 'What if a user loses their device?',
          a: 'They recover on a new device with their email or recovery code, then add a new passkey. The wallet and its address stay the same, so no funds have to move.',
          more: { label: 'Wallet sessions', to: '/docs/concepts/sessions/wallet-sessions' },
        },
      ],
    },
    {
      heading: 'Integration',
      items: [
        {
          q: 'How do API keys work?',
          a: 'Your backend authenticates with API keys; end users and agents authenticate with passkeys and scoped credentials. Signing always requires the user-side key share, so API keys alone can never move funds or export keys.',
          more: { label: 'Sign-in methods', to: '/docs/concepts/auth-methods/' },
        },
        {
          q: 'Which networks are supported?',
          a: 'Ethereum and EVM networks, NEAR, Stripe Tempo, Circle Arc, Hyperliquid, and Polygon today, with more networks added as merchant demand grows.',
        },
      ],
    },
    {
      heading: 'Hosting & pricing',
      items: [
        {
          q: 'Can we run Seams ourselves?',
          a: 'Yes. Use the hosted service, or run signing on your own serverless infrastructure. The SDK and the custody model are the same either way.',
          more: { label: 'Architecture', to: '/docs/concepts/architecture' },
        },
        {
          q: 'How is usage metered?',
          a: 'Plans are based on monthly active wallets, with overage pricing as you grow: from a free tier for launch through usage-based Growth and Professional plans.',
          more: { label: 'See pricing', to: '/pricing/' },
        },
      ],
    },
  ],
};

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
                  {item.q.slice(0, item.q.lastIndexOf(' ') + 1)}
                  {/* the last word and the chevron never wrap apart */}
                  <span className="h2-footer__faq-tail">
                    {item.q.slice(item.q.lastIndexOf(' ') + 1)}
                    <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
                  </span>
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
                  key={item.q}
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
    ],
  },
];

/* ---------- closing call to action: the shared grey banner ---------- */

export function H2Cta(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const docsProps = linkProps('/docs/');
  const startProps = linkProps('/dashboard');

  return (
    <section className="h2-section h2-section--banner h2-rule" aria-labelledby="h2-cta-title">
      <FieldBanner field="teal-peach">
        <div>
          <h2 id="h2-cta-title" className="h2-display h2-banner__title">
            Wallets your users can never lose
          </h2>
          <p className="h2-banner__sub">Passkeys, split keys and recovery in one SDK.</p>
        </div>
        <div className="h2-banner__actions">
          <a className="h2-btn h2-btn--outline" href={docsProps.href} onClick={docsProps.onClick}>
            Explore docs
            <ArrowRightAnim size={12} />
          </a>
          <a className="h2-btn h2-btn--primary" href={startProps.href} onClick={startProps.onClick}>
            Start building
            <ArrowRightAnim size={12} />
          </a>
        </div>
      </FieldBanner>
    </section>
  );
}

type H2FooterProps = {
  /* pages with an FAQ show it as the footer's first row, above the links */
  faq?: FaqAudience;
};

export function H2Footer({ faq }: H2FooterProps): React.JSX.Element {
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

          <div className="h2-footer__main">
            {faq ? <H2FooterFaq groups={faqs[faq]} /> : null}

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
                        {...(link.external
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : null)}
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
      </div>
    </footer>
  );
}
