import { expect, test } from '@playwright/test';
import { base64UrlEncode } from '../../packages/shared-ts/src/utils/base64';
import { sha256Bytes } from '../../packages/shared-ts/src/utils/digests';
import {
  createTenantRootRestoreControlPlaneClientV1,
  TenantRootRestoreActivationNetworkError,
  TenantRootRestoreActivationUnavailableError,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/tenantRootRestoreControlPlaneClient';
import type { TenantRootRestoreRefreshGrantScopeV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreService';
import type { SignedTenantRootRestoreRefreshGrantV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreRefreshGrantSigner';

const INTERNAL_SERVICE_AUTH = 'local-router-service-auth';
const GRANT_KEY_ID = 'restore-refresh-authority-v1';
const SIGNING_SEED_B64U = repeatedBytes(32, 0x71);
const DESTINATION_LINEAGE_B64U = repeatedBytes(16, 0x14);
const ACTIVATION_PATH =
  'https://mpc-router.router-ab.internal/router-ab/internal/tenant-root/restore/v1/activate';
const CLEANUP_PATH =
  'https://mpc-router.router-ab.internal/router-ab/internal/tenant-root/restore/v1/cleanup';
const INTERNAL_SERVICE_AUTH_HEADER = 'x-router-ab-internal-service-auth';

function repeatedBytes(length: number, value: number): string {
  return base64UrlEncode(new Uint8Array(length).fill(value));
}

function manifestBytes(): Uint8Array {
  return Uint8Array.from([0x53, 0x45, 0x41, 0x4d, 0x53, 0x52, 0x49, 0x31]);
}

function manifestB64u(): string {
  return base64UrlEncode(manifestBytes());
}

async function manifestDigestB64u(): Promise<string> {
  return base64UrlEncode(await sha256Bytes(manifestBytes()));
}

async function refreshGrantScope(): Promise<TenantRootRestoreRefreshGrantScopeV1> {
  return {
    operationDigestB64u: repeatedBytes(32, 0x11),
    destinationIdentityDigestB64u: repeatedBytes(32, 0x12),
    destinationFingerprintB64u: repeatedBytes(32, 0x13),
    destinationLineageB64u: DESTINATION_LINEAGE_B64U,
    restoreSessionIdB64u: repeatedBytes(16, 0x16),
    manifestDigestB64u: await manifestDigestB64u(),
    deriverAAcceptanceReceiptDigestB64u: repeatedBytes(32, 0x17),
    deriverBAcceptanceReceiptDigestB64u: repeatedBytes(32, 0x18),
    nonceB64u: repeatedBytes(32, 0x19),
    issuedAtMs: 1_757_000_000_000,
    expiresAtMs: 1_757_000_100_000,
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

function client(
  routerFetch: RecordingRouter,
  overrides: Partial<{
    grantKeyId: string;
    grantSigningSeedB64u: string;
  }> = {},
) {
  return createTenantRootRestoreControlPlaneClientV1({
    routerFetch,
    internalServiceAuthSecret: INTERNAL_SERVICE_AUTH,
    grantKeyId: overrides.grantKeyId ?? GRANT_KEY_ID,
    grantSigningSeedB64u: overrides.grantSigningSeedB64u ?? SIGNING_SEED_B64U,
  });
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  return (await request.json()) as Record<string, unknown>;
}

function activationResponse(
  overrides: Partial<{
    destination_lineage_id: string;
    activated_epoch: number;
    activation_receipt_digest_b64u: string;
    forward_refresh_receipt_digest_b64u: string;
    continuity_canary_receipt_digest_b64u: string;
    root_commitment_matches: boolean;
    cleanup: Record<string, unknown>;
  }> = {},
): Record<string, unknown> {
  return {
    destination_lineage_id: DESTINATION_LINEAGE_B64U,
    activated_epoch: 1,
    activation_receipt_b64u: repeatedBytes(64, 0x20),
    activation_receipt_digest_b64u: repeatedBytes(32, 0x21),
    forward_refresh_receipt_digest_b64u: repeatedBytes(32, 0x22),
    continuity_canary_receipt_digest_b64u: repeatedBytes(32, 0x23),
    root_commitment_matches: true,
    cleanup: {
      bootstrap: {
        kind: 'destroyed',
        receipt_digest_b64u: repeatedBytes(32, 0x24),
      },
      roles: {
        kind: 'complete',
        receipts: {
          deriver_a: repeatedBytes(32, 0x25),
          deriver_b: repeatedBytes(32, 0x26),
        },
      },
    },
    ...overrides,
  };
}

async function issuedGrant(): Promise<SignedTenantRootRestoreRefreshGrantV1> {
  const scope = await refreshGrantScope();
  return await client(new RecordingRouter([])).issueRestoreRefreshGrant(scope);
}

test('activation reuses the persisted grant bytes and omits recovery-set duplication', async () => {
  const scope = await refreshGrantScope();
  const issuingClient = client(new RecordingRouter([]));
  const persistedGrant = await issuingClient.issueRestoreRefreshGrant(scope);
  const router = new RecordingRouter([async () => Response.json(activationResponse())]);

  const activated = await client(router).activate({
    grant: persistedGrant,
    manifestB64u: manifestB64u(),
  });

  expect(activated).toEqual({
    destinationLineageId: DESTINATION_LINEAGE_B64U,
    activatedEpoch: 1,
    activationReceiptB64u: repeatedBytes(64, 0x20),
    activationReceiptDigestB64u: repeatedBytes(32, 0x21),
    forwardRefreshReceiptDigestB64u: repeatedBytes(32, 0x22),
    continuityCanaryReceiptDigestB64u: repeatedBytes(32, 0x23),
    rootCommitmentMatches: true,
    cleanup: {
      bootstrap: {
        kind: 'destroyed',
        receiptDigestB64u: repeatedBytes(32, 0x24),
      },
      roles: {
        kind: 'complete',
        receipts: {
          deriverA: repeatedBytes(32, 0x25),
          deriverB: repeatedBytes(32, 0x26),
        },
      },
    },
  });
  expect(router.requests).toHaveLength(1);
  const request = router.requests[0];
  expect(request.url).toBe(ACTIVATION_PATH);
  expect(request.method).toBe('POST');
  expect(request.redirect).toBe('manual');
  expect(request.headers.get('content-type')).toBe('application/json');
  expect(request.headers.get(INTERNAL_SERVICE_AUTH_HEADER)).toBe(INTERNAL_SERVICE_AUTH);
  expect(await requestBody(request)).toEqual({
    restore_refresh_grant_b64u: persistedGrant.grantB64u,
    manifest_b64u: manifestB64u(),
  });
});

test('activation accepts a persisted grant after the local signing key rotates', async () => {
  const persistedGrant = await issuedGrant();
  const router = new RecordingRouter([async () => Response.json(activationResponse())]);

  await expect(
    client(router, {
      grantKeyId: 'restore-refresh-authority-v2',
      grantSigningSeedB64u: repeatedBytes(32, 0x72),
    }).activate({
      grant: persistedGrant,
      manifestB64u: manifestB64u(),
    }),
  ).resolves.toMatchObject({ destinationLineageId: DESTINATION_LINEAGE_B64U });
  expect(await requestBody(router.requests[0])).toEqual({
    restore_refresh_grant_b64u: persistedGrant.grantB64u,
    manifest_b64u: manifestB64u(),
  });
});

test('cleanup retry sends durable activation evidence and parses exact cleanup branches', async () => {
  const cleanupResponse = {
    bootstrap: {
      kind: 'destroyed',
      receipt_digest_b64u: repeatedBytes(32, 0x24),
    },
    roles: {
      kind: 'deriver_a_incomplete',
      deriver_b_receipt_digest_b64u: repeatedBytes(32, 0x25),
      outstanding: {
        roles: ['deriver_a'],
        description: 'Deriver A material remains',
      },
    },
  };
  const router = new RecordingRouter([async () => Response.json(cleanupResponse)]);
  const activationEvidence = {
    rootCommitmentB64u: repeatedBytes(32, 0x28),
    destinationFingerprintB64u: repeatedBytes(32, 0x13),
    destinationLineageId: DESTINATION_LINEAGE_B64U,
    activatedEpoch: 1,
    activationReceiptB64u: repeatedBytes(64, 0x20),
    activationReceiptDigestB64u: repeatedBytes(32, 0x21),
    forwardRefreshReceiptDigestB64u: repeatedBytes(32, 0x22),
    continuityCanaryReceiptDigestB64u: repeatedBytes(32, 0x23),
    sourceDisposition: {
      kind: 'retained_as_backup' as const,
      acknowledgedByUserId: 'owner-1',
      incidentResponseNote: 'source retained',
      recordedAt: '2026-09-05T12:00:00.000Z',
    },
    tenantHeldRecoverySet: {
      recoverySetId: repeatedBytes(16, 0x26),
      manifestDigestB64u: repeatedBytes(32, 0x27),
    },
  };
  const cleanup = await client(router).cleanupActivatedRoot({
    restoreSessionId: 'restore-session',
    activationEvidence,
    bootstrapCleanup: {
      kind: 'outstanding',
      outstanding: { roles: ['deriver_a'], description: 'bootstrap remains' },
    },
    roleCleanup: {
      kind: 'both_roles_incomplete',
      outstanding: { roles: ['deriver_a', 'deriver_b'], description: 'roles remain' },
    },
  });
  expect(cleanup).toEqual({
    bootstrap: { kind: 'destroyed', receiptDigestB64u: repeatedBytes(32, 0x24) },
    roles: {
      kind: 'deriver_a_incomplete',
      deriverBReceiptDigestB64u: repeatedBytes(32, 0x25),
      outstanding: { roles: ['deriver_a'], description: 'Deriver A material remains' },
    },
  });
  expect(router.requests[0].url).toBe(CLEANUP_PATH);
  expect(await requestBody(router.requests[0])).toEqual({
    kind: 'post_activation',
    activation_receipt_b64u: repeatedBytes(64, 0x20),
    cleanup: {
      bootstrap: {
        kind: 'outstanding',
        outstanding: { roles: ['deriver_a'], description: 'bootstrap remains' },
      },
      roles: {
        kind: 'both_roles_incomplete',
        outstanding: { roles: ['deriver_a', 'deriver_b'], description: 'roles remain' },
      },
    },
  });
});

test('a lost activation response fails with a retryable network error and sends once', async () => {
  const persistedGrant = await issuedGrant();
  const router = new RecordingRouter([
    async () => {
      throw new Error('connection lost after the Router committed the grant');
    },
  ]);

  const failure = await client(router)
    .activate({
      grant: persistedGrant,
      manifestB64u: manifestB64u(),
    })
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(TenantRootRestoreActivationNetworkError);
  expect(failure).toMatchObject({ code: 'tenant_root_restore_activation_network_failure' });
  expect(failure).not.toHaveProperty('message', expect.stringContaining(persistedGrant.grantB64u));
  expect(router.requests).toHaveLength(1);
  expect(await requestBody(router.requests[0])).toEqual({
    restore_refresh_grant_b64u: persistedGrant.grantB64u,
    manifest_b64u: manifestB64u(),
  });
});

test('unknown response keys and malformed fields fail closed as malformed responses', async () => {
  const persistedGrant = await issuedGrant();
  const malformedResponses = [
    { ...activationResponse(), unexpected: true },
    { ...activationResponse(), activated_epoch: 0 },
    { ...activationResponse(), activation_receipt_digest_b64u: '%%%invalid%%%' },
    {
      ...activationResponse(),
      cleanup: {
        bootstrap: { kind: 'destroyed', receipt_digest_b64u: repeatedBytes(32, 0x24) },
        roles: { kind: 'complete', receipts: { deriver_a: 'invalid', deriver_b: 'invalid' } },
      },
    },
  ];

  for (const body of malformedResponses) {
    const router = new RecordingRouter([async () => Response.json(body)]);
    await expect(
      client(router).activate({
        grant: persistedGrant,
        manifestB64u: manifestB64u(),
      }),
    ).rejects.toMatchObject({
      code: 'tenant_root_restore_activation_unavailable',
      reason: 'malformed_response',
    });
  }
});

test('a response bound to another destination lineage is rejected as a scope mismatch', async () => {
  const persistedGrant = await issuedGrant();
  const router = new RecordingRouter([
    async () =>
      Response.json(activationResponse({ destination_lineage_id: repeatedBytes(16, 0x25) })),
  ]);

  await expect(
    client(router).activate({
      grant: persistedGrant,
      manifestB64u: manifestB64u(),
    }),
  ).rejects.toMatchObject({
    code: 'tenant_root_restore_activation_unavailable',
    reason: 'scope_mismatch',
  });
});

test('HTTP failures remain explicit and retryable', async () => {
  const persistedGrant = await issuedGrant();
  const router = new RecordingRouter([async () => new Response('refused', { status: 409 })]);

  const failure = await client(router)
    .activate({
      grant: persistedGrant,
      manifestB64u: manifestB64u(),
    })
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TenantRootRestoreActivationUnavailableError);
  expect(failure).toMatchObject({
    code: 'tenant_root_restore_activation_unavailable',
    reason: 'http_failure',
  });
});
