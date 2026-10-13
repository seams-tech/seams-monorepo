import {
  PlatformScopeV1,
  PlatformUsageEventV1,
  ReleaseFundsRequestV1,
  ReconcileFundsRequestV1,
  SettleFundsRequestV1,
  type PlatformResult,
  type UsageRecordingResultV1,
  type WalletMonthlyResourceUsageV1,
  type ReservationResultV1,
} from '@seams-internal/console-shared/accountPlatform';
import {
  assertNever,
  integer,
  textValue,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import type { ServiceProducerAuthorityV1 } from '../accountPlatform/types';
import {
  queryD1One,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1Row,
} from '../boundary/d1';
import type { ConsoleBillingPrepaidReservationService } from '../billingPrepaidReservations/service';
import type { ExecutionChargeV1 } from '../billingPrepaidReservations/types';
import { fundsChargeId } from '../billingPrepaidReservations/d1';
import {
  billingCanonicalDigest,
  createWalletExecutionPriceVersionInsert,
  isRegisteredBillingPriceAvailable,
  SATYR_COMPLETED_TURN_TEST_PRICE_V1,
  TrustedWalletExecutionQuoteV1,
  WALLET_MONTHLY_ACTIVE_RESOURCE_PRICE_V1,
} from './pricing';
import { ensureBillingUsageD1Schema } from './usageSchema';
import {
  buildBillingUsageStatementId,
  createBillingLowBalanceD1Statements,
  getConsoleBillingD1Runtime,
  type ConsoleBillingD1Runtime,
} from './d1';
import type { ConsoleBillingService } from './service';

export type SatyrTestPricingPolicyV1 =
  | { readonly kind: 'disabled'; readonly organizationIds?: never }
  | { readonly kind: 'isolated_e2e'; readonly organizationIds: readonly string[] };

export interface D1BillingUsageServiceOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billing: ConsoleBillingService;
  readonly satyrTestPricing: SatyrTestPricingPolicyV1;
  readonly now?: () => Date;
}

interface BoundUsageInstance {
  readonly scope: PlatformScopeV1;
  readonly instanceId: string;
  readonly serviceId: 'wallet' | 'satyr';
}

interface AcceptedUsage {
  readonly authority: ServiceProducerAuthorityV1;
  readonly event: PlatformUsageEventV1;
  readonly instance: BoundUsageInstance;
  readonly payloadDigest: string;
  readonly priceVersion: string;
}

interface PrepaidUsage extends AcceptedUsage {
  readonly executionId: string;
  readonly reservationId: string;
  readonly amountMinor: number;
  readonly sourceRecordId: string;
  readonly sourceDigest: string;
  readonly chargeId: string;
  readonly ledgerSourceEventId: string;
  readonly resourceId: string;
  readonly txOrExecutionRef: string | null;
  readonly outcome: 'settled' | 'released';
}

function now(): Date {
  return new Date();
}
function rejected(
  code: Extract<UsageRecordingResultV1, { kind: 'rejected' }>['error']['code'],
): UsageRecordingResultV1 {
  return { kind: 'rejected', error: { code } };
}
function requireParsed<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected')
    throw new Error(`Invalid billing record: ${JSON.stringify(result.error)}`);
  return result.value;
}

function parseReceipt(row: D1Row): UsageRecordingResultV1 {
  switch (row.outcome) {
    case 'charged':
      return {
        kind: 'accepted',
        value: {
          kind: 'charged',
          chargeId: textValue(row.charge_id, 'charge_id'),
          amountMinor: integer(row.amount_minor, 'amount_minor', 1),
          priceVersion: textValue(row.price_version, 'price_version'),
        },
      };
    case 'meter_already_counted':
    case 'nonbillable_outcome':
      return { kind: 'accepted', value: { kind: 'recorded_without_charge', reason: row.outcome } };
    default:
      throw new Error('Invalid persisted usage receipt outcome');
  }
}

function executionMatches(charge: ExecutionChargeV1, usage: PrepaidUsage): boolean {
  return (
    charge.instanceId === usage.instance.instanceId &&
    charge.executionId === usage.executionId &&
    charge.reservationId === usage.reservationId &&
    charge.meterId === usage.event.measure.meterId &&
    charge.priceVersion === usage.priceVersion &&
    charge.settledMinor === usage.amountMinor &&
    charge.sourceRecordId === usage.sourceRecordId &&
    charge.sourceEvidenceDigest === usage.sourceDigest &&
    charge.terminalOutcome === usage.outcome &&
    charge.occurredAt === usage.event.occurredAt
  );
}

export class D1BillingUsageService {
  private readonly database: D1DatabaseLike;
  private readonly namespace: string;
  private readonly funds: ConsoleBillingPrepaidReservationService;
  private readonly testAccounts: ReadonlySet<string>;
  private readonly clock: () => Date;
  private readonly billing: ConsoleBillingD1Runtime;

  constructor(options: D1BillingUsageServiceOptions) {
    this.database = options.database;
    this.namespace = textValue(options.namespace, 'namespace');
    this.funds = options.funds;
    const billing = getConsoleBillingD1Runtime(options.billing);
    if (!billing || billing.database !== options.database || billing.namespace !== this.namespace) {
      throw new Error(
        'Usage recording requires the billing service for its D1 database and namespace',
      );
    }
    this.billing = billing;
    this.clock = options.now ?? now;
    this.testAccounts = new Set(
      options.satyrTestPricing.kind === 'isolated_e2e'
        ? options.satyrTestPricing.organizationIds
        : [],
    );
  }

  async ensureSchema(): Promise<void> {
    await ensureBillingUsageD1Schema(this.database);
    for (const organizationId of this.testAccounts) {
      await this.database
        .prepare(
          'INSERT INTO billing_isolated_test_accounts (namespace, org_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
        )
        .bind(this.namespace, textValue(organizationId, 'organizationId'))
        .run();
    }
  }

  private async boundInstance(
    authority: ServiceProducerAuthorityV1,
    instanceId: string,
  ): Promise<BoundUsageInstance | null> {
    const row = await queryD1One(
      this.database,
      `SELECT i.* FROM platform_service_instances i
      WHERE i.namespace = ? AND i.id = ? AND i.service_id = ? AND i.deployment_id = ?
        AND EXISTS (SELECT 1 FROM platform_provision_receipts r JOIN platform_provision_operations o
          ON o.namespace = r.namespace AND o.id = r.operation_id
          WHERE o.namespace = i.namespace AND o.instance_id = i.id AND r.result = 'active' AND r.disposition = 'applied')
        AND ((i.service_id = 'wallet' AND EXISTS (SELECT 1 FROM wallet_service_bindings w WHERE w.namespace = i.namespace AND w.instance_id = i.id))
          OR (i.service_id = 'satyr' AND EXISTS (SELECT 1 FROM satyr_service_bindings s WHERE s.namespace = i.namespace AND s.instance_id = i.id)))`,
      [this.namespace, instanceId, authority.serviceId, authority.deploymentId],
    );
    if (!row) return null;
    const scope = requireParsed(
      PlatformScopeV1.parse({
        namespace: this.namespace,
        organizationId: row.org_id,
        projectId: row.project_id,
        billingAccountId: row.billing_account_id,
      }),
    );
    return { scope, instanceId, serviceId: authority.serviceId };
  }

  private async receipt(
    authority: ServiceProducerAuthorityV1,
    event: PlatformUsageEventV1,
    payloadDigest: string,
  ): Promise<UsageRecordingResultV1 | null> {
    const row = await queryD1One(
      this.database,
      `SELECT e.payload_digest, r.* FROM billing_usage_events e
      JOIN billing_usage_receipts r USING (namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
      WHERE e.namespace = ? AND e.producer_service_id = ? AND e.producer_deployment_id = ? AND e.instance_id = ? AND e.event_id = ?`,
      [
        this.namespace,
        authority.serviceId,
        authority.deploymentId,
        event.instanceId,
        event.eventId,
      ],
    );
    if (!row) return null;
    return row.payload_digest === payloadDigest ? parseReceipt(row) : rejected('event_conflict');
  }

  private eventInsert(usage: AcceptedUsage): D1PreparedStatementLike {
    return this.database
      .prepare(
        `INSERT INTO billing_usage_events
      (namespace, producer_service_id, producer_deployment_id, instance_id, event_id, payload_digest, payload_json, org_id, project_id, billing_account_id, meter_id, quantity, unit, occurred_at_ms, price_version, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, producer_service_id, producer_deployment_id, instance_id, event_id) DO NOTHING`,
      )
      .bind(
        this.namespace,
        usage.authority.serviceId,
        usage.authority.deploymentId,
        usage.event.instanceId,
        usage.event.eventId,
        usage.payloadDigest,
        JSON.stringify(usage.event.toJSON()),
        usage.instance.scope.organizationId,
        usage.instance.scope.projectId,
        usage.instance.scope.billingAccountId,
        usage.event.measure.meterId,
        usage.event.measure.quantity,
        usage.event.measure.unit,
        Date.parse(usage.event.occurredAt),
        usage.priceVersion,
        this.clock().getTime(),
      );
  }

  async registerWalletExecutionQuote(
    authority: ServiceProducerAuthorityV1,
    quote: TrustedWalletExecutionQuoteV1,
  ): Promise<
    PlatformResult<
      TrustedWalletExecutionQuoteV1,
      { readonly code: 'scope_forbidden' | 'event_conflict' }
    >
  > {
    if (
      authority.serviceId !== 'wallet' ||
      !(await this.boundInstance(authority, quote.instanceId))
    )
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    const digest = await billingCanonicalDigest(quote.toJSON());
    try {
      await this.database.batch([
        createWalletExecutionPriceVersionInsert(this.database, quote.quoteVersion),
        this.quoteInsert(quote, digest),
      ]);
    } catch (error) {
      if (String(error).includes('wallet_quote_conflict'))
        return { kind: 'rejected', error: { code: 'event_conflict' } };
      throw error;
    }
    return { kind: 'accepted', value: quote };
  }

  private quoteInsert(
    quote: TrustedWalletExecutionQuoteV1,
    digest: string,
  ): D1PreparedStatementLike {
    return this.database
      .prepare(
        `INSERT INTO billing_wallet_execution_quotes
      (namespace, instance_id, execution_id, quote_version, quoted_at_ms, amount_minor, source_record_id, source_digest, payload_digest, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(namespace, instance_id, execution_id) DO NOTHING`,
      )
      .bind(
        this.namespace,
        quote.instanceId,
        quote.executionId,
        quote.quoteVersion,
        Date.parse(quote.quotedAt),
        quote.amountMinor,
        quote.sourceRecordId,
        quote.sourceDigest,
        digest,
        JSON.stringify(quote.toJSON()),
      );
  }

  async prepareWalletExecutionCommit(
    authority: ServiceProducerAuthorityV1,
    quote: TrustedWalletExecutionQuoteV1,
    event: PlatformUsageEventV1,
  ): Promise<
    PlatformResult<
      { readonly statements: readonly D1PreparedStatementLike[] },
      { readonly code: 'scope_forbidden' | 'event_conflict' }
    >
  > {
    const instance = await this.boundInstance(authority, event.instanceId);
    if (!instance || authority.serviceId !== 'wallet')
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    const measure = event.measure;
    if (
      measure.meterId !== 'wallet.execution' ||
      event.instanceId !== quote.instanceId ||
      measure.evidence.executionId !== quote.executionId ||
      measure.evidence.quoteVersion !== quote.quoteVersion ||
      measure.evidence.quotedAt !== quote.quotedAt ||
      measure.evidence.sourceRecordId !== quote.sourceRecordId ||
      measure.evidence.sourceDigest !== quote.sourceDigest
    ) {
      return { kind: 'rejected', error: { code: 'event_conflict' } };
    }
    const usage: PrepaidUsage = {
      authority,
      event,
      instance,
      payloadDigest: await billingCanonicalDigest(event.toJSON()),
      priceVersion: quote.quoteVersion,
      executionId: quote.executionId,
      reservationId: measure.evidence.reservationId,
      amountMinor: quote.amountMinor,
      sourceRecordId: quote.sourceRecordId,
      sourceDigest: quote.sourceDigest,
      chargeId: fundsChargeId(measure.evidence.reservationId),
      ledgerSourceEventId: quote.ledgerSourceEventId,
      resourceId: quote.resourceId,
      txOrExecutionRef: quote.txOrExecutionRef,
      outcome: 'settled',
    };
    return {
      kind: 'accepted',
      value: {
        statements: [
          createWalletExecutionPriceVersionInsert(this.database, quote.quoteVersion),
          this.quoteInsert(quote, await billingCanonicalDigest(quote.toJSON())),
          this.eventInsert(usage),
          this.prepaidReceiptInsert(usage),
        ],
      },
    };
  }

  async record(
    authority: ServiceProducerAuthorityV1,
    event: PlatformUsageEventV1,
  ): Promise<UsageRecordingResultV1> {
    try {
      return await this.recordAccepted(authority, event);
    } catch (error) {
      if (
        String(error).includes('usage_event_conflict') ||
        String(error).includes('wallet_quote_conflict')
      )
        return rejected('event_conflict');
      if (String(error).includes('usage_scope_forbidden')) return rejected('scope_forbidden');
      throw error;
    }
  }

  private async recordAccepted(
    authority: ServiceProducerAuthorityV1,
    event: PlatformUsageEventV1,
  ): Promise<UsageRecordingResultV1> {
    const instance = await this.boundInstance(authority, event.instanceId);
    if (!instance) return rejected('scope_forbidden');
    const payloadDigest = await billingCanonicalDigest(event.toJSON());
    const existing = await this.receipt(authority, event, payloadDigest);
    if (existing) return existing;
    const meter = event.measure;
    switch (meter.meterId) {
      case 'wallet.monthly_active_resource':
        if (instance.serviceId !== 'wallet') return rejected('meter_unknown');
        return this.monthly(
          {
            authority,
            event,
            instance,
            payloadDigest,
            priceVersion: WALLET_MONTHLY_ACTIVE_RESOURCE_PRICE_V1.version,
          },
          meter,
        );
      case 'wallet.execution': {
        if (instance.serviceId !== 'wallet') return rejected('meter_unknown');
        const row = await queryD1One(
          this.database,
          'SELECT payload_json FROM billing_wallet_execution_quotes WHERE namespace = ? AND instance_id = ? AND execution_id = ?',
          [this.namespace, event.instanceId, meter.evidence.executionId],
        );
        if (!row || typeof row.payload_json !== 'string') return rejected('price_unavailable');
        const quote = requireParsed(
          TrustedWalletExecutionQuoteV1.parse(JSON.parse(row.payload_json)),
        );
        if (
          quote.quoteVersion !== meter.evidence.quoteVersion ||
          quote.quotedAt !== meter.evidence.quotedAt ||
          quote.sourceRecordId !== meter.evidence.sourceRecordId ||
          quote.sourceDigest !== meter.evidence.sourceDigest
        )
          return rejected('event_conflict');
        return this.prepaid({
          authority,
          event,
          instance,
          payloadDigest,
          priceVersion: quote.quoteVersion,
          executionId: quote.executionId,
          reservationId: meter.evidence.reservationId,
          amountMinor: quote.amountMinor,
          sourceRecordId: quote.sourceRecordId,
          sourceDigest: quote.sourceDigest,
          chargeId: fundsChargeId(meter.evidence.reservationId),
          ledgerSourceEventId: quote.ledgerSourceEventId,
          resourceId: quote.resourceId,
          txOrExecutionRef: quote.txOrExecutionRef,
          outcome: 'settled',
        });
      }
      case 'satyr.completed_turn.test': {
        if (instance.serviceId !== 'satyr') return rejected('meter_unknown');
        if (
          !(await isRegisteredBillingPriceAvailable({
            database: this.database,
            namespace: this.namespace,
            scope: instance.scope,
            meterId: meter.meterId,
            priceVersion: SATYR_COMPLETED_TURN_TEST_PRICE_V1.version,
            amountMinor: 1,
          }))
        )
          return rejected('price_unavailable');
        const executionId = JSON.stringify([meter.evidence.sessionId, meter.evidence.turnId]);
        return this.prepaid({
          authority,
          event,
          instance,
          payloadDigest,
          priceVersion: SATYR_COMPLETED_TURN_TEST_PRICE_V1.version,
          executionId,
          reservationId: meter.evidence.reservationId,
          amountMinor: meter.quantity * SATYR_COMPLETED_TURN_TEST_PRICE_V1.unitMinor,
          sourceRecordId: meter.evidence.sourceRecordId,
          sourceDigest: meter.evidence.sourceDigest,
          chargeId: fundsChargeId(meter.evidence.reservationId),
          ledgerSourceEventId: `satyr_turn:${event.instanceId}:${executionId}`,
          resourceId: executionId,
          txOrExecutionRef: null,
          outcome: meter.quantity === 0 ? 'released' : 'settled',
        });
      }
      default:
        return assertNever(meter);
    }
  }

  private async monthly(
    usage: AcceptedUsage,
    measure: WalletMonthlyResourceUsageV1,
  ): Promise<UsageRecordingResultV1> {
    const monthUtc = usage.event.occurredAt.slice(0, 7);
    const entryId = `usage_monthly:${await billingCanonicalDigest([this.namespace, usage.instance.scope.organizationId, monthUtc, measure.evidence.resourceId])}`;
    const originId = `usage_origin:${await billingCanonicalDigest([usage.authority, usage.event.instanceId, usage.event.eventId])}`;
    const notificationStatements = await createBillingLowBalanceD1Statements({
      runtime: this.billing,
      orgId: usage.instance.scope.organizationId,
      ledgerEntryId: entryId,
      ledgerSourceEventId: originId,
      createdAtMs: Date.parse(usage.event.occurredAt),
    });
    try {
      await this.database.batch([
        this.eventInsert(usage),
        this.database
          .prepare(
            `INSERT INTO billing_monthly_active_resources (namespace, org_id, month_utc, resource_id, source_event_id, created_at_ms)
          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(namespace, org_id, month_utc, resource_id) DO NOTHING`,
          )
          .bind(
            this.namespace,
            usage.instance.scope.organizationId,
            monthUtc,
            measure.evidence.resourceId,
            originId,
            Date.parse(usage.event.occurredAt),
          ),
        this.database
          .prepare(
            `INSERT INTO billing_ledger_entries
          (namespace, org_id, id, entry_type, amount_minor, currency, description, month_utc, related_invoice_id, related_purchase_id, source_event_id, actor_type, actor_user_id, reason_code, note, idempotency_key, created_at_ms)
          SELECT ?, ?, ?, 'USAGE_DEBIT', ?, 'USD', ?, ?, ?, NULL, ?, 'SYSTEM', ?, 'usage_debit', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM billing_monthly_active_resources WHERE namespace = ? AND org_id = ? AND month_utc = ? AND resource_id = ? AND source_event_id = ?)
          ON CONFLICT DO NOTHING`,
          )
          .bind(
            this.namespace,
            usage.instance.scope.organizationId,
            entryId,
            -WALLET_MONTHLY_ACTIVE_RESOURCE_PRICE_V1.unitMinor,
            `Active-resource usage debit for ${measure.evidence.resourceId}`,
            monthUtc,
            buildBillingUsageStatementId(usage.instance.scope.organizationId, monthUtc),
            originId,
            `service:${usage.authority.serviceId}:${usage.authority.deploymentId}`,
            `Price ${usage.priceVersion}`,
            originId,
            Date.parse(usage.event.occurredAt),
            this.namespace,
            usage.instance.scope.organizationId,
            monthUtc,
            measure.evidence.resourceId,
            originId,
          ),
        ...notificationStatements,
        this.database
          .prepare(
            `INSERT INTO billing_usage_receipts (namespace, producer_service_id, producer_deployment_id, instance_id, event_id, org_id, outcome, charge_id, ledger_entry_id, amount_minor, price_version)
          SELECT ?, ?, ?, ?, ?, ?, CASE WHEN l.id IS NULL THEN 'meter_already_counted' ELSE 'charged' END, l.id, l.id, COALESCE(-l.amount_minor, 0), ?
          FROM (SELECT 1) LEFT JOIN billing_ledger_entries l ON l.namespace = ? AND l.org_id = ? AND l.id = ? AND l.source_event_id = ?
          ON CONFLICT(namespace, producer_service_id, producer_deployment_id, instance_id, event_id) DO NOTHING`,
          )
          .bind(
            this.namespace,
            usage.authority.serviceId,
            usage.authority.deploymentId,
            usage.event.instanceId,
            usage.event.eventId,
            usage.instance.scope.organizationId,
            usage.priceVersion,
            this.namespace,
            usage.instance.scope.organizationId,
            entryId,
            originId,
          ),
      ]);
    } catch (error) {
      if (String(error).includes('usage_event_conflict')) return rejected('event_conflict');
      if (String(error).includes('usage_scope_forbidden')) return rejected('scope_forbidden');
      throw error;
    }
    const receipt = await this.receipt(usage.authority, usage.event, usage.payloadDigest);
    if (!receipt) throw new Error('Usage transaction committed without its receipt');
    return receipt;
  }

  private prepaidReceiptInsert(usage: PrepaidUsage): D1PreparedStatementLike {
    return this.database
      .prepare(
        `INSERT INTO billing_usage_receipts (namespace, producer_service_id, producer_deployment_id, instance_id, event_id, org_id, outcome, charge_id, ledger_entry_id, amount_minor, price_version)
      SELECT ?, ?, ?, ?, ?, ?, CASE WHEN c.ledger_entry_id IS NULL THEN 'nonbillable_outcome' ELSE 'charged' END, CASE WHEN c.ledger_entry_id IS NULL THEN NULL ELSE c.charge_id END, c.ledger_entry_id, c.settled_minor, c.price_version
      FROM billing_execution_charges c WHERE c.namespace = ? AND c.instance_id = ? AND c.execution_id = ? AND c.meter_id = ?
        AND c.reservation_id = ? AND c.price_version = ? AND c.settled_minor = ? AND c.source_record_id = ? AND c.source_evidence_digest = ? AND c.terminal_outcome = ? AND c.occurred_at_ms = ?
      ON CONFLICT(namespace, producer_service_id, producer_deployment_id, instance_id, event_id) DO NOTHING`,
      )
      .bind(
        this.namespace,
        usage.authority.serviceId,
        usage.authority.deploymentId,
        usage.event.instanceId,
        usage.event.eventId,
        usage.instance.scope.organizationId,
        this.namespace,
        usage.event.instanceId,
        usage.executionId,
        usage.event.measure.meterId,
        usage.reservationId,
        usage.priceVersion,
        usage.amountMinor,
        usage.sourceRecordId,
        usage.sourceDigest,
        usage.outcome,
        Date.parse(usage.event.occurredAt),
      );
  }

  private async finalizePrepaid(
    usage: PrepaidUsage,
    statements: readonly D1PreparedStatementLike[],
  ): Promise<ReservationResultV1> {
    const reservation = await this.funds.getReservation(usage.authority, usage.reservationId);
    if (reservation.kind === 'rejected') return reservation;
    const proof = { sourceRecordId: usage.sourceRecordId, sourceDigest: usage.sourceDigest };
    const transaction = {
      chargeId: usage.chargeId,
      ledgerSourceEventId: usage.ledgerSourceEventId,
      occurredAt: usage.event.occurredAt,
      resourceId: usage.resourceId,
      txOrExecutionRef: usage.txOrExecutionRef,
      statements,
    };
    if (reservation.value.kind === 'indeterminate') {
      const outcome =
        usage.outcome === 'released'
          ? { kind: 'no_charge', noChargeEvidence: proof }
          : {
              kind: 'charged',
              settledMinor: usage.amountMinor,
              priceVersion: usage.priceVersion,
              evidence: proof,
            };
      return this.funds.reconcile(
        usage.authority,
        requireParsed(
          ReconcileFundsRequestV1.parse({
            version: 1,
            operationId: `usage_reconcile:${usage.event.instanceId}:${usage.executionId}`,
            reservationId: usage.reservationId,
            executionId: usage.executionId,
            outcome,
          }),
        ),
        transaction,
      );
    }
    if (usage.outcome === 'released') {
      return this.funds.release(
        usage.authority,
        requireParsed(
          ReleaseFundsRequestV1.parse({
            version: 1,
            operationId: `usage_release:${usage.event.instanceId}:${usage.executionId}`,
            reservationId: usage.reservationId,
            executionId: usage.executionId,
            noChargeEvidence: proof,
          }),
        ),
        transaction,
      );
    }
    return this.funds.settle(
      usage.authority,
      requireParsed(
        SettleFundsRequestV1.parse({
          version: 1,
          operationId: `usage_settle:${usage.event.instanceId}:${usage.executionId}`,
          reservationId: usage.reservationId,
          executionId: usage.executionId,
          settledMinor: usage.amountMinor,
          priceVersion: usage.priceVersion,
          evidence: proof,
        }),
      ),
      transaction,
    );
  }

  private async prepaid(usage: PrepaidUsage): Promise<UsageRecordingResultV1> {
    const existing = await this.funds.getExecutionCharge(usage.authority, {
      instanceId: usage.event.instanceId,
      executionId: usage.executionId,
    });
    const statements = [this.eventInsert(usage), this.prepaidReceiptInsert(usage)];
    if (existing) {
      if (!executionMatches(existing, usage)) return rejected('event_conflict');
      await this.database.batch(statements);
    } else {
      const result = await this.finalizePrepaid(usage, statements);
      if (result.kind === 'rejected') {
        if (result.error.code === 'execution_unreconciled')
          throw new Error(
            'Usage reconciliation must retry after a concurrent reservation state change',
          );
        if (result.error.code === 'price_unavailable') return rejected('price_unavailable');
        return rejected(
          result.error.code === 'scope_forbidden' ? 'scope_forbidden' : 'event_conflict',
        );
      }
      // Another terminal delivery can win before this call. Its matching receipt remains authoritative.
      if (!(await this.receipt(usage.authority, usage.event, usage.payloadDigest))) {
        const charge = await this.funds.getExecutionCharge(usage.authority, {
          instanceId: usage.event.instanceId,
          executionId: usage.executionId,
        });
        if (!charge || !executionMatches(charge, usage)) return rejected('event_conflict');
        await this.database.batch(statements);
      }
    }
    const receipt = await this.receipt(usage.authority, usage.event, usage.payloadDigest);
    if (!receipt) throw new Error('Prepaid usage transaction committed without its receipt');
    return receipt;
  }
}
