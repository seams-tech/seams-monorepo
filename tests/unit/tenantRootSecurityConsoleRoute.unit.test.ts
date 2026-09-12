import { TenantRootSecurityStateUnavailableError } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stateReader';
import type { TenantRootSecurityStateReaderV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/consoleRoute';
import { expect, test } from '@playwright/test';
import type { ConsoleAuthAdapter } from '../../packages/console-server-ts/src/router/consoleAuth';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import type {
  TenantRootRecoveryGovernanceV1,
  TenantRootSecurityStatusV1,
} from '../../packages/shared-ts/src/tenant-root';
import { createTenantRootSecurityConsoleRouteV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/consoleRoute';
import type {
  TenantRootOperationCreateInputV1,
  TenantRootOperationEntryV1,
  TenantRootOperationStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';
import { parseTenantRootOperationTriggerV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';
import type { TenantRootAuditEventV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';
import type { TenantRootStepUpSessionRecordV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';

const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');
const ORG_ID = 'org-1';
const PROJECT_ID = 'project-2';
const ENV_ID = 'production';
const USER_ID = 'owner-1';

const GOVERNANCE: TenantRootRecoveryGovernanceV1 = {
  kind: 'single_owner_v1',
  acknowledgedByOwnerId: USER_ID,
  acknowledgedAt: '2026-08-01T00:00:00.000Z',
  warningVersion: 'tenant_root_single_owner_v1',
};

function identity() {
  const result = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    envId: ENV_ID,
    signingRootId: `${PROJECT_ID}:prod`,
    signingRootVersion: 'v3',
  });
  if (!result.ok) throw new Error('identity fixture is invalid');
  return result.value;
}

const STATUS: TenantRootSecurityStatusV1 = {
  identity: identity(),
  custodyLineageId: 'MTExMTExMTExMTExMTExMQ',
  lifecycleRevision: 7,
  operationalShares: {
    activeEpoch: 4,
    rootCommitmentFingerprintB64u: '6IKxMQFrUsHTM3CAGHz3aEI-_Mu1F7tJWrgSxBYP9E4',
    deriverAStatus: 'healthy',
    deriverBStatus: 'healthy',
    lastCompletedRotationAt: null,
    nextScheduledRotationAt: null,
    securityProfile: 'operational_rotation_v1',
    job: null,
  },
  recoveryBackup: { status: 'not_configured' },
  restore: null,
  trustLevel: { kind: 'cryptographically_valid_offline' },
};

class MemoryStore implements TenantRootOperationStoreV1 {
  readonly entries = new Map<string, TenantRootOperationEntryV1>();
  readonly byKey = new Map<string, string>();
  dispatchCount = 0;

  async findByIdempotencyKey(key: string) {
    const id = this.byKey.get(key);
    return id === undefined ? null : (this.entries.get(id) ?? null);
  }

  async findApproval() {
    return null;
  }

  async findApprovalRequestByIdempotencyKey() {
    return null;
  }

  async findApprovalRequestByDigest() {
    return null;
  }

  async putApprovalRequest() {
    throw new Error('rotation never waits for a second owner');
  }

  async listApprovalRequests() {
    return [];
  }

  async recordApproval() {
    throw new Error('rotation never takes an approval');
  }

  async consumeApprovalAndCreateOperation(input: TenantRootOperationCreateInputV1) {
    const entry: TenantRootOperationEntryV1 = {
      operationId: input.operationId,
      ...parseTenantRootOperationTriggerV1(input.operationKind, input.triggerKind),
      operationDigestB64u: input.operationDigestB64u,
      canonicalRecordJson: input.canonicalRecordJson,
      idempotencyKey: input.idempotencyKey,
      requesterUserId: input.requesterUserId,
      approverUserId: input.approverUserId,
      nonceB64u: input.nonceB64u,
      status: 'pending',
      createdAtMs: input.createdAtMs,
      authorizationExpiresAtMs: input.authorizationExpiresAtMs,
      acceptedResultJson: null,
      failureCode: null,
      dispatchUncertainAtMs: null,
    };
    this.entries.set(entry.operationId, entry);
    this.byKey.set(entry.idempotencyKey, entry.operationId);
    return entry;
  }

  async markDispatchUncertain(operationId: string, atMs: number) {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    const updated = { ...entry, dispatchUncertainAtMs: atMs };
    this.entries.set(operationId, updated);
    return updated;
  }
  async markFailed(operationId: string, failureCode: string) {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    const failed: TenantRootOperationEntryV1 = { ...entry, status: 'failed', failureCode };
    this.entries.set(operationId, failed);
    return failed;
  }

  async markAccepted(operationId: string, acceptedResultJson: string) {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    const accepted: TenantRootOperationEntryV1 = {
      ...entry,
      status: 'accepted',
      acceptedResultJson: entry.acceptedResultJson ?? acceptedResultJson,
    };
    this.entries.set(operationId, accepted);
    return accepted;
  }

  async markAuthorizationExpired(operationId: string) {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    return entry;
  }
}

function auth(role: 'OWNER' | 'MEMBER' = 'OWNER'): ConsoleAuthAdapter {
  return {
    authenticate: () => ({
      ok: true,
      claims: {
        userId: USER_ID,
        orgId: ORG_ID,
        platformSupport: false,
        membershipId: 'membership-1',
        role,
        authorizationVersion: 1,
        adminPermissions: [],
        projectAccess:
          role === 'OWNER'
            ? { kind: 'all' }
            : { kind: 'assigned', assignments: [{ projectId: PROJECT_ID, accessLevel: 'editor' }] },
        projectId: PROJECT_ID,
        environmentId: ENV_ID,
        sessionId: 'session-owner-1',
      },
    }),
  } as unknown as ConsoleAuthAdapter;
}

function stepUp(verifiedAtMs = NOW_MS - 30_000): TenantRootStepUpSessionRecordV1 {
  return {
    actorUserId: USER_ID,
    sessionId: 'session-owner-1',
    method: 'webauthn_platform_v1',
    verifiedAtMs,
  };
}

function buildRoute(options: {
  readStatus?: TenantRootSecurityStateReaderV1['readStatus'];
  store?: MemoryStore;
  stepUpRecord?: TenantRootStepUpSessionRecordV1 | null;
  onDispatch?: () => void;
  dispatchFails?: boolean;
  now?: () => number;
}) {
  const store = options.store ?? new MemoryStore();
  const events: TenantRootAuditEventV1[] = [];
  const route = createTenantRootSecurityConsoleRouteV1({
    auth: auth(),
    orgProjectEnv: {
      listEnvironments: async () => [
        { id: ENV_ID, projectId: PROJECT_ID, key: 'prod', runtimeVersion: 'v3' },
      ],
    } as never,
    stepUp: {
      readStepUp: async () =>
        options.stepUpRecord === undefined ? stepUp() : options.stepUpRecord,
    },
    state: {
      readStatus:
        options.readStatus ??
        (async () => ({
          status: STATUS,
          recoveryEnrollment: 'pending',
          recoveryDownloadHolders: { kind: 'unavailable' },
          identityDigestB64u: 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos',
          custodyLineageB64u: 'MTExMTExMTExMTExMTExMQ',
          governance: GOVERNANCE,
          governanceDigestB64u: 'hUXBekkP6CYYQtt4VJAzSMt0jTshXPte-Te5Q0uBKpc',
          rootCommitmentB64u: '6IKxMQFrUsHTM3CAGHz3aEI-_Mu1F7tJWrgSxBYP9E4',
        })),
    },
    operations: () => store,
  });
  return { route, store, events };
}

function rotationRequest(
  idempotencyKey = 'idempotency-1',
  headers: Record<string, string> = {},
): Request {
  return new Request('https://console.example/console/tenant-root/security/rotation', {
    method: 'POST',
    headers,
    body: JSON.stringify({ idempotencyKey }),
  });
}

test('reading status needs no step-up and never caches', async () => {
  const { route } = buildRoute({ stepUpRecord: null });
  const response = await route(
    new Request('https://console.example/console/tenant-root/security/status'),
  );
  expect(response?.status).toBe(200);
  expect(response?.headers.get('cache-control')).toBe('no-store');
  const body = (await response?.json()) as { ok: boolean; status: { lifecycleRevision: number } };
  expect(body.ok).toBe(true);
  expect(body.status.lifecycleRevision).toBe(7);
});

test('a caller naming another environment is refused rather than redirected', async () => {
  const { route } = buildRoute({ stepUpRecord: null });
  const mismatch = await route(
    new Request('https://console.example/console/tenant-root/security/status', {
      headers: { 'x-seams-environment': 'staging' },
    }),
  );
  expect(mismatch?.status).toBe(409);
  const body = (await mismatch?.json()) as { code: string; environmentId: string };
  expect(body.code).toBe('environment_mismatch');
  // The refusal names the environment the session actually resolves to.
  expect(body.environmentId).toBe(ENV_ID);

  const matching = await route(
    new Request('https://console.example/console/tenant-root/security/status', {
      headers: { 'x-seams-environment': ENV_ID },
    }),
  );
  expect(matching?.status).toBe(200);
});

test('rotation is not started here; this route reads', async () => {
  const { route, store } = buildRoute({});
  const attempted = await route(rotationRequest('idempotency-1', {}));
  expect(attempted?.status).toBe(405);
  expect(((await attempted?.json()) as { code: string }).code).toBe('method_not_allowed');
  // Nothing was dispatched: there is one rotation engine and it is elsewhere.
  expect(store.dispatchCount).toBe(0);
});

test('polling a rotation reads its durable operation by the id the caller submitted', async () => {
  const { route } = buildRoute({ stepUpRecord: null });

  const missing = await route(
    new Request('https://console.example/console/tenant-root/security/rotation'),
  );
  expect(missing?.status).toBe(400);
  expect(((await missing?.json()) as { code: string }).code).toBe('operation_id_required');

  const unknown = await route(
    new Request(
      'https://console.example/console/tenant-root/security/rotation?operationId=never-submitted',
    ),
  );
  expect(unknown?.status).toBe(200);
  expect(((await unknown?.json()) as { operation: unknown }).operation).toBeNull();
});

test('rotation, restore, and trust state are readable without step-up', async () => {
  const { route } = buildRoute({ stepUpRecord: null });
  const rotation = await route(
    new Request(
      'https://console.example/console/tenant-root/security/rotation?operationId=none-yet',
    ),
  );
  expect(rotation?.status).toBe(200);
  expect(((await rotation?.json()) as { operation: unknown }).operation).toBeNull();

  const restore = await route(
    new Request('https://console.example/console/tenant-root/security/restore'),
  );
  expect(((await restore?.json()) as { restore: unknown }).restore).toBeNull();

  const trust = await route(
    new Request('https://console.example/console/tenant-root/security/trust'),
  );
  expect(((await trust?.json()) as { trustLevel: { kind: string } }).trustLevel.kind).toBe(
    'cryptographically_valid_offline',
  );
});

async function unprovisionedRootStatus(): Promise<never> {
  throw new TenantRootSecurityStateUnavailableError();
}

async function failedRouterStatus(): Promise<never> {
  throw new Error('Router status unavailable');
}

test('an unprovisioned root is distinct from an upstream status failure', async () => {
  const missing = buildRoute({ readStatus: unprovisionedRootStatus });
  const response = await missing.route(
    new Request('https://console.example/console/tenant-root/security/status'),
  );
  expect(response?.status).toBe(404);
  expect(await response?.json()).toMatchObject({ ok: false, code: 'tenant_root_not_active' });
  const failed = buildRoute({ readStatus: failedRouterStatus });
  const failure = await failed.route(
    new Request('https://console.example/console/tenant-root/security/status'),
  );
  expect(failure?.status).toBe(502);
});
