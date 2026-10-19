import type { ConsoleBillingService, ConsoleBillingContext } from '../../billing/service';
import type { BillingOverview } from '../../billing/types';
import {
  buildConsoleBillingInvoicePdf,
  buildConsoleBillingInvoicePdfFilename,
  CONSOLE_BILLING_INVOICE_PDF_EXPORT_POLICY,
} from '../../billing/pdf';
import {
  parseBillingAccountActivityRequest,
  parseBillingInvoiceListRequest,
  parseBillingManualAdjustmentRequest,
  parseStripeCheckoutSessionReconcileRequest,
  parseGenerateMonthlyInvoiceRequest,
  parseStripeCheckoutSessionRequest,
} from '../../billing/requests';
import { verifyAndParseStripeWebhookRequest } from '../../billing/stripeWebhook';
import { isConsoleBillingError } from '../../billing/errors';
import { buildConsoleBillingCreditPurchaseSettledAuditEvent } from '../../billing/stripePostProcessing';
import { buildConsoleBillingInvoiceGeneratedAuditEvent } from '../../billing/auditMetadata';
import { dispatchBillingStripePostProcessingEvent } from '../stripePostProcessing';
import type { ConsoleAuthClaims } from '../consoleAuth';
import type { AccountConsoleContext } from './context';
import {
  requireConsoleAuth,
  requireConsoleRoutePolicy,
  requireOrganizationAccessService,
  emitConsoleAuditEvent,
  decodePathPart,
} from './accountRoutes';
import { json, readJson } from './http';
import { getConsoleBillingD1Runtime } from '../../billing/d1';
import { listD1BillingUsageCharges } from '../../billing/attribution';
import { isConsoleOrgProjectError } from '../../orgProjectEnv/errors';
import {
  parsePlatformBillingLookupRequest,
  parsePlatformBillingSearchRequest,
  parsePlatformBillingManualAdjustmentRequest,
  parsePlatformBillingRefundReconcileRequest,
  parsePlatformBillingRefundRequest,
  resolvePlatformBillingLookup,
  searchPlatformBillingOrganizations,
} from '../platformBilling';

export type BillingRouteBalanceTrigger =
  | {
      readonly kind: 'manual_support_credit' | 'manual_admin_debit';
      readonly adjustmentId: string;
      readonly sourceEventId: string | null;
    }
  | {
      readonly kind: 'credit_purchase_settled';
      readonly purchaseId: string | null;
      readonly sourceEventId: string;
    };
export interface BillingRouteBalanceChange {
  readonly context: ConsoleBillingContext;
  readonly before: BillingOverview;
  readonly trigger: BillingRouteBalanceTrigger;
}
type BillingRouteFailureTarget =
  | {
      readonly operation: 'INVOICE_FINALIZATION';
      readonly invoiceId: string;
      readonly providerRef?: never;
    }
  | {
      readonly operation: 'PAYMENT_RECONCILE';
      readonly providerRef: string;
      readonly invoiceId?: never;
    };
export type BillingRouteFailure = BillingRouteFailureTarget & { readonly error: unknown };
export interface BillingStripeWebhookFailure {
  readonly rawBody: unknown;
  readonly eventType:
    | 'billing.stripe_webhook.invalid_signature'
    | 'billing.stripe_webhook.processing.failed';
  readonly failureCode: string;
  readonly failureMessage: string;
}
export interface ConsoleBillingRouteHooks {
  readonly overview:
    | ((claims: ConsoleAuthClaims, overview: BillingOverview) => Promise<Record<string, unknown>>)
    | null;
  readonly balanceChanged: ((change: BillingRouteBalanceChange) => Promise<void>) | null;
  readonly failure:
    | ((claims: ConsoleAuthClaims, failure: BillingRouteFailure) => Promise<void>)
    | null;
  readonly stripeWebhookFailure: ((failure: BillingStripeWebhookFailure) => Promise<void>) | null;
}
export const ACCOUNT_BILLING_HOOKS: ConsoleBillingRouteHooks = {
  overview: null,
  balanceChanged: null,
  failure: null,
  stripeWebhookFailure: null,
};
function isSharedBillingPath(pathname: string): boolean {
  return (
    pathname.startsWith('/console/platform/billing/') ||
    pathname === '/console/billing/overview' ||
    pathname === '/console/billing/refunds' ||
    pathname === '/console/billing/account/activity' ||
    pathname === '/console/billing/usage/charges' ||
    pathname === '/console/billing/invoices' ||
    pathname.startsWith('/console/billing/invoices/') ||
    pathname === '/console/billing/adjustments/support-credit' ||
    pathname === '/console/billing/adjustments/admin-debit' ||
    pathname === '/console/billing/stripe/webhook' ||
    pathname === '/console/billing/stripe/checkout-session' ||
    pathname === '/console/billing/stripe/checkout-session/reconcile'
  );
}
async function observeBalanceChange(
  hooks: ConsoleBillingRouteHooks,
  context: ConsoleBillingContext,
  before: BillingOverview | null,
  trigger: BillingRouteBalanceTrigger,
): Promise<void> {
  if (before && hooks.balanceChanged) await hooks.balanceChanged({ context, before, trigger });
}

export function sendBillingError(error: unknown): Response {
  if (isConsoleBillingError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function toArrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function requireBillingService(ctx: AccountConsoleContext): ConsoleBillingService | Response {
  if (ctx.billing) return ctx.billing;
  return json(
    {
      ok: false,
      code: 'billing_not_configured',
      message: 'Billing service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireStripeWebhookSigningSecret(ctx: AccountConsoleContext): string | Response {
  const configured = String(ctx.billingStripeWebhookSigningSecret || '').trim();
  if (!configured) {
    return json(
      {
        ok: false,
        code: 'stripe_webhook_not_configured',
        message: 'Stripe webhook signing secret is not configured on this server',
      },
      { status: 503 },
    );
  }
  return configured;
}

async function emitBillingWebhookEvent(
  ctx: AccountConsoleContext,
  input: {
    orgId: string;
    actorUserId: string;
    eventType: string;
    payload: Record<string, unknown>;
    eventId?: string;
  },
): Promise<void> {
  if (!ctx.webhooks) return;
  try {
    await ctx.webhooks.emitEvent(
      {
        orgId: input.orgId,
        actorUserId: input.actorUserId,
      },
      {
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
      },
    );
  } catch (error: unknown) {
    ctx.logger.warn('[console][webhooks] failed to emit billing event', {
      eventType: input.eventType,
      orgId: input.orgId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleConsoleBillingRoutes(
  ctx: AccountConsoleContext,
  hooks: ConsoleBillingRouteHooks,
): Promise<Response | null> {
  if (!isSharedBillingPath(ctx.pathname)) return null;
  if (ctx.method === 'POST' && ctx.pathname === '/console/billing/stripe/webhook') {
    const signingSecret = requireStripeWebhookSigningSecret(ctx);
    if (signingSecret instanceof Response) return signingSecret;
    const rawBody = new Uint8Array(await ctx.request.arrayBuffer());
    const billingOrResponse = requireBillingService(ctx);
    if (billingOrResponse instanceof Response) return billingOrResponse;
    try {
      const request = await verifyAndParseStripeWebhookRequest({
        rawBody,
        signatureHeader: ctx.request.headers.get('Stripe-Signature') || '',
        secret: signingSecret,
      });
      if (!request) {
        return json({ ok: true, accepted: false, ignored: true }, { status: 200 });
      }
      const result = await billingOrResponse.processStripeWebhookEvent(request);
      const postProcessing = await dispatchBillingStripePostProcessingEvent(
        {
          billing: billingOrResponse,
          audit: ctx.audit,
          webhooks: ctx.webhooks,
          logger: ctx.logger,
        },
        request.eventId,
      );
      if (!postProcessing.completed) {
        return json(
          {
            ok: false,
            code: 'stripe_post_processing_pending',
            message: 'Stripe event committed; post-processing remains pending',
          },
          { status: 503 },
        );
      }
      return json({ ok: true, ...result }, { status: 200 });
    } catch (error: unknown) {
      if (hooks.stripeWebhookFailure)
        await hooks.stripeWebhookFailure({
          rawBody,
          eventType:
            isConsoleBillingError(error) && error.code === 'invalid_stripe_signature'
              ? 'billing.stripe_webhook.invalid_signature'
              : 'billing.stripe_webhook.processing.failed',
          failureCode: isConsoleBillingError(error) ? error.code : 'internal',
          failureMessage: error instanceof Error ? error.message : String(error),
        });
      return sendBillingError(error);
    }
  }

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;
  const billingOrResponse = requireBillingService(ctx);
  if (billingOrResponse instanceof Response) return billingOrResponse;
  const billing = billingOrResponse;
  const billingCtx = { orgId: auth.claims.orgId, actorUserId: auth.claims.userId };
  const invoiceMatch = ctx.pathname.match(/^\/console\/billing\/invoices\/([^/]+)$/);
  const invoicePdfMatch = ctx.pathname.match(/^\/console\/billing\/invoices\/([^/]+)\/pdf$/);
  const invoiceActivityMatch = ctx.pathname.match(
    /^\/console\/billing\/invoices\/([^/]+)\/activity$/,
  );
  const invoiceLineItemsMatch = ctx.pathname.match(
    /^\/console\/billing\/invoices\/([^/]+)\/line-items$/,
  );
  let billingFailureEvent: BillingRouteFailureTarget | null = null;

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/billing/usage/charges') {
      const runtime = getConsoleBillingD1Runtime(billing);
      if (!runtime)
        return json({ ok: false, code: 'usage_attribution_unavailable' }, { status: 503 });
      const request = parseBillingInvoiceListRequest(
        Object.fromEntries(ctx.url.searchParams.entries()),
      );
      const periodMonthUtc = request.periodMonthUtc ?? runtime.now().toISOString().slice(0, 7);
      const charges = await listD1BillingUsageCharges({
        database: runtime.database,
        namespace: runtime.namespace,
        organizationId: auth.claims.orgId,
        periodMonthUtc,
      });
      return json(
        { ok: true, organizationId: auth.claims.orgId, periodMonthUtc, charges },
        { status: 200 },
      );
    }
    if (ctx.method === 'GET' && ctx.pathname === '/console/platform/billing/search') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const projectsOrResponse = ctx.orgProjects;
      if (!projectsOrResponse)
        return json({ ok: false, code: 'org_project_not_configured' }, { status: 503 });
      const organizationAccess = requireOrganizationAccessService(ctx);
      if (organizationAccess instanceof Response) return organizationAccess;
      const accounts = await searchPlatformBillingOrganizations({
        billing,
        orgProjects: projectsOrResponse,
        organizationAccess,
        request: parsePlatformBillingSearchRequest(
          Object.fromEntries(ctx.url.searchParams.entries()),
        ),
      });
      return json({ ok: true, accounts }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/platform/billing/account') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const projectsOrResponse = ctx.orgProjects;
      if (!projectsOrResponse)
        return json({ ok: false, code: 'org_project_not_configured' }, { status: 503 });
      const organizationAccess = requireOrganizationAccessService(ctx);
      if (organizationAccess instanceof Response) return organizationAccess;
      const result = await resolvePlatformBillingLookup({
        claims: auth.claims,
        billing,
        orgProjects: projectsOrResponse,
        organizationAccess,
        request: parsePlatformBillingLookupRequest(
          Object.fromEntries(ctx.url.searchParams.entries()),
        ),
      });
      return json({ ok: true, result }, { status: 200 });
    }

    if (
      ctx.method === 'POST' &&
      ctx.pathname === '/console/platform/billing/adjustments/support-credit'
    ) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const projectsOrResponse = ctx.orgProjects;
      if (!projectsOrResponse)
        return json({ ok: false, code: 'org_project_not_configured' }, { status: 503 });
      const request = parsePlatformBillingManualAdjustmentRequest(await readJson(ctx.request));
      const { orgId, ...adjustmentRequest } = request;
      const organization = await projectsOrResponse.getOrganization({
        orgId,
        actorUserId: auth.claims.userId,
        ...(auth.claims.projectId ? { projectId: auth.claims.projectId } : {}),
      });
      const targetBillingCtx = {
        orgId,
        actorUserId: auth.claims.userId,
      };
      const before = hooks.balanceChanged ? await billing.getOverview(targetBillingCtx) : null;
      const result = await billing.grantManualSupportCredit(targetBillingCtx, adjustmentRequest);
      await observeBalanceChange(hooks, targetBillingCtx, before, {
        kind: 'manual_support_credit',
        adjustmentId: result.adjustment.id,
        sourceEventId: result.adjustment.idempotencyKey,
      });
      await emitConsoleAuditEvent(
        ctx,
        {
          ...auth.claims,
          orgId,
        },
        {
          category: 'BILLING',
          action: 'billing.adjustment.support_credit',
          summary: `Appended manual support credit for org ${orgId}`,
          metadata: {
            organizationId: orgId,
            organizationName: organization.name,
            adjustmentId: result.adjustment.id,
            amountMinor: result.adjustment.amountMinor,
            resultingBalanceMinor: result.creditBalanceMinor,
            reasonCode: result.adjustment.reasonCode,
            note: result.adjustment.note,
            relatedInvoiceId: result.adjustment.relatedInvoiceId,
            idempotencyKey: result.adjustment.idempotencyKey,
            created: result.created,
            platformBilling: true,
          },
        },
      );
      return json({ ok: true, result }, { status: result.created ? 201 : 200 });
    }

    if (
      ctx.method === 'POST' &&
      ctx.pathname === '/console/platform/billing/adjustments/admin-debit'
    ) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const projectsOrResponse = ctx.orgProjects;
      if (!projectsOrResponse)
        return json({ ok: false, code: 'org_project_not_configured' }, { status: 503 });
      const request = parsePlatformBillingManualAdjustmentRequest(await readJson(ctx.request));
      const { orgId, ...adjustmentRequest } = request;
      const organization = await projectsOrResponse.getOrganization({
        orgId,
        actorUserId: auth.claims.userId,
        ...(auth.claims.projectId ? { projectId: auth.claims.projectId } : {}),
      });
      const targetBillingCtx = {
        orgId,
        actorUserId: auth.claims.userId,
      };
      const before = hooks.balanceChanged ? await billing.getOverview(targetBillingCtx) : null;
      const result = await billing.appendManualAdminDebit(targetBillingCtx, adjustmentRequest);
      await observeBalanceChange(hooks, targetBillingCtx, before, {
        kind: 'manual_admin_debit',
        adjustmentId: result.adjustment.id,
        sourceEventId: result.adjustment.idempotencyKey,
      });
      await emitConsoleAuditEvent(
        ctx,
        {
          ...auth.claims,
          orgId,
        },
        {
          category: 'BILLING',
          action: 'billing.adjustment.admin_debit',
          summary: `Appended manual admin debit for org ${orgId}`,
          metadata: {
            organizationId: orgId,
            organizationName: organization.name,
            adjustmentId: result.adjustment.id,
            amountMinor: result.adjustment.amountMinor,
            resultingBalanceMinor: result.creditBalanceMinor,
            reasonCode: result.adjustment.reasonCode,
            note: result.adjustment.note,
            relatedInvoiceId: result.adjustment.relatedInvoiceId,
            idempotencyKey: result.adjustment.idempotencyKey,
            created: result.created,
            platformBilling: true,
          },
        },
      );
      return json({ ok: true, result }, { status: result.created ? 201 : 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/platform/billing/refunds') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parsePlatformBillingRefundRequest(await readJson(ctx.request));
      const { orgId, ...refundRequest } = request;
      const result = await billing.createRefund(
        {
          orgId,
          actorUserId: auth.claims.userId,
          platformSupport: true,
        },
        refundRequest,
      );
      await emitConsoleAuditEvent(
        ctx,
        {
          ...auth.claims,
          orgId,
        },
        {
          category: 'BILLING',
          action: 'billing.refund.requested',
          summary: `Requested refund for org ${orgId}`,
          metadata: {
            organizationId: orgId,
            refundId: result.refund.id,
            purchaseId: result.refund.purchaseId,
            amountMinor: result.refund.amountMinor,
            status: result.refund.status,
            created: result.created,
            platformBilling: true,
          },
        },
      );
      return json({ ok: true, result }, { status: result.created ? 201 : 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/platform/billing/refunds/reconcile') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parsePlatformBillingRefundReconcileRequest(await readJson(ctx.request));
      const { orgId, ...reconcileRequest } = request;
      const result = await billing.reconcileRefund(
        {
          orgId,
          actorUserId: auth.claims.userId,
          platformSupport: true,
        },
        reconcileRequest,
      );
      await emitConsoleAuditEvent(
        ctx,
        {
          ...auth.claims,
          orgId,
        },
        {
          category: 'BILLING',
          action: 'billing.refund.reconciled',
          summary: `Reconciled refund for org ${orgId}`,
          metadata: {
            organizationId: orgId,
            refundId: result.refund.id,
            purchaseId: result.refund.purchaseId,
            amountMinor: result.refund.amountMinor,
            status: result.refund.status,
            platformBilling: true,
          },
        },
      );
      return json({ ok: true, result }, { status: 200 });
    }
    if (ctx.method === 'GET' && ctx.pathname === '/console/billing/overview') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const basicOverview = await billing.getOverview(billingCtx);
      const overview = hooks.overview
        ? await hooks.overview(auth.claims, basicOverview)
        : basicOverview;
      return json({ ok: true, overview }, { status: 200 });
    }
    if (ctx.method === 'GET' && ctx.pathname === '/console/billing/refunds') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const refunds = await billing.listRefunds(billingCtx);
      return json({ ok: true, refunds }, { status: 200 });
    }
    if (ctx.method === 'GET' && ctx.pathname === '/console/billing/account/activity') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseBillingAccountActivityRequest(
        Object.fromEntries(ctx.url.searchParams.entries()),
      );
      const activity = await billing.listAccountActivity(billingCtx, request);
      return json({ ok: true, activity }, { status: 200 });
    }
    if (ctx.method === 'POST' && ctx.pathname === '/console/billing/invoices/generate') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseGenerateMonthlyInvoiceRequest(await readJson(ctx.request));
      billingFailureEvent = {
        operation: 'INVOICE_FINALIZATION',
        invoiceId: `monthly:${request.periodMonthUtc}`,
      };
      const generation = await billing.generateMonthlyInvoice(billingCtx, request);
      await emitBillingWebhookEvent(ctx, {
        orgId: auth.claims.orgId,
        actorUserId: auth.claims.userId,
        eventType: 'billing.invoice.generated',
        payload: {
          invoiceId: generation.invoice.id,
          periodMonthUtc: generation.invoice.periodMonthUtc,
          generated: generation.generated,
          monthlyActiveResources: generation.monthlyActiveResources,
          amountDueMinor: generation.invoice.amountDueMinor,
          lineItemCount: generation.lineItems.length,
        },
      });
      const auditEvent = buildConsoleBillingInvoiceGeneratedAuditEvent({ generation });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'BILLING',
        action: 'billing.invoice.generated',
        summary: auditEvent.summary,
        metadata: auditEvent.metadata,
      });
      return json({ ok: true, generation }, { status: 200 });
    }
    if (ctx.method === 'POST' && ctx.pathname === '/console/billing/adjustments/support-credit') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseBillingManualAdjustmentRequest(await readJson(ctx.request));
      const beforeBalanceState = hooks.balanceChanged
        ? await billing.getOverview(billingCtx)
        : null;
      const result = await billing.grantManualSupportCredit(billingCtx, request);
      await observeBalanceChange(hooks, billingCtx, beforeBalanceState, {
        kind: 'manual_support_credit',
        adjustmentId: result.adjustment.id,
        sourceEventId: result.adjustment.idempotencyKey,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'BILLING',
        action: 'billing.adjustment.support_credit',
        summary: `Appended manual support credit for org ${auth.claims.orgId}`,
        metadata: {
          organizationId: auth.claims.orgId,
          adjustmentId: result.adjustment.id,
          amountMinor: result.adjustment.amountMinor,
          resultingBalanceMinor: result.creditBalanceMinor,
          reasonCode: result.adjustment.reasonCode,
          note: result.adjustment.note,
          relatedInvoiceId: result.adjustment.relatedInvoiceId,
          idempotencyKey: result.adjustment.idempotencyKey,
          created: result.created,
        },
      });
      return json({ ok: true, result }, { status: result.created ? 201 : 200 });
    }
    if (ctx.method === 'POST' && ctx.pathname === '/console/billing/adjustments/admin-debit') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseBillingManualAdjustmentRequest(await readJson(ctx.request));
      const beforeBalanceState = hooks.balanceChanged
        ? await billing.getOverview(billingCtx)
        : null;
      const result = await billing.appendManualAdminDebit(billingCtx, request);
      await observeBalanceChange(hooks, billingCtx, beforeBalanceState, {
        kind: 'manual_admin_debit',
        adjustmentId: result.adjustment.id,
        sourceEventId: result.adjustment.idempotencyKey,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'BILLING',
        action: 'billing.adjustment.admin_debit',
        summary: `Appended manual admin debit for org ${auth.claims.orgId}`,
        metadata: {
          organizationId: auth.claims.orgId,
          adjustmentId: result.adjustment.id,
          amountMinor: result.adjustment.amountMinor,
          resultingBalanceMinor: result.creditBalanceMinor,
          reasonCode: result.adjustment.reasonCode,
          note: result.adjustment.note,
          relatedInvoiceId: result.adjustment.relatedInvoiceId,
          idempotencyKey: result.adjustment.idempotencyKey,
          created: result.created,
        },
      });
      return json({ ok: true, result }, { status: result.created ? 201 : 200 });
    }
    if (ctx.method === 'GET' && ctx.pathname === '/console/billing/invoices') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseBillingInvoiceListRequest(
        Object.fromEntries(ctx.url.searchParams.entries()),
      );
      const page = await billing.listInvoicesPage(billingCtx, request);
      return json(
        {
          ok: true,
          invoices: page.invoices,
          nextCursor: page.nextCursor,
          totalCount: page.totalCount,
          summary: page.summary,
        },
        { status: 200 },
      );
    }
    if (ctx.method === 'GET' && invoiceMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const invoiceId = decodePathPart(invoiceMatch[1]);
      const invoice = await billing.getInvoice(billingCtx, invoiceId);
      if (!invoice) {
        return json(
          {
            ok: false,
            code: 'invoice_not_found',
            message: `Invoice ${invoiceId} was not found`,
          },
          { status: 404 },
        );
      }
      return json({ ok: true, invoice }, { status: 200 });
    }
    if (ctx.method === 'GET' && invoicePdfMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const invoiceId = decodePathPart(invoicePdfMatch[1]);
      const invoice = await billing.getInvoice(billingCtx, invoiceId);
      if (!invoice) {
        return json(
          {
            ok: false,
            code: 'invoice_not_found',
            message: `Invoice ${invoiceId} was not found`,
          },
          { status: 404 },
        );
      }
      const lineItems = await billing.listInvoiceLineItems(billingCtx, invoiceId);
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'BILLING',
        action: 'billing.invoice.pdf_export',
        summary: `Exported billing document PDF for ${invoice.id}`,
        metadata: {
          invoiceId: invoice.id,
          invoiceStatus: invoice.status,
          periodMonthUtc: invoice.periodMonthUtc,
          exportPolicy: CONSOLE_BILLING_INVOICE_PDF_EXPORT_POLICY,
        },
      });
      const headers = new Headers({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${buildConsoleBillingInvoicePdfFilename(invoice)}"`,
      });
      const pdfBytes = buildConsoleBillingInvoicePdf({
        orgId: auth.claims.orgId,
        invoice,
        lineItems,
      });
      return new Response(toArrayBufferCopy(pdfBytes), {
        status: 200,
        headers,
      });
    }
    if (ctx.method === 'GET' && invoiceActivityMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const invoiceId = decodePathPart(invoiceActivityMatch[1]);
      const activity = await billing.getInvoiceActivity(billingCtx, invoiceId);
      if (!activity) {
        return json(
          {
            ok: false,
            code: 'invoice_not_found',
            message: `Invoice ${invoiceId} was not found`,
          },
          { status: 404 },
        );
      }
      return json({ ok: true, activity }, { status: 200 });
    }
    if (ctx.method === 'GET' && invoiceLineItemsMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const invoiceId = decodePathPart(invoiceLineItemsMatch[1]);
      const invoice = await billing.getInvoice(billingCtx, invoiceId);
      if (!invoice) {
        return json(
          {
            ok: false,
            code: 'invoice_not_found',
            message: `Invoice ${invoiceId} was not found`,
          },
          { status: 404 },
        );
      }
      const lineItems = await billing.listInvoiceLineItems(billingCtx, invoiceId);
      return json({ ok: true, lineItems }, { status: 200 });
    }
    if (ctx.method === 'POST' && ctx.pathname === '/console/billing/stripe/checkout-session') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseStripeCheckoutSessionRequest(await readJson(ctx.request));
      const checkoutSession = await billing.createStripeCheckoutSession(billingCtx, request);
      return json({ ok: true, checkoutSession }, { status: 201 });
    }
    if (
      ctx.method === 'POST' &&
      ctx.pathname === '/console/billing/stripe/checkout-session/reconcile'
    ) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseStripeCheckoutSessionReconcileRequest(await readJson(ctx.request));
      billingFailureEvent = {
        operation: 'PAYMENT_RECONCILE',
        providerRef: request.checkoutSessionId,
      };
      const beforeBalanceState = hooks.balanceChanged
        ? await billing.getOverview(billingCtx)
        : null;
      const result = await billing.reconcileStripeCheckoutSession(billingCtx, request);
      if (result.settledNow) {
        await observeBalanceChange(hooks, billingCtx, beforeBalanceState, {
          kind: 'credit_purchase_settled',
          purchaseId: result.purchase?.id || null,
          sourceEventId: request.checkoutSessionId,
        });
      }
      if (result.settledNow && result.purchase && result.orgId) {
        await emitBillingWebhookEvent(ctx, {
          orgId: result.orgId,
          actorUserId: 'system-stripe-checkout-reconcile',
          eventType: 'billing.credit_purchase.settled',
          eventId: `stripe_checkout_reconcile:${request.checkoutSessionId}`,
          payload: {
            purchaseId: result.purchase.id,
            creditPackId: result.purchase.creditPackId,
            amountMinor: result.purchase.amountMinor,
            receiptId: result.invoice?.id || null,
            source: 'stripe_checkout_reconcile',
          },
        });
        const auditEvent = buildConsoleBillingCreditPurchaseSettledAuditEvent({
          purchase: result.purchase,
          invoice: result.invoice,
          source: 'stripe_checkout_reconcile',
          settlementEventId: `stripe_checkout_reconcile:${request.checkoutSessionId}`,
        });
        await emitConsoleAuditEvent(ctx, auth.claims, {
          category: 'BILLING',
          action: 'billing.credit_purchase.settled',
          summary: auditEvent.summary,
          metadata: auditEvent.metadata,
        });
      }
      return json({ ok: true, result }, { status: 200 });
    }
  } catch (error: unknown) {
    if (billingFailureEvent && hooks.failure)
      await hooks.failure(auth.claims, { ...billingFailureEvent, error });
    if (isConsoleOrgProjectError(error)) {
      return json(
        { ok: false, code: error.code, message: error.message },
        { status: error.status },
      );
    }
    return sendBillingError(error);
  }
  return new Response('Not Found', { status: 404 });
}
