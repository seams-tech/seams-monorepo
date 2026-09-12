import { parseTenantRootOperationRecordV1 } from '../../packages/shared-ts/src/tenant-root';
import { expect, test } from '@playwright/test';
import type {
  TenantRootRestoreCleanupEvidenceV1,
  TenantRootRestoreSessionV1,
  TenantRootTrustLevelV1,
} from '../../packages/shared-ts/src/tenant-root';
import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  tenantRootOperationDigestB64uV1,
} from '../../packages/shared-ts/src/tenant-root';
import type { TenantRootAuditEventV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';
import {
  createTenantRootRestoreConsoleRouteV1,
  TENANT_ROOT_BOOTSTRAP_HEADER_V1,
  TENANT_ROOT_RESTORE_SESSION_HEADER_V1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreRoute';
import type {
  TenantRootRestoreBootstrapSessionV1,
  TenantRootRestoreContextV1,
  TenantRootRestoreControlPlaneV1,
  TenantRootRestoreExpiredSessionFinalizationInputV1,
  TenantRootRestoreExpiredSessionFinalizationV1,
  TenantRootRestoreInstalledImportV1,
  TenantRootRestoreRegisteredManifestV1,
  TenantRootRestoreRefreshGrantAdmissionV1,
  TenantRootRestoreRefreshGrantScopeV1,
  TenantRootRestoreRoleImportKeyV1,
  TenantRootRestoreRoleImportOperationStoreV1,
  TenantRootRestoreSessionStartAdmissionInputV1,
  TenantRootRestoreSessionStartAdmissionV1,
  TenantRootRestoreStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreService';
import type {
  TenantRootRestoreRoleImportKeyIssueAdmissionInputV1,
  TenantRootRestoreRoleImportKeyIssueAdmissionV1,
  TenantRootRestoreRoleImportKeyIssueResponseV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreService';
import type { TenantRootOperationEntryV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';
import {
  signTenantRootRestoreRefreshGrantV1,
  type SignedTenantRootRestoreRefreshGrantV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreRefreshGrantSigner';
import { base64UrlEncode } from '../../packages/shared-ts/src/utils/base64';

const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');
const IDENTITY_DIGEST = '3FXFLfRtMWXk2dQjKkrEnNV9AnRg2zQwul3Z6TegCtU';
const DESTINATION_FINGERPRINT = 'ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A';
const DESTINATION_LINEAGE = 'ERITFBUWFxgZGhscHR4fIA';
const SESSION_ID = 'AQIDBAUGBwgJCgsMDQ4PEA';
const DERIVER_PUBLIC_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const COMMAND_DIGEST = 'ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A';
const RECOVERY_SET_ID = 'ERITFBUWFxgZGhscHR4fIA';
const MANIFEST_DIGEST = 'riFsLvUkejeCwTXvonmj5M3GEJQnD10r5YxiBLemEsk';
const TOKEN = 'destination-bootstrap-token';
const ARTIFACT_CREATED = '2026-08-29T10:20:30.123Z';
const RESTORE_REFRESH_SIGNING_SEED_B64U = base64UrlEncode(new Uint8Array(32).fill(0x71));

const OFFLINE: TenantRootTrustLevelV1 = { kind: 'cryptographically_valid_offline' };

class MemoryRestoreStore
  implements TenantRootRestoreStoreV1, TenantRootRestoreRoleImportOperationStoreV1
{
  session: TenantRootRestoreSessionV1 | null = null;
  manifest: TenantRootRestoreRegisteredManifestV1 | null = null;
  manifestB64u: string | null = null;
  keys: {
    deriver_a: TenantRootRestoreRoleImportKeyV1 | null;
    deriver_b: TenantRootRestoreRoleImportKeyV1 | null;
  } = { deriver_a: null, deriver_b: null };
  installed: TenantRootRestoreInstalledImportV1[] = [];
  refreshGrant: SignedTenantRootRestoreRefreshGrantV1 | null = null;
  readonly bootstrapSessions = new Map<string, TenantRootRestoreBootstrapSessionV1>();
  readonly operations = new Map<string, TenantRootOperationEntryV1>();

  async readContext(): Promise<TenantRootRestoreContextV1> {
    return {
      orgId: 'org-1',
      identityDigestB64u: IDENTITY_DIGEST,
      destination: { kind: 'empty', deploymentFingerprintB64u: DESTINATION_FINGERPRINT },
      destinationLineageB64u: DESTINATION_LINEAGE,
      session: this.session,
      registeredManifest:
        this.manifest === null || this.manifestB64u === null
          ? null
          : { descriptor: this.manifest, manifestB64u: this.manifestB64u },
      importKeys: { ...this.keys },
      installedImports: [...this.installed],
    };
  }
  async admitSessionStart(
    input: TenantRootRestoreSessionStartAdmissionInputV1,
  ): Promise<TenantRootRestoreSessionStartAdmissionV1> {
    const authenticated = this.bootstrapSessions.get(input.authenticatedSession.tokenDigestB64u);
    if (
      authenticated === undefined ||
      authenticated.actorUserId !== input.authenticatedSession.actorUserId ||
      authenticated.authenticatedAtMs !== input.authenticatedSession.authenticatedAtMs ||
      authenticated.expiresAtMs !== input.authenticatedSession.expiresAtMs ||
      authenticated.authenticatedAtMs > input.nowMs ||
      authenticated.expiresAtMs <= input.nowMs
    ) {
      return { kind: 'bootstrap_authentication_failed' };
    }
    if (this.session === null) {
      if (input.expectedSessionId !== null) return { kind: 'session_start_conflict' };
      await this.clearSessionMaterial();
      this.session = input.session;
      return { kind: 'started' };
    }
    if (this.session.status === 'cleanup_incomplete') {
      return { kind: 'cleanup_incomplete' };
    }
    if (this.session.status === 'expired' || this.session.status === 'failed_before_activation') {
      if (this.session.sessionId !== input.expectedSessionId) {
        return { kind: 'session_start_conflict' };
      }
      await this.clearSessionMaterial();
      this.session = input.session;
      return { kind: 'started' };
    }
    return JSON.stringify(this.session) === JSON.stringify(input.session)
      ? { kind: 'replayed' }
      : { kind: 'session_in_progress' };
  }
  async finalizeExpiredSession(
    input: TenantRootRestoreExpiredSessionFinalizationInputV1,
  ): Promise<TenantRootRestoreExpiredSessionFinalizationV1> {
    if (
      this.session === null ||
      this.session.sessionId !== input.expectedSessionId ||
      !(
        this.session.status === 'awaiting_manifest' ||
        this.session.status === 'awaiting_role_imports' ||
        this.session.status === 'verifying' ||
        this.session.status === 'ready_to_activate' ||
        this.session.status === 'refreshing'
      ) ||
      Date.parse(this.session.expiresAt) > input.nowMs
    ) {
      return { kind: 'stale' };
    }
    this.session = input.endedSession;
    await this.clearSessionMaterial();
    return { kind: 'finalized' };
  }
  async putSession(session: TenantRootRestoreSessionV1): Promise<void> {
    this.session = session;
  }
  async admitRestoreRefreshGrant(input: {
    readonly expectedSessionId: string;
    readonly grant: SignedTenantRootRestoreRefreshGrantV1;
    readonly nowMs: number;
  }): Promise<TenantRootRestoreRefreshGrantAdmissionV1> {
    const session = this.session;
    if (this.refreshGrant !== null) {
      return this.refreshGrant.restoreSessionIdB64u === input.expectedSessionId
        ? { kind: 'replayed', grant: this.refreshGrant }
        : { kind: 'conflict' };
    }
    if (
      session === null ||
      session.sessionId !== input.expectedSessionId ||
      (session.status !== 'verifying' && session.status !== 'ready_to_activate')
    ) {
      return { kind: 'session_not_ready' };
    }
    if (
      input.grant.destinationIdentityDigestB64u !== IDENTITY_DIGEST ||
      input.grant.destinationFingerprintB64u !== session.destinationFingerprintB64u ||
      input.grant.destinationLineageB64u !== DESTINATION_LINEAGE ||
      input.grant.restoreSessionIdB64u !== session.sessionId ||
      input.grant.manifestDigestB64u !== MANIFEST_DIGEST ||
      input.grant.deriverAAcceptanceReceiptDigestB64u !== session.installationReceipts.deriverA ||
      input.grant.deriverBAcceptanceReceiptDigestB64u !== session.installationReceipts.deriverB
    ) {
      return { kind: 'conflict' };
    }
    if (input.nowMs < input.grant.issuedAtMs || input.nowMs >= input.grant.expiresAtMs) {
      return { kind: 'expired' };
    }
    this.refreshGrant = input.grant;
    this.session = { ...session, status: 'refreshing' };
    return { kind: 'admitted', grant: input.grant };
  }
  async readRestoreRefreshGrant(
    sessionId: string,
  ): Promise<SignedTenantRootRestoreRefreshGrantV1 | null> {
    return this.refreshGrant?.restoreSessionIdB64u === sessionId ? this.refreshGrant : null;
  }
  async putRegisteredManifest(
    manifest: TenantRootRestoreRegisteredManifestV1,
    manifestB64u: string,
  ): Promise<void> {
    this.manifest = manifest;
    this.manifestB64u = manifestB64u;
  }
  async putRoleImportKey(key: TenantRootRestoreRoleImportKeyV1): Promise<void> {
    this.keys[key.role] = key;
  }
  async putInstalledImport(installed: TenantRootRestoreInstalledImportV1): Promise<void> {
    this.installed = [
      ...this.installed.filter((entry) => entry.role !== installed.role),
      installed,
    ];
  }
  async clearSessionMaterial(): Promise<void> {
    this.manifest = null;
    this.manifestB64u = null;
    this.refreshGrant = null;
    this.keys = { deriver_a: null, deriver_b: null };
    this.installed = [];
  }
  async putBootstrapSession(session: TenantRootRestoreBootstrapSessionV1): Promise<void> {
    this.bootstrapSessions.set(session.tokenDigestB64u, session);
  }
  async findBootstrapSession(digest: string): Promise<TenantRootRestoreBootstrapSessionV1 | null> {
    return this.bootstrapSessions.get(digest) ?? null;
  }

  async findRestoreRoleImportOperationForKey(
    role: 'deriver_a' | 'deriver_b',
    importKeyId: string,
  ): Promise<TenantRootOperationEntryV1 | null> {
    for (const entry of this.operations.values()) {
      const record = parseTenantRootOperationRecordV1(entry.canonicalRecordJson);
      if (
        entry.status === 'accepted' &&
        record?.operationKind === 'tenant_root_restore_role_import_key_issue_v1' &&
        record.role === role &&
        record.importKeyId === importKeyId
      )
        return entry;
    }
    return null;
  }
  async finalizeRoleImport(
    input: Parameters<TenantRootRestoreStoreV1['finalizeRoleImport']>[0],
  ): ReturnType<TenantRootRestoreStoreV1['finalizeRoleImport']> {
    const session = this.session;
    if (
      session === null ||
      session.sessionId !== input.sessionId ||
      session.status !== 'awaiting_role_imports' ||
      this.keys[input.installed.role]?.importKeyId !== input.key.importKeyId
    )
      return { kind: 'stale' };
    for (const installed of this.installed) {
      if (
        installed.role === input.installed.role &&
        installed.envelopeDigestB64u !== input.installed.envelopeDigestB64u
      )
        return { kind: 'stale' };
    }
    await this.putInstalledImport(input.installed);
    let receiptA: string | null = null;
    let receiptB: string | null = null;
    for (const installed of this.installed) {
      if (installed.role === 'deriver_a') receiptA = installed.receiptDigestB64u;
      else receiptB = installed.receiptDigestB64u;
    }
    if (receiptA !== null && receiptB !== null) {
      this.session = {
        status: 'verifying',
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        destinationFingerprintB64u: session.destinationFingerprintB64u,
        recoverySetId: session.recoverySetId,
        installationReceipts: { deriverA: receiptA, deriverB: receiptB },
      };
    } else {
      this.session = {
        status: 'awaiting_role_imports',
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        destinationFingerprintB64u: session.destinationFingerprintB64u,
        recoverySetId: session.recoverySetId,
        installed:
          input.installed.role === 'deriver_a'
            ? {
                kind: 'deriver_a_installed',
                deriverAReceiptDigestB64u: input.installed.receiptDigestB64u,
              }
            : {
                kind: 'deriver_b_installed',
                deriverBReceiptDigestB64u: input.installed.receiptDigestB64u,
              },
      };
    }
    return { kind: 'finalized', session: this.session };
  }
  async findRestoreRoleImportOperation(
    operationId: string,
  ): Promise<TenantRootOperationEntryV1 | null> {
    for (const entry of this.operations.values()) {
      if (entry.idempotencyKey === operationId) return entry;
    }
    return null;
  }

  async admitRestoreRoleImportOperation(
    input: TenantRootRestoreRoleImportKeyIssueAdmissionInputV1,
  ): Promise<TenantRootRestoreRoleImportKeyIssueAdmissionV1> {
    const existing = await this.findRestoreRoleImportOperation(
      input.operationRecord.idempotencyKey,
    );
    if (existing !== null) {
      return existing.operationDigestB64u === input.operationDigestB64u
        ? { kind: 'replayed', entry: existing }
        : { kind: 'idempotency_conflict' };
    }
    if (this.session?.status !== 'awaiting_role_imports') return { kind: 'session_not_started' };
    if (this.manifest === null) return { kind: 'manifest_not_registered' };
    const entry: TenantRootOperationEntryV1 = {
      operationId: input.operationDigestB64u,
      operationKind: input.operationRecord.operationKind,
      triggerKind: 'manual',
      operationDigestB64u: input.operationDigestB64u,
      canonicalRecordJson: input.canonicalRecordJson,
      idempotencyKey: input.operationRecord.idempotencyKey,
      requesterUserId: input.operationRecord.requesterActorId,
      approverUserId: null,
      nonceB64u: input.operationRecord.nonceB64u,
      status: 'pending',
      createdAtMs: Date.parse(input.operationRecord.issuedAt),
      authorizationExpiresAtMs: Date.parse(input.operationRecord.expiresAt),
      acceptedResultJson: null,
      failureCode: null,
      dispatchUncertainAtMs: null,
    };
    this.operations.set(entry.operationId, entry);
    return { kind: 'admitted', entry };
  }

  async markRestoreRoleImportDispatchUncertain(
    operationId: string,
    atMs: number,
  ): Promise<TenantRootOperationEntryV1> {
    const entry = this.operations.get(operationId);
    if (entry === undefined) throw new Error('operation missing');
    const updated = { ...entry, dispatchUncertainAtMs: atMs };
    this.operations.set(operationId, updated);
    return updated;
  }

  async finalizeRestoreRoleImportOperation(input: {
    readonly entry: TenantRootOperationEntryV1;
    readonly response: TenantRootRestoreRoleImportKeyIssueResponseV1;
    readonly key: TenantRootRestoreRoleImportKeyV1;
  }): Promise<TenantRootOperationEntryV1> {
    const entry = this.operations.get(input.entry.operationId);
    if (entry === undefined) throw new Error('operation missing');
    await this.putRoleImportKey(input.key);
    const updated: TenantRootOperationEntryV1 = {
      ...entry,
      status: 'accepted',
      acceptedResultJson: JSON.stringify(input.response),
    };
    this.operations.set(entry.operationId, updated);
    return updated;
  }

  async failRestoreRoleImportOperation(
    operationId: string,
    failureCode: string,
  ): Promise<TenantRootOperationEntryV1> {
    const entry = this.operations.get(operationId);
    if (entry === undefined) throw new Error('operation missing');
    const updated: TenantRootOperationEntryV1 = {
      ...entry,
      status: 'failed',
      acceptedResultJson: null,
      failureCode,
    };
    this.operations.set(operationId, updated);
    return updated;
  }
}

function createControlPlane(options: { readonly activationFailures?: number } = {}) {
  let activationFailures = options.activationFailures ?? 0;
  const activatedGrants: SignedTenantRootRestoreRefreshGrantV1[] = [];
  const cleanup: TenantRootRestoreCleanupEvidenceV1 = {
    bootstrap: { kind: 'destroyed', receiptDigestB64u: 'bootstrap-destruction-receipt' },
    roles: {
      kind: 'complete',
      receipts: { deriverA: 'clean-a', deriverB: 'clean-b' },
    },
  };
  const controlPlane: TenantRootRestoreControlPlaneV1 = {
    registerManifest: async () => ({
      sourceCustodyLineageB64u: DESTINATION_LINEAGE,
      recoverySetId: RECOVERY_SET_ID,
      stableRootCommitmentB64u: DERIVER_PUBLIC_KEY,
      deriverA: {
        shareId: 1,
        recipientPublicKeyB64u: DERIVER_PUBLIC_KEY,
        recipientFingerprintB64u: DERIVER_PUBLIC_KEY,
        recoveryShareCommitmentB64u: DERIVER_PUBLIC_KEY,
        deriverSigningKeyId: 'deriver-a-signing-key',
      },
      deriverB: {
        shareId: 2,
        recipientPublicKeyB64u: COMMAND_DIGEST,
        recipientFingerprintB64u: COMMAND_DIGEST,
        recoveryShareCommitmentB64u: COMMAND_DIGEST,
        deriverSigningKeyId: 'deriver-b-signing-key',
      },
      deriverAPackageLength: 128,
      deriverAPackageDigestB64u: DERIVER_PUBLIC_KEY,
      deriverBPackageLength: 128,
      deriverBPackageDigestB64u: COMMAND_DIGEST,
      manifestDigestB64u: MANIFEST_DIGEST,
      artifactCreatedAtIso: ARTIFACT_CREATED,
      trustLevel: OFFLINE,
      identityDigestB64u: IDENTITY_DIGEST,
    }),
    issueRoleImportKey: async (input) => ({
      role: input.operationRecord.role,
      importKeyId: input.operationRecord.importKeyId,
      importPublicKeyB64u: DERIVER_PUBLIC_KEY,
      generation: input.operationRecord.generation,
      issuedAtMs: Date.parse(input.operationRecord.issuedAt),
      expiresAtMs: Date.parse(input.operationRecord.issuedAt) + 900_000,
      operationDigestB64u: await tenantRootOperationDigestB64uV1(input.operationRecord),
      commandDigestB64u: COMMAND_DIGEST,
    }),
    acceptRoleImport: async (input) => ({
      receiptDigestB64u:
        input.operationRecord.role === 'deriver_a' ? DERIVER_PUBLIC_KEY : COMMAND_DIGEST,
    }),
    issueRestoreRefreshGrant: async (
      input: TenantRootRestoreRefreshGrantScopeV1,
    ): Promise<SignedTenantRootRestoreRefreshGrantV1> =>
      await signTenantRootRestoreRefreshGrantV1({
        ...input,
        grantKeyId: 'restore-refresh-test',
        signingSeedB64u: RESTORE_REFRESH_SIGNING_SEED_B64U,
      }),
    activate: async ({ grant }) => {
      activatedGrants.push(grant);
      if (activationFailures > 0) {
        activationFailures -= 1;
        throw new Error('simulated lost activation response');
      }
      return {
        destinationLineageId: 'destination-lineage-1',
        activatedEpoch: 1,
        activationReceiptB64u: 'canonical-activation-receipt',
        activationReceiptDigestB64u: 'activation-receipt',
        forwardRefreshReceiptDigestB64u: 'forward-refresh-receipt',
        continuityCanaryReceiptDigestB64u: 'continuity-canary-receipt',
        rootCommitmentMatches: true,
        cleanup,
      };
    },
    cleanupSession: async ({ restoreSessionId }) => {
      void restoreSessionId;
      return cleanup.roles;
    },
    cleanupActivatedRoot: async () => cleanup,
  };
  return { controlPlane, activatedGrants };
}

function buildRoute(options: { now?: () => number; activationFailures?: number } = {}) {
  const store = new MemoryRestoreStore();
  const written: TenantRootAuditEventV1[] = [];
  const { controlPlane, activatedGrants } = createControlPlane(options);
  let tokens = 0;
  const route = createTenantRootRestoreConsoleRouteV1({
    bootstrap: {
      authenticate: async (input) =>
        input.token === TOKEN ? { ok: true, actorUserId: 'destination-operator' } : { ok: false },
    },
    identity: (() => {
      const result = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
        orgId: 'org-1',
        projectId: 'project-1',
        envId: 'env-1',
        signingRootId: 'signing-root-1',
        signingRootVersion: '1',
      });
      if (!result.ok) throw new Error('expected a valid test identity');
      return result.value;
    })(),
    restore: store,
    controlPlane,
    audit: {
      write: async (event) => {
        written.push(event);
      },
    },
    now: options.now ?? (() => NOW_MS),
    newSessionId: () => SESSION_ID,
    newSessionToken: () => `restore-session-token-${(tokens += 1)}`,
  });
  return { route, store, written, activatedGrants };
}

function post(path: string, body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`https://destination.example${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://destination.example${path}`, { method: 'GET', headers });
}

async function json<T>(response: Response | null): Promise<T> {
  if (response === null) throw new Error('expected a response');
  return (await response.json()) as T;
}

/** Presents the bootstrap credential once and returns the session header. */
async function openSession(
  route: (request: Request) => Promise<Response | null>,
): Promise<Record<string, string>> {
  const opened = await route(
    post(
      '/console/tenant-root/security/restore/bootstrap-session',
      {},
      {
        [TENANT_ROOT_BOOTSTRAP_HEADER_V1]: TOKEN,
      },
    ),
  );
  expect(opened?.status).toBe(200);
  const { sessionToken } = await json<{ sessionToken: string }>(opened);
  return { [TENANT_ROOT_RESTORE_SESSION_HEADER_V1]: sessionToken };
}

test('a console session is not destination bootstrap authority', async () => {
  const { route, store, written } = buildRoute();

  // No credential at all, and a credential from somewhere else.
  expect(
    (await route(post('/console/tenant-root/security/restore/bootstrap-session')))?.status,
  ).toBe(401);
  expect(
    (
      await route(
        post(
          '/console/tenant-root/security/restore/bootstrap-session',
          {},
          {
            [TENANT_ROOT_BOOTSTRAP_HEADER_V1]: 'session-cookie',
          },
        ),
      )
    )?.status,
  ).toBe(401);
  // The credential itself is not a session for the other routes.
  expect(
    (
      await route(
        post(
          '/console/tenant-root/security/restore',
          {},
          {
            [TENANT_ROOT_BOOTSTRAP_HEADER_V1]: TOKEN,
          },
        ),
      )
    )?.status,
  ).toBe(401);
  expect(store.session).toBeNull();
  expect(written).toHaveLength(0);
});

test('a restore runs bootstrap, start, manifest, keys, both imports, then activation', async () => {
  const { route, store, written } = buildRoute();
  const session = await openSession(route);

  expect((await route(post('/console/tenant-root/security/restore', {}, session)))?.status).toBe(
    200,
  );
  expect(store.session?.status).toBe('awaiting_manifest');

  expect(
    (
      await route(
        post(
          '/console/tenant-root/security/restore/manifest',
          { manifestB64u: 'manifest' },
          session,
        ),
      )
    )?.status,
  ).toBe(200);
  expect(store.session?.status).toBe('awaiting_role_imports');
  expect(store.manifest?.trustLevel).toEqual(OFFLINE);

  for (const role of ['deriver_a', 'deriver_b'] as const) {
    const key = await route(
      post(
        '/console/tenant-root/security/restore/import-key',
        { role, operationId: `operation-${role}` },
        session,
      ),
    );
    expect(key?.status).toBe(200);
    const issued = await json<{
      importKeyId: string;
      importPublicKeyB64u: string;
      destinationLineageB64u: string;
      restoreSessionIdB64u: string;
      expiresAtMs: number;
    }>(key);
    expect(issued.importPublicKeyB64u).toBe(DERIVER_PUBLIC_KEY);
    expect(issued.destinationLineageB64u).toBe(DESTINATION_LINEAGE);
    expect(issued.restoreSessionIdB64u).toBe(SESSION_ID);
    expect(issued.expiresAtMs).toBe(NOW_MS + 900_000);

    const response = await route(
      post(
        '/console/tenant-root/security/restore/import',
        { role, importEnvelopeB64u: `envelope-${role}` },
        session,
      ),
    );
    expect(response?.status).toBe(200);
  }
  expect(store.session?.status).toBe('verifying');

  // The status read is available to the session, and never caches.
  const status = await route(get('/console/tenant-root/security/restore/status', session));
  expect(status?.status).toBe(200);
  expect(status?.headers.get('cache-control')).toBe('no-store');
  expect((await json<{ session: { status: string } }>(status)).session.status).toBe('verifying');

  // The registered manifest verified offline, so the caller must acknowledge
  // that; it cannot assert a stronger trust result.
  const unacknowledged = await route(
    post(
      '/console/tenant-root/security/restore/activate',
      { trustLevel: { kind: 'current_trust_confirmed' } },
      session,
    ),
  );
  expect(unacknowledged?.status).toBe(409);
  expect((await json<{ error: { kind: string } }>(unacknowledged)).error.kind).toBe(
    'offline_trust_acknowledgement_required',
  );

  const activated = await route(
    post(
      '/console/tenant-root/security/restore/activate',
      { acknowledgeOfflineTrust: true },
      session,
    ),
  );
  expect(activated?.status).toBe(200);
  expect(store.session?.status).toBe('active');
  // An omitted disposition becomes retained-as-backup, never something stronger.
  if (store.session?.status === 'active') {
    expect(store.session.sourceDisposition.kind).toBe('retained_as_backup');
    if (store.session.sourceDisposition.kind === 'retained_as_backup') {
      expect(store.session.sourceDisposition.acknowledgedByUserId).toBe('destination-operator');
    }
    expect(store.session.destinationLineageId).toBe('destination-lineage-1');
  }
  expect(written.map((event) => event.action)).toContain('offline_trust_acknowledged');
});

test('activation retry reuses the exact persisted refresh grant', async () => {
  const { route, store, activatedGrants } = buildRoute({ activationFailures: 1 });
  const session = await openSession(route);
  await route(post('/console/tenant-root/security/restore', {}, session));
  await route(
    post('/console/tenant-root/security/restore/manifest', { manifestB64u: 'manifest' }, session),
  );
  for (const role of ['deriver_a', 'deriver_b'] as const) {
    await route(
      post(
        '/console/tenant-root/security/restore/import-key',
        { role, operationId: `operation-${role}` },
        session,
      ),
    );
    await route(
      post(
        '/console/tenant-root/security/restore/import',
        { role, importEnvelopeB64u: `envelope-${role}` },
        session,
      ),
    );
  }

  const firstAttempt = await route(
    post(
      '/console/tenant-root/security/restore/activate',
      { acknowledgeOfflineTrust: true },
      session,
    ),
  );
  expect(firstAttempt?.status).toBe(400);
  expect(store.session?.status).toBe('refreshing');
  const persistedGrant = store.refreshGrant;
  const retry = await route(
    post(
      '/console/tenant-root/security/restore/activate',
      { acknowledgeOfflineTrust: true },
      session,
    ),
  );
  expect(retry?.status).toBe(200);
  expect(activatedGrants).toEqual([persistedGrant, persistedGrant]);
  expect(store.session?.status).toBe('active');
});

test('activation cannot claim a verified source retirement', async () => {
  const { route, store } = buildRoute();
  const session = await openSession(route);
  await route(post('/console/tenant-root/security/restore', {}, session));
  await route(
    post('/console/tenant-root/security/restore/manifest', { manifestB64u: 'manifest' }, session),
  );
  for (const role of ['deriver_a', 'deriver_b'] as const) {
    await route(
      post(
        '/console/tenant-root/security/restore/import-key',
        { role, operationId: `operation-${role}` },
        session,
      ),
    );
    await route(
      post(
        '/console/tenant-root/security/restore/import',
        { role, importEnvelopeB64u: `envelope-${role}` },
        session,
      ),
    );
  }

  const response = await route(
    post(
      '/console/tenant-root/security/restore/activate',
      {
        acknowledgeOfflineTrust: true,
        sourceDisposition: {
          kind: 'verified_retired',
          recordedByUserId: 'destination-operator',
          recordedAt: '2026-09-05T12:00:00.000Z',
        },
      },
      session,
    ),
  );
  expect(response?.status).toBe(400);
  expect(store.session?.status).toBe('verifying');
});

test('activation needs the bootstrap credential presented within five minutes', async () => {
  let nowMs = NOW_MS;
  const { route, store } = buildRoute({ now: () => nowMs });
  const session = await openSession(route);
  await route(post('/console/tenant-root/security/restore', {}, session));
  await route(
    post('/console/tenant-root/security/restore/manifest', { manifestB64u: 'manifest' }, session),
  );
  for (const role of ['deriver_a', 'deriver_b'] as const) {
    await route(
      post(
        '/console/tenant-root/security/restore/import-key',
        { role, operationId: `operation-${role}` },
        session,
      ),
    );
    await route(
      post(
        '/console/tenant-root/security/restore/import',
        { role, importEnvelopeB64u: `envelope-${role}` },
        session,
      ),
    );
  }

  // The session is still live, but its credential was presented too long ago.
  nowMs = NOW_MS + 300_001;
  const stale = await route(
    post(
      '/console/tenant-root/security/restore/activate',
      { acknowledgeOfflineTrust: true },
      session,
    ),
  );
  expect(stale?.status).toBe(409);
  expect((await json<{ error: { kind: string } }>(stale)).error.kind).toBe(
    'bootstrap_reauthentication_stale',
  );
  expect(store.session?.status).toBe('verifying');

  // Presenting the credential again mints a fresh session that may activate.
  const fresh = await openSession(route);
  const activated = await route(
    post(
      '/console/tenant-root/security/restore/activate',
      { acknowledgeOfflineTrust: true },
      fresh,
    ),
  );
  expect(activated?.status).toBe(200);
  expect(store.session?.status).toBe('active');
});

test('status uses GET while mutation GET and unrelated paths are refused', async () => {
  const { route } = buildRoute();
  const mutationGet = await route(
    new Request('https://destination.example/console/tenant-root/security/restore', {
      method: 'GET',
      headers: { [TENANT_ROOT_BOOTSTRAP_HEADER_V1]: TOKEN },
    }),
  );
  expect(mutationGet?.status).toBe(405);
  expect((await route(post('/console/tenant-root/security/restore/status')))?.status).toBe(405);
  expect(await route(post('/console/policies'))).toBeNull();
});
