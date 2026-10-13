import type {
  MarkFundsIndeterminateRequestV1,
  ReconcileFundsRequestV1,
  ReleaseFundsRequestV1,
  ReserveFundsRequestV1,
  ReservationResultV1,
  SettleFundsRequestV1,
  PlatformResult,
} from '@seams-internal/console-shared/accountPlatform';
import type { ServiceProducerAuthorityV1 } from '../accountPlatform/types';
import type {
  ExecutionChargeV1,
  FundsReleaseTransactionV1,
  FundsReserveResultV1,
  FundsSettlementTransactionV1,
  FundsSummaryV1,
  FundsTransactionV1,
} from './types';

export interface ConsoleBillingPrepaidReservationService {
  reserve(
    authority: ServiceProducerAuthorityV1,
    request: ReserveFundsRequestV1,
  ): Promise<FundsReserveResultV1>;
  getReservation(
    authority: ServiceProducerAuthorityV1,
    reservationId: string,
  ): Promise<ReservationResultV1>;
  getByExecution(
    authority: ServiceProducerAuthorityV1,
    request: { readonly instanceId: string; readonly executionId: string },
  ): Promise<ReservationResultV1>;
  getSummary(
    authority: ServiceProducerAuthorityV1,
    instanceId: string,
  ): Promise<PlatformResult<FundsSummaryV1, { readonly code: 'scope_forbidden' }>>;
  getExecutionCharge(
    authority: ServiceProducerAuthorityV1,
    request: { readonly instanceId: string; readonly executionId: string },
  ): Promise<ExecutionChargeV1 | null>;
  settle(
    authority: ServiceProducerAuthorityV1,
    request: SettleFundsRequestV1,
    transaction: FundsSettlementTransactionV1,
  ): Promise<ReservationResultV1>;
  release(
    authority: ServiceProducerAuthorityV1,
    request: ReleaseFundsRequestV1,
    transaction: FundsReleaseTransactionV1,
  ): Promise<ReservationResultV1>;
  markIndeterminate(
    authority: ServiceProducerAuthorityV1,
    request: MarkFundsIndeterminateRequestV1,
    transaction: FundsTransactionV1,
  ): Promise<ReservationResultV1>;
  reconcile(
    authority: ServiceProducerAuthorityV1,
    request: ReconcileFundsRequestV1,
    transaction: FundsSettlementTransactionV1,
  ): Promise<ReservationResultV1>;
  markStaleIndeterminate(request: {
    readonly at: Date;
    readonly limit: number;
  }): Promise<readonly string[]>;
}
