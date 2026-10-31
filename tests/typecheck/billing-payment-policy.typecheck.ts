import {
  CreditLimitApproval,
  approveCreditLimit,
  type BillingPaymentPolicy,
} from '../../packages/console-server-ts/src/billing/postpaid';
import type { SigningCreditPolicy } from '../../packages/console-server-ts/src/billing/signingCredit';
import type { ConsoleBillingD1Runtime } from '../../packages/console-server-ts/src/billing/d1';

declare const runtime: ConsoleBillingD1Runtime;
declare const approval: CreditLimitApproval;
declare const prepaid: Extract<BillingPaymentPolicy, { kind: 'prepaid' }>;
// @ts-expect-error Prepaid accounts cannot contain a credit limit.
const invalidPrepaid: BillingPaymentPolicy = { kind: 'prepaid', creditLimitMinor: 100 };
// @ts-expect-error Credit approval records require an approver and approval time.
const invalidPostpaid: BillingPaymentPolicy = { kind: 'postpaid', creditLimitMinor: 100 };
// @ts-expect-error A spread cannot attach a credit limit to prepaid state.
const invalidSpread: BillingPaymentPolicy = { ...prepaid, creditLimitMinor: 100 };
// @ts-expect-error Raw objects cannot bypass the approval parser.
const forgedApproval: CreditLimitApproval = {
  orgId: 'org',
  creditLimitMinor: 100,
  reason: 'test',
  operationId: 'op',
};
// @ts-expect-error A spread loses the approval class identity.
const approvalSpread: CreditLimitApproval = { ...approval };
// @ts-expect-error Approval construction stays inside the boundary parser.
new CreditLimitApproval('org', 100, 'reason', 'operation');
// @ts-expect-error Account administrators cannot approve credit.
void approveCreditLimit(runtime, { userId: 'owner', platformSupport: false }, approval);
// @ts-expect-error A blocked signing policy cannot carry a usable grant.
const blockedGrant: SigningCreditPolicy = {
  kind: 'blocked',
  grant: { id: 'grant', capacity: 1, expiresAtMs: 1 },
};
// @ts-expect-error A credit policy requires an exact grant.
const missingGrant: SigningCreditPolicy = { kind: 'credit' };
void [
  invalidPrepaid,
  invalidPostpaid,
  invalidSpread,
  forgedApproval,
  approvalSpread,
  blockedGrant,
  missingGrant,
];

import type { PlanUsageRecordingResultV1 } from '../../packages/console-shared-ts/src/accountPlatform';
import type { FundsSummaryV1 } from '../../packages/console-server-ts/src/billingPrepaidReservations/types';
const mixedMauOutcome = {
  kind: 'rejected',
  error: { code: 'billing_credit_exhausted' },
  value: { kind: 'counted' },
} as const;
// @ts-expect-error A refused MAU admission cannot also report successful counting.
const refusedMau: PlanUsageRecordingResultV1 = mixedMauOutcome;
declare const prepaidSummary: Extract<FundsSummaryV1, { kind: 'prepaid' }>;
// @ts-expect-error A spread cannot attach postpaid credit to a prepaid summary.
const mixedSummary: FundsSummaryV1 = { ...prepaidSummary, creditLimitMinor: 100 };
void [refusedMau, mixedSummary];
