import { expect, test } from '@playwright/test';
import type { ConsoleAuthAdapter } from '../../packages/console-server-ts/src/router/consoleAuth';
import type { TenantRootStepUpMethodV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';
import type {
  ConsoleStepUpCeremonyDependenciesV1,
  ConsoleWebAuthnPortV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpCeremony';
import type {
  ConsoleStepUpChallengePurposeV1,
  ConsoleStepUpChallengeV1,
  ConsoleStepUpCredentialStoreV1,
  ConsoleStepUpCredentialV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpCredentialStore';
import type { TenantRootStepUpWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpStore';
import { createConsoleStepUpRouteV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpRoute';

const NOW_MS = Date.parse('2026-09-06T12:00:00.000Z');
const ORG_ID = 'org-1';
const USER_ID = 'owner-1';
const SESSION_ID = 'session-a';
const CREDENTIAL_ID = 'credential-1';

type RecordedStepUp = {
  readonly orgId: string;
  readonly actorUserId: string;
  readonly sessionId: string;
  readonly method: TenantRootStepUpMethodV1;
  readonly verifiedAtMs: number;
};

class MemoryCredentialStore implements ConsoleStepUpCredentialStoreV1 {
  readonly credentials = new Map<string, ConsoleStepUpCredentialV1>();
  readonly challenges = new Map<ConsoleStepUpChallengePurposeV1, ConsoleStepUpChallengeV1>();

  async listCredentials() {
    return [...this.credentials.values()];
  }
  async findCredential(input: { readonly credentialIdB64u: string }) {
    return this.credentials.get(input.credentialIdB64u) ?? null;
  }
  async putCredential(input: { readonly credential: ConsoleStepUpCredentialV1 }) {
    this.credentials.set(input.credential.credentialIdB64u, input.credential);
  }
  async advanceCounter(input: { readonly credentialIdB64u: string; readonly counter: number }) {
    const existing = this.credentials.get(input.credentialIdB64u);
    if (existing !== undefined) {
      this.credentials.set(input.credentialIdB64u, { ...existing, counter: input.counter });
    }
  }
  async putChallenge(input: {
    readonly purpose: ConsoleStepUpChallengePurposeV1;
    readonly challenge: ConsoleStepUpChallengeV1;
  }) {
    this.challenges.set(input.purpose, input.challenge);
  }
  async takeChallenge(input: { readonly purpose: ConsoleStepUpChallengePurposeV1 }) {
    const challenge = this.challenges.get(input.purpose) ?? null;
    this.challenges.delete(input.purpose);
    return challenge;
  }
}

class MemoryStepUpWriter implements TenantRootStepUpWriterV1 {
  readonly written: RecordedStepUp[] = [];
  async recordStepUp(input: RecordedStepUp) {
    this.written.push(input);
  }
}

const webAuthn: ConsoleWebAuthnPortV1 = {
  async registrationOptions() {
    return { challengeB64u: 'challenge-reg', optionsJson: '{"kind":"registration"}' };
  },
  async verifyRegistration() {
    return {
      credentialIdB64u: CREDENTIAL_ID,
      publicKeyB64u: 'public-key',
      counter: 0,
      method: 'webauthn_platform_v1',
    };
  },
  async authenticationOptions() {
    return { challengeB64u: 'challenge-auth', optionsJson: '{"kind":"assertion"}' };
  },
  async verifyAssertion() {
    return { credentialIdB64u: CREDENTIAL_ID, counter: 7 };
  },
};

function auth(userId: string, sessionId: string): ConsoleAuthAdapter {
  return {
    authenticate: () => ({
      ok: true,
      claims: {
        userId,
        orgId: ORG_ID,
        platformSupport: false,
        membershipId: `membership-${userId}`,
        role: 'OWNER',
        authorizationVersion: 1,
        adminPermissions: [],
        projectAccess: { kind: 'all' },
        sessionId,
      },
    }),
  } as unknown as ConsoleAuthAdapter;
}

function rejectingAuth(): ConsoleAuthAdapter {
  return {
    authenticate: () => ({ ok: false, code: 'unauthenticated', message: 'no session' }),
  } as unknown as ConsoleAuthAdapter;
}

function harness(options?: { readonly adapter?: ConsoleAuthAdapter }) {
  const credentials = new MemoryCredentialStore();
  const stepUp = new MemoryStepUpWriter();
  const ceremony: ConsoleStepUpCeremonyDependenciesV1 = { credentials, stepUp, webAuthn };
  const route = createConsoleStepUpRouteV1({
    ...ceremony,
    auth: options?.adapter ?? auth(USER_ID, SESSION_ID),
    now: () => NOW_MS,
  });
  return { credentials, stepUp, route };
}

function post(path: string, body?: unknown): Request {
  return new Request(`https://console.example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer console-session' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(response: Response | null): Promise<T> {
  if (response === null) throw new Error('route did not handle the request');
  return (await response.json()) as T;
}

test('the ceremony route does not claim paths that are not its own', async () => {
  const { route } = harness();
  expect(await route(post('/console/tenant-root/security/status'))).toBeNull();
  expect(await route(post('/console/step-up/webauthn/unknown'))).toBeNull();
});

test('a signed-out caller cannot start a ceremony', async () => {
  const { route, stepUp } = harness({ adapter: rejectingAuth() });
  const response = await route(post('/console/step-up/webauthn/assertion/options'));
  expect(response?.status).toBe(401);
  expect(stepUp.written).toHaveLength(0);
});

test('a ceremony endpoint answers only to POST', async () => {
  const { route } = harness();
  const response = await route(
    new Request('https://console.example.com/console/step-up/webauthn/assertion/options', {
      method: 'GET',
    }),
  );
  expect(response?.status).toBe(405);
});

test('registration issues options and stores the credential on verify', async () => {
  const { route, credentials, stepUp } = harness();

  const options = await route(post('/console/step-up/webauthn/registration/options', {}));
  expect(options?.status).toBe(200);
  expect(options?.headers.get('cache-control')).toBe('no-store');
  expect(await json<{ options: string }>(options)).toMatchObject({
    options: '{"kind":"registration"}',
  });

  const verified = await route(
    post('/console/step-up/webauthn/registration/verify', { response: '{}' }),
  );
  expect(verified?.status).toBe(200);
  expect(credentials.credentials.size).toBe(1);
  // Enrolling is not presence for an operation.
  expect(stepUp.written).toHaveLength(0);
});

test('a completed assertion records step-up for the session that ran it', async () => {
  const { route, credentials, stepUp } = harness();
  credentials.credentials.set(CREDENTIAL_ID, {
    credentialIdB64u: CREDENTIAL_ID,
    publicKeyB64u: 'public-key',
    counter: 1,
    method: 'webauthn_platform_v1',
  });

  expect((await route(post('/console/step-up/webauthn/assertion/options', {})))?.status).toBe(200);
  const verified = await route(
    post('/console/step-up/webauthn/assertion/verify', {
      response: '{}',
      credentialIdB64u: CREDENTIAL_ID,
    }),
  );
  expect(verified?.status).toBe(200);
  expect(stepUp.written).toEqual([
    {
      orgId: ORG_ID,
      actorUserId: USER_ID,
      sessionId: SESSION_ID,
      method: 'webauthn_platform_v1',
      verifiedAtMs: NOW_MS,
    },
  ]);

  // The response never hands back a record a client could present.
  const body = await json<Record<string, unknown>>(verified);
  expect(body).toMatchObject({ ok: true, method: 'webauthn_platform_v1' });
  expect(Object.keys(body)).not.toContain('stepUp');
});

test('the actor comes from the session, not from the request body', async () => {
  const { route, credentials, stepUp } = harness();
  credentials.credentials.set(CREDENTIAL_ID, {
    credentialIdB64u: CREDENTIAL_ID,
    publicKeyB64u: 'public-key',
    counter: 1,
    method: 'webauthn_platform_v1',
  });
  await route(post('/console/step-up/webauthn/assertion/options', {}));

  await route(
    post('/console/step-up/webauthn/assertion/verify', {
      response: '{}',
      credentialIdB64u: CREDENTIAL_ID,
      // All ignored: a body cannot enrol or assert for somebody else.
      actorUserId: 'owner-2',
      orgId: 'org-2',
      sessionId: 'session-b',
    }),
  );
  expect(stepUp.written[0]).toMatchObject({
    orgId: ORG_ID,
    actorUserId: USER_ID,
    sessionId: SESSION_ID,
  });
});

test('an assertion with no registered credential is refused as a conflict', async () => {
  const { route, stepUp } = harness();
  const response = await route(post('/console/step-up/webauthn/assertion/options', {}));
  expect(response?.status).toBe(409);
  expect(await json<{ code: string }>(response)).toMatchObject({
    code: 'no_credential_registered',
  });
  expect(stepUp.written).toHaveLength(0);
});

test('a malformed body is refused without recording anything', async () => {
  const { route, stepUp } = harness();
  const response = await route(
    post('/console/step-up/webauthn/assertion/verify', { response: '' }),
  );
  expect(response?.status).toBe(400);
  expect(stepUp.written).toHaveLength(0);
});
