import type {
  FundsReservationV1,
  PlatformResult,
  PlatformScopeV1,
  ReservationResultV1,
} from '@seams-internal/console-shared/accountPlatform';
import type { D1PreparedStatementLike } from '../boundary/d1';

export interface FundsReserveOutcomeV1 {
  readonly reservation: FundsReservationV1;
  readonly disposition: 'reserved' | 'replayed';
}

export type FundsReserveResultV1 = PlatformResult<
  FundsReserveOutcomeV1,
  Extract<ReservationResultV1, { readonly kind: 'rejected' }>['error']
>;

export interface FundsTransactionV1 {
  readonly statements: readonly D1PreparedStatementLike[];
}

export interface FundsReleaseTransactionV1 extends FundsTransactionV1 {
  readonly chargeId: string;
  readonly ledgerSourceEventId: string;
  readonly occurredAt: string;
}

export interface FundsSettlementTransactionV1 extends FundsReleaseTransactionV1 {
  readonly resourceId: string;
  readonly txOrExecutionRef: string | null;
}

interface ExecutionChargeIdentityV1 {
  readonly chargeId: string;
  readonly reservationId: string;
  readonly scope: PlatformScopeV1;
  readonly instanceId: string;
  readonly executionId: string;
  readonly meterId: 'wallet.execution' | 'satyr.completed_turn.test';
  readonly ledgerSourceEventId: string;
  readonly priceVersion: string;
  readonly sourceRecordId: string;
  readonly sourceEvidenceDigest: string;
  readonly occurredAt: string;
}

export type ExecutionChargeV1 = ExecutionChargeIdentityV1 &
  (
    | {
        readonly terminalOutcome: 'settled';
        readonly settledMinor: number;
        readonly ledgerEntryId: string | null;
      }
    | {
        readonly terminalOutcome: 'released';
        readonly settledMinor: 0;
        readonly ledgerEntryId: null;
      }
  );

export interface FundsSummaryV1 {
  readonly scope: PlatformScopeV1;
  readonly postedBalanceMinor: number;
  readonly reservedMinor: number;
  readonly pendingRefundMinor: number;
  readonly availableBalanceMinor: number;
  readonly activeReservationCount: number;
}
