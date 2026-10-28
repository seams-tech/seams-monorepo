import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Hash,
  Home,
  Inbox,
  MessageSquare,
  Receipt,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import '@/styles/h2.css';

/* Split hero shared by the umbrella and Satyr pages, set like the wallet
   site's: the headline on white at the left, and product scenes on a moving
   gradient at the right. Chips under the card and the pager on the bottom
   rule page through the scenes. The scenes are HTML mocks with the footprint
   of the product screens they stand for. */

/* ---------- product scene mocks ---------- */

/* The Satyr Portal on a café's day: agents' work lands here, and the items
   that wait for a person are flagged. */
export function DashboardWindow(): React.JSX.Element {
  return (
    <div className="h2-window" role="img" aria-label="Satyr Portal overview for a café">
      <div className="h2-window__side">
        <div className="h2-window__brand">Satyr</div>
        <div className="h2-window__navitem is-active">
          <Home aria-hidden /> Home
        </div>
        <div className="h2-window__navitem">
          <MessageSquare aria-hidden /> Chat
        </div>
        <div className="h2-window__navitem">
          <Store aria-hidden /> Shop
        </div>
        <div className="h2-window__navitem">
          <Receipt aria-hidden /> Orders
        </div>
        <div className="h2-window__navitem">
          <Inbox aria-hidden /> Inbox
        </div>
        <div className="h2-window__navitem">
          <ShieldCheck aria-hidden /> Approvals
        </div>
      </div>
      <div className="h2-window__main">
        <p className="h2-window__title">Kanda Bakery &amp; Café · today</p>
        <div className="h2-stats">
          <span className="h2-stat">
            <small>Orders today</small>
            <strong>64</strong>
          </span>
          <span className="h2-stat">
            <small>Waiting for you</small>
            <strong>2</strong>
          </span>
          <span className="h2-stat">
            <small>Mail answered</small>
            <strong>18</strong>
          </span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Autumn menu published
            <small>Shop agent · 14 items · storefront</small>
          </span>
          <span className="h2-chip h2-chip--green">Live</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Refund ¥4,200 · order #2377
            <small>Moves money · approve in the Portal</small>
          </span>
          <span className="h2-chip h2-chip--amber">Held</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Gift box enquiry answered
            <small>Inbox agent · 2 sources cited</small>
          </span>
          <span className="h2-chip h2-chip--plain">Sent</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Failed payment · order #2391
            <small>Morning brief · linked to the order</small>
          </span>
          <span className="h2-chip h2-chip--plain">Reported</span>
        </div>
        <div className="h2-mockrow">
          <span className="h2-mockrow__main">
            Saturday bake plan
            <small>BakeryOS · 6 runs from 212 preorders</small>
          </span>
          <span className="h2-chip h2-chip--green">Planned</span>
        </div>
      </div>
    </div>
  );
}

/* Satyr in the café's Slack: an approval card in the thread, then the
   on-demand brief. */
export function IntegrationsWindow(): React.JSX.Element {
  return (
    <div
      className="h2-window"
      role="img"
      aria-label="Satyr asks for a menu approval in a Slack channel"
    >
      <div className="h2-window__side h2-window__side--slack">
        <div className="h2-window__brand">Kanda Bakery</div>
        <div className="h2-window__navitem">
          <Hash aria-hidden /> general
        </div>
        <div className="h2-window__navitem is-active">
          <Hash aria-hidden /> cafe-ops
        </div>
        <div className="h2-window__navitem">
          <Hash aria-hidden /> orders
        </div>
        <div className="h2-window__navitem">
          <Hash aria-hidden /> kitchen
        </div>
      </div>
      <div className="h2-window__main">
        <p className="h2-window__title"># cafe-ops</p>
        <div className="h2-chat">
          <div className="h2-chat__bubble">
            <small>Satyr · APP · 09:14</small>
            Approval needed: the shop agent wants to publish the autumn menu, with 14 items and 3
            new prices.
          </div>
          <div className="h2-chat__bubble">
            <small>Satyr · APP · 09:14</small>
            An owner or admin can approve it on this card. Nothing goes live before that.
          </div>
          <div className="h2-chat__bubble h2-chat__bubble--reply">
            Approved ✓ the menu is live on the storefront
          </div>
          <div className="h2-chat__bubble">
            <small>Satyr · APP · 09:31</small>
            Morning brief: 1 failed payment and 2 late orders. Each item links to its order.
          </div>
        </div>
      </div>
    </div>
  );
}

/* A BakeryOS production plan: the day's runs, built from orders and
   preorders. */
export function ProductionRunMock(): React.JSX.Element {
  return (
    <div className="h2-mockcard" role="img" aria-label="BakeryOS production plan for Saturday">
      <p className="h2-mockcard__title">Saturday · 212 preorders</p>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Croissants · 120
          <small>Proofing · ready 06:40</small>
        </span>
        <span className="h2-chip h2-chip--green">Done</span>
      </div>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Financiers · 6 trays of 24
          <small>Oven 1 · 07:10 to 07:24</small>
        </span>
        <span className="h2-chip h2-chip--amber">Baking</span>
      </div>
      <div className="h2-mockrow">
        <span className="h2-mockrow__main">
          Gift boxes · 40
          <small>Pack after cooling · 10:30</small>
        </span>
        <span className="h2-chip h2-chip--plain">Planned</span>
      </div>
    </div>
  );
}

/* ---------- split hero ---------- */

export type HeroScene = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  view: React.ReactNode;
};

export type HeroLink = { label: string; to: string };

/* Compact product forks under the CTAs, each on its own moving gradient chip,
   with the same fields as the navbar's product rows. */
const productForks: readonly { label: string; to: string; field: GrainFieldName }[] = [
  { label: 'Satyr', to: '/ecommerce', field: 'azure-coral' },
  { label: 'BakeryOS', to: '/ecommerce#bakeryos', field: 'apricot-beam' },
  { label: 'Wallet', to: '/wallet', field: 'teal-peach' },
];

/* the hero field moves at half the site pace, so the motion behind the
   card stays calm */
const HERO_FIELD_PACE = 0.5;

export type H2SceneHeroProps = {
  titleId: string;
  title: React.ReactNode;
  sub: React.ReactNode;
  primary: HeroLink;
  secondary: HeroLink;
  field: GrainFieldName;
  scenes: readonly HeroScene[];
};

export function H2SceneHero({
  titleId,
  title,
  sub,
  primary,
  secondary,
  field,
  scenes,
}: H2SceneHeroProps): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const primaryProps = linkProps(primary.to);
  const secondaryProps = linkProps(secondary.to);
  const [page, setPage] = React.useState(0);
  const scene = scenes[page];

  return (
    <header className="h2-hero h2-hero--scene" aria-labelledby={titleId}>
      <div className="h2-hero__split">
        <div className="h2-hero__main">
          <h1 id={titleId} className="h2-display h2-hero__title">
            {title}
          </h1>
          <p className="h2-hero__sub">{sub}</p>
          <div className="h2-hero__ctas">
            <a
              className="h2-btn h2-btn--primary h2-btn--lg"
              href={primaryProps.href}
              onClick={primaryProps.onClick}
            >
              {primary.label}
              <ArrowRightAnim size={12} />
            </a>
            <a
              className="h2-btn h2-btn--outline"
              href={secondaryProps.href}
              onClick={secondaryProps.onClick}
            >
              {secondary.label}
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

        <div className="h2-hero__demo">
          <GrainField field={field} pace={HERO_FIELD_PACE} />
          <div className="h2-hero__scene h2-fadein" key={scene.id}>
            {scene.view}
          </div>
          <div className="h2-themeswitch">
            <div className="h2-themeswitch__track" role="group" aria-label="Product views">
              {scenes.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={`h2-themeswitch__btn${i === page ? ' is-active' : ''}`}
                  aria-pressed={i === page}
                  onClick={() => setPage(i)}
                >
                  <s.icon size={13} strokeWidth={1.8} aria-hidden />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* the pager sits on the junction of the divider and the bottom rule */}
        <div className="h2-pager" role="group" aria-label="Product scenes">
          <button
            type="button"
            className="h2-pager__btn"
            aria-label="Previous product scene"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft aria-hidden />
          </button>
          <span className="h2-pager__dots">
            {scenes.map((s, i) => (
              <span
                key={s.id}
                className={`h2-pager__dot${i === page ? ' is-active' : ''}`}
                title={s.label}
              />
            ))}
          </span>
          <button
            type="button"
            className="h2-pager__btn"
            aria-label="Next product scene"
            disabled={page >= scenes.length - 1}
            onClick={() => setPage((p) => Math.min(scenes.length - 1, p + 1))}
          >
            <ChevronRight aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}
