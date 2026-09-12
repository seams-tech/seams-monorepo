import type { TenantRootStepUpMethodV1 } from './stepUp';
import type {
  ConsoleStepUpCredentialStoreV1,
  ConsoleStepUpCredentialV1,
} from './stepUpCredentialStore';
import type { TenantRootStepUpWriterV1 } from './stepUpStore';

/**
 * The console step-up ceremony.
 *
 * OAuth proves who holds the account. This proves who is at the keyboard now,
 * which is the fact every tenant-root mutation actually needs. A completed
 * assertion is the only thing that writes a step-up record — there is no path
 * from a request body to one.
 *
 * Three bindings make an assertion mean what it claims:
 *
 * - the challenge is issued by the server and spent when it is read, so the
 *   same ceremony response cannot be presented twice;
 * - the challenge carries the console session that asked for it, so an
 *   assertion captured in one session cannot authorize another;
 * - the signature counter may not regress, so a cloned authenticator does not
 *   pass silently.
 */

/** How long an issued ceremony challenge stays usable. */
export const CONSOLE_STEP_UP_CHALLENGE_TTL_MS_V1 = 120_000;

/** Why a ceremony did not produce step-up. */
export type ConsoleStepUpCeremonyErrorV1 =
  | { readonly kind: 'no_credential_registered' }
  | { readonly kind: 'challenge_missing' }
  | { readonly kind: 'challenge_expired' }
  | { readonly kind: 'challenge_session_mismatch' }
  | { readonly kind: 'unknown_credential' }
  | { readonly kind: 'registration_rejected' }
  | { readonly kind: 'assertion_rejected' }
  | { readonly kind: 'counter_regressed' }
  | { readonly kind: 'unsupported_runtime' };

/** One ceremony outcome. */
export type ConsoleStepUpOutcomeV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ConsoleStepUpCeremonyErrorV1 };

/** Options a browser needs to run one ceremony, and the challenge they carry. */
export interface ConsoleStepUpCeremonyOptionsV1 {
  readonly challengeB64u: string;
  readonly optionsJson: string;
}

/** One verified registration. */
export interface ConsoleStepUpRegistrationResultV1 {
  readonly credentialIdB64u: string;
  readonly publicKeyB64u: string;
  readonly counter: number;
  readonly method: TenantRootStepUpMethodV1;
}

/** One verified assertion. */
export interface ConsoleStepUpAssertionResultV1 {
  readonly credentialIdB64u: string;
  readonly counter: number;
}

/**
 * The WebAuthn operations this ceremony needs.
 *
 * The real implementation adapts `@simplewebauthn/server`. Keeping it a port
 * means the ceremony's own rules — expiry, session binding, counter movement —
 * are tested without a browser or a live authenticator.
 */
export interface ConsoleWebAuthnPortV1 {
  registrationOptions(input: {
    readonly userId: string;
    readonly userName: string;
    readonly existing: readonly ConsoleStepUpCredentialV1[];
  }): Promise<ConsoleStepUpCeremonyOptionsV1>;

  verifyRegistration(input: {
    readonly responseJson: string;
    readonly expectedChallengeB64u: string;
  }): Promise<ConsoleStepUpRegistrationResultV1 | null>;

  authenticationOptions(input: {
    readonly existing: readonly ConsoleStepUpCredentialV1[];
  }): Promise<ConsoleStepUpCeremonyOptionsV1>;

  verifyAssertion(input: {
    readonly responseJson: string;
    readonly expectedChallengeB64u: string;
    readonly credential: ConsoleStepUpCredentialV1;
  }): Promise<ConsoleStepUpAssertionResultV1 | null>;
}

/** Everything the ceremony reads and writes. */
export interface ConsoleStepUpCeremonyDependenciesV1 {
  readonly credentials: ConsoleStepUpCredentialStoreV1;
  readonly stepUp: TenantRootStepUpWriterV1;
  readonly webAuthn: ConsoleWebAuthnPortV1;
}

/** One actor running a ceremony. */
export interface ConsoleStepUpActorV1 {
  readonly orgId: string;
  readonly userId: string;
  readonly userName: string;
  readonly sessionId: string;
}

/** Issues registration options and records their challenge. */
export async function startConsoleStepUpRegistrationV1(
  dependencies: ConsoleStepUpCeremonyDependenciesV1,
  actor: ConsoleStepUpActorV1,
  nowMs: number,
): Promise<ConsoleStepUpOutcomeV1<ConsoleStepUpCeremonyOptionsV1>> {
  const existing = await dependencies.credentials.listCredentials({
    orgId: actor.orgId,
    userId: actor.userId,
  });
  const options = await dependencies.webAuthn.registrationOptions({
    userId: actor.userId,
    userName: actor.userName,
    existing,
  });
  await dependencies.credentials.putChallenge({
    orgId: actor.orgId,
    userId: actor.userId,
    purpose: 'registration',
    challenge: {
      challengeB64u: options.challengeB64u,
      sessionId: actor.sessionId,
      expiresAtMs: nowMs + CONSOLE_STEP_UP_CHALLENGE_TTL_MS_V1,
    },
    issuedAtMs: nowMs,
  });
  return { ok: true, value: options };
}

/** Verifies a registration response and stores the credential. */
export async function finishConsoleStepUpRegistrationV1(
  dependencies: ConsoleStepUpCeremonyDependenciesV1,
  actor: ConsoleStepUpActorV1,
  responseJson: string,
  nowMs: number,
): Promise<ConsoleStepUpOutcomeV1<ConsoleStepUpRegistrationResultV1>> {
  const challenge = await takeLiveChallenge(dependencies, actor, 'registration', nowMs);
  if (!challenge.ok) return challenge;

  const verified = await dependencies.webAuthn.verifyRegistration({
    responseJson,
    expectedChallengeB64u: challenge.value.challengeB64u,
  });
  if (verified === null) return { ok: false, error: { kind: 'registration_rejected' } };

  await dependencies.credentials.putCredential({
    orgId: actor.orgId,
    userId: actor.userId,
    credential: {
      credentialIdB64u: verified.credentialIdB64u,
      publicKeyB64u: verified.publicKeyB64u,
      counter: verified.counter,
      method: verified.method,
    },
    createdAtMs: nowMs,
  });
  // Registering a credential is not proof of presence for an operation: the
  // actor still runs an assertion to obtain step-up.
  return { ok: true, value: verified };
}

/** Issues assertion options and records their challenge. */
export async function startConsoleStepUpAssertionV1(
  dependencies: ConsoleStepUpCeremonyDependenciesV1,
  actor: ConsoleStepUpActorV1,
  nowMs: number,
): Promise<ConsoleStepUpOutcomeV1<ConsoleStepUpCeremonyOptionsV1>> {
  const existing = await dependencies.credentials.listCredentials({
    orgId: actor.orgId,
    userId: actor.userId,
  });
  if (existing.length === 0) return { ok: false, error: { kind: 'no_credential_registered' } };

  const options = await dependencies.webAuthn.authenticationOptions({ existing });
  await dependencies.credentials.putChallenge({
    orgId: actor.orgId,
    userId: actor.userId,
    purpose: 'assertion',
    challenge: {
      challengeB64u: options.challengeB64u,
      sessionId: actor.sessionId,
      expiresAtMs: nowMs + CONSOLE_STEP_UP_CHALLENGE_TTL_MS_V1,
    },
    issuedAtMs: nowMs,
  });
  return { ok: true, value: options };
}

/**
 * Verifies an assertion and records step-up for this actor and session.
 *
 * This is the only writer of a step-up record outside tests.
 */
export async function finishConsoleStepUpAssertionV1(
  dependencies: ConsoleStepUpCeremonyDependenciesV1,
  actor: ConsoleStepUpActorV1,
  input: { readonly responseJson: string; readonly credentialIdB64u: string },
  nowMs: number,
): Promise<ConsoleStepUpOutcomeV1<{ readonly method: TenantRootStepUpMethodV1 }>> {
  const challenge = await takeLiveChallenge(dependencies, actor, 'assertion', nowMs);
  if (!challenge.ok) return challenge;

  const credential = await dependencies.credentials.findCredential({
    orgId: actor.orgId,
    userId: actor.userId,
    credentialIdB64u: input.credentialIdB64u,
  });
  if (credential === null) return { ok: false, error: { kind: 'unknown_credential' } };

  const verified = await dependencies.webAuthn.verifyAssertion({
    responseJson: input.responseJson,
    expectedChallengeB64u: challenge.value.challengeB64u,
    credential,
  });
  if (verified === null) return { ok: false, error: { kind: 'assertion_rejected' } };

  // A counter that did not move forward is the cloned-authenticator signal.
  // Authenticators that never implement a counter report zero on both sides,
  // which is the one case where equality is not evidence of a clone.
  if (verified.counter < credential.counter) {
    return { ok: false, error: { kind: 'counter_regressed' } };
  }
  if (verified.counter === credential.counter && credential.counter !== 0) {
    return { ok: false, error: { kind: 'counter_regressed' } };
  }

  await dependencies.credentials.advanceCounter({
    orgId: actor.orgId,
    userId: actor.userId,
    credentialIdB64u: credential.credentialIdB64u,
    counter: verified.counter,
    usedAtMs: nowMs,
  });
  await dependencies.stepUp.recordStepUp({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    sessionId: actor.sessionId,
    method: credential.method,
    verifiedAtMs: nowMs,
  });
  return { ok: true, value: { method: credential.method } };
}

async function takeLiveChallenge(
  dependencies: ConsoleStepUpCeremonyDependenciesV1,
  actor: ConsoleStepUpActorV1,
  purpose: 'registration' | 'assertion',
  nowMs: number,
): Promise<ConsoleStepUpOutcomeV1<{ readonly challengeB64u: string }>> {
  const challenge = await dependencies.credentials.takeChallenge({
    orgId: actor.orgId,
    userId: actor.userId,
    purpose,
  });
  if (challenge === null) return { ok: false, error: { kind: 'challenge_missing' } };
  if (challenge.expiresAtMs <= nowMs) return { ok: false, error: { kind: 'challenge_expired' } };
  // Presence is presence at *this* keyboard. A response captured in another
  // session does not become this session's step-up.
  if (challenge.sessionId !== actor.sessionId) {
    return { ok: false, error: { kind: 'challenge_session_mismatch' } };
  }
  return { ok: true, value: { challengeB64u: challenge.challengeB64u } };
}
