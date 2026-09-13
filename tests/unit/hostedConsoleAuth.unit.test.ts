import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '@seams-internal/wallet-console-shared/apiKeyScopes';
import { createInMemoryConsoleApiKeyService } from '../../packages/console-server-ts/src/apiKeys/service';
import { createInMemoryConsoleOnboardingService } from '../../packages/console-server-ts/src/onboarding/service';
import { createCloudflareConsoleRouter } from '../../packages/wallet-console-server-ts/src/router/cloudflare/createCloudflareConsoleRouter';
import { createInMemoryConsoleAccountService } from '../../packages/console-server-ts/src/account';
import { expect, test } from '@playwright/test';
import type { SessionAdapter } from '../../packages/console-server-ts/src/boundary/session';
import { createInMemoryConsoleOrgProjectEnvService } from '../../packages/console-server-ts/src/orgProjectEnv';
import { createInMemoryConsoleOrganizationAccessService } from '../../packages/console-server-ts/src/teamRbac';
import {
  HostedConsoleAuthHandler,
  type HostedConsoleIdentityPort,
} from '../../packages/wallet-console-server-ts/src/router/hostedConsoleAuth';

class TestSessionAdapter implements SessionAdapter {
  async signJwt(): Promise<string> {
    return 'test-session-token';
  }

  async verifyJwt(): Promise<{ readonly valid: false }> {
    return { valid: false };
  }

  async parse(): Promise<{ readonly ok: false; readonly reason: 'missing' }> {
    return { ok: false, reason: 'missing' };
  }

  buildSetCookie(token: string): string {
    return `session=${token}`;
  }

  buildClearCookie(): string {
    return 'session=; Max-Age=0';
  }

  async refresh(): Promise<{ readonly ok: false }> {
    return { ok: false };
  }
}

function createHandler(calls: string[]): HostedConsoleAuthHandler {
  const identity: HostedConsoleIdentityPort = {
    verifyGoogleLogin: async ({ idToken }) => {
      calls.push(idToken);
      return { ok: false, verified: false, code: 'not_verified' };
    },
    verifyGithubOAuthCode: async () => ({
      ok: false,
      verified: false,
      code: 'not_verified',
    }),
  };
  return new HostedConsoleAuthHandler({
    handler: async () => new Response('fallback'),
    identity,
    providers: {
      google: { configured: true, clientId: 'google-client-id' },
      github: {
        configured: true,
        clientId: 'github-client-id',
        callbackUrl: 'https://wallet.seams.sh/dashboard/login',
      },
    },
    session: new TestSessionAdapter(),
    orgProjectEnv: createInMemoryConsoleOrgProjectEnvService(),
    account: createInMemoryConsoleAccountService({
      organizationAccess: createInMemoryConsoleOrganizationAccessService(),
      orgProjectEnv: createInMemoryConsoleOrgProjectEnvService(),
    }),
    corsOrigins: [],
  });
}

async function postGoogle(handler: HostedConsoleAuthHandler, body: string): Promise<Response> {
  return await handler.fetch(
    new Request('https://console.example.test/console/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );
}

test('hosted console auth decodes an exact string-only provider request', async () => {
  const calls: string[] = [];
  const handler = createHandler(calls);

  for (const body of ['{}', '{"idToken":123}', '{"idToken":"token","extra":true}', '[]', 'null']) {
    const response = await postGoogle(handler, body);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'invalid_body' });
  }
  expect(calls).toEqual([]);

  const accepted = await postGoogle(handler, '{"idToken":"  token  "}');
  expect(accepted.status).toBe(401);
  expect(calls).toEqual(['token']);
});

test('hosted console auth serves Console-owned provider options', async () => {
  const handler = createHandler([]);
  const googleResponse = await handler.fetch(
    new Request('https://wallet.seams.sh/console/auth/google/options', { method: 'POST' }),
  );
  const githubResponse = await handler.fetch(
    new Request('https://wallet.seams.sh/console/auth/github/options', { method: 'POST' }),
  );

  await expect(googleResponse.json()).resolves.toEqual({
    ok: true,
    configured: true,
    clientId: 'google-client-id',
  });
  await expect(githubResponse.json()).resolves.toEqual({
    ok: true,
    configured: true,
    clientId: 'github-client-id',
    callbackUrl: 'https://wallet.seams.sh/dashboard/login',
  });
});

class VerifiedAccountIdentity implements HostedConsoleIdentityPort {
  async verifyGoogleLogin() {
    return {
      ok: true,
      verified: true,
      userId: 'google:self-service-user',
      email: 'owner@example.com',
      name: 'Owner',
      emailVerified: true,
    };
  }
  async verifyGithubOAuthCode() {
    return { ok: false, verified: false, code: 'not_verified' };
  }
}

async function selfServiceOrganizationCreation(): Promise<void> {
  const { createHmacSessionAdapter, createConsoleSessionAuthAdapter } =
    await import('../../packages/wallet-console-server-ts/src/router/cloudflare/d1StagingSession');
  const organizationAccess = createInMemoryConsoleOrganizationAccessService();
  const orgProjectEnv = createInMemoryConsoleOrgProjectEnvService();
  const account = createInMemoryConsoleAccountService({ organizationAccess, orgProjectEnv });
  const session = createHmacSessionAdapter({
    secret: 'self-service-test-secret-at-least-32-characters',
    issuer: 'test-console',
    audience: 'test-console',
  });
  const auth = createConsoleSessionAuthAdapter({ session, organizationAccess });
  const apiKeys = createInMemoryConsoleApiKeyService({
    scopeValidation: WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
  });
  const onboarding = createInMemoryConsoleOnboardingService({
    orgProjectEnv,
    organizationAccess,
    apiKeys,
  });
  const router = createCloudflareConsoleRouter({
    auth,
    account,
    session,
    orgProjectEnv,
    onboarding,
    apiKeys,
  });
  const handler = new HostedConsoleAuthHandler({
    handler: router,
    identity: new VerifiedAccountIdentity(),
    providers: {
      google: { configured: false },
      github: { configured: false },
    },
    session,
    account,
    orgProjectEnv,
    corsOrigins: [],
  });
  const login = await postGoogle(handler, JSON.stringify({ idToken: 'verified-by-test-provider' }));
  expect(login.status).toBe(200);
  await expect(login.json()).resolves.toEqual({
    ok: true,
    session: { kind: 'console_identity_v1' },
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  expect((await auth.authenticate({ cookie })).ok).toBe(false);
  expect(await orgProjectEnv.findDefaultOrganization()).toBeNull();
  const created = await handler.fetch(
    new Request('https://console.example.test/console/account/organizations', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Customer-created workspace' }),
    }),
  );
  expect(created.status).toBe(200);
  const ownerCookie = created.headers.get('set-cookie')!.split(';')[0]!;
  const authorized = await auth.authenticate({ cookie: ownerCookie });
  expect(authorized.ok).toBe(true);
  if (!authorized.ok) throw new Error('Expected organization authorization');
  expect(authorized.claims.role).toBe('OWNER');
  expect(authorized.claims.projectId).toBeUndefined();
  expect(authorized.claims.environmentId).toBeUndefined();
  const organization = await orgProjectEnv.getOrganization({
    orgId: authorized.claims.orgId,
    actorUserId: authorized.claims.userId,
  });
  expect(organization.name).toBe('Customer-created workspace');
  const provisioned = await handler.fetch(
    new Request('https://console.example.test/console/onboarding/project', {
      method: 'POST',
      headers: { cookie: ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        project: { name: 'Customer project' },
        environment: { name: 'Development' },
      }),
    }),
  );
  expect(provisioned.ok).toBe(true);
  const {
    result: { project },
  } = await provisioned.json();
  const selected = await handler.fetch(
    environmentRequest(ownerCookie, project.id, `${project.id}:dev`),
  );
  expect(selected.status).toBe(200);
  const selectedCookie = selected.headers.get('set-cookie')!.split(';')[0]!;
  const scoped = await auth.authenticate({ cookie: selectedCookie });
  expect(scoped.ok).toBe(true);
  if (!scoped.ok) throw new Error('Expected environment authorization');
  expect(scoped.claims.projectId).toBe(project.id);
  expect(scoped.claims.environmentId).toBe(`${project.id}:dev`);
  const keyResponse = await handler.fetch(
    new Request('https://console.example.test/console/api-keys', {
      method: 'POST',
      headers: { cookie: selectedCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'publishable_key',
        name: 'Customer application',
        environmentId: `${project.id}:dev`,
        allowedOrigins: ['https://app.example.test'],
        rateLimitBucket: 'default',
        quotaBucket: 'default',
      }),
    }),
  );
  expect(keyResponse.status).toBe(201);
  await expect(keyResponse.json()).resolves.toMatchObject({
    ok: true,
    secret: expect.any(String),
    apiKey: { environmentId: `${project.id}:dev` },
  });
  const rejected = await handler.fetch(
    environmentRequest(ownerCookie, 'another-project', 'another-project:dev'),
  );
  expect(rejected.status).toBe(403);
  expect(rejected.headers.get('set-cookie')).toBeNull();
  const unscoped = await handler.fetch(environmentRequest(cookie, project.id, `${project.id}:dev`));
  expect(unscoped.status).toBe(401);
  const returningLogin = await postGoogle(
    handler,
    JSON.stringify({ idToken: 'verified-by-test-provider' }),
  );
  await expect(returningLogin.json()).resolves.toEqual({
    ok: true,
    session: { kind: 'console_session_v1' },
  });
}

test(
  'verified account creates its first organization through the shared API without seeded scope',
  selfServiceOrganizationCreation,
);

function environmentRequest(cookie: string, projectId: string, environmentId: string): Request {
  return new Request('https://console.example.test/console/auth/environment', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, environmentId }),
  });
}
