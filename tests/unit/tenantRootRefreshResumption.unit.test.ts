import { expect, test } from '@playwright/test';
import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  buildTenantRootOperationRecordV1,
  canonicalTenantRootOperationRecordJsonV1,
  tenantRootOperationDigestB64uV1,
  tenantRootOperationMaxLifetimeMsV1,
} from '../../packages/shared-ts/src/tenant-root';
import {
  buildTenantRootRefreshRouterRequestV1,
  dispatchTenantRootRefreshOperationV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootCreation/consoleRoute';
import {
  createD1TenantRootOperationResumptionStoreV1,
  createD1TenantRootOperationStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/d1';
import type { TenantRootAuditEventV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';
import type { D1DatabaseLike } from '../../packages/wallet-server/src/storage/tenantRoute';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';

const NAMESPACE = 'refresh-resumption-test';
const ORG_ID = 'org-refresh-resumption';
const PROJECT_ID = 'project-refresh-resumption';
const ENV_ID = `${PROJECT_ID}:dev`;
const IDENTITY_DIGEST = 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos';
const LINEAGE = 'MTExMTExMTExMTExMTExMQ';
const OPERATION_ID = 'refresh-resumption-caller-id';
const NOW_MS = Date.parse('2026-09-06T12:00:00.000Z');

function identity() {
  const built = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    envId: ENV_ID,
    signingRootId: `${PROJECT_ID}:dev`,
    signingRootVersion: 'default',
  });
  if (!built.ok) throw new Error('refresh resumption identity fixture is invalid');
  return built.value;
}

async function createPendingOperation(database: D1DatabaseLike) {
  const issuedAt = new Date(NOW_MS).toISOString();
  const expiresAt = new Date(
    NOW_MS + tenantRootOperationMaxLifetimeMsV1('tenant_root_operational_share_rotation_v1'),
  ).toISOString();
  const built = buildTenantRootOperationRecordV1({
    operationKind: 'tenant_root_operational_share_rotation_v1',
    identity: identity(),
    tenantRootIdentityDigest: IDENTITY_DIGEST,
    custodyLineageId: LINEAGE,
    expectedLifecycleRevision: 7,
    recoveryGovernanceDigest: 'governance-digest-refresh-resumption',
    subject: { kind: 'tenant_root' },
    requesterActorId: 'operator-refresh-resumption',
    idempotencyKey: OPERATION_ID,
    issuedAt,
    expiresAt,
    expectedRootCommitment: 'root-commitment-refresh-resumption',
  });
  if (!built.ok) throw new Error('refresh resumption operation fixture is invalid');

  const store = createD1TenantRootOperationStoreV1({
    database,
    namespace: NAMESPACE,
    orgId: ORG_ID,
    identityDigestB64u: IDENTITY_DIGEST,
    custodyLineageB64u: LINEAGE,
    now: () => NOW_MS,
  });
  const entry = await store.consumeApprovalAndCreateOperation({
    operationId: 'refresh-resumption-row-id',
    operationKind: built.record.operationKind,
    triggerKind: 'manual',
    operationDigestB64u: await tenantRootOperationDigestB64uV1(built.record),
    canonicalRecordJson: canonicalTenantRootOperationRecordJsonV1(built.record),
    idempotencyKey: OPERATION_ID,
    requesterUserId: built.record.requesterActorId,
    approverUserId: null,
    consumedApprovalDigestB64u: null,
    nonceB64u: 'bm9uY2UtcmVzdW1wdGlvbg',
    createdAtMs: NOW_MS,
    authorizationExpiresAtMs: Date.parse(built.record.expiresAt),
  });
  return { entry, store };
}

async function withDatabase(run: (database: D1DatabaseLike) => Promise<void>): Promise<void> {
  const { database, tempDir } = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(database, listD1MigrationFiles('d1-console'));
    await run(database);
  } finally {
    cleanupTemporaryD1Database(tempDir);
  }
}

test('a persisted pending rotation is replayed by the shared runner with its exact request', async () => {
  await withDatabase(async (database) => {
    const pending = await createPendingOperation(database);
    const resumption = createD1TenantRootOperationResumptionStoreV1({
      database,
      namespace: NAMESPACE,
    });
    const listed = await resumption.listPending(10);
    expect(listed).toHaveLength(1);
    const operation = listed[0];
    if (!operation) throw new Error('pending operation was not listed');

    const forwarded: Request[] = [];
    const auditEvents: TenantRootAuditEventV1[] = [];
    const result = await dispatchTenantRootRefreshOperationV1({
      dependencies: {
        router: {
          async fetch(input, init) {
            forwarded.push(new Request(input, init));
            return Response.json({
              activation_receipt_digest_b64u: 'activation-receipt-resumption',
              lifecycle_revision: 8,
              retirement: { kind: 'confirmed' },
            });
          },
        },
        internalServiceAuthSecret: 'refresh-resumption-secret',
        audit: {
          async write(event) {
            auditEvents.push(event);
          },
        },
        operations: pending.store,
      },
      entry: operation.entry,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
      stepUpMethod: null,
      nowMs: NOW_MS,
    });

    expect(result).toEqual({
      kind: 'completed',
      value: {
        activationReceiptDigestB64u: 'activation-receipt-resumption',
        lifecycleRevision: 8,
        retirement: { kind: 'confirmed' },
      },
    });
    expect(forwarded).toHaveLength(1);
    await expect(forwarded[0]?.json()).resolves.toEqual({
      operation_id: OPERATION_ID,
      identity_digest_b64u: IDENTITY_DIGEST,
      custody_lineage_b64u: LINEAGE,
      expected_lifecycle_revision: 7,
      expires_at_ms: NOW_MS + 600_000,
      trigger: 'manual',
    });
    expect(auditEvents).toHaveLength(3);
    expect(auditEvents[0]).toMatchObject({
      action: 'rotation_activated',
      outcome: 'success',
      receiptDigestB64u: 'activation-receipt-resumption',
      authorization: {
        operationDigestB64u: operation.entry.operationDigestB64u,
      },
    });
    expect(auditEvents.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'rotation_retired',
          outcome: 'success',
          role: 'deriver_a',
          receiptDigestB64u: null,
          lifecycleRevision: 8,
        }),
        expect.objectContaining({
          action: 'rotation_retired',
          outcome: 'success',
          role: 'deriver_b',
          receiptDigestB64u: null,
          lifecycleRevision: 8,
        }),
      ]),
    );
    expect((await pending.store.findByIdempotencyKey(OPERATION_ID))?.status).toBe('accepted');
  });
});

test('an audit failure leaves the pending operation resumable and a retry records once', async () => {
  await withDatabase(async (database) => {
    const pending = await createPendingOperation(database);
    const listed = await createD1TenantRootOperationResumptionStoreV1({
      database,
      namespace: NAMESPACE,
    }).listPending(10);
    const operation = listed[0];
    if (!operation) throw new Error('pending operation was not listed');

    let failAudit = true;
    const auditEvents: TenantRootAuditEventV1[] = [];
    const forwarded: Request[] = [];
    const audit = {
      async write(event: TenantRootAuditEventV1) {
        if (failAudit) throw new Error('audit unavailable');
        auditEvents.push(event);
      },
    };
    const dependencies = {
      router: {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          forwarded.push(new Request(input, init));
          return Response.json({
            activation_receipt_digest_b64u: 'activation-receipt-retry',
            lifecycle_revision: 8,
            retirement: { kind: 'confirmed' },
          });
        },
      },
      internalServiceAuthSecret: 'refresh-resumption-secret',
      audit,
      operations: pending.store,
    };
    const input = {
      dependencies,
      entry: operation.entry,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
      stepUpMethod: null,
      nowMs: NOW_MS,
    } as const;

    const first = await dispatchTenantRootRefreshOperationV1(input);
    expect(first.kind).toBe('unknown');
    expect((await pending.store.findByIdempotencyKey(OPERATION_ID))?.status).toBe('pending');

    failAudit = false;
    const second = await dispatchTenantRootRefreshOperationV1(input);
    expect(second.kind).toBe('completed');
    expect((await pending.store.findByIdempotencyKey(OPERATION_ID))?.status).toBe('accepted');
    expect(auditEvents.filter((event) => event.action === 'rotation_activated')).toHaveLength(1);
    expect(auditEvents.filter((event) => event.action === 'rotation_retired')).toHaveLength(2);
    expect(forwarded).toHaveLength(2);
    await expect(forwarded[0]?.json()).resolves.toEqual(await forwarded[1]?.clone().json());
  });
});

test('the request builder refuses a pending row whose scope lineage differs', async () => {
  await withDatabase(async (database) => {
    const pending = await createPendingOperation(database);
    const result = await buildTenantRootRefreshRouterRequestV1({
      entry: pending.entry,
      orgId: ORG_ID,
      identityDigestB64u: IDENTITY_DIGEST,
      custodyLineageB64u: 'different-lineage',
    });
    expect(result).toEqual({
      ok: false,
      code: 'invalid_operation_record',
      message: 'Stored tenant-root refresh operation is bound to a different identity or key',
    });
  });
});

test('the request builder refuses a durable digest that does not match its canonical record', async () => {
  await withDatabase(async (database) => {
    const pending = await createPendingOperation(database);
    const result = await buildTenantRootRefreshRouterRequestV1({
      entry: { ...pending.entry, operationDigestB64u: 'wrong-digest' },
      orgId: ORG_ID,
      identityDigestB64u: IDENTITY_DIGEST,
      custodyLineageB64u: LINEAGE,
    });
    expect(result).toEqual({
      ok: false,
      code: 'invalid_operation_record',
      message: 'Stored tenant-root refresh operation digest is invalid',
    });
  });
});

test('a malformed never-dispatched row is failed before Router contact', async () => {
  await withDatabase(async (database) => {
    const pending = await createPendingOperation(database);
    await database
      .prepare(
        `UPDATE tenant_root_security_operations
            SET canonical_record_json = ?1
          WHERE namespace = ?2 AND operation_id = ?3`,
      )
      .bind('{"broken":true}', NAMESPACE, 'refresh-resumption-row-id')
      .run();
    const operation = (
      await createD1TenantRootOperationResumptionStoreV1({
        database,
        namespace: NAMESPACE,
      }).listPending(10)
    )[0];
    if (!operation) throw new Error('pending operation was not listed');

    let routerCalls = 0;
    const auditEvents: TenantRootAuditEventV1[] = [];
    const result = await dispatchTenantRootRefreshOperationV1({
      dependencies: {
        router: {
          async fetch() {
            routerCalls += 1;
            throw new Error('malformed rows must not reach Router');
          },
        },
        internalServiceAuthSecret: 'refresh-resumption-secret',
        audit: {
          async write(event) {
            auditEvents.push(event);
          },
        },
        operations: pending.store,
      },
      entry: operation.entry,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
      stepUpMethod: null,
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ kind: 'invalid', code: 'invalid_operation_record' });
    expect(routerCalls).toBe(0);
    expect(auditEvents).toMatchObject([
      {
        action: 'rotation_failed',
        outcome: 'failure',
        failureCode: 'invalid_operation_record',
        lifecycleRevision: 0,
      },
    ]);
    expect((await pending.store.findByIdempotencyKey(OPERATION_ID))?.status).toBe('failed');
  });
});

test('a malformed uncertain row stays pending while its retry position advances', async () => {
  await withDatabase(async (database) => {
    const pending = await createPendingOperation(database);
    await pending.store.markDispatchUncertain('refresh-resumption-row-id', NOW_MS + 1_000);
    await database
      .prepare(
        `UPDATE tenant_root_security_operations
            SET canonical_record_json = ?1
          WHERE namespace = ?2 AND operation_id = ?3`,
      )
      .bind('{"broken":true}', NAMESPACE, 'refresh-resumption-row-id')
      .run();
    const operation = (
      await createD1TenantRootOperationResumptionStoreV1({
        database,
        namespace: NAMESPACE,
      }).listPending(10)
    )[0];
    if (!operation) throw new Error('pending operation was not listed');

    let routerCalls = 0;
    const auditEvents: TenantRootAuditEventV1[] = [];
    const result = await dispatchTenantRootRefreshOperationV1({
      dependencies: {
        router: {
          async fetch() {
            routerCalls += 1;
            throw new Error('malformed rows must not reach Router');
          },
        },
        internalServiceAuthSecret: 'refresh-resumption-secret',
        audit: {
          async write(event) {
            auditEvents.push(event);
          },
        },
        operations: pending.store,
      },
      entry: operation.entry,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
      stepUpMethod: null,
      nowMs: NOW_MS + 2_000,
    });

    expect(result.kind).toBe('unknown');
    expect(routerCalls).toBe(0);
    expect(auditEvents).toMatchObject([
      {
        action: 'rotation_requested',
        outcome: 'pending',
        failureCode: 'dispatch_uncertain',
      },
    ]);
    const retained = await pending.store.findByIdempotencyKey(OPERATION_ID);
    expect(retained?.status).toBe('pending');
    expect(retained?.dispatchUncertainAtMs).toBe(NOW_MS + 2_000);
  });
});
