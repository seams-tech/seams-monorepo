import { expect, test, type BrowserContext, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createInMemoryConsoleAccountService } from '../../../packages/console-server-ts/src/account/service';
import { createInMemoryConsoleOrgProjectService } from '../../../packages/console-server-ts/src/orgProjectEnv/service';
import { createInMemoryConsoleOrganizationAccessService } from '../../../packages/console-server-ts/src/teamRbac/service';
import { createHmacSessionAdapter } from '../../../packages/wallet-console-server-ts/src/router/cloudflare/d1StagingSession';
import {
  HostedConsoleAuthHandler,
  type HostedConsoleIdentityPort,
} from '../../../packages/wallet-console-server-ts/src/router/hostedConsoleAuth';
import { createInMemoryConsoleSessionRevocationStore } from '../../helpers/consoleSessionRevocationStore';

const backendOrigin = 'https://console.example.test';
const attackerOrigin = 'https://evil.example.test';
const cookieName = 'seams-console-jwt';

async function allowDeletion(): Promise<void> {}
async function recordVerifiedGoogleIdentity(): Promise<void> {}

const identity: HostedConsoleIdentityPort = {
  async verifyGoogleLogin() {
    return { ok: false, verified: false, code: 'unavailable', message: 'Unavailable' };
  },
  async verifyGithubOAuthCode(input) {
    if (input.code !== 'attacker-code') {
      return { ok: false, verified: false, code: 'invalid', message: 'Invalid code' };
    }
    return {
      ok: true,
      verified: true,
      userId: 'github:attacker',
      providerSubject: 'github:attacker',
      sub: 'attacker',
      email: 'attacker@example.test',
      name: 'Attacker',
    };
  },
};

async function fallback(): Promise<Response> {
  return new Response('Not Found', { status: 404 });
}

async function abortRequest(route: Route): Promise<void> {
  await route.abort();
}

async function attackerPage(route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Attacker</title>' });
}

async function submitNoCorsLogin(): Promise<string> {
  const response = await fetch('https://console.example.test/console/auth/github', {
    method: 'POST',
    mode: 'no-cors',
    credentials: 'include',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ code: 'attacker-code' }),
  });
  return response.type;
}

async function submitNoCorsSignOut(): Promise<string> {
  const response = await fetch('https://console.example.test/console/auth/revoke', {
    method: 'POST',
    mode: 'no-cors',
    credentials: 'include',
    headers: { 'Content-Type': 'text/plain' },
  });
  return response.type;
}

async function submitTrustedLogin(): Promise<number> {
  const response = await fetch('/console/auth/github', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'attacker-code' }),
  });
  return response.status;
}

async function readConsoleCookie(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies(`${backendOrigin}/console/session`);
  for (const cookie of cookies) {
    if (cookie.name === cookieName) return cookie.value;
  }
  throw new Error('Console cookie was absent');
}

class BackendFixture {
  readonly responses: number[] = [];
  readonly origins: Array<string | undefined> = [];
  readonly cookiePresent: boolean[] = [];

  constructor(private readonly handler: HostedConsoleAuthHandler) {}

  async handle(route: Route): Promise<void> {
    const incoming = route.request();
    const headers = await incoming.allHeaders();
    const response = await this.handler.fetch(
      new Request(incoming.url(), {
        method: incoming.method(),
        headers,
        body: incoming.postData(),
      }),
    );
    this.responses.push(response.status);
    this.origins.push(headers.origin);
    this.cookiePresent.push(Boolean(headers.cookie));
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    });
  }
}

test('a sibling origin cannot replace or revoke a Console session', async ({
  browser,
}, testInfo) => {
  const organizationAccess = createInMemoryConsoleOrganizationAccessService();
  const account = createInMemoryConsoleAccountService({
    organizationAccess,
    orgProjectEnv: createInMemoryConsoleOrgProjectService(),
    deletion: { assertOrganizationCanBeDeleted: allowDeletion },
  });
  const session = createHmacSessionAdapter({
    secret: 'isolated-login-csrf-validation-secret',
    cookieName,
    revocations: createInMemoryConsoleSessionRevocationStore(),
  });
  const handler = new HostedConsoleAuthHandler({
    handler: fallback,
    identity,
    recordVerifiedGoogleIdentity,
    providers: {
      google: { configured: false },
      github: { configured: true, clientId: 'fixture', callbackUrl: `${backendOrigin}/callback` },
    },
    session,
    account,
    organizationAccess,
    corsOrigins: [backendOrigin],
  });
  const backend = new BackendFixture(handler);
  const context = await browser.newContext();
  try {
    await context.route('**/*', abortRequest);
    await context.route(`${attackerOrigin}/**`, attackerPage);
    await context.route(`${backendOrigin}/**`, backend.handle.bind(backend));
    const victimToken = await session.signJwt('github:victim', {
      kind: 'console_session_v1',
      orgId: 'victim-org',
      email: 'victim@example.test',
      provider: 'github',
    });
    await context.addCookies([
      {
        name: cookieName,
        value: victimToken,
        domain: 'console.example.test',
        path: '/console',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const before = await readConsoleCookie(context);
    const page = await context.newPage();
    await page.goto(attackerOrigin);
    const responseType = await page.evaluate(submitNoCorsLogin);
    const afterBlockedLogin = await readConsoleCookie(context);
    expect(backend.responses).toEqual([403]);
    expect(backend.cookiePresent).toEqual([true]);
    expect(afterBlockedLogin).toBe(before);

    const signOutResponseType = await page.evaluate(submitNoCorsSignOut);
    const afterBlockedSignOut = await readConsoleCookie(context);
    expect(backend.responses).toEqual([403, 403]);
    expect(backend.cookiePresent).toEqual([true, true]);
    expect(afterBlockedSignOut).toBe(before);

    await context.route(`${backendOrigin}/login`, attackerPage);
    const trustedPage = await context.newPage();
    await trustedPage.goto(`${backendOrigin}/login`);
    const trustedStatus = await trustedPage.evaluate(submitTrustedLogin);
    const afterTrustedLogin = await readConsoleCookie(context);
    expect(trustedStatus).toBe(200);
    expect(afterTrustedLogin).not.toBe(before);
    await writeFile(
      testInfo.outputPath('evidence.json'),
      JSON.stringify({
        passed: true,
        command:
          'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/console-session-csrf.e2e.test.ts',
        responseType,
        signOutResponseType,
        backendResponses: backend.responses,
        origins: backend.origins,
        cookiePresent: backend.cookiePresent,
        blockedCookieReplaced: before !== afterBlockedLogin,
        blockedSignOutClearedCookie: before !== afterBlockedSignOut,
        trustedStatus,
        trustedCookieReplaced: before !== afterTrustedLogin,
      }),
    );
  } finally {
    await context.close();
  }
});
