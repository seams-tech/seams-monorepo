import {
  PlatformUsageEventV1,
  type UsageRecordingResultV1,
} from '@seams-internal/console-shared/accountPlatform';
import { textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import type { ServiceProducerAuthorityV1 } from '@seams-internal/console-server/accountPlatform/types';
import type { D1BillingUsageService } from '@seams-internal/console-server/billing/usage';
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
      const payload = textValue(row.payload_json, 'payload_json');
      const event = PlatformUsageEventV1.parse(JSON.parse(payload));
      if (event.kind === 'rejected') throw new Error('Invalid persisted Wallet usage event');
      const outcome = await this.deliver(event.value);
      if (outcome.kind === 'accepted') delivered += 1;
      else pending += 1;
    }
    return { delivered, pending };
  }

  private async deliver(event: PlatformUsageEventV1): Promise<UsageRecordingResultV1> {
    const outcome = await this.options.usage.record(this.authority, event);
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
