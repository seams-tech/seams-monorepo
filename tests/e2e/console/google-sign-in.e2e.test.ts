import { expect, test, type Route, type Page } from '@playwright/test';
import { createHmac, generateKeyPairSync, sign, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  ConsoleSessionService,
  type ConsoleSessionJwtHooks,
} from '../../../packages/console-server-ts/src/boundary/session';
import { createConsoleProviderIdentity } from '../../../packages/console-server-ts/src/boundary/providerIdentity';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { createAccountConsoleRouter } from '../../../packages/console-server-ts/src/router/cloudflare/createAccountConsoleRouter';
import { createConsoleSessionAuthAdapter } from '../../../packages/wallet-console-server-ts/src/router/cloudflare/d1StagingSession';
import { HostedConsoleAuthHandler } from '../../../packages/wallet-console-server-ts/src/router/hostedConsoleAuth';

const clientId = 'google-console-acceptance-client';
const cookieName = 'google-console-acceptance-session';
const sessionSecret = 'isolated-google-console-acceptance';
const appDirectory = fileURLToPath(new URL('../../../apps/wallet-console/', import.meta.url));
const fixtures = new URL('../../fixtures/google-console/', import.meta.url);

async function applyMigrations(
  database: Awaited<ReturnType<Miniflare['getD1Database']>>,
): Promise<void> {
  const directory = new URL(
    '../../../packages/console-server-ts/migrations/d1-console-core/',
    import.meta.url,
  );
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    for (const statement of unstable_splitSqlQuery(
      await readFile(new URL(name, directory), 'utf8'),
    )) {
      await database.prepare(statement).run();
    }
  }
}

async function googleButtonFits(page: Page): Promise<boolean> {
  const button = await page
    .getByRole('button', { name: 'Continue with Google', exact: true })
    .boundingBox();
  const wrapper = await page.locator('.dashboard-login__google-sign-in').boundingBox();
  return button !== null && wrapper !== null && button.width <= wrapper.width;
}

function readHorizontalOverflow(): boolean {
  return document.documentElement.scrollWidth > window.innerWidth;
}

async function pageHasHorizontalOverflow(page: Page): Promise<boolean> {
  return await page.evaluate(readHorizontalOverflow);
}

function signSession(input: Parameters<ConsoleSessionJwtHooks['signToken']>[0]): string {
  const payload = Buffer.from(JSON.stringify(input.payload)).toString('base64url');
  return `${payload}.${createHmac('sha256', sessionSecret).update(payload).digest('base64url')}`;
}

function verifySession(token: string): { valid: boolean; payload?: unknown } {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return { valid: false };
  const supplied = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', sessionSecret).update(payload).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return { valid: false };
  return { valid: true, payload: JSON.parse(Buffer.from(payload, 'base64url').toString()) };
}

function setSessionCookie(token: string): string {
  return `${cookieName}=${token}; HttpOnly; Path=/; SameSite=Lax`;
}

function clearSessionCookie(): string {
  return `${cookieName}=; HttpOnly; Path=/; Max-Age=0`;
}

function ready(): void {}
async function recordVerifiedIdentity(): Promise<void> {}

class GoogleAuthority {
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

  token(): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid: 'console-acceptance' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: clientId,
        sub: 'getsignal-acceptance',
        email: 'getsignal@example.test',
        email_verified: true,
        name: 'GetSignal acceptance',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const input = `${header}.${payload}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), this.keys.privateKey).toString('base64url')}`;
  }

  async fetch(input: RequestInfo | URL): Promise<Response> {
    expect(String(input)).toBe('https://www.googleapis.com/oauth2/v3/certs');
    const key = this.keys.publicKey.export({ format: 'jwk' });
    return Response.json({
      keys: [
        { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', kid: 'console-acceptance', use: 'sig' },
      ],
    });
  }
}

class ConsoleTransport {
  readonly exchanges: number[] = [];
  readonly identitySessions: number[] = [];

  constructor(private readonly handler: HostedConsoleAuthHandler) {}

  async handle(route: Route): Promise<void> {
    const incoming = route.request();
    const response = await this.handler.fetch(
      new Request(incoming.url(), {
        method: incoming.method(),
        headers: await incoming.allHeaders(),
        body: incoming.postData(),
      }),
    );
    if (new URL(incoming.url()).pathname === '/console/auth/google')
      this.exchanges.push(response.status);
    if (new URL(incoming.url()).pathname === '/console/auth/session')
      this.identitySessions.push(response.status);
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  }
}

class GoogleBrowserBoundary {
  requests = 0;

  constructor(
    private readonly script: string,
    private readonly chooser: string,
  ) {}

  async load(route: Route): Promise<void> {
    this.requests += 1;
    if (this.requests === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ contentType: 'text/javascript', body: this.script });
  }

  async choose(route: Route): Promise<void> {
    await route.fulfill({ contentType: 'text/html', body: this.chooser });
  }
}

async function openGoogleChooser(page: Page): Promise<Page> {
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  return await popup;
}

async function capture(page: Page, path: string): Promise<void> {
  await page.screenshot({ path, fullPage: true });
}

test('Google One Tap and explicit sign-in recover from unavailable prompts, cancellation, and rejected credentials', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const require = createRequire(import.meta.url);
  const { createServer } = await import(require.resolve('vite', { paths: [appDirectory] }));
  const frontend = await createServer({
    configFile: `${appDirectory}vite.console.config.ts`,
    mode: 'platform',
    base: '/',
    cacheDir: testInfo.outputPath('vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    define: {
      'import.meta.env.VITE_SITE_ORIGIN': 'window.location.origin',
      'import.meta.env.VITE_CONSOLE_BASE_URL': 'window.location.origin',
      'import.meta.env.VITE_TESTNET_CONSOLE_BASE_URL': 'window.location.origin',
      'import.meta.env.VITE_MAINNET_CONSOLE_BASE_URL': 'window.location.origin',
      'import.meta.env.VITE_RELAYER_URL': 'window.location.origin',
      'import.meta.env.VITE_WALLET_CONSOLE_ORIGIN': 'window.location.origin',
    },
  });
  const worker = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Google Console acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { ACCOUNT_DB: 'google-console' },
  });
  try {
    await frontend.listen();
    const appUrl: unknown = frontend.resolvedUrls?.local[0];
    if (typeof appUrl !== 'string') throw new Error('Console frontend did not start');
    const database = await worker.getD1Database('ACCOUNT_DB');
    await applyMigrations(database);
    if (!isD1DatabaseLike(database)) throw new Error('Console database did not start');
    const core = await createCloudflareD1AccountServiceBundle({
      database,
      namespace: 'google-console',
      ensureSchema: true,
      externalDeletionGuard: null,
    });
    const session = new ConsoleSessionService({
      jwt: { signToken: signSession, verifyToken: verifySession },
      cookie: {
        name: cookieName,
        buildSetHeader: setSessionCookie,
        buildClearHeader: clearSessionCookie,
      },
    });
    const router = createAccountConsoleRouter({
      services: core,
      auth: createConsoleSessionAuthAdapter({
        session,
        organizationAccess: core.organizationAccess,
      }),
      session,
      readyCheck: ready,
      walletProvisioning: null,
      satyrProvisioning: null,
      billingStripeWebhookSigningSecret: null,
      corsOrigins: [new URL(appUrl).origin],
    });
    const authority = new GoogleAuthority();
    const handler = new HostedConsoleAuthHandler({
      handler: router,
      identity: createConsoleProviderIdentity({
        googleOidcClientId: clientId,
        fetchImpl: authority.fetch.bind(authority),
      }),
      recordVerifiedGoogleIdentity: recordVerifiedIdentity,
      providers: {
        google: { configured: true, clientId },
        github: {
          configured: true,
          clientId: 'github-acceptance',
          callbackUrl: new URL('/dashboard/login', appUrl).href,
        },
      },
      session,
      account: core.account,
      organizationAccess: core.organizationAccess,
      corsOrigins: [new URL(appUrl).origin],
    });
    const transport = new ConsoleTransport(handler);
    const boundary = new GoogleBrowserBoundary(
      `const googleAcceptanceToken = ${JSON.stringify(authority.token())};\n${await readFile(new URL('identity-provider.js', fixtures), 'utf8')}`,
      await readFile(new URL('account-chooser.html', fixtures), 'utf8'),
    );
    await page.context().route('**/console/**', transport.handle.bind(transport));
    await page
      .context()
      .route('https://accounts.google.com/gsi/client', boundary.load.bind(boundary));
    await page
      .context()
      .route('https://accounts.google.com/console-acceptance?*', boundary.choose.bind(boundary));
    await page.goto(new URL('/dashboard/login', appUrl).href);
    await expect(page.getByRole('alert')).toContainText('Could not load Google sign-in');
    await expect(
      page.getByRole('button', { name: 'Continue with GitHub', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Retry Google sign-in' }).click();
    const google = page.getByRole('button', { name: 'Continue with Google', exact: true });
    await expect(google).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.clock.install();
    await page.clock.fastForward(25_000);
    await expect(google).toBeEnabled();
    expect(transport.exchanges).toEqual([]);
    await capture(page, testInfo.outputPath('one-tap-unavailable-desktop.png'));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(googleButtonFits.bind(null, page)).toBe(true);
    await expect.poll(pageHasHorizontalOverflow.bind(null, page)).toBe(false);
    await capture(page, testInfo.outputPath('one-tap-unavailable-mobile.png'));
    const cancelled = await openGoogleChooser(page);
    await cancelled.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(google).toBeEnabled();
    const keyboardPopup = page.waitForEvent('popup');
    await google.press('Enter');
    const empty = await keyboardPopup;
    await empty.getByRole('button', { name: 'Return empty credential' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Google did not return a sign-in credential',
    );
    expect(transport.exchanges).toEqual([]);
    const invalid = await openGoogleChooser(page);
    await invalid.getByRole('button', { name: 'Return invalid credential' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Google sign-in could not be verified. Try again.',
    );
    await expect(google).toBeEnabled();
    expect(transport.exchanges).toEqual([400]);
    const valid = await openGoogleChooser(page);
    await valid.getByRole('button', { name: 'Choose GetSignal account' }).click();
    await expect(
      page.getByRole('heading', { name: 'Name your organization', exact: true }),
    ).toBeVisible();
    expect(transport.exchanges).toEqual([400, 200]);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Name your organization', exact: true }),
    ).toBeVisible();
    expect(transport.identitySessions.at(-1)).toBe(200);
    await capture(page, testInfo.outputPath('authenticated-onboarding.png'));

    const oneTapPage = await browser.newPage();
    oneTapPage.setDefaultTimeout(15_000);
    const oneTapTransport = new ConsoleTransport(handler);
    try {
      await oneTapPage.route('**/console/**', oneTapTransport.handle.bind(oneTapTransport));
      await oneTapPage.route(
        'https://accounts.google.com/gsi/client',
        boundary.load.bind(boundary),
      );
      await oneTapPage
        .context()
        .route('https://accounts.google.com/console-acceptance?*', boundary.choose.bind(boundary));
      await oneTapPage.goto(new URL('/dashboard/login?google_case=one_tap', appUrl).href);
      await oneTapPage.getByRole('button', { name: 'Continue as GetSignal', exact: true }).click();
      await expect(
        oneTapPage.getByRole('heading', { name: 'Name your organization', exact: true }),
      ).toBeVisible();
      expect(oneTapTransport.exchanges).toEqual([200]);
      await capture(oneTapPage, testInfo.outputPath('one-tap-authenticated.png'));
      await oneTapPage.getByRole('button', { name: /Account menu for/ }).click();
      await oneTapPage.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
      await expect(
        oneTapPage.getByRole('heading', { name: 'Signed out', exact: true }),
      ).toBeVisible();
      await oneTapPage.goto(new URL('/dashboard/login?google_case=one_tap', appUrl).href);
      await oneTapPage.reload();
      await expect(
        oneTapPage.getByRole('heading', { name: 'Signed out', exact: true }),
      ).toBeVisible();
      await expect(
        oneTapPage.getByRole('button', { name: 'Continue with Google', exact: true }),
      ).toBeEnabled();
      await expect(oneTapPage.getByRole('region', { name: 'Google One Tap' })).toHaveCount(0);
      await capture(oneTapPage, testInfo.outputPath('signed-out-after-reload.png'));
      const explicit = await openGoogleChooser(oneTapPage);
      await explicit.getByRole('button', { name: 'Choose GetSignal account', exact: true }).click();
      await expect(
        oneTapPage.getByRole('heading', { name: 'Name your organization', exact: true }),
      ).toBeVisible();
      expect(oneTapTransport.exchanges).toEqual([200, 200]);
    } finally {
      await oneTapPage.close();
    }
    await writeFile(
      testInfo.outputPath('evidence.json'),
      JSON.stringify(
        {
          passed: true,
          command:
            'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/google-sign-in.e2e.test.ts',
          provider: 'controlled Google script and account chooser',
          console:
            'production auth, RSA verification, cookie sessions, and real D1 account services',
          exchanges: transport.exchanges,
          checks: [
            'script retry',
            'unavailable One Tap leaves button enabled after 25 seconds',
            'popup cancellation',
            'empty credential rejected before exchange',
            'invalid JWT rejected by server',
            'successful cookie exchange',
            'onboarding survives reload',
            'One Tap completes sign-in',
            'duplicate One Tap callbacks exchange only once',
            'sign-out survives reload without One Tap',
            'explicit sign-in after sign-out succeeds',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await frontend.close();
    await worker.dispose();
  }
});
