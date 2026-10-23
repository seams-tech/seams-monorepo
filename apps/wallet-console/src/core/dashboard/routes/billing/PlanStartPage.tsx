import React from 'react';
import { Check, CheckCircle2, Rocket, Sprout, TrendingUp, type LucideIcon } from 'lucide-react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { walletConsoleOverviewHref } from '../../consoleNavigation';
import { canDashboardManageBilling, useDashboardConsoleSession } from '../../consoleSession';
import { useDashboardSelectedContext } from '../../selectedContext';
import {
  dashboardPlanName,
  getDashboardBillingPlan,
  reconcileDashboardCardSetup,
  startDashboardCardSetup,
  startDashboardPlan,
  type DashboardBillingPlan,
  type DashboardSelfServePlan,
} from './freePlanApi';
import {
  clearPendingDashboardPlanIntent,
  isDashboardPlanChoice,
  readDashboardOverviewHref,
  readPendingDashboardPlanIntent,
  type DashboardPlanChoice,
} from './planIntent';

/* Every gradient on this page is the black onyx field. The Pro price is a placeholder,
   as on the pricing page. */
const PLAN_FIELD: GrainFieldName = 'onyx-black';

/* The pricing page's plans with their icons. */
const PLAN_OFFERS: readonly {
  readonly plan: DashboardPlanChoice;
  readonly icon: LucideIcon;
  readonly price: string;
  readonly includedUsers: number;
  readonly features: readonly string[];
}[] = [
  {
    plan: 'free',
    icon: Sprout,
    price: '$0',
    includedUsers: 300,
    features: [
      'Up to 300 monthly active users',
      '30,000 signatures a month',
      'Card required after 30 days',
    ],
  },
  {
    plan: 'growth',
    icon: TrendingUp,
    price: '$99',
    includedUsers: 5_000,
    features: [
      '5,000 monthly active users included',
      '$0.004 per active user above 5,000',
      '300 signatures per user, pooled',
    ],
  },
  {
    plan: 'pro',
    icon: Rocket,
    price: '$399',
    includedUsers: 100_000,
    features: [
      '100,000 monthly active users included',
      '$0.0035 per active user above 100,000',
      'Uptime SLA and priority support',
    ],
  },
];

const count = new Intl.NumberFormat('en-US');

/* Stripe names brands in lower case, such as "visa". */
function cardLabel(card: { readonly brand: string; readonly last4: string }): string {
  return `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} ending ${card.last4}`;
}

function utcDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function startedMessage(plan: DashboardBillingPlan): string {
  const since = plan.planStartedAt ? ` on ${utcDate(plan.planStartedAt)}` : '';
  return `${dashboardPlanName(plan.plan)} started${since}. We charge your card after each month.`;
}

function currentPlanSummary(plan: DashboardBillingPlan): string {
  if (plan.plan === 'free') {
    return plan.card.kind !== 'usable' && plan.cardDeadlineAt
      ? `Your organization is on the Free plan. Add a card by ${utcDate(plan.cardDeadlineAt)} to keep production running.`
      : 'Your organization is on the Free plan.';
  }
  const since = plan.planStartedAt ? ` since ${utcDate(plan.planStartedAt)}` : '';
  return `Your organization is on ${dashboardPlanName(plan.plan)}${since}.`;
}

/**
 * The plan page. A visitor who picked Growth or Pro on the pricing page goes straight on
 * to Stripe from here; Stripe returns here, and the verified card starts the plan.
 */
export function PlanStartPage(): React.JSX.Element {
  const session = useDashboardConsoleSession();
  const selectedContext = useDashboardSelectedContext();
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const [intent] = React.useState(readPendingDashboardPlanIntent);
  const params = React.useMemo(() => new URLSearchParams(search), [search]);
  const requested = params.get('plan');
  const chosen = intent?.plan ?? (isDashboardPlanChoice(requested) ? requested : null);
  const cardSetupStatus = params.get('card_setup');
  const checkoutSessionId = String(params.get('checkout_session_id') || '').trim();
  const canManageBilling = canDashboardManageBilling(session.claims);
  const [plan, setPlan] = React.useState<DashboardBillingPlan | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [starting, setStarting] = React.useState<DashboardSelfServePlan | null>(null);
  const reconciledRef = React.useRef('');
  const intentHandledRef = React.useRef(false);
  const [workspaceOverviewHref, setWorkspaceOverviewHref] = React.useState<string | null>(null);
  const overviewHref =
    workspaceOverviewHref ??
    walletConsoleOverviewHref({
      organization: session.claims?.orgId || selectedContext.organization,
      project: session.claims?.projectId || selectedContext.project,
    });
  const overviewHrefRef = React.useRef(overviewHref);
  overviewHrefRef.current = overviewHref;

  React.useEffect(() => {
    let cancelled = false;
    void readDashboardOverviewHref().then((href) => {
      if (!cancelled) setWorkspaceOverviewHref(href);
    });
    void getDashboardBillingPlan()
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (cardSetupStatus === 'cancel') {
      setMessage('Card setup was canceled. No card was added, and your plan did not change.');
      return;
    }
    if (cardSetupStatus !== 'success' || !checkoutSessionId) return;
    if (reconciledRef.current === checkoutSessionId) return;
    reconciledRef.current = checkoutSessionId;
    setMessage('Verifying your card...');
    void reconcileDashboardCardSetup(checkoutSessionId)
      .then(async (result) => {
        if (result.plan) setPlan(result.plan);
        if (!result.verified) {
          setMessage('Stripe has not confirmed the card yet. Refresh in a moment.');
          return;
        }
        clearPendingDashboardPlanIntent();
        if (!result.plan || result.plan.plan === 'free') {
          setMessage('Your card is verified.');
          return;
        }
        // A visitor from the pricing page ends the funnel on the dashboard.
        if (intent) {
          setMessage(`${startedMessage(result.plan)} Opening your dashboard...`);
          window.location.assign((await readDashboardOverviewHref()) ?? overviewHrefRef.current);
          return;
        }
        setMessage(startedMessage(result.plan));
      })
      .catch(() => setMessage('Card verification is still pending. Refresh in a moment.'));
  }, [cardSetupStatus, checkoutSessionId, intent]);

  const startPlan = React.useCallback(
    async (target: DashboardSelfServePlan) => {
      setStarting(target);
      setErrorMessage('');
      try {
        if (plan?.card.kind === 'usable') {
          const started = await startDashboardPlan(target);
          clearPendingDashboardPlanIntent();
          setPlan(started);
          setMessage(startedMessage(started));
          setStarting(null);
          return;
        }
        window.location.assign(await startDashboardCardSetup(target));
      } catch (error: unknown) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStarting(null);
      }
    },
    [plan],
  );

  /* A paid intent with no card goes straight to Stripe. With a card on file, the owner
     confirms first. Any other intent has done its routing. */
  React.useEffect(() => {
    if (!intent || intentHandledRef.current || cardSetupStatus) return;
    if (!loaded || session.loading) return;
    intentHandledRef.current = true;
    if (intent.plan === 'free' || plan?.plan !== 'free' || !canManageBilling) {
      clearPendingDashboardPlanIntent();
      return;
    }
    if (plan.card.kind !== 'usable') void startPlan(intent.plan);
  }, [canManageBilling, cardSetupStatus, intent, loaded, plan, session.loading, startPlan]);

  const currentOffer = PLAN_OFFERS.find((offer) => offer.plan === plan?.plan) ?? null;

  return (
    <div className="dashboard-view dashboard-plan-view" aria-label="Plan page">
      {message ? (
        <p className="dashboard-plan-notice" role="status">
          <CheckCircle2 size={18} aria-hidden />
          <span>{message}</span>
        </p>
      ) : null}
      {errorMessage ? (
        <div className="dashboard-warning-banner" role="alert">
          <p>{errorMessage}</p>
        </div>
      ) : null}
      {!loaded || session.loading ? (
        <p className="dashboard-pagination-note">Loading your plan...</p>
      ) : !plan ? (
        <p className="dashboard-pagination-note">
          Your organization has no billing account yet. Create a project first.
        </p>
      ) : (
        <>
          <section className="dashboard-plan-current" aria-label="Current plan">
            <div className="dashboard-plan-current__head">
              {currentOffer ? (
                <span className="dashboard-plan-icon" aria-hidden="true">
                  <GrainField field={PLAN_FIELD} playing={false} />
                  <currentOffer.icon size={20} />
                </span>
              ) : null}
              <div className="dashboard-plan-current__copy">
                <span className="dashboard-plan-current__eyebrow">Current plan</span>
                <h2 className="dashboard-plan-current__name">{dashboardPlanName(plan.plan)}</h2>
                <p className="dashboard-plan-current__summary">{currentPlanSummary(plan)}</p>
              </div>
              <a
                className="dashboard-pagination-button dashboard-pagination-button--primary dashboard-plan-current__cta"
                href={overviewHref}
                onClick={clearPendingDashboardPlanIntent}
              >
                {plan.plan === 'free' && chosen && chosen !== 'free'
                  ? 'Continue on Free'
                  : 'Open the Wallet Console'}
              </a>
            </div>
            <dl className="dashboard-plan-current__stats">
              <div>
                <dt>Active users this month</dt>
                <dd>
                  {count.format(plan.usage.productionActiveUsers)}
                  {currentOffer ? (
                    <span> of {count.format(currentOffer.includedUsers)} included</span>
                  ) : null}
                </dd>
                {currentOffer ? (
                  <meter
                    className="dashboard-plan-meter"
                    min={0}
                    max={currentOffer.includedUsers}
                    value={Math.min(plan.usage.productionActiveUsers, currentOffer.includedUsers)}
                    aria-label="Active users this month"
                  />
                ) : null}
              </div>
              <div>
                <dt>Signatures this month</dt>
                <dd>
                  {count.format(plan.usage.productionSignatures)}
                  {plan.plan === 'free' ? (
                    <span> of {count.format(plan.usage.limits.productionSignatures)}</span>
                  ) : null}
                </dd>
                {plan.plan === 'free' ? (
                  <meter
                    className="dashboard-plan-meter"
                    min={0}
                    max={plan.usage.limits.productionSignatures}
                    value={Math.min(
                      plan.usage.productionSignatures,
                      plan.usage.limits.productionSignatures,
                    )}
                    aria-label="Signatures this month"
                  />
                ) : null}
              </div>
              <div>
                <dt>Card</dt>
                <dd>
                  {plan.card.kind === 'none' ? 'No card on file' : cardLabel(plan.card)}
                  {plan.card.kind === 'expired' || plan.card.kind === 'removed' ? (
                    <span> ({plan.card.kind})</span>
                  ) : null}
                </dd>
              </div>
            </dl>
          </section>

          <div className="dashboard-plan-grid">
            {PLAN_OFFERS.map((offer) => {
              const current = plan.plan === offer.plan;
              const name = dashboardPlanName(offer.plan);
              const className = [
                'dashboard-plan-card',
                current ? 'dashboard-plan-card--current' : null,
                chosen === offer.plan && !current ? 'dashboard-plan-card--chosen' : null,
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <article key={offer.plan} className={className} aria-label={`${name} plan`}>
                  <span className="dashboard-plan-icon" aria-hidden="true">
                    <GrainField field={PLAN_FIELD} playing={false} />
                    <offer.icon size={20} />
                  </span>
                  <h3 className="dashboard-plan-card__name">{name}</h3>
                  <p className="dashboard-plan-card__price">
                    <strong>{offer.price}</strong>
                    <span>per month</span>
                  </p>
                  <ul className="dashboard-plan-card__features">
                    {offer.features.map((feature) => (
                      <li key={feature}>
                        <Check size={14} aria-hidden />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <div className="dashboard-plan-card__action">
                    {current ? (
                      <span className="dashboard-plan-card__badge">
                        <CheckCircle2 size={16} aria-hidden />
                        Current plan
                      </span>
                    ) : offer.plan === 'free' ? null : plan.plan !== 'free' ? (
                      <p className="dashboard-plan-card__note">Contact us to change plans.</p>
                    ) : !canManageBilling ? (
                      <p className="dashboard-plan-card__note">
                        Ask an owner or a billing administrator to start {name}.
                      </p>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="dashboard-pagination-button dashboard-pagination-button--primary"
                          disabled={starting !== null}
                          onClick={() => {
                            void startPlan(offer.plan === 'pro' ? 'pro' : 'growth');
                          }}
                        >
                          {starting === offer.plan
                            ? plan.card.kind === 'usable'
                              ? `Starting ${name}...`
                              : 'Opening Stripe...'
                            : `Start ${name}`}
                        </button>
                        <p className="dashboard-plan-card__note">
                          {plan.card.kind === 'usable'
                            ? `${offer.price} a month from today, on the ${cardLabel(plan.card)}.`
                            : 'Add a card in Stripe. The plan starts when Stripe confirms it.'}
                        </p>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <a className="dashboard-plan-enterprise" href="https://seams.sh/pricing/#contact">
            <GrainField field={PLAN_FIELD} />
            <span className="dashboard-plan-enterprise__copy">
              <span className="dashboard-plan-enterprise__title">Enterprise</span>
              <span className="dashboard-plan-enterprise__description">
                Committed volume, custom terms, and rollout planning with our team.
              </span>
            </span>
            <span className="dashboard-pagination-button">Contact sales</span>
          </a>
        </>
      )}
    </div>
  );
}

export default PlanStartPage;
