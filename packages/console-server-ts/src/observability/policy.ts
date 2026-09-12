import type { ConsoleObservabilityLevel, ConsoleObservabilitySource } from './types';

export const CONSOLE_OBSERVABILITY_SOURCES = [
  'WEBHOOK',
  'BILLING',
  'SYSTEM',
] as const satisfies readonly ConsoleObservabilitySource[];

export const CONSOLE_OBSERVABILITY_SOURCE_SET = new Set<ConsoleObservabilitySource>(
  CONSOLE_OBSERVABILITY_SOURCES,
);

export const CONSOLE_OBSERVABILITY_SOURCES_SQL = CONSOLE_OBSERVABILITY_SOURCES.map(
  (source) => `'${source}'`,
).join(', ');

export interface ConsoleObservabilityEventPolicy {
  source: ConsoleObservabilitySource;
  service: string;
  component: string;
  level: ConsoleObservabilityLevel;
  eventType?: string;
}

export const CONSOLE_OBSERVABILITY_EVENT_POLICIES = {
  webhookDeadLetter: {
    source: 'WEBHOOK',
    service: 'webhooks',
    component: 'delivery_dispatch',
    level: 'ERROR',
    eventType: 'webhook.delivery.dead_letter',
  },
  webhookDeliveryRetryExhausted: {
    source: 'WEBHOOK',
    service: 'webhooks',
    component: 'delivery_dispatch',
    level: 'ERROR',
    eventType: 'webhook.delivery.retry_exhausted',
  },
  webhookEndpointDegraded: {
    source: 'WEBHOOK',
    service: 'webhooks',
    component: 'endpoint_health',
    level: 'WARN',
    eventType: 'webhook.endpoint.degraded',
  },
  billingInvoiceFinalizationFailure: {
    source: 'BILLING',
    service: 'billing',
    component: 'finalization',
    level: 'ERROR',
    eventType: 'billing.invoice_finalization.failed',
  },
  billingPaymentReconcileFailure: {
    source: 'BILLING',
    service: 'billing',
    component: 'checkout_reconcile',
    level: 'ERROR',
    eventType: 'billing.payment_reconcile.failed',
  },
  billingStripeWebhookInvalidSignature: {
    source: 'BILLING',
    service: 'billing',
    component: 'stripe_webhook',
    level: 'ERROR',
    eventType: 'billing.stripe_webhook.invalid_signature',
  },
  billingStripeWebhookProcessingFailure: {
    source: 'BILLING',
    service: 'billing',
    component: 'stripe_webhook',
    level: 'ERROR',
    eventType: 'billing.stripe_webhook.processing.failed',
  },
  recoveryExecutionFailed: {
    source: 'SYSTEM',
    service: 'recovery-authority',
    component: 'execution_monitor',
    level: 'ERROR',
    eventType: 'system.recovery_execution.failed',
  },
  recoveryExecutionStuck: {
    source: 'SYSTEM',
    service: 'recovery-authority',
    component: 'execution_monitor',
    level: 'WARN',
    eventType: 'system.recovery_execution.stuck',
  },
} as const satisfies Record<string, ConsoleObservabilityEventPolicy>;

export interface ConsoleObservabilityRequestMetricPolicy {
  routeFamily: string;
  service: string;
}

export const CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES = [
  { routeFamily: '/console/billing/*', service: 'billing' },
  { routeFamily: '/console/webhooks/*', service: 'webhooks' },
  { routeFamily: '/console/onboarding/*', service: 'onboarding' },
  { routeFamily: '/console/api-keys/*', service: 'api-keys' },
  { routeFamily: '/console/isolation/*', service: 'isolation' },
] as const satisfies readonly ConsoleObservabilityRequestMetricPolicy[];

const REQUEST_METRIC_POLICY_BY_ROUTE_FAMILY = new Map<
  string,
  ConsoleObservabilityRequestMetricPolicy
>(CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES.map((policy) => [policy.routeFamily, policy]));

export function resolveConsoleObservabilityRequestMetricPolicy(
  routeFamily: string,
  policies: readonly ConsoleObservabilityRequestMetricPolicy[] = CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES,
): ConsoleObservabilityRequestMetricPolicy | null {
  if (policies === CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES) {
    return REQUEST_METRIC_POLICY_BY_ROUTE_FAMILY.get(routeFamily) || null;
  }
  return policies.find((policy) => policy.routeFamily === routeFamily) || null;
}
