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
} from 'lucide-react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import SeamsWordmark from '@/components/icons/SeamsWordmark';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import '@/styles/h2.css';

/* Split hero shared by the umbrella and Ecommerce Agents pages, set like the
   wallet site's: the headline on white at the left, and product scenes on a
   moving gradient at the right. Chips under the card and the pager on the
   bottom rule page through the scenes. The scenes are HTML mocks with the
   footprint of the product screens they stand for. */

/* ---------- product scene mocks ---------- */

export function DashboardWindow(): React.JSX.Element {
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

export function IntegrationsWindow(): React.JSX.Element {
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

/* An HTML replica of the transaction confirmer, showing a multi-step escrow
   release. `sheet` draws it as the bottom-sheet drawer, with a drag handle,
   docked to the edge of the panel below it. */
export function WalletTransactionPreview({ sheet = false }: { sheet?: boolean }) {
  return (
    <div
      className="h2-wallet-confirm"
      role="img"
      aria-label="Transaction confirmer preview: escrow release for an order"
    >
      <div
        className={`h2-wallet-confirm__card h2-txmock${sheet ? ' h2-wallet-confirm__card--sheet' : ''}`}
      >
        {sheet ? <span className="h2-txmock__handle" /> : null}
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

/* ---------- split hero ---------- */

export type HeroScene = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  view: React.ReactNode;
};

export type HeroLink = { label: string; to: string };

/* Compact product forks under the CTAs, each on its own moving gradient chip,
   with the same fields as the wallet site's forks. */
const productForks: readonly { label: string; to: string; field: GrainFieldName }[] = [
  { label: 'Wallet', to: '/wallet', field: 'teal-peach' },
  { label: 'Harness', to: '/ecommerce', field: 'mauve-ember' },
  { label: 'API', to: '/docs/concepts/', field: 'azure-coral' },
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
