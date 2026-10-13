import {
  PlatformUsageEventV1,
  type PlatformContractError,
  type PlatformResult,
  type UsageRecordingResultV1,
} from '@seams-internal/console-shared/accountPlatform';
import {
  contractResult,
  integer,
  invalidContract,
  object,
  textValue,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import type { D1AccountPlatformService } from '@seams-internal/console-server/accountPlatform/d1';
import type { ServiceProducerAuthorityV1 } from '@seams-internal/console-server/accountPlatform/types';
import type { D1BillingUsageService } from '@seams-internal/console-server/billing/usage';
import {
  formatD1ExecStatement,
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
} from '@seams-internal/console-server/boundary/d1';
import type { WalletActivityExclusion, WalletBillingActivityV1 } from './activity';

type AcceptedUsage = Extract<UsageRecordingResultV1, { readonly kind: 'accepted' }>['value'];
type UsageError = Extract<UsageRecordingResultV1, { readonly kind: 'rejected' }>['error'];

export type WalletMonthlyUsageResult = PlatformResult<
  AcceptedUsage | { readonly kind: 'ignored'; readonly reason: WalletActivityExclusion },
  UsageError | { readonly code: 'source_not_accepted' }
>;

export interface WalletMonthlyUsageOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly deploymentId: string;
  readonly platform: Pick<D1AccountPlatformService, 'resolveWalletBinding'>;
  readonly usage: Pick<D1BillingUsageService, 'record'>;
}

interface AcceptedWalletExecution {
  readonly id: string;
  readonly environmentId: string;
  readonly walletId: string;
  readonly executionReference: string;
  readonly occurredAt: string;
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
    payload_digest TEXT NOT NULL,
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'delivered')),
    PRIMARY KEY (namespace, deployment_id, event_id),
    UNIQUE (namespace, deployment_id, native_org_id, source_record_id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS wallet_monthly_usage_outbox_immutable
    BEFORE UPDATE OF namespace, deployment_id, event_id, native_org_id, source_record_id,
      instance_id, payload_json, payload_digest ON wallet_monthly_usage_outbox
    BEGIN SELECT RAISE(ABORT, 'wallet_monthly_usage_fact_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS wallet_monthly_usage_outbox_retained
    BEFORE DELETE ON wallet_monthly_usage_outbox
    BEGIN SELECT RAISE(ABORT, 'wallet_monthly_usage_fact_retained'); END`,
]);

function readAcceptedExecution(input: unknown): AcceptedWalletExecution {
  const row = object(input, 'acceptedWalletExecution');
  if (
    row.receipt_status !== 'success' ||
    row.chain_family !== 'evm' ||
    row.intent_kind !== 'evm_call'
  ) {
    return invalidContract('receipt_status');
  }
  const details = object(JSON.parse(textValue(row.details_json, 'details_json')), 'details');
  return Object.freeze({
    id: textValue(row.id, 'id'),
    environmentId: textValue(row.environment_id, 'environment_id'),
    walletId: textValue(details.walletId, 'walletId'),
    executionReference: textValue(row.tx_or_execution_ref, 'tx_or_execution_ref'),
    occurredAt: new Date(integer(row.created_at_ms, 'created_at_ms', 1)).toISOString(),
  });
}

function parseAcceptedExecution(
  input: unknown,
): PlatformResult<AcceptedWalletExecution, PlatformContractError> {
  return contractResult(readAcceptedExecution, input);
}

function hexByte(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(hexByte).join('');
}

function rejected(
  code: 'scope_forbidden' | 'source_not_accepted' | 'event_conflict',
): WalletMonthlyUsageResult {
  return { kind: 'rejected', error: { code } };
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

  async recordAcceptedActivity(
    activity: WalletBillingActivityV1,
  ): Promise<WalletMonthlyUsageResult> {
    if (activity.decision.kind === 'excluded') {
      return { kind: 'accepted', value: { kind: 'ignored', reason: activity.decision.reason } };
    }
    const source = await queryD1One(
      this.options.database,
      `SELECT id, environment_id, receipt_status, chain_family, intent_kind, details_json,
        tx_or_execution_ref, created_at_ms FROM sponsored_call_records
       WHERE namespace = ? AND org_id = ? AND id = ?`,
      [this.options.namespace, activity.nativeOrganizationId, activity.sourceRecordId],
    );
    if (!source) return rejected('source_not_accepted');
    const execution = parseAcceptedExecution(source);
    if (execution.kind === 'rejected') return rejected('source_not_accepted');
    const wallet = await queryD1One(
      this.options.database,
      `SELECT w.project_id FROM wallet_index w
       JOIN environments e ON e.namespace = w.namespace AND e.org_id = w.org_id
         AND e.project_id = w.project_id AND e.id = w.environment_id
       WHERE w.namespace = ? AND w.org_id = ? AND w.environment_id = ? AND w.id = ?`,
      [
        this.options.namespace,
        activity.nativeOrganizationId,
        execution.value.environmentId,
        execution.value.walletId,
      ],
    );
    if (!wallet || typeof wallet.project_id !== 'string') return rejected('scope_forbidden');
    const binding = await this.options.platform.resolveWalletBinding(this.authority, {
      namespace: this.options.namespace,
      nativeOrganizationId: activity.nativeOrganizationId,
      nativeProjectId: wallet.project_id,
    });
    if (binding.kind === 'rejected') return rejected('scope_forbidden');
    const eventId = JSON.stringify([
      'wallet_resource',
      this.options.deploymentId,
      activity.nativeOrganizationId,
      execution.value.id,
    ]);
    const sourceDigest = await digest(
      JSON.stringify([
        'accepted_evm_wallet_action',
        this.options.namespace,
        this.options.deploymentId,
        activity.nativeOrganizationId,
        wallet.project_id,
        execution.value.environmentId,
        execution.value.walletId,
        execution.value.id,
        execution.value.executionReference,
        execution.value.occurredAt,
        activity.decision.action,
      ]),
    );
    const event = PlatformUsageEventV1.parse({
      version: 1,
      eventId,
      instanceId: binding.value.instanceId,
      occurredAt: execution.value.occurredAt,
      meterId: 'wallet.monthly_active_resource',
      quantity: 1,
      unit: 'resource_month',
      evidence: {
        kind: 'wallet_resource',
        sourceRecordId: execution.value.id,
        sourceDigest,
        environmentId: execution.value.environmentId,
        resourceId: execution.value.walletId,
      },
    });
    if (event.kind === 'rejected')
      throw new Error('Accepted Wallet activity produced an invalid usage event');
    const payload = JSON.stringify(event.value);
    const payloadDigest = await digest(payload);
    await this.options.database
      .prepare(
        `INSERT INTO wallet_monthly_usage_outbox
        (namespace, deployment_id, event_id, native_org_id, source_record_id, instance_id,
          payload_json, payload_digest, delivery_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending') ON CONFLICT DO NOTHING`,
      )
      .bind(
        this.options.namespace,
        this.options.deploymentId,
        eventId,
        activity.nativeOrganizationId,
        execution.value.id,
        binding.value.instanceId,
        payload,
        payloadDigest,
      )
      .run();
    const retained = await queryD1One(
      this.options.database,
      `SELECT payload_digest FROM wallet_monthly_usage_outbox
       WHERE namespace = ? AND deployment_id = ? AND event_id = ?`,
      [this.options.namespace, this.options.deploymentId, eventId],
    );
    if (!retained || retained.payload_digest !== payloadDigest) return rejected('event_conflict');
    return await this.deliver(event.value);
  }

  async resumePending(
    limit: number,
  ): Promise<{ readonly delivered: number; readonly pending: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Wallet usage delivery limit must be between 1 and 100');
    const rows = await queryD1All(
      this.options.database,
      `SELECT payload_json, payload_digest FROM wallet_monthly_usage_outbox
       WHERE namespace = ? AND deployment_id = ? AND delivery_status = 'pending'
       ORDER BY event_id LIMIT ?`,
      [this.options.namespace, this.options.deploymentId, limit],
    );
    let delivered = 0;
    let pending = 0;
    for (const row of rows) {
      const payload = textValue(row.payload_json, 'payload_json');
      if ((await digest(payload)) !== row.payload_digest) {
        throw new Error('Persisted Wallet usage digest does not match its payload');
      }
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
