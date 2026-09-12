import { expect, test } from '@playwright/test';
import type { TenantRootStepUpMethodV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';
import {
  CONSOLE_STEP_UP_CHALLENGE_TTL_MS_V1,
  finishConsoleStepUpAssertionV1,
  finishConsoleStepUpRegistrationV1,
  startConsoleStepUpAssertionV1,
  startConsoleStepUpRegistrationV1,
  type ConsoleStepUpActorV1,
  type ConsoleStepUpCeremonyDependenciesV1,
  type ConsoleWebAuthnPortV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpCeremony';
import type {
  ConsoleStepUpChallengePurposeV1,
  ConsoleStepUpChallengeV1,
  ConsoleStepUpCredentialStoreV1,
  ConsoleStepUpCredentialV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpCredentialStore';
import type { TenantRootStepUpWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpStore';

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
    if (!this.credentials.has(input.credential.credentialIdB64u)) {
      this.credentials.set(input.credential.credentialIdB64u, input.credential);
    }
  }
  async advanceCounter(input: { readonly credentialIdB64u: string; readonly counter: number }) {
    const existing = this.credentials.get(input.credentialIdB64u);
    if (existing !== undefined && input.counter >= existing.counter) {
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

/** A WebAuthn port that accepts anything, so the ceremony's own rules are what fail. */
function acceptingPort(counter: number, method: TenantRootStepUpMethodV1): ConsoleWebAuthnPortV1 {
  return {
    async registrationOptions() {
      return { challengeB64u: 'challenge-reg', optionsJson: '{}' };
    },
    async verifyRegistration() {
      return {
        credentialIdB64u: CREDENTIAL_ID,
        publicKeyB64u: 'public-key',
        counter,
        method,
      };
    },
    async authenticationOptions() {
      return { challengeB64u: 'challenge-auth', optionsJson: '{}' };
    },
    async verifyAssertion() {
      return { credentialIdB64u: CREDENTIAL_ID, counter };
    },
  };
}

function harness(options?: {
  readonly counter?: number;
  readonly method?: TenantRootStepUpMethodV1;
  readonly rejectAssertion?: boolean;
}) {
  const credentials = new MemoryCredentialStore();
  const stepUp = new MemoryStepUpWriter();
  const base = acceptingPort(options?.counter ?? 1, options?.method ?? 'webauthn_platform_v1');
  const webAuthn: ConsoleWebAuthnPortV1 = options?.rejectAssertion
    ? { ...base, verifyAssertion: async () => null }
    : base;
  const dependencies: ConsoleStepUpCeremonyDependenciesV1 = { credentials, stepUp, webAuthn };
  const actor: ConsoleStepUpActorV1 = {
    orgId: ORG_ID,
    userId: USER_ID,
    userName: 'owner@example.com',
    sessionId: SESSION_ID,
  };
  return { credentials, stepUp, dependencies, actor };
}

/** Registers a credential so an assertion has something to verify against. */
async function register(
  h: ReturnType<typeof harness>,
  counter = 0,
  method: TenantRootStepUpMethodV1 = 'webauthn_platform_v1',
) {
  h.credentials.credentials.set(CREDENTIAL_ID, {
    credentialIdB64u: CREDENTIAL_ID,
    publicKeyB64u: 'public-key',
    counter,
    method,
  });
}

test('a completed assertion is the only thing that records step-up', async () => {
  const h = harness({ counter: 5 });
  await register(h, 1);

  await startConsoleStepUpAssertionV1(h.dependencies, h.actor, NOW_MS);
  expect(h.stepUp.written).toHaveLength(0);

  const finished = await finishConsoleStepUpAssertionV1(
    h.dependencies,
    h.actor,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS,
  );
  expect(finished.ok).toBe(true);
  expect(h.stepUp.written).toEqual([
    {
      orgId: ORG_ID,
      actorUserId: USER_ID,
      sessionId: SESSION_ID,
      method: 'webauthn_platform_v1',
      verifiedAtMs: NOW_MS,
    },
  ]);
});

test('registering a credential does not by itself record step-up', async () => {
  const h = harness();
  await startConsoleStepUpRegistrationV1(h.dependencies, h.actor, NOW_MS);
  const finished = await finishConsoleStepUpRegistrationV1(h.dependencies, h.actor, '{}', NOW_MS);
  expect(finished.ok).toBe(true);
  expect(h.credentials.credentials.size).toBe(1);
  // Enrolling a key proves possession, not presence for an operation.
  expect(h.stepUp.written).toHaveLength(0);
});

test('a challenge is spent, so the same response cannot be presented twice', async () => {
  const h = harness({ counter: 5 });
  await register(h, 1);
  await startConsoleStepUpAssertionV1(h.dependencies, h.actor, NOW_MS);

  const first = await finishConsoleStepUpAssertionV1(
    h.dependencies,
    h.actor,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS,
  );
  expect(first.ok).toBe(true);

  const replay = await finishConsoleStepUpAssertionV1(
    h.dependencies,
    h.actor,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS,
  );
  expect(replay.ok).toBe(false);
  if (!replay.ok) expect(replay.error.kind).toBe('challenge_missing');
  expect(h.stepUp.written).toHaveLength(1);
});

test('an assertion captured in another session is not this session step-up', async () => {
  const h = harness({ counter: 5 });
  await register(h, 1);
  await startConsoleStepUpAssertionV1(h.dependencies, h.actor, NOW_MS);

  const otherSession = { ...h.actor, sessionId: 'session-b' };
  const finished = await finishConsoleStepUpAssertionV1(
    h.dependencies,
    otherSession,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS,
  );
  expect(finished.ok).toBe(false);
  if (!finished.ok) expect(finished.error.kind).toBe('challenge_session_mismatch');
  expect(h.stepUp.written).toHaveLength(0);
});

test('an expired challenge is refused', async () => {
  const h = harness({ counter: 5 });
  await register(h, 1);
  await startConsoleStepUpAssertionV1(h.dependencies, h.actor, NOW_MS);

  const finished = await finishConsoleStepUpAssertionV1(
    h.dependencies,
    h.actor,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS + CONSOLE_STEP_UP_CHALLENGE_TTL_MS_V1 + 1,
  );
  expect(finished.ok).toBe(false);
  if (!finished.ok) expect(finished.error.kind).toBe('challenge_expired');
  expect(h.stepUp.written).toHaveLength(0);
});

test('a counter that does not move forward reads as a cloned authenticator', async () => {
  // Regressed.
  const regressed = harness({ counter: 3 });
  await register(regressed, 9);
  await startConsoleStepUpAssertionV1(regressed.dependencies, regressed.actor, NOW_MS);
  const back = await finishConsoleStepUpAssertionV1(
    regressed.dependencies,
    regressed.actor,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS,
  );
  expect(back.ok).toBe(false);
  if (!back.ok) expect(back.error.kind).toBe('counter_regressed');
  expect(regressed.stepUp.written).toHaveLength(0);

  // Equal and non-zero: the authenticator counts, and this count repeats.
  const repeated = harness({ counter: 4 });
  await register(repeated, 4);
  await startConsoleStepUpAssertionV1(repeated.dependencies, repeated.actor, NOW_MS);
  const same = await finishConsoleStepUpAssertionV1(
    repeated.dependencies,
    repeated.actor,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS,
  );
  expect(same.ok).toBe(false);
  if (!same.ok) expect(same.error.kind).toBe('counter_regressed');

  // Equal at zero: this authenticator does not implement a counter at all.
  const uncounted = harness({ counter: 0 });
  await register(uncounted, 0);
  await startConsoleStepUpAssertionV1(uncounted.dependencies, uncounted.actor, NOW_MS);
  const allowed = await finishConsoleStepUpAssertionV1(
    uncounted.dependencies,
    uncounted.actor,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS,
  );
  expect(allowed.ok).toBe(true);
  expect(uncounted.stepUp.written).toHaveLength(1);
});

test('an actor with no registered credential cannot start an assertion', async () => {
  const h = harness();
  const started = await startConsoleStepUpAssertionV1(h.dependencies, h.actor, NOW_MS);
  expect(started.ok).toBe(false);
  if (!started.ok) expect(started.error.kind).toBe('no_credential_registered');
});

test('an unknown credential id and a rejected assertion both fail closed', async () => {
  const unknown = harness({ counter: 5 });
  await register(unknown, 1);
  await startConsoleStepUpAssertionV1(unknown.dependencies, unknown.actor, NOW_MS);
  const wrongId = await finishConsoleStepUpAssertionV1(
    unknown.dependencies,
    unknown.actor,
    { responseJson: '{}', credentialIdB64u: 'not-registered' },
    NOW_MS,
  );
  expect(wrongId.ok).toBe(false);
  if (!wrongId.ok) expect(wrongId.error.kind).toBe('unknown_credential');
  expect(unknown.stepUp.written).toHaveLength(0);

  const rejected = harness({ counter: 5, rejectAssertion: true });
  await register(rejected, 1);
  await startConsoleStepUpAssertionV1(rejected.dependencies, rejected.actor, NOW_MS);
  const failed = await finishConsoleStepUpAssertionV1(
    rejected.dependencies,
    rejected.actor,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS,
  );
  expect(failed.ok).toBe(false);
  if (!failed.ok) expect(failed.error.kind).toBe('assertion_rejected');
  expect(rejected.stepUp.written).toHaveLength(0);
});

test('the recorded method is the credential the actor actually used', async () => {
  const h = harness({ counter: 5, method: 'webauthn_cross_platform_v1' });
  await register(h, 1, 'webauthn_cross_platform_v1');
  await startConsoleStepUpAssertionV1(h.dependencies, h.actor, NOW_MS);
  const finished = await finishConsoleStepUpAssertionV1(
    h.dependencies,
    h.actor,
    { responseJson: '{}', credentialIdB64u: CREDENTIAL_ID },
    NOW_MS,
  );
  expect(finished.ok).toBe(true);
  expect(h.stepUp.written[0]?.method).toBe('webauthn_cross_platform_v1');
});
