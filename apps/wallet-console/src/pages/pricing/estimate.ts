import { PRICING_USD } from './prices';

/* Published rates from docs/wallet-saas/pricing.md, except the placeholder Pro
   prices. Enterprise prices are negotiated, so its estimate applies only its
   published floors. */
export const FREE_USERS = 300;
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

/* A month on the plan; zero while the app stays inside the Free plan. */
export function estimate(plan: PaidPlanId, users: number, perDay: number): Estimate {
  const signatures = users * perDay * DAYS_PER_MONTH;
  if (users <= FREE_USERS && signatures <= FREE_SIGNATURES) {
    return { signatures, base: 0, users: 0, overageSignatures: 0, overage: 0, total: 0 };
  }
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
