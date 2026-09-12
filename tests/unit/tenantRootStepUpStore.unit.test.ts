import { expect, test } from '@playwright/test';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';
import type { D1DatabaseLike } from '../../packages/wallet-server/src/storage/tenantRoute';
import { createD1TenantRootStepUpStoreV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpStore';
import { parseTenantRootStepUpV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';

const NAMESPACE = 'console-test';
const ORG_ID = 'org-1';
const ACTOR = 'owner-1';
const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');

async function withStore(
  run: (
    store: ReturnType<typeof createD1TenantRootStepUpStoreV1>,
    database: D1DatabaseLike,
  ) => Promise<void>,
): Promise<void> {
  const { database, tempDir } = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(database, listD1MigrationFiles('d1-console'));
    await run(createD1TenantRootStepUpStoreV1({ database, namespace: NAMESPACE }), database);
  } finally {
    cleanupTemporaryD1Database(tempDir);
  }
}

test('an actor with no recorded step-up reads as none', async () => {
  await withStore(async (store) => {
    expect(await store.readStepUp({ orgId: ORG_ID, actorUserId: ACTOR })).toBeNull();
  });
});

test('a recorded step-up reads back and is judged fresh by the operation', async () => {
  await withStore(async (store) => {
    await store.recordStepUp({
      orgId: ORG_ID,
      actorUserId: ACTOR,
      sessionId: 'session-1',
      method: 'webauthn_platform_v1',
      verifiedAtMs: NOW_MS - 30_000,
    });

    const record = await store.readStepUp({ orgId: ORG_ID, actorUserId: ACTOR });
    expect(record).toEqual({
      actorUserId: ACTOR,
      sessionId: 'session-1',
      method: 'webauthn_platform_v1',
      verifiedAtMs: NOW_MS - 30_000,
    });

    // Freshness is the operation's decision, not the store's.
    expect(parseTenantRootStepUpV1({ record, expectedActorUserId: ACTOR, nowMs: NOW_MS }).ok).toBe(
      true,
    );
    expect(
      parseTenantRootStepUpV1({
        record,
        expectedActorUserId: ACTOR,
        nowMs: NOW_MS + 300_000,
      }).ok,
    ).toBe(false);
  });
});

test('a newer step-up replaces an older one and an older one does not', async () => {
  await withStore(async (store) => {
    await store.recordStepUp({
      orgId: ORG_ID,
      actorUserId: ACTOR,
      sessionId: 'session-1',
      method: 'webauthn_platform_v1',
      verifiedAtMs: NOW_MS - 30_000,
    });
    await store.recordStepUp({
      orgId: ORG_ID,
      actorUserId: ACTOR,
      sessionId: 'session-2',
      method: 'webauthn_cross_platform_v1',
      verifiedAtMs: NOW_MS - 5_000,
    });
    expect(await store.readStepUp({ orgId: ORG_ID, actorUserId: ACTOR })).toMatchObject({
      sessionId: 'session-2',
      verifiedAtMs: NOW_MS - 5_000,
    });

    // A stale replay cannot roll the record backwards.
    await store.recordStepUp({
      orgId: ORG_ID,
      actorUserId: ACTOR,
      sessionId: 'session-3',
      method: 'webauthn_platform_v1',
      verifiedAtMs: NOW_MS - 120_000,
    });
    expect(await store.readStepUp({ orgId: ORG_ID, actorUserId: ACTOR })).toMatchObject({
      sessionId: 'session-2',
      verifiedAtMs: NOW_MS - 5_000,
    });
  });
});

test('one actor never reads another actor or organization step-up', async () => {
  await withStore(async (store) => {
    await store.recordStepUp({
      orgId: ORG_ID,
      actorUserId: ACTOR,
      sessionId: 'session-1',
      method: 'webauthn_platform_v1',
      verifiedAtMs: NOW_MS - 30_000,
    });
    expect(await store.readStepUp({ orgId: ORG_ID, actorUserId: 'owner-2' })).toBeNull();
    expect(await store.readStepUp({ orgId: 'org-2', actorUserId: ACTOR })).toBeNull();
  });
});

test('the schema refuses a method that does not demonstrate presence', async () => {
  await withStore(async (_store, database) => {
    await expect(
      database
        .prepare(
          `INSERT INTO tenant_root_step_up_records (
             namespace, org_id, actor_user_id, session_id, method,
             verified_at_ms, created_at_ms
           ) VALUES (?1, ?2, ?3, 'session-1', 'password_v1', ?4, ?4)`,
        )
        .bind(NAMESPACE, ORG_ID, ACTOR, NOW_MS)
        .run(),
    ).rejects.toThrow();
  });
});
