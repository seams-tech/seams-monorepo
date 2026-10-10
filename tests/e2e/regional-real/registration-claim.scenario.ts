import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BrowserContext, Page, Route, TestInfo } from '@playwright/test';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { IntendedBehaviourHarness, signAndVerifyNearMessage } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);
const { expect } = await import(
  pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href
);
type Scenario = Awaited<ReturnType<typeof createRegionalRealGateway>>;

class ClaimFailureAfterConsume {
  readonly consumed = Promise.withResolvers<void>();
  readonly consumers: unknown[] = [];
  readonly claims: unknown[] = [];
  readonly routes: unknown[] = [];
  readonly statuses: number[] = [];
  walletId = '';
  private request: Request | null = null;
  private replay: Response | null = null;

  constructor(
    private readonly scenario: Scenario,
    private readonly consoleFetch: (request: Request) => Promise<Response>,
    private readonly routerFetch: typeof scenario.router.fetch,
  ) {}

  async router(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const consume = new URL(request.url).pathname.endsWith('/registration/consume');
    if (consume) this.consumers.push(await request.clone().json());
    const response = await this.routerFetch(request);
    if (consume && response.ok) this.consumed.resolve();
    return response;
  }

  async console(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.endsWith('/publish-routes')) {
      this.routes.push(await request.clone().json());
    }
    if (new URL(request.url).pathname.endsWith('/claim-passkey')) {
      const body = await request.clone().json();
      this.walletId = body.wallet.walletId;
      this.claims.push(body);
      if (this.claims.length === 1) {
        // Refuse only after the real Router committed its consumption.
        await this.consumed.promise;
        return Response.json({ ok: false, code: 'injected_directory_outage' }, { status: 503 });
      }
    }
    return this.consoleFetch(request);
  }

  async intercept(route: Route): Promise<void> {
    const incoming = route.request();
    const request = new Request(incoming.url(), {
      method: incoming.method(),
      headers: await incoming.allHeaders(),
      body: incoming.postDataBuffer(),
    });
    this.request = request;
    const home = this.scenario.gateways.get('US');
    const first = await home.handle(request.clone(), 'ingress');
    this.statuses.push(first.status);
    assert.equal(first.ok, false);
    assert.equal(this.consumers.length, 1);
    // The recovery-code routes are claimed beside the consumption and the
    // credential claim, before any local wallet record exists.
    assert.equal(this.routes.length, 1);
    assert.ok(this.walletId);
    const wallet = await home.database
      .prepare('SELECT wallet_id FROM wallets WHERE wallet_id = ?')
      .bind(this.walletId)
      .first();
    assert.equal(wallet, null);
    await route.fulfill({
      status: first.status,
      headers: Object.fromEntries(first.headers),
      body: await first.text(),
    });
  }

  async complete(): Promise<{ nearAccountId: string; operationalPublicKey: string }> {
    await expect.poll(this.retry.bind(this), { timeout: 45_000, intervals: [1_000] }).toBe(200);
    assert.ok(this.replay);
    const retry = this.replay;
    assert.equal(this.consumers.length, 2);
    assert.deepEqual(this.consumers[1], this.consumers[0]);
    assert.deepEqual(this.claims[1], this.claims[0]);
    assert.equal(this.routes.length, 2);
    assert.deepEqual(this.routes[1], this.routes[0]);
    const body = await retry.json();
    return {
      nearAccountId: body.ed25519.nearAccountId,
      operationalPublicKey: body.ed25519.publicKey,
    };
  }

  private async retry(): Promise<number> {
    assert.ok(this.request);
    this.replay = await this.scenario.gateways.get('WEUR').handle(this.request.clone(), 'ingress');
    this.statuses.push(this.replay.status);
    return this.replay.status;
  }
}

export async function verifyClaimFailureAfterConsume(
  {
    harness,
    context,
    page,
  }: {
    harness: InstanceType<typeof IntendedBehaviourHarness>;
    context: BrowserContext;
    page: Page;
  },
  testInfo: TestInfo,
): Promise<void> {
  const output = path.resolve(root, '.artifacts/r155d-claim-after-consume');
  const scenario = await createRegionalRealGateway({
    root,
    candidate,
    lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    output,
  });
  const router = scenario.gateways.get('US').environment.MPC_ROUTER;
  const fault = new ClaimFailureAfterConsume(
    scenario,
    scenario.consoleService.fetch.bind(scenario.consoleService),
    router.fetch.bind(router),
  );
  scenario.consoleService.fetch = fault.console.bind(fault);
  router.fetch = fault.router.bind(fault);
  try {
    await scenario.routeContext(context, 'US');
    await context.route('**/wallets/register/near-provisioning', fault.intercept.bind(fault));
    await assert.rejects(
      harness.registerPasskeyEd25519YaoWallet(),
      /Passkey ownership unavailable/,
    );
    await context.unroute('**/wallets/register/near-provisioning');
    const registration = await fault.complete();
    await page.goto(page.url());
    await page.getByLabel('Wallet to unlock', { exact: true }).fill(fault.walletId);
    await page.getByLabel('Require NEAR', { exact: true }).check();
    await page.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
    await expect(page.getByTestId('wallet-unlock-result')).toHaveAttribute(
      'data-state',
      'unlocked',
      { timeout: 60_000 },
    );
    await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_in',
    );
    scenario.beginConsoleOutage();
    await scenario.routeContext(context, 'OC');
    const signature = await signAndVerifyNearMessage(
      page,
      'Retry after consumed activation and failed claim',
      registration,
    );
    assert.deepEqual(scenario.consoleService.requests, []);
    await writeFile(
      path.join(output, 'proof.json'),
      JSON.stringify(
        {
          statuses: fault.statuses,
          consumedBeforeFailedClaim: true,
          noWalletPublishedAfterFailure: true,
          failureReturnedToSdk: true,
          originalPasskeyUnlockedAfterRetry: true,
          identicalConsumerRetries: fault.consumers.length,
          identicalCredentialClaims: fault.claims.length,
          signature,
          signingConsoleCalls: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.unrouteAll({ behavior: 'wait' });
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
}
