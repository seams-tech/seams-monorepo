import { queryD1One, type D1DatabaseLike, type D1PreparedStatementLike } from '../boundary/d1';
import { ConsoleBillingError } from './errors';
import {
  monthUtcOf,
  SELF_SERVE_PLAN_PRICES_V1,
  WALLET_GROWTH_PLAN_PRICE_V1,
  WALLET_PRO_PLAN_PRICE_V1,
  type SelfServePlanKindV1,
} from './freePlan';

interface PlanBaseChargeBase {
  readonly orgId: string;
  readonly monthUtc: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly amountMinor: number;
}

export type PlanBaseCharge =
  | (PlanBaseChargeBase & {
      readonly plan: 'growth';
      readonly priceVersion: typeof WALLET_GROWTH_PLAN_PRICE_V1.version;
    })
  | (PlanBaseChargeBase & {
      readonly plan: 'pro';
      readonly priceVersion: typeof WALLET_PRO_PLAN_PRICE_V1.version;
    });

export const PLAN_BASE_CHARGE_D1_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS billing_plan_base_charges (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    month_utc TEXT NOT NULL,
    plan TEXT NOT NULL,
    price_version TEXT NOT NULL,
    period_start_ms INTEGER NOT NULL,
    period_end_ms INTEGER NOT NULL,
    amount_minor INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, org_id, month_utc),
    FOREIGN KEY (namespace, org_id) REFERENCES billing_account_plans(namespace, org_id),
    CHECK (plan IN ('growth', 'pro')),
    CHECK (month_utc GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    CHECK (length(price_version) > 0),
    CHECK (period_start_ms > 0 AND period_end_ms > period_start_ms),
    CHECK (amount_minor > 0),
    CHECK (created_at_ms > 0)
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_account_plans_paid_insert_requires_start
    BEFORE INSERT ON billing_account_plans
    WHEN NEW.plan IN ('growth', 'pro')
    BEGIN SELECT RAISE(ABORT, 'paid_plan_must_start_from_free'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_account_plans_require_base_charge
    BEFORE UPDATE OF plan, plan_started_at_ms, price_version ON billing_account_plans
    WHEN NEW.plan IN ('growth', 'pro')
      AND (OLD.plan IS NOT NEW.plan
        OR OLD.plan_started_at_ms IS NOT NEW.plan_started_at_ms
        OR OLD.price_version IS NOT NEW.price_version)
      AND NOT EXISTS (
        SELECT 1 FROM billing_plan_base_charges AS charge
        WHERE charge.namespace = NEW.namespace
          AND charge.org_id = NEW.org_id
          AND charge.plan = NEW.plan
          AND charge.price_version = NEW.price_version
          AND charge.period_start_ms = NEW.plan_started_at_ms
      )
    BEGIN SELECT RAISE(ABORT, 'paid_plan_base_charge_required'); END`,
]);

function monthBounds(monthUtc: string): { readonly startMs: number; readonly endMs: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(monthUtc);
  if (!match) throw new ConsoleBillingError('invalid_month', 400, 'Billing month is invalid');
  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    startMs: Date.UTC(year, month - 1, 1),
    endMs: Date.UTC(year, month, 1),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported paid plan: ${String(value)}`);
}

export function planBaseChargeForMonth(input: {
  readonly orgId: string;
  readonly plan: SelfServePlanKindV1;
  readonly priceVersion: string;
  readonly startedAtMs: number;
  readonly monthUtc: string;
}): PlanBaseCharge | null {
  const price = SELF_SERVE_PLAN_PRICES_V1[input.plan];
  if (input.priceVersion !== price.version) {
    throw new ConsoleBillingError(
      'unsupported_plan_price_version',
      500,
      `No base price is configured for ${input.priceVersion}`,
    );
  }
  const bounds = monthBounds(input.monthUtc);
  if (!Number.isSafeInteger(input.startedAtMs) || input.startedAtMs <= 0) {
    throw new ConsoleBillingError('invalid_plan_start', 500, 'Plan start time is invalid');
  }
  if (input.startedAtMs >= bounds.endMs) return null;
  const periodStartMs = Math.max(input.startedAtMs, bounds.startMs);
  const durationMs = bounds.endMs - bounds.startMs;
  const activeMs = bounds.endMs - periodStartMs;
  const amountMinor = Math.max(1, Math.ceil((price.monthlyBaseMinor * activeMs) / durationMs));
  const base = {
    orgId: input.orgId,
    monthUtc: input.monthUtc,
    periodStartMs,
    periodEndMs: bounds.endMs,
    amountMinor,
  };
  switch (input.plan) {
    case 'growth':
      return { ...base, plan: 'growth', priceVersion: WALLET_GROWTH_PLAN_PRICE_V1.version };
    case 'pro':
      return { ...base, plan: 'pro', priceVersion: WALLET_PRO_PLAN_PRICE_V1.version };
    default:
      return assertNever(input.plan);
  }
}

export function planStartBaseChargeStatement(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly plan: SelfServePlanKindV1;
  readonly startedAtMs: number;
  readonly cardMonthIndex: number;
}): D1PreparedStatementLike {
  const priceVersion = SELF_SERVE_PLAN_PRICES_V1[input.plan].version;
  const charge = planBaseChargeForMonth({
    orgId: input.orgId,
    plan: input.plan,
    priceVersion,
    startedAtMs: input.startedAtMs,
    monthUtc: monthUtcOf(input.startedAtMs),
  });
  if (!charge) throw new Error('Plan start must create a base charge');
  return input.database
    .prepare(
      `INSERT INTO billing_plan_base_charges
        (namespace, org_id, month_utc, plan, price_version, period_start_ms,
          period_end_ms, amount_minor, created_at_ms)
       SELECT namespace, org_id, ?, ?, ?, ?, ?, ?, ?
         FROM billing_account_plans
        WHERE namespace = ? AND org_id = ? AND plan = 'free'
          AND EXISTS (
            SELECT 1 FROM billing_payment_methods AS card
            WHERE card.namespace = billing_account_plans.namespace
              AND card.org_id = billing_account_plans.org_id
              AND card.status = 'usable'
              AND card.exp_year * 12 + card.exp_month - 1 >= ?
          )
       ON CONFLICT(namespace, org_id, month_utc) DO NOTHING`,
    )
    .bind(
      charge.monthUtc,
      charge.plan,
      charge.priceVersion,
      charge.periodStartMs,
      charge.periodEndMs,
      charge.amountMinor,
      input.startedAtMs,
      input.namespace,
      input.orgId,
      input.cardMonthIndex,
    );
}

export async function accruePlanBaseChargeForMonth(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly nowMs: number;
}): Promise<PlanBaseCharge | null> {
  if (input.monthUtc > monthUtcOf(input.nowMs)) return null;
  const row = await queryD1One(
    input.database,
    `SELECT plan, plan_started_at_ms, price_version FROM billing_account_plans
      WHERE namespace = ? AND org_id = ?`,
    [input.namespace, input.orgId],
  );
  if (!row || (row.plan !== 'growth' && row.plan !== 'pro')) return null;
  if (typeof row.price_version !== 'string') {
    throw new ConsoleBillingError(
      'invalid_plan_price_version',
      500,
      'Plan price version is missing',
    );
  }
  const charge = planBaseChargeForMonth({
    orgId: input.orgId,
    plan: row.plan,
    priceVersion: row.price_version,
    startedAtMs: Number(row.plan_started_at_ms),
    monthUtc: input.monthUtc,
  });
  if (!charge) return null;
  await input.database
    .prepare(
      `INSERT INTO billing_plan_base_charges
        (namespace, org_id, month_utc, plan, price_version, period_start_ms,
          period_end_ms, amount_minor, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, org_id, month_utc) DO NOTHING`,
    )
    .bind(
      input.namespace,
      charge.orgId,
      charge.monthUtc,
      charge.plan,
      charge.priceVersion,
      charge.periodStartMs,
      charge.periodEndMs,
      charge.amountMinor,
      input.nowMs,
    )
    .run();
  const stored = await queryD1One(
    input.database,
    `SELECT plan, price_version, period_start_ms, period_end_ms, amount_minor
       FROM billing_plan_base_charges
      WHERE namespace = ? AND org_id = ? AND month_utc = ?`,
    [input.namespace, input.orgId, input.monthUtc],
  );
  if (
    stored?.plan !== charge.plan ||
    stored.price_version !== charge.priceVersion ||
    Number(stored.period_start_ms) !== charge.periodStartMs ||
    Number(stored.period_end_ms) !== charge.periodEndMs ||
    Number(stored.amount_minor) !== charge.amountMinor
  ) {
    throw new ConsoleBillingError(
      'base_charge_conflict',
      500,
      'Stored plan base charge differs from the pinned price',
    );
  }
  return charge;
}
