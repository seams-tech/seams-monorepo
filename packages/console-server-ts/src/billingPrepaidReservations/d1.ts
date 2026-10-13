import {
  PlatformScopeV1,
  type DurableSourceEvidenceV1,
  type FundsReservationV1,
  type MarkFundsIndeterminateRequestV1,
  type ReconcileFundsRequestV1,
  type ReleaseFundsRequestV1,
  type ReservationResultV1,
  type ReserveFundsRequestV1,
  type SettleFundsRequestV1,
} from '@seams-internal/console-shared/accountPlatform';
import { integer, textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import type { D1AccountPlatformService } from '../accountPlatform/d1';
import type { ServiceProducerAuthorityV1 } from '../accountPlatform/types';
import { secureRandomBase36 } from '../boundary';
import { queryD1All, queryD1One, type D1DatabaseLike, type D1Row } from '../boundary/d1';
import {
  createProductExecutionDebitD1Statements,
  getConsoleBillingD1Runtime,
  type ConsoleBillingD1Runtime,
} from '../billing/d1';
import type { ConsoleBillingService } from '../billing/service';
import {
  BILLING_EXECUTION_PRICE_ELIGIBILITY_SQL,
  billingExecutionPriceEligibilityBindings,
  isRegisteredBillingPriceAvailable,
  registerWalletExecutionPriceVersion,
} from '../billing/pricing';
import { d1ChangedRows } from '../boundary/d1';
import type { ConsoleBillingPrepaidReservationService } from './service';
import { ensureBillingFundsD1Schema } from './schema';
import type {
  ExecutionChargeV1,
  FundsReleaseTransactionV1,
  FundsReserveResultV1,
  FundsSettlementTransactionV1,
  FundsTransactionV1,
} from './types';

export interface ConsoleBillingPrepaidReservationD1Runtime {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly now: () => Date;
}

export interface D1ConsoleBillingPrepaidReservationServiceOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly now?: () => Date;
  readonly platform: D1AccountPlatformService;
  readonly billing: ConsoleBillingService;
  readonly ensureSchema?: boolean;
}

type FundsErrorCode = Extract<ReservationResultV1, { readonly kind: 'rejected' }>['error']['code'];
type TerminalOutcome =
  | {
      readonly kind: 'settled';
      readonly amountMinor: number;
      readonly priceVersion: string;
      readonly evidence: DurableSourceEvidenceV1;
    }
  | {
      readonly kind: 'released';
      readonly evidence: DurableSourceEvidenceV1;
      readonly amountMinor?: never;
      readonly priceVersion?: never;
    };

function accepted<T>(value: T): { readonly kind: 'accepted'; readonly value: T } {
  return { kind: 'accepted', value };
}

function rejected(code: FundsErrorCode): {
  readonly kind: 'rejected';
  readonly error: { readonly code: FundsErrorCode };
} {
  return { kind: 'rejected', error: { code } };
}

function defaultNow(): Date {
  return new Date();
}

export function fundsChargeId(reservationId: string): string {
  return `ble_${reservationId}`;
}

function signedInteger(input: unknown, field: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input))
    throw new Error(`Invalid persisted ${field}`);
  return input;
}

function scopeOf(row: D1Row): PlatformScopeV1 {
  const parsed = PlatformScopeV1.parse({
    namespace: row.namespace,
    organizationId: row.org_id,
    projectId: row.project_id,
    billingAccountId: row.billing_account_id,
  });
  if (parsed.kind === 'rejected') throw new Error('Invalid persisted funds scope');
  return parsed.value;
}

function reservationOf(row: D1Row): FundsReservationV1 {
  const reservationId = textValue(row.id, 'id');
  const scope = scopeOf(row);
  const instanceId = textValue(row.instance_id, 'instance_id');
  const executionId = textValue(row.execution_id, 'execution_id');
  const requestedMinor = integer(row.requested_minor, 'requested_minor', 0);
  const priceVersion = textValue(row.price_version, 'price_version');
  const createdAt = new Date(integer(row.created_at_ms, 'created_at_ms', 0)).toISOString();
  switch (row.status) {
    case 'reserved':
      return Object.freeze({
        kind: row.status,
        reservationId,
        scope,
        instanceId,
        executionId,
        requestedMinor,
        priceVersion,
        createdAt,
      });
    case 'indeterminate':
      return Object.freeze({
        kind: row.status,
        reservationId,
        scope,
        instanceId,
        executionId,
        requestedMinor,
        priceVersion,
        createdAt,
        reconciliation: Object.freeze({ kind: 'pending' }),
      });
    case 'settled':
      return Object.freeze({
        kind: row.status,
        reservationId,
        scope,
        instanceId,
        executionId,
        requestedMinor,
        priceVersion,
        createdAt,
        chargeId: textValue(row.charge_id, 'charge_id'),
        settledMinor: integer(row.settled_minor, 'settled_minor', 0),
      });
    case 'released':
      return Object.freeze({
        kind: row.status,
        reservationId,
        scope,
        instanceId,
        executionId,
        requestedMinor,
        priceVersion,
        createdAt,
        noChargeEvidence: Object.freeze({
          sourceRecordId: textValue(row.source_record_id, 'source_record_id'),
          sourceDigest: textValue(row.source_evidence_digest, 'source_evidence_digest'),
        }),
      });
    default:
      throw new Error('Invalid persisted funds status');
  }
}

function chargeOf(row: D1Row): ExecutionChargeV1 {
  if (row.meter_id !== 'wallet.execution' && row.meter_id !== 'satyr.completed_turn.test')
    throw new Error('Invalid execution meter');
  if (row.terminal_outcome !== 'settled' && row.terminal_outcome !== 'released')
    throw new Error('Invalid execution outcome');
  if (row.terminal_outcome === 'released') {
    if (row.settled_minor !== 0 || row.ledger_entry_id !== null)
      throw new Error('Released funds have a charge');
    return Object.freeze({
      chargeId: textValue(row.charge_id, 'charge_id'),
      reservationId: textValue(row.reservation_id, 'reservation_id'),
      scope: scopeOf(row),
      instanceId: textValue(row.instance_id, 'instance_id'),
      executionId: textValue(row.execution_id, 'execution_id'),
      meterId: row.meter_id,
      ledgerEntryId: null,
      ledgerSourceEventId: textValue(row.source_event_id, 'source_event_id'),
      priceVersion: textValue(row.price_version, 'price_version'),
      settledMinor: 0,
      sourceRecordId: textValue(row.source_record_id, 'source_record_id'),
      sourceEvidenceDigest: textValue(row.source_evidence_digest, 'source_evidence_digest'),
      terminalOutcome: 'released',
      occurredAt: new Date(integer(row.occurred_at_ms, 'occurred_at_ms', 0)).toISOString(),
    });
  }
  return Object.freeze({
    chargeId: textValue(row.charge_id, 'charge_id'),
    reservationId: textValue(row.reservation_id, 'reservation_id'),
    scope: scopeOf(row),
    instanceId: textValue(row.instance_id, 'instance_id'),
    executionId: textValue(row.execution_id, 'execution_id'),
    meterId: row.meter_id,
    ledgerEntryId:
      row.ledger_entry_id === null ? null : textValue(row.ledger_entry_id, 'ledger_entry_id'),
    ledgerSourceEventId: textValue(row.source_event_id, 'source_event_id'),
    priceVersion: textValue(row.price_version, 'price_version'),
    settledMinor: integer(row.settled_minor, 'settled_minor', 0),
    sourceRecordId: textValue(row.source_record_id, 'source_record_id'),
    sourceEvidenceDigest: textValue(row.source_evidence_digest, 'source_evidence_digest'),
    terminalOutcome: row.terminal_outcome,
    occurredAt: new Date(integer(row.occurred_at_ms, 'occurred_at_ms', 0)).toISOString(),
  });
}

function fundsError(error: unknown): FundsErrorCode | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('funds_scope_forbidden')) return 'scope_forbidden';
  if (message.includes('funds_insufficient')) return 'insufficient_funds';
  if (message.includes('funds_execution_unreconciled')) return 'execution_unreconciled';
  if (message.includes('funds_operation_conflict') || message.includes('UNIQUE constraint failed'))
    return 'operation_conflict';
  return null;
}

async function digest(value: unknown): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
  );
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function matchesAuthority(row: D1Row, authority: ServiceProducerAuthorityV1): boolean {
  return row.service_id === authority.serviceId && row.deployment_id === authority.deploymentId;
}

const RESERVATION_QUERY = `SELECT r.*, c.charge_id, c.settled_minor, c.source_record_id, c.source_evidence_digest
  FROM billing_funds_reservations r LEFT JOIN billing_execution_charges c
    ON c.namespace = r.namespace AND c.reservation_id = r.id`;

export class D1ConsoleBillingPrepaidReservationService implements ConsoleBillingPrepaidReservationService {
  readonly runtime: ConsoleBillingPrepaidReservationD1Runtime;
  private readonly platform: D1AccountPlatformService;
  private readonly billing: ConsoleBillingD1Runtime;

  constructor(options: D1ConsoleBillingPrepaidReservationServiceOptions) {
    const billing = getConsoleBillingD1Runtime(options.billing);
    if (
      !billing ||
      billing.database !== options.database ||
      billing.namespace !== options.namespace
    )
      throw new Error('Funds and billing must share one D1 authority');
    this.runtime = Object.freeze({
      database: options.database,
      namespace: options.namespace,
      now: options.now ?? defaultNow,
    });
    this.platform = options.platform;
    this.billing = billing;
  }

  private async row(
    authority: ServiceProducerAuthorityV1,
    reservationId: string,
  ): Promise<D1Row | null> {
    const row = await queryD1One(
      this.runtime.database,
      `${RESERVATION_QUERY} WHERE r.namespace = ? AND r.id = ?`,
      [this.runtime.namespace, reservationId],
    );
    return row && matchesAuthority(row, authority) ? row : null;
  }

  async getReservation(
    authority: ServiceProducerAuthorityV1,
    reservationId: string,
  ): Promise<ReservationResultV1> {
    const row = await this.row(authority, reservationId);
    return row ? accepted(reservationOf(row)) : rejected('scope_forbidden');
  }

  async getByExecution(
    authority: ServiceProducerAuthorityV1,
    request: { readonly instanceId: string; readonly executionId: string },
  ): Promise<ReservationResultV1> {
    const row = await queryD1One(
      this.runtime.database,
      `${RESERVATION_QUERY} WHERE r.namespace = ? AND r.instance_id = ? AND r.execution_id = ?`,
      [this.runtime.namespace, request.instanceId, request.executionId],
    );
    return row && matchesAuthority(row, authority)
      ? accepted(reservationOf(row))
      : rejected('scope_forbidden');
  }

  async getSummary(authority: ServiceProducerAuthorityV1, instanceId: string) {
    const instance = await this.platform.resolveServiceProducerInstance(authority, instanceId);
    if (instance.kind === 'rejected')
      return { kind: 'rejected', error: { code: 'scope_forbidden' } } as const;
    const scope = instance.value.scope;
    const row = await queryD1One(
      this.runtime.database,
      `SELECT
      COALESCE((SELECT SUM(CASE direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor END) FROM billing_ledger_postings WHERE namespace = ?1 AND org_id = ?2 AND account_code = 'org_prepaid_liability'), 0) AS posted,
      COALESCE((SELECT SUM(requested_minor) FROM billing_funds_reservations WHERE namespace = ?1 AND billing_account_id = ?3 AND status IN ('reserved','indeterminate')), 0) AS held,
      COALESCE((SELECT COUNT(*) FROM billing_funds_reservations WHERE namespace = ?1 AND billing_account_id = ?3 AND status IN ('reserved','indeterminate')), 0) AS hold_count,
      COALESCE((SELECT SUM(amount_minor) FROM billing_refunds WHERE namespace = ?1 AND org_id = ?2 AND origin = 'console' AND status IN ('requested','provider_pending')), 0) AS pending`,
      [scope.namespace, scope.organizationId, scope.billingAccountId],
    );
    if (!row) throw new Error('Funds summary is unavailable');
    const postedBalanceMinor = signedInteger(row.posted, 'posted');
    const reservedMinor = integer(row.held, 'held', 0);
    const pendingRefundMinor = integer(row.pending, 'pending', 0);
    return accepted({
      scope,
      postedBalanceMinor,
      reservedMinor,
      pendingRefundMinor,
      availableBalanceMinor: postedBalanceMinor - reservedMinor - pendingRefundMinor,
      activeReservationCount: integer(row.hold_count, 'hold_count', 0),
    });
  }

  async getExecutionCharge(
    authority: ServiceProducerAuthorityV1,
    request: { readonly instanceId: string; readonly executionId: string },
  ): Promise<ExecutionChargeV1 | null> {
    const instance = await this.platform.resolveServiceProducerInstance(
      authority,
      request.instanceId,
    );
    if (instance.kind === 'rejected') return null;
    const row = await queryD1One(
      this.runtime.database,
      `SELECT * FROM billing_execution_charges WHERE namespace = ? AND instance_id = ? AND execution_id = ?`,
      [this.runtime.namespace, request.instanceId, request.executionId],
    );
    return row ? chargeOf(row) : null;
  }

  async reserve(
    authority: ServiceProducerAuthorityV1,
    request: ReserveFundsRequestV1,
  ): Promise<FundsReserveResultV1> {
    const instance = await this.platform.resolveServiceProducerInstance(
      authority,
      request.instanceId,
    );
    if (instance.kind === 'rejected') return rejected('scope_forbidden');
    const scope = instance.value.scope;
    const meterId =
      authority.serviceId === 'wallet' ? 'wallet.execution' : 'satyr.completed_turn.test';
    if (authority.serviceId === 'wallet')
      await registerWalletExecutionPriceVersion(this.runtime.database, request.priceVersion);
    const priceInput = {
      database: this.runtime.database,
      namespace: scope.namespace,
      scope,
      meterId,
      priceVersion: request.priceVersion,
      amountMinor: request.requestedMinor,
    } as const;
    if (!(await isRegisteredBillingPriceAvailable(priceInput)))
      return rejected('price_unavailable');
    const payloadDigest = await digest(request);
    const previous = await queryD1One(
      this.runtime.database,
      `${RESERVATION_QUERY} WHERE r.namespace = ? AND (r.reserve_operation_id = ? OR (r.instance_id = ? AND r.execution_id = ?))`,
      [this.runtime.namespace, request.operationId, request.instanceId, request.executionId],
    );
    if (previous) return this.reserveReplay(previous, payloadDigest, authority);
    const id = `bpr_${secureRandomBase36(20, 'funds reservation identity')}`;
    const createdAtMs = this.runtime.now().getTime();
    try {
      const inserted = await this.runtime.database
        .prepare(
          `INSERT INTO billing_funds_reservations
        (namespace,id,org_id,project_id,billing_account_id,instance_id,service_id,deployment_id,execution_id,reserve_operation_id,requested_minor,price_version,reserve_digest,status,indeterminate_operation_id,indeterminate_digest,created_at_ms,updated_at_ms,reconciliation_due_at_ms)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,'reserved',NULL,NULL,?,?,?
        WHERE ${BILLING_EXECUTION_PRICE_ELIGIBILITY_SQL}`,
        )
        .bind(
          scope.namespace,
          id,
          scope.organizationId,
          scope.projectId,
          scope.billingAccountId,
          request.instanceId,
          authority.serviceId,
          authority.deploymentId,
          request.executionId,
          request.operationId,
          request.requestedMinor,
          request.priceVersion,
          payloadDigest,
          createdAtMs,
          createdAtMs,
          createdAtMs + 300_000,
          ...billingExecutionPriceEligibilityBindings(priceInput),
        )
        .run();
      if (d1ChangedRows(inserted) !== 1) return rejected('price_unavailable');
    } catch (error) {
      const code = fundsError(error);
      if (code === null) throw error;
      const replay = await this.rowByExecution(request.instanceId, request.executionId);
      if (replay) return this.reserveReplay(replay, payloadDigest, authority);
      return rejected(code);
    }
    const row = await this.row(authority, id);
    if (!row) throw new Error('Funds reservation insert has no result');
    return accepted({
      reservation: reservationOf(row),
      disposition: 'reserved',
    });
  }

  private async rowByExecution(instanceId: string, executionId: string): Promise<D1Row | null> {
    return queryD1One(
      this.runtime.database,
      `${RESERVATION_QUERY} WHERE r.namespace = ? AND r.instance_id = ? AND r.execution_id = ?`,
      [this.runtime.namespace, instanceId, executionId],
    );
  }

  private reserveReplay(
    row: D1Row,
    payloadDigest: string,
    authority: ServiceProducerAuthorityV1,
  ): FundsReserveResultV1 {
    if (!matchesAuthority(row, authority)) return rejected('scope_forbidden');
    if (row.reserve_digest !== payloadDigest) return rejected('operation_conflict');
    return accepted({
      reservation: reservationOf(row),
      disposition: 'replayed',
    });
  }

  async markIndeterminate(
    authority: ServiceProducerAuthorityV1,
    request: MarkFundsIndeterminateRequestV1,
    transaction: FundsTransactionV1,
  ): Promise<ReservationResultV1> {
    const row = await this.row(authority, request.reservationId);
    if (!row || row.execution_id !== request.executionId) return rejected('scope_forbidden');
    const payloadDigest = await digest(request);
    if (row.status === 'indeterminate')
      return row.indeterminate_digest === payloadDigest
        ? accepted(reservationOf(row))
        : rejected('operation_conflict');
    if (row.status !== 'reserved') return rejected('operation_conflict');
    try {
      await this.runtime.database.batch([
        this.runtime.database
          .prepare(
            `UPDATE billing_funds_reservations SET status = 'indeterminate', indeterminate_operation_id = ?, indeterminate_digest = ?, updated_at_ms = ? WHERE namespace = ? AND id = ? AND status = 'reserved'`,
          )
          .bind(
            request.operationId,
            payloadDigest,
            this.runtime.now().getTime(),
            this.runtime.namespace,
            request.reservationId,
          ),
        this.runtime.database.prepare(
          `INSERT INTO billing_funds_transition_checks (valid) VALUES (changes() = 1)`,
        ),
        ...transaction.statements,
        this.runtime.database.prepare('DELETE FROM billing_funds_transition_checks'),
      ]);
    } catch (error) {
      const latest = await this.row(authority, request.reservationId);
      if (
        latest &&
        latest.status === 'indeterminate' &&
        latest.indeterminate_digest === payloadDigest
      )
        return accepted(reservationOf(latest));
      const code = fundsError(error);
      if (code === null) throw error;
      return rejected(code);
    }
    return this.getReservation(authority, request.reservationId);
  }

  async settle(
    authority: ServiceProducerAuthorityV1,
    request: SettleFundsRequestV1,
    transaction: FundsSettlementTransactionV1,
  ): Promise<ReservationResultV1> {
    return this.terminal(
      authority,
      request.operationId,
      request.reservationId,
      request.executionId,
      {
        kind: 'settled',
        amountMinor: request.settledMinor,
        priceVersion: request.priceVersion,
        evidence: request.evidence,
      },
      transaction,
      false,
    );
  }

  async release(
    authority: ServiceProducerAuthorityV1,
    request: ReleaseFundsRequestV1,
    transaction: FundsReleaseTransactionV1,
  ): Promise<ReservationResultV1> {
    return this.terminal(
      authority,
      request.operationId,
      request.reservationId,
      request.executionId,
      { kind: 'released', evidence: request.noChargeEvidence },
      transaction,
      false,
    );
  }

  async reconcile(
    authority: ServiceProducerAuthorityV1,
    request: ReconcileFundsRequestV1,
    transaction: FundsSettlementTransactionV1,
  ): Promise<ReservationResultV1> {
    switch (request.outcome.kind) {
      case 'charged':
        return this.terminal(
          authority,
          request.operationId,
          request.reservationId,
          request.executionId,
          {
            kind: 'settled',
            amountMinor: request.outcome.settledMinor,
            priceVersion: request.outcome.priceVersion,
            evidence: request.outcome.evidence,
          },
          transaction,
          true,
        );
      case 'no_charge':
        return this.terminal(
          authority,
          request.operationId,
          request.reservationId,
          request.executionId,
          { kind: 'released', evidence: request.outcome.noChargeEvidence },
          transaction,
          true,
        );
    }
  }

  private async terminal(
    authority: ServiceProducerAuthorityV1,
    operationId: string,
    reservationId: string,
    executionId: string,
    outcome: TerminalOutcome,
    transaction: FundsSettlementTransactionV1 | FundsReleaseTransactionV1,
    reconciled: boolean,
  ): Promise<ReservationResultV1> {
    const row = await this.row(authority, reservationId);
    if (!row || row.execution_id !== executionId) return rejected('scope_forbidden');
    if (transaction.chargeId !== fundsChargeId(reservationId))
      return rejected('operation_conflict');
    const scope = scopeOf(row);
    const amount = outcome.kind === 'settled' ? outcome.amountMinor : 0;
    if (
      authority.serviceId === 'satyr' &&
      amount > integer(row.requested_minor, 'requested_minor', 0)
    )
      return rejected('operation_conflict');
    const priceVersion =
      outcome.kind === 'settled'
        ? outcome.priceVersion
        : textValue(row.price_version, 'price_version');
    const meterId =
      authority.serviceId === 'wallet' ? 'wallet.execution' : 'satyr.completed_turn.test';
    const priceAmount =
      outcome.kind === 'settled' ? amount : integer(row.requested_minor, 'requested_minor', 0);
    if (authority.serviceId === 'wallet' && outcome.kind === 'settled')
      await registerWalletExecutionPriceVersion(this.runtime.database, priceVersion);
    const priceInput = {
      database: this.runtime.database,
      namespace: scope.namespace,
      scope,
      meterId,
      priceVersion,
      amountMinor: priceAmount,
    } as const;
    if (
      (outcome.kind === 'settled' || authority.serviceId === 'satyr') &&
      !(await isRegisteredBillingPriceAvailable(priceInput))
    )
      return rejected('price_unavailable');
    const occurredAtMs = Date.parse(transaction.occurredAt);
    if (!Number.isSafeInteger(occurredAtMs))
      throw new Error('Terminal occurrence must be a valid UTC timestamp');
    const descriptor = {
      reservationId,
      executionId,
      outcome,
      chargeId: transaction.chargeId,
      ledgerSourceEventId: transaction.ledgerSourceEventId,
      resourceId: 'resourceId' in transaction ? transaction.resourceId : null,
      txOrExecutionRef: 'txOrExecutionRef' in transaction ? transaction.txOrExecutionRef : null,
      occurredAt: new Date(occurredAtMs).toISOString(),
    };
    const payloadDigest = await digest(descriptor);
    const reusedOperation = await queryD1One(
      this.runtime.database,
      'SELECT reservation_id FROM billing_funds_terminal_receipts WHERE namespace = ? AND operation_id = ?',
      [scope.namespace, operationId],
    );
    if (reusedOperation && reusedOperation.reservation_id !== reservationId)
      return rejected('operation_conflict');
    const previous = await queryD1One(
      this.runtime.database,
      'SELECT * FROM billing_funds_terminal_receipts WHERE namespace = ? AND reservation_id = ?',
      [scope.namespace, reservationId],
    );
    if (previous)
      return previous.payload_digest === payloadDigest
        ? accepted(reservationOf(row))
        : rejected('operation_conflict');
    if (row.status === 'indeterminate' && !reconciled) return rejected('execution_unreconciled');
    if (row.status !== 'reserved' && row.status !== 'indeterminate')
      return rejected('operation_conflict');
    const statements = [
      this.runtime.database
        .prepare(
          `INSERT INTO billing_funds_terminal_receipts (namespace,reservation_id,operation_id,payload_json,payload_digest,outcome,reconciled,created_at_ms)
            SELECT ?,?,?,?,?,?,?,? WHERE ? = 1 OR ${BILLING_EXECUTION_PRICE_ELIGIBILITY_SQL}`,
        )
        .bind(
          scope.namespace,
          reservationId,
          operationId,
          JSON.stringify({ executionId, descriptor }),
          payloadDigest,
          outcome.kind,
          reconciled ? 1 : 0,
          this.runtime.now().getTime(),
          outcome.kind === 'released' && authority.serviceId === 'wallet' ? 1 : 0,
          ...billingExecutionPriceEligibilityBindings(priceInput),
        ),
      this.runtime.database.prepare(
        `INSERT INTO billing_funds_transition_checks (valid) VALUES (changes() = 1)`,
      ),
      this.runtime.database
        .prepare(
          `INSERT INTO billing_execution_charges (namespace,charge_id,reservation_id,org_id,project_id,billing_account_id,instance_id,meter_id,execution_id,ledger_entry_id,source_event_id,price_version,settled_minor,source_record_id,source_evidence_digest,terminal_outcome,occurred_at_ms,payload_digest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          scope.namespace,
          transaction.chargeId,
          reservationId,
          scope.organizationId,
          scope.projectId,
          scope.billingAccountId,
          row.instance_id,
          meterId,
          executionId,
          amount > 0 ? transaction.chargeId : null,
          transaction.ledgerSourceEventId,
          priceVersion,
          amount,
          outcome.evidence.sourceRecordId,
          outcome.evidence.sourceDigest,
          outcome.kind,
          occurredAtMs,
          payloadDigest,
        ),
    ];
    if (amount > 0) {
      if (!('resourceId' in transaction))
        throw new Error('Charged settlement requires ledger metadata');
      const debit = await createProductExecutionDebitD1Statements({
        runtime: this.billing,
        ctx: {
          orgId: scope.organizationId,
          actorUserId: `${authority.serviceId}-service-settlement`,
        },
        request: {
          amountMinor: amount,
          sourceEventId: transaction.ledgerSourceEventId,
          resourceId: transaction.resourceId,
          occurredAt: new Date(occurredAtMs).toISOString(),
          txOrExecutionRef: transaction.txOrExecutionRef,
          pricingVersion: priceVersion,
        },
        entryId: transaction.chargeId,
        occurredAtMs,
      });
      statements.push(
        debit.ledgerStatement,
        ...transaction.statements,
        ...debit.notificationStatements,
      );
    } else statements.push(...transaction.statements);
    statements.push(this.runtime.database.prepare('DELETE FROM billing_funds_transition_checks'));
    try {
      await this.runtime.database.batch(statements);
    } catch (error) {
      const concurrent = await queryD1One(
        this.runtime.database,
        'SELECT payload_digest FROM billing_funds_terminal_receipts WHERE namespace = ? AND reservation_id = ?',
        [scope.namespace, reservationId],
      );
      if (concurrent?.payload_digest === payloadDigest)
        return this.getReservation(authority, reservationId);
      const code = fundsError(error);
      if (code === null) throw error;
      return rejected(code);
    }
    return this.getReservation(authority, reservationId);
  }

  async markStaleIndeterminate(request: {
    readonly at: Date;
    readonly limit: number;
  }): Promise<readonly string[]> {
    const rows = await queryD1All(
      this.runtime.database,
      `SELECT id FROM billing_funds_reservations WHERE namespace = ? AND status = 'reserved' AND reconciliation_due_at_ms <= ? ORDER BY reconciliation_due_at_ms,id LIMIT ?`,
      [this.runtime.namespace, request.at.getTime(), request.limit],
    );
    const ids: string[] = [];
    for (const row of rows) {
      const id = textValue(row.id, 'id');
      await this.runtime.database
        .prepare(
          `UPDATE billing_funds_reservations SET status = 'indeterminate', indeterminate_operation_id = ?, indeterminate_digest = ?, updated_at_ms = ? WHERE namespace = ? AND id = ? AND status = 'reserved'`,
        )
        .bind(
          `reconcile-due:${id}`,
          `reconcile-due:${id}`,
          request.at.getTime(),
          this.runtime.namespace,
          id,
        )
        .run();
      ids.push(id);
    }
    return ids;
  }
}

export function getConsoleBillingPrepaidReservationD1Runtime(
  service: ConsoleBillingPrepaidReservationService | null | undefined,
): ConsoleBillingPrepaidReservationD1Runtime | null {
  return service instanceof D1ConsoleBillingPrepaidReservationService ? service.runtime : null;
}

export async function createD1ConsoleBillingPrepaidReservationService(
  options: D1ConsoleBillingPrepaidReservationServiceOptions,
): Promise<ConsoleBillingPrepaidReservationService> {
  if (options.ensureSchema !== false) await ensureBillingFundsD1Schema(options.database);
  return new D1ConsoleBillingPrepaidReservationService(options);
}
