import {
  clientId,
  cookieName,
  appDirectory,
  fixtures,
  applyMigrations,
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  isConsoleSessionCookie,
  consoleSessionStatusWithBearer,
  ready,
  recordVerifiedIdentity,
  ProviderAuthority,
  ConsoleTransport,
} from '../../helpers/consoleBrowser.fixtures';
import { expect, test, type Route, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Miniflare } from 'miniflare';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { ConsoleSessionService } from '../../../packages/console-server-ts/src/boundary/session';
import { createD1ConsoleSessionRevocationStore } from '../../../packages/console-server-ts/src/boundary/sessionRevocations';
import { createConsoleProviderIdentity } from '../../../packages/console-server-ts/src/boundary/providerIdentity';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { createAccountConsoleRouter } from '../../../packages/console-server-ts/src/router/cloudflare/createAccountConsoleRouter';
import { createConsoleSessionAuthAdapter } from '../../../packages/wallet-console-server-ts/src/router/cloudflare/d1StagingSession';
import { HostedConsoleAuthHandler } from '../../../packages/wallet-console-server-ts/src/router/hostedConsoleAuth';

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

async function completeGithubAuthorization(route: Route): Promise<void> {
  const authorize = new URL(route.request().url());
  const callback = authorize.searchParams.get('redirect_uri');
  const state = authorize.searchParams.get('state');
  if (!callback || !state) throw new Error('GitHub authorization omitted its callback or state');
  const redirect = new URL(callback);
  redirect.searchParams.set('code', 'github-acceptance-code');
  redirect.searchParams.set('state', state);
  await route.fulfill({ status: 302, headers: { Location: redirect.href } });
}

async function completeOnboarding(page: Page, provider: 'Google' | 'GitHub'): Promise<void> {
  const organization = page.getByRole('form', { name: 'Create organization', exact: true });
  await organization.getByLabel('Organization name').fill(`${provider} acceptance`);
  await organization.getByRole('button', { name: 'Continue', exact: true }).click();
  const project = page.getByRole('form', { name: 'Create project', exact: true });
  await project.getByLabel('Project name').fill(`${provider} project`);
  await project.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account settings', exact: true })).toBeVisible();
}

async function verifyProfileProvider(
  page: Page,
  appUrl: string,
  provider: 'Google' | 'GitHub',
  email: string,
  screenshotPath: string,
): Promise<void> {
  await page.goto(new URL('/dashboard/account-settings', appUrl).href);
  const profile = page.locator('.dashboard-account-profile-card');
  const label = `Signed in with ${provider}`;
  await expect(profile.getByText(label, { exact: true })).toBeVisible();
  await expect(profile.getByText(email, { exact: true })).toBeVisible();
  await page.reload();
  await expect(profile.getByText(label, { exact: true })).toBeVisible();
  await expect.poll(pageHasHorizontalOverflow.bind(null, page)).toBe(false);
  const accountMenu = page.getByRole('button', { name: /Account menu for/ });
  if (!(await accountMenu.isVisible())) {
    await capture(page, screenshotPath.replace('.png', '-profile.png'));
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const navigation = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await navigation.locator('.dashboard-mobile-account summary').click();
    await expect(navigation.getByText(label, { exact: true })).toBeVisible();
    await navigation.getByText(label, { exact: true }).scrollIntoViewIfNeeded();
    await capture(page, screenshotPath);
    await navigation.getByRole('button', { name: 'Close navigation', exact: true }).click();
    return;
  }
  await page.getByRole('button', { name: /Account menu for/ }).click();
  await expect(
    page.getByRole('menu', { name: 'Account options' }).getByText(label, { exact: true }),
  ).toBeVisible();
  await capture(page, screenshotPath);
  await page.getByRole('menu', { name: 'Account options' }).screenshot({
    path: screenshotPath.replace('.png', '-menu.png'),
  });
  await page.keyboard.press('Escape');
}

test('Google sign-in recovers from prompt failures and both providers remain visible after onboarding, reloads, and account changes', async ({
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
      revocations: createD1ConsoleSessionRevocationStore({ database, namespace: 'google-console' }),
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
    const authority = new ProviderAuthority();
    const handler = new HostedConsoleAuthHandler({
      handler: router,
      audit: core.audit,
      identity: createConsoleProviderIdentity({
        googleOidcClientId: clientId,
        githubOAuth: {
          clientId: 'github-acceptance',
          clientSecret: 'isolated-github-acceptance-secret',
          callbackUrl: new URL('/dashboard/login', appUrl).href,
        },
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

    await completeOnboarding(page, 'Google');
    await page.setViewportSize({ width: 1280, height: 900 });
    await verifyProfileProvider(
      page,
      appUrl,
      'Google',
      'getsignal@example.test',
      testInfo.outputPath('google-profile-and-menu-desktop.png'),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await verifyProfileProvider(
      page,
      appUrl,
      'Google',
      'getsignal@example.test',
      testInfo.outputPath('google-profile-and-menu-mobile.png'),
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    const sessionCookie = (await page.context().cookies(appUrl)).find(isConsoleSessionCookie);
    if (!sessionCookie) throw new Error('Console session cookie was not issued');
    const copiedToken = sessionCookie.value;
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signed out', exact: true })).toBeVisible();
    const revokedTokenStatus = await page.evaluate(consoleSessionStatusWithBearer, copiedToken);
    expect(revokedTokenStatus).toBe(401);
    await page
      .context()
      .route('https://github.com/login/oauth/authorize?*', completeGithubAuthorization);
    await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
    await completeOnboarding(page, 'GitHub');
    expect(transport.githubExchanges).toEqual([200]);
    await verifyProfileProvider(
      page,
      appUrl,
      'GitHub',
      'octocat@gmail.com',
      testInfo.outputPath('github-profile-and-menu-mobile.png'),
    );
    await expect(page.getByText('Signed in with Google', { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await verifyProfileProvider(
      page,
      appUrl,
      'GitHub',
      'octocat@gmail.com',
      testInfo.outputPath('github-profile-and-menu-desktop.png'),
    );
    await writeFile(
      testInfo.outputPath('evidence.json'),
      JSON.stringify(
        {
          passed: true,
          command:
            'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/google-sign-in.e2e.test.ts',
          provider: 'controlled Google script, account chooser, and GitHub OAuth endpoints',
          console:
            'production auth, RSA verification, cookie sessions, and real D1 account services',
          exchanges: transport.exchanges,
          githubExchanges: transport.githubExchanges,
          revokedTokenStatus,
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
            'copied Console session token is refused after sign-out',
            'Google provider appears in the profile and account menu after reload',
            'GitHub OAuth replaces the signed-out Google account',
            'GitHub provider stays correct with a Gmail email address',
            'both provider labels fit desktop and mobile layouts',
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
