import {
  buildConsoleObservabilityEventEnvelope,
  type ConsoleObservabilityEventEnvelope,
  type ConsoleObservabilityEventPolicy,
  type ConsoleObservabilityRequestMetricPolicy,
} from '@seams-internal/console-server/observability';

declare module '@seams-internal/console-server/observability/types' {
  interface ConsoleObservabilitySourceExtensions {
    APPROVAL: true;
  }
}

export const WALLET_CONSOLE_OBSERVABILITY_SOURCES = ['APPROVAL'] as const;

export const WALLET_CONSOLE_OBSERVABILITY_EVENT_POLICIES = {
  billingBalanceLow: {
    source: 'BILLING',
    service: 'billing',
    component: 'sponsorship_prepaid_balance',
    level: 'WARN',
    eventType: 'billing.balance.low_balance',
  },
  billingBalanceBlocked: {
    source: 'BILLING',
    service: 'billing',
    component: 'sponsorship_prepaid_balance',
    level: 'WARN',
    eventType: 'billing.balance.blocked',
  },
  billingBalanceRecovered: {
    source: 'BILLING',
    service: 'billing',
    component: 'sponsorship_prepaid_balance',
    level: 'INFO',
    eventType: 'billing.balance.recovered',
  },
  billingSponsorshipBlocked: {
    source: 'BILLING',
    service: 'billing',
    component: 'sponsorship_prepaid_balance',
    level: 'WARN',
    eventType: 'billing.sponsorship.blocked',
  },
  approvalPublishFailure: {
    source: 'APPROVAL',
    service: 'approvals',
    component: 'policy_publish',
    level: 'ERROR',
    eventType: 'approval.policy_publish.failed',
  },
} as const satisfies Record<string, ConsoleObservabilityEventPolicy>;

export const WALLET_CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES = [
  { routeFamily: '/console/approvals/*', service: 'approvals' },
  { routeFamily: '/console/policies/*', service: 'policies' },
  { routeFamily: '/console/policy/*', service: 'policy' },
  { routeFamily: '/console/wallets/*', service: 'wallets' },
  { routeFamily: '/console/runtime-snapshots/*', service: 'runtime-snapshots' },
  { routeFamily: '/console/key-exports/*', service: 'key-exports' },
  { routeFamily: '/console/sponsored-calls/*', service: 'sponsored-calls' },
  { routeFamily: '/console/sponsorship-spend-caps/*', service: 'sponsorship-spend-caps' },
] as const satisfies readonly ConsoleObservabilityRequestMetricPolicy[];

interface WalletObservabilityInput {
  orgId: string;
  projectId?: string;
  environmentId?: string;
  requestId?: string;
  traceId?: string;
  timestamp?: string;
  schemaVersion?: number;
  redactionVersion?: number;
}

export interface WalletBillingBalanceTransitionObservabilityInput extends WalletObservabilityInput {
  eventType:
    | 'billing.balance.low_balance'
    | 'billing.balance.blocked'
    | 'billing.balance.recovered';
  previousState: 'HEALTHY' | 'LOW_BALANCE' | 'BLOCKED';
  currentState: 'HEALTHY' | 'LOW_BALANCE' | 'BLOCKED';
  creditBalanceMinor: number;
  lowBalanceThresholdMinor: number;
  triggerKind: string;
  routeId?: string;
  ledgerEntryId?: string;
  adjustmentId?: string;
  purchaseId?: string;
  sourceEventId?: string;
}

export interface WalletApprovalFailureObservabilityInput extends WalletObservabilityInput {
  approvalId?: string;
  operationType: string;
  resourceType?: string;
  resourceId?: string;
  failureCode: string;
  failureMessage: string;
}

export interface WalletBillingSponsorshipBlockedObservabilityInput extends WalletObservabilityInput {
  policyId?: string;
  routeId?: string;
  chainFamily?: string;
  intentKind?: string;
  executorKind?: string;
  chainId?: number;
  accountRef?: string;
  targetRef?: string;
  idempotencyKey?: string;
  sourceEventId?: string;
  balanceState?: string;
  creditBalanceMinor?: number;
  lowBalanceThresholdMinor?: number;
  availableBalanceMinor?: number;
  postedBalanceMinor?: number;
  reservedMinor?: number;
  requestedMinor?: number;
  failureCode: string;
  failureMessage: string;
}

function normalizeString(raw: unknown): string {
  return String(raw || '').trim();
}

function optionalString(raw: unknown): string | undefined {
  const value = normalizeString(raw);
  return value || undefined;
}

function optionalNumber(raw: unknown): number | undefined {
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function buildWalletBillingBalanceTransitionObservabilityEvent(
  input: WalletBillingBalanceTransitionObservabilityInput,
): ConsoleObservabilityEventEnvelope {
  const policy =
    input.eventType === 'billing.balance.low_balance'
      ? WALLET_CONSOLE_OBSERVABILITY_EVENT_POLICIES.billingBalanceLow
      : input.eventType === 'billing.balance.blocked'
        ? WALLET_CONSOLE_OBSERVABILITY_EVENT_POLICIES.billingBalanceBlocked
        : WALLET_CONSOLE_OBSERVABILITY_EVENT_POLICIES.billingBalanceRecovered;
  const message =
    input.eventType === 'billing.balance.low_balance'
      ? 'Sponsored prepaid balance entered low-balance state'
      : input.eventType === 'billing.balance.blocked'
        ? 'Sponsored prepaid balance became blocked'
        : 'Sponsored prepaid balance recovered to healthy state';
  return buildConsoleObservabilityEventEnvelope({
    ...input,
    eventIdPrefix: 'obs_billing_balance_transition',
    source: policy.source,
    service: policy.service,
    component: policy.component,
    level: policy.level,
    eventType: policy.eventType,
    message,
    metadata: {
      previousState: normalizeString(input.previousState),
      currentState: normalizeString(input.currentState),
      creditBalanceMinor: Number(input.creditBalanceMinor),
      lowBalanceThresholdMinor: Number(input.lowBalanceThresholdMinor),
      triggerKind: normalizeString(input.triggerKind),
      ...(optionalString(input.routeId) ? { routeId: optionalString(input.routeId) } : {}),
      ...(optionalString(input.ledgerEntryId)
        ? { ledgerEntryId: optionalString(input.ledgerEntryId) }
        : {}),
      ...(optionalString(input.adjustmentId)
        ? { adjustmentId: optionalString(input.adjustmentId) }
        : {}),
      ...(optionalString(input.purchaseId) ? { purchaseId: optionalString(input.purchaseId) } : {}),
      ...(optionalString(input.sourceEventId)
        ? { sourceEventId: optionalString(input.sourceEventId) }
        : {}),
    },
  });
}

export function buildWalletApprovalFailureObservabilityEvent(
  input: WalletApprovalFailureObservabilityInput,
): ConsoleObservabilityEventEnvelope {
  const policy = WALLET_CONSOLE_OBSERVABILITY_EVENT_POLICIES.approvalPublishFailure;
  return buildConsoleObservabilityEventEnvelope({
    ...input,
    eventIdPrefix: 'obs_approval_failure',
    source: policy.source,
    service: policy.service,
    component: policy.component,
    level: policy.level,
    eventType: policy.eventType,
    message: normalizeString(input.failureMessage),
    metadata: {
      operationType: normalizeString(input.operationType),
      failureCode: normalizeString(input.failureCode),
      ...(optionalString(input.approvalId) ? { approvalId: optionalString(input.approvalId) } : {}),
      ...(optionalString(input.resourceType)
        ? { resourceType: optionalString(input.resourceType) }
        : {}),
      ...(optionalString(input.resourceId) ? { resourceId: optionalString(input.resourceId) } : {}),
    },
  });
}

export function buildWalletBillingSponsorshipBlockedObservabilityEvent(
  input: WalletBillingSponsorshipBlockedObservabilityInput,
): ConsoleObservabilityEventEnvelope {
  const policy = WALLET_CONSOLE_OBSERVABILITY_EVENT_POLICIES.billingSponsorshipBlocked;
  return buildConsoleObservabilityEventEnvelope({
    ...input,
    eventIdPrefix: 'obs_billing_sponsorship_blocked',
    source: policy.source,
    service: policy.service,
    component: policy.component,
    level: policy.level,
    eventType: policy.eventType,
    message: normalizeString(input.failureMessage),
    metadata: {
      failureCode: normalizeString(input.failureCode),
      ...(optionalString(input.policyId) ? { policyId: optionalString(input.policyId) } : {}),
      ...(optionalString(input.routeId) ? { routeId: optionalString(input.routeId) } : {}),
      ...(optionalString(input.chainFamily)
        ? { chainFamily: optionalString(input.chainFamily) }
        : {}),
      ...(optionalString(input.intentKind) ? { intentKind: optionalString(input.intentKind) } : {}),
      ...(optionalString(input.executorKind)
        ? { executorKind: optionalString(input.executorKind) }
        : {}),
      ...(optionalNumber(input.chainId) !== undefined ? { chainId: Number(input.chainId) } : {}),
      ...(optionalString(input.accountRef) ? { accountRef: optionalString(input.accountRef) } : {}),
      ...(optionalString(input.targetRef) ? { targetRef: optionalString(input.targetRef) } : {}),
      ...(optionalString(input.idempotencyKey)
        ? { idempotencyKey: optionalString(input.idempotencyKey) }
        : {}),
      ...(optionalString(input.sourceEventId)
        ? { sourceEventId: optionalString(input.sourceEventId) }
        : {}),
      ...(optionalString(input.balanceState)
        ? { balanceState: optionalString(input.balanceState) }
        : {}),
      ...(optionalNumber(input.creditBalanceMinor) !== undefined
        ? { creditBalanceMinor: Number(input.creditBalanceMinor) }
        : {}),
      ...(optionalNumber(input.lowBalanceThresholdMinor) !== undefined
        ? { lowBalanceThresholdMinor: Number(input.lowBalanceThresholdMinor) }
        : {}),
      ...(optionalNumber(input.availableBalanceMinor) !== undefined
        ? { availableBalanceMinor: Number(input.availableBalanceMinor) }
        : {}),
      ...(optionalNumber(input.postedBalanceMinor) !== undefined
        ? { postedBalanceMinor: Number(input.postedBalanceMinor) }
        : {}),
      ...(optionalNumber(input.reservedMinor) !== undefined
        ? { reservedMinor: Number(input.reservedMinor) }
        : {}),
      ...(optionalNumber(input.requestedMinor) !== undefined
        ? { requestedMinor: Number(input.requestedMinor) }
        : {}),
    },
  });
}
