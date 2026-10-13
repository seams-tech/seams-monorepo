import { PlatformScopeV1 } from '@seams-internal/console-shared/accountPlatform';
import {
  contractResult,
  exactKeys,
  integer,
  invalidContract,
  object,
  textValue,
  utcTimestamp,
  type PlatformContractError,
  type PlatformResult,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import {
  buildConsoleAcceptHeaders,
  buildConsoleJsonHeaders,
  consoleErrorMessage,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '../../consoleHttp';

export interface DashboardBillingOverview {
  usageMetricVersion: string;
  currentMonthUtc: string;
  monthlyActiveResources: number;
  creditBalanceMinor: number;
  lowBalanceThresholdMinor: number;
  reservedMinor: number;
  activeReservationCount: number;
  pendingRefundMinor: number;
  availableBalanceMinor: number;
  trailing30DaySponsoredSpendMinor: number;
  trailing30DaySponsoredExecutionCount: number;
  trailing90DaySponsoredSpendMinor: number;
  trailing90DaySponsoredExecutionCount: number;
  recentUsageDebitMinor: number;
  recentCreditPurchasedMinor: number;
  documentCount: number;
}

interface DashboardBillingUsageChargeBase {
  readonly ledgerEntryId: string;
  readonly amountMinor: number;
  readonly occurredAt: string;
}

interface DashboardBillingInstanceAttribution {
  readonly kind: 'instance';
  readonly scope: PlatformScopeV1;
  readonly instanceId: string;
}

export type DashboardBillingUsageCharge = DashboardBillingUsageChargeBase &
  (
    | {
        readonly kind: 'instance';
        readonly attribution: DashboardBillingInstanceAttribution & {
          readonly serviceId: 'wallet';
        };
        readonly meterId: 'wallet.monthly_active_resource';
        readonly priceVersion: string;
        readonly quantity: number;
        readonly unit: 'resource_month';
      }
    | {
        readonly kind: 'instance';
        readonly attribution: DashboardBillingInstanceAttribution & {
          readonly serviceId: 'wallet';
        };
        readonly meterId: 'wallet.execution';
        readonly priceVersion: string;
        readonly quantity: number;
        readonly unit: 'execution';
      }
    | {
        readonly kind: 'instance';
        readonly attribution: DashboardBillingInstanceAttribution & { readonly serviceId: 'satyr' };
        readonly meterId: 'satyr.completed_turn.test';
        readonly priceVersion: string;
        readonly quantity: number;
        readonly unit: 'turn';
      }
    | {
        readonly kind: 'historical_organization';
        readonly attribution: {
          readonly kind: 'historical_organization';
          readonly namespace: string;
          readonly organizationId: string;
          readonly billingAccountId: string;
          readonly scope?: never;
          readonly serviceId?: never;
          readonly instanceId?: never;
        };
        readonly meterId?: never;
        readonly priceVersion?: never;
        readonly quantity?: never;
        readonly unit?: never;
      }
  );

export interface DashboardBillingUsageCharges {
  readonly organizationId: string;
  readonly periodMonthUtc: string;
  readonly charges: readonly DashboardBillingUsageCharge[];
}

export type DashboardBillingCostsState =
  | {
      readonly kind: 'unavailable';
      readonly organizationId?: never;
      readonly data?: never;
      readonly message?: never;
    }
  | {
      readonly kind: 'loading';
      readonly organizationId: string;
      readonly data?: never;
      readonly message?: never;
    }
  | {
      readonly kind: 'ready';
      readonly organizationId: string;
      readonly data: DashboardBillingUsageCharges;
      readonly message?: never;
    }
  | {
      readonly kind: 'failed';
      readonly organizationId: string;
      readonly data?: never;
      readonly message: string;
    };

export interface DashboardBillingInvoice {
  id: string;
  documentType: 'PURCHASE_RECEIPT' | 'USAGE_STATEMENT';
  status: string;
  amountDueMinor: number;
  amountPaidMinor: number;
  periodMonthUtc: string;
  dueAt: string | null;
  createdAt: string;
}

export interface DashboardBillingInvoiceListRequest {
  status?: 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE' | 'OVERDUE';
  overdue?: boolean;
  periodMonthUtc?: string;
  documentType?: 'PURCHASE_RECEIPT' | 'USAGE_STATEMENT';
  limit?: number;
  cursor?: string;
}

export interface DashboardBillingInvoiceListSummary {
  totalCount: number;
  openCount: number;
  overdueCount: number;
  paidCount: number;
  outstandingAmountMinor: number;
  latestPeriodMonthUtc: string | null;
  receiptCount: number;
  statementCount: number;
}

export interface DashboardBillingInvoicePage {
  invoices: DashboardBillingInvoice[];
  nextCursor: string | null;
  totalCount: number;
  summary: DashboardBillingInvoiceListSummary;
}

export interface DashboardBillingInvoiceLineItem {
  id: string;
  invoiceId: string;
  itemType: string;
  description: string;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
  periodMonthUtc: string;
}

export interface DashboardBillingInvoiceActivityEntry {
  id: string;
  type: 'DOCUMENT' | 'LEDGER';
  invoiceId: string;
  fromState: string | null;
  toState: string;
  occurredAt: string;
  actorType: 'USER' | 'SYSTEM' | 'PROVIDER';
  actorUserId: string | null;
  reason: string | null;
  sourceEventId: string | null;
  summary: string;
  visibility: 'CUSTOMER' | 'INTERNAL';
}

export interface DashboardBillingInvoiceActivity {
  invoice: DashboardBillingInvoice;
  entries: DashboardBillingInvoiceActivityEntry[];
}

export interface DashboardBillingAccountActivityEntry {
  id: string;
  orgId: string;
  type: DashboardBillingAccountActivityEventType;
  amountMinor: number;
  currency: 'USD';
  description: string;
  monthUtc: string | null;
  relatedInvoiceId: string | null;
  relatedPurchaseId: string | null;
  sourceEventId: string | null;
  actorType: 'USER' | 'SYSTEM' | 'PROVIDER';
  actorUserId: string | null;
  reasonCode: string | null;
  note: string | null;
  idempotencyKey: string | null;
  createdAt: string;
}

export type DashboardBillingAccountActivityEventType =
  | 'CREDIT_PURCHASE'
  | 'USAGE_DEBIT'
  | 'PRODUCT_EXECUTION_DEBIT'
  | 'MANUAL_ADJUSTMENT'
  | 'REFUND'
  | 'DISPUTE_OPENED'
  | 'DISPUTE_WON';

interface DashboardBillingCreditPurchaseBase {
  id: string;
  orgId: string;
  creditPackId: DashboardBillingCreditPackId;
  amountMinor: number;
  currency: 'USD';
  provider: 'stripe';
  createdAt: string;
  updatedAt: string;
}

export type DashboardBillingCreditPurchase =
  | (DashboardBillingCreditPurchaseBase & {
      status: 'PENDING' | 'CANCELED';
      providerCheckoutSessionRef: string | null;
      providerCustomerRef: string | null;
      providerPaymentRef: null;
      relatedInvoiceId: null;
      settledAt: null;
    })
  | (DashboardBillingCreditPurchaseBase & {
      status: 'SETTLED';
      providerCheckoutSessionRef: string;
      providerCustomerRef: string;
      providerPaymentRef: string;
      relatedInvoiceId: string;
      settledAt: string;
    });

export type DashboardBillingManualAdjustmentKind = 'support_credit' | 'admin_debit';

export interface DashboardBillingManualAdjustmentRequest {
  amountMinor: number;
  reasonCode: string;
  note: string;
  idempotencyKey: string;
  relatedInvoiceId?: string;
}

export interface DashboardPlatformBillingManualAdjustmentRequest extends DashboardBillingManualAdjustmentRequest {
  orgId: string;
}

export interface DashboardBillingManualAdjustmentResult {
  created: boolean;
  adjustment: DashboardBillingAccountActivityEntry;
  creditBalanceMinor: number;
}

export type DashboardBillingCreditPackId = 'usd_10' | 'usd_25' | 'usd_50';

export interface DashboardStripeCheckoutSessionRequest {
  creditPackId: DashboardBillingCreditPackId;
}

export interface DashboardStripeCheckoutSession {
  id: string;
  purchaseId: string;
  url: string;
  customerRef: string;
  creditPackId: DashboardBillingCreditPackId;
  amountMinor: number;
  expiresAt: string;
}

interface DashboardBillingRefundBase {
  id: string;
  orgId: string;
  purchaseId: string;
  amountMinor: number;
  currency: 'USD';
  reason: string;
  origin: 'console' | 'provider';
  requesterUserId: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export type DashboardBillingRefund =
  | (DashboardBillingRefundBase & {
      status: 'requested';
      providerRefundId: null;
      failureCode: null;
      journalEntryId: null;
    })
  | (DashboardBillingRefundBase & {
      status: 'provider_pending' | 'canceled';
      providerRefundId: string;
      failureCode: null;
      journalEntryId: null;
    })
  | (DashboardBillingRefundBase & {
      status: 'succeeded';
      providerRefundId: string;
      failureCode: null;
      journalEntryId: string;
    })
  | (DashboardBillingRefundBase & {
      status: 'failed';
      providerRefundId: string | null;
      failureCode: string;
      journalEntryId: null;
    });

export interface DashboardBillingRefundRequest {
  purchaseId: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
}

export interface DashboardPlatformBillingRefundRequest extends DashboardBillingRefundRequest {
  orgId: string;
}

export interface DashboardBillingRefundResult {
  created: boolean;
  refund: DashboardBillingRefund;
  creditBalanceMinor: number;
}

export interface DashboardStripeCheckoutSessionReconcileRequest {
  checkoutSessionId: string;
}

export interface DashboardStripeCheckoutSessionReconcileResult {
  settled: boolean;
  settledNow: boolean;
  paymentStatus: string | null;
  checkoutStatus: string | null;
  purchase: DashboardBillingCreditPurchase | null;
  invoice: DashboardBillingInvoice | null;
}

export interface DashboardPlatformBillingOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface DashboardPlatformBillingProject {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: string;
  environmentCount: number;
}

export interface DashboardPlatformBillingLookupRequest {
  orgId?: string;
  projectId?: string;
  limit?: number;
  periodMonthUtc?: string;
  eventType?: DashboardBillingAccountActivityEventType;
}

export interface DashboardPlatformBillingSearchRequest {
  query: string;
  limit?: number;
}

export interface DashboardPlatformBillingLookupResult {
  resolvedBy: 'org_id' | 'project_id';
  organization: DashboardPlatformBillingOrganization;
  project: DashboardPlatformBillingProject | null;
  overview: DashboardBillingOverview;
  activity: DashboardBillingAccountActivityEntry[];
  refunds: DashboardBillingRefund[];
}

interface ConsoleOverviewResponse {
  ok?: boolean;
  message?: string;
  overview?: unknown;
}

interface ConsoleInvoicesResponse {
  ok?: boolean;
  message?: string;
  invoices?: unknown;
  nextCursor?: unknown;
  totalCount?: unknown;
  summary?: unknown;
}

interface ConsoleInvoiceResponse {
  ok?: boolean;
  message?: string;
  invoice?: unknown;
}

interface ConsoleInvoiceLineItemsResponse {
  ok?: boolean;
  message?: string;
  lineItems?: unknown;
}

interface ConsoleInvoiceActivityResponse {
  ok?: boolean;
  message?: string;
  activity?: unknown;
}

interface ConsoleAccountActivityResponse {
  ok?: boolean;
  message?: string;
  activity?: unknown;
}

interface ConsoleBillingRefundsResponse {
  ok?: boolean;
  message?: string;
  refunds?: unknown;
}

interface ConsoleBillingRefundResultResponse {
  ok?: boolean;
  message?: string;
  result?: unknown;
}

interface ConsoleBillingManualAdjustmentResponse {
  ok?: boolean;
  message?: string;
  result?: unknown;
}

interface ConsoleStripeCheckoutSessionResponse {
  ok?: boolean;
  message?: string;
  checkoutSession?: unknown;
}

interface ConsoleStripeCheckoutSessionReconcileResponse {
  ok?: boolean;
  message?: string;
  result?: unknown;
}

interface ConsolePlatformBillingLookupResponse {
  ok?: boolean;
  message?: string;
  result?: unknown;
}

interface ConsolePlatformBillingSearchResponse {
  ok?: boolean;
  message?: string;
  organizations?: unknown;
}

interface ConsoleBillingErrorBody {
  ok?: boolean;
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

const BILLING_CREDIT_PACK_IDS: readonly DashboardBillingCreditPackId[] = [
  'usd_10',
  'usd_25',
  'usd_50',
];

export class DashboardBillingApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(input: { status: number; code?: unknown; message: string; details?: unknown }) {
    super(input.message);
    this.name = 'DashboardBillingApiError';
    this.status = input.status;
    this.code = String(input.code || '').trim();
    this.details = input.details;
  }
}

function buildBillingApiError(
  response: Response,
  body: ConsoleBillingErrorBody | null | undefined,
  fallbackPrefix: string,
): DashboardBillingApiError {
  return new DashboardBillingApiError({
    status: response.status,
    code: body?.code,
    message: consoleErrorMessage(response, body, fallbackPrefix),
    details: body?.details,
  });
}

export function isDashboardBillingApiErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof DashboardBillingApiError)) return false;
  return error.code === code;
}

function decodeOverview(raw: unknown): DashboardBillingOverview | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const currentMonthUtc = String(row.currentMonthUtc || '').trim();
  if (!currentMonthUtc) return null;
  const creditBalanceMinor = decodeBillingInteger(row.creditBalanceMinor);
  const lowBalanceThresholdMinor = decodeBillingInteger(row.lowBalanceThresholdMinor);
  const reservedMinor = decodeBillingInteger(row.reservedMinor);
  const activeReservationCount = decodeBillingInteger(row.activeReservationCount);
  const pendingRefundMinor = decodeBillingInteger(row.pendingRefundMinor);
  const availableBalanceMinor = decodeBillingInteger(row.availableBalanceMinor);
  if (
    creditBalanceMinor === null ||
    lowBalanceThresholdMinor === null ||
    lowBalanceThresholdMinor < 0 ||
    reservedMinor === null ||
    reservedMinor < 0 ||
    activeReservationCount === null ||
    activeReservationCount < 0 ||
    pendingRefundMinor === null ||
    pendingRefundMinor < 0 ||
    availableBalanceMinor === null ||
    availableBalanceMinor !== creditBalanceMinor - reservedMinor - pendingRefundMinor
  )
    return null;
  return {
    usageMetricVersion: String(row.usageMetricVersion || '').trim() || 'active_resource_v1',
    currentMonthUtc,
    monthlyActiveResources: Number(row.monthlyActiveResources || 0),
    creditBalanceMinor,
    lowBalanceThresholdMinor,
    reservedMinor,
    activeReservationCount,
    pendingRefundMinor,
    availableBalanceMinor,
    trailing30DaySponsoredSpendMinor: Number(row.trailing30DaySponsoredSpendMinor || 0),
    trailing30DaySponsoredExecutionCount: Number(row.trailing30DaySponsoredExecutionCount || 0),
    trailing90DaySponsoredSpendMinor: Number(row.trailing90DaySponsoredSpendMinor || 0),
    trailing90DaySponsoredExecutionCount: Number(row.trailing90DaySponsoredExecutionCount || 0),
    recentUsageDebitMinor: Number(row.recentUsageDebitMinor || 0),
    recentCreditPurchasedMinor: Number(row.recentCreditPurchasedMinor || 0),
    documentCount: Number(row.documentCount || 0),
  };
}

function decodeBillingInteger(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) return null;
  return raw;
}

function readUsageCharge(input: unknown): DashboardBillingUsageCharge {
  const row = object(input, 'charge');
  const ledgerEntryId = textValue(row.ledgerEntryId, 'ledgerEntryId');
  const amountMinor = integer(row.amountMinor, 'amountMinor', 1);
  const occurredAt = utcTimestamp(row.occurredAt, 'occurredAt');
  const attribution = object(row.attribution, 'attribution');
  if (row.kind === 'historical_organization') {
    exactKeys(row, ['kind', 'ledgerEntryId', 'amountMinor', 'occurredAt', 'attribution']);
    exactKeys(attribution, ['kind', 'namespace', 'organizationId', 'billingAccountId']);
    if (attribution.kind !== row.kind) return invalidContract('attribution.kind');
    return {
      kind: 'historical_organization',
      ledgerEntryId,
      amountMinor,
      occurredAt,
      attribution: {
        kind: 'historical_organization',
        namespace: textValue(attribution.namespace, 'namespace'),
        organizationId: textValue(attribution.organizationId, 'organizationId'),
        billingAccountId: textValue(attribution.billingAccountId, 'billingAccountId'),
      },
    };
  }
  if (row.kind !== 'instance') return invalidContract('charge.kind');
  exactKeys(row, [
    'kind',
    'ledgerEntryId',
    'amountMinor',
    'occurredAt',
    'attribution',
    'meterId',
    'priceVersion',
    'quantity',
    'unit',
  ]);
  exactKeys(attribution, ['kind', 'scope', 'serviceId', 'instanceId']);
  if (attribution.kind !== 'instance') return invalidContract('attribution.kind');
  const parsedScope = PlatformScopeV1.parse(attribution.scope);
  if (parsedScope.kind === 'rejected') return invalidContract('attribution.scope');
  const scope = parsedScope.value;
  const instanceId = textValue(attribution.instanceId, 'instanceId');
  const priceVersion = textValue(row.priceVersion, 'priceVersion');
  const quantity = integer(row.quantity, 'quantity', 1);
  switch (row.meterId) {
    case 'wallet.monthly_active_resource':
      if (attribution.serviceId !== 'wallet' || row.unit !== 'resource_month')
        return invalidContract('meter');
      return {
        kind: 'instance',
        ledgerEntryId,
        amountMinor,
        occurredAt,
        attribution: { kind: 'instance', scope, serviceId: 'wallet', instanceId },
        meterId: row.meterId,
        priceVersion,
        quantity,
        unit: row.unit,
      };
    case 'wallet.execution':
      if (attribution.serviceId !== 'wallet' || row.unit !== 'execution')
        return invalidContract('meter');
      return {
        kind: 'instance',
        ledgerEntryId,
        amountMinor,
        occurredAt,
        attribution: { kind: 'instance', scope, serviceId: 'wallet', instanceId },
        meterId: row.meterId,
        priceVersion,
        quantity,
        unit: row.unit,
      };
    case 'satyr.completed_turn.test':
      if (attribution.serviceId !== 'satyr' || row.unit !== 'turn') return invalidContract('meter');
      return {
        kind: 'instance',
        ledgerEntryId,
        amountMinor,
        occurredAt,
        attribution: { kind: 'instance', scope, serviceId: 'satyr', instanceId },
        meterId: row.meterId,
        priceVersion,
        quantity,
        unit: row.unit,
      };
    default:
      return invalidContract('meterId');
  }
}

function readUsageCharges(input: unknown): DashboardBillingUsageCharges {
  const expected = object(input, 'request');
  const response = object(expected.response, 'response');
  exactKeys(response, ['ok', 'organizationId', 'periodMonthUtc', 'charges']);
  const organizationId = textValue(response.organizationId, 'organizationId');
  const periodMonthUtc = textValue(response.periodMonthUtc, 'periodMonthUtc');
  if (
    response.ok !== true ||
    organizationId !== expected.organizationId ||
    periodMonthUtc !== expected.periodMonthUtc ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonthUtc) ||
    !Array.isArray(response.charges)
  )
    return invalidContract('response');
  const charges: DashboardBillingUsageCharge[] = [];
  const ledgerIds = new Set<string>();
  let totalMinor = 0;
  for (const raw of response.charges) {
    const charge = readUsageCharge(raw);
    const attributedOrganizationId =
      charge.kind === 'instance'
        ? charge.attribution.scope.organizationId
        : charge.attribution.organizationId;
    if (attributedOrganizationId !== organizationId || ledgerIds.has(charge.ledgerEntryId)) {
      return invalidContract('charge.attribution');
    }
    totalMinor += charge.amountMinor;
    if (!Number.isSafeInteger(totalMinor)) return invalidContract('charges.amountMinor');
    ledgerIds.add(charge.ledgerEntryId);
    charges.push(charge);
  }
  return { organizationId, periodMonthUtc, charges };
}

export function parseDashboardBillingUsageCharges(
  response: unknown,
  organizationId: string,
  periodMonthUtc: string,
): PlatformResult<DashboardBillingUsageCharges, PlatformContractError> {
  return contractResult(readUsageCharges, { response, organizationId, periodMonthUtc });
}

function decodeInvoice(raw: unknown): DashboardBillingInvoice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  if (!id) return null;
  const documentTypeRaw = String(row.documentType || '')
    .trim()
    .toUpperCase();
  return {
    id,
    documentType: documentTypeRaw === 'PURCHASE_RECEIPT' ? 'PURCHASE_RECEIPT' : 'USAGE_STATEMENT',
    status: String(row.status || '').trim() || 'OPEN',
    amountDueMinor: Number(row.amountDueMinor || 0),
    amountPaidMinor: Number(row.amountPaidMinor || 0),
    periodMonthUtc: String(row.periodMonthUtc || '').trim(),
    dueAt: row.dueAt == null ? null : String(row.dueAt || '').trim() || null,
    createdAt: String(row.createdAt || '').trim(),
  };
}

function decodeInvoiceListSummary(raw: unknown): DashboardBillingInvoiceListSummary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      totalCount: 0,
      openCount: 0,
      overdueCount: 0,
      paidCount: 0,
      outstandingAmountMinor: 0,
      latestPeriodMonthUtc: null,
      receiptCount: 0,
      statementCount: 0,
    };
  }
  const row = raw as Record<string, unknown>;
  return {
    totalCount: Number(row.totalCount || 0),
    openCount: Number(row.openCount || 0),
    overdueCount: Number(row.overdueCount || 0),
    paidCount: Number(row.paidCount || 0),
    outstandingAmountMinor: Number(row.outstandingAmountMinor || 0),
    latestPeriodMonthUtc:
      row.latestPeriodMonthUtc == null
        ? null
        : String(row.latestPeriodMonthUtc || '').trim() || null,
    receiptCount: Number(row.receiptCount || 0),
    statementCount: Number(row.statementCount || 0),
  };
}

function decodeInvoiceLineItem(raw: unknown): DashboardBillingInvoiceLineItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const invoiceId = String(row.invoiceId || '').trim();
  if (!id || !invoiceId) return null;
  return {
    id,
    invoiceId,
    itemType: String(row.itemType || '').trim(),
    description: String(row.description || '').trim(),
    quantity: Number(row.quantity || 0),
    unitAmountMinor: Number(row.unitAmountMinor || 0),
    amountMinor: Number(row.amountMinor || 0),
    periodMonthUtc: String(row.periodMonthUtc || '').trim(),
  };
}

function decodeBillingCreditPackId(raw: unknown): DashboardBillingCreditPackId | null {
  const value = String(raw || '').trim();
  return BILLING_CREDIT_PACK_IDS.find((candidate) => candidate === value) || null;
}

function decodeNullableString(raw: unknown): string | null {
  if (raw == null) return null;
  return String(raw || '').trim() || null;
}

function decodeStripeCheckoutSession(raw: unknown): DashboardStripeCheckoutSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const purchaseId = String(row.purchaseId || '').trim();
  const url = String(row.url || '').trim();
  const customerRef = String(row.customerRef || '').trim();
  const expiresAt = String(row.expiresAt || '').trim();
  const creditPackId = decodeBillingCreditPackId(row.creditPackId);
  if (!id || !purchaseId || !url || !customerRef || !expiresAt || !creditPackId) return null;
  return {
    id,
    purchaseId,
    url,
    customerRef,
    creditPackId,
    amountMinor: Number(row.amountMinor || 0),
    expiresAt,
  };
}

function decodeCreditPurchase(raw: unknown): DashboardBillingCreditPurchase | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const orgId = String(row.orgId || '').trim();
  const creditPackId = decodeBillingCreditPackId(row.creditPackId);
  if (!id || !orgId || !creditPackId || row.provider !== 'stripe') return null;
  const status = String(row.status || '')
    .trim()
    .toUpperCase();
  const base: DashboardBillingCreditPurchaseBase = {
    id,
    orgId,
    creditPackId,
    amountMinor: Number(row.amountMinor || 0),
    currency: 'USD',
    provider: 'stripe',
    createdAt: String(row.createdAt || '').trim(),
    updatedAt: String(row.updatedAt || '').trim(),
  };
  if (status === 'SETTLED') {
    const providerCheckoutSessionRef = decodeNullableString(row.providerCheckoutSessionRef);
    const providerCustomerRef = decodeNullableString(row.providerCustomerRef);
    const providerPaymentRef = decodeNullableString(row.providerPaymentRef);
    const relatedInvoiceId = decodeNullableString(row.relatedInvoiceId);
    const settledAt = decodeNullableString(row.settledAt);
    if (
      !providerCheckoutSessionRef ||
      !providerCustomerRef ||
      !providerPaymentRef ||
      !relatedInvoiceId ||
      !settledAt
    ) {
      return null;
    }
    return {
      ...base,
      status: 'SETTLED',
      providerCheckoutSessionRef,
      providerCustomerRef,
      providerPaymentRef,
      relatedInvoiceId,
      settledAt,
    };
  }
  if (status !== 'PENDING' && status !== 'CANCELED') return null;
  return {
    ...base,
    status,
    providerCheckoutSessionRef: decodeNullableString(row.providerCheckoutSessionRef),
    providerCustomerRef: decodeNullableString(row.providerCustomerRef),
    providerPaymentRef: null,
    relatedInvoiceId: null,
    settledAt: null,
  };
}

function decodeBillingRefund(raw: unknown): DashboardBillingRefund | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const orgId = String(row.orgId || '').trim();
  const purchaseId = String(row.purchaseId || '').trim();
  const reason = String(row.reason || '').trim();
  const requesterUserId = String(row.requesterUserId || '').trim();
  const idempotencyKey = String(row.idempotencyKey || '').trim();
  const createdAt = String(row.createdAt || '').trim();
  const updatedAt = String(row.updatedAt || '').trim();
  const origin =
    row.origin === 'provider' ? 'provider' : row.origin === 'console' ? 'console' : null;
  if (
    !id ||
    !orgId ||
    !purchaseId ||
    !reason ||
    !requesterUserId ||
    !idempotencyKey ||
    !createdAt ||
    !updatedAt ||
    !origin
  ) {
    return null;
  }
  const base: DashboardBillingRefundBase = {
    id,
    orgId,
    purchaseId,
    amountMinor: Number(row.amountMinor || 0),
    currency: 'USD',
    reason,
    origin,
    requesterUserId,
    idempotencyKey,
    createdAt,
    updatedAt,
  };
  const status = String(row.status || '').trim();
  const providerRefundId = decodeNullableString(row.providerRefundId);
  switch (status) {
    case 'requested':
      return {
        ...base,
        status,
        providerRefundId: null,
        failureCode: null,
        journalEntryId: null,
      };
    case 'provider_pending':
    case 'canceled':
      if (!providerRefundId) return null;
      return {
        ...base,
        status,
        providerRefundId,
        failureCode: null,
        journalEntryId: null,
      };
    case 'succeeded': {
      const journalEntryId = decodeNullableString(row.journalEntryId);
      if (!providerRefundId || !journalEntryId) return null;
      return {
        ...base,
        status,
        providerRefundId,
        failureCode: null,
        journalEntryId,
      };
    }
    case 'failed': {
      const failureCode = decodeNullableString(row.failureCode);
      if (!failureCode) return null;
      return {
        ...base,
        status,
        providerRefundId,
        failureCode,
        journalEntryId: null,
      };
    }
    default:
      return null;
  }
}

function decodeBillingRefundResult(raw: unknown): DashboardBillingRefundResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const refund = decodeBillingRefund(row.refund);
  if (!refund) return null;
  return {
    created: row.created === true,
    refund,
    creditBalanceMinor: Number(row.creditBalanceMinor || 0),
  };
}

function decodeStripeCheckoutSessionReconcileResult(
  raw: unknown,
): DashboardStripeCheckoutSessionReconcileResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  return {
    settled: Boolean(row.settled),
    settledNow: Boolean(row.settledNow),
    paymentStatus:
      row.paymentStatus == null ? null : String(row.paymentStatus || '').trim() || null,
    checkoutStatus:
      row.checkoutStatus == null ? null : String(row.checkoutStatus || '').trim() || null,
    purchase: decodeCreditPurchase(row.purchase),
    invoice: decodeInvoice(row.invoice),
  };
}

function decodeInvoiceActivityEntry(raw: unknown): DashboardBillingInvoiceActivityEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const invoiceId = String(row.invoiceId || '').trim();
  const toState = String(row.toState || '').trim();
  if (!id || !invoiceId || !toState) return null;
  const type = String(row.type || '')
    .trim()
    .toUpperCase();
  const actorType = String(row.actorType || '')
    .trim()
    .toUpperCase();
  return {
    id,
    type: type === 'LEDGER' ? 'LEDGER' : 'DOCUMENT',
    invoiceId,
    fromState: row.fromState == null ? null : String(row.fromState || '').trim() || null,
    toState,
    occurredAt: String(row.occurredAt || '').trim(),
    actorType: actorType === 'USER' || actorType === 'PROVIDER' ? actorType : 'SYSTEM',
    actorUserId: row.actorUserId == null ? null : String(row.actorUserId || '').trim() || null,
    reason: row.reason == null ? null : String(row.reason || '').trim() || null,
    sourceEventId:
      row.sourceEventId == null ? null : String(row.sourceEventId || '').trim() || null,
    summary: String(row.summary || '').trim() || toState,
    visibility:
      String(row.visibility || '')
        .trim()
        .toUpperCase() === 'INTERNAL'
        ? 'INTERNAL'
        : 'CUSTOMER',
  };
}

function decodeInvoiceActivity(raw: unknown): DashboardBillingInvoiceActivity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const invoice = decodeInvoice(row.invoice);
  if (!invoice) return null;
  const entriesRaw = Array.isArray(row.entries) ? row.entries : [];
  return {
    invoice,
    entries: entriesRaw
      .map((entry) => decodeInvoiceActivityEntry(entry))
      .filter((entry): entry is DashboardBillingInvoiceActivityEntry => entry !== null),
  };
}

export function parseDashboardBillingAccountActivityEntry(
  raw: unknown,
): DashboardBillingAccountActivityEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const orgId = String(row.orgId || '').trim();
  if (!id || !orgId) return null;
  const actorType = String(row.actorType || '')
    .trim()
    .toUpperCase();
  const eventType = String(row.type || '')
    .trim()
    .toUpperCase();
  return {
    id,
    orgId,
    type:
      eventType === 'CREDIT_PURCHASE' ||
      eventType === 'USAGE_DEBIT' ||
      eventType === 'PRODUCT_EXECUTION_DEBIT' ||
      eventType === 'REFUND' ||
      eventType === 'DISPUTE_OPENED' ||
      eventType === 'DISPUTE_WON'
        ? eventType
        : 'MANUAL_ADJUSTMENT',
    amountMinor: Number(row.amountMinor || 0),
    currency: 'USD',
    description: String(row.description || '').trim(),
    monthUtc: row.monthUtc == null ? null : String(row.monthUtc || '').trim() || null,
    relatedInvoiceId:
      row.relatedInvoiceId == null ? null : String(row.relatedInvoiceId || '').trim() || null,
    relatedPurchaseId:
      row.relatedPurchaseId == null ? null : String(row.relatedPurchaseId || '').trim() || null,
    sourceEventId:
      row.sourceEventId == null ? null : String(row.sourceEventId || '').trim() || null,
    actorType: actorType === 'USER' || actorType === 'PROVIDER' ? actorType : 'SYSTEM',
    actorUserId: row.actorUserId == null ? null : String(row.actorUserId || '').trim() || null,
    reasonCode: row.reasonCode == null ? null : String(row.reasonCode || '').trim() || null,
    note: row.note == null ? null : String(row.note || '').trim() || null,
    idempotencyKey:
      row.idempotencyKey == null ? null : String(row.idempotencyKey || '').trim() || null,
    createdAt: String(row.createdAt || '').trim(),
  };
}

function decodePlatformBillingOrganization(
  raw: unknown,
): DashboardPlatformBillingOrganization | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  if (!id) return null;
  return {
    id,
    name: String(row.name || '').trim() || id,
    slug: String(row.slug || '').trim(),
    status: String(row.status || '').trim() || 'ACTIVE',
  };
}

function decodePlatformBillingProject(raw: unknown): DashboardPlatformBillingProject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  if (!id) return null;
  return {
    id,
    orgId: String(row.orgId || '').trim(),
    name: String(row.name || '').trim() || id,
    slug: String(row.slug || '').trim(),
    status: String(row.status || '').trim() || 'ACTIVE',
    environmentCount: Number(row.environmentCount || 0),
  };
}

function decodeAccountActivity(
  raw: unknown,
): { entries: DashboardBillingAccountActivityEntry[] } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const entriesRaw = Array.isArray(row.entries) ? row.entries : [];
  return {
    entries: entriesRaw
      .map((entry) => parseDashboardBillingAccountActivityEntry(entry))
      .filter((entry): entry is DashboardBillingAccountActivityEntry => entry !== null),
  };
}

function decodeBillingManualAdjustmentResult(
  raw: unknown,
): DashboardBillingManualAdjustmentResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const adjustment = parseDashboardBillingAccountActivityEntry(row.adjustment);
  if (!adjustment) return null;
  return {
    created: row.created === true,
    adjustment,
    creditBalanceMinor: Number(row.creditBalanceMinor || 0),
  };
}

function decodePlatformBillingLookupResult(
  raw: unknown,
): DashboardPlatformBillingLookupResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const organization = decodePlatformBillingOrganization(row.organization);
  const overview = decodeOverview(row.overview);
  const activity = decodeAccountActivity(row.activity);
  const refundsRaw = Array.isArray(row.refunds) ? row.refunds : null;
  if (!organization || !overview || !activity || !refundsRaw) return null;
  const resolvedByRaw = String(row.resolvedBy || '')
    .trim()
    .toLowerCase();
  return {
    resolvedBy: resolvedByRaw === 'project_id' ? 'project_id' : 'org_id',
    organization,
    project: row.project == null ? null : decodePlatformBillingProject(row.project),
    overview,
    activity: activity.entries,
    refunds: refundsRaw
      .map((entry) => decodeBillingRefund(entry))
      .filter((entry): entry is DashboardBillingRefund => entry !== null),
  };
}

function decodePlatformBillingOrganizations(
  raw: unknown,
): DashboardPlatformBillingOrganization[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .map((entry) => decodePlatformBillingOrganization(entry))
    .filter((entry): entry is DashboardPlatformBillingOrganization => entry !== null);
}

async function fetchJson(path: string): Promise<Record<string, unknown>> {
  const base = requireConsoleBaseUrl();
  const response = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: buildConsoleAcceptHeaders(),
    credentials: 'include',
    cache: 'no-store',
  });
  const body = (await parseConsoleJson(response)) as Record<string, unknown> | null;
  if (!response.ok || body?.ok !== true) {
    throw buildBillingApiError(
      response,
      body as ConsoleBillingErrorBody | null,
      'Console billing request failed',
    );
  }
  return body || {};
}

function parseContentDispositionFilename(raw: string | null): string {
  const header = String(raw || '').trim();
  if (!header) return '';
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim();
    } catch {
      return utf8Match[1].trim();
    }
  }
  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();
  const bareMatch = header.match(/filename=([^;]+)/i);
  return String(bareMatch?.[1] || '').trim();
}

export async function getDashboardBillingOverview(): Promise<DashboardBillingOverview> {
  const body = (await fetchJson('/console/billing/overview')) as ConsoleOverviewResponse;
  if (body.ok !== true) throw new Error('Billing overview response was invalid');
  const overview = decodeOverview(body.overview);
  if (!overview) throw new Error('Billing overview response was invalid');
  return overview;
}

export async function getDashboardBillingUsageCharges(
  organizationId: string,
  periodMonthUtc: string,
): Promise<DashboardBillingUsageCharges> {
  const params = new URLSearchParams({ periodMonthUtc });
  const body: unknown = await fetchJson(`/console/billing/usage/charges?${params}`);
  const result = parseDashboardBillingUsageCharges(body, organizationId, periodMonthUtc);
  if (result.kind === 'rejected')
    throw new Error('Billing cost response did not match this organization and period.');
  return result.value;
}

export async function listDashboardBillingAccountActivity(
  input: {
    limit?: number;
    periodMonthUtc?: string;
    eventType?: DashboardBillingAccountActivityEventType;
  } = {},
): Promise<DashboardBillingAccountActivityEntry[]> {
  const params = new URLSearchParams();
  if (Number.isFinite(input.limit) && Number(input.limit) > 0) {
    params.set('limit', String(Math.floor(Number(input.limit))));
  }
  if (input.periodMonthUtc) params.set('periodMonthUtc', input.periodMonthUtc);
  if (input.eventType) params.set('eventType', input.eventType);
  const suffix = params.toString();
  const body = (await fetchJson(
    `/console/billing/account/activity${suffix ? `?${suffix}` : ''}`,
  )) as ConsoleAccountActivityResponse;
  const activity = decodeAccountActivity(body.activity);
  if (!activity) throw new Error('Billing account activity response was invalid');
  return activity.entries;
}

export async function listDashboardBillingRefunds(): Promise<DashboardBillingRefund[]> {
  const body = (await fetchJson('/console/billing/refunds')) as ConsoleBillingRefundsResponse;
  if (!Array.isArray(body.refunds)) {
    throw new Error('Billing refund history response was invalid');
  }
  return body.refunds
    .map((entry) => decodeBillingRefund(entry))
    .filter((entry): entry is DashboardBillingRefund => entry !== null);
}

export async function createDashboardPlatformBillingRefund(
  input: DashboardPlatformBillingRefundRequest,
): Promise<DashboardBillingRefundResult> {
  const base = requireConsoleBaseUrl();
  const response = await fetch(`${base}/console/platform/billing/refunds`, {
    method: 'POST',
    headers: buildConsoleJsonHeaders(),
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  const body = (await parseConsoleJson(response)) as ConsoleBillingRefundResultResponse | null;
  if (!response.ok || body?.ok !== true) {
    throw buildBillingApiError(response, body, 'Platform billing refund request failed');
  }
  const result = decodeBillingRefundResult(body.result);
  if (!result) throw new Error('Platform billing refund response was invalid');
  return result;
}

export async function reconcileDashboardPlatformBillingRefund(input: {
  orgId: string;
  refundId: string;
}): Promise<DashboardBillingRefundResult> {
  const base = requireConsoleBaseUrl();
  const response = await fetch(`${base}/console/platform/billing/refunds/reconcile`, {
    method: 'POST',
    headers: buildConsoleJsonHeaders(),
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  const body = (await parseConsoleJson(response)) as ConsoleBillingRefundResultResponse | null;
  if (!response.ok || body?.ok !== true) {
    throw buildBillingApiError(response, body, 'Platform billing refund reconciliation failed');
  }
  const result = decodeBillingRefundResult(body.result);
  if (!result) throw new Error('Platform billing refund reconciliation response was invalid');
  return result;
}

async function postBillingManualAdjustment(
  kind: DashboardBillingManualAdjustmentKind,
  input: DashboardBillingManualAdjustmentRequest,
): Promise<DashboardBillingManualAdjustmentResult> {
  const base = requireConsoleBaseUrl();
  const endpoint =
    kind === 'support_credit'
      ? '/console/billing/adjustments/support-credit'
      : '/console/billing/adjustments/admin-debit';
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: buildConsoleJsonHeaders(),
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  const body = (await parseConsoleJson(response)) as ConsoleBillingManualAdjustmentResponse | null;
  if (!response.ok || body?.ok !== true) {
    throw buildBillingApiError(response, body, 'Billing manual adjustment request failed');
  }
  const result = decodeBillingManualAdjustmentResult(body.result);
  if (!result) throw new Error('Billing manual adjustment response was invalid');
  return result;
}

export async function createDashboardBillingManualSupportCredit(
  input: DashboardBillingManualAdjustmentRequest,
): Promise<DashboardBillingManualAdjustmentResult> {
  return postBillingManualAdjustment('support_credit', input);
}

export async function createDashboardBillingManualAdminDebit(
  input: DashboardBillingManualAdjustmentRequest,
): Promise<DashboardBillingManualAdjustmentResult> {
  return postBillingManualAdjustment('admin_debit', input);
}

export async function getDashboardPlatformBillingAccount(
  input: DashboardPlatformBillingLookupRequest,
): Promise<DashboardPlatformBillingLookupResult> {
  const params = new URLSearchParams();
  if (input.orgId) params.set('orgId', input.orgId);
  if (input.projectId) params.set('projectId', input.projectId);
  if (input.periodMonthUtc) params.set('periodMonthUtc', input.periodMonthUtc);
  if (input.eventType) params.set('eventType', input.eventType);
  if (input.limit && Number.isFinite(input.limit) && input.limit > 0) {
    params.set('limit', String(Math.floor(input.limit)));
  }
  const suffix = params.toString();
  const body = (await fetchJson(
    `/console/platform/billing/account${suffix ? `?${suffix}` : ''}`,
  )) as ConsolePlatformBillingLookupResponse;
  const result = decodePlatformBillingLookupResult(body.result);
  if (!result) throw new Error('Platform billing lookup response was invalid');
  return result;
}

export async function searchDashboardPlatformBillingOrganizations(
  input: DashboardPlatformBillingSearchRequest,
): Promise<DashboardPlatformBillingOrganization[]> {
  const params = new URLSearchParams();
  params.set('query', String(input.query || '').trim());
  if (input.limit && Number.isFinite(input.limit) && input.limit > 0) {
    params.set('limit', String(Math.floor(input.limit)));
  }
  const suffix = params.toString();
  const body = (await fetchJson(
    `/console/platform/billing/search${suffix ? `?${suffix}` : ''}`,
  )) as ConsolePlatformBillingSearchResponse;
  const organizations = decodePlatformBillingOrganizations(body.organizations);
  if (!organizations) throw new Error('Platform billing organization search response was invalid');
  return organizations;
}

async function postPlatformBillingManualAdjustment(
  kind: DashboardBillingManualAdjustmentKind,
  input: DashboardPlatformBillingManualAdjustmentRequest,
): Promise<DashboardBillingManualAdjustmentResult> {
  const base = requireConsoleBaseUrl();
  const endpoint =
    kind === 'support_credit'
      ? '/console/platform/billing/adjustments/support-credit'
      : '/console/platform/billing/adjustments/admin-debit';
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: buildConsoleJsonHeaders(),
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  const body = (await parseConsoleJson(response)) as ConsoleBillingManualAdjustmentResponse | null;
  if (!response.ok || body?.ok !== true) {
    throw buildBillingApiError(response, body, 'Platform billing manual adjustment request failed');
  }
  const result = decodeBillingManualAdjustmentResult(body.result);
  if (!result) throw new Error('Platform billing manual adjustment response was invalid');
  return result;
}

export async function createDashboardPlatformBillingManualSupportCredit(
  input: DashboardPlatformBillingManualAdjustmentRequest,
): Promise<DashboardBillingManualAdjustmentResult> {
  return postPlatformBillingManualAdjustment('support_credit', input);
}

export async function createDashboardPlatformBillingManualAdminDebit(
  input: DashboardPlatformBillingManualAdjustmentRequest,
): Promise<DashboardBillingManualAdjustmentResult> {
  return postPlatformBillingManualAdjustment('admin_debit', input);
}

export async function listDashboardBillingInvoices(
  input: DashboardBillingInvoiceListRequest = {},
): Promise<DashboardBillingInvoicePage> {
  const params = new URLSearchParams();
  if (input.status) params.set('status', input.status);
  if (input.overdue === true) params.set('overdue', 'true');
  if (input.periodMonthUtc) params.set('periodMonthUtc', input.periodMonthUtc);
  if (input.documentType) params.set('documentType', input.documentType);
  if (input.limit && Number.isFinite(input.limit) && input.limit > 0) {
    params.set('limit', String(Math.floor(input.limit)));
  }
  if (input.cursor) params.set('cursor', input.cursor);
  const suffix = params.toString();
  const body = (await fetchJson(
    `/console/billing/invoices${suffix ? `?${suffix}` : ''}`,
  )) as ConsoleInvoicesResponse;
  const rows = Array.isArray(body.invoices) ? body.invoices : [];
  return {
    invoices: rows
      .map((entry) => decodeInvoice(entry))
      .filter((entry): entry is DashboardBillingInvoice => entry !== null),
    nextCursor: body.nextCursor == null ? null : String(body.nextCursor || '').trim() || null,
    totalCount: Number(body.totalCount || 0),
    summary: decodeInvoiceListSummary(body.summary),
  };
}

export async function getDashboardBillingInvoice(
  invoiceId: string,
): Promise<DashboardBillingInvoice> {
  const normalizedInvoiceId = String(invoiceId || '').trim();
  if (!normalizedInvoiceId) throw new Error('Invoice id is required');
  const body = (await fetchJson(
    `/console/billing/invoices/${encodeURIComponent(normalizedInvoiceId)}`,
  )) as ConsoleInvoiceResponse;
  const invoice = decodeInvoice(body.invoice);
  if (!invoice) throw new Error('Billing document response was invalid');
  return invoice;
}

export async function listDashboardBillingInvoiceLineItems(
  invoiceId: string,
): Promise<DashboardBillingInvoiceLineItem[]> {
  const normalizedInvoiceId = String(invoiceId || '').trim();
  if (!normalizedInvoiceId) throw new Error('Invoice id is required');
  const body = (await fetchJson(
    `/console/billing/invoices/${encodeURIComponent(normalizedInvoiceId)}/line-items`,
  )) as ConsoleInvoiceLineItemsResponse;
  const rows = Array.isArray(body.lineItems) ? body.lineItems : [];
  return rows
    .map((entry) => decodeInvoiceLineItem(entry))
    .filter((entry): entry is DashboardBillingInvoiceLineItem => entry !== null);
}

export async function getDashboardBillingInvoiceActivity(
  invoiceId: string,
): Promise<DashboardBillingInvoiceActivity> {
  const normalizedInvoiceId = String(invoiceId || '').trim();
  if (!normalizedInvoiceId) throw new Error('Invoice id is required');
  const body = (await fetchJson(
    `/console/billing/invoices/${encodeURIComponent(normalizedInvoiceId)}/activity`,
  )) as ConsoleInvoiceActivityResponse;
  const activity = decodeInvoiceActivity(body.activity);
  if (!activity) throw new Error('Billing document activity response was invalid');
  return activity;
}

export async function downloadDashboardBillingInvoicePdf(invoiceId: string): Promise<void> {
  const normalizedInvoiceId = String(invoiceId || '').trim();
  if (!normalizedInvoiceId) throw new Error('Invoice id is required');
  const base = requireConsoleBaseUrl();
  const response = await fetch(
    `${base}/console/billing/invoices/${encodeURIComponent(normalizedInvoiceId)}/pdf`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/pdf, application/json',
      },
      credentials: 'include',
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const body = contentType.includes('application/json')
      ? ((await parseConsoleJson(response)) as ConsoleBillingErrorBody | null)
      : null;
    throw buildBillingApiError(response, body, 'Invoice PDF download failed');
  }
  const blob = await response.blob();
  const fallbackFilename = `invoice_${normalizedInvoiceId}.pdf`;
  const filename =
    parseContentDispositionFilename(response.headers.get('content-disposition')) ||
    fallbackFilename;
  const objectUrl = window.URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.URL.revokeObjectURL(objectUrl);
  }
}

export async function createDashboardStripeCheckoutSession(
  input: DashboardStripeCheckoutSessionRequest,
): Promise<DashboardStripeCheckoutSession> {
  const base = requireConsoleBaseUrl();
  const response = await fetch(`${base}/console/billing/stripe/checkout-session`, {
    method: 'POST',
    headers: buildConsoleJsonHeaders(),
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  const body = (await parseConsoleJson(response)) as ConsoleStripeCheckoutSessionResponse | null;
  if (!response.ok || body?.ok !== true) {
    throw buildBillingApiError(response, body, 'Stripe checkout session request failed');
  }
  const checkoutSession = decodeStripeCheckoutSession(body.checkoutSession);
  if (!checkoutSession) throw new Error('Stripe checkout session response was invalid');
  return checkoutSession;
}

export async function reconcileDashboardStripeCheckoutSession(
  input: DashboardStripeCheckoutSessionReconcileRequest,
): Promise<DashboardStripeCheckoutSessionReconcileResult> {
  const base = requireConsoleBaseUrl();
  const response = await fetch(`${base}/console/billing/stripe/checkout-session/reconcile`, {
    method: 'POST',
    headers: buildConsoleJsonHeaders(),
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  const body = (await parseConsoleJson(
    response,
  )) as ConsoleStripeCheckoutSessionReconcileResponse | null;
  if (!response.ok || body?.ok !== true) {
    throw buildBillingApiError(
      response,
      body as ConsoleBillingErrorBody | null,
      'Stripe checkout reconciliation failed',
    );
  }
  const result = decodeStripeCheckoutSessionReconcileResult(body.result);
  if (!result) throw new Error('Stripe checkout reconciliation response was invalid');
  return result;
}

export function formatUsdMinor(amountMinor: number): string {
  const n = Number(amountMinor || 0);
  return `$${(n / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
