import { PRICING_USD } from './prices';

/* Published rates from docs/wallet-saas/pricing.md, except the placeholder Pro
   prices. Enterprise prices are negotiated, so its estimate applies only its
   published floors. */
export const FREE_USERS = 300;
export const USER_STEPS: readonly number[] = [
  FREE_USERS,
  500,
  1_000,
  2_500,
  5_000,
  10_000,
  25_000,
  50_000,
  100_000,
  250_000,
  500_000,
  1_000_000,
  2_500_000,
  5_000_000,
  10_000_000,
];
export const MIN_PER_DAY = 1;
export const MAX_PER_DAY = 50;
const FREE_SIGNATURES = 30_000;
const POOL_PER_USER = 300;
const DAYS_PER_MONTH = 30;

export type SelfServePlanId = 'growth' | 'pro';
export type PaidPlanId = SelfServePlanId | 'enterprise';

type Rates = {
  base: number;
  includedUsers: number;
  perUser: number;
  per1000: number;
};

const RATES: Record<PaidPlanId, Rates> = {
  growth: {
    base: PRICING_USD.growthBase,
    includedUsers: 5_000,
    perUser: PRICING_USD.growthPerUser,
    per1000: PRICING_USD.growthPer1000Signatures,
  },
  pro: {
    base: PRICING_USD.proBase,
    includedUsers: 100_000,
    perUser: PRICING_USD.proPerUser,
    per1000: PRICING_USD.proPer1000Signatures,
  },
  // The Enterprise floors start from the Growth base and its included users.
  enterprise: {
    base: PRICING_USD.growthBase,
    includedUsers: 5_000,
    perUser: PRICING_USD.enterprisePerUser,
    per1000: PRICING_USD.enterprisePer1000Signatures,
  },
};

export type Estimate = {
  signatures: number;
  base: number;
  users: number;
  overageSignatures: number;
  overage: number;
  total: number;
};

export function isWithinFreePlan(users: number, perDay: number): boolean {
  return users <= FREE_USERS && users * perDay * DAYS_PER_MONTH <= FREE_SIGNATURES;
}

/* A full month after this paid plan starts, including its base fee. */
export function estimate(plan: PaidPlanId, users: number, perDay: number): Estimate {
  const signatures = users * perDay * DAYS_PER_MONTH;
  const rates = RATES[plan];
  const userCost = Math.max(0, users - rates.includedUsers) * rates.perUser;
  const overageSignatures = Math.max(0, signatures - users * POOL_PER_USER);
  const overage = (overageSignatures / 1_000) * rates.per1000;
  return {
    signatures,
    base: rates.base,
    users: userCost,
    overageSignatures,
    overage,
    total: rates.base + userCost + overage,
  };
}

/* The cheaper of the plans that start without a contract; Growth wins a tie. */
export function lowestSelfServePlan(users: number, perDay: number): SelfServePlanId {
  return estimate('pro', users, perDay).total < estimate('growth', users, perDay).total
    ? 'pro'
    : 'growth';
}
