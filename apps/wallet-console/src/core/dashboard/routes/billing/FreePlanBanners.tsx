import React from 'react';
import { TrendingUp } from 'lucide-react';
import { GrainField } from '@seams-internal/grain-field';
import { useSiteRouter } from '@core/router/useSiteRouter';
import { clearPendingDashboardPlanIntent, DEFAULT_PLAN_ORGANIZATION_NAME } from './planIntent';
import {
  dashboardPlanName,
  getDashboardBillingPlan,
  reconcileDashboardCardSetup,
  startDashboardCardSetup,
  type DashboardBillingPlan,
  type DashboardFreePlanBanner,
  type DashboardFreePlanLimit,
} from './freePlanApi';

function growthMoveDismissKey(orgId: string, startedAt: string): string {
  return `seams.console.growthMoveDismissed:${orgId}:${startedAt}`;
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Storage can be blocked; the banner then stays hidden for this page view only.
  }
}

/* A reload after a verified return must not show the notice again. */
function removeCardSetupReturn(): void {
  const url = new URL(window.location.href);
  for (const key of ['plan', 'card_setup', 'checkout_session_id']) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

function utcDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function limitLabel(limit: DashboardFreePlanLimit): string {
  return limit === 'active_users'
    ? '300 production monthly active users'
    : '30,000 production signatures';
}

function bannerMessage(banner: Exclude<DashboardFreePlanBanner, { kind: 'growth_move' }>): string {
  switch (banner.kind) {
    case 'card_due':
      return `Add a card by ${utcDate(banner.deadlineAt)} to keep production running. We do not charge it while you stay inside the Free limits.`;
    case 'card_required':
      return 'Production is paused until you add a card. Recovery and key export stay open. Development environments keep working.';
    case 'free_limit_warning':
      return banner.cardOnFile
        ? `You used 80% of a Free limit (${limitLabel(banner.limit)}). You will move to Growth at the limit.`
        : `You used 80% of a Free limit (${limitLabel(banner.limit)}). Add a card before the limit, or production sign-ups and signing stop.`;
    case 'free_limit_reached':
      return `Production sign-ups or signing are paused: you reached ${limitLabel(banner.limit)}. Add a card to move to Growth.`;
  }
}

function needsCard(banner: DashboardFreePlanBanner): boolean {
  return (
    banner.kind === 'card_due' ||
    banner.kind === 'card_required' ||
    banner.kind === 'free_limit_reached' ||
    (banner.kind === 'free_limit_warning' && !banner.cardOnFile)
  );
}

function planSummary(plan: DashboardBillingPlan): string {
  const usage = plan.usage;
  const card =
    plan.card.kind === 'none'
      ? 'no card on file'
      : `${plan.card.brand} ending ${plan.card.last4}${plan.card.kind === 'usable' ? '' : ` (${plan.card.kind})`}`;
  const name = dashboardPlanName(plan.plan);
  const userLimit =
    plan.plan === 'free' ? ` of ${usage.limits.productionActiveUsers.toLocaleString('en-US')}` : '';
  const signatureLimit =
    plan.plan === 'free' ? ` of ${usage.limits.productionSignatures.toLocaleString('en-US')}` : '';
  return `${name} plan, ${card}. Production this month: ${usage.productionActiveUsers.toLocaleString('en-US')}${userLimit} monthly active users, ${usage.productionSignatures.toLocaleString('en-US')}${signatureLimit} signatures.`;
}

/**
 * Free plan banners. The billing page variant also shows the plan summary, offers card
 * setup, and verifies a card setup return through the Console. On the dashboard the
 * Growth move notice links to billing and can be dismissed per organization.
 */
export function FreePlanBanners(props: {
  readonly variant: 'dashboard' | 'billing';
  readonly canManageBilling: boolean;
  readonly orgId?: string;
  readonly search?: string;
  readonly showOverviewSummary?: boolean;
  readonly organizationName?: string;
}): React.ReactElement | null {
  const { linkProps } = useSiteRouter();
  const [plan, setPlan] = React.useState<DashboardBillingPlan | null>(null);
  const [dismissedKeys, setDismissedKeys] = React.useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = React.useState('');
  const [starting, setStarting] = React.useState(false);
  const reconciledRef = React.useRef('');

  React.useEffect(() => {
    let cancelled = false;
    void getDashboardBillingPlan()
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Stripe returns to the billing page, and the pricing-page sign-up returns to the
     dashboard. The card is verified here, and a verified plan start shows its plan. */
  React.useEffect(() => {
    const search = props.variant === 'billing' ? props.search : window.location.search;
    if (!search) return;
    const params = new URLSearchParams(search);
    const status = params.get('card_setup');
    const checkoutSessionId = String(params.get('checkout_session_id') || '').trim();
    if (status === 'cancel') {
      setMessage('Card setup was canceled. No card was added.');
      return;
    }
    if (status !== 'success' || !checkoutSessionId) return;
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
        if (props.variant === 'dashboard') removeCardSetupReturn();
        clearPendingDashboardPlanIntent();
        const started = result.plan && result.plan.plan !== 'free' ? result.plan : null;
        // The Growth notice already names the plan and its start date.
        if (started?.banners.some((banner) => banner.kind === 'growth_move')) {
          setMessage('');
          return;
        }
        setMessage(
          started
            ? `${dashboardPlanName(started.plan)} started. We charge your card after each month.`
            : 'Your card is verified. Production uses it from now on.',
        );
      })
      .catch(() => setMessage('Card verification is still pending. Refresh in a moment.'));
  }, [props.search, props.variant]);

  const onAddCard = React.useCallback(async () => {
    setStarting(true);
    try {
      window.location.assign(await startDashboardCardSetup());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Card setup failed to start.');
      setStarting(false);
    }
  }, []);

  if (!plan && !message) return null;
  const dismissible = props.variant === 'dashboard';
  const isDismissed = (banner: DashboardFreePlanBanner): boolean => {
    if (!dismissible || banner.kind !== 'growth_move') return false;
    const key = growthMoveDismissKey(props.orgId ?? '', banner.startedAt);
    return dismissedKeys.has(key) || readDismissed(key);
  };
  const dismiss = (key: string): void => {
    writeDismissed(key);
    setDismissedKeys((current) => new Set(current).add(key));
  };
  const billingLink = linkProps('/dashboard/billing/account');
  const quickstartLink = linkProps('/docs/getting-started/');
  const accountLink = linkProps('/dashboard/account-settings');
  const banners = (plan?.banners ?? []).filter((banner) => !isDismissed(banner));
  const showAddCard =
    props.canManageBilling &&
    (banners.some(needsCard) || (props.variant === 'billing' && plan?.card.kind !== 'usable'));
  const showFreeSummary = props.showOverviewSummary && plan?.plan === 'free';
  const showRename =
    props.showOverviewSummary &&
    props.organizationName === DEFAULT_PLAN_ORGANIZATION_NAME &&
    props.canManageBilling;
  if (
    props.variant === 'dashboard' &&
    banners.length === 0 &&
    !message &&
    !showFreeSummary &&
    !showRename
  )
    return null;
  return (
    <section className="dashboard-view__section" aria-label="Plan notices">
      {showFreeSummary && plan ? (
        <section className="dashboard-plan-current" aria-label="Free plan summary">
          <h2 className="dashboard-plan-current__name">Free plan</h2>
          <p className="dashboard-plan-current__summary">
            $0 a month. Includes {plan.usage.limits.productionActiveUsers.toLocaleString('en-US')}{' '}
            production monthly active users and{' '}
            {plan.usage.limits.productionSignatures.toLocaleString('en-US')} production signatures
            each month.
          </p>
          <p className="dashboard-plan-current__summary">
            {plan.card.kind === 'usable'
              ? 'Your card is verified. Growth starts at $99 a month if you exceed a Free limit.'
              : plan.cardDeadlineAt
                ? `Add a card by ${utcDate(plan.cardDeadlineAt)} to keep production running. Your card is not charged within the Free limits.`
                : 'Add a card to keep production running after the first 30 days.'}
          </p>
          <p className="dashboard-plan-current__summary">
            {plan.usage.productionActiveUsers.toLocaleString('en-US')} active users and{' '}
            {plan.usage.productionSignatures.toLocaleString('en-US')} signatures used in{' '}
            {plan.usage.monthUtc} (UTC).
          </p>
          <p className="dashboard-plan-current__summary">
            <a {...billingLink}>Manage plan and card</a>
            {' · '}
            <a {...quickstartLink}>Integration quick start</a>
          </p>
        </section>
      ) : null}
      {showRename ? (
        <p className="dashboard-pagination-note">
          <a {...accountLink}>Name your organization</a> in account settings.
        </p>
      ) : null}
      {banners.map((banner) =>
        banner.kind === 'growth_move' ? (
          <div key={banner.kind} className="dashboard-plan-banner" role="status">
            <span className="dashboard-plan-icon" aria-hidden="true">
              <GrainField field="onyx-black" playing={false} />
              <TrendingUp size={20} />
            </span>
            <div className="dashboard-plan-banner__body">
              <p className="dashboard-plan-banner__title">Your organization moved to Growth</p>
              <p>
                ${(banner.monthlyBaseMinor / 100).toFixed(0)} a month from{' '}
                {utcDate(banner.startedAt)}.
              </p>
            </div>
            {dismissible ? (
              <a
                className="dashboard-pagination-button dashboard-plan-banner__link"
                href={billingLink.href}
                onClick={billingLink.onClick}
              >
                View billing
              </a>
            ) : null}
            {dismissible ? (
              <button
                type="button"
                className="dashboard-plan-banner__close"
                aria-label="Dismiss Growth notice"
                onClick={() => dismiss(growthMoveDismissKey(props.orgId ?? '', banner.startedAt))}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path
                    d="M3 3l8 8M11 3l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ) : null}
          </div>
        ) : (
          <div
            key={banner.kind}
            className="dashboard-warning-banner"
            role={
              banner.kind === 'card_required' || banner.kind === 'free_limit_reached'
                ? 'alert'
                : 'status'
            }
          >
            <p>{bannerMessage(banner)}</p>
          </div>
        ),
      )}
      {props.variant === 'billing' && plan ? (
        <p className="dashboard-pagination-note">{planSummary(plan)}</p>
      ) : null}
      {message ? <p className="dashboard-info-banner">{message}</p> : null}
      {showAddCard ? (
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--primary"
          disabled={starting}
          onClick={() => {
            void onAddCard();
          }}
        >
          {starting ? 'Opening Stripe...' : 'Add a card'}
        </button>
      ) : null}
    </section>
  );
}
