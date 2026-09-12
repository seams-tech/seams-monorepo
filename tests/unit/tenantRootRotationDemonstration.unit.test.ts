import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import { expect, test, type Page } from '@playwright/test';
import type { ConsoleAuthAdapter } from '../../packages/console-server-ts/src/router/consoleAuth';
import {
  createTenantRootRefreshConsoleRouteV1,
  type TenantRootRefreshRouterRequestV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootCreation/consoleRoute';
import type {
  TenantRootCreationGrantRecordV1,
  TenantRootIdentityV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootCreation/types';
import type { TenantRootAuditEventV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';
import { createD1ConsoleStepUpCredentialStoreV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpCredentialStore';
import { createConsoleStepUpRouteV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpRoute';
import { createD1TenantRootStepUpStoreV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpStore';
import { createConsoleWebAuthnPortV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpWebAuthnAdapter';
import { createD1TenantRootOperationStoreV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/d1';
import { createTenantRootSecurityStateReaderV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stateReader';
import { createTenantRootSecurityConsoleRouteV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/consoleRoute';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';

/**
 * The Phase 1 rotation checkpoint, demonstrated against real parts.
 *
 * Real: the console D1 schema built from the committed migrations, the step-up
 * credential and record stores, the ceremony route, `@simplewebauthn/server`
 * verification, the refresh route's step-up enforcement, and its audit events.
 *
 * The authenticator is a Chrome virtual authenticator driven over CDP. It is a
 * real WebAuthn implementation producing real attestations and assertions that
 * the real verifier checks — not a stub of the ceremony. What it replaces is
 * the human finger on a security key, the only part of this flow a test cannot
 * supply.
 *
 * The Router is scripted, because it is a separate service. Its three answers —
 * completed, throttled, already in progress — are what the console has to render
 * correctly, and scripting them is the only way to reach the second and third on
 * demand.
 *
 * Four of the checkpoint's five behaviours are here: an authorized rotation,
 * cooldown, reload/retry continuity, and tenant isolation. Normal signing
 * availability is a Router-layer property with no console surface, so it cannot
 * be shown from here.
 */

const ORG_ID = 'org-rotation-demo';
const USER_ID = 'owner-rotation-demo';
const PROJECT_ID = 'project-rotation-demo';
const ENVIRONMENT_ID = `${PROJECT_ID}:dev`;
const SESSION_ID = 'session-rotation-demo';
const NAMESPACE = 'rotation-demo';
const RP_ID = 'console.test';
const ORIGIN = `https://${RP_ID}`;
const CUSTODY_LINEAGE_B64U = 'custody-lineage-rotation-demo';
const ROOT_COMMITMENT_B64U = '6IKxMQFrUsHTM3CAGHz3aEI-_Mu1F7tJWrgSxBYP9E4';
const RETRY_AT_MS = Date.parse('2026-09-06T13:00:00.000Z');

/** The active lifecycle revision, so a test can move the root on mid-scenario. */
let movedRevision = 7;

/** The console clock, so a test can let an authorization expire. */
let harnessNowMs = Date.parse('2026-09-06T12:00:00.000Z');

class DemonstrationStatusRouter {
  async fetch(request: Request): Promise<Response> {
    const binding = await request.json();
    return Response.json({
      identity_digest_b64u: binding.identity_digest_b64u,
      custody_lineage_b64u: binding.custody_lineage_b64u,
      root_commitment_b64u: ROOT_COMMITMENT_B64U,
      activation_receipt_digest_b64u: 'activation-receipt-rotation-demo',
      lifecycle_revision: movedRevision,
      active_epoch: 1,
      last_refresh_completed_at_ms: null,
      deriver_a_status: 'healthy',
      deriver_b_status: 'healthy',
    });
  }
}

function auth(): ConsoleAuthAdapter {
  return {
    authenticate: () => ({
      ok: true,
      claims: {
        userId: USER_ID,
        orgId: ORG_ID,
        membershipId: 'membership-rotation-demo',
        role: 'OWNER',
        authorizationVersion: 1,
        platformSupport: false,
        adminPermissions: [],
        projectAccess: { kind: 'all' },
        projectId: PROJECT_ID,
        environmentId: ENVIRONMENT_ID,
        sessionId: SESSION_ID,
      },
    }),
  } as unknown as ConsoleAuthAdapter;
}

function activeGrant(
  value: TenantRootIdentityV1,
  identityDigestB64u: string,
): TenantRootCreationGrantRecordV1 {
  return {
    status: 'ACTIVE',
    operationId: 'operation-rotation-demo',
    identity: value,
    identityDigestB64u,
    custodyLineageB64u: CUSTODY_LINEAGE_B64U,
    grantNonceB64u: 'nonce',
    grantKeyId: 'key',
    grantB64u: 'grant',
    grantDigestB64u: 'digest',
    issuedAtMs: 1,
    expiresAtMs: 2,
    namespace: NAMESPACE,
    createdAtMs: 1,
    updatedAtMs: 1,
    ready: {
      revision: movedRevision,
      rootCommitmentB64u: ROOT_COMMITMENT_B64U,
      journalDigestB64u: 'journal',
      capabilityDigestB64u: 'capability',
    },
  };
}

/** resolveIdentity builds the signing root from key and runtimeVersion. */
function environmentService() {
  return {
    async listEnvironments() {
      return [
        {
          id: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          key: 'dev',
          runtimeVersion: 'v1',
          status: 'ACTIVE',
        },
      ];
    },
  } as never;
}

function post(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer console-session' },
    body: JSON.stringify(body),
  });
}

function rotate(operationId: string): Request {
  return post('/console/tenant-root/refresh', { operationId });
}

async function jsonOf<T>(response: Response | null): Promise<T> {
  if (response === null) throw new Error('route did not handle the request');
  return (await response.json()) as T;
}

/** The Router's answer for one refresh attempt, by attempt number. */
type RouterResponder = (attempt: number, request: TenantRootRefreshRouterRequestV1) => Response;

function rotationCompleted(): Response {
  return new Response(
    JSON.stringify({
      activation_receipt_digest_b64u: 'activation-receipt-rotation-demo',
      lifecycle_revision: 8,
      retirement: { kind: 'confirmed' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function rotationThrottled(): Response {
  return new Response(
    JSON.stringify({ code: 'tenant_root_refresh_throttled', retry_at_ms: RETRY_AT_MS }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  );
}

function rotationInProgress(): Response {
  return new Response(JSON.stringify({ code: 'tenant_root_refresh_in_progress' }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  });
}

interface ConsoleHarness {
  readonly ceremony: (request: Request) => Promise<Response | null>;
  readonly refresh: (request: Request) => Promise<Response | null>;
  readonly reads: (request: Request) => Promise<Response | null>;
  readonly stepUpStore: ReturnType<typeof createD1TenantRootStepUpStoreV1>;
  readonly written: TenantRootAuditEventV1[];
  readonly forwarded: Request[];
}

/**
 * A Router that models the admission rules the real one applies.
 *
 * Replay of a completed operation, resumption of a pending one, another
 * operation holding the lock, and the cooldown are four different answers, and
 * the console has to tell them apart. `loseResponsesFor` records the execution
 * and then throws, which is the case where the console cannot know what
 * happened.
 */
class ScriptedRouter {
  readonly executed: string[] = [];
  private readonly completions = new Map<string, { receipt: string; revision: number }>();
  lockHolder: string | null = null;
  throttleUntilMs: number | null = null;
  loseResponsesFor = new Set<string>();

  respond(request: TenantRootRefreshRouterRequestV1): Response {
    const operationId = request.operation_id;
    // Replay: this exact operation already completed.
    const completed = this.completions.get(operationId);
    if (completed) {
      return new Response(
        JSON.stringify({
          activation_receipt_digest_b64u: completed.receipt,
          lifecycle_revision: completed.revision,
          retirement: { kind: 'confirmed' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (this.lockHolder !== operationId) {
      if (request.expected_lifecycle_revision !== movedRevision) {
        return Response.json({ code: 'lifecycle_revision_moved' }, { status: 409 });
      }
      if (harnessNowMs >= request.expires_at_ms) {
        return Response.json({ code: 'authorization_expired' }, { status: 409 });
      }
    }
    // A different operation holds the lock.
    if (this.lockHolder !== null && this.lockHolder !== operationId) {
      return new Response(JSON.stringify({ code: 'tenant_root_refresh_in_progress' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (this.throttleUntilMs !== null) {
      return new Response(
        JSON.stringify({
          code: 'tenant_root_refresh_throttled',
          retry_at_ms: this.throttleUntilMs,
        }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      );
    }
    // Admitted: executed exactly once, then recorded for replay. Completing a
    // rotation advances the lifecycle revision, as the real one does.
    this.executed.push(operationId);
    movedRevision += 1;
    const completion = { receipt: `receipt-${operationId}`, revision: movedRevision };
    this.completions.set(operationId, completion);
    if (this.loseResponsesFor.has(operationId)) {
      this.loseResponsesFor.delete(operationId);
      throw new Error('connection reset before the answer arrived');
    }
    return new Response(
      JSON.stringify({
        activation_receipt_digest_b64u: completion.receipt,
        lifecycle_revision: completion.revision,
        retirement: { kind: 'confirmed' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
}

async function withConsole(
  routerResponder: RouterResponder,
  body: (harness: ConsoleHarness) => Promise<void>,
): Promise<void> {
  return withConsoleInternal(routerResponder, body);
}

/** Runs a scenario against a Router that models the real admission rules. */
async function withConsoleRouter(
  router: ScriptedRouter,
  body: (harness: ConsoleHarness) => Promise<void>,
): Promise<void> {
  return withConsoleInternal((attempt, request) => router.respond(request), body);
}

async function withConsoleInternal(
  routerResponder: RouterResponder,
  body: (harness: ConsoleHarness) => Promise<void>,
): Promise<void> {
  movedRevision = 7;
  harnessNowMs = Date.parse('2026-09-06T12:00:00.000Z');
  const temporary = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(temporary.database, listD1MigrationFiles('d1-console'));

    const stepUpStore = createD1TenantRootStepUpStoreV1({
      database: temporary.database,
      namespace: NAMESPACE,
    });
    const ceremony = createConsoleStepUpRouteV1({
      auth: auth(),
      credentials: createD1ConsoleStepUpCredentialStoreV1({
        database: temporary.database,
        namespace: NAMESPACE,
      }),
      stepUp: stepUpStore,
      webAuthn: createConsoleWebAuthnPortV1({
        rpId: RP_ID,
        rpName: 'Seams Console (demo)',
        expectedOrigin: ORIGIN,
      }),
      // The ceremony and the refresh route share one clock, so step-up
      // freshness is judged against the time the step-up was recorded.
      now: () => harnessNowMs,
    });

    const written: TenantRootAuditEventV1[] = [];
    const forwarded: Request[] = [];
    const refresh = createTenantRootRefreshConsoleRouteV1({
      auth: auth(),
      orgProjectEnv: environmentService(),
      state: createTenantRootSecurityStateReaderV1({
        router: new DemonstrationStatusRouter(),
        internalServiceAuthSecret: 'test-service-auth',
        activeRoots: {
          async resolveActiveLineage(identity) {
            const identityDigestB64u = await tenantRootIdentityDigestB64uV1(identity);
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
          return routerResponder(forwarded.length, await new Request(input, init).json());
        },
      },
      internalServiceAuthSecret: 'router-internal-rotation-demo',
      now: () => harnessNowMs,
      stepUp: stepUpStore,
      operations: (scope) =>
        createD1TenantRootOperationStoreV1({
          database: temporary.database,
          namespace: NAMESPACE,
          ...scope,
          now: () => harnessNowMs,
        }),
      audit: {
        async write(event) {
          written.push(event);
        },
      },
    });

    const reads = createTenantRootSecurityConsoleRouteV1({
      auth: auth(),
      orgProjectEnv: environmentService(),
      stepUp: stepUpStore,
      state: createTenantRootSecurityStateReaderV1({
        router: new DemonstrationStatusRouter(),
        internalServiceAuthSecret: 'test-service-auth',
        activeRoots: {
          async resolveActiveLineage(identity) {
            const identityDigestB64u = await tenantRootIdentityDigestB64uV1(identity);
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
      operations: (scope) =>
        createD1TenantRootOperationStoreV1({
          database: temporary.database,
          namespace: NAMESPACE,
          ...scope,
          now: () => harnessNowMs,
        }),
    });

    await body({ ceremony, refresh, reads, stepUpStore, written, forwarded });
  } finally {
    cleanupTemporaryD1Database(temporary.tempDir);
  }
}

/** Runs `navigator.credentials.create` and serializes the result for the server. */
const REGISTER_IN_PAGE = async (optionsJson: string): Promise<string> => {
  const decode = (value: string): ArrayBuffer => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  };
  const encode = (buffer: ArrayBuffer): string =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const options = JSON.parse(optionsJson) as Record<string, never>;
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...(options as unknown as PublicKeyCredentialCreationOptions),
      challenge: decode(options.challenge as unknown as string),
      user: {
        ...(options.user as unknown as PublicKeyCredentialUserEntity),
        id: decode((options.user as unknown as { id: string }).id),
      },
      excludeCredentials: ((options.excludeCredentials ?? []) as unknown as { id: string }[]).map(
        (entry) => ({ ...entry, id: decode(entry.id), type: 'public-key' as const }),
      ),
    },
  })) as PublicKeyCredential;
  const attestation = credential.response as AuthenticatorAttestationResponse;
  return JSON.stringify({
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: encode(attestation.clientDataJSON),
      attestationObject: encode(attestation.attestationObject),
      transports: attestation.getTransports?.() ?? [],
    },
  });
};

/** Runs `navigator.credentials.get` and serializes the result for the server. */
const ASSERT_IN_PAGE = async (
  optionsJson: string,
): Promise<{ credentialIdB64u: string; response: string }> => {
  const decode = (value: string): ArrayBuffer => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  };
  const encode = (buffer: ArrayBuffer): string =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const options = JSON.parse(optionsJson) as Record<string, never>;
  const credential = (await navigator.credentials.get({
    publicKey: {
      ...(options as unknown as PublicKeyCredentialRequestOptions),
      challenge: decode(options.challenge as unknown as string),
      allowCredentials: ((options.allowCredentials ?? []) as unknown as { id: string }[]).map(
        (entry) => ({ ...entry, id: decode(entry.id), type: 'public-key' as const }),
      ),
    },
  })) as PublicKeyCredential;
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialIdB64u: credential.id,
    response: JSON.stringify({
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: credential.authenticatorAttachment,
      response: {
        clientDataJSON: encode(response.clientDataJSON),
        authenticatorData: encode(response.authenticatorData),
        signature: encode(response.signature),
        ...(response.userHandle ? { userHandle: encode(response.userHandle) } : {}),
      },
    }),
  };
};

/** Opens a page on the relying-party origin with a virtual authenticator attached. */
async function openAuthenticatorPage(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>demo' }),
  );
  await page.goto(`${ORIGIN}/`);
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** Enrols a credential for this actor. */
async function enrolCredential(
  page: Page,
  ceremony: (request: Request) => Promise<Response | null>,
): Promise<void> {
  const options = await jsonOf<{ options: string }>(
    await ceremony(post('/console/step-up/webauthn/registration/options', {})),
  );
  const registered = await ceremony(
    post('/console/step-up/webauthn/registration/verify', {
      response: await page.evaluate(REGISTER_IN_PAGE, options.options),
    }),
  );
  expect(registered?.status).toBe(200);
}

/** Asserts with the credential already enrolled, refreshing step-up. */
async function refreshStepUp(
  page: Page,
  ceremony: (request: Request) => Promise<Response | null>,
): Promise<void> {
  const options = await jsonOf<{ options: string }>(
    await ceremony(post('/console/step-up/webauthn/assertion/options', {})),
  );
  const assertion = await page.evaluate(ASSERT_IN_PAGE, options.options);
  const asserted = await ceremony(
    post('/console/step-up/webauthn/assertion/verify', {
      response: assertion.response,
      credentialIdB64u: assertion.credentialIdB64u,
    }),
  );
  expect(asserted?.status, `re-assertion said: ${await asserted?.clone().text()}`).toBe(200);
}

/** Enrols and asserts, leaving this actor and session holding fresh step-up. */
async function completeStepUp(
  page: Page,
  ceremony: (request: Request) => Promise<Response | null>,
): Promise<void> {
  await openAuthenticatorPage(page);
  await enrolCredential(page, ceremony);

  const options = await jsonOf<{ options: string }>(
    await ceremony(post('/console/step-up/webauthn/assertion/options', {})),
  );
  const assertion = await page.evaluate(ASSERT_IN_PAGE, options.options);
  const asserted = await ceremony(
    post('/console/step-up/webauthn/assertion/verify', {
      response: assertion.response,
      credentialIdB64u: assertion.credentialIdB64u,
    }),
  );
  expect(asserted?.status, `assertion verify said: ${await asserted?.clone().text()}`).toBe(200);
}

test('an authorized rotation runs end to end: enrol, assert, rotate', async ({ page }) => {
  await withConsole(rotationCompleted, async (harness) => {
    // The state a console user is in before they touch their authenticator.
    const beforeStepUp = await harness.refresh(rotate('operation-before-step-up'));
    expect(beforeStepUp?.status).toBe(403);
    expect(harness.forwarded).toHaveLength(0);

    await completeStepUp(page, harness.ceremony);

    // The step-up record reached D1, bound to this actor and session.
    expect(
      await harness.stepUpStore.readStepUp({ orgId: ORG_ID, actorUserId: USER_ID }),
    ).toMatchObject({ actorUserId: USER_ID, sessionId: SESSION_ID });

    const rotated = await harness.refresh(rotate('operation-rotation-demo'));
    expect(rotated?.status, `rotation said: ${await rotated?.clone().text()}`).toBe(200);
    expect(await jsonOf<{ lifecycleRevision: number }>(rotated)).toMatchObject({
      ok: true,
      status: 'ACTIVE',
      activationReceiptDigestB64u: 'activation-receipt-rotation-demo',
      lifecycleRevision: 8,
    });
    expect(harness.forwarded).toHaveLength(1);
    expect(harness.written).toHaveLength(3);
    expect(harness.written.map((event) => event.action)).toEqual([
      'rotation_activated',
      'rotation_retired',
      'rotation_retired',
    ]);
    expect(harness.written[0]).toMatchObject({
      action: 'rotation_activated',
      outcome: 'success',
      orgId: ORG_ID,
      actorUserId: USER_ID,
      authorization: { stepUpMethod: 'webauthn_platform_v1' },
    });
    expect(harness.written.slice(1).map((event) => event.role)).toEqual(['deriver_a', 'deriver_b']);
    expect(harness.written.slice(1).every((event) => event.receiptDigestB64u === null)).toBe(true);
  });
});

test('enrolling a credential is possession, not presence', async ({ page }) => {
  await withConsole(rotationCompleted, async (harness) => {
    await openAuthenticatorPage(page);
    await enrolCredential(page, harness.ceremony);

    // Registered but never asserted: rotation is still refused.
    const refused = await harness.refresh(rotate('operation-after-enrolment'));
    expect(refused?.status).toBe(403);
    expect(harness.forwarded).toHaveLength(0);
    expect(harness.written).toHaveLength(0);
  });
});

test('a second rotation inside the cooldown is refused with its retry time', async ({ page }) => {
  await withConsole(
    (attempt) => (attempt === 1 ? rotationCompleted() : rotationThrottled()),
    async (harness) => {
      await completeStepUp(page, harness.ceremony);
      expect((await harness.refresh(rotate('operation-first')))?.status).toBe(200);

      // The hourly limit is the Router's; the console must surface it exactly.
      const throttled = await harness.refresh(rotate('operation-second'));
      expect(throttled?.status).toBe(429);
      expect(await jsonOf<{ retryAtMs: number }>(throttled)).toMatchObject({
        ok: false,
        code: 'tenant_root_refresh_throttled',
        retryAtMs: RETRY_AT_MS,
      });
      expect(throttled?.headers.get('Retry-After')).toBe(new Date(RETRY_AT_MS).toUTCString());

      // A refused rotation is recorded, not silently dropped.
      expect(harness.written.map((event) => event.action)).toEqual([
        'rotation_activated',
        'rotation_retired',
        'rotation_retired',
        'rotation_failed',
      ]);
    },
  );
});

test('a reload during a rotation resumes rather than starting a second one', async ({ page }) => {
  await withConsole(rotationInProgress, async (harness) => {
    await completeStepUp(page, harness.ceremony);

    // What the page sees when it is reloaded while a rotation is running.
    const first = await harness.refresh(rotate('operation-in-flight'));
    expect(first?.status).toBe(409);
    expect(await jsonOf<{ code: string }>(first)).toMatchObject({
      ok: false,
      code: 'tenant_root_refresh_in_progress',
    });

    // Retrying carries the same operation id to the Router, which is what lets
    // it answer with the running operation instead of starting another.
    const retried = await harness.refresh(rotate('operation-in-flight'));
    expect(retried?.status).toBe(409);
    const ids = await Promise.all(
      harness.forwarded.map(async (request) => {
        const body = (await request.clone().json()) as { operation_id?: string };
        return body.operation_id;
      }),
    );
    expect(ids).toEqual(['operation-in-flight', 'operation-in-flight']);
    expect(harness.written.map((event) => event.action)).toEqual([
      'rotation_requested',
      'rotation_requested',
    ]);
    expect(harness.written.map((event) => event.outcome)).toEqual(['pending', 'pending']);
  });
});

test('one organization step-up is not another', async ({ page }) => {
  await withConsole(rotationCompleted, async (harness) => {
    await completeStepUp(page, harness.ceremony);

    expect(
      await harness.stepUpStore.readStepUp({ orgId: ORG_ID, actorUserId: USER_ID }),
    ).not.toBeNull();
    expect(
      await harness.stepUpStore.readStepUp({ orgId: 'org-somebody-else', actorUserId: USER_ID }),
    ).toBeNull();
    expect(
      await harness.stepUpStore.readStepUp({ orgId: ORG_ID, actorUserId: 'owner-somebody-else' }),
    ).toBeNull();
  });
});

test('submit, reload, poll, complete — and a retry does not rotate twice', async ({ page }) => {
  const router = new ScriptedRouter();
  await withConsoleRouter(router, async (harness) => {
    await completeStepUp(page, harness.ceremony);

    // Submit.
    const submitted = await harness.refresh(rotate('operation-continuity'));
    expect(submitted?.status, `submit said: ${await submitted?.clone().text()}`).toBe(200);
    expect(router.executed).toEqual(['operation-continuity']);

    // Reload and poll: the durable operation carries the recorded result.
    const polled = await harness.reads(
      new Request(
        `${ORIGIN}/console/tenant-root/security/rotation?operationId=operation-continuity`,
      ),
    );
    expect(polled?.status).toBe(200);
    const body = await jsonOf<{
      operation: { operationId: string; status: string; acceptedResult: { ok: boolean } } | null;
    }>(polled);
    expect(body.operation?.status).toBe('accepted');
    expect(body.operation?.acceptedResult.ok).toBe(true);

    // Retrying the same id replays the recorded result and rotates nothing.
    const retried = await harness.refresh(rotate('operation-continuity'));
    expect(retried?.status).toBe(200);
    expect(await jsonOf<{ replayed: boolean }>(retried)).toMatchObject({ replayed: true });
    expect(router.executed).toEqual(['operation-continuity']);
  });
});

test('a lost response after acceptance stays resumable and never executes twice', async ({
  page,
}) => {
  const router = new ScriptedRouter();
  router.loseResponsesFor.add('operation-lost');
  await withConsoleRouter(router, async (harness) => {
    await completeStepUp(page, harness.ceremony);

    // The Router accepted and executed; the answer never arrived.
    const uncertain = await harness.refresh(rotate('operation-lost'));
    expect(uncertain?.status).toBe(502);
    expect(await jsonOf<{ code: string; resumable: boolean }>(uncertain)).toMatchObject({
      code: 'dispatch_uncertain',
      resumable: true,
      operationId: 'operation-lost',
    });
    expect(router.executed).toEqual(['operation-lost']);

    // The operation is pending, not failed: an uncertain outcome is not
    // rejection evidence, so the same id can still complete it.
    const pending = await harness.reads(
      new Request(`${ORIGIN}/console/tenant-root/security/rotation?operationId=operation-lost`),
    );
    const pendingBody = await jsonOf<{ operation: { status: string } | null }>(pending);
    expect(pendingBody.operation?.status).toBe('pending');

    // The same id reconciles against the Router, which replays its completion.
    const resumed = await harness.refresh(rotate('operation-lost'));
    expect(resumed?.status, `resume said: ${await resumed?.clone().text()}`).toBe(200);
    // Executed once, not twice.
    expect(router.executed).toEqual(['operation-lost']);

    const settled = await harness.reads(
      new Request(`${ORIGIN}/console/tenant-root/security/rotation?operationId=operation-lost`),
    );
    expect(
      (await jsonOf<{ operation: { status: string } | null }>(settled)).operation?.status,
    ).toBe('accepted');
  });
});

test('cooldown, same-operation replay, and another operation holding the lock stay distinct', async ({
  page,
}) => {
  const router = new ScriptedRouter();
  await withConsoleRouter(router, async (harness) => {
    await completeStepUp(page, harness.ceremony);

    // Same-operation replay: completed, and reported as a replay.
    expect((await harness.refresh(rotate('operation-a')))?.status).toBe(200);
    const replayed = await harness.refresh(rotate('operation-a'));
    expect(replayed?.status).toBe(200);
    expect(await jsonOf<{ replayed: boolean }>(replayed)).toMatchObject({ replayed: true });

    // Another operation holds the lock: a conflict, not this caller's rotation.
    router.lockHolder = 'operation-somebody-else';
    const conflicted = await harness.refresh(rotate('operation-b'));
    expect(conflicted?.status).toBe(409);
    expect(await jsonOf<{ code: string; conflict: string }>(conflicted)).toMatchObject({
      code: 'tenant_root_refresh_in_progress',
      conflict: 'another_operation_in_progress',
    });
    // Not admitted, so it is pending rather than failed: the same id can be
    // admitted once the lock frees.
    const blocked = await harness.reads(
      new Request(`${ORIGIN}/console/tenant-root/security/rotation?operationId=operation-b`),
    );
    expect((await jsonOf<{ operation: { status: string } }>(blocked)).operation.status).toBe(
      'pending',
    );

    // Cooldown: definite rejection evidence, so this id is terminal.
    router.lockHolder = null;
    router.throttleUntilMs = RETRY_AT_MS;
    const throttled = await harness.refresh(rotate('operation-c'));
    expect(throttled?.status).toBe(429);
    expect(await jsonOf<{ code: string; retryAtMs: number }>(throttled)).toMatchObject({
      code: 'tenant_root_refresh_throttled',
      retryAtMs: RETRY_AT_MS,
    });
    const refused = await harness.reads(
      new Request(`${ORIGIN}/console/tenant-root/security/rotation?operationId=operation-c`),
    );
    const refusedBody = await jsonOf<{ operation: { status: string; failureCode: string } }>(
      refused,
    );
    expect(refusedBody.operation.status).toBe('failed');
    expect(refusedBody.operation.failureCode).toBe('tenant_root_refresh_throttled');
  });
});

test('a conflicting operation is refused, never re-pointed, once the root moves on', async ({
  page,
}) => {
  const router = new ScriptedRouter();
  await withConsoleRouter(router, async (harness) => {
    await completeStepUp(page, harness.ceremony);

    // Blocked by another operation: recorded pending, bound to revision 7.
    router.lockHolder = 'operation-somebody-else';
    const blocked = await harness.refresh(rotate('operation-waiting'));
    expect(blocked?.status).toBe(409);
    expect(await jsonOf<{ conflict: string }>(blocked)).toMatchObject({
      conflict: 'another_operation_in_progress',
    });

    // The other rotation completes and the root moves to a new revision.
    router.lockHolder = null;
    movedRevision = 8;

    // The waiting operation is refused rather than admitted against a revision
    // nobody authorized it for. Its binding is reported, not rewritten.
    const stale = await harness.refresh(rotate('operation-waiting'));
    expect(stale?.status).toBe(409);
    expect(
      await jsonOf<{ code: string; authorizedRevision: number; currentRevision: number }>(stale),
    ).toMatchObject({
      code: 'lifecycle_revision_moved',
    });
    // The Router refused the original binding; nothing executed.
    expect(router.executed).toEqual([]);

    // Terminal, and still bound to the revision it was authorized against: the
    // binding is reported, never rewritten to admit the old request.
    const polled = await harness.reads(
      new Request(`${ORIGIN}/console/tenant-root/security/rotation?operationId=operation-waiting`),
    );
    const polledBody = await jsonOf<{ operation: { status: string; failureCode: string } }>(polled);
    expect(polledBody.operation.status).toBe('failed');
    expect(polledBody.operation.failureCode).toBe('lifecycle_revision_moved');

    // A new operation id is admitted at the new revision.
    const fresh = await harness.refresh(rotate('operation-after-move'));
    expect(fresh?.status, `fresh said: ${await fresh?.clone().text()}`).toBe(200);
    expect(router.executed).toEqual(['operation-after-move']);
  });
});

test('a completion lost after it advanced the revision is still retrievable when the authorization has expired', async ({
  page,
}) => {
  const router = new ScriptedRouter();
  router.loseResponsesFor.add('operation-lost-and-expired');
  await withConsoleRouter(router, async (harness) => {
    await completeStepUp(page, harness.ceremony);

    // The Router executes, advances the revision, and the answer is lost.
    const uncertain = await harness.refresh(rotate('operation-lost-and-expired'));
    expect(uncertain?.status).toBe(502);
    expect(await jsonOf<{ code: string }>(uncertain)).toMatchObject({
      code: 'dispatch_uncertain',
    });
    expect(router.executed).toEqual(['operation-lost-and-expired']);
    // The rotation that completed moved the root on.
    expect(movedRevision).toBe(8);

    // The client retries long after its authorization ran out. Both the
    // revision drift and the expiry would refuse a never-admitted operation —
    // neither may erase a result the control plane already holds.
    // Twenty minutes later the operation's own authorization has run out. The
    // operator re-authenticates — which is presence for this attempt, not new
    // authorization for the operation, whose record and nonce are unchanged.
    harnessNowMs += 20 * 60_000;
    await refreshStepUp(page, harness.ceremony);
    const recovered = await harness.refresh(rotate('operation-lost-and-expired'));
    expect(recovered?.status, `recovery said: ${await recovered?.clone().text()}`).toBe(200);
    expect(await jsonOf<{ lifecycleRevision: number }>(recovered)).toMatchObject({
      ok: true,
      lifecycleRevision: 8,
    });
    // Retrieved, not re-executed.
    expect(router.executed).toEqual(['operation-lost-and-expired']);

    const settled = await harness.reads(
      new Request(
        `${ORIGIN}/console/tenant-root/security/rotation?operationId=operation-lost-and-expired`,
      ),
    );
    expect((await jsonOf<{ operation: { status: string } }>(settled)).operation.status).toBe(
      'accepted',
    );
  });
});

test('a never-admitted operation invalidated by drift is refused terminally, not left pending', async ({
  page,
}) => {
  const router = new ScriptedRouter();
  await withConsoleRouter(router, async (harness) => {
    await completeStepUp(page, harness.ceremony);

    // Blocked, so never admitted and nothing to reconcile.
    router.lockHolder = 'operation-somebody-else';
    expect((await harness.refresh(rotate('operation-stranded')))?.status).toBe(409);

    // Another rotation completes and moves the root on.
    router.lockHolder = null;
    expect((await harness.refresh(rotate('operation-other')))?.status).toBe(200);

    const stale = await harness.refresh(rotate('operation-stranded'));
    expect(stale?.status).toBe(409);
    expect(await jsonOf<{ code: string }>(stale)).toMatchObject({
      code: 'lifecycle_revision_moved',
    });

    // Terminal: it does not sit pending waiting for a revision that will not
    // come back.
    const polled = await harness.reads(
      new Request(`${ORIGIN}/console/tenant-root/security/rotation?operationId=operation-stranded`),
    );
    const body = await jsonOf<{ operation: { status: string; failureCode: string } }>(polled);
    expect(body.operation.status).toBe('failed');
    expect(body.operation.failureCode).toBe('lifecycle_revision_moved');
  });
});
