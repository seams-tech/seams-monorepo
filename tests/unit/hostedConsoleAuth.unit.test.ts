import { createInMemoryConsoleAccountService } from '../../packages/console-server-ts/src/account';
import { expect, test } from '@playwright/test';
import type { SessionAdapter } from '../../packages/console-server-ts/src/boundary/session';
import { createInMemoryConsoleOrgProjectService } from '../../packages/console-server-ts/src/orgProjectEnv';
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
      return {
        ok: false,
        verified: false,
        code: 'not_verified',
        message: 'Provider verification failed',
      };
    },
    verifyGithubOAuthCode: async () => ({
      ok: false,
      verified: false,
      code: 'not_verified',
      message: 'Provider verification failed',
    }),
  };
  return new HostedConsoleAuthHandler({
    handler: async () => new Response('fallback'),
    identity,
    recordVerifiedGoogleIdentity,
    providers: {
      google: { configured: true, clientId: 'google-client-id' },
      github: {
        configured: true,
        clientId: 'github-client-id',
        callbackUrl: 'https://wallet.seams.sh/dashboard/login',
      },
    },
    session: new TestSessionAdapter(),
    account: createInMemoryConsoleAccountService({
      organizationAccess: createInMemoryConsoleOrganizationAccessService(),
      orgProjectEnv: createInMemoryConsoleOrgProjectService(),
      deletion: { assertOrganizationCanBeDeleted },
    }),
    corsOrigins: [],
  });
}

async function assertOrganizationCanBeDeleted(): Promise<void> {}

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

async function recordVerifiedGoogleIdentity(): Promise<void> {}
