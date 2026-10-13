import {
  ReserveFundsRequestV1,
  type FundsReservationV1,
} from '@seams-internal/console-shared/accountPlatform';
import type { ServiceProducerAuthorityV1 } from '@seams-internal/console-server/accountPlatform/types';
import type { WalletExecutionFunds } from './funds';
import type {
  ConsoleSponsoredCallChainFamily,
  ConsoleSponsoredCallExecutorKind,
  ConsoleSponsoredCallFeeUnit,
  ConsoleSponsoredCallIntentKind,
  ConsoleSponsoredCallReceiptStatus,
} from '../sponsoredCalls/types';
import type { SponsorshipSpendPricingService } from './spendCaps';

export class SponsorshipPrepaidBalanceEnforcementError extends Error {
  readonly code: string;

  readonly status: number;

  readonly details?: Record<string, unknown>;

  constructor(code: string, status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SponsorshipPrepaidBalanceEnforcementError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isSponsorshipPrepaidBalanceEnforcementError(
  error: unknown,
): error is SponsorshipPrepaidBalanceEnforcementError {
  return error instanceof SponsorshipPrepaidBalanceEnforcementError;
}

export class SponsoredPrepaidReservationHandle {
  private constructor(
    readonly reservationId: string,
    readonly instanceId: string,
    readonly authority: ServiceProducerAuthorityV1,
    readonly sourceEventId: string,
    readonly estimatedSpendMinor: number,
    readonly estimatedPricingVersion: string,
    readonly quotedAt: string,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static fromFunds(
    reservation: FundsReservationV1,
    authority: ServiceProducerAuthorityV1,
  ): SponsoredPrepaidReservationHandle {
    return new SponsoredPrepaidReservationHandle(
      reservation.reservationId,
      reservation.instanceId,
      authority,
      reservation.executionId,
      reservation.requestedMinor,
      reservation.priceVersion,
      reservation.createdAt,
    );
  }
}

/** Service reconciliation restores immutable admission facts from the funds authority. */
export async function loadSponsoredPrepaidReservation(input: {
  readonly executionFunds: WalletExecutionFunds;
  readonly instanceId: string;
  readonly executionId: string;
}): Promise<SponsoredPrepaidReservationHandle> {
  const result = await input.executionFunds.reservations.getByExecution(
    input.executionFunds.authority,
    { instanceId: input.instanceId, executionId: input.executionId },
  );
  if (result.kind === 'rejected') {
    throw new SponsorshipPrepaidBalanceEnforcementError(
      result.error.code,
      403,
      'Wallet execution reservation is unavailable',
    );
  }
  return SponsoredPrepaidReservationHandle.fromFunds(result.value, input.executionFunds.authority);
}

export type SponsoredPrepaidReservationSettlement = {
  readonly reservationId: string;
  readonly pricingVersion: string;
  readonly usedEstimatedFallback: boolean;
  readonly settledAt: string;
} & (
  | {
      readonly kind: 'settled';
      readonly settledSpendMinor: number;
      readonly released: false;
    }
  | {
      readonly kind: 'released';
      readonly settledSpendMinor: 0;
      readonly released: true;
    }
);

export type SponsoredPrepaidSettlementQuote =
  | {
      readonly kind: 'settled';
      readonly settledSpendMinor: number;
      readonly pricingVersion: string;
      readonly usedEstimatedFallback: boolean;
      readonly released: false;
    }
  | {
      readonly kind: 'released';
      readonly settledSpendMinor: 0;
      readonly pricingVersion: string;
      readonly usedEstimatedFallback: false;
      readonly released: true;
    }
  | {
      readonly kind: 'indeterminate';
      readonly settledSpendMinor?: never;
      readonly pricingVersion?: never;
      readonly usedEstimatedFallback?: never;
      readonly released?: never;
    };

function assertNeverReceiptStatus(status: never): never {
  throw new SponsorshipPrepaidBalanceEnforcementError(
    'sponsorship_prepaid_balance_invalid',
    500,
    `Unhandled sponsored-call receipt status: ${status}`,
  );
}

function toNonNegativeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new SponsorshipPrepaidBalanceEnforcementError(
      'sponsorship_prepaid_balance_invalid',
      500,
      `${label} must be a non-negative integer`,
    );
  }
  return parsed;
}

function normalizePricingVersion(value: unknown): string {
  return String(value || '').trim() || 'unknown';
}

export async function reserveSponsoredPrepaidBalance(input: {
  executionFunds: WalletExecutionFunds | null | undefined;
  pricing: SponsorshipSpendPricingService | null | undefined;
  ctx: { readonly orgId: string; readonly actorUserId: string };
  chainFamily: ConsoleSponsoredCallChainFamily;
  intentKind: ConsoleSponsoredCallIntentKind;
  executorKind: ConsoleSponsoredCallExecutorKind;
  environmentId: string;
  policyId: string;
  accountRef: string | null;
  targetRef: string;
  chainId: number;
  sourceEventId: string;
  requestDetails: Record<string, unknown>;
}): Promise<SponsoredPrepaidReservationHandle> {
  if (!input.executionFunds) {
    throw new SponsorshipPrepaidBalanceEnforcementError(
      'sponsorship_prepaid_balance_unavailable',
      503,
      'Sponsored prepaid balance reservations are not configured on this server',
    );
  }
  if (!input.pricing) {
    throw new SponsorshipPrepaidBalanceEnforcementError(
      'sponsorship_pricing_unavailable',
      503,
      'Sponsored spend pricing is not configured on this server',
    );
  }

  const quote = await input.pricing.estimateSponsoredExecutionSpend({
    chainFamily: input.chainFamily,
    intentKind: input.intentKind,
    executorKind: input.executorKind,
    environmentId: input.environmentId,
    policyId: input.policyId,
    accountRef: input.accountRef,
    targetRef: input.targetRef,
    chainId: input.chainId,
    requestDetails: input.requestDetails,
  });
  const estimatedSpendMinor = toNonNegativeInteger(quote.spendMinor, 'estimated spendMinor');
  const estimatedPricingVersion = normalizePricingVersion(quote.pricingVersion);
  const instance = await input.executionFunds.resolveInstance(input.ctx.orgId, input.environmentId);
  const request = ReserveFundsRequestV1.parse({
    version: 1,
    operationId: JSON.stringify(['wallet', instance.instanceId, 'reserve', input.sourceEventId]),
    instanceId: instance.instanceId,
    executionId: input.sourceEventId,
    requestedMinor: estimatedSpendMinor,
    priceVersion: estimatedPricingVersion,
  });
  if (request.kind === 'rejected') {
    throw new SponsorshipPrepaidBalanceEnforcementError(
      'sponsorship_prepaid_balance_invalid',
      500,
      'Wallet execution quote cannot produce a funds reservation',
    );
  }
  const result = await input.executionFunds.reservations.reserve(
    input.executionFunds.authority,
    request.value,
  );
  if (result.kind === 'rejected') {
    throw new SponsorshipPrepaidBalanceEnforcementError(
      result.error.code,
      result.error.code === 'insufficient_funds' ? 402 : 409,
      'Wallet execution funds could not be reserved',
    );
  }
  if (result.value.disposition === 'replayed') {
    throw new SponsorshipPrepaidBalanceEnforcementError(
      'execution_pending',
      409,
      'Wallet execution already has a funds reservation. Reconcile its outcome before retrying.',
    );
  }
  return SponsoredPrepaidReservationHandle.fromFunds(
    result.value.reservation,
    input.executionFunds.authority,
  );
}

export async function resolveSponsoredPrepaidSettlementQuote(input: {
  reservation: SponsoredPrepaidReservationHandle | null;
  pricing: SponsorshipSpendPricingService | null | undefined;
  chainFamily: ConsoleSponsoredCallChainFamily;
  intentKind: ConsoleSponsoredCallIntentKind;
  executorKind: ConsoleSponsoredCallExecutorKind;
  environmentId: string;
  policyId: string;
  accountRef: string | null;
  targetRef: string;
  chainId: number;
  txOrExecutionRef: string | null;
  receiptStatus: ConsoleSponsoredCallReceiptStatus;
  feeUnit: ConsoleSponsoredCallFeeUnit;
  feeAmount: string;
  requestDetails: Record<string, unknown>;
}): Promise<SponsoredPrepaidSettlementQuote | null> {
  if (!input.reservation) return null;
  if (!input.pricing) {
    throw new SponsorshipPrepaidBalanceEnforcementError(
      'sponsorship_pricing_unavailable',
      503,
      'Sponsored spend pricing is not configured on this server',
    );
  }
  switch (input.receiptStatus) {
    case 'broadcast_failed':
      return { kind: 'indeterminate' };
    case 'rpc_rejected':
      return {
        kind: 'released',
        settledSpendMinor: 0,
        pricingVersion: input.reservation.estimatedPricingVersion,
        usedEstimatedFallback: false,
        released: true,
      };
    case 'success':
    case 'reverted':
      break;
    default:
      return assertNeverReceiptStatus(input.receiptStatus);
  }

  let settledSpendMinor = input.reservation.estimatedSpendMinor;
  let pricingVersion = input.reservation.estimatedPricingVersion;
  let usedEstimatedFallback = false;

  try {
    const finalized = await input.pricing.finalizeSponsoredExecutionSpend({
      chainFamily: input.chainFamily,
      intentKind: input.intentKind,
      executorKind: input.executorKind,
      environmentId: input.environmentId,
      policyId: input.policyId,
      accountRef: input.accountRef,
      targetRef: input.targetRef,
      chainId: input.chainId,
      txOrExecutionRef: input.txOrExecutionRef,
      receiptStatus: input.receiptStatus,
      feeUnit: input.feeUnit,
      feeAmount: input.feeAmount,
      requestDetails: input.requestDetails,
      estimatedSpendMinor: input.reservation.estimatedSpendMinor,
      estimatedPricingVersion: input.reservation.estimatedPricingVersion,
    });
    settledSpendMinor = toNonNegativeInteger(finalized.spendMinor, 'finalized spendMinor');
    pricingVersion = normalizePricingVersion(finalized.pricingVersion);
  } catch {
    settledSpendMinor = input.reservation.estimatedSpendMinor;
    pricingVersion = input.reservation.estimatedPricingVersion;
    usedEstimatedFallback = true;
  }

  if (settledSpendMinor <= 0) {
    return {
      kind: 'settled',
      settledSpendMinor: 0,
      pricingVersion,
      usedEstimatedFallback,
      released: false,
    };
  }

  return {
    kind: 'settled',
    settledSpendMinor,
    pricingVersion,
    usedEstimatedFallback,
    released: false,
  };
}
