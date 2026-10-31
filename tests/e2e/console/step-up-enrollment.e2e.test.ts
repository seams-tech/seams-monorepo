import { expect, test, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createInMemoryConsoleAccountService } from '../../../packages/console-server-ts/src/account/service';
import { createInMemoryConsoleOrgProjectService } from '../../../packages/console-server-ts/src/orgProjectEnv/service';
import { createInMemoryConsoleOrganizationAccessService } from '../../../packages/console-server-ts/src/teamRbac/service';
import {
  createConsoleSessionAuthAdapter,
  createHmacSessionAdapter,
} from '../../../packages/wallet-console-server-ts/src/router/cloudflare/d1StagingSession';
import { createInMemoryConsoleSessionRevocationStore } from '../../helpers/consoleSessionRevocationStore';
import {
  HostedConsoleAuthHandler,
  type HostedConsoleIdentityPort,
} from '../../../packages/wallet-console-server-ts/src/router/hostedConsoleAuth';
import { createConsoleStepUpRouteV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpRoute';
import type { ConsoleWebAuthnPortV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpCeremony';
import type {
  ConsoleStepUpChallengePurposeV1,
  ConsoleStepUpChallengeV1,
  ConsoleStepUpCredentialStoreV1,
  ConsoleStepUpCredentialV1,
} from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpCredentialStore';
import type { TenantRootStepUpReaderV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/routeGuard';
import type { TenantRootStepUpWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpStore';
import type { TenantRootStepUpSessionRecordV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';

const ORIGIN = 'https://console.test';
const USER_ID = 'google:step-up-owner';
const ORG_ID = 'org-step-up-enrollment';
const COOKIE_NAME = 'step-up-session';

class CredentialStore implements ConsoleStepUpCredentialStoreV1 {
  readonly credentials = new Map<string, ConsoleStepUpCredentialV1>();
  readonly challenges = new Map<ConsoleStepUpChallengePurposeV1, ConsoleStepUpChallengeV1>();

  async listCredentials(): Promise<readonly ConsoleStepUpCredentialV1[]> {
    return [...this.credentials.values()];
  }

  async findCredential(input: { readonly credentialIdB64u: string }) {
    return this.credentials.get(input.credentialIdB64u) ?? null;
  }

  async putCredential(input: { readonly credential: ConsoleStepUpCredentialV1 }): Promise<void> {
    if (!this.credentials.has(input.credential.credentialIdB64u)) {
      this.credentials.set(input.credential.credentialIdB64u, input.credential);
    }
  }

  async advanceCounter(input: {
    readonly credentialIdB64u: string;
    readonly counter: number;
  }): Promise<void> {
    const credential = this.credentials.get(input.credentialIdB64u);
    if (credential && input.counter >= credential.counter) {
      this.credentials.set(input.credentialIdB64u, { ...credential, counter: input.counter });
    }
  }

  async putChallenge(input: {
    readonly purpose: ConsoleStepUpChallengePurposeV1;
    readonly challenge: ConsoleStepUpChallengeV1;
  }): Promise<void> {
    this.challenges.set(input.purpose, input.challenge);
  }

  async takeChallenge(input: { readonly purpose: ConsoleStepUpChallengePurposeV1 }) {
    const challenge = this.challenges.get(input.purpose) ?? null;
    this.challenges.delete(input.purpose);
    return challenge;
  }
}

class StepUpStore implements TenantRootStepUpReaderV1, TenantRootStepUpWriterV1 {
  private record: TenantRootStepUpSessionRecordV1 | null = null;

  async readStepUp(): Promise<TenantRootStepUpSessionRecordV1 | null> {
    return this.record;
  }

  async recordStepUp(input: TenantRootStepUpSessionRecordV1): Promise<void> {
    this.record = input;
  }
}

async function verifyGoogleLogin(): Promise<
  Awaited<ReturnType<HostedConsoleIdentityPort['verifyGoogleLogin']>>
> {
  return {
    ok: true,
    verified: true,
    userId: USER_ID,
    providerSubject: USER_ID,
    sub: 'step-up-owner',
    email: 'owner@step-up.invalid',
    name: 'Step-up owner',
    emailVerified: true,
  };
}

async function verifyGithubOAuthCode(): Promise<
  Awaited<ReturnType<HostedConsoleIdentityPort['verifyGithubOAuthCode']>>
> {
  return {
    ok: false,
    verified: false,
    code: 'not_configured',
    message: 'GitHub is unavailable in this fixture',
  };
}

async function recordVerifiedGoogleIdentity(): Promise<void> {}
async function assertOrganizationCanBeDeleted(): Promise<void> {}
async function fallback(): Promise<Response> {
  return new Response('Not Found', { status: 404 });
}

class FixtureWebAuthn implements ConsoleWebAuthnPortV1 {
  private registrations = 0;

  async registrationOptions() {
    const challengeB64u = `registration-challenge-${this.registrations + 1}`;
    return { challengeB64u, optionsJson: JSON.stringify({ challengeB64u }) };
  }

  async verifyRegistration(input: {
    readonly responseJson: string;
    readonly expectedChallengeB64u: string;
  }) {
    const response: unknown = JSON.parse(input.responseJson);
    if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
    if (Reflect.get(response, 'challengeB64u') !== input.expectedChallengeB64u) return null;
    this.registrations += 1;
    return {
      credentialIdB64u: `fixture-key-${this.registrations}`,
      publicKeyB64u: `fixture-public-key-${this.registrations}`,
      counter: 0,
      method: 'webauthn_platform_v1' as const,
    };
  }

  async authenticationOptions() {
    const challengeB64u = 'assertion-challenge';
    return { challengeB64u, optionsJson: JSON.stringify({ challengeB64u }) };
  }

  async verifyAssertion(input: {
    readonly responseJson: string;
    readonly expectedChallengeB64u: string;
    readonly credential: ConsoleStepUpCredentialV1;
  }) {
    const response: unknown = JSON.parse(input.responseJson);
    if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
    if (Reflect.get(response, 'challengeB64u') !== input.expectedChallengeB64u) return null;
    if (Reflect.get(response, 'credentialIdB64u') !== input.credential.credentialIdB64u) {
      return null;
    }
    return { credentialIdB64u: input.credential.credentialIdB64u, counter: 1 };
  }
}

function challengeFromOptions(optionsJsonValue: string): string {
  const options: unknown = JSON.parse(optionsJsonValue);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Fixture options were invalid');
  }
  const challengeB64u = Reflect.get(options, 'challengeB64u');
  if (typeof challengeB64u !== 'string') throw new Error('Fixture challenge was missing');
  return challengeB64u;
}

function challengeResponse(optionsJsonValue: string): string {
  return JSON.stringify({ challengeB64u: challengeFromOptions(optionsJsonValue) });
}

function post(path: string, cookie: string, body: Record<string, unknown>): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function optionsJson(response: Response | null): Promise<string> {
  expect(response?.status).toBe(200);
  const body: unknown = await response?.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Step-up options response was invalid');
  }
  const options = Reflect.get(body, 'options');
  if (typeof options !== 'string') throw new Error('Step-up options were missing');
  return options;
}

async function verifyStepUpEnrollment(
  { browserName }: { readonly browserName: string },
  testInfo: TestInfo,
): Promise<void> {
  const session = createHmacSessionAdapter({
    secret: 'isolated-step-up-enrollment-session-secret',
    revocations: createInMemoryConsoleSessionRevocationStore(),
    cookieName: COOKIE_NAME,
  });
  const organizationAccess = createInMemoryConsoleOrganizationAccessService();
  const account = createInMemoryConsoleAccountService({
    orgProjectEnv: createInMemoryConsoleOrgProjectService(),
    organizationAccess,
    deletion: { assertOrganizationCanBeDeleted },
  });
  await account.createOrganization(
    {
      userId: USER_ID,
      email: 'owner@step-up.invalid',
      name: 'Step-up owner',
      provider: 'google',
      platformSupport: false,
      orgId: null,
      projectId: null,
    },
    { id: ORG_ID, name: 'Step-up fixture' },
  );
  const hosted = new HostedConsoleAuthHandler({
    audit: createInMemoryConsoleAuditService(),
    handler: fallback,
    identity: { verifyGoogleLogin, verifyGithubOAuthCode },
    recordVerifiedGoogleIdentity,
    providers: {
      google: { configured: true, clientId: 'fixture-google-client' },
      github: { configured: false },
    },
    session,
    account,
    organizationAccess,
    corsOrigins: [ORIGIN],
  });
  const login = await hosted.fetch(
    new Request(`${ORIGIN}/console/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ idToken: 'fixture-google-token' }),
    }),
  );
  expect(login.status).toBe(200);
  expect(login.headers.get('Cache-Control')).toBe('no-store');
  const loginBody: unknown = await login.json();
  if (!loginBody || typeof loginBody !== 'object' || Array.isArray(loginBody)) {
    throw new Error('Console login response was invalid');
  }
  const enrollmentProof = Reflect.get(loginBody, 'enrollmentProof');
  if (typeof enrollmentProof !== 'string') throw new Error('Fresh sign-in supplied no proof');
  const setCookie = login.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('Fresh sign-in supplied no session');
  const ownerCookie = setCookie.split(';')[0];
  const stolenCookie = ownerCookie;
  const credentials = new CredentialStore();
  const stepUp = new StepUpStore();
  let nowMs = Date.now();
  const route = createConsoleStepUpRouteV1({
    auth: createConsoleSessionAuthAdapter({ session, organizationAccess }),
    session,
    credentials,
    stepUp,
    webAuthn: new FixtureWebAuthn(),
    now: () => nowMs,
  });

  const registrationOptionsPath = '/console/step-up/webauthn/registration/options';
  const registrationVerifyPath = '/console/step-up/webauthn/registration/verify';
  const assertionOptionsPath = '/console/step-up/webauthn/assertion/options';
  const assertionVerifyPath = '/console/step-up/webauthn/assertion/verify';
  const stolenFirstAttempt = await route(post(registrationOptionsPath, stolenCookie, {}));
  expect(stolenFirstAttempt?.status).toBe(403);

  nowMs += 301_000;
  const expiredSignInAttempt = await route(
    post(registrationOptionsPath, ownerCookie, { enrollmentProof }),
  );
  expect(expiredSignInAttempt?.status).toBe(403);
  nowMs = Date.now();

  const firstOptions = await optionsJson(
    await route(post(registrationOptionsPath, ownerCookie, { enrollmentProof })),
  );
  const firstCredential = challengeResponse(firstOptions);
  const unauthorizedCommit = await route(
    post(registrationVerifyPath, ownerCookie, { response: firstCredential }),
  );
  expect(unauthorizedCommit?.status).toBe(403);
  const firstRegistration = await route(
    post(registrationVerifyPath, ownerCookie, { enrollmentProof, response: firstCredential }),
  );
  expect(firstRegistration?.status).toBe(200);
  expect(credentials.credentials.size).toBe(1);

  const stolenAdditionalAttempt = await route(post(registrationOptionsPath, stolenCookie, {}));
  expect(stolenAdditionalAttempt?.status).toBe(403);

  const assertionOptions = await optionsJson(
    await route(post(assertionOptionsPath, ownerCookie, {})),
  );
  const assertion = {
    response: JSON.stringify({
      challengeB64u: challengeFromOptions(assertionOptions),
      credentialIdB64u: 'fixture-key-1',
    }),
    credentialIdB64u: 'fixture-key-1',
  };
  const asserted = await route(post(assertionVerifyPath, ownerCookie, assertion));
  expect(asserted?.status).toBe(200);
  expect(await stepUp.readStepUp()).toMatchObject({ actorUserId: USER_ID });
  const assertionBody: unknown = await asserted?.json();
  if (!assertionBody || typeof assertionBody !== 'object' || Array.isArray(assertionBody)) {
    throw new Error('Verified assertion response was invalid');
  }
  const passkeyEnrollmentProof = Reflect.get(assertionBody, 'enrollmentProof');
  if (typeof passkeyEnrollmentProof !== 'string') {
    throw new Error('Verified assertion supplied no enrollment proof');
  }
  const stolenAfterAssertion = await route(post(registrationOptionsPath, stolenCookie, {}));
  expect(stolenAfterAssertion?.status).toBe(403);
  const providerProofReuse = await route(
    post(registrationOptionsPath, stolenCookie, { enrollmentProof }),
  );
  expect(providerProofReuse?.status).toBe(403);
  const foreignOrgProof = await session.signJwt(USER_ID, {
    kind: 'console_step_up_passkey_enrollment_v1',
    orgId: 'another-organization',
  });
  const foreignOrgAttempt = await route(
    post(registrationOptionsPath, ownerCookie, { enrollmentProof: foreignOrgProof }),
  );
  expect(foreignOrgAttempt?.status).toBe(403);

  const secondOptions = await optionsJson(
    await route(
      post(registrationOptionsPath, ownerCookie, {
        enrollmentProof: passkeyEnrollmentProof,
      }),
    ),
  );
  const secondCredential = challengeResponse(secondOptions);
  const secondRegistration = await route(
    post(registrationVerifyPath, ownerCookie, {
      response: secondCredential,
      enrollmentProof: passkeyEnrollmentProof,
    }),
  );
  expect(secondRegistration?.status).toBe(200);
  expect(credentials.credentials.size).toBe(2);

  const evidence = {
    playwrightProjectBrowserName: browserName,
    freshSignInStatus: login.status,
    stolenFirstAttemptStatus: stolenFirstAttempt?.status,
    expiredSignInAttemptStatus: expiredSignInAttempt?.status,
    unauthorizedCommitStatus: unauthorizedCommit?.status,
    firstRegistrationStatus: firstRegistration?.status,
    stolenAdditionalAttemptStatus: stolenAdditionalAttempt?.status,
    assertionStatus: asserted?.status,
    stolenAfterAssertionStatus: stolenAfterAssertion?.status,
    providerProofReuseStatus: providerProofReuse?.status,
    foreignOrgAttemptStatus: foreignOrgAttempt?.status,
    secondRegistrationStatus: secondRegistration?.status,
    finalCredentialCount: credentials.credentials.size,
  };
  const evidencePath = testInfo.outputPath('step-up-enrollment.json');
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await testInfo.attach('step-up-enrollment', {
    path: evidencePath,
    contentType: 'application/json',
  });
  console.log(`STEP_UP_ENROLLMENT_EVIDENCE=${JSON.stringify(evidence)}`);
}

test('a copied owner session cannot enroll a Console step-up passkey', verifyStepUpEnrollment);
import { createInMemoryConsoleAuditService } from '../../../packages/console-server-ts/src/audit/service';
