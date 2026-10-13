import type {
  FundsReconciliationOutcomeV1,
  MarkFundsIndeterminateRequestV1,
  ReconcileFundsRequestV1,
  ReleaseFundsRequestV1,
  ReserveFundsRequestV1,
  SettleFundsRequestV1,
} from '../../packages/console-shared-ts/src/accountPlatform';
import type { ExecutionChargeV1 } from '../../packages/console-server-ts/src/billingPrepaidReservations/types';

declare const reserve: ReserveFundsRequestV1;
declare const settle: SettleFundsRequestV1;
declare const release: ReleaseFundsRequestV1;
declare const indeterminate: MarkFundsIndeterminateRequestV1;
declare const reconcile: ReconcileFundsRequestV1;
declare const releasedCharge: Extract<ExecutionChargeV1, { readonly terminalOutcome: 'released' }>;

// @ts-expect-error A reservation must enter through boundary validation.
const spreadReserve: ReserveFundsRequestV1 = { ...reserve };
// @ts-expect-error Settlement proof cannot survive a broad object spread.
const spreadSettle: SettleFundsRequestV1 = { ...settle };
// @ts-expect-error Release proof cannot survive a broad object spread.
const spreadRelease: ReleaseFundsRequestV1 = { ...release };
// @ts-expect-error An uncertain execution requires a validated identity.
const spreadIndeterminate: MarkFundsIndeterminateRequestV1 = { ...indeterminate };
// @ts-expect-error Reconciliation requires validated terminal evidence.
const spreadReconcile: ReconcileFundsRequestV1 = { ...reconcile };

// @ts-expect-error Plain fields cannot construct an accepted settlement request.
const literalSettle: SettleFundsRequestV1 = {
  version: 1,
  operationId: 'settle_execution',
  reservationId: 'reservation_execution',
  executionId: 'execution',
  settledMinor: 100,
  priceVersion: 'wallet-quote-v1',
  evidence: { sourceRecordId: 'execution_receipt', sourceDigest: 'a'.repeat(64) },
};

// @ts-expect-error A no-charge outcome cannot carry a charged amount or price.
const mixedOutcome: FundsReconciliationOutcomeV1 = {
  kind: 'no_charge',
  noChargeEvidence: { sourceRecordId: 'execution_receipt', sourceDigest: 'a'.repeat(64) },
  settledMinor: 100,
  priceVersion: 'wallet-quote-v1',
};

// @ts-expect-error A charged outcome requires both its price and durable evidence.
const incompleteOutcome: FundsReconciliationOutcomeV1 = {
  kind: 'charged',
  settledMinor: 100,
};

// @ts-expect-error A released execution cannot carry a money charge.
const chargedRelease: ExecutionChargeV1 = { ...releasedCharge, settledMinor: 1 };

void spreadReserve;
void spreadSettle;
void spreadRelease;
void spreadIndeterminate;
void spreadReconcile;
void literalSettle;
void mixedOutcome;
void incompleteOutcome;
void chargedRelease;
