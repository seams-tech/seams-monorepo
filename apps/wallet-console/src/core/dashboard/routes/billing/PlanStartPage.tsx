import { BillingRulesSection } from './BillingRulesSection';
import React from 'react';
import { consoleLocale, t } from '@core/i18n';
import { Check, CheckCircle2, Rocket, Sprout, TrendingUp, type LucideIcon } from 'lucide-react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { walletConsoleOverviewHref } from '../../consoleNavigation';
import { canDashboardManageBilling, useDashboardConsoleSession } from '../../consoleSession';
import { useDashboardSelectedContext } from '../../selectedContext';
import {
  listDashboardAccountOrganizations,
  switchDashboardAccountOrganizationContext,
  type DashboardAccountOrganization,
} from '../account-settings/consoleAccountApi';
import { replaceDashboardSelectedContext } from '../../useDashboardUiPreferences';
import { requireConsoleBaseUrl } from '../../consoleHttp';
import {
  dashboardPlanName,
  getDashboardBillingPlan,
  reconcileDashboardCardSetup,
  startDashboardCardSetup,
  startDashboardPlan,
  requestDashboardFreePlan,
  type DashboardBillingPlan,
  type DashboardSelfServePlan,
} from './freePlanApi';
import { describeCardEnding, describeCardState } from './FreePlanBanners';
import {
  clearPendingDashboardPlanIntent,
  isDashboardPlanChoice,
  readDashboardOverviewHref,
  readPendingDashboardPlanIntent,
  recordDashboardFunnelStep,
  prepareDashboardAccountForPlan,
  type DashboardPlanChoice,
} from './planIntent';

async function choosePlanOrganization(org: DashboardAccountOrganization): Promise<void> {
  const context = await switchDashboardAccountOrganizationContext(org.id);
  replaceDashboardSelectedContext({
    organization: org.id,
    project: context.projectId ?? '',
    environment: '',
  });
  const intent = readPendingDashboardPlanIntent();
  if (intent) {
    await prepareDashboardAccountForPlan(intent, requireConsoleBaseUrl());
    await recordDashboardFunnelStep('plan_ready', intent);
  }
  window.location.assign('/dashboard/billing/plan');
}

function PlanOrganizationChoice(): React.JSX.Element {
  const [organizations, setOrganizations] = React.useState<DashboardAccountOrganization[]>([]);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    void listDashboardAccountOrganizations()
      .then(setOrganizations)
      .catch(reportOrganizationError.bind(null, setError));
  }, []);
  return (
    <section
      className="dashboard-plan-current"
      aria-label={t('platformBillingChooseOrganizationAria')}
    >
      <h2>{t('platformBillingChooseOrganizationTitle')}</h2>
      <p>{t('platformBillingChooseOrganizationNote')}</p>
      {organizations.map(renderPlanOrganization.bind(null, setError))}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function reportOrganizationError(setError: (message: string) => void, error: unknown): void {
  setError(
    error instanceof Error ? error.message : t('platformBillingOrganizationSelectionFailed'),
  );
}

function renderPlanOrganization(
  setError: (message: string) => void,
  org: DashboardAccountOrganization,
): React.JSX.Element {
  return (
    <button
      key={org.id}
      type="button"
      className="dashboard-pagination-button"
      onClick={selectPlanOrganization.bind(null, setError, org)}
    >
      {org.name}
    </button>
  );
}

function selectPlanOrganization(
  setError: (message: string) => void,
  org: DashboardAccountOrganization,
): void {
  void choosePlanOrganization(org).catch(reportOrganizationError.bind(null, setError));
}

function continueFromPlanPage(): void {
  const intent = readPendingDashboardPlanIntent();
  if (intent && intent.plan !== 'free')
    void recordDashboardFunnelStep('growth_continue_free', intent);
  clearPendingDashboardPlanIntent();
}

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
      t('platformBillingFeatureFreeUsers'),
      t('platformBillingFeatureFreeSignatures'),
      t('platformBillingFeatureFreeCard'),
    ],
  },
  {
    plan: 'growth',
    icon: TrendingUp,
    price: '$99',
    includedUsers: 5_000,
    features: [
      t('platformBillingFeatureGrowthUsers'),
      t('platformBillingFeatureGrowthOver'),
      t('platformBillingFeaturePooled'),
    ],
  },
  {
    plan: 'pro',
    icon: Rocket,
    price: '$399',
    includedUsers: 100_000,
    features: [
      t('platformBillingFeatureProUsers'),
      t('platformBillingFeatureProOver'),
      t('platformBillingFeatureProSupport'),
    ],
  },
];

const count = new Intl.NumberFormat(consoleLocale);

type FreeRequestState =
  | { readonly kind: 'idle' | 'pending' | 'requested'; readonly message?: never }
  | { readonly kind: 'error'; readonly message: string };

async function requestFree(setState: (state: FreeRequestState) => void): Promise<void> {
  setState({ kind: 'pending' });
  try {
    await requestDashboardFreePlan();
    setState({ kind: 'requested' });
  } catch (error: unknown) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : t('platformBillingFreeRequestFailed'),
    });
  }
}

function FreePlanRequest(): React.JSX.Element {
  const [state, setState] = React.useState<FreeRequestState>({ kind: 'idle' });
  return (
    <>
      <button
        type="button"
        className="dashboard-pagination-button"
        disabled={state.kind === 'pending' || state.kind === 'requested'}
        onClick={requestFree.bind(null, setState)}
      >
        {state.kind === 'pending'
          ? t('platformBillingRequestingFree')
          : t('platformBillingRequestFreeNextMonth')}
      </button>
      {state.kind === 'requested' ? <p role="status">{t('platformBillingFreeRequested')}</p> : null}
      {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}
    </>
  );
}

/* Stripe names brands in lower case, such as "visa". */
function cardLabel(card: { readonly brand: string; readonly last4: string }): string {
  return t('platformBillingCardEnding', {
    brand: `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)}`,
    last4: card.last4,
  });
}

function utcDate(iso: string): string {
  return new Date(iso).toLocaleDateString(consoleLocale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function startedMessage(plan: DashboardBillingPlan): string {
  return plan.planStartedAt
    ? t('platformBillingPlanStartedOn', {
        plan: dashboardPlanName(plan.plan),
        date: utcDate(plan.planStartedAt),
      })
    : t('platformBillingPlanStarted', { plan: dashboardPlanName(plan.plan) });
}

function currentPlanSummary(plan: DashboardBillingPlan): string {
  if (plan.plan === 'free') {
    return plan.card.kind !== 'usable' && plan.cardDeadlineAt
      ? t('platformBillingOnFreeDeadline', { date: utcDate(plan.cardDeadlineAt) })
      : t('platformBillingOnFree');
  }
  return plan.planStartedAt
    ? t('platformBillingOnPlanSince', {
        plan: dashboardPlanName(plan.plan),
        date: utcDate(plan.planStartedAt),
      })
    : t('platformBillingOnPlan', { plan: dashboardPlanName(plan.plan) });
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
  const choosingOrganization = params.get('choose_org') === '1';
  const checkoutSessionId = String(params.get('checkout_session_id') || '').trim();
  const canManageBilling = canDashboardManageBilling(session.claims);
  const [plan, setPlan] = React.useState<DashboardBillingPlan | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState(
    params.has('setup_failed') ? t('platformBillingSetupFailedTryAgain') : '',
  );
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
      setMessage(t('platformBillingCardSetupCanceledPlan'));
      if (intent) void recordDashboardFunnelStep('card_setup_canceled', intent);
      return;
    }
    if (cardSetupStatus !== 'success' || !checkoutSessionId) return;
    if (reconciledRef.current === checkoutSessionId) return;
    reconciledRef.current = checkoutSessionId;
    setMessage(t('platformBillingVerifyingCard'));
    void reconcileDashboardCardSetup(checkoutSessionId)
      .then(async (result) => {
        if (result.plan) setPlan(result.plan);
        if (!result.verified) {
          setMessage(t('platformBillingStripeNotConfirmed'));
          return;
        }
        clearPendingDashboardPlanIntent();
        if (!result.plan || result.plan.plan === 'free') {
          setMessage(t('platformBillingCardVerified'));
          return;
        }
        // A visitor from the pricing page ends the funnel on the dashboard.
        if (intent) {
          setMessage(
            t('platformBillingOpeningDashboard', { message: startedMessage(result.plan) }),
          );
          window.location.assign((await readDashboardOverviewHref()) ?? overviewHrefRef.current);
          return;
        }
        setMessage(startedMessage(result.plan));
      })
      .catch(() => setMessage(t('platformBillingVerificationPending')));
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
    if (
      !intent ||
      intentHandledRef.current ||
      cardSetupStatus ||
      choosingOrganization ||
      params.has('setup_failed')
    )
      return;
    if (!loaded || session.loading) return;
    intentHandledRef.current = true;
    if (intent.plan === 'free' || plan?.plan !== 'free' || !canManageBilling) {
      clearPendingDashboardPlanIntent();
      return;
    }
    if (plan.card.kind !== 'usable') void startPlan(intent.plan);
  }, [
    canManageBilling,
    cardSetupStatus,
    choosingOrganization,
    params,
    intent,
    loaded,
    plan,
    session.loading,
    startPlan,
  ]);

  const currentOffer = PLAN_OFFERS.find((offer) => offer.plan === plan?.plan) ?? null;

  if (choosingOrganization) return <PlanOrganizationChoice />;
  if (!session.loading && !canManageBilling)
    return (
      <div className="dashboard-view">
        <p>{t('platformBillingAskToStart', { plan: chosen === 'pro' ? 'Pro' : 'Growth' })}</p>
        <a href={overviewHref} onClick={clearPendingDashboardPlanIntent}>
          {t('platformBillingOpenWalletConsole')}
        </a>
      </div>
    );

  return (
    <div
      className="dashboard-view dashboard-plan-view"
      aria-label={t('platformBillingPlanPageAria')}
    >
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
        <p className="dashboard-pagination-note">{t('platformBillingLoadingPlan')}</p>
      ) : !plan ? (
        <p className="dashboard-pagination-note">{t('platformBillingNoBillingAccount')}</p>
      ) : (
        <>
          <section className="dashboard-plan-current" aria-label={t('platformBillingCurrentPlan')}>
            <div className="dashboard-plan-current__head">
              {currentOffer ? (
                <span className="dashboard-plan-icon" aria-hidden="true">
                  <GrainField field={PLAN_FIELD} playing={false} />
                  <currentOffer.icon size={20} />
                </span>
              ) : null}
              <div className="dashboard-plan-current__copy">
                <span className="dashboard-plan-current__eyebrow">
                  {t('platformBillingCurrentPlan')}
                </span>
                <h2 className="dashboard-plan-current__name">{dashboardPlanName(plan.plan)}</h2>
                <p className="dashboard-plan-current__summary">{currentPlanSummary(plan)}</p>
              </div>
              <a
                className="dashboard-pagination-button dashboard-pagination-button--primary dashboard-plan-current__cta"
                href={overviewHref}
                onClick={
                  plan.plan === 'free' ? continueFromPlanPage : clearPendingDashboardPlanIntent
                }
              >
                {plan.plan === 'free' && chosen && chosen !== 'free'
                  ? t('platformBillingContinueOnFree')
                  : t('platformBillingOpenWalletConsole')}
              </a>
            </div>
            <dl className="dashboard-plan-current__stats">
              <div>
                <dt>{t('platformBillingActiveUsersThisMonth')}</dt>
                <dd>
                  {count.format(plan.usage.productionActiveUsers)}
                  {currentOffer ? (
                    <span>
                      {' '}
                      {t('platformBillingIncludedOf', {
                        limit: count.format(currentOffer.includedUsers),
                      })}
                    </span>
                  ) : null}
                </dd>
                {currentOffer ? (
                  <meter
                    className="dashboard-plan-meter"
                    min={0}
                    max={currentOffer.includedUsers}
                    value={Math.min(plan.usage.productionActiveUsers, currentOffer.includedUsers)}
                    aria-label={t('platformBillingActiveUsersThisMonth')}
                  />
                ) : null}
              </div>
              <div>
                <dt>{t('platformBillingSignaturesThisMonth')}</dt>
                <dd>
                  {count.format(plan.usage.productionSignatures)}
                  {plan.plan === 'free' ? (
                    <span>
                      {' '}
                      {t('platformBillingOfLimit', {
                        limit: count.format(plan.usage.limits.productionSignatures),
                      })}
                    </span>
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
                    aria-label={t('platformBillingSignaturesThisMonth')}
                  />
                ) : null}
              </div>
              <div>
                <dt>{t('platformBillingCard')}</dt>
                <dd>
                  {plan.card.kind === 'none' ? t('platformBillingNoCard') : cardLabel(plan.card)}
                  {plan.card.kind === 'expired' || plan.card.kind === 'removed' ? (
                    <span>
                      {' '}
                      {t('platformBillingCardStateParens', {
                        state: describeCardState(plan.card.kind),
                      })}
                    </span>
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
                <article
                  key={offer.plan}
                  className={className}
                  aria-label={t('platformBillingPlanAria', { name })}
                >
                  <span className="dashboard-plan-icon" aria-hidden="true">
                    <GrainField field={PLAN_FIELD} playing={false} />
                    <offer.icon size={20} />
                  </span>
                  <h3 className="dashboard-plan-card__name">{name}</h3>
                  <p className="dashboard-plan-card__price">
                    <strong>{offer.price}</strong>
                    <span>{t('platformBillingPerMonth')}</span>
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
                        {t('platformBillingCurrentPlan')}
                      </span>
                    ) : offer.plan === 'free' ? (
                      canManageBilling && (plan.plan === 'growth' || plan.plan === 'pro') ? (
                        <FreePlanRequest />
                      ) : null
                    ) : plan.plan !== 'free' ? (
                      <p className="dashboard-plan-card__note">
                        {t('platformBillingContactToChange')}
                      </p>
                    ) : !canManageBilling ? (
                      <p className="dashboard-plan-card__note">
                        {t('platformBillingAskToStart', { plan: name })}
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
                              ? t('platformBillingStartingPlan', { name })
                              : t('platformBillingOpeningStripe')
                            : t('platformBillingStartPlan', { name })}
                        </button>
                        <p className="dashboard-plan-card__note">
                          {plan.card.kind === 'usable'
                            ? t('platformBillingMonthlyFromToday', {
                                price: offer.price,
                                card: cardLabel(plan.card),
                              })
                            : t('platformBillingAddCardInStripe')}
                        </p>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <a className="dashboard-plan-enterprise" href="https://seams.sh/#contact">
            <GrainField field={PLAN_FIELD} />
            <span className="dashboard-plan-enterprise__copy">
              <span className="dashboard-plan-enterprise__title">Enterprise</span>
              <span className="dashboard-plan-enterprise__description">
                {t('platformBillingEnterpriseDescription')}
              </span>
            </span>
            <span className="dashboard-pagination-button">{t('platformBillingContactSales')}</span>
          </a>
        </>
      )}
      <BillingRulesSection />
    </div>
  );
}

export default PlanStartPage;
