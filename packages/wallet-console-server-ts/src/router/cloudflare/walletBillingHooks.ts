import type { AccountConsoleContext } from '@seams-internal/console-server/router/cloudflare/context';
import {
  observeConsoleRequestMetric,
  type ConsoleObservabilityHookContext,
} from '../consoleObservabilityHooks';
import type { ConsoleBillingService } from '@seams-internal/console-server/billing/service';
import type { ConsoleWebhookService } from '@seams-internal/console-server/webhooks/service';
import type { ConsoleObservabilityIngestionService } from '@seams-internal/console-server/observability/ingestionService';
import type { NormalizedRouterLogger } from '@seams-internal/console-server/boundary';
import { isConsoleBillingError } from '@seams-internal/console-server/billing/errors';
import type { BillingOverview } from '@seams-internal/console-server/billing/types';
import type { ConsoleAuthClaims as AccountAuthClaims } from '@seams-internal/console-server/router/consoleAuth';
import type {
  BillingRouteBalanceChange,
  BillingRouteFailure,
  ConsoleBillingRouteHooks,
} from '@seams-internal/console-server/router/cloudflare/billingRoutes';
import {
  buildWalletConsoleAuthClaims,
  type WalletConsoleAuthClaims as ConsoleAuthClaims,
} from '../walletConsoleAuth';
import {
  emitConsoleBillingFailureObservabilityEvent,
  emitConsoleBillingStripeWebhookFailureObservabilityEvent,
  readConsoleStripeWebhookFailureMetadata,
} from '../consoleObservabilityHooks';
import { emitSponsorshipBalanceTransitionEvents } from '@seams-internal/wallet-console-server/router/sponsorshipBillingEvents';
import { resolveBillingLiveEnvironmentState } from '../../environments/readiness';
import type { ConsoleSponsoredCallService } from '../../sponsoredCalls/service';

export interface WalletBillingRouteContext {
  readonly request: Request;
  readonly billing: ConsoleBillingService | null;
  readonly sponsoredCalls: ConsoleSponsoredCallService | null;
  readonly logger: NormalizedRouterLogger;
  readonly webhooks: ConsoleWebhookService | null;
  readonly observabilityIngestion: ConsoleObservabilityIngestionService | null;
}

function readOptionalRequestHeader(request: Request, header: string): string | undefined {
  return request.headers.get(header)?.trim() || undefined;
}

async function emitBillingFailureObservabilityEvent(
  ctx: WalletBillingRouteContext,
  claims: ConsoleAuthClaims,
  input: {
    operation: 'INVOICE_FINALIZATION' | 'PAYMENT_RECONCILE';
    invoiceId?: string;
    providerRef?: string;
    error: unknown;
  },
): Promise<void> {
  await emitConsoleBillingFailureObservabilityEvent(ctx, {
    claims,
    operation: input.operation,
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    ...(input.providerRef ? { providerRef: input.providerRef } : {}),
    failureCode: isConsoleBillingError(input.error) ? input.error.code : 'internal',
    failureMessage: input.error instanceof Error ? input.error.message : String(input.error),
    readHeader: readOptionalRequestHeader.bind(null, ctx.request),
  });
}

async function emitStripeWebhookFailureObservabilityEvent(
  ctx: WalletBillingRouteContext,
  input: {
    rawBody: unknown;
    eventType:
      | 'billing.stripe_webhook.invalid_signature'
      | 'billing.stripe_webhook.processing.failed';
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const metadata = readConsoleStripeWebhookFailureMetadata(input.rawBody);
  if (!metadata.orgId) return;
  await emitConsoleBillingStripeWebhookFailureObservabilityEvent(ctx, {
    orgId: metadata.orgId,
    actorUserId: 'system-stripe-webhook',
    eventType: input.eventType,
    ...(metadata.stripeEventId ? { stripeEventId: metadata.stripeEventId } : {}),
    ...(metadata.stripeEventType ? { stripeEventType: metadata.stripeEventType } : {}),
    ...(metadata.checkoutSessionId ? { checkoutSessionId: metadata.checkoutSessionId } : {}),
    ...(metadata.providerRef ? { providerRef: metadata.providerRef } : {}),
    ...(metadata.providerCustomerRef ? { providerCustomerRef: metadata.providerCustomerRef } : {}),
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
    readHeader: readOptionalRequestHeader.bind(null, ctx.request),
  });
}

async function buildConsoleBillingOverviewResponse(
  ctx: WalletBillingRouteContext,
  claims: AccountAuthClaims,
  overview: BillingOverview,
): Promise<Record<string, unknown>> {
  const billingCtx = { orgId: claims.orgId, actorUserId: claims.userId };
  const sponsoredSummary = ctx.sponsoredCalls
    ? await ctx.sponsoredCalls.getOverviewSummary(billingCtx)
    : null;
  return {
    ...overview,
    trailing30DaySponsoredSpendMinor:
      sponsoredSummary?.trailing30Days.chargedSettledSpendMinor || 0,
    trailing30DaySponsoredExecutionCount:
      sponsoredSummary?.trailing30Days.chargedExecutionCount || 0,
    trailing90DaySponsoredSpendMinor:
      sponsoredSummary?.trailing90Days.chargedSettledSpendMinor || 0,
    trailing90DaySponsoredExecutionCount:
      sponsoredSummary?.trailing90Days.chargedExecutionCount || 0,
  };
}

async function observeWalletBillingBalanceChange(
  ctx: WalletBillingRouteContext,
  change: BillingRouteBalanceChange,
): Promise<void> {
  await emitSponsorshipBalanceTransitionEvents({
    services: {
      logger: ctx.logger,
      webhooks: ctx.webhooks,
      observabilityIngestion: ctx.observabilityIngestion,
    },
    ctx: change.context,
    before: {
      creditBalanceMinor: change.before.creditBalanceMinor,
      lowBalanceThresholdMinor: change.before.lowBalanceThresholdMinor,
      state: resolveBillingLiveEnvironmentState(change.before),
    },
    billing: ctx.billing,
    trigger: change.trigger,
  });
}

async function observeWalletBillingFailure(
  ctx: WalletBillingRouteContext,
  claims: AccountAuthClaims,
  failure: BillingRouteFailure,
): Promise<void> {
  const walletClaims = buildWalletConsoleAuthClaims(
    claims,
    claims.projectId ?? null,
    ctx.request.headers.get('X-Console-Environment-Id'),
  );
  await emitBillingFailureObservabilityEvent(ctx, walletClaims, failure);
}

export function createWalletBillingRouteHooks(
  ctx: WalletBillingRouteContext,
): ConsoleBillingRouteHooks {
  return {
    overview: buildConsoleBillingOverviewResponse.bind(null, ctx),
    balanceChanged: observeWalletBillingBalanceChange.bind(null, ctx),
    failure: observeWalletBillingFailure.bind(null, ctx),
    stripeWebhookFailure: emitStripeWebhookFailureObservabilityEvent.bind(null, ctx),
  };
}

export async function observeWalletAccountRequest(
  services: ConsoleObservabilityHookContext,
  ctx: AccountConsoleContext,
  latencyMs: number,
  statusCode: number,
): Promise<void> {
  const claims =
    ctx.authClaims === undefined
      ? null
      : buildWalletConsoleAuthClaims(
          ctx.authClaims,
          ctx.authClaims.projectId ?? null,
          ctx.request.headers.get('X-Console-Environment-Id'),
        );
  await observeConsoleRequestMetric(services, {
    claims,
    route: ctx.pathname,
    method: ctx.method,
    statusCode,
    latencyMs,
  });
}
