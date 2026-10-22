import React from 'react';
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
  readPendingDashboardPlanIntent,
  type DashboardPlanChoice,
} from './planIntent';

/* The pricing page's plans; the Pro price is a placeholder, as on the pricing page. */
const PLAN_OFFERS: readonly {
  readonly plan: DashboardPlanChoice;
  readonly price: string;
  readonly users: string;
  readonly detail: string;
}[] = [
  {
    plan: 'free',
    price: '$0',
    users: 'Up to 300 monthly active users',
    detail: '30,000 signatures a month. A card is needed after 30 days.',
  },
  {
    plan: 'growth',
    price: '$99 a month',
    users: '5,000 monthly active users included',
    detail: '$0.004 per active user above 5,000.',
  },
  {
    plan: 'pro',
    price: '$399 a month',
    users: '100,000 monthly active users included',
    detail: '$0.0035 per active user above 100,000. Uptime SLA and priority support.',
  },
];

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

  React.useEffect(() => {
    let cancelled = false;
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
      .then((result) => {
        if (result.plan) setPlan(result.plan);
        if (!result.verified) {
          setMessage('Stripe has not confirmed the card yet. Refresh in a moment.');
          return;
        }
        clearPendingDashboardPlanIntent();
        setMessage(
          result.plan && result.plan.plan !== 'free'
            ? startedMessage(result.plan)
            : 'Your card is verified.',
        );
      })
      .catch(() => setMessage('Card verification is still pending. Refresh in a moment.'));
  }, [cardSetupStatus, checkoutSessionId]);

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

  const overviewHref = walletConsoleOverviewHref({
    organization: session.claims?.orgId || selectedContext.organization,
    project: selectedContext.project,
  });

  return (
    <div className="dashboard-view" aria-label="Plan page">
      <section className="dashboard-view__section">
        {message ? (
          <p className="dashboard-info-banner" role="status">
            {message}
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
            <p className="dashboard-pagination-note">{currentPlanSummary(plan)}</p>
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
                    <h3 className="dashboard-plan-card__name">{name}</h3>
                    <p className="dashboard-plan-card__price">{offer.price}</p>
                    <p className="dashboard-plan-card__users">{offer.users}</p>
                    <p className="dashboard-plan-card__detail">{offer.detail}</p>
                    <div className="dashboard-plan-card__action">
                      {current ? (
                        <span className="dashboard-plan-card__badge">Current plan</span>
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
                              ? `${offer.price} from today, on the ${plan.card.brand} ending ${plan.card.last4}.`
                              : 'Add a card in Stripe. The plan starts when Stripe confirms it.'}
                          </p>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="dashboard-pagination-note">
              Enterprise has committed volume and custom terms.{' '}
              <a href="https://seams.sh/pricing/#contact">Contact sales</a>.
            </p>
            {plan.plan === 'free' ? (
              <a
                className="dashboard-pagination-button"
                href={overviewHref}
                onClick={clearPendingDashboardPlanIntent}
              >
                {chosen && chosen !== 'free' ? 'Continue on Free' : 'Go to the dashboard'}
              </a>
            ) : (
              <a className="dashboard-pagination-button" href={overviewHref}>
                Go to the dashboard
              </a>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default PlanStartPage;
