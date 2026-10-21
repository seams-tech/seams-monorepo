/**
 * Free plan rules: the 30-day card clock, the Free limits, and the move to Growth.
 * The prices and limits come from docs/wallet-saas/pricing.md; the transitions come
 * from docs/feat-4-free-plan-card-and-growth-move.md. This module is pure: the D1
 * service persists its decisions.
 */

export const FREE_PLAN_LIMITS_V1 = Object.freeze({
  productionActiveUsers: 300,
  productionSignatures: 30_000,
});

export const FREE_PLAN_CARD_GRACE_DAYS = 30;
export const FREE_PLAN_CARD_REMINDER_DAYS = Object.freeze([16, 23, 29] as const);
export const FREE_PLAN_WARNING_PERCENT = 80;

const DAY_MS = 86_400_000;

/** The Growth price that a move pins. A later price is a new version, never an edit. */
export const WALLET_GROWTH_PLAN_PRICE_V1 = Object.freeze({
  version: 'wallet-growth-v1',
  currency: 'USD',
  monthlyBaseMinor: 9_900,
  includedActiveUsers: 5_000,
  activeUserOverageMicros: 4_000,
  signaturesPerActiveUser: 300,
  signatureOveragePerThousandMinor: 5,
  priceLockMonths: 12,
} as const);

export type BillingPlanKindV1 = 'free' | 'growth' | 'enterprise';
export type ProductionStateV1 = 'active' | 'card_required' | 'free_limit_reached';
export type FreePlanCardReminderDayV1 = (typeof FREE_PLAN_CARD_REMINDER_DAYS)[number];
export type FreePlanLimitV1 = 'active_users' | 'signatures';

export type BillingPlanV1 =
  | {
      readonly kind: 'free';
      readonly freeStartedAtMs: number;
      readonly startedAtMs?: never;
      readonly priceVersion?: never;
      readonly priceLockedUntilMs?: never;
    }
  | {
      readonly kind: 'growth';
      readonly freeStartedAtMs: number;
      readonly startedAtMs: number;
      readonly priceVersion: string;
      readonly priceLockedUntilMs: number;
    }
  | {
      readonly kind: 'enterprise';
      readonly freeStartedAtMs: number;
      readonly startedAtMs: number;
      readonly priceVersion: string;
      readonly priceLockedUntilMs: number | null;
    };

interface CardDisplayV1 {
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
}

/** Derived from the verified payment method on every read; never stored as a flag. */
export type PaymentMethodStateV1 =
  | { readonly kind: 'none' }
  | ({ readonly kind: 'usable' } & CardDisplayV1)
  | ({ readonly kind: 'expired' } & CardDisplayV1)
  | ({ readonly kind: 'removed' } & CardDisplayV1);

export interface FreePlanUsageV1 {
  readonly monthUtc: string;
  readonly productionActiveUsers: number;
  readonly productionSignatures: number;
}

export type FreePlanNoticeV1 =
  | {
      readonly kind: 'card_reminder';
      readonly day: FreePlanCardReminderDayV1;
      readonly deadlineAt: string;
    }
  | { readonly kind: 'card_required'; readonly deadlineAt: string }
  | {
      readonly kind: 'free_limit_warning';
      readonly monthUtc: string;
      readonly limit: FreePlanLimitV1;
      readonly cardOnFile: boolean;
    }
  | { readonly kind: 'free_limit_stop'; readonly monthUtc: string; readonly limit: FreePlanLimitV1 }
  | {
      readonly kind: 'growth_move';
      readonly startedAt: string;
      readonly monthlyBaseMinor: number;
      readonly priceVersion: string;
    };

/** One key per account and notice; a retry with the same key sends nothing new. */
export function freePlanNoticeKey(notice: FreePlanNoticeV1): string {
  switch (notice.kind) {
    case 'card_reminder':
      return `card_reminder:day_${notice.day}:${notice.deadlineAt.slice(0, 10)}`;
    case 'card_required':
      return `card_required:${notice.deadlineAt.slice(0, 10)}`;
    case 'free_limit_warning':
      return `free_limit_warning:${notice.monthUtc}`;
    case 'free_limit_stop':
      return `free_limit_stop:${notice.monthUtc}`;
    case 'growth_move':
      return `growth_move:${notice.startedAt}`;
    default:
      return assertNever(notice);
  }
}

export type FreePlanBannerV1 =
  | { readonly kind: 'card_due'; readonly deadlineAt: string }
  | { readonly kind: 'card_required' }
  | {
      readonly kind: 'free_limit_warning';
      readonly limit: FreePlanLimitV1;
      readonly cardOnFile: boolean;
    }
  | { readonly kind: 'free_limit_reached'; readonly limit: FreePlanLimitV1 }
  | {
      readonly kind: 'growth_move';
      readonly startedAt: string;
      readonly monthlyBaseMinor: number;
    };

export type FreePlanEvaluationV1 =
  | {
      readonly kind: 'stay';
      readonly productionState: ProductionStateV1;
      readonly notices: readonly FreePlanNoticeV1[];
      readonly banners: readonly FreePlanBannerV1[];
    }
  | {
      readonly kind: 'move_to_growth';
      readonly productionState: 'active';
      readonly limit: FreePlanLimitV1;
      readonly notices: readonly FreePlanNoticeV1[];
      readonly banners: readonly FreePlanBannerV1[];
    };

export interface FreePlanEvaluationInputV1 {
  readonly plan: BillingPlanV1;
  readonly card: PaymentMethodStateV1;
  readonly usage: FreePlanUsageV1;
  readonly nowMs: number;
}

export function monthUtcOf(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function freePlanDay(plan: BillingPlanV1, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - plan.freeStartedAtMs) / DAY_MS));
}

export function freePlanCardDeadlineMs(plan: BillingPlanV1): number {
  return plan.freeStartedAtMs + FREE_PLAN_CARD_GRACE_DAYS * DAY_MS;
}

/** The lock ends on the same day of the month, 12 months later (clamped to the month end). */
export function growthPriceLockedUntilMs(startedAtMs: number): number {
  const start = new Date(startedAtMs);
  const target = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + WALLET_GROWTH_PLAN_PRICE_V1.priceLockMonths,
      1,
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return target.getTime();
}

/** A card is valid through the last day of its expiry month. */
export function paymentMethodState(
  stored: (CardDisplayV1 & { readonly status: 'usable' | 'removed' }) | null,
  nowMs: number,
): PaymentMethodStateV1 {
  if (!stored) return { kind: 'none' };
  const display = {
    brand: stored.brand,
    last4: stored.last4,
    expMonth: stored.expMonth,
    expYear: stored.expYear,
  };
  if (stored.status === 'removed') return { kind: 'removed', ...display };
  const now = new Date(nowMs);
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const expiry = stored.expYear * 12 + (stored.expMonth - 1);
  return expiry >= current ? { kind: 'usable', ...display } : { kind: 'expired', ...display };
}

function firstReachedLimit(usage: FreePlanUsageV1, percent: number): FreePlanLimitV1 | null {
  if (usage.productionActiveUsers * 100 >= FREE_PLAN_LIMITS_V1.productionActiveUsers * percent)
    return 'active_users';
  if (usage.productionSignatures * 100 >= FREE_PLAN_LIMITS_V1.productionSignatures * percent)
    return 'signatures';
  return null;
}

function latestReminderDay(day: number): FreePlanCardReminderDayV1 | null {
  let latest: FreePlanCardReminderDayV1 | null = null;
  for (const reminder of FREE_PLAN_CARD_REMINDER_DAYS) if (day >= reminder) latest = reminder;
  return latest;
}

function growthMoveNotice(startedAtMs: number, priceVersion: string): FreePlanNoticeV1 {
  return {
    kind: 'growth_move',
    startedAt: new Date(startedAtMs).toISOString(),
    monthlyBaseMinor: WALLET_GROWTH_PLAN_PRICE_V1.monthlyBaseMinor,
    priceVersion,
  };
}

function evaluatePaidPlan(input: FreePlanEvaluationInputV1): FreePlanEvaluationV1 {
  const plan = input.plan;
  const banners: FreePlanBannerV1[] = [];
  if (plan.kind === 'growth' && monthUtcOf(plan.startedAtMs) === monthUtcOf(input.nowMs)) {
    banners.push({
      kind: 'growth_move',
      startedAt: new Date(plan.startedAtMs).toISOString(),
      monthlyBaseMinor: WALLET_GROWTH_PLAN_PRICE_V1.monthlyBaseMinor,
    });
  }
  // Enterprise runs on a contract. Growth needs a usable card, as for new paid work.
  if (plan.kind === 'growth' && input.card.kind !== 'usable') {
    banners.push({ kind: 'card_required' });
    return { kind: 'stay', productionState: 'card_required', notices: [], banners };
  }
  return { kind: 'stay', productionState: 'active', notices: [], banners };
}

/**
 * Decide the production state, the notices that are due, and whether the account
 * moves to Growth. Notices are idempotent by key, so the caller may repeat a pass.
 */
export function evaluateFreePlan(input: FreePlanEvaluationInputV1): FreePlanEvaluationV1 {
  if (input.plan.kind !== 'free') return evaluatePaidPlan(input);
  const plan = input.plan;
  const cardOnFile = input.card.kind === 'usable';
  const day = freePlanDay(plan, input.nowMs);
  const deadlineAt = new Date(freePlanCardDeadlineMs(plan)).toISOString();
  const reached = firstReachedLimit(input.usage, 100);
  const warned = firstReachedLimit(input.usage, FREE_PLAN_WARNING_PERCENT);
  const notices: FreePlanNoticeV1[] = [];
  const banners: FreePlanBannerV1[] = [];

  if (reached && cardOnFile) {
    return {
      kind: 'move_to_growth',
      productionState: 'active',
      limit: reached,
      notices: [growthMoveNotice(input.nowMs, WALLET_GROWTH_PLAN_PRICE_V1.version)],
      banners: [
        {
          kind: 'growth_move',
          startedAt: new Date(input.nowMs).toISOString(),
          monthlyBaseMinor: WALLET_GROWTH_PLAN_PRICE_V1.monthlyBaseMinor,
        },
      ],
    };
  }
  if (reached) {
    notices.push({ kind: 'free_limit_stop', monthUtc: input.usage.monthUtc, limit: reached });
    banners.push({ kind: 'free_limit_reached', limit: reached });
    return { kind: 'stay', productionState: 'free_limit_reached', notices, banners };
  }
  if (warned) {
    notices.push({
      kind: 'free_limit_warning',
      monthUtc: input.usage.monthUtc,
      limit: warned,
      cardOnFile,
    });
    banners.push({ kind: 'free_limit_warning', limit: warned, cardOnFile });
  }
  if (cardOnFile) return { kind: 'stay', productionState: 'active', notices, banners };
  if (day >= FREE_PLAN_CARD_GRACE_DAYS) {
    notices.push({ kind: 'card_required', deadlineAt });
    banners.push({ kind: 'card_required' });
    return { kind: 'stay', productionState: 'card_required', notices, banners };
  }
  const reminder = latestReminderDay(day);
  if (reminder !== null) {
    notices.push({ kind: 'card_reminder', day: reminder, deadlineAt });
    banners.push({ kind: 'card_due', deadlineAt });
  }
  return { kind: 'stay', productionState: 'active', notices, banners };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled free plan branch: ${JSON.stringify(value)}`);
}
