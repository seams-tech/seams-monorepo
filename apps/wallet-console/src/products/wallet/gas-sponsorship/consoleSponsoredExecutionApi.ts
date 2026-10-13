import {
  consoleErrorMessage,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '@core/dashboard/consoleHttp';
import {
  DashboardBillingApiError,
  parseDashboardBillingAccountActivityEntry,
  type DashboardBillingAccountActivityEntry,
} from '@core/dashboard/routes/billing/consoleBillingApi';
import { buildWalletAcceptHeaders } from '../consoleWalletHttp';

export interface DashboardSponsoredExecutionHistoryEntry {
  id: string;
  environmentId: string;
  apiKeyId: string;
  apiKeyKind: 'secret_key' | 'publishable_key';
  route: string;
  policyId: string;
  policyNameAtEvent: string | null;
  templateId: string | null;
  chainFamily: 'evm' | 'near';
  intentKind: 'evm_call' | 'near_delegate';
  executorKind: 'evm_eoa' | 'near_delegate';
  accountRef: string;
  targetRef: string;
  sponsorRef: string;
  txOrExecutionRef: string | null;
  receiptStatus: 'success' | 'reverted' | 'broadcast_failed' | 'rpc_rejected';
  feeUnit: 'wei' | 'yocto_near';
  feeAmount: string;
  estimatedSpendMinor: number | null;
  settledSpendMinor: number | null;
  pricingVersion: string | null;
  pricingSource: string | null;
  billingLedgerEntryId: string | null;
  prepaidReservationId: string | null;
  charged: boolean;
  chargedReason: string | null;
  settledAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface DashboardSponsoredExecutionHistoryPage {
  items: DashboardSponsoredExecutionHistoryEntry[];
  nextCursor: string | null;
}

export type DashboardSponsoredExecutionReconciliationStatus =
  | 'matched'
  | 'not_charged'
  | 'missing_billing_debit'
  | 'amount_mismatch'
  | 'unexpected_billing_debit';

export interface DashboardSponsoredExecutionReconciliationEntry {
  record: DashboardSponsoredExecutionHistoryEntry;
  billingDebit: DashboardBillingAccountActivityEntry | null;
  status: DashboardSponsoredExecutionReconciliationStatus;
  mismatchReasons: string[];
}

export interface DashboardSponsoredExecutionReconciliationSummary {
  matchedCount: number;
  notChargedCount: number;
  missingBillingDebitCount: number;
  amountMismatchCount: number;
  unexpectedBillingDebitCount: number;
  mismatchCount: number;
}

export interface DashboardSponsoredExecutionReconciliationPage {
  items: DashboardSponsoredExecutionReconciliationEntry[];
  nextCursor: string | null;
  summary: DashboardSponsoredExecutionReconciliationSummary;
}

export interface DashboardSponsoredExecutionHistoryRequest {
  environmentId: string;
  policyId?: string;
  chainFamily?: 'evm' | 'near';
  receiptStatus?: 'success' | 'reverted' | 'broadcast_failed' | 'rpc_rejected';
  charged?: boolean;
  limit?: number;
  cursor?: string;
  lookbackDays?: number;
}

interface ConsoleSponsoredExecutionHistoryResponse {
  ok?: boolean;
  message?: string;
  page?: unknown;
}

interface ConsoleSponsoredExecutionReconciliationResponse {
  ok?: boolean;
  message?: string;
  page?: unknown;
}

function decodeSponsoredExecutionHistoryEntry(
  raw: unknown,
): DashboardSponsoredExecutionHistoryEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const environmentId = String(row.environmentId || '').trim();
  const apiKeyId = String(row.apiKeyId || '').trim();
  const route = String(row.route || '').trim();
  const policyId = String(row.policyId || '').trim();
  const accountRef = String(row.accountRef || '').trim();
  const targetRef = String(row.targetRef || '').trim();
  const sponsorRef = String(row.sponsorRef || '').trim();
  const createdAt = String(row.createdAt || '').trim();
  if (
    !id ||
    !environmentId ||
    !apiKeyId ||
    !route ||
    !policyId ||
    !accountRef ||
    !targetRef ||
    !sponsorRef ||
    !createdAt
  ) {
    return null;
  }
  const apiKeyKind = String(row.apiKeyKind || '')
    .trim()
    .toLowerCase();
  const chainFamily = String(row.chainFamily || '')
    .trim()
    .toLowerCase();
  const intentKind = String(row.intentKind || '')
    .trim()
    .toLowerCase();
  const executorKind = String(row.executorKind || '')
    .trim()
    .toLowerCase();
  const receiptStatus = String(row.receiptStatus || '')
    .trim()
    .toLowerCase();
  const feeUnit = String(row.feeUnit || '')
    .trim()
    .toLowerCase();
  if (
    (apiKeyKind !== 'secret_key' && apiKeyKind !== 'publishable_key') ||
    (chainFamily !== 'evm' && chainFamily !== 'near') ||
    (intentKind !== 'evm_call' && intentKind !== 'near_delegate') ||
    (executorKind !== 'evm_eoa' && executorKind !== 'near_delegate') ||
    (receiptStatus !== 'success' &&
      receiptStatus !== 'reverted' &&
      receiptStatus !== 'broadcast_failed' &&
      receiptStatus !== 'rpc_rejected') ||
    (feeUnit !== 'wei' && feeUnit !== 'yocto_near')
  ) {
    return null;
  }
  return {
    id,
    environmentId,
    apiKeyId,
    apiKeyKind,
    route,
    policyId,
    policyNameAtEvent:
      row.policyNameAtEvent == null ? null : String(row.policyNameAtEvent || '').trim() || null,
    templateId: row.templateId == null ? null : String(row.templateId || '').trim() || null,
    chainFamily,
    intentKind,
    executorKind,
    accountRef,
    targetRef,
    sponsorRef,
    txOrExecutionRef:
      row.txOrExecutionRef == null ? null : String(row.txOrExecutionRef || '').trim() || null,
    receiptStatus,
    feeUnit,
    feeAmount: String(row.feeAmount || '0').trim() || '0',
    estimatedSpendMinor:
      row.estimatedSpendMinor == null ? null : Number(row.estimatedSpendMinor || 0),
    settledSpendMinor: row.settledSpendMinor == null ? null : Number(row.settledSpendMinor || 0),
    pricingVersion:
      row.pricingVersion == null ? null : String(row.pricingVersion || '').trim() || null,
    pricingSource:
      row.pricingSource == null ? null : String(row.pricingSource || '').trim() || null,
    billingLedgerEntryId:
      row.billingLedgerEntryId == null
        ? null
        : String(row.billingLedgerEntryId || '').trim() || null,
    prepaidReservationId:
      row.prepaidReservationId == null
        ? null
        : String(row.prepaidReservationId || '').trim() || null,
    charged: row.charged === true,
    chargedReason:
      row.chargedReason == null ? null : String(row.chargedReason || '').trim() || null,
    settledAt: row.settledAt == null ? null : String(row.settledAt || '').trim() || null,
    errorCode: row.errorCode == null ? null : String(row.errorCode || '').trim() || null,
    errorMessage: row.errorMessage == null ? null : String(row.errorMessage || '').trim() || null,
    idempotencyKey:
      row.idempotencyKey == null ? null : String(row.idempotencyKey || '').trim() || null,
    createdAt,
  };
}

function decodeSponsoredExecutionHistoryPage(
  raw: unknown,
): DashboardSponsoredExecutionHistoryPage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const itemsRaw = Array.isArray(row.items) ? row.items : [];
  return {
    items: itemsRaw
      .map((entry) => decodeSponsoredExecutionHistoryEntry(entry))
      .filter((entry): entry is DashboardSponsoredExecutionHistoryEntry => entry !== null),
    nextCursor: row.nextCursor == null ? null : String(row.nextCursor || '').trim() || null,
  };
}

function decodeSponsoredExecutionReconciliationEntry(
  raw: unknown,
): DashboardSponsoredExecutionReconciliationEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const record = decodeSponsoredExecutionHistoryEntry(row.record);
  if (!record) return null;
  const status = String(row.status || '')
    .trim()
    .toLowerCase();
  if (
    status !== 'matched' &&
    status !== 'not_charged' &&
    status !== 'missing_billing_debit' &&
    status !== 'amount_mismatch' &&
    status !== 'unexpected_billing_debit'
  ) {
    return null;
  }
  const billingDebit =
    row.billingDebit == null ? null : parseDashboardBillingAccountActivityEntry(row.billingDebit);
  const mismatchReasonsRaw = Array.isArray(row.mismatchReasons) ? row.mismatchReasons : [];
  return {
    record,
    billingDebit,
    status,
    mismatchReasons: mismatchReasonsRaw
      .map((value) => String(value || '').trim())
      .filter((value) => value.length > 0),
  };
}

function decodeSponsoredExecutionReconciliationPage(
  raw: unknown,
): DashboardSponsoredExecutionReconciliationPage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const itemsRaw = Array.isArray(row.items) ? row.items : [];
  const summary =
    row.summary && typeof row.summary === 'object' && !Array.isArray(row.summary)
      ? (row.summary as Record<string, unknown>)
      : null;
  if (!summary) return null;
  return {
    items: itemsRaw
      .map((entry) => decodeSponsoredExecutionReconciliationEntry(entry))
      .filter((entry): entry is DashboardSponsoredExecutionReconciliationEntry => entry !== null),
    nextCursor: row.nextCursor == null ? null : String(row.nextCursor || '').trim() || null,
    summary: {
      matchedCount: Number(summary.matchedCount || 0),
      notChargedCount: Number(summary.notChargedCount || 0),
      missingBillingDebitCount: Number(summary.missingBillingDebitCount || 0),
      amountMismatchCount: Number(summary.amountMismatchCount || 0),
      unexpectedBillingDebitCount: Number(summary.unexpectedBillingDebitCount || 0),
      mismatchCount: Number(summary.mismatchCount || 0),
    },
  };
}

function responseObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function fetchJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${requireConsoleBaseUrl()}${path}`, {
    method: 'GET',
    headers: buildWalletAcceptHeaders(),
    credentials: 'include',
    cache: 'no-store',
  });
  const body: unknown = await parseConsoleJson(response);
  if (!response.ok || !responseObject(body) || body.ok !== true) {
    throw new DashboardBillingApiError({
      status: response.status,
      code: responseObject(body) ? body.code : null,
      message: consoleErrorMessage(response, body, 'Wallet execution history request failed'),
      details: responseObject(body) ? body.details : null,
    });
  }
  return body;
}

export async function listDashboardSponsoredExecutionHistory(
  input: DashboardSponsoredExecutionHistoryRequest,
): Promise<DashboardSponsoredExecutionHistoryPage> {
  const params = new URLSearchParams();
  params.set('environmentId', input.environmentId);
  if (input.policyId) params.set('policyId', input.policyId);
  if (input.chainFamily) params.set('chainFamily', input.chainFamily);
  if (input.receiptStatus) params.set('receiptStatus', input.receiptStatus);
  if (typeof input.charged === 'boolean') params.set('charged', input.charged ? 'true' : 'false');
  if (Number.isFinite(input.limit) && Number(input.limit) > 0) {
    params.set('limit', String(Math.floor(Number(input.limit))));
  }
  if (input.cursor) params.set('cursor', input.cursor);
  if (Number.isFinite(input.lookbackDays) && Number(input.lookbackDays) > 0) {
    params.set('lookbackDays', String(Math.floor(Number(input.lookbackDays))));
  }
  const suffix = params.toString();
  const body = (await fetchJson(
    `/console/billing/sponsored-executions${suffix ? `?${suffix}` : ''}`,
  )) as ConsoleSponsoredExecutionHistoryResponse;
  const page = decodeSponsoredExecutionHistoryPage(body.page);
  if (!page) throw new Error('Sponsored execution history response was invalid');
  return page;
}

export async function listDashboardSponsoredExecutionReconciliation(
  input: DashboardSponsoredExecutionHistoryRequest,
): Promise<DashboardSponsoredExecutionReconciliationPage> {
  const params = new URLSearchParams();
  params.set('environmentId', input.environmentId);
  if (input.policyId) params.set('policyId', input.policyId);
  if (input.chainFamily) params.set('chainFamily', input.chainFamily);
  if (input.receiptStatus) params.set('receiptStatus', input.receiptStatus);
  if (typeof input.charged === 'boolean') params.set('charged', input.charged ? 'true' : 'false');
  if (Number.isFinite(input.limit) && Number(input.limit) > 0) {
    params.set('limit', String(Math.floor(Number(input.limit))));
  }
  if (input.cursor) params.set('cursor', input.cursor);
  if (Number.isFinite(input.lookbackDays) && Number(input.lookbackDays) > 0) {
    params.set('lookbackDays', String(Math.floor(Number(input.lookbackDays))));
  }
  const suffix = params.toString();
  const body = (await fetchJson(
    `/console/billing/sponsored-executions/reconciliation${suffix ? `?${suffix}` : ''}`,
  )) as ConsoleSponsoredExecutionReconciliationResponse;
  const page = decodeSponsoredExecutionReconciliationPage(body.page);
  if (!page) throw new Error('Sponsored execution reconciliation response was invalid');
  return page;
}
