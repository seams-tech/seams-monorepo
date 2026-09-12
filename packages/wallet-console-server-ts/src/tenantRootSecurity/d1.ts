import {
  d1ChangedRows,
  queryD1One,
  type D1DatabaseLike,
  type D1ResultLike,
  type D1Row,
} from '@seams/wallet-server/cloud-host';
import {
  isTenantRootOperationKindV1,
  type TenantRootOperationKindV1,
} from '@seams-internal/shared-ts/tenant-root';
import type { TenantRootOperationApprovalRecordV1 } from './authorization';
import {
  TENANT_ROOT_APPROVAL_RACE_MARKER_V1,
  TENANT_ROOT_APPROVAL_REQUEST_CONFLICT_MARKER_V1,
  parseTenantRootOperationTriggerV1,
  type TenantRootApprovalRequestV1,
  type TenantRootOperationCreateInputV1,
  type TenantRootOperationEntryV1,
  type TenantRootOperationStoreV1,
  type TenantRootOutboxStatusV1,
  type TenantRootPendingOperationV1,
} from './service';
import type { TenantRootStepUpMethodV1 } from './stepUp';

/**
 * D1-backed store for tenant derivation-root console operations.
 *
 * Every read and write is scoped to one tenant root: the deployment namespace
 * and the tenant-root identity digest the store was created for. An
 * idempotency key is the caller's choice, so two tenants choosing the same key
 * must never see or block each other's operations; the schema's uniqueness
 * constraints carry the identity digest for the same reason.
 *
 * The consume-and-create step runs as one D1 batch, and the insert itself is
 * guarded on the approval still being unconsumed. Ordering matters: the insert
 * must observe the approval before the update spends it, so a lost race writes
 * nothing at all rather than creating an operation with a spent approval.
 */

/** Options for the D1 store. */
export interface D1TenantRootOperationStoreOptionsV1 {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  /** Injected so a caller's clock, not the host's, orders the rows. */
  readonly now?: () => number;
  readonly backupIntervalMs?: number;
}

export class RecoveryBackupCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(
      `Wait ${retryAfterSeconds} ${retryAfterSeconds === 1 ? 'second' : 'seconds'} before creating another recovery backup.`,
    );
  }
}

const OPERATIONS_COLUMNS = `
  operation_id, operation_kind, trigger_kind, operation_digest_b64u, canonical_record_json,
  idempotency_key, requester_user_id, approver_user_id, nonce_b64u, status,
  created_at_ms, authorization_expires_at_ms, accepted_result_json, failure_code,
  dispatch_uncertain_at_ms
`;

const APPROVAL_REQUEST_COLUMNS = `
  operation_digest_b64u, operation_kind, canonical_record_json, payload_json,
  idempotency_key, requester_user_id, created_at_ms, expires_at_ms
`;

const TENANT_ROOT_OPERATION_KIND_ROTATION_V1: TenantRootOperationKindV1 =
  'tenant_root_operational_share_rotation_v1';

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function requiredScopeText(value: unknown, label: string): string {
  const parsed = text(value);
  if (parsed.length === 0) throw new Error(`pending tenant-root operation has no ${label}`);
  return parsed;
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function operationKind(value: unknown): TenantRootOperationKindV1 {
  const parsed = text(value);
  if (!isTenantRootOperationKindV1(parsed)) {
    throw new Error(`unknown tenant-root operation kind ${parsed}`);
  }
  return parsed;
}

function stepUpMethod(value: unknown): TenantRootStepUpMethodV1 {
  const parsed = text(value);
  if (parsed !== 'webauthn_platform_v1' && parsed !== 'webauthn_cross_platform_v1') {
    throw new Error(`unknown tenant-root step-up method ${parsed}`);
  }
  return parsed;
}

function status(value: unknown): TenantRootOutboxStatusV1 {
  const parsed = text(value);
  switch (parsed) {
    case 'pending':
    case 'accepted':
    case 'authorization_expired':
    case 'failed':
      return parsed;
    default:
      throw new Error(`unknown tenant-root operation status ${parsed}`);
  }
}

function toEntry(row: D1Row): TenantRootOperationEntryV1 {
  const kind = operationKind(row.operation_kind);
  return {
    operationId: text(row.operation_id),
    ...parseTenantRootOperationTriggerV1(kind, row.trigger_kind),
    operationDigestB64u: text(row.operation_digest_b64u),
    canonicalRecordJson: text(row.canonical_record_json),
    idempotencyKey: text(row.idempotency_key),
    requesterUserId: text(row.requester_user_id),
    approverUserId: optionalText(row.approver_user_id),
    nonceB64u: text(row.nonce_b64u),
    status: status(row.status),
    createdAtMs: integer(row.created_at_ms),
    authorizationExpiresAtMs: integer(row.authorization_expires_at_ms),
    dispatchUncertainAtMs:
      row.dispatch_uncertain_at_ms === null || row.dispatch_uncertain_at_ms === undefined
        ? null
        : integer(row.dispatch_uncertain_at_ms),
    acceptedResultJson: optionalText(row.accepted_result_json),
    failureCode: optionalText(row.failure_code),
  };
}

function toApproval(row: D1Row): TenantRootOperationApprovalRecordV1 {
  return {
    operationDigestB64u: text(row.operation_digest_b64u),
    approverUserId: text(row.approver_user_id),
    approverStepUp: {
      actorUserId: text(row.approver_user_id),
      sessionId: text(row.approver_session_id),
      method: stepUpMethod(row.approver_step_up_method),
      verifiedAtMs: integer(row.approver_step_up_verified_at_ms),
    },
    approvedAtMs: integer(row.approved_at_ms),
    consumedAtMs:
      row.consumed_at_ms === null || row.consumed_at_ms === undefined
        ? null
        : integer(row.consumed_at_ms),
  };
}

function toApprovalRequest(row: D1Row): TenantRootApprovalRequestV1 {
  return {
    operationDigestB64u: text(row.operation_digest_b64u),
    operationKind: operationKind(row.operation_kind),
    canonicalRecordJson: text(row.canonical_record_json),
    payloadJson: optionalText(row.payload_json),
    idempotencyKey: text(row.idempotency_key),
    requesterUserId: text(row.requester_user_id),
    createdAtMs: integer(row.created_at_ms),
    expiresAtMs: integer(row.expires_at_ms),
  };
}

/** Creates one D1-backed operation store. */
export function createD1TenantRootOperationStoreV1(
  options: D1TenantRootOperationStoreOptionsV1,
): TenantRootOperationStoreV1 {
  const { database, namespace } = options;
  const identity = options.identityDigestB64u;
  const now = options.now ?? (() => Date.now());

  async function readById(operationId: string): Promise<TenantRootOperationEntryV1> {
    const row = await queryD1One(
      database,
      `SELECT ${OPERATIONS_COLUMNS}
       FROM tenant_root_security_operations
       WHERE namespace = ?1 AND identity_digest_b64u = ?2 AND operation_id = ?3`,
      [namespace, identity, operationId],
    );
    if (row === null) throw new Error(`unknown tenant-root operation ${operationId}`);
    return toEntry(row);
  }

  async function readApprovalRequestByKey(
    idempotencyKey: string,
  ): Promise<TenantRootApprovalRequestV1 | null> {
    const row = await queryD1One(
      database,
      `SELECT ${APPROVAL_REQUEST_COLUMNS}
       FROM tenant_root_security_approval_requests
       WHERE namespace = ?1 AND identity_digest_b64u = ?2 AND idempotency_key = ?3`,
      [namespace, identity, idempotencyKey],
    );
    return row === null ? null : toApprovalRequest(row);
  }

  return {
    async findByIdempotencyKey(idempotencyKey) {
      const row = await queryD1One(
        database,
        `SELECT ${OPERATIONS_COLUMNS}
         FROM tenant_root_security_operations
         WHERE namespace = ?1 AND identity_digest_b64u = ?2 AND idempotency_key = ?3`,
        [namespace, identity, idempotencyKey],
      );
      return row === null ? null : toEntry(row);
    },

    async findApproval(operationDigestB64u) {
      const row = await queryD1One(
        database,
        `SELECT operation_digest_b64u, approver_user_id, approver_session_id,
                approver_step_up_method, approver_step_up_verified_at_ms,
                approved_at_ms, consumed_at_ms
         FROM tenant_root_security_approvals
         WHERE namespace = ?1 AND identity_digest_b64u = ?2 AND operation_digest_b64u = ?3`,
        [namespace, identity, operationDigestB64u],
      );
      return row === null ? null : toApproval(row);
    },

    async findApprovalRequestByIdempotencyKey(idempotencyKey) {
      return await readApprovalRequestByKey(idempotencyKey);
    },

    async findApprovalRequestByDigest(operationDigestB64u) {
      const row = await queryD1One(
        database,
        `SELECT ${APPROVAL_REQUEST_COLUMNS}
         FROM tenant_root_security_approval_requests
         WHERE namespace = ?1 AND identity_digest_b64u = ?2 AND operation_digest_b64u = ?3`,
        [namespace, identity, operationDigestB64u],
      );
      return row === null ? null : toApprovalRequest(row);
    },

    async putApprovalRequest(request) {
      // An expired request under this idempotency key has nothing left to
      // approve; it makes way for the rebuilt record. A live one does not:
      // the first record for a digest wins, so a retry that already stored
      // its record cannot overwrite the bytes an approver may be reading.
      await database.batch([
        database
          .prepare(
            `DELETE FROM tenant_root_security_approval_requests
             WHERE namespace = ?1 AND identity_digest_b64u = ?2 AND idempotency_key = ?3
               AND expires_at_ms <= ?4`,
          )
          .bind(namespace, identity, request.idempotencyKey, request.createdAtMs),
        database
          .prepare(
            `INSERT OR IGNORE INTO tenant_root_security_approval_requests (
               namespace, operation_digest_b64u, org_id, identity_digest_b64u, operation_kind,
               canonical_record_json, payload_json, idempotency_key, requester_user_id,
               created_at_ms, expires_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
          )
          .bind(
            namespace,
            request.operationDigestB64u,
            options.orgId,
            identity,
            request.operationKind,
            request.canonicalRecordJson,
            request.payloadJson,
            request.idempotencyKey,
            request.requesterUserId,
            request.createdAtMs,
            request.expiresAtMs,
          ),
      ]);
      // The row the key now names must be this digest. If a live request for
      // a different record holds the key, the insert was silently ignored and
      // no approver could find this digest; saying so is the only honest reply.
      const stored = await readApprovalRequestByKey(request.idempotencyKey);
      if (stored === null || stored.operationDigestB64u !== request.operationDigestB64u) {
        throw new Error(TENANT_ROOT_APPROVAL_REQUEST_CONFLICT_MARKER_V1);
      }
    },

    async listApprovalRequests() {
      const result = await database
        .prepare(
          `SELECT ${APPROVAL_REQUEST_COLUMNS}
           FROM tenant_root_security_approval_requests
           WHERE namespace = ?1 AND identity_digest_b64u = ?2
           ORDER BY created_at_ms ASC`,
        )
        .bind(namespace, identity)
        .all<D1Row>();
      return (result.results ?? []).map(toApprovalRequest);
    },

    async recordApproval(input) {
      // The schema refuses self-approval and a second approval of one digest.
      await database
        .prepare(
          `INSERT INTO tenant_root_security_approvals (
             namespace, operation_digest_b64u, org_id, identity_digest_b64u, operation_kind,
             requester_user_id, approver_user_id, approver_session_id,
             approver_step_up_method, approver_step_up_verified_at_ms, approved_at_ms
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(
          namespace,
          input.operationDigestB64u,
          options.orgId,
          identity,
          input.operationKind,
          input.requesterUserId,
          input.approverUserId,
          input.approverStepUp.sessionId,
          input.approverStepUp.method,
          input.approverStepUp.verifiedAtMs,
          input.approvedAtMs,
        )
        .run();
    },

    async consumeApprovalAndCreateOperation(input: TenantRootOperationCreateInputV1) {
      const approvalDigest = input.consumedApprovalDigestB64u;
      const insert = database
        .prepare(
          `INSERT INTO tenant_root_security_operations (
             namespace, operation_id, org_id, identity_digest_b64u, custody_lineage_b64u,
             operation_kind, trigger_kind, operation_digest_b64u, canonical_record_json, idempotency_key,
             requester_user_id, approver_user_id, nonce_b64u, status,
             created_at_ms, authorization_expires_at_ms, updated_at_ms
           )
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'pending', ?14, ?15, ?14
           WHERE (?16 IS NULL
              OR EXISTS (
                   SELECT 1 FROM tenant_root_security_approvals
                   WHERE namespace = ?1
                     AND identity_digest_b64u = ?4
                     AND operation_digest_b64u = ?16
                     AND consumed_at_ms IS NULL
                 ))
             AND (?6 NOT IN ('tenant_root_recovery_backup_create_v1', 'tenant_root_recovery_backup_replace_v1')
               OR NOT EXISTS (
                 SELECT 1 FROM tenant_root_security_operations
                 WHERE namespace=?1 AND org_id=?3 AND identity_digest_b64u=?4
                   AND operation_kind IN ('tenant_root_recovery_backup_create_v1', 'tenant_root_recovery_backup_replace_v1')
                   AND created_at_ms > ?17
               ))`,
        )
        .bind(
          namespace,
          input.operationId,
          options.orgId,
          identity,
          options.custodyLineageB64u,
          input.operationKind,
          input.triggerKind,
          input.operationDigestB64u,
          input.canonicalRecordJson,
          input.idempotencyKey,
          input.requesterUserId,
          input.approverUserId,
          input.nonceB64u,
          input.createdAtMs,
          input.authorizationExpiresAtMs,
          approvalDigest,
          input.createdAtMs - (options.backupIntervalMs ?? 600_000),
        );

      const statements = [insert];
      if (approvalDigest !== null) {
        statements.push(
          database
            .prepare(
              `UPDATE tenant_root_security_approvals
               SET consumed_at_ms = ?1, consumed_by_operation_id = ?2
               WHERE namespace = ?3 AND identity_digest_b64u = ?4
                 AND operation_digest_b64u = ?5 AND consumed_at_ms IS NULL
                 AND EXISTS (SELECT 1 FROM tenant_root_security_operations WHERE namespace=?3 AND operation_id=?2)`,
            )
            .bind(input.createdAtMs, input.operationId, namespace, identity, approvalDigest),
        );
      }
      // The approval request has served its purpose once the operation exists.
      statements.push(
        database
          .prepare(
            `DELETE FROM tenant_root_security_approval_requests
             WHERE namespace = ?1 AND identity_digest_b64u = ?2 AND operation_digest_b64u = ?3
               AND EXISTS (SELECT 1 FROM tenant_root_security_operations WHERE namespace=?1 AND operation_id=?4)`,
          )
          .bind(namespace, identity, input.operationDigestB64u, input.operationId),
      );

      const results = await database.batch<D1ResultLike>(statements);
      const inserted = results[0];
      if (inserted === undefined || d1ChangedRows(inserted) === 0) {
        if (
          input.operationKind === 'tenant_root_recovery_backup_create_v1' ||
          input.operationKind === 'tenant_root_recovery_backup_replace_v1'
        ) {
          const recent = await database
            .prepare(
              `SELECT MAX(created_at_ms) AS created_at_ms FROM tenant_root_security_operations
             WHERE namespace=?1 AND org_id=?2 AND identity_digest_b64u=?3
               AND operation_kind IN ('tenant_root_recovery_backup_create_v1', 'tenant_root_recovery_backup_replace_v1')`,
            )
            .bind(namespace, options.orgId, identity)
            .first<{ created_at_ms: unknown }>();
          if (recent === null) throw new Error('Could not read recovery backup cooldown');
          if (recent.created_at_ms !== null) {
            if (
              typeof recent.created_at_ms !== 'number' ||
              !Number.isSafeInteger(recent.created_at_ms)
            ) {
              throw new Error('Invalid recovery backup creation time');
            }
            const remaining =
              recent.created_at_ms + (options.backupIntervalMs ?? 600_000) - input.createdAtMs;
            if (remaining > 0) throw new RecoveryBackupCooldownError(Math.ceil(remaining / 1000));
          }
        }
        throw new Error(TENANT_ROOT_APPROVAL_RACE_MARKER_V1);
      }
      return await readById(input.operationId);
    },

    async markAccepted(operationId, acceptedResultJson) {
      // The control plane returns the same result for an exact replay, so a
      // second accept must not overwrite the first recorded result.
      await database
        .prepare(
          `UPDATE tenant_root_security_operations
           SET status = 'accepted', accepted_result_json = ?1, updated_at_ms = ?2
           WHERE namespace = ?3 AND identity_digest_b64u = ?4 AND operation_id = ?5
             AND status = 'pending'`,
        )
        .bind(acceptedResultJson, now(), namespace, identity, operationId)
        .run();
      return await readById(operationId);
    },

    async markFailed(operationId, failureCode) {
      await database
        .prepare(
          `UPDATE tenant_root_security_operations
           SET status = 'failed', failure_code = ?1, updated_at_ms = ?2
           WHERE namespace = ?3 AND identity_digest_b64u = ?4 AND operation_id = ?5
             AND status = 'pending'`,
        )
        .bind(failureCode, now(), namespace, identity, operationId)
        .run();
      return await readById(operationId);
    },

    async markDispatchUncertain(operationId, atMs) {
      // Only ever set on a pending operation: an accepted or failed one has a
      // definite outcome, and marking it uncertain would invite a retry to
      // reconcile something already settled.
      await database
        .prepare(
          `UPDATE tenant_root_security_operations
           SET dispatch_uncertain_at_ms = ?1, updated_at_ms = ?2
           WHERE namespace = ?3 AND identity_digest_b64u = ?4 AND operation_id = ?5
             AND status = 'pending'`,
        )
        .bind(atMs, now(), namespace, identity, operationId)
        .run();
      return await readById(operationId);
    },

    async markAuthorizationExpired(operationId) {
      await database
        .prepare(
          `UPDATE tenant_root_security_operations
           SET status = 'authorization_expired', updated_at_ms = ?1
           WHERE namespace = ?2 AND identity_digest_b64u = ?3 AND operation_id = ?4
             AND status = 'pending'`,
        )
        .bind(now(), namespace, identity, operationId)
        .run();
      return await readById(operationId);
    },
  };
}

/**
 * Reads the bounded set of pending operational-share rotations for one
 * console namespace. Each row carries its own tenant scope, so a scheduler
 * can build the normal scoped store before replaying the operation.
 */
export interface D1TenantRootOperationResumptionStoreOptionsV1 {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
}

export interface TenantRootOperationResumptionStoreV1 {
  listPending(limit: number): Promise<readonly TenantRootPendingOperationV1[]>;
}

export function createD1TenantRootOperationResumptionStoreV1(
  options: D1TenantRootOperationResumptionStoreOptionsV1,
): TenantRootOperationResumptionStoreV1 {
  return {
    async listPending(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error('tenant-root operation resumption limit must be between 1 and 1000');
      }
      const result = await options.database
        .prepare(
          `SELECT org_id, identity_digest_b64u, custody_lineage_b64u,
                  ${OPERATIONS_COLUMNS}
             FROM tenant_root_security_operations
            WHERE namespace = ?1
              AND operation_kind = ?2
              AND status = 'pending'
            ORDER BY updated_at_ms ASC, created_at_ms ASC
            LIMIT ?3`,
        )
        .bind(options.namespace, TENANT_ROOT_OPERATION_KIND_ROTATION_V1, limit)
        .all<D1Row>();
      return (result.results ?? []).map(
        (row): TenantRootPendingOperationV1 => ({
          orgId: requiredScopeText(row.org_id, 'org id'),
          identityDigestB64u: requiredScopeText(row.identity_digest_b64u, 'identity digest'),
          custodyLineageB64u: requiredScopeText(row.custody_lineage_b64u, 'custody lineage'),
          entry: toEntry(row),
        }),
      );
    },
  };
}
