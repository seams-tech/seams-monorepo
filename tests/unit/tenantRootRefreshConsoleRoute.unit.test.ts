import { createD1TenantRootOperationStoreV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/d1';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';
import { tenantRootOperationMaxLifetimeMsV1 } from '../../packages/shared-ts/src/tenant-root';
import { createTenantRootSecurityStateReaderV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stateReader';
import { expect, test } from '@playwright/test';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import { createInMemoryConsoleOrgProjectEnvService } from '../../packages/console-server-ts/src/orgProjectEnv/service';
import type { ConsoleAuthClaims } from '../../packages/console-server-ts/src/router/consoleAuth';
import {
  createTenantRootRefreshConsoleRouteV1,
  type TenantRootRefreshConsoleRouteDependenciesV1,
  type TenantRootRefreshRouterRequestV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootCreation/consoleRoute';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import type {
  TenantRootCreationGrantRecordV1,
  TenantRootIdentityV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootCreation/types';
import type { TenantRootStepUpSessionRecordV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';
import type { TenantRootAuditEventV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';

const ORG_ID = 'org-refresh-test';
const USER_ID = 'operator-refresh-test';
const PROJECT_ID = 'project-refresh-test';
const ENVIRONMENT_ID = `${PROJECT_ID}:dev`;
const CUSTODY_LINEAGE_B64U = 'custody-lineage-refresh-test';
const SESSION_ID = 'session-refresh-test';

function claimsFor(role: ConsoleAuthClaims['role']): ConsoleAuthClaims {
  const common = {
    userId: USER_ID,
    orgId: ORG_ID,
    membershipId: 'membership-refresh-test',
    authorizationVersion: 1,
    platformSupport: false,
    projectId: PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
    sessionId: SESSION_ID,
  };
  if (role === 'MEMBER') {
    return {
      ...common,
      role,
      adminPermissions: [],
      projectAccess: { kind: 'assigned', assignments: [] },
    };
  }
  return {
    ...common,
    role,
    adminPermissions: [],
    projectAccess: { kind: 'all' },
  };
}

async function createEnvironmentService() {
  const service = createInMemoryConsoleOrgProjectEnvService();
  await service.upsertOrganization(
    { orgId: ORG_ID, actorUserId: USER_ID },
    { name: 'Refresh Test Organization' },
  );
  await service.createProject(
    { orgId: ORG_ID, actorUserId: USER_ID },
    { id: PROJECT_ID, name: 'Refresh Test Project' },
  );
  return service;
}

function activeGrant(
  identity: TenantRootIdentityV1,
  identityDigestB64u: string,
): TenantRootCreationGrantRecordV1 {
  return {
    namespace: 'refresh-test',
    operationId: 'creation-operation-refresh-test',
    identity,
    identityDigestB64u,
    custodyLineageB64u: CUSTODY_LINEAGE_B64U,
    grantNonceB64u: 'grant-nonce-refresh-test',
    grantKeyId: 'grant-key-refresh-test',
    grantB64u: 'grant-refresh-test',
    grantDigestB64u: 'grant-digest-refresh-test',
    issuedAtMs: 1,
    expiresAtMs: 2,
    createdAtMs: 1,
    updatedAtMs: 1,
    status: 'ACTIVE',
    ready: {
      revision: 1,
      rootCommitmentB64u: 'root-commitment-refresh-test',
      journalDigestB64u: 'journal-digest-refresh-test',
      capabilityDigestB64u: 'capability-digest-refresh-test',
    },
  };
}

function expectedIdentity(): TenantRootIdentityV1 {
  const result = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    envId: ENVIRONMENT_ID,
    signingRootId: `${PROJECT_ID}:dev`,
    signingRootVersion: 'default',
  });
  if (!result.ok) throw new Error('expected tenant-root identity fixture is invalid');
  return result.value;
}

function successfulRouterRefreshResponse(): Response {
  return new Response(
    JSON.stringify({
      activation_receipt_digest_b64u: 'activation-receipt-refresh-test',
      lifecycle_revision: 2,
      retirement: { kind: 'confirmed' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function notDueRouterRefreshResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 'tenant_root_refresh_not_due',
      next_run_at_ms: NOW_MS + 86_400_000,
    }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  );
}

function unverifiedRouterRefreshResponse(): Response {
  return new Response(
    JSON.stringify({
      activation_receipt_digest_b64u: 'activation-receipt-refresh-unverified',
      lifecycle_revision: 2,
      retirement: { kind: 'unverified' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const NOW_MS = Date.parse('2026-09-06T12:00:00.000Z');

/** A step-up reader returning one record, so the freshness rule is what varies. */
function stepUpReader(record: TenantRootStepUpSessionRecordV1 | null) {
  return {
    async readStepUp() {
      return record;
    },
  };
}

function freshStepUp(): TenantRootStepUpSessionRecordV1 {
  return {
    actorUserId: USER_ID,
    sessionId: SESSION_ID,
    method: 'webauthn_platform_v1',
    verifiedAtMs: NOW_MS - 30_000,
  };
}

class RefreshStatusRouter {
  async fetch(request: Request): Promise<Response> {
    const binding = await request.json();
    return Response.json({
      identity_digest_b64u: binding.identity_digest_b64u,
      custody_lineage_b64u: binding.custody_lineage_b64u,
      root_commitment_b64u: 'root-commitment-refresh-test',
      activation_receipt_digest_b64u: 'activation-receipt-refresh-test',
      deriver_a_status: 'healthy',
      deriver_b_status: 'healthy',
      lifecycle_revision: 1,
      active_epoch: 1,
      last_refresh_completed_at_ms: null,
    });
  }
}

const databases: ReturnType<typeof createTemporaryD1Database>[] = [];
test.afterEach(() => {
  for (const database of databases.splice(0)) cleanupTemporaryD1Database(database.tempDir);
});

async function createRoute(
  role: ConsoleAuthClaims['role'] = 'OWNER',
  routerResponse: () => Response = successfulRouterRefreshResponse,
  stepUp: TenantRootStepUpSessionRecordV1 | null = freshStepUp(),
  audit?: { write(event: TenantRootAuditEventV1): Promise<void> },
): Promise<{
  readonly route: (request: Request) => Promise<Response | null>;
  readonly lookup: { identity: TenantRootIdentityV1; identityDigestB64u: string }[];
  readonly forwarded: Request[];
}> {
  const temporary = createTemporaryD1Database();
  databases.push(temporary);
  await applyD1MigrationFiles(temporary.database, listD1MigrationFiles('d1-console'));
  const orgProjectEnv = await createEnvironmentService();
  const lookup: { identity: TenantRootIdentityV1; identityDigestB64u: string }[] = [];
  const forwarded: Request[] = [];
  const dependencies: TenantRootRefreshConsoleRouteDependenciesV1 = {
    auth: { authenticate: () => ({ ok: true, claims: claimsFor(role) }) },
    orgProjectEnv,
    state: createTenantRootSecurityStateReaderV1({
      internalServiceAuthSecret: 'test-service-auth',
      router: new RefreshStatusRouter(),
      activeRoots: {
        async resolveActiveLineage(identity) {
          const identityDigestB64u = await tenantRootIdentityDigestB64uV1(identity);
          lookup.push({ identity, identityDigestB64u });
          const record = activeGrant(identity, identityDigestB64u);
          if (record.status !== 'ACTIVE') return null;
          return {
            identityDigestB64u,
            custodyLineageB64u: record.custodyLineageB64u,
            rootCommitmentB64u: record.ready.rootCommitmentB64u,
            restore: null,
          };
        },
      },
    }),
    router: {
      async fetch(input, init) {
        forwarded.push(new Request(input, init));
        return routerResponse();
      },
    },
    internalServiceAuthSecret: 'router-internal-refresh-test',
    stepUp: stepUpReader(stepUp),
    operations: (scope) =>
      createD1TenantRootOperationStoreV1({
        database: temporary.database,
        namespace: 'refresh-test',
        now: () => NOW_MS,
        ...scope,
      }),
    audit: audit ?? { async write() {} },
    now: () => NOW_MS,
  };
  return { route: createTenantRootRefreshConsoleRouteV1(dependencies), lookup, forwarded };
}

test('refresh route resolves active lineage and forwards only the bounded Router request', async () => {
  const { route, lookup, forwarded } = await createRoute();
  const response = await route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      body: JSON.stringify({ operationId: 'refresh-operation-test' }),
    }),
  );

  expect(response?.status, await response?.clone().text()).toBe(200);
  await expect(response?.json()).resolves.toEqual({
    ok: true,
    status: 'ACTIVE',
    activationReceiptDigestB64u: 'activation-receipt-refresh-test',
    lifecycleRevision: 2,
  });
  expect(lookup).toHaveLength(1);
  expect(forwarded).toHaveLength(1);
  const identity = expectedIdentity();
  const identityDigestB64u = await tenantRootIdentityDigestB64uV1(identity);
  expect(lookup[0]).toEqual({ identity, identityDigestB64u });
  expect(forwarded[0]?.url).toBe(
    'https://mpc-router.router-ab.internal/router-ab/internal/tenant-root/refresh/v1/execute',
  );
  expect(forwarded[0]?.method).toBe('POST');
  expect(forwarded[0]?.headers.get('x-router-ab-internal-service-auth')).toBe(
    'router-internal-refresh-test',
  );
  await expect(forwarded[0]?.json()).resolves.toEqual({
    operation_id: 'refresh-operation-test',
    expected_lifecycle_revision: 1,
    expires_at_ms:
      NOW_MS + tenantRootOperationMaxLifetimeMsV1('tenant_root_operational_share_rotation_v1'),
    identity_digest_b64u: identityDigestB64u,
    custody_lineage_b64u: CUSTODY_LINEAGE_B64U,
    trigger: 'manual',
  });
});

test('refresh route requires projects.manage authorization before resolving lineage', async () => {
  const { route, lookup, forwarded } = await createRoute('ADMIN');
  const response = await route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      body: JSON.stringify({ operationId: 'refresh-operation-forbidden' }),
    }),
  );

  expect(response?.status).toBe(403);
  await expect(response?.json()).resolves.toMatchObject({ ok: false, code: 'forbidden' });
  expect(lookup).toHaveLength(0);
  expect(forwarded).toHaveLength(0);
});

test('refresh route rejects missing or smuggled request selectors', async () => {
  const { route, lookup, forwarded } = await createRoute();
  const response = await route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      body: JSON.stringify({
        operationId: 'refresh-operation-smuggled',
        identity_digest_b64u: 'caller-identity',
        custody_lineage_b64u: 'caller-lineage',
        authority_id: 'caller-authority',
        role: 'deriver_a',
        now_ms: 1,
        signer_key_id: 'caller-signer',
        mode: 'emergency',
      }),
    }),
  );

  expect(response?.status).toBe(400);
  await expect(response?.json()).resolves.toMatchObject({ ok: false, code: 'invalid_request' });
  expect(lookup).toHaveLength(0);
  expect(forwarded).toHaveLength(0);
});

const boundedRefreshRequest: TenantRootRefreshRouterRequestV1 = {
  operation_id: 'refresh-operation-type-test',
  expected_lifecycle_revision: 1,
  expires_at_ms: NOW_MS,
  identity_digest_b64u: 'identity-digest-type-test',
  custody_lineage_b64u: 'custody-lineage-type-test',
  trigger: 'manual',
};

void boundedRefreshRequest;

const refreshRequestWithAuthority: TenantRootRefreshRouterRequestV1 = {
  ...boundedRefreshRequest,
  // @ts-expect-error The Router request cannot carry caller-selected authority.
  authority_id: 'caller-authority',
};

void refreshRequestWithAuthority;

// @ts-expect-error A refresh must retain its operation identity across retries.
const refreshRequestWithoutOperation: TenantRootRefreshRouterRequestV1 = {
  expected_lifecycle_revision: 1,
  expires_at_ms: NOW_MS,
  identity_digest_b64u: 'identity-digest-type-test',
  custody_lineage_b64u: 'custody-lineage-type-test',
};

void refreshRequestWithoutOperation;

function throttledRouterRefreshResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 'tenant_root_refresh_throttled',
      retry_at_ms: 1_800_000_000_000,
    }),
    { status: 429 },
  );
}

function inProgressRouterRefreshResponse(): Response {
  return new Response(JSON.stringify({ code: 'tenant_root_refresh_in_progress' }), { status: 409 });
}

function invalidRetryRouterRefreshResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 'tenant_root_refresh_throttled',
      retry_at_ms: '1800000000000',
    }),
    { status: 429 },
  );
}

test('refresh route preserves server cooldown and in-progress outcomes and rejects malformed retry times', async () => {
  const throttled = await createRoute('OWNER', throttledRouterRefreshResponse);
  const cooldown = await throttled.route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      body: JSON.stringify({ operationId: 'refresh-throttled' }),
    }),
  );
  expect(cooldown?.status).toBe(429);
  expect(cooldown?.headers.get('Retry-After')).toBe(new Date(1_800_000_000_000).toUTCString());
  await expect(cooldown?.json()).resolves.toMatchObject({
    ok: false,
    code: 'tenant_root_refresh_throttled',
    retryAtMs: 1_800_000_000_000,
  });

  const pending = await createRoute('OWNER', inProgressRouterRefreshResponse);
  const conflict = await pending.route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      body: JSON.stringify({ operationId: 'refresh-conflict' }),
    }),
  );
  expect(conflict?.status).toBe(409);
  await expect(conflict?.json()).resolves.toMatchObject({
    ok: false,
    code: 'tenant_root_refresh_in_progress',
  });
  const replay = await pending.route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      body: JSON.stringify({ operationId: 'refresh-conflict' }),
    }),
  );
  await expect(replay?.json()).resolves.toMatchObject({
    code: 'tenant_root_refresh_in_progress',
    replayed: true,
  });
  expect(pending.forwarded).toHaveLength(1);

  const invalid = await createRoute('OWNER', invalidRetryRouterRefreshResponse);
  const rejected = await invalid.route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      body: JSON.stringify({ operationId: 'refresh-invalid-time' }),
    }),
  );
  expect(rejected?.status).toBe(502);
});

test('a scheduled refresh refusal records not-due and exposes the next run time', async () => {
  const written: TenantRootAuditEventV1[] = [];
  const { route } = await createRoute('OWNER', notDueRouterRefreshResponse, freshStepUp(), {
    async write(event) {
      written.push(event);
    },
  });
  const response = await route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      body: JSON.stringify({ operationId: 'operation-not-due' }),
    }),
  );

  expect(response?.status).toBe(409);
  await expect(response?.json()).resolves.toMatchObject({
    ok: false,
    code: 'tenant_root_refresh_not_due',
    nextRunAtMs: NOW_MS + 86_400_000,
    next_scheduled_rotation_at_ms: NOW_MS + 86_400_000,
  });
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({
    action: 'rotation_failed',
    outcome: 'failure',
    failureCode: 'tenant_root_refresh_not_due',
  });
});

test('an unverified Router replay records activation without claiming retired roles', async () => {
  const written: TenantRootAuditEventV1[] = [];
  const { route } = await createRoute('OWNER', unverifiedRouterRefreshResponse, freshStepUp(), {
    async write(event) {
      written.push(event);
    },
  });
  const response = await route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      body: JSON.stringify({ operationId: 'operation-unverified' }),
    }),
  );

  expect(response?.status).toBe(200);
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({ action: 'rotation_activated', outcome: 'success' });
  expect(written.some((event) => event.action === 'rotation_retired')).toBe(false);
});

test('refresh refuses a rotation with no recorded step-up', async () => {
  const { route, lookup, forwarded } = await createRoute(
    'OWNER',
    successfulRouterRefreshResponse,
    null,
  );
  const response = await route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'operation-no-step-up' }),
    }),
  );
  expect(response?.status).toBe(403);
  expect(await response?.json()).toMatchObject({
    ok: false,
    code: 'step_up_required',
    error: { kind: 'no_step_up_recorded' },
  });
  // Refused before the tenant root is resolved or the Router is touched.
  expect(lookup).toHaveLength(0);
  expect(forwarded).toHaveLength(0);
});

test('refresh refuses step-up that is stale or from another session', async () => {
  const stale = await createRoute('OWNER', successfulRouterRefreshResponse, {
    actorUserId: USER_ID,
    sessionId: SESSION_ID,
    method: 'webauthn_platform_v1',
    verifiedAtMs: NOW_MS - 300_001,
  });
  const staleResponse = await stale.route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'operation-stale' }),
    }),
  );
  expect(staleResponse?.status).toBe(403);
  expect(await staleResponse?.json()).toMatchObject({ error: { kind: 'stale' } });
  expect(stale.forwarded).toHaveLength(0);

  const otherSession = await createRoute('OWNER', successfulRouterRefreshResponse, {
    actorUserId: USER_ID,
    sessionId: 'session-somewhere-else',
    method: 'webauthn_platform_v1',
    verifiedAtMs: NOW_MS - 30_000,
  });
  const otherResponse = await otherSession.route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'operation-other-session' }),
    }),
  );
  expect(otherResponse?.status).toBe(403);
  expect(await otherResponse?.json()).toMatchObject({ error: { kind: 'session_mismatch' } });
  expect(otherSession.forwarded).toHaveLength(0);
});

test('a rotation and a refusal both produce an audit event', async () => {
  const written: TenantRootAuditEventV1[] = [];
  const audit = {
    async write(event: TenantRootAuditEventV1) {
      written.push(event);
    },
  };

  const { route } = await createRoute(
    'OWNER',
    successfulRouterRefreshResponse,
    freshStepUp(),
    audit,
  );
  const ok = await route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'operation-audited' }),
    }),
  );
  expect(ok?.status).toBe(200);
  expect(written).toHaveLength(3);
  expect(written[0]).toMatchObject({
    action: 'rotation_activated',
    outcome: 'success',
    orgId: ORG_ID,
    actorUserId: USER_ID,
    receiptDigestB64u: 'activation-receipt-refresh-test',
    authorization: {
      stepUpMethod: 'webauthn_platform_v1',
      operationDigestB64u: expect.any(String),
    },
  });
  expect(written.slice(1)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: 'rotation_retired',
        role: 'deriver_a',
        receiptDigestB64u: null,
      }),
      expect.objectContaining({
        action: 'rotation_retired',
        role: 'deriver_b',
        receiptDigestB64u: null,
      }),
    ]),
  );

  // A Router refusal is recorded too, not swallowed.
  written.length = 0;
  const throttled = await createRoute(
    'OWNER',
    () =>
      new Response(
        JSON.stringify({ code: 'tenant_root_refresh_throttled', retry_at_ms: NOW_MS + 60_000 }),
        {
          status: 429,
          headers: { 'content-type': 'application/json' },
        },
      ),
    freshStepUp(),
    audit,
  );
  await throttled.route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'operation-throttled' }),
    }),
  );
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({ action: 'rotation_failed', outcome: 'failure' });
});

test('a refused step-up never reaches the audit writer', async () => {
  const written: TenantRootAuditEventV1[] = [];
  const audit = {
    async write(event: TenantRootAuditEventV1) {
      written.push(event);
    },
  };
  const { route } = await createRoute('OWNER', successfulRouterRefreshResponse, null, audit);
  const response = await route(
    new Request('https://console.test/console/tenant-root/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'operation-no-step-up' }),
    }),
  );
  expect(response?.status).toBe(403);
  // Nothing was attempted, so there is nothing to record.
  expect(written).toHaveLength(0);
});
