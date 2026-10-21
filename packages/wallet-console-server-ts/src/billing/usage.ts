import {
  PlatformPlanUsageEventV1,
  PlatformUsageEventV1,
  type PlanUsageRecordingResultV1,
  type UsageRecordingResultV1,
} from '@seams-internal/console-shared/accountPlatform';
import { textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import type { ServiceProducerAuthorityV1 } from '@seams-internal/console-server/accountPlatform/types';
import type { D1BillingUsageService } from '@seams-internal/console-server/billing/usage';
import type { D1FreePlanService } from '@seams-internal/console-server/billing/freePlanD1';
import {
  formatD1ExecStatement,
  queryD1All,
  type D1DatabaseLike,
} from '@seams-internal/console-server/boundary/d1';

export interface WalletMonthlyUsageOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly deploymentId: string;
  readonly usage: Pick<D1BillingUsageService, 'record'>;
  readonly planUsage: Pick<D1FreePlanService, 'recordProductionUsage'>;
}

export const WALLET_MONTHLY_USAGE_D1_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wallet_monthly_usage_outbox (
    namespace TEXT NOT NULL,
    deployment_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    native_org_id TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'delivered')),
    PRIMARY KEY (namespace, deployment_id, event_id),
    UNIQUE (namespace, deployment_id, native_org_id, source_record_id)
  )`,
  `CREATE INDEX IF NOT EXISTS wallet_monthly_usage_pending ON wallet_monthly_usage_outbox
    (namespace, deployment_id, event_id) WHERE delivery_status = 'pending'`,
  `CREATE TRIGGER IF NOT EXISTS wallet_monthly_usage_outbox_immutable
    BEFORE UPDATE OF namespace, deployment_id, event_id, native_org_id, source_record_id,
      instance_id, payload_json ON wallet_monthly_usage_outbox
    BEGIN SELECT RAISE(ABORT, 'wallet_monthly_usage_fact_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS wallet_monthly_usage_outbox_retained
    BEFORE DELETE ON wallet_monthly_usage_outbox
    BEGIN SELECT RAISE(ABORT, 'wallet_monthly_usage_fact_retained'); END`,
]);

/** Append this statement to the transaction that persists the successful execution. */
export function createWalletMonthlyUsageStatement(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly deploymentId: string;
  readonly organizationId: string;
  readonly instanceId: string;
  readonly sourceRecordId: string;
  readonly sourceDigest: string;
  readonly environmentId: string;
  readonly walletId: string;
  readonly occurredAt: string;
}) {
  const parsed = PlatformUsageEventV1.parse({
    version: 1,
    eventId: JSON.stringify([
      'wallet_resource',
      input.deploymentId,
      input.organizationId,
      input.sourceRecordId,
    ]),
    instanceId: input.instanceId,
    occurredAt: input.occurredAt,
    meterId: 'wallet.monthly_active_resource',
    quantity: 1,
    unit: 'resource_month',
    evidence: {
      kind: 'wallet_resource',
      sourceRecordId: input.sourceRecordId,
      sourceDigest: input.sourceDigest,
      environmentId: input.environmentId,
      resourceId: input.walletId,
    },
  });
  if (parsed.kind === 'rejected') throw new Error('Invalid accepted Wallet monthly usage fact');
  const payload = JSON.stringify(parsed.value);
  return input.database
    .prepare(
      `INSERT INTO wallet_monthly_usage_outbox
    (namespace, deployment_id, event_id, native_org_id, source_record_id, instance_id, payload_json, delivery_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .bind(
      input.namespace,
      input.deploymentId,
      parsed.value.eventId,
      input.organizationId,
      input.sourceRecordId,
      input.instanceId,
      payload,
    );
}

function monthUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/**
 * Append to the batch that records a wallet's activity (registration completion or a
 * session publication). It writes one fact per wallet and UTC month, and only for an
 * established wallet in a production environment; other environments write nothing.
 */
export function createWalletProductionActivityStatement(input: {
  readonly database: D1DatabaseLike;
  readonly deploymentId: string;
  readonly wallet: {
    readonly namespace: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly environmentId: string;
    readonly walletId: string;
  };
  readonly nowMs: number;
}) {
  const wallet = input.wallet;
  const month = monthUtc(input.nowMs);
  const eventId = JSON.stringify([
    'wallet_production_active_user',
    input.deploymentId,
    wallet.organizationId,
    wallet.environmentId,
    wallet.walletId,
    month,
  ]);
  return input.database
    .prepare(
      `INSERT INTO wallet_monthly_usage_outbox
        (namespace, deployment_id, event_id, native_org_id, source_record_id, instance_id,
          payload_json, delivery_status)
       SELECT ?1, b.deployment_id, ?7, ?2, ?8, b.instance_id,
         json_object('version', 1, 'kind', 'plan_usage', 'eventId', ?7,
           'instanceId', b.instance_id, 'occurredAt', ?9,
           'measure', json_object('kind', 'production_active_user', 'environmentId', ?4,
             'userKey', ?5)),
         'pending'
       FROM wallet_homes h
       JOIN environments e ON e.namespace = h.namespace AND e.org_id = h.organization_id
         AND e.project_id = h.project_id AND e.id = h.environment_id
       JOIN wallet_service_bindings b ON b.native_namespace = h.namespace
         AND b.native_org_id = h.organization_id AND b.native_project_id = h.project_id
       WHERE h.namespace = ?1 AND h.organization_id = ?2 AND h.project_id = ?3
         AND h.environment_id = ?4 AND h.wallet_id = ?5 AND h.state = 'established'
         AND e.env_key = 'prod' AND b.deployment_id = ?6
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      wallet.namespace,
      wallet.organizationId,
      wallet.projectId,
      wallet.environmentId,
      wallet.walletId,
      input.deploymentId,
      eventId,
      `production_active_user:${month}:${wallet.environmentId}:${wallet.walletId}`,
      new Date(input.nowMs).toISOString(),
    );
}

/**
 * One fact for a signature that a production Gateway reported as completed. The fact
 * key is the signing operation, so a repeated delivery writes nothing. A deployment
 * whose environment is not prod writes nothing.
 */
export function createWalletProductionSignatureStatement(input: {
  readonly database: D1DatabaseLike;
  readonly deploymentId: string;
  readonly tenant: {
    readonly namespace: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly environmentId: string;
  };
  readonly signatureId: string;
  readonly completedAtMs: number;
}) {
  const tenant = input.tenant;
  const eventId = JSON.stringify([
    'wallet_production_signature',
    input.deploymentId,
    tenant.organizationId,
    tenant.environmentId,
    input.signatureId,
  ]);
  return input.database
    .prepare(
      `INSERT INTO wallet_monthly_usage_outbox
        (namespace, deployment_id, event_id, native_org_id, source_record_id, instance_id,
          payload_json, delivery_status)
       SELECT ?1, b.deployment_id, ?6, ?2, ?7, b.instance_id,
         json_object('version', 1, 'kind', 'plan_usage', 'eventId', ?6,
           'instanceId', b.instance_id, 'occurredAt', ?8,
           'measure', json_object('kind', 'production_signature', 'environmentId', ?4,
             'signatureId', ?9)),
         'pending'
       FROM wallet_service_bindings b
       JOIN environments e ON e.namespace = b.native_namespace AND e.org_id = b.native_org_id
         AND e.project_id = b.native_project_id AND e.id = ?4
       WHERE b.native_namespace = ?1 AND b.native_org_id = ?2 AND b.native_project_id = ?3
         AND b.deployment_id = ?5 AND e.env_key = 'prod'
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      tenant.namespace,
      tenant.organizationId,
      tenant.projectId,
      tenant.environmentId,
      input.deploymentId,
      eventId,
      `production_signature:${input.signatureId}`,
      new Date(input.completedAtMs).toISOString(),
      input.signatureId,
    );
}

type WalletOutboxEvent =
  | { readonly kind: 'usage'; readonly event: PlatformUsageEventV1 }
  | { readonly kind: 'plan_usage'; readonly event: PlatformPlanUsageEventV1 };

function parseOutboxPayload(payload: string): WalletOutboxEvent {
  const raw: unknown = JSON.parse(payload);
  if (raw && typeof raw === 'object' && 'kind' in raw && raw.kind === 'plan_usage') {
    const event = PlatformPlanUsageEventV1.parse(raw);
    if (event.kind === 'rejected') throw new Error('Invalid persisted Wallet plan usage event');
    return { kind: 'plan_usage', event: event.value };
  }
  const event = PlatformUsageEventV1.parse(raw);
  if (event.kind === 'rejected') throw new Error('Invalid persisted Wallet usage event');
  return { kind: 'usage', event: event.value };
}

/** The service selects billable facts. Shared billing applies the registered price. */
export class WalletMonthlyUsageAdapter {
  readonly authority: ServiceProducerAuthorityV1;

  constructor(private readonly options: WalletMonthlyUsageOptions) {
    this.authority = Object.freeze({ serviceId: 'wallet', deploymentId: options.deploymentId });
  }

  async ensureSchema(): Promise<void> {
    for (const sql of WALLET_MONTHLY_USAGE_D1_SCHEMA_SQL) {
      await this.options.database.exec(formatD1ExecStatement(sql));
    }
  }

  async resumePending(
    limit: number,
  ): Promise<{ readonly delivered: number; readonly pending: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Wallet usage delivery limit must be between 1 and 100');
    const rows = await queryD1All(
      this.options.database,
      `SELECT payload_json FROM wallet_monthly_usage_outbox
       WHERE namespace = ? AND deployment_id = ? AND delivery_status = 'pending'
       ORDER BY event_id LIMIT ?`,
      [this.options.namespace, this.options.deploymentId, limit],
    );
    let delivered = 0;
    let pending = 0;
    for (const row of rows) {
      const event = parseOutboxPayload(textValue(row.payload_json, 'payload_json'));
      const outcome = await this.deliver(event);
      if (outcome.kind === 'accepted') delivered += 1;
      else pending += 1;
    }
    return { delivered, pending };
  }

  private async deliver(
    outbox: WalletOutboxEvent,
  ): Promise<UsageRecordingResultV1 | PlanUsageRecordingResultV1> {
    const event = outbox.event;
    const outcome =
      outbox.kind === 'plan_usage'
        ? await this.options.planUsage.recordProductionUsage(this.authority, outbox.event)
        : await this.options.usage.record(this.authority, outbox.event);
    if (outcome.kind === 'accepted') {
      await this.options.database
        .prepare(
          `UPDATE wallet_monthly_usage_outbox SET delivery_status = 'delivered'
         WHERE namespace = ? AND deployment_id = ? AND event_id = ?`,
        )
        .bind(this.options.namespace, this.options.deploymentId, event.eventId)
        .run();
    }
    return outcome;
  }
}
