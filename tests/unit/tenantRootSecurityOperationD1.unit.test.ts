import { expect, test } from '@playwright/test';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';
import type { D1DatabaseLike } from '../../packages/wallet-server/src/storage/tenantRoute';
import { createD1TenantRootOperationStoreV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/d1';
import {
  parseTenantRootOperationTriggerV1,
  type TenantRootOperationCreateInputV1,
  type TenantRootOperationTriggerKindV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';
import type { TenantRootOperationKindV1 } from '../../packages/shared-ts/src/tenant-root';

const NAMESPACE = 'console-test';
const ORG_ID = 'org-1';
const IDENTITY_DIGEST = 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos';
const LINEAGE = 'MTExMTExMTExMTExMTExMQ';
const DIGEST = 'operation-digest-1';
const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');

async function withDatabase(run: (database: D1DatabaseLike) => Promise<void>): Promise<void> {
  const { database, tempDir } = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(database, listD1MigrationFiles('d1-console'));
    await run(database);
  } finally {
    cleanupTemporaryD1Database(tempDir);
  }
}

function store(database: D1DatabaseLike, backupIntervalMs?: number) {
  return createD1TenantRootOperationStoreV1({
    database,
    namespace: NAMESPACE,
    backupIntervalMs,
    orgId: ORG_ID,
    identityDigestB64u: IDENTITY_DIGEST,
    custodyLineageB64u: LINEAGE,
    now: () => NOW_MS + 1_000,
  });
}

async function insertApproval(
  database: D1DatabaseLike,
  overrides: { digest?: string; approverUserId?: string; requesterUserId?: string } = {},
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO tenant_root_security_approvals (
         namespace, operation_digest_b64u, org_id, identity_digest_b64u, operation_kind,
         requester_user_id, approver_user_id, approver_session_id,
         approver_step_up_method, approver_step_up_verified_at_ms, approved_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      NAMESPACE,
      overrides.digest ?? DIGEST,
      ORG_ID,
      IDENTITY_DIGEST,
      'tenant_root_recovery_recipient_pair_replace_v1',
      overrides.requesterUserId ?? 'owner-1',
      overrides.approverUserId ?? 'owner-2',
      'session-owner-2',
      'webauthn_platform_v1',
      NOW_MS - 30_000,
      NOW_MS - 60_000,
    )
    .run();
}

type CreateInputOverrides = Omit<
  Partial<TenantRootOperationCreateInputV1>,
  'operationKind' | 'triggerKind'
> & {
  operationKind?: TenantRootOperationKindV1;
  triggerKind?: TenantRootOperationTriggerKindV1;
};

function createInput(overrides: CreateInputOverrides = {}): TenantRootOperationCreateInputV1 {
  const { operationKind, triggerKind, ...rest } = overrides;
  return {
    operationId: 'operation-1',
    operationDigestB64u: DIGEST,
    canonicalRecordJson: '{"formatVersion":"tenant_root_operation_record_v1"}',
    idempotencyKey: 'idempotency-1',
    requesterUserId: 'owner-1',
    approverUserId: 'owner-2',
    consumedApprovalDigestB64u: DIGEST,
    nonceB64u: 'bm9uY2UtMQ',
    createdAtMs: NOW_MS,
    authorizationExpiresAtMs: NOW_MS + 300_000,
    ...rest,
    ...parseTenantRootOperationTriggerV1(
      operationKind ?? 'tenant_root_recovery_recipient_pair_replace_v1',
      triggerKind ?? 'manual',
    ),
  };
}

test('the approval and the operation are written together', async () => {
  await withDatabase(async (database) => {
    const operations = store(database);
    await insertApproval(database);

    const entry = await operations.consumeApprovalAndCreateOperation(createInput());
    expect(entry.status).toBe('pending');
    expect(entry.approverUserId).toBe('owner-2');

    const approval = await operations.findApproval(DIGEST);
    expect(approval?.consumedAtMs).toBe(NOW_MS);
    expect(await operations.findByIdempotencyKey('idempotency-1')).not.toBeNull();
  });
});

test('a consumed approval writes nothing at all on a second attempt', async () => {
  await withDatabase(async (database) => {
    const operations = store(database);
    await insertApproval(database);
    await operations.consumeApprovalAndCreateOperation(createInput());

    await expect(
      operations.consumeApprovalAndCreateOperation(
        createInput({ operationId: 'operation-2', idempotencyKey: 'idempotency-2' }),
      ),
    ).rejects.toThrow(/tenant_root_approval_consumed_concurrently/u);

    // The failed attempt left no operation behind.
    expect(await operations.findByIdempotencyKey('idempotency-2')).toBeNull();
  });
});

test('the schema refuses self-approval and a reused idempotency key', async () => {
  await withDatabase(async (database) => {
    await expect(
      insertApproval(database, {
        digest: 'self-approval',
        approverUserId: 'owner-1',
        requesterUserId: 'owner-1',
      }),
    ).rejects.toThrow();

    const operations = store(database);
    await insertApproval(database);
    await operations.consumeApprovalAndCreateOperation(createInput());
    await insertApproval(database, { digest: 'operation-digest-2' });

    await expect(
      operations.consumeApprovalAndCreateOperation(
        createInput({
          operationId: 'operation-2',
          operationDigestB64u: 'operation-digest-2',
          consumedApprovalDigestB64u: 'operation-digest-2',
        }),
      ),
    ).rejects.toThrow();
  });
});

test('an accepted result is recorded once and expiry leaves it alone', async () => {
  await withDatabase(async (database) => {
    const operations = store(database);
    await insertApproval(database);
    const entry = await operations.consumeApprovalAndCreateOperation(createInput());

    const accepted = await operations.markAccepted(entry.operationId, '{"jobId":"job-1"}');
    expect(accepted.status).toBe('accepted');
    expect(accepted.acceptedResultJson).toBe('{"jobId":"job-1"}');

    // A replayed dispatch must not overwrite the recorded result.
    const replayed = await operations.markAccepted(entry.operationId, '{"jobId":"job-2"}');
    expect(replayed.acceptedResultJson).toBe('{"jobId":"job-1"}');

    const expired = await operations.markAuthorizationExpired(entry.operationId);
    expect(expired.status).toBe('accepted');
  });
});

test('an operation with no approval needs none', async () => {
  await withDatabase(async (database) => {
    const operations = store(database);
    const entry = await operations.consumeApprovalAndCreateOperation(
      createInput({
        operationKind: 'tenant_root_operational_share_rotation_v1',
        approverUserId: null,
        consumedApprovalDigestB64u: null,
      }),
    );
    expect(entry.approverUserId).toBeNull();
    expect(entry.status).toBe('pending');

    const pastExpiry = await operations.markAuthorizationExpired(entry.operationId);
    expect(pastExpiry.status).toBe('authorization_expired');
  });
});

test('an approval request holds the exact record until the operation consumes it', async () => {
  await withDatabase(async (database) => {
    const operations = store(database);
    await operations.putApprovalRequest({
      operationDigestB64u: DIGEST,
      operationKind: 'tenant_root_recovery_recipient_pair_replace_v1',
      canonicalRecordJson: '{"formatVersion":"tenant_root_operation_record_v1"}',
      payloadJson: '{"targetGovernanceKind":"two_person_v1"}',
      idempotencyKey: 'idempotency-1',
      requesterUserId: 'owner-1',
      createdAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 300_000,
    });
    // A second write for the same digest keeps the first record.
    await operations.putApprovalRequest({
      operationDigestB64u: DIGEST,
      operationKind: 'tenant_root_recovery_recipient_pair_replace_v1',
      canonicalRecordJson: '{"changed":true}',
      payloadJson: null,
      idempotencyKey: 'idempotency-1',
      requesterUserId: 'owner-1',
      createdAtMs: NOW_MS + 1,
      expiresAtMs: NOW_MS + 300_001,
    });
    const byKey = await operations.findApprovalRequestByIdempotencyKey('idempotency-1');
    expect(byKey?.canonicalRecordJson).toBe('{"formatVersion":"tenant_root_operation_record_v1"}');
    expect(byKey?.payloadJson).toBe('{"targetGovernanceKind":"two_person_v1"}');
    expect(await operations.findApprovalRequestByDigest(DIGEST)).toEqual(byKey);
    expect(await operations.listApprovalRequests()).toEqual([byKey]);

    // The approval is recorded from the request, never from a caller's fields.
    await operations.recordApproval({
      operationDigestB64u: DIGEST,
      operationKind: 'tenant_root_recovery_recipient_pair_replace_v1',
      requesterUserId: 'owner-1',
      approverUserId: 'owner-2',
      approverStepUp: {
        actorUserId: 'owner-2',
        sessionId: 'session-owner-2',
        method: 'webauthn_platform_v1',
        verifiedAtMs: NOW_MS - 30_000,
      },
      approvedAtMs: NOW_MS - 10_000,
    });
    // The schema refuses a self-approval and a second approval alike.
    await expect(
      operations.recordApproval({
        operationDigestB64u: DIGEST,
        operationKind: 'tenant_root_recovery_recipient_pair_replace_v1',
        requesterUserId: 'owner-1',
        approverUserId: 'owner-3',
        approverStepUp: {
          actorUserId: 'owner-3',
          sessionId: 'session-owner-3',
          method: 'webauthn_platform_v1',
          verifiedAtMs: NOW_MS - 30_000,
        },
        approvedAtMs: NOW_MS,
      }),
    ).rejects.toThrow();

    const entry = await operations.consumeApprovalAndCreateOperation(createInput());
    expect(entry.approverUserId).toBe('owner-2');
    // Consumption removes the request; the operation row now owns the record.
    expect(await operations.findApprovalRequestByDigest(DIGEST)).toBeNull();
    expect(await operations.findApprovalRequestByIdempotencyKey('idempotency-1')).toBeNull();
  });
});

test('a refused execution is recorded as failed with its code', async () => {
  await withDatabase(async (database) => {
    const operations = store(database);
    const entry = await operations.consumeApprovalAndCreateOperation(
      createInput({
        operationKind: 'tenant_root_operational_share_rotation_v1',
        approverUserId: null,
        consumedApprovalDigestB64u: null,
      }),
    );
    const failed = await operations.markFailed(entry.operationId, 'recipient_pair_incomplete');
    expect(failed.status).toBe('failed');
    expect(failed.failureCode).toBe('recipient_pair_incomplete');
    // A failure is terminal: it is neither accepted nor expired afterwards.
    expect((await operations.markAccepted(entry.operationId, '{}')).status).toBe('failed');
    expect((await operations.markAuthorizationExpired(entry.operationId)).status).toBe('failed');
  });
});

const OTHER_IDENTITY_DIGEST = 'qWdrtJqQ5ryu3sMSD9CL9vs3-1Wv9PBJ5Bqm5w9ZhwE';

function otherTenantStore(database: D1DatabaseLike) {
  return createD1TenantRootOperationStoreV1({
    database,
    namespace: NAMESPACE,
    orgId: 'org-2',
    identityDigestB64u: OTHER_IDENTITY_DIGEST,
    custodyLineageB64u: 'MjIyMjIyMjIyMjIyMjIyMg',
    now: () => NOW_MS + 1_000,
  });
}

test('one tenant root never sees or blocks another tenant root under the same idempotency key', async () => {
  await withDatabase(async (database) => {
    const first = store(database);
    const second = otherTenantStore(database);

    // Both tenants choose the same idempotency key for unrelated rotations.
    const firstEntry = await first.consumeApprovalAndCreateOperation(
      createInput({
        operationId: 'operation-first',
        operationKind: 'tenant_root_operational_share_rotation_v1',
        operationDigestB64u: 'digest-first',
        approverUserId: null,
        consumedApprovalDigestB64u: null,
      }),
    );
    const secondEntry = await second.consumeApprovalAndCreateOperation(
      createInput({
        operationId: 'operation-second',
        operationKind: 'tenant_root_operational_share_rotation_v1',
        operationDigestB64u: 'digest-second',
        approverUserId: null,
        consumedApprovalDigestB64u: null,
      }),
    );
    expect(firstEntry.operationDigestB64u).toBe('digest-first');
    expect(secondEntry.operationDigestB64u).toBe('digest-second');

    // Each store resolves the key to its own tenant's operation.
    expect((await first.findByIdempotencyKey('idempotency-1'))?.operationId).toBe(
      'operation-first',
    );
    expect((await second.findByIdempotencyKey('idempotency-1'))?.operationId).toBe(
      'operation-second',
    );

    // A tenant's approval, approval request, and operation are invisible to
    // the other tenant, by digest as well as by key.
    await insertApproval(database, { digest: 'approved-first' });
    expect(await first.findApproval('approved-first')).not.toBeNull();
    expect(await second.findApproval('approved-first')).toBeNull();
    await first.putApprovalRequest({
      operationDigestB64u: 'request-first',
      operationKind: 'tenant_root_recovery_recipient_pair_replace_v1',
      canonicalRecordJson: '{"tenant":"first"}',
      payloadJson: null,
      idempotencyKey: 'idempotency-2',
      requesterUserId: 'owner-1',
      createdAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 300_000,
    });
    expect(await second.findApprovalRequestByDigest('request-first')).toBeNull();
    expect(await second.findApprovalRequestByIdempotencyKey('idempotency-2')).toBeNull();
    expect(await second.listApprovalRequests()).toEqual([]);
    await expect(second.markFailed('operation-first', 'not_mine')).rejects.toThrow(
      /unknown tenant-root operation/u,
    );
    expect((await first.findByIdempotencyKey('idempotency-1'))?.status).toBe('pending');
  });
});

test('an expired approval request makes way for the rebuilt record under the same key', async () => {
  await withDatabase(async (database) => {
    const operations = store(database);
    const request = {
      operationKind: 'tenant_root_recovery_recipient_pair_replace_v1' as const,
      payloadJson: null,
      idempotencyKey: 'idempotency-1',
      requesterUserId: 'owner-1',
    };
    await operations.putApprovalRequest({
      ...request,
      operationDigestB64u: 'digest-expired',
      canonicalRecordJson: '{"attempt":1}',
      createdAtMs: NOW_MS - 600_000,
      expiresAtMs: NOW_MS - 300_000,
    });

    // The retry after expiry carries a new digest; it must be findable by an
    // approver, not silently dropped behind the expired row.
    await operations.putApprovalRequest({
      ...request,
      operationDigestB64u: 'digest-rebuilt',
      canonicalRecordJson: '{"attempt":2}',
      createdAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 300_000,
    });
    expect(
      (await operations.findApprovalRequestByDigest('digest-rebuilt'))?.canonicalRecordJson,
    ).toBe('{"attempt":2}');
    expect(await operations.findApprovalRequestByDigest('digest-expired')).toBeNull();
    expect(
      (await operations.findApprovalRequestByIdempotencyKey('idempotency-1'))?.operationDigestB64u,
    ).toBe('digest-rebuilt');

    // A live request holds its key: a different record under the same key is
    // refused loudly rather than stored nowhere.
    await expect(
      operations.putApprovalRequest({
        ...request,
        operationDigestB64u: 'digest-competing',
        canonicalRecordJson: '{"attempt":3}',
        createdAtMs: NOW_MS + 1,
        expiresAtMs: NOW_MS + 300_001,
      }),
    ).rejects.toThrow(/tenant_root_approval_request_key_held_by_another_record/u);
    expect(await operations.findApprovalRequestByDigest('digest-competing')).toBeNull();
  });
});

for (const intervalMs of [60_000, 600_000]) {
  test(`backup creation waits ${intervalMs / 1000}s and preserves a blocked approval`, async () => {
    await withDatabase(async (database) => {
      const operations = store(database, intervalMs === 600_000 ? undefined : intervalMs);
      await operations.consumeApprovalAndCreateOperation(createInput({
        operationKind: 'tenant_root_recovery_backup_create_v1',
        approverUserId: null,
        consumedApprovalDigestB64u: null,
      }));
      await insertApproval(database, { digest: 'replacement-digest' });
      const replacement = createInput({
        operationId: 'replacement-operation',
        operationDigestB64u: 'replacement-digest',
        idempotencyKey: 'replacement-idempotency',
        consumedApprovalDigestB64u: 'replacement-digest',
        operationKind: 'tenant_root_recovery_backup_replace_v1',
        createdAtMs: NOW_MS + intervalMs - 1,
        authorizationExpiresAtMs: NOW_MS + intervalMs + 300_000,
      });
      await expect(operations.consumeApprovalAndCreateOperation(replacement))
        .rejects.toThrow('Wait 1 second before creating another recovery backup.');
      const approval = await database.prepare(
        'SELECT consumed_at_ms FROM tenant_root_security_approvals WHERE operation_digest_b64u = ?1',
      ).bind('replacement-digest').first();
      expect(approval?.consumed_at_ms).toBeNull();
      const accepted = await operations.consumeApprovalAndCreateOperation(createInput({
        operationId: 'replacement-operation',
        operationDigestB64u: 'replacement-digest',
        idempotencyKey: 'replacement-idempotency',
        consumedApprovalDigestB64u: 'replacement-digest',
        operationKind: 'tenant_root_recovery_backup_replace_v1',
        createdAtMs: NOW_MS + intervalMs,
        authorizationExpiresAtMs: NOW_MS + intervalMs + 300_000,
      }));
      expect(accepted.status).toBe('pending');
    });
  });
}
