import type { PlanBaseCharge } from '../../packages/console-server-ts/src/billing/planBaseCharges';

declare const growth: Extract<PlanBaseCharge, { readonly plan: 'growth' }>;

// @ts-expect-error A Growth charge cannot use the Pro price version.
const wrongPrice: PlanBaseCharge = { ...growth, priceVersion: 'wallet-pro-v1' };

const { amountMinor: _amountMinor, ...withoutAmount } = growth;
// @ts-expect-error An accrual must state its amount.
const missingAmount: PlanBaseCharge = { ...withoutAmount };

void [wrongPrice, missingAmount];
