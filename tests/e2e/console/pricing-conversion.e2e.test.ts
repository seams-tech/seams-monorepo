import { expect as baseExpect, test, type Page, type Route, type TestInfo } from '@playwright/test';
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
import {
  createSimulatedBillingProviderAdapters,
  type BillingProviderAdapters,
} from '../../../packages/console-server-ts/src/billing/providers';
import { createStripeBillingProviderAdapter } from '../../../packages/console-server-ts/src/billing/stripeProvider';
import { parseStripeCardSetupWebhookEvent } from '../../../packages/console-server-ts/src/billing/stripeWebhook';
import { createCaptureConsoleEmailProvider } from '../../../packages/console-server-ts/src/email/providers';
import type {
  ConsoleEmailProvider,
  ConsoleEmailProviderSendRequest,
  ConsoleEmailProviderSendResult,
} from '../../../packages/console-server-ts/src/email/types';
import { runD1ConsoleEmailDispatcher } from '../../../packages/console-server-ts/src/email/d1';
import { queryD1All } from '../../../packages/console-server-ts/src/boundary/d1';
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
  ready,
  recordVerifiedIdentity,
  ProviderAuthority,
  ConsoleTransport,
} from '../../helpers/consoleBrowser.fixtures';

const namespace = 'pricing-funnel';
const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ trace: 'retain-on-failure', screenshot: 'only-on-failure' });

class FunnelClock {
  ms = Date.now();
  now(): Date {
    return new Date(this.ms);
  }
}

class LostEmailAcknowledgement implements ConsoleEmailProvider {
  readonly provider = 'capture';
  readonly capture = createCaptureConsoleEmailProvider();
  private loseNextAcknowledgement = true;
  async send(request: ConsoleEmailProviderSendRequest): Promise<ConsoleEmailProviderSendResult> {
    const result = await this.capture.send(request);
    if (!this.loseNextAcknowledgement) return result;
    this.loseNextAcknowledgement = false;
    return {
      kind: 'RETRYABLE_FAILURE',
      errorCode: 'acceptance_lost_acknowledgement',
      statusCode: null,
    };
  }
}

async function startConsole(testInfo: TestInfo, providers: BillingProviderAdapters) {
  const require = createRequire(import.meta.url);
  const { createServer } = await import(require.resolve('vite', { paths: [appDirectory] }));
  const frontend = await createServer({
    configFile: `${appDirectory}vite.console.config.ts`,
    mode: 'wallet',
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
    script: 'export default { fetch() { return new Response("Funnel acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { ACCOUNT_DB: 'pricing-funnel' },
  });
  await frontend.listen();
  const appUrl: unknown = frontend.resolvedUrls?.local[0];
  if (typeof appUrl !== 'string') throw new Error('Console frontend did not start');
  const database = await worker.getD1Database('ACCOUNT_DB');
  await applyMigrations(database);
  if (!isD1DatabaseLike(database)) throw new Error('Console database did not start');
  const clock = new FunnelClock();
  const core = await createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    ensureSchema: true,
    externalDeletionGuard: null,
    now: clock.now.bind(clock),
    billingProviders: providers,
    billingEmailConsoleBaseUrl: appUrl,
  });
  const session = new ConsoleSessionService({
    jwt: { signToken: signSession, verifyToken: verifySession },
    revocations: createD1ConsoleSessionRevocationStore({ database, namespace }),
    cookie: {
      name: cookieName,
      buildSetHeader: setSessionCookie,
      buildClearHeader: clearSessionCookie,
    },
  });
  const router = createAccountConsoleRouter({
    services: core,
    auth: createConsoleSessionAuthAdapter({ session, organizationAccess: core.organizationAccess }),
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
        clientId: 'github-funnel',
        clientSecret: 'isolated-funnel-secret',
        callbackUrl: new URL('/dashboard/login', appUrl).href,
      },
      fetchImpl: authority.fetch.bind(authority),
    }),
    recordVerifiedGoogleIdentity: recordVerifiedIdentity,
    providers: {
      google: { configured: true, clientId },
      github: {
        configured: true,
        clientId: 'github-funnel',
        callbackUrl: new URL('/dashboard/login', appUrl).href,
      },
    },
    session,
    account: core.account,
    organizationAccess: core.organizationAccess,
    corsOrigins: [new URL(appUrl).origin],
  });
  return { frontend, worker, appUrl, database, core, session, clock, authority, handler };
}

async function githubAuthorize(route: Route): Promise<void> {
  const authorize = new URL(route.request().url());
  const callback = authorize.searchParams.get('redirect_uri');
  const state = authorize.searchParams.get('state');
  if (!callback || !state) throw new Error('Missing OAuth state');
  const redirect = new URL(callback);
  redirect.searchParams.set('code', 'github-acceptance-code');
  redirect.searchParams.set('state', state);
  await route.fulfill({ status: 302, headers: { Location: redirect.href } });
}

async function signInGithub(
  page: Page,
  appUrl: string,
  plan: 'free' | 'growth' | 'pro',
): Promise<void> {
  await page.goto(new URL(`/dashboard/login?plan=${plan}&src=pricing_card`, appUrl).href);
  await expect(
    page.getByRole('button', { name: 'Continue with GitHub', exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
}

async function installBrowser(page: Page, handler: HostedConsoleAuthHandler): Promise<void> {
  const transport = new ConsoleTransport(handler);
  await page.context().route('**/console/**', transport.handle.bind(transport));
  await page.context().route('https://github.com/login/oauth/authorize?*', githubAuthorize);
  await page.context().route('https://accounts.google.com/gsi/client', abortGoogle);
}

async function abortGoogle(route: Route): Promise<void> {
  await route.abort();
}

async function serveBrowserFixture(contentType: string, body: string, route: Route): Promise<void> {
  await route.fulfill({ contentType, body });
}

async function unavailableCheckout(route: Route): Promise<void> {
  await route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: false,
      code: 'stripe_unavailable',
      message: 'Stripe is temporarily unavailable',
    }),
  });
}

async function apiRequest(input: {
  path: string;
  body: unknown;
  method: string;
}): Promise<{ status: number; body: any }> {
  const response = await fetch(input.path, {
    method: input.method,
    headers: { 'Content-Type': 'application/json' },
    body: input.method === 'GET' ? undefined : JSON.stringify(input.body),
  });
  return { status: response.status, body: await response.json() };
}

async function organizationCount(
  harness: Awaited<ReturnType<typeof startConsole>>,
): Promise<number> {
  const row = await harness.database
    .prepare('SELECT COUNT(*) AS count FROM organizations WHERE namespace = ?')
    .bind(namespace)
    .first();
  return Number(row?.count);
}

test('pricing funnel resumes Free, chooses an organization, requires confirmation, and deduplicates measurement and day-one email', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const harness = await startConsole(testInfo, createSimulatedBillingProviderAdapters());
  try {
    await installBrowser(page, harness.handler);
    await signInGithub(page, harness.appUrl, 'free');
    await expect(page).toHaveURL(/dashboard\/overview/, { timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Free plan summary' })).toContainText('300');
    await expect(page.getByRole('region', { name: 'Free plan summary' })).toContainText('30,000');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Free plan summary' })).toBeVisible();
    expect(await organizationCount(harness)).toBe(1);
    const state = await page.evaluate(apiRequest, {
      path: '/console/session',
      method: 'GET',
      body: null,
    });
    const firstOrg = state.body.claims.orgId;
    await page.screenshot({ path: testInfo.outputPath('free-day-zero.png'), fullPage: true });
    const second = await page.evaluate(apiRequest, {
      path: '/console/account/organizations',
      method: 'POST',
      body: { name: 'Second organization' },
    });
    expect(second.status).toBe(201);
    await page.goto(new URL('/dashboard/login?plan=growth&src=pricing_card', harness.appUrl).href);
    await expect(page.getByRole('region', { name: 'Choose organization' })).toBeVisible();
    await page.getByRole('button', { name: 'My organization', exact: true }).click();
    await expect(page).toHaveURL(/dashboard\/overview/, { timeout: 15_000 });
    await page.goto(new URL('/dashboard/billing/plan', harness.appUrl).href);
    await expect(page.getByRole('region', { name: 'Current plan' })).toContainText('Growth');
    expect(await organizationCount(harness)).toBe(2);
    const growth = await harness.core.freePlan.getPlan({ orgId: firstOrg });
    expect(growth?.plan).toBe('growth');
    await page.screenshot({ path: testInfo.outputPath('growth-started.png'), fullPage: true });

    // A new Google identity abandons setup. Its reminder uses the real delayed outbox.
    const abandoned = await browser.newPage();
    await installBrowser(abandoned, harness.handler);
    const googleScript = `const googleAcceptanceToken = ${JSON.stringify(harness.authority.token())};\n${await readFile(new URL('identity-provider.js', fixtures), 'utf8')}`;
    await abandoned
      .context()
      .route(
        'https://accounts.google.com/gsi/client',
        serveBrowserFixture.bind(null, 'text/javascript', googleScript),
      );
    await abandoned
      .context()
      .route(
        'https://accounts.google.com/console-acceptance?*',
        serveBrowserFixture.bind(
          null,
          'text/html',
          await readFile(new URL('account-chooser.html', fixtures), 'utf8'),
        ),
      );
    await abandoned.route('**/console/billing/card-setup', unavailableCheckout);
    await abandoned.goto(
      new URL('/dashboard/login?plan=pro&src=pricing_card', harness.appUrl).href,
    );
    const intent = await abandoned.evaluate(readIntent);
    await abandoned.reload();
    const popupPromise = abandoned.waitForEvent('popup');
    await abandoned.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    const popup = await popupPromise;
    await popup.getByRole('button', { name: 'Choose GetSignal account', exact: true }).click();
    await expect(abandoned.getByRole('alert')).toContainText('Card setup did not start');
    await expect(
      abandoned.getByRole('link', { name: 'Continue on Free', exact: true }),
    ).toBeVisible();
    expect(await abandoned.evaluate(readIntent)).toEqual(intent);
    const session = await abandoned.evaluate(apiRequest, {
      path: '/console/session',
      method: 'GET',
      body: null,
    });
    const abandonedOrg = session.body.claims.orgId;
    for (let replay = 0; replay < 3; replay += 1) {
      const response = await abandoned.evaluate(apiRequest, {
        path: '/console/auth/funnel',
        method: 'POST',
        body: { event: 'plan_ready', intent },
      });
      expect(response.status).toBe(200);
    }
    const provider = new LostEmailAcknowledgement();
    const dispatch = {
      database: harness.database,
      namespace,
      provider,
      now: harness.clock.now.bind(harness.clock),
      ensureSchema: false,
    };
    expect((await runD1ConsoleEmailDispatcher(dispatch)).sentCount).toBe(0);
    harness.clock.ms += 86_400_001;
    const firstDelivery = await runD1ConsoleEmailDispatcher(dispatch);
    expect(firstDelivery.retryScheduledCount).toBe(1);
    expect(firstDelivery.canceledCount).toBe(1);
    harness.clock.ms += 120_000;
    expect((await runD1ConsoleEmailDispatcher(dispatch)).sentCount).toBe(1);
    expect((await runD1ConsoleEmailDispatcher(dispatch)).sentCount).toBe(0);
    const email = provider.capture.listCaptured()[0];
    expect(email.subject).toBe('Finish starting Pro');
    expect(email.text).toContain('$399');
    expect(email.text).toContain(abandonedOrg);
    await writeFile(testInfo.outputPath('day-one-email.html'), email.html);
    await abandoned.getByRole('link', { name: 'Continue on Free', exact: true }).click();
    await expect(abandoned.getByRole('region', { name: 'Free plan summary' })).toBeVisible();
    await abandoned.evaluate(apiRequest, {
      path: '/console/auth/funnel',
      method: 'POST',
      body: { event: 'growth_continue_free', intent },
    });
    const events = await queryD1All(
      harness.database,
      await readFile(new URL('../../../docs/pricing-funnel-events.sql', import.meta.url), 'utf8'),
      [namespace],
    );
    const loginEvents = events.filter(isLoginEvent);
    expect(loginEvents).toHaveLength(3);
    expect(new Set(events.map(eventId)).size).toBe(events.length);
    expect(events.filter(isContinueFreeEvent)).toHaveLength(1);
    expect(provider.capture.listCaptured()).toHaveLength(1);
    await writeFile(
      testInfo.outputPath('funnel-evidence.json'),
      JSON.stringify(
        {
          events,
          firstOrg,
          abandonedOrg,
          growth,
          capturedEmails: provider.capture.listCaptured().length,
          lostEmailAcknowledgementRetried: true,
          obsoleteReminderCanceled: firstDelivery.canceledCount,
        },
        null,
        2,
      ),
    );
    await abandoned.close();
  } finally {
    await harness.frontend.close();
    await harness.worker.dispose();
  }
});

function readIntent(): { plan: 'free' | 'growth' | 'pro'; src: 'pricing_card'; projectId: string } {
  const value = JSON.parse(sessionStorage.getItem('seams.console.pendingPlanIntent') || 'null');
  if (!value) throw new Error('Plan intent was lost');
  return { plan: value.plan, src: value.src, projectId: value.projectId };
}

function isLoginEvent(row: Record<string, unknown>): boolean {
  return row.event === 'console_login_view';
}
function eventId(row: Record<string, unknown>): unknown {
  return row.event_id;
}

function isContinueFreeEvent(row: Record<string, unknown>): boolean {
  return row.event === 'growth_continue_free';
}

async function stripeTestKey(): Promise<string> {
  const text = process.env.STRIPE_API_SK
    ? ''
    : await readFile(new URL('../../../.env.local', import.meta.url), 'utf8');
  const key =
    process.env.STRIPE_API_SK ||
    text
      .match(/^STRIPE_API_SK=(.*)$/m)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, '') ||
    '';
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_'))
    throw new Error('Acceptance requires a Stripe test key');
  return key;
}

async function stripeRequest(key: string, path: string, method = 'GET'): Promise<any> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Stripe test request failed: ${response.status}`);
  if (body && typeof body === 'object' && Reflect.get(body, 'livemode') === true)
    throw new Error('Acceptance refuses a live Stripe object');
  return body;
}

async function blockStripeReturn(route: Route): Promise<void> {
  await route.abort();
}

test('Stripe test mode preserves cancellation and starts Growth once after a lost browser return', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const key = await stripeTestKey();
  const providers = createSimulatedBillingProviderAdapters();
  const harness = await startConsole(testInfo, {
    ...providers,
    stripe: createStripeBillingProviderAdapter({ secretKey: key }),
  });
  try {
    await installBrowser(page, harness.handler);
    await signInGithub(page, harness.appUrl, 'growth');
    await expect(page).toHaveURL(/checkout\.stripe\.com/, { timeout: 30_000 });
    await expect(page.getByText(/Growth.*\$99/)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('stripe-test-setup.png'), fullPage: true });
    const setup = await harness.database
      .prepare(
        'SELECT org_id, checkout_session_ref, customer_ref FROM billing_card_setup_sessions WHERE namespace = ? ORDER BY created_at_ms DESC LIMIT 1',
      )
      .bind(namespace)
      .first();
    if (!setup) throw new Error('Stripe setup was not persisted');
    const checkout = await stripeRequest(key, `checkout/sessions/${setup.checkout_session_ref}`);
    expect(checkout.mode).toBe('setup');
    expect(checkout.livemode).toBe(false);
    expect(checkout.custom_text.submit.message).toContain('$99');
    await page.getByRole('link', { name: /^Back to / }).click();
    await expect(
      page.getByText('Card setup was canceled. No card was added, and your plan did not change.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue on Free', exact: true })).toBeVisible();
    await page.reload();
    expect((await harness.core.freePlan.getPlan({ orgId: String(setup.org_id) }))?.plan).toBe(
      'free',
    );
    await page.screenshot({ path: testInfo.outputPath('stripe-cancel.png'), fullPage: true });
    await page.getByRole('button', { name: /Start Growth/ }).click();
    await expect(page).toHaveURL(/checkout\.stripe\.com/, { timeout: 30_000 });
    await page
      .getByRole('textbox', { name: 'Email', exact: true })
      .fill('stripe-funnel@example.test');
    await page.getByLabel('Card number', { exact: true }).fill('4242424242424242');
    await page.getByLabel(/Expiration|MM.*YY/).fill('1230');
    await page
      .getByRole('textbox', { name: 'Credit or debit card CVC/CVV', exact: true })
      .fill('123');
    const name = page.getByLabel(/Cardholder name|Name on card/);
    if (await name.isVisible()) await name.fill('Funnel acceptance');
    const postal = page.getByLabel(/ZIP|Postal/);
    if (await postal.isVisible()) await postal.fill('10001');
    await page.route('**/dashboard/overview?*card_setup=success*', blockStripeReturn);
    await page.getByRole('button', { name: /Save card|Set up|Save/ }).click();
    const latest = await harness.database
      .prepare(
        'SELECT checkout_session_ref FROM billing_card_setup_sessions WHERE namespace = ? AND checkout_session_ref <> ?',
      )
      .bind(namespace, setup.checkout_session_ref)
      .first();
    if (!latest) throw new Error('Retry setup is missing');
    await expect
      .poll(checkoutStatus.bind(null, key, String(latest.checkout_session_ref)), {
        timeout: 45_000,
      })
      .toBe('complete');
    expect((await harness.core.freePlan.getPlan({ orgId: String(setup.org_id) }))?.plan).toBe(
      'free',
    );
    const completed = await stripeRequest(key, `checkout/sessions/${latest.checkout_session_ref}`);
    const webhook = parseStripeCardSetupWebhookEvent({
      id: `evt_acceptance_${latest.checkout_session_ref}`,
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: completed },
    });
    if (!webhook) throw new Error('Stripe completion did not parse');
    await harness.core.freePlan.handleWebhookEvent(webhook);
    await harness.core.freePlan.handleWebhookEvent(webhook);
    const plan = await harness.core.freePlan.getPlan({ orgId: String(setup.org_id) });
    expect(plan?.plan).toBe('growth');
    const charges = await queryD1All(
      harness.database,
      'SELECT amount_minor, price_version FROM billing_plan_base_charges WHERE namespace = ? AND org_id = ?',
      [namespace, setup.org_id],
    );
    expect(charges).toHaveLength(1);
    await page.unroute('**/dashboard/overview?*card_setup=success*', blockStripeReturn);
    await page.goto(new URL('/dashboard/billing/plan', harness.appUrl).href);
    await expect(page.getByRole('region', { name: 'Current plan' })).toContainText('Growth');
    await page.screenshot({
      path: testInfo.outputPath('lost-return-recovered.png'),
      fullPage: true,
    });
    await writeFile(
      testInfo.outputPath('stripe-test-evidence.json'),
      JSON.stringify(
        {
          livemode: completed.livemode,
          checkoutSessionId: completed.id,
          customerId: setup.customer_ref,
          cancellationUrl: checkout.cancel_url,
          plan,
          charges,
          webhookDeliveries: 2,
          returnedToConsoleBeforeWebhook: false,
        },
        null,
        2,
      ),
    );
  } finally {
    const customers = await queryD1All(
      harness.database,
      'SELECT customer_ref FROM billing_payment_customers WHERE namespace = ?',
      [namespace],
    );
    for (const customer of customers)
      await stripeRequest(key, `customers/${customer.customer_ref}`, 'DELETE');
    await harness.frontend.close();
    await harness.worker.dispose();
  }
});

async function checkoutStatus(key: string, id: string): Promise<string> {
  return (await stripeRequest(key, `checkout/sessions/${id}`)).status;
}

class LostOrganizationResponse {
  private dropped = false;
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
    if (incoming.method() === 'POST' && !this.dropped) {
      this.dropped = true;
      await route.abort();
      return;
    }
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  }
}

test('reload recovers a lost onboarding response and a saved card still requires owner confirmation', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const harness = await startConsole(testInfo, createSimulatedBillingProviderAdapters());
  try {
    await installBrowser(page, harness.handler);
    const interruption = new LostOrganizationResponse(harness.handler);
    await page.route('**/console/account/organizations', interruption.handle.bind(interruption));
    await signInGithub(page, harness.appUrl, 'free');
    await expect(page.getByRole('alert')).toContainText('Account setup failed');
    await page.reload();
    await expect(page).toHaveURL(/dashboard\/overview/, { timeout: 20_000 });
    expect(await organizationCount(harness)).toBe(1);
    const session = await page.evaluate(apiRequest, {
      path: '/console/session',
      method: 'GET',
      body: null,
    });
    const orgId = session.body.claims.orgId;
    const owner = session.body.claims.userId;
    const onboarding = await page.evaluate(apiRequest, {
      path: '/console/onboarding/state',
      method: 'GET',
      body: null,
    });
    const projectId = onboarding.body.state.selectedProjectId;
    const card = await page.evaluate(apiRequest, {
      path: '/console/billing/card-setup',
      method: 'POST',
      body: {},
    });
    expect(card.status).toBe(201);
    const verified = await page.evaluate(apiRequest, {
      path: '/console/billing/card-setup/reconcile',
      method: 'POST',
      body: { checkoutSessionId: card.body.cardSetup.checkoutSessionId },
    });
    expect(verified.status).toBe(200);
    expect(verified.body.plan.plan).toBe('free');
    await page.goto(new URL('/dashboard/login?plan=pro&src=pricing_card', harness.appUrl).href);
    await expect(page.getByRole('region', { name: 'Current plan' })).toContainText('Free');
    await expect(page.getByRole('button', { name: 'Start Pro', exact: true })).toBeEnabled();
    await page.reload();
    expect((await harness.core.freePlan.getPlan({ orgId }))?.plan).toBe('free');
    await page.screenshot({
      path: testInfo.outputPath('saved-card-confirmation.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Start Pro', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Current plan' })).toContainText('Pro');
    expect((await harness.core.freePlan.getPlan({ orgId }))?.plan).toBe('pro');

    const invitation = await harness.core.organizationAccess.invite(
      { orgId, actorUserId: owner },
      {
        email: 'getsignal@example.test',
        role: 'MEMBER',
        projectAccess: [{ projectId, accessLevel: 'viewer' }],
      },
    );
    await harness.core.organizationAccess.acceptInvitation(
      { userId: 'google:getsignal-acceptance', verifiedEmail: 'getsignal@example.test' },
      invitation.invitation.id,
      { token: invitation.token },
    );
    const member = await browser.newPage();
    await installBrowser(member, harness.handler);
    await member.goto(
      new URL('/dashboard/login?plan=growth&src=pricing_card', harness.appUrl).href,
    );
    const intent = await member.evaluate(readIntent);
    expect(
      (
        await member.evaluate(apiRequest, {
          path: '/console/auth/google',
          method: 'POST',
          body: { idToken: harness.authority.token(), planIntent: intent },
        })
      ).status,
    ).toBe(200);
    await member.reload();
    await expect(
      member.getByText('Ask an owner or a billing administrator to start Growth.'),
    ).toBeVisible();
    const denied = await member.evaluate(apiRequest, {
      path: '/console/billing/plan/start',
      method: 'POST',
      body: { plan: 'growth' },
    });
    expect(denied.status).toBe(403);
    expect(await organizationCount(harness)).toBe(1);
    await member.screenshot({
      path: testInfo.outputPath('billing-permission-required.png'),
      fullPage: true,
    });
    await writeFile(
      testInfo.outputPath('confirmation-evidence.json'),
      JSON.stringify(
        {
          orgId,
          projectId,
          organizationsAfterReplay: 1,
          confirmationRequired: true,
          finalPlan: 'pro',
          memberStartStatus: denied.status,
        },
        null,
        2,
      ),
    );
    await member.close();
  } finally {
    await harness.frontend.close();
    await harness.worker.dispose();
  }
});
