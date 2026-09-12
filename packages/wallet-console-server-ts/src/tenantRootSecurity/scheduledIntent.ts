import {
  buildTenantRootOperationRecordV1,
  canonicalTenantRootOperationRecordJsonV1,
  tenantRootOperationDigestB64uV1,
  tenantRootOperationMaxLifetimeMsV1,
  type TenantRootOperationRecordV1,
} from '@seams-internal/shared-ts/tenant-root';
import {
  decodeTenantRootIdentityWireV1,
  type TenantRootIdentityV1,
} from '@seams-internal/shared-ts/tenant-root';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import type { TenantRootSecurityStateReaderV1 } from './consoleRoute';
import type {
  TenantRootOperationEntryV1,
  TenantRootOperationStoreV1,
  TenantRootPendingOperationV1,
} from './service';
import type { D1DatabaseLike, D1Row } from '@seams/wallet-server/cloud-host';

/** The only operation kind a background schedule can create. */
export const TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1 =
  'tenant_root_operational_share_rotation_v1' as const;

/** Stable identity for the server-owned scheduler actor. */
export const TENANT_ROOT_SCHEDULED_ROTATION_REQUESTER_V1 =
  'system_tenant_root_scheduler_v1' as const;

const SCHEDULED_ROTATION_IDEMPOTENCY_PREFIX_V1 = 'tenant-root-scheduled-rotation-v1';
const PENDING_OPERATION_SCAN_LIMIT_V1 = 1000;

/** The active grant fields needed to bind a scheduled operation. */
export type TenantRootScheduledActiveGrantV1 = {
  readonly identity: TenantRootIdentityV1;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly rootCommitmentB64u: string;
};

/** Reads the public scope of active created and restored tenant roots. */
export interface TenantRootScheduledActiveGrantReaderV1 {
  listActive(): Promise<readonly TenantRootScheduledActiveGrantV1[]>;
}

/** The narrow operation port used before the common dispatcher takes over. */
export type TenantRootScheduledOperationStoreV1 = Pick<
  TenantRootOperationStoreV1,
  'findByIdempotencyKey' | 'consumeApprovalAndCreateOperation'
>;

/** Reads the pending outbox rows used to resume an unknown scheduled attempt. */
export interface TenantRootScheduledPendingOperationReaderV1 {
  listPending(limit: number): Promise<readonly TenantRootPendingOperationV1[]>;
}

/** Dependencies for one bounded scheduler tick. */
export interface TenantRootScheduledIntentDependenciesV1 {
  readonly grants: TenantRootScheduledActiveGrantReaderV1;
  readonly state: Pick<TenantRootSecurityStateReaderV1, 'readStatus'>;
  readonly pending: TenantRootScheduledPendingOperationReaderV1;
  readonly operations: (scope: {
    readonly orgId: string;
    readonly identityDigestB64u: string;
    readonly custodyLineageB64u: string;
  }) => TenantRootScheduledOperationStoreV1;
  /** Injectable only for deterministic tests and local harnesses. */
  readonly newOperationId?: () => string;
  /** Injectable only for deterministic tests and local harnesses. */
  readonly newNonceB64u?: () => string;
}

/** Result of one bounded tick. */
export type TenantRootScheduledIntentResultV1 =
  | { readonly kind: 'no_active_tenant' }
  | {
      readonly kind: 'not_due';
      readonly identityDigestB64u: string;
      readonly nextScheduledRotationAtMs: number | null;
    }
  | {
      readonly kind: 'retry';
      readonly operation: TenantRootPendingOperationV1;
      readonly reason: 'pending' | 'dispatch_uncertain';
    }
  | {
      readonly kind: 'already_settled';
      readonly operation: TenantRootPendingOperationV1;
    }
  | {
      readonly kind: 'created';
      readonly operation: TenantRootPendingOperationV1;
    };

type ScheduledStateV1 = {
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly rootCommitmentB64u: string;
  readonly lifecycleRevision: number;
  readonly activeEpoch: number;
  readonly nextScheduledRotationAtMs: number | null;
  readonly governanceDigestB64u: string;
};

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return parsed;
}

function canonicalTimestampMs(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} is not a canonical timestamp`);
  }
  return parsed;
}

function parseNextScheduledRotationAtMs(value: string | null): number | null {
  return value === null ? null : canonicalTimestampMs(value, 'next scheduled rotation time');
}

function parseScheduledState(
  grant: TenantRootScheduledActiveGrantV1,
  state: Awaited<ReturnType<TenantRootSecurityStateReaderV1['readStatus']>>,
): ScheduledStateV1 {
  const identityDigestB64u = requiredText(state.identityDigestB64u, 'state identity digest');
  const custodyLineageB64u = requiredText(state.custodyLineageB64u, 'state custody lineage');
  const rootCommitmentB64u = requiredText(state.rootCommitmentB64u, 'state root commitment');
  if (
    identityDigestB64u !== grant.identityDigestB64u ||
    custodyLineageB64u !== grant.custodyLineageB64u ||
    rootCommitmentB64u !== grant.rootCommitmentB64u
  ) {
    throw new Error('Router state does not match the active tenant-root grant');
  }
  const lifecycleRevision = positiveSafeInteger(
    state.status.lifecycleRevision,
    'state lifecycle revision',
  );
  const activeEpoch = positiveSafeInteger(
    state.status.operationalShares.activeEpoch,
    'state active epoch',
  );
  const governanceDigestB64u = requiredText(state.governanceDigestB64u, 'state governance digest');
  return {
    identityDigestB64u,
    custodyLineageB64u,
    rootCommitmentB64u,
    lifecycleRevision,
    activeEpoch,
    nextScheduledRotationAtMs: parseNextScheduledRotationAtMs(
      state.status.operationalShares.nextScheduledRotationAt,
    ),
    governanceDigestB64u,
  };
}

function scopeMatches(
  operation: TenantRootPendingOperationV1,
  grant: TenantRootScheduledActiveGrantV1,
): boolean {
  return (
    operation.orgId === grant.identity.orgId &&
    operation.identityDigestB64u === grant.identityDigestB64u &&
    operation.custodyLineageB64u === grant.custodyLineageB64u
  );
}

function isScheduledRotationEntry(entry: TenantRootOperationEntryV1): boolean {
  return (
    entry.operationKind === TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1 &&
    entry.triggerKind === 'scheduled'
  );
}

function pendingForGrant(
  pending: readonly TenantRootPendingOperationV1[],
  grant: TenantRootScheduledActiveGrantV1,
): readonly TenantRootPendingOperationV1[] {
  const matching: TenantRootPendingOperationV1[] = [];
  for (const operation of pending) {
    if (!scopeMatches(operation, grant) || !isScheduledRotationEntry(operation.entry)) continue;
    matching.push(operation);
  }
  matching.sort((left, right) => left.entry.createdAtMs - right.entry.createdAtMs);
  return matching;
}

function randomOperationId(): string {
  return crypto.randomUUID();
}

function randomNonceB64u(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

function scheduledRotationIdempotencyKey(input: {
  readonly identityDigestB64u: string;
  readonly activeEpoch: number;
  readonly lifecycleRevision: number;
  readonly nextScheduledRotationAtMs: number;
}): string {
  return [
    SCHEDULED_ROTATION_IDEMPOTENCY_PREFIX_V1,
    input.identityDigestB64u,
    input.activeEpoch,
    input.lifecycleRevision,
    input.nextScheduledRotationAtMs,
  ].join(':');
}

function freshScheduledRotationIdempotencyKey(
  baseKey: string,
  previousOperationId: string,
): string {
  return `${baseKey}:attempt:${previousOperationId}`;
}

function shouldRetryPendingEntry(
  entry: TenantRootOperationEntryV1,
  nowMs: number,
): 'pending' | 'dispatch_uncertain' | null {
  if (entry.status !== 'pending') return null;
  if (entry.dispatchUncertainAtMs !== null) return 'dispatch_uncertain';
  return entry.authorizationExpiresAtMs > nowMs ? 'pending' : null;
}

function pendingResult(
  operations: readonly TenantRootPendingOperationV1[],
  nowMs: number,
): TenantRootScheduledIntentResultV1 | null {
  for (const operation of operations) {
    const entry = operation.entry;
    const reason = shouldRetryPendingEntry(entry, nowMs);
    if (reason !== null) return { kind: 'retry', operation, reason };
  }
  return null;
}

function firstExpiredPendingOperation(
  operations: readonly TenantRootPendingOperationV1[],
  nowMs: number,
): TenantRootPendingOperationV1 | null {
  for (const operation of operations) {
    const entry = operation.entry;
    if (
      entry.status === 'pending' &&
      entry.dispatchUncertainAtMs === null &&
      entry.authorizationExpiresAtMs <= nowMs
    ) {
      return operation;
    }
  }
  return null;
}

function settledResult(
  operation: TenantRootPendingOperationV1,
  entry: TenantRootOperationEntryV1,
): TenantRootScheduledIntentResultV1 | null {
  return entry.status === 'accepted' ? { kind: 'already_settled', operation } : null;
}

function operationKeyEntry(
  grant: TenantRootScheduledActiveGrantV1,
  entry: TenantRootOperationEntryV1,
  nowMs: number,
): TenantRootScheduledIntentResultV1 | null {
  const pending = shouldRetryPendingEntry(entry, nowMs);
  const operation: TenantRootPendingOperationV1 = {
    orgId: grant.identity.orgId,
    identityDigestB64u: grant.identityDigestB64u,
    custodyLineageB64u: grant.custodyLineageB64u,
    entry,
  };
  if (pending !== null) return { kind: 'retry', operation, reason: pending };
  return settledResult(operation, entry);
}

function buildScheduledRecord(input: {
  readonly grant: TenantRootScheduledActiveGrantV1;
  readonly state: ScheduledStateV1;
  readonly idempotencyKey: string;
  readonly nowMs: number;
}): TenantRootOperationRecordV1 {
  const issuedAt = new Date(input.nowMs).toISOString();
  const expiresAt = new Date(
    input.nowMs +
      tenantRootOperationMaxLifetimeMsV1(TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1),
  ).toISOString();
  const built = buildTenantRootOperationRecordV1({
    operationKind: TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1,
    identity: input.grant.identity,
    tenantRootIdentityDigest: input.state.identityDigestB64u,
    custodyLineageId: input.state.custodyLineageB64u,
    expectedLifecycleRevision: input.state.lifecycleRevision,
    recoveryGovernanceDigest: input.state.governanceDigestB64u,
    subject: { kind: 'tenant_root' },
    requesterActorId: TENANT_ROOT_SCHEDULED_ROTATION_REQUESTER_V1,
    idempotencyKey: input.idempotencyKey,
    issuedAt,
    expiresAt,
    expectedRootCommitment: input.state.rootCommitmentB64u,
  });
  if (!built.ok) {
    throw new Error(`scheduled rotation record is invalid: ${built.error.kind}`);
  }
  return built.record;
}

async function createScheduledOperation(input: {
  readonly store: TenantRootScheduledOperationStoreV1;
  readonly grant: TenantRootScheduledActiveGrantV1;
  readonly state: ScheduledStateV1;
  readonly idempotencyKey: string;
  readonly operationId: string;
  readonly nonceB64u: string;
  readonly nowMs: number;
}): Promise<TenantRootOperationEntryV1> {
  const record = buildScheduledRecord({
    grant: input.grant,
    state: input.state,
    idempotencyKey: input.idempotencyKey,
    nowMs: input.nowMs,
  });
  const entry = await input.store.consumeApprovalAndCreateOperation({
    operationId: input.operationId,
    operationKind: TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1,
    triggerKind: 'scheduled',
    operationDigestB64u: await tenantRootOperationDigestB64uV1(record),
    canonicalRecordJson: canonicalTenantRootOperationRecordJsonV1(record),
    idempotencyKey: record.idempotencyKey,
    requesterUserId: record.requesterActorId,
    approverUserId: null,
    consumedApprovalDigestB64u: null,
    nonceB64u: input.nonceB64u,
    createdAtMs: input.nowMs,
    authorizationExpiresAtMs:
      input.nowMs +
      tenantRootOperationMaxLifetimeMsV1(TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1),
  });
  return entry;
}

function selectActiveGrant(
  grants: readonly TenantRootScheduledActiveGrantV1[],
  nowMs: number,
): TenantRootScheduledActiveGrantV1 | null {
  const ordered = [...grants];
  ordered.sort((left, right) => left.identityDigestB64u.localeCompare(right.identityDigestB64u));
  if (ordered.length === 0) return null;
  const tickIndex = Math.floor(nowMs / 60_000) % ordered.length;
  return ordered[tickIndex] ?? null;
}

/**
 * Creates or resumes one scheduled rotation intent. The caller dispatches the
 * returned entry through the normal persisted-operation dispatcher.
 */
export async function createTenantRootScheduledRotationIntentV1(
  dependencies: TenantRootScheduledIntentDependenciesV1,
  input: { readonly nowMs: number },
): Promise<TenantRootScheduledIntentResultV1> {
  const nowMs = positiveSafeInteger(input.nowMs, 'scheduler time');
  const grants = await dependencies.grants.listActive();
  const grant = selectActiveGrant(grants, nowMs);
  if (grant === null) return { kind: 'no_active_tenant' };

  const state = parseScheduledState(
    grant,
    await dependencies.state.readStatus({ identity: grant.identity }),
  );
  const operations = dependencies.operations({
    orgId: grant.identity.orgId,
    identityDigestB64u: grant.identityDigestB64u,
    custodyLineageB64u: grant.custodyLineageB64u,
  });
  const matchingPending = pendingForGrant(
    await dependencies.pending.listPending(PENDING_OPERATION_SCAN_LIMIT_V1),
    grant,
  );
  const pending = pendingResult(matchingPending, nowMs);
  if (pending !== null) return pending;

  const nextScheduledRotationAtMs = state.nextScheduledRotationAtMs;
  if (nextScheduledRotationAtMs === null || nextScheduledRotationAtMs > nowMs) {
    return {
      kind: 'not_due',
      identityDigestB64u: grant.identityDigestB64u,
      nextScheduledRotationAtMs,
    };
  }

  const baseKey = scheduledRotationIdempotencyKey({
    identityDigestB64u: grant.identityDigestB64u,
    activeEpoch: state.activeEpoch,
    lifecycleRevision: state.lifecycleRevision,
    nextScheduledRotationAtMs,
  });
  const existing = await operations.findByIdempotencyKey(baseKey);
  const existingResult =
    existing === null || !isScheduledRotationEntry(existing)
      ? null
      : operationKeyEntry(grant, existing, nowMs);
  if (existingResult !== null) return existingResult;
  const expiredPending = firstExpiredPendingOperation(matchingPending, nowMs);
  const previousOperationId = existing?.operationId ?? expiredPending?.entry.operationId ?? null;
  let idempotencyKey =
    previousOperationId === null
      ? baseKey
      : freshScheduledRotationIdempotencyKey(baseKey, previousOperationId);
  if (idempotencyKey !== baseKey) {
    const priorAttempt = await operations.findByIdempotencyKey(idempotencyKey);
    if (priorAttempt !== null && isScheduledRotationEntry(priorAttempt)) {
      const priorAttemptResult = operationKeyEntry(grant, priorAttempt, nowMs);
      if (priorAttemptResult !== null) return priorAttemptResult;
    }
    if (priorAttempt !== null) {
      idempotencyKey = `${baseKey}:attempt:${randomOperationId()}`;
    }
  }
  const operationId = (dependencies.newOperationId ?? randomOperationId)();
  const nonceB64u = (dependencies.newNonceB64u ?? randomNonceB64u)();
  try {
    const entry = await createScheduledOperation({
      store: operations,
      grant,
      state,
      idempotencyKey,
      operationId,
      nonceB64u,
      nowMs,
    });
    return {
      kind: 'created',
      operation: {
        orgId: grant.identity.orgId,
        identityDigestB64u: grant.identityDigestB64u,
        custodyLineageB64u: grant.custodyLineageB64u,
        entry,
      },
    };
  } catch (error: unknown) {
    const raced = await operations.findByIdempotencyKey(idempotencyKey);
    if (raced !== null && isScheduledRotationEntry(raced)) {
      const racedResult = operationKeyEntry(grant, raced, nowMs);
      if (racedResult !== null) return racedResult;
    }
    throw error;
  }
}

type ScheduledGrantRowV1 = D1Row & {
  readonly org_id?: unknown;
  readonly project_id?: unknown;
  readonly env_id?: unknown;
  readonly signing_root_id?: unknown;
  readonly signing_root_version?: unknown;
  readonly identity_digest_b64u?: unknown;
  readonly custody_lineage_b64u?: unknown;
  readonly root_commitment_b64u?: unknown;
};

function parseScheduledGrantRow(row: ScheduledGrantRowV1): {
  readonly identityWire: {
    readonly orgId: string;
    readonly projectId: string;
    readonly envId: string;
    readonly signingRootId: string;
    readonly signingRootVersion: string;
  };
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly rootCommitmentB64u: string;
} {
  const identityWire = {
    orgId: requiredText(row.org_id, 'grant org id'),
    projectId: requiredText(row.project_id, 'grant project id'),
    envId: requiredText(row.env_id, 'grant environment id'),
    signingRootId: requiredText(row.signing_root_id, 'grant signing root id'),
    signingRootVersion: requiredText(row.signing_root_version, 'grant signing root version'),
  };
  return {
    identityWire,
    identityDigestB64u: requiredText(row.identity_digest_b64u, 'grant identity digest'),
    custodyLineageB64u: requiredText(row.custody_lineage_b64u, 'grant custody lineage'),
    rootCommitmentB64u: requiredText(row.root_commitment_b64u, 'grant root commitment'),
  };
}

/** D1 adapter that reads only active grant roots needed by the scheduler. */
export function createD1TenantRootScheduledActiveGrantReaderV1(options: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
}): TenantRootScheduledActiveGrantReaderV1 {
  const namespace = requiredText(options.namespace, 'grant namespace');
  return {
    async listActive() {
      const result = await options.database
        .prepare(
          `SELECT org_id, project_id, env_id, signing_root_id, signing_root_version,
                  identity_digest_b64u, custody_lineage_b64u, root_commitment_b64u
             FROM tenant_root_creation_grants
            WHERE namespace = ?1 AND status = 'ACTIVE'
            UNION ALL
           SELECT org_id,
                  json_extract(identity_json, '$.projectId') AS project_id,
                  json_extract(identity_json, '$.envId') AS env_id,
                  json_extract(identity_json, '$.signingRootId') AS signing_root_id,
                  json_extract(identity_json, '$.signingRootVersion') AS signing_root_version,
                  identity_digest_b64u, destination_lineage_b64u AS custody_lineage_b64u,
                  json_extract(session_json, '$.rootCommitmentB64u') AS root_commitment_b64u
             FROM tenant_root_security_restore_state
            WHERE namespace = ?1 AND json_extract(session_json, '$.status') = 'active'
              AND json_extract(session_json, '$.destinationLineageId') = destination_lineage_b64u
            ORDER BY identity_digest_b64u ASC`,
        )
        .bind(namespace)
        .all<ScheduledGrantRowV1>();
      const rows = result.results ?? [];
      const grants: TenantRootScheduledActiveGrantV1[] = [];
      const identities = new Set<string>();
      for (const row of rows) {
        const parsed = parseScheduledGrantRow(row);
        const decoded = decodeTenantRootIdentityWireV1(parsed.identityWire);
        if (!decoded.ok) throw new Error('active tenant-root grant identity is not canonical');
        const identityDigestB64u = await tenantRootIdentityDigestB64uV1(decoded.value);
        if (identityDigestB64u !== parsed.identityDigestB64u) {
          throw new Error('active tenant-root grant identity digest does not match its identity');
        }
        if (identities.has(identityDigestB64u)) {
          throw new Error('Tenant identity has multiple active roots for scheduling');
        }
        identities.add(identityDigestB64u);
        grants.push({
          identity: decoded.value,
          identityDigestB64u,
          custodyLineageB64u: parsed.custodyLineageB64u,
          rootCommitmentB64u: parsed.rootCommitmentB64u,
        });
      }
      return grants;
    },
  };
}
