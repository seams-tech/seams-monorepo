import { expect, test } from '@playwright/test';
import { base64UrlEncode } from '@shared/utils/base64';
import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  encodeTenantRootIdentityV1,
} from '@seams-internal/shared-ts/tenant-root';
import {
  createTenantRootDestinationBootstrapClientV1,
  TenantRootDestinationBootstrapNetworkError,
  TenantRootDestinationBootstrapUnavailableError,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/destinationBootstrapClient';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';

const INTERNAL_SERVICE_AUTH = 'local-router-service-auth';
const BOOTSTRAP_TOKEN = 'local-destination-bootstrap-token';
const CUSTODY_LINEAGE_B64U = base64UrlEncode(new Uint8Array(16).fill(0x42));
const FINGERPRINT_A_B64U = base64UrlEncode(new Uint8Array(32).fill(0x51));
const FINGERPRINT_B_B64U = base64UrlEncode(new Uint8Array(32).fill(0x52));
const BOOTSTRAP_PATH =
  'https://mpc-router.router-ab.internal/router-ab/internal/tenant-root/destination-bootstrap/v1/read-auth';
const INTERNAL_SERVICE_AUTH_HEADER = 'x-router-ab-internal-service-auth';
const BOOTSTRAP_TOKEN_HEADER = 'x-seams-destination-bootstrap-token-v1';

function identity() {
  const built = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: 'org-destination-bootstrap-client',
    projectId: 'project-destination-bootstrap-client',
    envId: 'production',
    signingRootId: 'root-main',
    signingRootVersion: 'v1',
  });
  if (!built.ok) throw new Error('identity fixture is invalid');
  return built.value;
}

async function expectedScope(deploymentFingerprintB64u = FINGERPRINT_A_B64U) {
  const value = identity();
  return {
    identity_b64u: base64UrlEncode(encodeTenantRootIdentityV1(value)),
    identity_digest_b64u: await tenantRootIdentityDigestB64uV1(value),
    deployment_fingerprint_b64u: deploymentFingerprintB64u,
    custody_lineage_b64u: CUSTODY_LINEAGE_B64U,
  };
}

type RouterResponse = Response | (() => Response | Promise<Response>);

class RecordingRouter {
  readonly requests: Request[] = [];
  private responseIndex = 0;

  constructor(private readonly responses: readonly RouterResponse[]) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    this.requests.push(request);
    const response = this.responses[this.responseIndex++];
    if (!response) throw new Error('router fixture ran out of responses');
    return typeof response === 'function' ? await response() : response;
  }
}

function client(routerFetch: RecordingRouter) {
  return createTenantRootDestinationBootstrapClientV1({
    routerFetch,
    internalServiceAuthSecret: INTERNAL_SERVICE_AUTH,
    identity: identity(),
    custodyLineageB64u: CUSTODY_LINEAGE_B64U,
  });
}

async function requestBody(request: Request): Promise<unknown> {
  return await request.json();
}

test('read_ready becomes an empty destination with a validated public fingerprint', async () => {
  const scope = await expectedScope();
  const router = new RecordingRouter([async () => Response.json({ kind: 'read_ready', scope })]);

  const destination = await client(router).readDestination();

  expect(destination).toEqual({
    kind: 'empty',
    deploymentFingerprintB64u: FINGERPRINT_A_B64U,
  });
  expect(router.requests).toHaveLength(1);
  const request = router.requests[0];
  expect(request.url).toBe(BOOTSTRAP_PATH);
  expect(request.method).toBe('POST');
  expect(request.redirect).toBe('manual');
  expect(request.headers.get('content-type')).toBe('application/json');
  expect(request.headers.get(INTERNAL_SERVICE_AUTH_HEADER)).toBe(INTERNAL_SERVICE_AUTH);
  expect(request.headers.get(BOOTSTRAP_TOKEN_HEADER)).toBeNull();
  expect(await requestBody(request)).toEqual({
    kind: 'read',
    identity_b64u: scope.identity_b64u,
    custody_lineage_b64u: CUSTODY_LINEAGE_B64U,
  });
});

test('read refusals distinguish an active destination from unavailable state', async () => {
  for (const reason of ['active_root_present', 'destroyed'] as const) {
    const activeRouter = new RecordingRouter([
      async () => Response.json({ kind: 'read_refused', reason }),
    ]);
    await expect(client(activeRouter).readDestination()).resolves.toEqual({
      kind: 'active_root_present',
    });
  }

  for (const reason of ['uninitialized', 'creation_in_progress', 'scope_mismatch'] as const) {
    const router = new RecordingRouter([
      async () => Response.json({ kind: 'read_refused', reason }),
    ]);
    await expect(client(router).readDestination()).rejects.toMatchObject({
      code: 'tenant_root_destination_bootstrap_unavailable',
      reason: 'state_refused',
    });
  }
});

test('authentication reuses the read fingerprint and returns a capability principal', async () => {
  const scope = await expectedScope();
  const router = new RecordingRouter([
    async () => Response.json({ kind: 'read_ready', scope }),
    async () =>
      Response.json({ kind: 'authenticated', scope, authenticated_at_ms: 1_757_000_000_000 }),
  ]);

  const authenticated = await client(router).authenticate({ token: BOOTSTRAP_TOKEN });

  expect(authenticated).toEqual({
    ok: true,
    actorUserId: `destination-bootstrap:${FINGERPRINT_A_B64U}`,
  });
  expect(router.requests).toHaveLength(2);
  const authenticateRequest = router.requests[1];
  expect(authenticateRequest.redirect).toBe('manual');
  expect(authenticateRequest.headers.get(INTERNAL_SERVICE_AUTH_HEADER)).toBe(INTERNAL_SERVICE_AUTH);
  expect(authenticateRequest.headers.get(BOOTSTRAP_TOKEN_HEADER)).toBe(BOOTSTRAP_TOKEN);
  expect(await requestBody(authenticateRequest)).toEqual({
    kind: 'authenticate',
    identity_b64u: scope.identity_b64u,
    deployment_fingerprint_b64u: FINGERPRINT_A_B64U,
    custody_lineage_b64u: CUSTODY_LINEAGE_B64U,
  });
});

test('authentication rejects a fingerprint swapped between the read and auth responses', async () => {
  const readScope = await expectedScope(FINGERPRINT_A_B64U);
  const authScope = await expectedScope(FINGERPRINT_B_B64U);
  const router = new RecordingRouter([
    async () => Response.json({ kind: 'read_ready', scope: readScope }),
    async () => Response.json({ kind: 'authenticated', scope: authScope, authenticated_at_ms: 1 }),
  ]);

  await expect(client(router).authenticate({ token: BOOTSTRAP_TOKEN })).rejects.toMatchObject({
    code: 'tenant_root_destination_bootstrap_unavailable',
    reason: 'scope_mismatch',
  });
});

test('explicit authentication refusal returns false without exposing the credential', async () => {
  const scope = await expectedScope();
  const router = new RecordingRouter([
    async () => Response.json({ kind: 'read_ready', scope }),
    async () => Response.json({ kind: 'authentication_refused', reason: 'authentication_failed' }),
  ]);

  await expect(client(router).authenticate({ token: BOOTSTRAP_TOKEN })).resolves.toEqual({
    ok: false,
  });
  expect(router.requests[1].headers.get(BOOTSTRAP_TOKEN_HEADER)).toBe(BOOTSTRAP_TOKEN);
});

test('malformed responses and transport failures fail closed with distinct safe errors', async () => {
  const scope = await expectedScope();
  const malformedRouter = new RecordingRouter([
    async () => Response.json({ kind: 'read_ready', scope: { ...scope, unexpected: true } }),
  ]);
  await expect(client(malformedRouter).readDestination()).rejects.toMatchObject({
    code: 'tenant_root_destination_bootstrap_unavailable',
    reason: 'malformed_response',
  });

  const networkRouter = new RecordingRouter([
    async () => {
      throw new Error(`transport failed for ${BOOTSTRAP_TOKEN}`);
    },
  ]);
  const networkFailure = await client(networkRouter)
    .readDestination()
    .catch((error: unknown) => error);
  expect(networkFailure).toBeInstanceOf(TenantRootDestinationBootstrapNetworkError);
  expect(networkFailure).not.toHaveProperty('message', expect.stringContaining(BOOTSTRAP_TOKEN));
  expect(networkFailure).not.toBeInstanceOf(TenantRootDestinationBootstrapUnavailableError);
});

test('an active destination refuses authentication without sending the token', async () => {
  const router = new RecordingRouter([
    async () => Response.json({ kind: 'read_refused', reason: 'active_root_present' }),
  ]);

  await expect(client(router).authenticate({ token: BOOTSTRAP_TOKEN })).resolves.toEqual({
    ok: false,
  });
  expect(router.requests).toHaveLength(1);
  expect(router.requests[0].headers.get(BOOTSTRAP_TOKEN_HEADER)).toBeNull();
});
