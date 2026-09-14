import { test, expect } from '@playwright/test';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '@seams-internal/wallet-console-shared/apiKeyScopes';
import { createInMemoryConsoleApiKeyService } from '@seams-internal/console-server/apiKeys/index';
import {
  createRouterApiKeyAuthAdapter,
  createRouterApiPublishableKeyAuthAdapter,
} from '@seams-internal/wallet-console-server/router/routerApiKeyAuth';
import { createWalletConsoleOpsHandler } from '@seams-internal/wallet-console-server/serviceBinding/walletConsoleOpsHandler';
import { createWalletConsoleOpsClient } from '@seams/wallet-server/cloud-host';
import { createWalletConsoleRelayProxyExtensionV1 } from '@seams/wallet-server/cloud-host';
import { createWalletRuntimeOpsHandler } from '@seams/wallet-server/cloud-host';
import {
  createWalletControlClientBindings,
  handleWalletControlRequest,
  WALLET_CONTROL_AUTH_MARKER_V1,
} from '@seams/wallet-server/cloud-host';

async function getNoWalletIdentities() {
  return { identities: [] };
}
import type { RouterApiUsageMeterEvent } from '@seams/wallet-server/cloud-host';
import type { TenantRootIdentityV1 } from '@seams-internal/wallet-console-server/tenantRootCreation/types';

const CTX = {
  orgId: 'org-binding-test',
  actorUserId: 'user-binding-test',
  projectId: 'project-1',
  environmentId: 'env-1',
};

function buildTenantRootIdentity(): TenantRootIdentityV1 {
  const result = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: CTX.orgId,
    projectId: CTX.projectId,
    envId: CTX.environmentId,
    signingRootId: `${CTX.projectId}:${CTX.environmentId}`,
    signingRootVersion: 'runtime-v1',
  });
  if (!result.ok) throw new Error('tenant-root binding fixture is invalid');
  return result.value;
}

const TENANT_ROOT_IDENTITY = buildTenantRootIdentity();

function recordingBinding(requests: Request[]) {
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}

function bindingHarness() {
  const apiKeys = createInMemoryConsoleApiKeyService({
    scopeValidation: WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
  });
  const recorded: RouterApiUsageMeterEvent[] = [];
  const handler = createWalletConsoleOpsHandler({
    apiKeyAuth: createRouterApiKeyAuthAdapter(apiKeys),
    publishableKeyAuth: createRouterApiPublishableKeyAuthAdapter(apiKeys),
    usageMeter: {
      async recordEvent(event) {
        recorded.push(event);
      },
    },
    projectEnvironments: {
      async listEnvironments() {
        return [
          {
            id: CTX.environmentId,
            projectId: CTX.projectId,
            key: 'development',
            signingRootVersion: 'runtime-v1',
            status: 'ACTIVE',
          },
        ];
      },
    },
    tenantRootActiveLineage: {
      async resolveActiveLineage(identity) {
        if (
          identity.orgId !== TENANT_ROOT_IDENTITY.orgId ||
          identity.projectId !== TENANT_ROOT_IDENTITY.projectId ||
          identity.envId !== TENANT_ROOT_IDENTITY.envId ||
          identity.signingRootId !== TENANT_ROOT_IDENTITY.signingRootId ||
          identity.signingRootVersion !== TENANT_ROOT_IDENTITY.signingRootVersion
        ) {
          return null;
        }
        return {
          identityDigestB64u: 'identity-digest-1',
          custodyLineageB64u: 'custody-lineage-1',
        };
      },
    },
  });
  const client = createWalletConsoleOpsClient({
    async fetch(input, init) {
      const request = typeof input === 'string' ? new Request(input, init) : input;
      const response = await handler(request);
      if (!response) throw new Error(`unhandled internal path: ${request.url}`);
      return response;
    },
  });
  return { apiKeys, client, recorded, handler };
}

function rejectingTenantRootHandler() {
  return createWalletConsoleOpsHandler({
    apiKeyAuth: {
      async authenticate() {
        throw new Error('must not run');
      },
    },
    publishableKeyAuth: {
      async authenticate() {
        throw new Error('must not run');
      },
    },
    usageMeter: {
      async recordEvent() {
        throw new Error('must not run');
      },
    },
    projectEnvironments: {
      async listEnvironments() {
        throw new Error('must not run');
      },
    },
    tenantRootActiveLineage: {
      async resolveActiveLineage() {
        throw new Error('must not run');
      },
    },
  });
}

function tenantRootRequest(body: unknown): Request {
  return new Request(
    'https://wallet-console.internal/internal/wallet-console/v1/tenant-root/active-lineage',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function tenantRootClientForResponse(body: unknown, status: number) {
  return createWalletConsoleOpsClient({
    async fetch() {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  }).tenantRootActiveLineage;
}

test('secret-key auth round-trips through the exact binding operation', async () => {
  const { apiKeys, client } = bindingHarness();
  const created = await apiKeys.createApiKey(CTX, {
    kind: 'secret_key',
    name: 'binding-test',
    environmentId: CTX.environmentId,
    scopes: ['wallets.read'],
  });
  const result = await client.apiKeyAuth.authenticate({
    secret: created.secret,
    endpoint: '/v1/wallets',
    requiredScopes: ['wallets.read'],
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.principal.orgId).toBe(CTX.orgId);
    expect(result.principal.environmentId).toBe(CTX.environmentId);
    expect(result.principal.scopes).toContain('wallets.read');
  }
});

test('invalid secret key fails closed across the binding with status and code', async () => {
  const { client } = bindingHarness();
  const result = await client.apiKeyAuth.authenticate({
    secret: 'sk_not_a_real_secret',
    endpoint: '/v1/wallets',
    requiredScopes: ['wallets.read'],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect([401, 403]).toContain(result.status);
    expect(String(result.code)).toContain('secret_key');
  }
});

test('publishable-key auth enforces origin binding across the binding', async () => {
  const { apiKeys, client } = bindingHarness();
  const created = await apiKeys.createApiKey(CTX, {
    kind: 'publishable_key',
    name: 'binding-pub',
    environmentId: CTX.environmentId,
    allowedOrigins: ['https://app.example.com'],
    rateLimitBucket: 'default',
    quotaBucket: 'default',
  });
  const allowed = await client.publishableKeyAuth.authenticate({
    secret: created.secret,
    origin: 'https://app.example.com',
    environmentId: CTX.environmentId,
  });
  expect(allowed.ok).toBe(true);
  const blocked = await client.publishableKeyAuth.authenticate({
    secret: created.secret,
    origin: 'https://evil.example.com',
    environmentId: CTX.environmentId,
  });
  expect(blocked.ok).toBe(false);
});

test('usage events ingest through the binding with idempotency key preserved', async () => {
  const { client, recorded } = bindingHarness();
  await client.usageMeter.recordEvent({
    orgId: CTX.orgId,
    environmentId: CTX.environmentId,
    apiKeyId: 'key-1',
    endpoint: '/v1/wallets',
    walletId: 'wallet-1',
    action: 'wallet_created',
    succeeded: true,
    sourceEventId: 'evt-123',
  });
  expect(recorded).toHaveLength(1);
  expect(recorded[0].sourceEventId).toBe('evt-123');
  expect(recorded[0].action).toBe('wallet_created');
});

test('project environments decode into the exact Router API projection', async () => {
  const { client } = bindingHarness();
  await expect(
    client.projectEnvironments.listEnvironments({
      orgId: CTX.orgId,
      actorUserId: CTX.actorUserId,
      roles: [],
    }),
  ).resolves.toEqual([
    {
      id: CTX.environmentId,
      projectId: CTX.projectId,
      key: 'development',
      signingRootVersion: 'runtime-v1',
      status: 'ACTIVE',
    },
  ]);
});

test('active tenant-root lineage resolves through the exact private operation', async () => {
  const { client } = bindingHarness();
  await expect(
    client.tenantRootActiveLineage.resolveActiveLineage(TENANT_ROOT_IDENTITY),
  ).resolves.toEqual({
    identityDigestB64u: 'identity-digest-1',
    custodyLineageB64u: 'custody-lineage-1',
  });
});

test('active tenant-root lineage forwards only the canonical identity through the binding', async () => {
  const { handler } = bindingHarness();
  const response = await handler(
    tenantRootRequest({
      ...TENANT_ROOT_IDENTITY,
      envId: 'env-selected-by-caller',
    }),
  );
  expect(response?.status).toBe(404);
  await expect(response?.json()).resolves.toMatchObject({
    ok: false,
    code: 'tenant_root_active_lineage_not_found',
  });
});

test('active tenant-root lineage rejects missing, extra, and invalid identity fields', async () => {
  const handler = rejectingTenantRootHandler();
  const invalidBodies: readonly unknown[] = [
    {
      orgId: TENANT_ROOT_IDENTITY.orgId,
      projectId: TENANT_ROOT_IDENTITY.projectId,
      envId: TENANT_ROOT_IDENTITY.envId,
      signingRootId: TENANT_ROOT_IDENTITY.signingRootId,
    },
    { ...TENANT_ROOT_IDENTITY, extra: 'rejected' },
    { ...TENANT_ROOT_IDENTITY, envId: 17 },
  ];
  for (const body of invalidBodies) {
    const response = await handler(tenantRootRequest(body));
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      ok: false,
      code: 'invalid_body',
      message: 'A complete canonical tenant-root identity is required',
    });
  }
});

test('active tenant-root lineage returns null only for the exact not-found response', async () => {
  const resolver = tenantRootClientForResponse(
    {
      ok: false,
      code: 'tenant_root_active_lineage_not_found',
      message: 'No active tenant-root lineage exists for this identity',
    },
    404,
  );
  await expect(resolver.resolveActiveLineage(TENANT_ROOT_IDENTITY)).resolves.toBeNull();
});

test('active tenant-root lineage rejects malformed response branches', async () => {
  const malformedResponses: readonly unknown[] = [
    { ok: true, identityDigestB64u: 'identity-digest-1' },
    {
      ok: true,
      identityDigestB64u: 'identity-digest-1',
      custodyLineageB64u: 'custody-lineage-1',
      extra: 'rejected',
    },
    {
      ok: 'success',
      identityDigestB64u: 'identity-digest-1',
      custodyLineageB64u: 'custody-lineage-1',
    },
    {
      ok: true,
      identityDigestB64u: 17,
      custodyLineageB64u: 'custody-lineage-1',
    },
  ];
  for (const body of malformedResponses) {
    const resolver = tenantRootClientForResponse(body, 200);
    await expect(resolver.resolveActiveLineage(TENANT_ROOT_IDENTITY)).rejects.toThrow(
      /invalid response/,
    );
  }
});

test('unknown internal operations are rejected, never forwarded', async () => {
  const { client } = bindingHarness();
  await expect(
    client.usageMeter.recordEvent({
      orgId: '',
      environmentId: '',
      apiKeyId: '',
      endpoint: '/v1/wallets',
      walletId: '',
      action: 'wallet_created',
      succeeded: true,
    }),
  ).rejects.toThrow(/usage ingestion failed/);
});

test('public Console origins cannot invoke service-binding operations', async () => {
  const handler = createWalletConsoleOpsHandler({
    apiKeyAuth: {
      async authenticate() {
        throw new Error('must not run');
      },
    },
    publishableKeyAuth: {
      async authenticate() {
        throw new Error('must not run');
      },
    },
    usageMeter: {
      async recordEvent() {
        throw new Error('must not run');
      },
    },
    projectEnvironments: {
      async listEnvironments() {
        throw new Error('must not run');
      },
    },
    tenantRootActiveLineage: {
      async resolveActiveLineage() {
        throw new Error('must not run');
      },
    },
  });
  const response = await handler(
    new Request('https://staging.console.seams.sh/internal/wallet-console/v1/usage-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  expect(response).toBeNull();
});

test('split Gateway proxy preserves the complete Wallet Console relay surface', () => {
  const extension = createWalletConsoleRelayProxyExtensionV1({
    async fetch() {
      return new Response(null, { status: 204 });
    },
  });
  expect(extension.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
    'GET /v1/wallets',
    'GET /v1/wallets/search',
    'GET /v1/wallets/:id',
    'POST /signed-delegate',
    'POST /sponsorships/evm/call',
  ]);
});

test('Wallet runtime operations reject public Gateway origins', async () => {
  const handler = createWalletRuntimeOpsHandler(async () => {
    throw new Error('must not resolve public requests');
  });
  const response = await handler(
    new Request('https://staging.api.wallet.seams.sh/internal/wallet-runtime/v1/relayer-account', {
      method: 'POST',
    }),
  );
  expect(response).toBeNull();
});

test('Wallet runtime returns only the public identities requested by balance refresh', async () => {
  const handler = createWalletRuntimeOpsHandler(async () => ({
    async executeSignedDelegate() {
      return { ok: true };
    },
    async getRelayerAccount() {
      return { accountId: 'relayer.testnet', publicKey: 'ed25519:test' };
    },
    async getWalletIdentities(input) {
      expect(input).toEqual({
        orgId: 'org-wallet',
        wallets: [{ walletId: 'wallet-1', projectId: 'project-1' }],
      });
      return {
        identities: [
          {
            walletId: 'wallet-1',
            nearAccountId: 'alice.testnet',
            evmAddress: '0x1111111111111111111111111111111111111111',
          },
        ],
      };
    },
  }));
  const response = await handler(
    new Request('https://wallet-runtime.internal/internal/wallet-runtime/v1/wallet-identities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org-wallet',
        wallets: [{ walletId: 'wallet-1', projectId: 'project-1' }],
      }),
    }),
  );
  expect(response?.status).toBe(200);
  await expect(response?.json()).resolves.toEqual({
    identities: [
      {
        walletId: 'wallet-1',
        nearAccountId: 'alice.testnet',
        evmAddress: '0x1111111111111111111111111111111111111111',
      },
    ],
  });
});

test('Wallet runtime accepts the generated signed-delegate action shape', async () => {
  let received: unknown;
  const handler = createWalletRuntimeOpsHandler(async () => ({
    async executeSignedDelegate(input) {
      received = input;
      return { ok: true };
    },
    async getRelayerAccount() {
      return { accountId: 'relayer.testnet', publicKey: 'ed25519:test' };
    },
    getWalletIdentities: getNoWalletIdentities,
  }));
  const response = await handler(
    new Request(
      'https://wallet-runtime.internal/internal/wallet-runtime/v1/execute-signed-delegate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hash: 'hash-1',
          signedDelegate: {
            delegateAction: {
              senderId: 'alice.testnet',
              receiverId: 'contract.testnet',
              actions: [
                {
                  functionCall: {
                    methodName: 'ping',
                    args: [123],
                    gas: 30_000_000_000_000,
                    deposit: '0',
                  },
                },
              ],
              nonce: 1,
              maxBlockHeight: 10,
              publicKey: { keyType: 0, keyData: [1, 2, 3] },
            },
            signature: { keyType: 0, signatureData: [4, 5, 6] },
          },
        }),
      },
    ),
  );

  expect(response?.status).toBe(200);
  expect(received).toEqual({
    hash: 'hash-1',
    signedDelegate: {
      delegateAction: {
        senderId: 'alice.testnet',
        receiverId: 'contract.testnet',
        actions: [
          {
            functionCall: {
              methodName: 'ping',
              args: [123],
              gas: 30_000_000_000_000,
              deposit: '0',
            },
          },
        ],
        nonce: 1,
        maxBlockHeight: 10,
        publicKey: { keyType: 0, keyData: [1, 2, 3] },
      },
      signature: { keyType: 0, signatureData: [4, 5, 6] },
    },
  });
});

test('Wallet runtime normalizes canonical sponsored actions for relay execution', async () => {
  let received: unknown;
  const handler = createWalletRuntimeOpsHandler(async () => ({
    async executeSignedDelegate(input) {
      received = input;
      return { ok: true };
    },
    async getRelayerAccount() {
      return { accountId: 'relayer.testnet', publicKey: 'ed25519:test' };
    },
    getWalletIdentities: getNoWalletIdentities,
  }));
  const response = await handler(
    new Request(
      'https://wallet-runtime.internal/internal/wallet-runtime/v1/execute-signed-delegate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hash: 'hash-2',
          signedDelegate: {
            delegateAction: {
              senderId: 'alice.testnet',
              receiverId: 'contract.testnet',
              actions: [
                {
                  type: 'FunctionCall',
                  methodName: 'ping',
                  args: { value: 1 },
                  gas: '30000000000000',
                  deposit: '0',
                },
                { type: 'Transfer', amount: '7' },
              ],
              nonce: 2,
              maxBlockHeight: 11,
              publicKey: { keyType: 0, keyData: [1, 2, 3] },
            },
            signature: { keyType: 0, signatureData: [4, 5, 6] },
          },
        }),
      },
    ),
  );

  expect(response?.status).toBe(200);
  expect(received).toEqual({
    hash: 'hash-2',
    signedDelegate: {
      delegateAction: {
        senderId: 'alice.testnet',
        receiverId: 'contract.testnet',
        actions: [
          {
            functionCall: {
              methodName: 'ping',
              args: Array.from(new TextEncoder().encode('{"value":1}')),
              gas: 30_000_000_000_000,
              deposit: '0',
            },
          },
          { transfer: { deposit: '7' } },
        ],
        nonce: 2,
        maxBlockHeight: 11,
        publicKey: { keyType: 0, keyData: [1, 2, 3] },
      },
      signature: { keyType: 0, signatureData: [4, 5, 6] },
    },
  });
});

test('Wallet runtime rejects the retired actionsJson delegate shape before execution', async () => {
  let executed = false;
  const handler = createWalletRuntimeOpsHandler(async () => ({
    async executeSignedDelegate() {
      executed = true;
      return { ok: true };
    },
    async getRelayerAccount() {
      return { accountId: 'relayer.testnet', publicKey: 'ed25519:test' };
    },
    getWalletIdentities: getNoWalletIdentities,
  }));
  const response = await handler(
    new Request(
      'https://wallet-runtime.internal/internal/wallet-runtime/v1/execute-signed-delegate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hash: 'hash-legacy',
          signedDelegate: {
            delegateAction: {
              senderId: 'alice.testnet',
              receiverId: 'contract.testnet',
              actionsJson: '[]',
              nonce: 1,
              maxBlockHeight: 10,
              publicKey: { keyType: 0, keyData: [1, 2, 3] },
            },
            signature: { keyType: 0, signatureData: [4, 5, 6] },
          },
        }),
      },
    ),
  );

  expect(response?.status).toBe(400);
  expect(executed).toBe(false);
});

test('Wallet control binding admits an exact operation and injects Wallet-owned authentication', async () => {
  const routerRequests: Request[] = [];
  const controlPlaneRequests: Request[] = [];
  const deriverARequests: Request[] = [];
  const deriverBRequests: Request[] = [];
  const env = {
    MPC_ROUTER: recordingBinding(routerRequests),
    TENANT_ROOT_CONTROL_PLANE: recordingBinding(controlPlaneRequests),
    DERIVER_A: recordingBinding(deriverARequests),
    DERIVER_B: recordingBinding(deriverBRequests),
    ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: 'wallet-owned-secret',
  };
  const runtimeBinding = {
    async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
      const response = await handleWalletControlRequest(new Request(input, init), env);
      if (!response) throw new Error('Wallet control request was not handled');
      return response;
    },
  };
  const client = createWalletControlClientBindings(runtimeBinding);
  const response = await client.router.fetch(
    'https://mpc-router.router-ab.internal/router-ab/internal/tenant-root/status/v1/read',
    {
      method: 'POST',
      headers: { 'x-router-ab-internal-service-auth': WALLET_CONTROL_AUTH_MARKER_V1 },
      body: JSON.stringify({ identity: 'tenant-root-1' }),
    },
  );

  expect(response.ok).toBe(true);
  expect(routerRequests).toHaveLength(1);
  expect(routerRequests[0].headers.get('x-router-ab-internal-service-auth')).toBe(
    'wallet-owned-secret',
  );
  expect(controlPlaneRequests).toHaveLength(0);
  expect(deriverARequests).toHaveLength(0);
  expect(deriverBRequests).toHaveLength(0);
});

test('Wallet control binding rejects routes outside its declared operation set', async () => {
  const runtimeBinding = {
    async fetch(): Promise<Response> {
      throw new Error('unsupported operation must not reach the Wallet Runtime');
    },
  };
  const client = createWalletControlClientBindings(runtimeBinding);

  await expect(
    client.router.fetch('https://mpc-router.router-ab.internal/router-ab/internal/admin', {
      method: 'POST',
      body: '{}',
    }),
  ).rejects.toThrow(/Unsupported Wallet control operation/u);
});
