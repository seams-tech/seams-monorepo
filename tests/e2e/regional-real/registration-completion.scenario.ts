import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  BrowserContext,
  Page,
  Request as BrowserRequest,
  Route,
  TestInfo,
} from '@playwright/test';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { expect } = await import(
  pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href
);
const { IntendedBehaviourHarness, signAndVerifyNearMessage } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);

type Scenario = Awaited<ReturnType<typeof createRegionalRealGateway>>;
type BrowserFixture = {
  harness: InstanceType<typeof IntendedBehaviourHarness>;
  context: BrowserContext;
  page: Page;
};

class RegistrationRequestEvidence {
  stage: 'registration' | 'first_signature' = 'registration';
  readonly requests: { stage: string; path: string }[] = [];

  record(request: BrowserRequest): void {
    if (request.method() !== 'POST' || !request.url().startsWith('http://127.0.0.1:4100/')) return;
    this.requests.push({ stage: this.stage, path: new URL(request.url()).pathname });
  }
}

class CompletionReplyLoss {
  readonly completions: unknown[] = [];
  readonly statuses: number[] = [];
  walletId = '';
  nearAccountId = '';
  publicKey = '';
  private request: Request | null = null;
  private replay: Response | null = null;

  constructor(
    private readonly scenario: Scenario,
    private readonly consoleFetch: (request: Request) => Promise<Response>,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const completion = new URL(request.url).pathname.endsWith('/complete');
    if (completion) {
      const body = await request.clone().json();
      this.walletId = body.wallet.walletId;
      this.completions.push(body);
    }
    const response = await this.consoleFetch(request);
    if (completion && response.ok && this.completions.length === 1) {
      return Response.json({ ok: false, code: 'lost_completion_reply' }, { status: 503 });
    }
    return response;
  }

  async intercept(route: Route): Promise<void> {
    const request = route.request();
    this.request = new Request(request.url(), {
      method: request.method(),
      headers: await request.allHeaders(),
      body: request.postDataBuffer(),
    });
    const first = await this.scenario.gateways.get('US').handle(this.request.clone(), 'ingress');
    this.statuses.push(first.status);
    assert.equal(first.ok, false);
    assert.ok(this.walletId);
    assert.deepEqual(await this.executionState(), {
      state: 'registering',
      registration_completion: 'established',
    });
    await expect.poll(this.retry.bind(this), { timeout: 45_000, intervals: [1_000] }).toBe(200);
    assert.ok(this.replay);
    const replay = this.replay;
    const body = await replay.clone().json();
    this.nearAccountId = body.ed25519.nearAccountId;
    this.publicKey = body.ed25519.publicKey;
    assert.deepEqual(await this.executionState(), {
      state: 'active',
      registration_completion: 'established',
    });
    assert.equal(this.completions.length, 2);
    assert.deepEqual(this.completions[1], this.completions[0]);
    await route.fulfill({
      status: replay.status,
      headers: Object.fromEntries(replay.headers),
      body: await replay.text(),
    });
  }

  private async retry(): Promise<number> {
    assert.ok(this.request);
    this.replay = await this.scenario.gateways.get('WEUR').handle(this.request.clone(), 'ingress');
    this.statuses.push(this.replay.status);
    return this.replay.status;
  }

  private executionState() {
    return this.scenario.gateways
      .get('US')
      .database.prepare(
        'SELECT state, registration_completion FROM wallet_execution_generations WHERE wallet_id = ?',
      )
      .bind(this.walletId)
      .first();
  }
}

export async function verifyRegistrationCompletion(
  { harness, context }: BrowserFixture,
  testInfo: TestInfo,
): Promise<void> {
  const output = path.resolve(root, '.artifacts/r155b-registration-completion/normal');
  const scenario = await createRegionalRealGateway({
    root,
    candidate,
    lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    output,
  });
  const evidence = new RegistrationRequestEvidence();
  const record = evidence.record.bind(evidence);
  context.on('request', record);
  try {
    await scenario.routeContext(context, 'US');
    await harness.registerPasskeyEd25519YaoWallet();
    const consoleRequests = [...scenario.consoleService.requests];
    assert.equal(consoleRequests.filter(isCompletion).length, 1);
    assert.equal(consoleRequests.filter(isStandaloneSessionPublication).length, 0);
    assert.equal(consoleRequests.filter(isRegistrationHome).length, 1);
    scenario.beginConsoleOutage();
    await scenario.routeContext(context, 'OC');
    evidence.stage = 'first_signature';
    const signature = await harness.signNearMessage('Combined registration completion through OC');
    assert.deepEqual(scenario.consoleService.requests, []);
    await writeFile(
      path.join(output, 'proof.json'),
      JSON.stringify(
        {
          consoleRequests,
          signature,
          signingIngress: 'OC',
          signingConsoleCalls: 0,
          gatewayRequests: evidence.requests,
        },
        null,
        2,
      ),
    );
  } finally {
    context.off('request', record);
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
}

export async function verifyLostRegistrationCompletion(
  { harness, context, page }: BrowserFixture,
  testInfo: TestInfo,
): Promise<void> {
  const output = path.resolve(root, '.artifacts/r155b-registration-completion/lost-reply');
  const scenario = await createRegionalRealGateway({
    root,
    candidate,
    lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    output,
  });
  const fault = new CompletionReplyLoss(
    scenario,
    scenario.consoleService.fetch.bind(scenario.consoleService),
  );
  scenario.consoleService.fetch = fault.fetch.bind(fault);
  try {
    await scenario.routeContext(context, 'US');
    await context.route('**/wallets/register/near-provisioning', fault.intercept.bind(fault));
    await assert.rejects(harness.registerPasskeyEd25519YaoWallet(), /exact-method unlock/u);
    await context.unroute('**/wallets/register/near-provisioning');
    const registrationConsoleRequests = [...scenario.consoleService.requests];
    await page.goto(page.url());
    await page.getByLabel('Wallet to unlock', { exact: true }).fill(fault.walletId);
    await page.getByLabel('Require NEAR', { exact: true }).check();
    await page.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
    await expect(page.getByTestId('wallet-unlock-result')).toHaveAttribute(
      'data-state',
      'unlocked',
      { timeout: 60_000 },
    );
    scenario.beginConsoleOutage();
    await scenario.routeContext(context, 'APAC');
    const signature = await signAndVerifyNearMessage(page, 'Recovered combined completion', {
      nearAccountId: fault.nearAccountId,
      operationalPublicKey: fault.publicKey,
    });
    assert.deepEqual(scenario.consoleService.requests, []);
    await writeFile(
      path.join(output, 'proof.json'),
      JSON.stringify(
        {
          registrationConsoleRequests,
          statuses: fault.statuses,
          identicalCompletionRetries: fault.completions.length,
          signingFencedUntilCompletionAcknowledged: true,
          exactMethodUnlockRequired: true,
          signature,
          signingConsoleCalls: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
}

function isCompletion(pathname: string): boolean {
  return pathname.endsWith('/complete');
}
function isStandaloneSessionPublication(pathname: string): boolean {
  return pathname.endsWith('/publish-session');
}
function isRegistrationHome(pathname: string): boolean {
  return pathname.endsWith('/registration-home');
}
