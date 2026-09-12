import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createD1TenantRootScheduledActiveGrantReaderV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/scheduledIntent';
import { expect, test } from '@playwright/test';
import type { D1DatabaseLike } from '../../packages/wallet-server/src/storage/tenantRoute';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';
import {
  createD1TenantRootRestoreStoreV1,
  findD1RestoredTenantRootActiveLineageV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreD1';
import {
  createTenantRootRestoreManifestClientV1,
  TenantRootRestoreManifestUnavailableError,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/tenantRootRestoreManifestClient';
import {
  activateRestoredRootV1,
  authenticateRestoreSessionV1,
  expireRestoreSessionIfDueV1,
  importRestoreRoleShareV1,
  issueRestoreRoleImportKeyV1,
  mintRestoreBootstrapSessionV1,
  registerRestoreManifestV1,
  startRestoreSessionV1,
  TENANT_ROOT_RESTORE_SESSION_MS_V1,
  type TenantRootRestoreControlPlaneV1,
  type TenantRootRestoreRefreshGrantScopeV1,
  type TenantRootRestoreRoleImportKeyV1,
  type TenantRootRestoreStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreService';
import type { TenantRootDestinationStateV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreService';
import type {
  TenantRootRestoreCleanupEvidenceV1,
  TenantRootRestoreSessionV1,
} from '../../packages/shared-ts/src/tenant-root';
import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  parseTenantRootOperationRecordV1,
  tenantRootOperationDigestB64uV1,
} from '../../packages/shared-ts/src/tenant-root';
import type { TenantRootRestoreRoleImportOperationStoreV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreService';
import {
  signTenantRootRestoreRefreshGrantV1,
  type SignedTenantRootRestoreRefreshGrantV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreRefreshGrantSigner';
import { base64UrlEncode } from '../../packages/wallet-server/src/cloud-host';

const NAMESPACE = 'console-test';
const ORG_ID = 'org-1';
const NATIVE_MANIFEST_BYTES = readFileSync(
  new URL(
    '../../crates/router-ab-core/tests/fixtures/tenant-root-recovery/manifest.json',
    import.meta.url,
  ),
);
const NATIVE_MANIFEST_B64U = NATIVE_MANIFEST_BYTES.toString('base64url');
const IDENTITY_DIGEST = 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos';
const DESTINATION_LINEAGE = 'ERITFBUWFxgZGhscHR4fIA';
const DESTINATION_FINGERPRINT = 'ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A';
const SOURCE_CUSTODY_LINEAGE = 'AQIDBAUGBwgJCgsMDQ4PEA';
const RECOVERY_SET_ID = 'MTIzNDU2Nzg5Ojs8PT4_QA';
const RESTORE_SESSION_ID = 'AQIDBAUGBwgJCgsMDQ4PEA';
const REPLACEMENT_SESSION_ID = 'IyQlJicoKSorLC0uLzAxMg';
const STABLE_ROOT_COMMITMENT = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const DERIVER_A_PUBLIC_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const DERIVER_A_FINGERPRINT = 'riFsLvUkejeCwTXvonmj5M3GEJQnD10r5YxiBLemEsk';
const DERIVER_B_PUBLIC_KEY = 'ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A';
const DERIVER_B_FINGERPRINT = 'fu5YAN3NOzzJ_QR4Mc2FNuPD9X9E10b1FdqT8EjunpE';
const RECOVERY_SHARE_COMMITMENT_A = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIg';
const RECOVERY_SHARE_COMMITMENT_B = 'IyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDRA';
const PACKAGE_DIGEST_A = 'AgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICE';
const PACKAGE_DIGEST_B = 'AwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISI';
const MANIFEST_DIGEST = 'riFsLvUkejeCwTXvonmj5M3GEJQnD10r5YxiBLemEsk';
const SUBMITTED_MANIFEST_DIGEST = createHash('sha256')
  .update(NATIVE_MANIFEST_BYTES)
  .digest('base64url');
const ACTOR = 'destination-operator';
const TOKEN = 'destination-session-token';
const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');
const AT_ISO = '2026-09-05T12:00:00.000Z';
const REFRESH_SIGNING_SEED_B64U = base64UrlEncode(new Uint8Array(32).fill(0x72));

type RestoreStoreFactory = (
  readDestination: () => Promise<TenantRootDestinationStateV1>,
) => TenantRootRestoreStoreV1 & TenantRootRestoreRoleImportOperationStoreV1;

async function withDatabase(run: (database: D1DatabaseLike) => Promise<void>): Promise<void> {
  const { database, tempDir } = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(database, listD1MigrationFiles('d1-console'));
    await run(database);
  } finally {
    cleanupTemporaryD1Database(tempDir);
  }
}

function createStoreFactory(
  database: D1DatabaseLike,
  overrides: {
    readonly namespace?: string;
    readonly orgId?: string;
    readonly identityDigestB64u?: string;
    readonly destinationLineageB64u?: string;
  } = {},
): RestoreStoreFactory {
  return (readDestination) =>
    createD1TenantRootRestoreStoreV1({
      database,
      namespace: overrides.namespace ?? NAMESPACE,
      orgId: overrides.orgId ?? ORG_ID,
      identityDigestB64u: overrides.identityDigestB64u ?? IDENTITY_DIGEST,
      destinationLineageB64u: overrides.destinationLineageB64u ?? DESTINATION_LINEAGE,
      readDestination,
      now: () => NOW_MS,
    });
}

function createControlPlane(
  identityDigestB64u = IDENTITY_DIGEST,
): TenantRootRestoreControlPlaneV1 & { readonly calls: string[] } {
  const calls: string[] = [];
  const cleanup: TenantRootRestoreCleanupEvidenceV1 = {
    bootstrap: { kind: 'destroyed', receiptDigestB64u: DERIVER_A_PUBLIC_KEY },
    roles: {
      kind: 'complete',
      receipts: { deriverA: DERIVER_A_PUBLIC_KEY, deriverB: DERIVER_B_PUBLIC_KEY },
    },
  };
  return {
    calls,
    registerManifest: async () => ({
      identityDigestB64u,
      sourceCustodyLineageB64u: SOURCE_CUSTODY_LINEAGE,
      recoverySetId: RECOVERY_SET_ID,
      stableRootCommitmentB64u: STABLE_ROOT_COMMITMENT,
      deriverA: {
        shareId: 1,
        recipientPublicKeyB64u: DERIVER_A_PUBLIC_KEY,
        recipientFingerprintB64u: DERIVER_A_FINGERPRINT,
        recoveryShareCommitmentB64u: RECOVERY_SHARE_COMMITMENT_A,
        deriverSigningKeyId: 'deriver-a-signing-key',
      },
      deriverB: {
        shareId: 2,
        recipientPublicKeyB64u: DERIVER_B_PUBLIC_KEY,
        recipientFingerprintB64u: DERIVER_B_FINGERPRINT,
        recoveryShareCommitmentB64u: RECOVERY_SHARE_COMMITMENT_B,
        deriverSigningKeyId: 'deriver-b-signing-key',
      },
      deriverAPackageLength: 128,
      deriverAPackageDigestB64u: PACKAGE_DIGEST_A,
      deriverBPackageLength: 128,
      deriverBPackageDigestB64u: PACKAGE_DIGEST_B,
      manifestDigestB64u: MANIFEST_DIGEST,
      artifactCreatedAtIso: '2026-08-29T10:20:30.123Z',
      trustLevel: { kind: 'cryptographically_valid_offline' },
    }),
    issueRoleImportKey: async (input) => {
      calls.push(`key:${input.operationRecord.role}:${input.operationRecord.generation}`);
      return {
        role: input.operationRecord.role,
        importKeyId: input.operationRecord.importKeyId,
        importPublicKeyB64u: DERIVER_A_PUBLIC_KEY,
        generation: input.operationRecord.generation,
        issuedAtMs: Date.parse(input.operationRecord.issuedAt),
        expiresAtMs: Date.parse(input.operationRecord.issuedAt) + 900_000,
        operationDigestB64u: await tenantRootOperationDigestB64uV1(input.operationRecord),
        commandDigestB64u: DERIVER_B_PUBLIC_KEY,
      };
    },
    acceptRoleImport: async (input) => {
      calls.push(`import:${input.operationRecord.role}:${input.operationRecord.importKeyId}`);
      return {
        receiptDigestB64u:
          input.operationRecord.role === 'deriver_a' ? DERIVER_A_PUBLIC_KEY : DERIVER_B_PUBLIC_KEY,
      };
    },
    issueRestoreRefreshGrant: async (
      input: TenantRootRestoreRefreshGrantScopeV1,
    ): Promise<SignedTenantRootRestoreRefreshGrantV1> =>
      signTenantRootRestoreRefreshGrantV1({
        ...input,
        deriverAAcceptanceReceiptDigestB64u: DERIVER_A_PUBLIC_KEY,
        deriverBAcceptanceReceiptDigestB64u: DERIVER_B_PUBLIC_KEY,
        grantKeyId: 'restore-refresh-authority-v1',
        signingSeedB64u: REFRESH_SIGNING_SEED_B64U,
      }),
    activate: async (input) => ({
      destinationLineageId: DESTINATION_LINEAGE,
      activatedEpoch: 1,
      activationReceiptB64u: 'canonical-activation-receipt',
      activationReceiptDigestB64u: 'activation-receipt',
      forwardRefreshReceiptDigestB64u: 'forward-refresh-receipt',
      continuityCanaryReceiptDigestB64u: 'continuity-canary-receipt',
      rootCommitmentMatches: true,
      cleanup,
    }),
    cleanupSession: async ({ restoreSessionId }) => {
      calls.push(`cleanup:${restoreSessionId}`);
      return cleanup.roles;
    },
    cleanupActivatedRoot: async () => cleanup,
  };
}

async function signedRefreshGrantForStore(
  store: TenantRootRestoreStoreV1,
  operationDigestB64u: string,
  nonceB64u: string,
): Promise<SignedTenantRootRestoreRefreshGrantV1> {
  const context = await store.readContext();
  const session = context.session;
  const manifest = context.registeredManifest?.descriptor;
  if (session === null || session.status !== 'verifying' || manifest === undefined) {
    throw new Error('expected a verifying restore session with a registered manifest');
  }
  const scope: TenantRootRestoreRefreshGrantScopeV1 = {
    operationDigestB64u,
    destinationIdentityDigestB64u: context.identityDigestB64u,
    destinationFingerprintB64u: session.destinationFingerprintB64u,
    destinationLineageB64u: context.destinationLineageB64u,
    restoreSessionIdB64u: session.sessionId,
    manifestDigestB64u: manifest.manifestDigestB64u,
    deriverAAcceptanceReceiptDigestB64u: session.installationReceipts.deriverA,
    deriverBAcceptanceReceiptDigestB64u: session.installationReceipts.deriverB,
    nonceB64u,
    issuedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + 300_000,
  };
  return await signTenantRootRestoreRefreshGrantV1({
    ...scope,
    grantKeyId: 'restore-refresh-authority-v1',
    signingSeedB64u: REFRESH_SIGNING_SEED_B64U,
  });
}

async function startSession(
  store: TenantRootRestoreStoreV1,
  controlPlane: TenantRootRestoreControlPlaneV1,
  nowMs = NOW_MS,
  sessionId = RESTORE_SESSION_ID,
  token = TOKEN,
): Promise<TenantRootRestoreSessionV1> {
  await mintRestoreBootstrapSessionV1(store, {
    actorUserId: ACTOR,
    nowMs,
    newSessionToken: () => token,
  });
  const authenticated = await authenticateRestoreSessionV1(store, {
    sessionToken: token,
    nowMs,
  });
  if (authenticated === null) throw new Error('expected a live restore administration session');
  const started = await startRestoreSessionV1(store, controlPlane, {
    sessionId,
    authenticatedSession: authenticated,
    atIso: AT_ISO,
    nowMs,
  });
  if (!started.ok) throw new Error(`restore session did not start: ${started.error.kind}`);
  return started.value;
}

function restoreIdentity() {
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: ORG_ID,
    projectId: 'project-2',
    envId: 'production',
    signingRootId: 'root-main',
    signingRootVersion: 'v3',
  });
  if (!identity.ok) throw new Error('expected a valid test identity');
  return identity.value;
}

async function requireAuthentication(store: TenantRootRestoreStoreV1) {
  const authenticated = await authenticateRestoreSessionV1(store, {
    sessionToken: TOKEN,
    nowMs: NOW_MS,
  });
  if (authenticated === null) throw new Error('expected a live bootstrap session');
  return authenticated;
}

async function issueKey(
  store: TenantRootRestoreStoreV1 & TenantRootRestoreRoleImportOperationStoreV1,
  controlPlane: TenantRootRestoreControlPlaneV1,
  role: 'deriver_a' | 'deriver_b',
  operationId: string,
  nowMs = NOW_MS,
) {
  const authenticated = await authenticateRestoreSessionV1(store, {
    sessionToken: TOKEN,
    nowMs,
  });
  if (authenticated === null) throw new Error('expected a live bootstrap session');
  return await issueRestoreRoleImportKeyV1(store, controlPlane, {
    role,
    operationId,
    identity: restoreIdentity(),
    authenticatedSession: authenticated,
    actorUserId: ACTOR,
    atIso: new Date(nowMs).toISOString(),
    nowMs,
  });
}

async function prepareVerifyingRestore(
  store: TenantRootRestoreStoreV1 & TenantRootRestoreRoleImportOperationStoreV1,
  controlPlane: TenantRootRestoreControlPlaneV1,
): Promise<void> {
  await startSession(store, controlPlane);
  const registered = await registerRestoreManifestV1(store, controlPlane, {
    manifestB64u: NATIVE_MANIFEST_B64U,
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  if (!registered.ok) throw new Error('expected the manifest to register');
  for (const role of ['deriver_a', 'deriver_b'] as const) {
    const issued = await issueKey(store, controlPlane, role, `refresh-${role}`);
    if (!issued.ok) throw new Error(`expected the ${role} import key`);
    const imported = await importRestoreRoleShareV1(store, controlPlane, {
      role,
      importEnvelopeB64u: `refresh-envelope-${role}`,
      authenticatedSession: await requireAuthentication(store),
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    if (!imported.ok) throw new Error(`expected the ${role} import`);
  }
  const context = await store.readContext();
  if (context.session?.status !== 'verifying') {
    throw new Error('expected the restore session to be verifying');
  }
}

test('admits a refresh grant before dispatch and replays its exact bytes after D1 reload', async () => {
  await withDatabase(async (database) => {
    const readDestination = async (): Promise<TenantRootDestinationStateV1> => ({
      kind: 'empty',
      deploymentFingerprintB64u: DESTINATION_FINGERPRINT,
    });
    const stores = createStoreFactory(database);
    const store = stores(readDestination);
    const controlPlane = createControlPlane();
    await prepareVerifyingRestore(store, controlPlane);

    const grant = await signedRefreshGrantForStore(
      store,
      STABLE_ROOT_COMMITMENT,
      DERIVER_A_PUBLIC_KEY,
    );
    const admission = await store.admitRestoreRefreshGrant({
      expectedSessionId: RESTORE_SESSION_ID,
      grant,
      nowMs: NOW_MS,
    });
    expect(admission).toMatchObject({ kind: 'admitted', grant });
    expect((await store.readContext()).session?.status).toBe('refreshing');

    const reloaded = stores(readDestination);
    expect(await reloaded.readRestoreRefreshGrant(RESTORE_SESSION_ID)).toEqual(grant);
    expect((await reloaded.readContext()).session?.status).toBe('refreshing');
  });
});

test('concurrent refresh admission returns one durable winner to both callers', async () => {
  await withDatabase(async (database) => {
    const readDestination = async (): Promise<TenantRootDestinationStateV1> => ({
      kind: 'empty',
      deploymentFingerprintB64u: DESTINATION_FINGERPRINT,
    });
    const stores = createStoreFactory(database);
    const firstStore = stores(readDestination);
    const secondStore = stores(readDestination);
    const controlPlane = createControlPlane();
    await prepareVerifyingRestore(firstStore, controlPlane);
    const firstGrant = await signedRefreshGrantForStore(
      firstStore,
      STABLE_ROOT_COMMITMENT,
      DERIVER_A_PUBLIC_KEY,
    );
    const secondGrant = await signedRefreshGrantForStore(
      firstStore,
      PACKAGE_DIGEST_A,
      DERIVER_B_PUBLIC_KEY,
    );

    const results = await Promise.all([
      firstStore.admitRestoreRefreshGrant({
        expectedSessionId: RESTORE_SESSION_ID,
        grant: firstGrant,
        nowMs: NOW_MS,
      }),
      secondStore.admitRestoreRefreshGrant({
        expectedSessionId: RESTORE_SESSION_ID,
        grant: secondGrant,
        nowMs: NOW_MS,
      }),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(['admitted', 'replayed']);
    if (
      results[0].kind === 'expired' ||
      results[0].kind === 'session_not_ready' ||
      results[0].kind === 'conflict'
    ) {
      throw new Error('expected the first admission to return a grant');
    }
    if (
      results[1].kind === 'expired' ||
      results[1].kind === 'session_not_ready' ||
      results[1].kind === 'conflict'
    ) {
      throw new Error('expected the second admission to return a grant');
    }
    expect(results[0].grant).toEqual(results[1].grant);
    expect([firstGrant, secondGrant]).toContainEqual(results[0].grant);
  });
});

test('rejects a persisted refresh grant whose bytes do not match its digest', async () => {
  await withDatabase(async (database) => {
    const readDestination = async (): Promise<TenantRootDestinationStateV1> => ({
      kind: 'empty',
      deploymentFingerprintB64u: DESTINATION_FINGERPRINT,
    });
    const stores = createStoreFactory(database);
    const store = stores(readDestination);
    const controlPlane = createControlPlane();
    await prepareVerifyingRestore(store, controlPlane);
    const grant = await signedRefreshGrantForStore(
      store,
      STABLE_ROOT_COMMITMENT,
      DERIVER_A_PUBLIC_KEY,
    );
    await store.admitRestoreRefreshGrant({
      expectedSessionId: RESTORE_SESSION_ID,
      grant,
      nowMs: NOW_MS,
    });
    await database
      .prepare(
        `UPDATE tenant_root_security_restore_refresh_grants
            SET grant_digest_b64u = ?1
          WHERE namespace = ?2
            AND org_id = ?3
            AND identity_digest_b64u = ?4
            AND destination_lineage_b64u = ?5
            AND session_id_b64u = ?6`,
      )
      .bind(
        DERIVER_B_PUBLIC_KEY,
        NAMESPACE,
        ORG_ID,
        IDENTITY_DIGEST,
        DESTINATION_LINEAGE,
        RESTORE_SESSION_ID,
      )
      .run();
    await expect(store.readRestoreRefreshGrant(RESTORE_SESSION_ID)).rejects.toThrow(
      /digest does not match/u,
    );
  });
});

test('persists restore progress, exact replay, active destination state, and cleanup semantics', async () => {
  await withDatabase(async (database) => {
    let destination: TenantRootDestinationStateV1 = {
      kind: 'empty',
      deploymentFingerprintB64u: DESTINATION_FINGERPRINT,
    };
    const readDestination = async (): Promise<TenantRootDestinationStateV1> => destination;
    const stores = createStoreFactory(database);
    const store = stores(readDestination);
    const controlPlane = createControlPlane();

    const bootstrap = await mintRestoreBootstrapSessionV1(store, {
      actorUserId: ACTOR,
      nowMs: NOW_MS,
      newSessionToken: () => TOKEN,
    });
    await startSession(store, controlPlane);
    const registered = await registerRestoreManifestV1(store, controlPlane, {
      manifestB64u: NATIVE_MANIFEST_B64U,
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    expect(registered.ok).toBe(true);

    const firstKey = await issueKey(store, controlPlane, 'deriver_a', 'operation-a-1');
    const secondKey = await issueKey(store, controlPlane, 'deriver_a', 'operation-a-2');
    expect(firstKey.ok && secondKey.ok).toBe(true);
    if (!firstKey.ok || !secondKey.ok) throw new Error('expected both import keys');
    expect(firstKey.value.generation).toBe(1);
    expect(secondKey.value.generation).toBe(2);

    const importedA = await importRestoreRoleShareV1(store, controlPlane, {
      role: 'deriver_a',
      importEnvelopeB64u: 'envelope-a',
      authenticatedSession: await requireAuthentication(store),
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    expect(importedA.ok).toBe(true);

    const reloaded = stores(readDestination);
    const persisted = await reloaded.readContext();
    expect(persisted.session?.status).toBe('awaiting_role_imports');
    expect(persisted.registeredManifest?.descriptor).toMatchObject({
      identityDigestB64u: IDENTITY_DIGEST,
      sourceCustodyLineageB64u: SOURCE_CUSTODY_LINEAGE,
      recoverySetId: RECOVERY_SET_ID,
      deriverA: {
        shareId: 1,
        recipientPublicKeyB64u: DERIVER_A_PUBLIC_KEY,
        recipientFingerprintB64u: DERIVER_A_FINGERPRINT,
      },
      deriverB: {
        shareId: 2,
        recipientPublicKeyB64u: DERIVER_B_PUBLIC_KEY,
        recipientFingerprintB64u: DERIVER_B_FINGERPRINT,
      },
      deriverAPackageLength: 128,
      deriverBPackageLength: 128,
    });
    expect(persisted.importKeys.deriver_a?.generation).toBe(2);
    expect(persisted.installedImports).toEqual([
      {
        role: 'deriver_a',
        envelopeDigestB64u: expect.any(String),
        receiptDigestB64u: DERIVER_A_PUBLIC_KEY,
      },
    ]);
    await expect(reloaded.putRoleImportKey(firstKey.value)).rejects.toThrow(
      /generation regressed/u,
    );

    const replayed = await importRestoreRoleShareV1(reloaded, controlPlane, {
      role: 'deriver_a',
      importEnvelopeB64u: 'envelope-a',
      authenticatedSession: await requireAuthentication(store),
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    expect(replayed).toMatchObject({
      ok: true,
      value: { replayed: true, receiptDigestB64u: DERIVER_A_PUBLIC_KEY },
    });
    expect(controlPlane.calls.filter((call) => call.startsWith('import:deriver_a')).length).toBe(1);

    const keyB = await issueKey(reloaded, controlPlane, 'deriver_b', 'operation-b');
    expect(keyB.ok).toBe(true);
    const importedB = await importRestoreRoleShareV1(reloaded, controlPlane, {
      role: 'deriver_b',
      importEnvelopeB64u: 'envelope-b',
      authenticatedSession: await requireAuthentication(reloaded),
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    expect(importedB).toMatchObject({ ok: true, value: { replayed: false } });

    const activated = await activateRestoredRootV1(reloaded, controlPlane, {
      offlineTrustAcknowledged: true,
      sourceDisposition: { kind: 'retained_as_backup' },
      authenticatedSession: await requireAuthentication(reloaded),
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    expect(activated).toMatchObject({ ok: true, value: { status: 'active' } });

    // The live reader is the authority for destination occupancy. A persisted
    // active session cannot mask an empty reader result, so the adapter fails
    // closed until the authoritative state catches up.
    await expect(reloaded.readContext()).rejects.toThrow(/disagrees with persisted active/u);
    destination = { kind: 'active_root_present' };
    const active = await reloaded.readContext();
    expect(active.destination).toEqual({ kind: 'active_root_present' });
    expect(active.session).toMatchObject({
      status: 'active',
      rootCommitmentB64u: STABLE_ROOT_COMMITMENT,
    });
    expect(active.registeredManifest).toBeNull();
    expect(active.importKeys).toEqual({ deriver_a: null, deriver_b: null });
    expect(active.installedImports).toEqual([]);
    expect(await reloaded.readRestoreRefreshGrant(RESTORE_SESSION_ID)).toBeNull();

    expect(
      await findD1RestoredTenantRootActiveLineageV1({
        database,
        namespace: NAMESPACE,
        orgId: ORG_ID,
        identityDigestB64u: IDENTITY_DIGEST,
      }),
    ).toEqual({
      custodyLineageB64u: DESTINATION_LINEAGE,
      rootCommitmentB64u: STABLE_ROOT_COMMITMENT,
      restore: active.session,
    });
    expect(
      await findD1RestoredTenantRootActiveLineageV1({
        database,
        namespace: NAMESPACE,
        orgId: 'another-org',
        identityDigestB64u: IDENTITY_DIGEST,
      }),
    ).toBeNull();

    const scheduledRoots = await createD1TenantRootScheduledActiveGrantReaderV1({
      database,
      namespace: NAMESPACE,
    }).listActive();
    expect(scheduledRoots).toHaveLength(1);
    expect(scheduledRoots[0]).toMatchObject({
      identityDigestB64u: IDENTITY_DIGEST,
      custodyLineageB64u: DESTINATION_LINEAGE,
      rootCommitmentB64u: STABLE_ROOT_COMMITMENT,
    });
    expect(scheduledRoots[0].identity.projectId).toBe('project-2');

    const authenticated = await authenticateRestoreSessionV1(reloaded, {
      sessionToken: TOKEN,
      nowMs: NOW_MS + 1_000,
    });
    expect(authenticated?.actorUserId).toBe(ACTOR);
    const tokenRow = await database
      .prepare(
        `SELECT token_digest_b64u
           FROM tenant_root_security_restore_bootstrap_sessions
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4`,
      )
      .bind(NAMESPACE, ORG_ID, IDENTITY_DIGEST, DESTINATION_LINEAGE)
      .first<{ readonly token_digest_b64u: string }>();
    expect(tokenRow?.token_digest_b64u).not.toBe(TOKEN);
    expect(bootstrap.expiresAtMs).toBe(NOW_MS + 1_800_000);
  });
});

test('concurrent role acceptance preserves both receipts in the same restore session', async () => {
  await withDatabase(async (database) => {
    const stores = createStoreFactory(database);
    const store = stores(async () => ({
      kind: 'empty',
      deploymentFingerprintB64u: DESTINATION_FINGERPRINT,
    }));
    const plane = createControlPlane();
    await mintRestoreBootstrapSessionV1(store, {
      actorUserId: ACTOR,
      nowMs: NOW_MS,
      newSessionToken: () => TOKEN,
    });
    await startSession(store, plane);
    await registerRestoreManifestV1(store, plane, {
      manifestB64u: NATIVE_MANIFEST_B64U,
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    await issueKey(store, plane, 'deriver_a', 'concurrent-a');
    await issueKey(store, plane, 'deriver_b', 'concurrent-b');
    const authenticated = await requireAuthentication(store);
    const results = await Promise.all([
      importRestoreRoleShareV1(store, plane, {
        role: 'deriver_a',
        importEnvelopeB64u: 'envelope-a',
        authenticatedSession: authenticated,
        actorUserId: ACTOR,
        atIso: AT_ISO,
        nowMs: NOW_MS,
      }),
      importRestoreRoleShareV1(store, plane, {
        role: 'deriver_b',
        importEnvelopeB64u: 'envelope-b',
        authenticatedSession: authenticated,
        actorUserId: ACTOR,
        atIso: AT_ISO,
        nowMs: NOW_MS,
      }),
    ]);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
    const context = await store.readContext();
    expect(context.session).toMatchObject({
      status: 'verifying',
      installationReceipts: {
        deriverA: DERIVER_A_PUBLIC_KEY,
        deriverB: DERIVER_B_PUBLIC_KEY,
      },
    });
    expect(context.installedImports).toHaveLength(2);
  });
});

test('a late accepted response cannot repopulate a replaced restore session', async () => {
  await withDatabase(async (database) => {
    const readDestination = async (): Promise<TenantRootDestinationStateV1> => ({
      kind: 'empty',
      deploymentFingerprintB64u: DESTINATION_FINGERPRINT,
    });
    const store = createStoreFactory(database)(readDestination);
    const basePlane = createControlPlane();
    const pendingPlane: TenantRootRestoreControlPlaneV1 = {
      ...basePlane,
      issueRoleImportKey: async () => {
        throw new Error('simulated lost response');
      },
    };
    await startSession(store, basePlane);
    await registerRestoreManifestV1(store, basePlane, {
      manifestB64u: NATIVE_MANIFEST_B64U,
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    const pending = await issueKey(store, pendingPlane, 'deriver_a', 'old-operation');
    expect(pending).toMatchObject({
      ok: false,
      error: { kind: 'restore_role_import_unavailable' },
    });
    const oldEntry = await store.findRestoreRoleImportOperation('old-operation');
    if (oldEntry === null) throw new Error('expected the old operation to remain pending');
    const oldRecord = parseTenantRootOperationRecordV1(oldEntry.canonicalRecordJson);
    if (
      oldRecord === null ||
      oldRecord.operationKind !== 'tenant_root_restore_role_import_key_issue_v1'
    ) {
      throw new Error('expected the old restore operation record');
    }

    const lateNowMs = NOW_MS + TENANT_ROOT_RESTORE_SESSION_MS_V1 + 1;
    const staleContext = await store.readContext();
    await expect(
      expireRestoreSessionIfDueV1(store, basePlane, {
        context: staleContext,
        actorUserId: ACTOR,
        atIso: new Date(lateNowMs).toISOString(),
        nowMs: lateNowMs,
      }),
    ).resolves.toMatchObject({ kind: 'finalized' });

    await mintRestoreBootstrapSessionV1(store, {
      actorUserId: ACTOR,
      nowMs: lateNowMs,
      newSessionToken: () => 'replacement-token',
    });
    const replacementAuth = await authenticateRestoreSessionV1(store, {
      sessionToken: 'replacement-token',
      nowMs: lateNowMs,
    });
    if (replacementAuth === null) throw new Error('expected a replacement bootstrap session');
    const replacementSession = await startRestoreSessionV1(store, basePlane, {
      sessionId: REPLACEMENT_SESSION_ID,
      authenticatedSession: replacementAuth,
      atIso: new Date(lateNowMs).toISOString(),
      nowMs: lateNowMs,
    });
    expect(replacementSession.ok).toBe(true);
    await registerRestoreManifestV1(store, basePlane, {
      manifestB64u: NATIVE_MANIFEST_B64U,
      actorUserId: ACTOR,
      atIso: new Date(lateNowMs).toISOString(),
      nowMs: lateNowMs,
    });

    const staleKey: TenantRootRestoreRoleImportKeyV1 = {
      role: oldRecord.role,
      importKeyId: oldRecord.importKeyId,
      importPublicKeyB64u: DERIVER_A_PUBLIC_KEY,
      generation: oldRecord.generation,
      issuedAtMs: Date.parse(oldRecord.issuedAt),
      expiresAtMs: Date.parse(oldRecord.issuedAt) + 900_000,
    };
    await expect(
      store.finalizeRestoreRoleImportOperation({
        entry: oldEntry,
        response: {
          ...staleKey,
          operationDigestB64u: oldEntry.operationDigestB64u,
          commandDigestB64u: DERIVER_B_PUBLIC_KEY,
        },
        key: staleKey,
      }),
    ).rejects.toThrow(/finalization conflicted|compare-and-swap/u);
    expect(
      await store.finalizeRoleImport({
        sessionId: oldRecord.restoreSessionIdB64u,
        key: staleKey,
        installed: {
          role: oldRecord.role,
          envelopeDigestB64u: IDENTITY_DIGEST,
          receiptDigestB64u: DERIVER_A_PUBLIC_KEY,
        },
      }),
    ).toEqual({ kind: 'stale' });
    expect((await store.readContext()).installedImports).toEqual([]);
    expect((await store.readContext()).importKeys.deriver_a).toBeNull();
    expect((await store.findRestoreRoleImportOperation('old-operation'))?.status).toBe('pending');
  });
});

test('scopes restore rows by tenant and destination lineage', async () => {
  await withDatabase(async (database) => {
    const emptyDestination = async (): Promise<TenantRootDestinationStateV1> => ({
      kind: 'empty',
      deploymentFingerprintB64u: DESTINATION_FINGERPRINT,
    });
    const stores = createStoreFactory(database);
    const controlPlane = createControlPlane();
    const store = stores(emptyDestination);
    await startSession(store, controlPlane);
    await mintRestoreBootstrapSessionV1(store, {
      actorUserId: ACTOR,
      nowMs: NOW_MS,
      newSessionToken: () => TOKEN,
    });

    const scopeVariants = [
      { namespace: 'other-namespace' },
      { orgId: 'other-org' },
      { identityDigestB64u: 'other-identity' },
      { destinationLineageB64u: 'other-lineage' },
    ];
    for (const overrides of scopeVariants) {
      const otherTenant = createStoreFactory(database, overrides)(emptyDestination);
      const otherContext = await otherTenant.readContext();
      expect(otherContext.session).toBeNull();
      expect(
        await authenticateRestoreSessionV1(otherTenant, { sessionToken: TOKEN, nowMs: NOW_MS }),
      ).toBeNull();
    }

    const foreignManifest = await createControlPlane('other-identity').registerManifest({
      manifestB64u: NATIVE_MANIFEST_B64U,
    });
    await expect(store.putRegisteredManifest(foreignManifest, IDENTITY_DIGEST)).rejects.toThrow(
      /out of scope/u,
    );
  });
});

test('admits one initial session and rejects a concurrent different session', async () => {
  await withDatabase(async (database) => {
    const readDestination = async (): Promise<TenantRootDestinationStateV1> => ({
      kind: 'empty',
      deploymentFingerprintB64u: DESTINATION_FINGERPRINT,
    });
    const stores = createStoreFactory(database);
    const firstStore = stores(readDestination);
    await mintRestoreBootstrapSessionV1(firstStore, {
      actorUserId: ACTOR,
      nowMs: NOW_MS,
      newSessionToken: () => TOKEN,
    });
    const authenticatedSession = await authenticateRestoreSessionV1(firstStore, {
      sessionToken: TOKEN,
      nowMs: NOW_MS,
    });
    if (authenticatedSession === null) throw new Error('expected a live bootstrap session');

    const secondStore = stores(readDestination);
    const sessionA: TenantRootRestoreSessionV1 = {
      status: 'awaiting_manifest',
      sessionId: 'session-a',
      expiresAt: new Date(NOW_MS + TENANT_ROOT_RESTORE_SESSION_MS_V1).toISOString(),
      destinationFingerprintB64u: DESTINATION_FINGERPRINT,
    };
    const sessionB: TenantRootRestoreSessionV1 = {
      ...sessionA,
      sessionId: 'session-b',
    };
    const [first, second] = await Promise.all([
      firstStore.admitSessionStart({
        session: sessionA,
        authenticatedSession,
        expectedSessionId: null,
        nowMs: NOW_MS,
      }),
      secondStore.admitSessionStart({
        session: sessionB,
        authenticatedSession,
        expectedSessionId: null,
        nowMs: NOW_MS,
      }),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['session_in_progress', 'started']);
    const persisted = await secondStore.readContext();
    expect([sessionA.sessionId, sessionB.sessionId]).toContain(persisted.session?.sessionId);
  });
});

test('stale expiry cannot erase a newly admitted session manifest', async () => {
  await withDatabase(async (database) => {
    const readDestination = async (): Promise<TenantRootDestinationStateV1> => ({
      kind: 'empty',
      deploymentFingerprintB64u: DESTINATION_FINGERPRINT,
    });
    const stores = createStoreFactory(database);
    const store = stores(readDestination);
    const oldNow = NOW_MS - TENANT_ROOT_RESTORE_SESSION_MS_V1 - 1;
    await mintRestoreBootstrapSessionV1(store, {
      actorUserId: ACTOR,
      nowMs: oldNow,
      newSessionToken: () => 'old-token',
    });
    const oldAuth = await authenticateRestoreSessionV1(store, {
      sessionToken: 'old-token',
      nowMs: oldNow,
    });
    if (oldAuth === null) throw new Error('expected an old bootstrap session');
    const initial = await startRestoreSessionV1(store, createControlPlane(), {
      sessionId: 'old-session',
      authenticatedSession: oldAuth,
      atIso: AT_ISO,
      nowMs: oldNow,
    });
    expect(initial.ok).toBe(true);
    const staleContext = await store.readContext();

    const cleanupPlaneBase = createControlPlane();
    let cleanupEnteredCount = 0;
    let releaseFirstCleanup: () => void = () => undefined;
    let releaseSecondCleanup: () => void = () => undefined;
    const firstCleanupReleased = new Promise<void>((resolve) => {
      releaseFirstCleanup = resolve;
    });
    const secondCleanupReleased = new Promise<void>((resolve) => {
      releaseSecondCleanup = resolve;
    });
    let cleanupStarted: () => void = () => undefined;
    const bothCleanupsStarted = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    const cleanupPlane: TenantRootRestoreControlPlaneV1 = {
      ...cleanupPlaneBase,
      cleanupSession: async ({ restoreSessionId }) => {
        cleanupPlaneBase.calls.push(`cleanup:${restoreSessionId}`);
        cleanupEnteredCount += 1;
        if (cleanupEnteredCount === 2) cleanupStarted();
        if (cleanupEnteredCount === 1) await firstCleanupReleased;
        else await secondCleanupReleased;
        return {
          kind: 'complete',
          receipts: { deriverA: 'cleanup-a', deriverB: 'cleanup-b' },
        };
      },
    };
    const firstStaleExpiry = expireRestoreSessionIfDueV1(store, cleanupPlane, {
      context: staleContext,
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    const secondStaleExpiry = expireRestoreSessionIfDueV1(store, cleanupPlane, {
      context: staleContext,
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    await bothCleanupsStarted;
    releaseFirstCleanup();
    await expect(firstStaleExpiry).resolves.toMatchObject({ kind: 'finalized' });

    const newStore = stores(readDestination);
    await mintRestoreBootstrapSessionV1(newStore, {
      actorUserId: ACTOR,
      nowMs: NOW_MS,
      newSessionToken: () => 'new-token',
    });
    const newAuth = await authenticateRestoreSessionV1(newStore, {
      sessionToken: 'new-token',
      nowMs: NOW_MS,
    });
    if (newAuth === null) throw new Error('expected a new bootstrap session');
    const restarted = await startRestoreSessionV1(newStore, cleanupPlane, {
      sessionId: 'new-session',
      authenticatedSession: newAuth,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    expect(restarted).toMatchObject({ ok: true, value: { sessionId: 'new-session' } });
    const registered = await registerRestoreManifestV1(newStore, cleanupPlaneBase, {
      manifestB64u: NATIVE_MANIFEST_B64U,
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    expect(registered.ok).toBe(true);

    releaseSecondCleanup();
    await expect(secondStaleExpiry).resolves.toEqual({ kind: 'stale' });
    const persisted = await newStore.readContext();
    expect(persisted.session?.sessionId).toBe('new-session');
    expect(persisted.registeredManifest?.descriptor.identityDigestB64u).toBe(IDENTITY_DIGEST);
    expect(cleanupPlaneBase.calls).toEqual(['cleanup:old-session', 'cleanup:old-session']);
  });
});

test('register manifest uses the Router control-plane path and persists its complete descriptor shape', async () => {
  const requests: Request[] = [];
  const client = createTenantRootRestoreManifestClientV1({
    routerFetch: {
      fetch: async (input) => {
        requests.push(input instanceof Request ? input : new Request(input));
        return new Response(
          JSON.stringify({
            identity_digest_b64u: IDENTITY_DIGEST,
            source_custody_lineage_b64u: SOURCE_CUSTODY_LINEAGE,
            recovery_set_id_b64u: RECOVERY_SET_ID,
            stable_root_commitment_b64u: STABLE_ROOT_COMMITMENT,
            deriver_a: {
              share_id: 1,
              recipient_public_key_b64u: DERIVER_A_PUBLIC_KEY,
              recipient_fingerprint_b64u: DERIVER_A_FINGERPRINT,
              recovery_share_commitment_b64u: RECOVERY_SHARE_COMMITMENT_A,
              deriver_signing_key_id: 'deriver-a-signing-key',
            },
            deriver_b: {
              share_id: 2,
              recipient_public_key_b64u: DERIVER_B_PUBLIC_KEY,
              recipient_fingerprint_b64u: DERIVER_B_FINGERPRINT,
              recovery_share_commitment_b64u: RECOVERY_SHARE_COMMITMENT_B,
              deriver_signing_key_id: 'deriver-b-signing-key',
            },
            deriver_a_package_length: 128,
            deriver_a_package_digest_b64u: PACKAGE_DIGEST_A,
            deriver_b_package_length: 128,
            deriver_b_package_digest_b64u: PACKAGE_DIGEST_B,
            manifest_digest_b64u: SUBMITTED_MANIFEST_DIGEST,
            artifact_created_at_iso: '2026-08-29T10:20:30.123Z',
            trust_level: { kind: 'cryptographically_valid_offline' },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    },
    internalServiceAuthSecret: 'test-service-auth',
  });

  const registered = await client.registerManifest({ manifestB64u: NATIVE_MANIFEST_B64U });
  const request = requests[0];
  if (request === undefined) throw new Error('expected the control-plane request');
  expect(registered).toMatchObject({
    identityDigestB64u: IDENTITY_DIGEST,
    sourceCustodyLineageB64u: SOURCE_CUSTODY_LINEAGE,
    recoverySetId: RECOVERY_SET_ID,
    stableRootCommitmentB64u: STABLE_ROOT_COMMITMENT,
    deriverA: {
      shareId: 1,
      recipientPublicKeyB64u: DERIVER_A_PUBLIC_KEY,
      recipientFingerprintB64u: DERIVER_A_FINGERPRINT,
    },
    deriverB: {
      shareId: 2,
      recipientPublicKeyB64u: DERIVER_B_PUBLIC_KEY,
      recipientFingerprintB64u: DERIVER_B_FINGERPRINT,
    },
    deriverAPackageLength: 128,
    deriverBPackageLength: 128,
    manifestDigestB64u: SUBMITTED_MANIFEST_DIGEST,
  });
  expect(request?.url).toBe(
    'https://mpc-router.router-ab.internal/tenant-root-control-plane/restore/v1/register-manifest',
  );
  expect(request?.method).toBe('POST');
  expect(request?.redirect).toBe('manual');
  expect(request?.headers.get('x-router-ab-internal-service-auth')).toBe('test-service-auth');
  await expect(request.clone().json()).resolves.toEqual({ manifest_b64u: NATIVE_MANIFEST_B64U });
});

test('register manifest rejects a response with a swapped manifest digest', async () => {
  const client = createTenantRootRestoreManifestClientV1({
    routerFetch: {
      fetch: async () =>
        new Response(
          JSON.stringify({
            identity_digest_b64u: IDENTITY_DIGEST,
            source_custody_lineage_b64u: SOURCE_CUSTODY_LINEAGE,
            recovery_set_id_b64u: RECOVERY_SET_ID,
            stable_root_commitment_b64u: STABLE_ROOT_COMMITMENT,
            deriver_a: {
              share_id: 1,
              recipient_public_key_b64u: DERIVER_A_PUBLIC_KEY,
              recipient_fingerprint_b64u: DERIVER_A_FINGERPRINT,
              recovery_share_commitment_b64u: RECOVERY_SHARE_COMMITMENT_A,
              deriver_signing_key_id: 'deriver-a-signing-key',
            },
            deriver_b: {
              share_id: 2,
              recipient_public_key_b64u: DERIVER_B_PUBLIC_KEY,
              recipient_fingerprint_b64u: DERIVER_B_FINGERPRINT,
              recovery_share_commitment_b64u: RECOVERY_SHARE_COMMITMENT_B,
              deriver_signing_key_id: 'deriver-b-signing-key',
            },
            deriver_a_package_length: 128,
            deriver_a_package_digest_b64u: PACKAGE_DIGEST_A,
            deriver_b_package_length: 128,
            deriver_b_package_digest_b64u: PACKAGE_DIGEST_B,
            manifest_digest_b64u: IDENTITY_DIGEST,
            artifact_created_at_iso: '2026-08-29T10:20:30.123Z',
            trust_level: { kind: 'cryptographically_valid_offline' },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    },
    internalServiceAuthSecret: 'test-service-auth',
  });

  await expect(client.registerManifest({ manifestB64u: NATIVE_MANIFEST_B64U })).rejects.toEqual(
    expect.objectContaining({
      name: 'TenantRootRestoreManifestUnavailableError',
      reason: 'manifest_mismatch',
    } satisfies Partial<TenantRootRestoreManifestUnavailableError>),
  );
});
