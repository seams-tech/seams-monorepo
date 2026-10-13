import { createWalletMonthlyUsageStatement } from '../billing/usage';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { D1PreparedStatementLike, RouteResponse } from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import {
  MarkFundsIndeterminateRequestV1,
  PlatformUsageEventV1,
  ReconcileFundsRequestV1,
  ReleaseFundsRequestV1,
  SettleFundsRequestV1,
  type DurableSourceEvidenceV1,
  type FundsReservationV1,
  type PlatformResult,
} from '@seams-internal/console-shared/accountPlatform';
import { assertNever } from '@seams-internal/console-shared/accountPlatform/boundary';
import type { ConsoleBillingService } from '@seams-internal/console-server/billing/service';
import { TrustedWalletExecutionQuoteV1 } from '@seams-internal/console-server/billing/pricing';
import { getConsoleBillingD1Runtime } from '@seams-internal/console-server/billing/d1';
import {
  fundsChargeId,
  getConsoleBillingPrepaidReservationD1Runtime,
} from '@seams-internal/console-server/billingPrepaidReservations/d1';
import type { WalletExecutionFunds } from '../sponsorship/funds';
import type {
  ConsoleSponsoredCallExecutorKind,
  ConsoleSponsoredCallFeeUnit,
  ConsoleSponsoredCallReceiptStatus,
  ConsoleSponsoredCallRecord,
  CreateConsoleSponsoredCallRecordRequest,
} from '../sponsoredCalls/types';
import type { ConsoleSponsoredCallService } from '../sponsoredCalls/service';
import {
  createD1ConsoleSponsoredCallRecordInsertStatement,
  createD1ConsoleSponsoredCallRecordReconciliationStatement,
  getConsoleSponsoredCallD1Runtime,
  loadD1ConsoleSponsoredCallRecordById,
  loadD1ConsoleSponsoredCallRecordByIdempotencyKey,
} from '../sponsoredCalls/d1';
import type { SponsorshipSpendPricingService } from '../sponsorship/spendCaps';
import type {
  SponsoredPrepaidReservationHandle,
  SponsoredPrepaidReservationSettlement,
  SponsoredPrepaidSettlementQuote,
} from '../sponsorship/prepaidBalance';
import { resolveSponsoredPrepaidSettlementQuote } from '../sponsorship/prepaidBalance';
import type { SponsorshipBillingEventServices } from './sponsorshipBillingEvents';
import {
  emitSponsorshipBalanceTransitionEvents,
  readSponsorshipBillingBalanceSnapshot,
} from './sponsorshipBillingEvents';

export interface SponsorshipExecutionAssessment {
  succeeded: boolean;
  txOrExecutionRef: string | null;
  receiptStatus: ConsoleSponsoredCallReceiptStatus;
  feeUnit: ConsoleSponsoredCallFeeUnit;
  feeAmount: string;
  executorKind: ConsoleSponsoredCallExecutorKind;
  responseCode: string;
  responseMessage: string;
  recordErrorCode: string | null;
  recordErrorMessage: string | null;
}

export interface SponsoredExecutionBillingContext {
  orgId: string;
  actorUserId: string;
}

type SponsoredRecordDraft = Omit<
  CreateConsoleSponsoredCallRecordRequest,
  | 'txOrExecutionRef'
  | 'receiptStatus'
  | 'feeUnit'
  | 'feeAmount'
  | 'executorKind'
  | 'errorCode'
  | 'errorMessage'
>;

export interface RecordSponsoredExecutionInput {
  billing: ConsoleBillingService;
  balanceEvents?: SponsorshipBillingEventServices | null;
  billingSourceEventIdPrefix: 'sponsored_evm_call_debit' | 'signed_delegate_debit';
  context: SponsoredExecutionBillingContext;
  ledger: ConsoleSponsoredCallService;
  occurredAt?: string;
  buildRecord: (input: {
    prepaidSettlement: FinalizedSponsoredPrepaidSettlement | null;
    billingLedgerEntryId: string | null;
  }) => SponsoredRecordDraft;
  assessment: SponsorshipExecutionAssessment;
  walletId: string;
  prepaidSettlementInput: SponsoredExecutionPrepaidSettlementInput;
}

export interface SponsoredExecutionPrepaidSettlementInput {
  reservation: SponsoredPrepaidReservationHandle | null;
  executionFunds: WalletExecutionFunds | null | undefined;
  pricing: SponsorshipSpendPricingService | null | undefined;
  chainId: number;
  requestDetails: Record<string, unknown>;
}

export type FinalizedSponsoredPrepaidSettlement = SponsoredPrepaidReservationSettlement & {
  readonly sourceEventId: string;
  readonly estimatedSpendMinor: number;
  readonly billingLedgerEntryId: string | null;
};

export interface RunSponsorshipExecutionOnResultInput<
  TResult,
  TAssessment extends SponsorshipExecutionAssessment,
> {
  result: TResult;
  assessment: TAssessment;
}

export interface RunSponsorshipExecutionOnThrownErrorInput<
  TAssessment extends SponsorshipExecutionAssessment,
> {
  error: unknown;
  assessment: TAssessment;
}

export interface RunSponsorshipExecutionInput<
  TResult,
  TAssessment extends SponsorshipExecutionAssessment,
  TResponseBody extends Record<string, unknown>,
> {
  execute: () => Promise<TResult>;
  assessResult: (result: TResult) => TAssessment;
  onResult: (
    input: RunSponsorshipExecutionOnResultInput<TResult, TAssessment>,
  ) => Promise<RouteResponse<TResponseBody>> | RouteResponse<TResponseBody>;
  assessThrownError?: (error: unknown) => TAssessment;
  onThrownError?: (
    input: RunSponsorshipExecutionOnThrownErrorInput<TAssessment>,
  ) => Promise<RouteResponse<TResponseBody>> | RouteResponse<TResponseBody>;
}

export async function runSponsorshipExecution<
  TResult,
  TAssessment extends SponsorshipExecutionAssessment,
  TResponseBody extends Record<string, unknown>,
>(
  input: RunSponsorshipExecutionInput<TResult, TAssessment, TResponseBody>,
): Promise<RouteResponse<TResponseBody>> {
  let result: TResult;
  try {
    result = await input.execute();
  } catch (error: unknown) {
    if (!input.assessThrownError || !input.onThrownError) throw error;
    return await input.onThrownError({ error, assessment: input.assessThrownError(error) });
  }
  return await input.onResult({ result, assessment: input.assessResult(result) });
}

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') {
    throw new Error(`Sponsored execution funds rejected: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

async function evidenceDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function executionDetails(detailsJson: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(detailsJson);
  if (!isPlainObject(parsed)) throw new Error('Sponsored execution details must be an object');
  const execution: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== 'billing' && key !== 'policySpendCap' && key !== 'execution')
      execution[key] = value;
  }
  return execution;
}

function recordIdentity(request: SponsoredRecordDraft) {
  return [
    request.environmentId,
    request.apiKeyId,
    request.apiKeyKind,
    request.route,
    request.policyId,
    request.chainFamily,
    request.intentKind,
    request.accountRef,
    request.targetRef,
    request.sponsorRef,
    request.idempotencyKey,
    executionDetails(request.detailsJson),
  ];
}

function assertMatchingExecution(
  input: RecordSponsoredExecutionInput,
  existing: ConsoleSponsoredCallRecord,
  request: SponsoredRecordDraft,
  mode: 'record' | 'reconcile',
): void {
  if (JSON.stringify(recordIdentity(existing)) !== JSON.stringify(recordIdentity(request))) {
    throw new Error('operation_conflict: Sponsored execution identity has changed');
  }
  if (mode === 'reconcile' && existing.receiptStatus === 'broadcast_failed') {
    if (
      existing.txOrExecutionRef !== null &&
      existing.txOrExecutionRef !== input.assessment.txOrExecutionRef
    ) {
      throw new Error('operation_conflict: Reconciliation execution reference has changed');
    }
    return;
  }
  if (
    existing.receiptStatus !== input.assessment.receiptStatus ||
    existing.txOrExecutionRef !== input.assessment.txOrExecutionRef ||
    existing.feeUnit !== input.assessment.feeUnit ||
    existing.feeAmount !== input.assessment.feeAmount
  ) {
    throw new Error('operation_conflict: Sponsored execution outcome has changed');
  }
}

function sponsoredExecutionChargeReason(quote: SponsoredPrepaidSettlementQuote): string {
  switch (quote.kind) {
    case 'indeterminate':
      return 'execution_indeterminate';
    case 'released':
      return 'released_zero_spend';
    case 'settled':
      if (quote.settledSpendMinor === 0) return 'settled_zero_spend';
      return 'sponsored_execution_debit';
    default:
      return assertNever(quote);
  }
}

function finalizedSettlement(
  handle: SponsoredPrepaidReservationHandle,
  quote: SponsoredPrepaidSettlementQuote,
  occurredAt: string,
  billingLedgerEntryId: string | null,
): FinalizedSponsoredPrepaidSettlement | null {
  switch (quote.kind) {
    case 'indeterminate':
      return null;
    case 'released':
      return Object.freeze({
        kind: 'released',
        reservationId: handle.reservationId,
        sourceEventId: handle.sourceEventId,
        estimatedSpendMinor: handle.estimatedSpendMinor,
        settledSpendMinor: 0,
        pricingVersion: quote.pricingVersion,
        usedEstimatedFallback: false,
        released: true,
        settledAt: occurredAt,
        billingLedgerEntryId: null,
      });
    case 'settled':
      return Object.freeze({
        kind: 'settled',
        reservationId: handle.reservationId,
        sourceEventId: handle.sourceEventId,
        estimatedSpendMinor: handle.estimatedSpendMinor,
        settledSpendMinor: quote.settledSpendMinor,
        pricingVersion: quote.pricingVersion,
        usedEstimatedFallback: quote.usedEstimatedFallback,
        released: false,
        settledAt: occurredAt,
        billingLedgerEntryId,
      });
    default:
      return assertNever(quote);
  }
}

function fundsOperationId(
  handle: SponsoredPrepaidReservationHandle,
  action: 'indeterminate' | 'reconcile' | 'release' | 'settle',
): string {
  return JSON.stringify(['wallet', handle.instanceId, action, handle.sourceEventId]);
}

/** Accepted execution and its money changes share one D1 transaction. */
export async function recordSponsoredExecution(
  input: RecordSponsoredExecutionInput,
): Promise<ConsoleSponsoredCallRecord> {
  return await commitSponsoredExecution(input, 'record');
}

/** Confirmed chain evidence resolves an execution that retained its hold. */
export async function reconcileSponsoredExecution(
  input: RecordSponsoredExecutionInput,
): Promise<ConsoleSponsoredCallRecord> {
  return await commitSponsoredExecution(input, 'reconcile');
}

interface SponsoredFundsCommitInput {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly organizationId: string;
  readonly funds: WalletExecutionFunds;
  readonly handle: SponsoredPrepaidReservationHandle;
  readonly reservation: FundsReservationV1;
  readonly quote: SponsoredPrepaidSettlementQuote;
  readonly recordId: string;
  readonly chargeId: string;
  readonly ledgerSourceEventId: string;
  readonly resourceId: string;
  readonly occurredAt: string;
  readonly assessment: SponsorshipExecutionAssessment;
  readonly request: CreateConsoleSponsoredCallRecordRequest;
  readonly statement: D1PreparedStatementLike;
}

async function commitSponsoredFunds(input: SponsoredFundsCommitInput): Promise<void> {
  const identity = {
    version: 1,
    reservationId: input.handle.reservationId,
    executionId: input.handle.sourceEventId,
  };
  if (input.quote.kind === 'indeterminate') {
    const request = accepted(
      MarkFundsIndeterminateRequestV1.parse({
        ...identity,
        operationId: fundsOperationId(input.handle, 'indeterminate'),
      }),
    );
    accepted(
      await input.funds.reservations.markIndeterminate(input.handle.authority, request, {
        statements: [input.statement],
      }),
    );
    return;
  }
  const evidence: DurableSourceEvidenceV1 = {
    sourceRecordId: input.recordId,
    sourceDigest: await evidenceDigest([
      input.handle.instanceId,
      input.handle.sourceEventId,
      recordIdentity(input.request),
      input.assessment.receiptStatus,
      input.assessment.txOrExecutionRef,
      input.assessment.feeUnit,
      input.assessment.feeAmount,
      input.quote.settledSpendMinor,
      input.quote.pricingVersion,
      input.quote.released,
    ]),
  };
  const statements = [input.statement];
  if (
    input.request.chainFamily === 'evm' &&
    input.request.intentKind === 'evm_call' &&
    input.assessment.receiptStatus === 'success'
  ) {
    statements.push(
      createWalletMonthlyUsageStatement({
        database: input.database,
        namespace: input.namespace,
        deploymentId: input.handle.authority.deploymentId,
        organizationId: input.organizationId,
        instanceId: input.handle.instanceId,
        sourceRecordId: input.recordId,
        sourceDigest: evidence.sourceDigest,
        environmentId: input.request.environmentId,
        walletId: input.resourceId,
        occurredAt: input.occurredAt,
      }),
    );
  }
  if (!input.quote.released) {
    const quote = accepted(
      TrustedWalletExecutionQuoteV1.parse({
        version: 1,
        currency: 'USD',
        instanceId: input.handle.instanceId,
        executionId: input.handle.sourceEventId,
        quoteVersion: input.quote.pricingVersion,
        quotedAt: input.handle.quotedAt,
        amountMinor: input.quote.settledSpendMinor,
        sourceRecordId: evidence.sourceRecordId,
        sourceDigest: evidence.sourceDigest,
        ledgerSourceEventId: input.ledgerSourceEventId,
        resourceId: input.resourceId,
        txOrExecutionRef: input.assessment.txOrExecutionRef,
      }),
    );
    const event = accepted(
      PlatformUsageEventV1.parse({
        version: 1,
        eventId: input.handle.sourceEventId,
        instanceId: input.handle.instanceId,
        occurredAt: input.occurredAt,
        meterId: 'wallet.execution',
        quantity: 1,
        unit: 'execution',
        evidence: {
          kind: 'wallet_execution',
          sourceRecordId: evidence.sourceRecordId,
          sourceDigest: evidence.sourceDigest,
          environmentId: input.request.environmentId,
          executionId: input.handle.sourceEventId,
          quoteVersion: input.quote.pricingVersion,
          quotedAt: input.handle.quotedAt,
          reservationId: input.handle.reservationId,
        },
      }),
    );
    const usage = accepted(
      await input.funds.usage.prepareWalletExecutionCommit(input.handle.authority, quote, event),
    );
    statements.push(...usage.statements);
  }
  const transaction = {
    chargeId: input.chargeId,
    ledgerSourceEventId: input.ledgerSourceEventId,
    resourceId: input.resourceId,
    occurredAt: input.occurredAt,
    txOrExecutionRef: input.assessment.txOrExecutionRef,
    statements,
  };
  if (input.reservation.kind === 'indeterminate') {
    const request = accepted(
      ReconcileFundsRequestV1.parse({
        ...identity,
        operationId: fundsOperationId(input.handle, 'reconcile'),
        outcome: input.quote.released
          ? { kind: 'no_charge', noChargeEvidence: evidence }
          : {
              kind: 'charged',
              settledMinor: input.quote.settledSpendMinor,
              priceVersion: input.quote.pricingVersion,
              evidence,
            },
      }),
    );
    accepted(
      await input.funds.reservations.reconcile(input.handle.authority, request, transaction),
    );
    return;
  }
  if (input.quote.released) {
    const request = accepted(
      ReleaseFundsRequestV1.parse({
        ...identity,
        operationId: fundsOperationId(input.handle, 'release'),
        noChargeEvidence: evidence,
      }),
    );
    accepted(await input.funds.reservations.release(input.handle.authority, request, transaction));
    return;
  }
  const request = accepted(
    SettleFundsRequestV1.parse({
      ...identity,
      operationId: fundsOperationId(input.handle, 'settle'),
      settledMinor: input.quote.settledSpendMinor,
      priceVersion: input.quote.pricingVersion,
      evidence,
    }),
  );
  accepted(await input.funds.reservations.settle(input.handle.authority, request, transaction));
}

async function commitSponsoredExecution(
  input: RecordSponsoredExecutionInput,
  mode: 'record' | 'reconcile',
): Promise<ConsoleSponsoredCallRecord> {
  const prepaid = input.prepaidSettlementInput;
  const handle = prepaid.reservation;
  const funds = prepaid.executionFunds;
  if (!handle || !funds) {
    throw new Error('Sponsored settlement requires execution funds and a reservation');
  }
  if (
    handle.authority.serviceId !== funds.authority.serviceId ||
    handle.authority.deploymentId !== funds.authority.deploymentId
  ) {
    throw new Error('scope_forbidden: Sponsored reservation producer has changed');
  }
  const billing = getConsoleBillingD1Runtime(input.billing);
  const reservations = getConsoleBillingPrepaidReservationD1Runtime(funds.reservations);
  const calls = getConsoleSponsoredCallD1Runtime(input.ledger);
  if (
    !billing ||
    !reservations ||
    !calls ||
    billing.database !== reservations.database ||
    billing.database !== calls.database ||
    billing.namespace !== reservations.namespace ||
    billing.namespace !== calls.namespace
  ) {
    throw new Error('Sponsored settlement services must share one D1 database and namespace');
  }
  const initial = input.buildRecord({ prepaidSettlement: null, billingLedgerEntryId: null });
  const idempotencyKey = initial.idempotencyKey.trim();
  if (!idempotencyKey) throw new Error('Sponsored execution idempotency key is required');
  const lookup = {
    database: calls.database,
    namespace: calls.namespace,
    orgId: input.context.orgId,
    idempotencyKey,
  };
  const existing = await loadD1ConsoleSponsoredCallRecordByIdempotencyKey(lookup);
  if (existing) {
    assertMatchingExecution(input, existing, initial, mode);
    if (mode === 'record' || existing.receiptStatus !== 'broadcast_failed') return existing;
  }
  const reservation = accepted(
    await funds.reservations.getReservation(handle.authority, handle.reservationId),
  );
  if (
    reservation.instanceId !== handle.instanceId ||
    reservation.executionId !== handle.sourceEventId ||
    reservation.scope.organizationId !== input.context.orgId
  ) {
    throw new Error('scope_forbidden: Sponsored reservation does not match this execution');
  }
  if (mode === 'reconcile' && reservation.kind !== 'indeterminate') {
    throw new Error(
      'operation_conflict: Reconciliation requires an indeterminate funds reservation',
    );
  }
  const quote = await resolveSponsoredPrepaidSettlementQuote({
    reservation: handle,
    pricing: prepaid.pricing,
    chainFamily: initial.chainFamily,
    intentKind: initial.intentKind,
    executorKind: input.assessment.executorKind,
    environmentId: initial.environmentId,
    policyId: initial.policyId,
    accountRef: initial.accountRef,
    targetRef: initial.targetRef,
    chainId: prepaid.chainId,
    txOrExecutionRef: input.assessment.txOrExecutionRef,
    receiptStatus: input.assessment.receiptStatus,
    feeUnit: input.assessment.feeUnit,
    feeAmount: input.assessment.feeAmount,
    requestDetails: prepaid.requestDetails,
  });
  if (!quote) throw new Error('Sponsored settlement quote is unavailable');
  if (mode === 'reconcile' && quote.kind === 'indeterminate') {
    throw new Error('execution_unreconciled: A confirmed chain outcome is required');
  }
  const now = billing.now();
  const recordId = existing?.id || `scr_${handle.reservationId}`;
  const chargeId = fundsChargeId(handle.reservationId);
  const ledgerSourceEventId = `${input.billingSourceEventIdPrefix}:${handle.sourceEventId}`;
  const occurredAt = input.occurredAt || now.toISOString();
  const billingLedgerEntryId =
    quote.kind === 'settled' && quote.settledSpendMinor > 0 ? chargeId : null;
  const settlement = finalizedSettlement(handle, quote, occurredAt, billingLedgerEntryId);
  const request: CreateConsoleSponsoredCallRecordRequest = {
    ...input.buildRecord({ prepaidSettlement: settlement, billingLedgerEntryId }),
    id: recordId,
    executorKind: input.assessment.executorKind,
    txOrExecutionRef: input.assessment.txOrExecutionRef,
    receiptStatus: input.assessment.receiptStatus,
    feeUnit: input.assessment.feeUnit,
    feeAmount: input.assessment.feeAmount,
    errorCode: input.assessment.recordErrorCode,
    errorMessage: input.assessment.recordErrorMessage,
    prepaidReservationId: handle.reservationId,
    chargedReason: sponsoredExecutionChargeReason(quote),
  };
  const statement = existing
    ? createD1ConsoleSponsoredCallRecordReconciliationStatement({
        database: calls.database,
        namespace: calls.namespace,
        ctx: input.context,
        recordId,
        request,
        updatedAtMs: now.getTime(),
      })
    : createD1ConsoleSponsoredCallRecordInsertStatement({
        database: calls.database,
        namespace: calls.namespace,
        ctx: input.context,
        recordId,
        request,
        createdAtMs: now.getTime(),
      });
  const before = await readSponsorshipBillingBalanceSnapshot(input.billing, input.context);
  try {
    await commitSponsoredFunds({
      database: calls.database,
      namespace: calls.namespace,
      organizationId: input.context.orgId,
      funds,
      handle,
      reservation,
      quote,
      recordId,
      chargeId,
      ledgerSourceEventId,
      resourceId: input.walletId,
      occurredAt,
      assessment: input.assessment,
      request,
      statement,
    });
  } catch (error: unknown) {
    const duplicate = await loadD1ConsoleSponsoredCallRecordByIdempotencyKey(lookup);
    if (!duplicate || (duplicate.receiptStatus === 'broadcast_failed' && mode === 'reconcile'))
      throw error;
    assertMatchingExecution(input, duplicate, initial, 'record');
    return duplicate;
  }
  const record = await loadD1ConsoleSponsoredCallRecordById({
    database: calls.database,
    namespace: calls.namespace,
    orgId: input.context.orgId,
    recordId,
  });
  if (!record)
    throw new Error('Sponsored execution transaction did not persist its execution record');
  if (input.balanceEvents) {
    await emitSponsorshipBalanceTransitionEvents({
      services: input.balanceEvents,
      ctx: input.context,
      before,
      billing: input.billing,
      trigger: {
        kind: 'sponsored_execution_debit',
        environmentId: record.environmentId,
        routeId: record.route,
        ...(record.billingLedgerEntryId ? { ledgerEntryId: record.billingLedgerEntryId } : {}),
        sourceEventId: ledgerSourceEventId,
      },
    });
  }
  return record;
}
