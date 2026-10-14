import React from 'react';
import { Bot, ListChecks, ScrollText, ShieldCheck, Wallet } from 'lucide-react';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import SeamsLogo from '@/components/icons/SeamsLogo';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import {
  H2Ecosystem,
  H2Faq,
  H2Footer,
  H2Pillars,
  H2Security,
  SplitKeyVisual,
} from '@/components/h2/sections';
import '@/styles/h2.css';

function HomeHeroCurrent(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const startProps = linkProps('/docs/concepts/');
  const contactProps = linkProps('/contact/');

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
    </>
  );
}

type AgentMediaItemId = 'operations' | 'wallet' | 'approval' | 'audit';

type AgentMediaItem = {
  id: AgentMediaItemId;
  icon: React.ComponentType<{ 'aria-hidden'?: boolean }>;
  image: string;
  label: string;
  title: string;
  copy: string;
};

const defaultAgentMediaItemId: AgentMediaItemId = 'operations';

const agentMediaItems: readonly AgentMediaItem[] = [
  {
    id: 'operations',
    icon: ListChecks,
    image: '/gradients/web/ember-moss.jpg',
    label: 'Store operations',
    title: 'Discount request held',
    copy: 'Agent proposes 12% off cart #8841. Policy routes it to owner approval.',
  },
  {
    id: 'wallet',
    icon: Wallet,
    image: '/gradients/web/sage-charcoal.jpg',
    label: 'Wallet signing',
    title: 'Passkey unlock',
    copy: 'The right user and key approve the signature before any wallet action runs.',
  },
  {
    id: 'approval',
    icon: ShieldCheck,
    image: '/gradients/web/aqua-evergreen.jpg',
    label: 'Approval',
    title: 'Policy gate',
    copy: 'High-risk actions pause for owner review while routine work keeps moving.',
  },
  {
    id: 'audit',
    icon: ScrollText,
    image: '/gradients/web/dusk-blue-mauve.jpg',
    label: 'Audit',
    title: 'Action receipt',
    copy: 'Every agent action records who delegated it, what ran, and which policy approved it.',
  },
];

function parseAgentMediaItemId(value: string | undefined): AgentMediaItemId | null {
  switch (value) {
    case 'operations':
    case 'wallet':
    case 'approval':
    case 'audit':
      return value;
    default:
      return null;
  }
}

function readAgentMediaItemId(target: EventTarget | null): AgentMediaItemId | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const button = target.closest<HTMLButtonElement>('[data-agent-media-id]');
  return parseAgentMediaItemId(button?.dataset.agentMediaId);
}

function renderAgentMediaCard(
  item: AgentMediaItem,
  activeMediaItemId: AgentMediaItemId,
): React.JSX.Element {
  const Icon = item.icon;
  const isActive = item.id === activeMediaItemId;

  return (
    <button
      key={item.id}
      type="button"
      className={`h2-agent-card ${isActive ? 'is-active' : 'is-collapsed'}`}
      data-agent-media-id={item.id}
      aria-label={`Show ${item.label}`}
      aria-pressed={isActive}
    >
      <img src={item.image} alt="" />
      <span className="h2-agent-card__label">
        <Icon aria-hidden />
        {item.label}
      </span>
      <span className="h2-agent-card__caption">
        <strong>{item.title}</strong>
        {item.copy}
      </span>
    </button>
  );
}

function HomeHeroMedia(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const startProps = linkProps('/docs/concepts/');
  const contactProps = linkProps('/contact/');
  const agentsProps = linkProps('/ecommerce');
  const [activeMediaItemId, setActiveMediaItemId] =
    React.useState<AgentMediaItemId>(defaultAgentMediaItemId);
  const handleMediaRailClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const itemId = readAgentMediaItemId(event.target);

    if (itemId === null) {
      return;
    }

    setActiveMediaItemId(itemId);
  }, []);

  return (
    <>
      <header className="h2-hero-media" aria-labelledby="h2-home2-title">
        <div className="h2-shell h2-hero-media__split">
          <div className="h2-hero-media__main">
            <p className="h2-hero-media__product">
              <SeamsLogo size={20} />
              <span>Seams Agents</span>
            </p>
            <h1 id="h2-home2-title" className="h2-display h2-hero-media__title">
              Commerce agents that stay inside policy
            </h1>
            <div className="h2-hero-media__ctas">
              <a
                className="h2-btn h2-btn--primary h2-btn--lg"
                href={startProps.href}
                onClick={startProps.onClick}
              >
                Create an agent
              </a>
              <a
                className="h2-btn h2-btn--outline h2-btn--lg"
                href={contactProps.href}
                onClick={contactProps.onClick}
              >
                Talk to sales
              </a>
            </div>
          </div>
          <aside className="h2-hero-media__copy" aria-label="Seams agent account summary">
            <p>
              Configure, deploy, and monitor AI agents for store operations. Seams gives every agent
              scoped credentials, spending limits, owner approvals, and an audit trail.
            </p>
          </aside>
        </div>
      </header>

      <section className="h2-agent-media h2-rule" aria-label="Seams agent use cases">
        <div className="h2-shell">
          <div
            className={`h2-agent-media__rail is-active-${activeMediaItemId}`}
            onClick={handleMediaRailClick}
          >
            {agentMediaItems.map((item) => renderAgentMediaCard(item, activeMediaItemId))}
          </div>

          <div className="h2-agent-chat-pill" aria-hidden="true">
            <SeamsLogo size={38} />
            <span>
              Try a Seams agent
              <small>Policy checked before execution</small>
            </span>
          </div>

          <div className="h2-agent-media__footer" aria-label="Agent platform capabilities">
            <span>Scoped credentials</span>
            <span>Owner approvals</span>
            <span>Action receipts</span>
            <a href={agentsProps.href} onClick={agentsProps.onClick}>
              Explore Ecommerce Agents
              <ArrowRightAnim size={12} />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------- two products, one account layer ---------- */

function HomeDuo(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const walletProps = linkProps('/wallet');
  const agentsProps = linkProps('/ecommerce');

  return (
    <section className="h2-section h2-section--snug h2-rule" aria-labelledby="h2-duo-title">
      <div className="h2-shell">
        <div className="h2-duo__head">
          <h2 id="h2-duo-title" className="h2-display">
            Two products, one account layer
          </h2>
          <p className="h2-duo__copy">
            Built on the same keys, credentials, and policy engine: one product for embedding
            wallets, another for putting agents to work on your store.
          </p>
        </div>
        <div className="h2-duo__grid">
          <a className="h2-duo__panel" href={walletProps.href} onClick={walletProps.onClick}>
            <h3 className="h2-duo__title">
              <Wallet aria-hidden />
              Embedded Wallet
            </h3>
            <p className="h2-duo__panel-copy">
              Passkey-secured, non-custodial wallets for your users: recovery built in, every action
              signed, keys split so neither side can sign alone.
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
              <Bot aria-hidden />
              Ecommerce Agents
            </h3>
            <p className="h2-duo__panel-copy">
              Give AI agents and staff scoped credentials to run your store: limits, approvals, and
              an audit trail on every action.
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
  );
}

type HomeFrameProps = {
  hero: React.JSX.Element;
};

function HomeFrame({ hero }: HomeFrameProps): React.JSX.Element {
  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        {hero}
        <HomeDuo />
        <H2Ecosystem />
        <H2Pillars />
        <H2Security />
        <H2Faq audience="home" />
        <H2Footer />
      </div>
    </div>
  );
}

export function HomePage(): React.JSX.Element {
  return <HomeFrame hero={<HomeHeroCurrent />} />;
}

export function Home2Page(): React.JSX.Element {
  return <HomeFrame hero={<HomeHeroMedia />} />;
}

export default Home2Page;
