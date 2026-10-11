import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  BrowserContext,
  Page,
  Request as BrowserRequest,
  Response as BrowserResponse,
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

type GatewayD1Work = {
  stage: string;
  path: string;
  roundTrips: number;
  statements: number;
  /** One entry per round trip: the kind and tables of each statement it carried. */
  calls: string[][];
};

class RegistrationRequestEvidence {
  stage: 'registration' | 'first_signature' | 'explicit_refresh' | 'lock' = 'registration';
  readonly requests: { stage: string; path: string; atMs: number }[] = [];
  readonly d1: Promise<GatewayD1Work | null>[] = [];

  record(request: BrowserRequest): void {
    if (
      request.method() !== 'POST' ||
      !request.url().startsWith(`${process.env.SEAMS_INTENDED_ROUTER_URL}/`)
    )
      return;
    const entry = {
      stage: this.stage,
      path: new URL(request.url()).pathname,
      atMs: Date.now(),
    };
    this.requests.push(entry);
    this.d1.push(gatewayD1Work(request, entry));
  }

  /** The database work each completed Gateway request reported, in request order. */
  async databaseWork(): Promise<GatewayD1Work[]> {
    const work = [];
    for (const row of await Promise.all(this.d1)) if (row) work.push(row);
    return work;
  }
}

async function gatewayD1Work(
  request: BrowserRequest,
  entry: { stage: string; path: string },
): Promise<GatewayD1Work | null> {
  const response = await request.response();
  const header = response ? await response.headerValue('x-benchmark-d1') : null;
  if (!header) return null;
  const trace: {
    calls: { statements: { query: { kind: string; tables: string[] } }[] }[];
    dropped: number;
  } = JSON.parse(header);
  assert.equal(trace.dropped, 0);
  let statements = 0;
  const calls = [];
  for (const call of trace.calls) {
    statements += call.statements.length;
    calls.push(call.statements.map(statementLabel));
  }
  return {
    stage: entry.stage,
    path: entry.path,
    roundTrips: trace.calls.length,
    statements,
    calls,
  };
}

function statementLabel(statement: { query: { kind: string; tables: string[] } }): string {
  return `${statement.query.kind} ${statement.query.tables.join('+')}`;
}

// Hold Console's completion reply until the real server seal finishes. This
// catches a serial seal without using wall-clock latency as the assertion.
class RegistrationSealOverlap {
  private readonly completed = Promise.withResolvers<void>();
  private completionRequested = false;
  sealCalls = 0;
  completionRequestedBeforeSeal = false;
  sealCompletedBeforeReply = false;

  constructor(
    private readonly applyServerSeal: (request: unknown, auth: unknown) => Promise<unknown>,
    private readonly consoleFetch: (request: Request) => Promise<Response>,
  ) {}

  async apply(request: unknown, auth: unknown): Promise<unknown> {
    this.sealCalls += 1;
    this.completionRequestedBeforeSeal = this.completionRequested;
    const sealed = await this.applyServerSeal(request, auth);
    this.completed.resolve();
    return sealed;
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.endsWith('/complete')) this.completionRequested = true;
    const response = await this.consoleFetch(request);
    if (new URL(request.url).pathname.endsWith('/complete') && response.ok) {
      const timeout = setTimeout(
        this.completed.reject,
        5_000,
        new Error('Session sealing waited for Console completion'),
      );
      try {
        await this.completed.promise;
        this.sealCompletedBeforeReply = true;
      } finally {
        clearTimeout(timeout);
      }
    }
    return response;
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
    // An SDK preflight warm-up carries no operation. Only the POST is observed.
    if (route.request().method() !== 'POST') return await route.fallback();
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
  { harness, context, page }: BrowserFixture,
  testInfo: TestInfo,
): Promise<void> {
  const output = path.resolve(root, '.artifacts/r155b-session-observation/normal');
  const scenario = await createRegionalRealGateway({
    root,
    candidate,
    lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    output,
  });
  const evidence = new RegistrationRequestEvidence();
  const record = evidence.record.bind(evidence);
  const gateway = scenario.gateways.get('US');
  const sealService = gateway.api.stagingSigningSessionSealOptions(gateway.environment).service;
  const applyServerSeal = sealService.applyServerSeal.bind(sealService);
  const consoleFetch = scenario.consoleService.fetch.bind(scenario.consoleService);
  const sealOverlap = new RegistrationSealOverlap(applyServerSeal, consoleFetch);
  sealService.applyServerSeal = sealOverlap.apply.bind(sealOverlap);
  scenario.consoleService.fetch = sealOverlap.fetch.bind(sealOverlap);
  context.on('request', record);
  try {
    await scenario.routeContext(context, 'US');
    const [finalization] = await Promise.all([
      page.waitForResponse(isNearFinalizationResponse),
      harness.registerPasskeyEd25519YaoWallet(),
    ]);
    const trace = await finalization.headerValue('x-benchmark-d1');
    assert.ok(trace);
    const finalizationD1 = JSON.parse(trace);
    assert.equal(finalizationD1.dropped, 0);
    const finalizationTiming = await finalization.headerValue('server-timing');
    const pageRoot = page.getByTestId('intended-e2e-page');
    await expect(pageRoot).toHaveAttribute('data-login-state', 'logged_in');
    await expect(pageRoot).toHaveAttribute('data-login-near-ready', 'ready');
    const walletId = await pageRoot.getAttribute('data-wallet-id');
    assert.ok(walletId);
    await expect(pageRoot).toHaveAttribute('data-login-wallet-id', walletId);
    // The registration response states the session it issued, so no status request follows.
    assert.equal(evidence.requests.filter(isRegistrationStatus).length, 0);
    /* Setup starts the wallet's custody objects, once, before the proof exists.
       The Gateway reads the ownership generation from its Console reservation. */
    const startups = scenario.router.requests.filter(isWalletStartup);
    const respond = evidence.requests.find(isRespond);
    assert.equal(startups.length, 1);
    assert.ok(respond);
    assert.ok(startups[0].atMs <= respond.atMs, 'Wallet startup must precede respond');
    const consoleRequests = [...scenario.consoleService.requests];
    assert.equal(consoleRequests.filter(isCompletion).length, 1);
    assert.equal(consoleRequests.filter(isStandaloneSessionPublication).length, 0);
    assert.equal(consoleRequests.filter(isRegistrationHome).length, 0);
    assert.equal(sealOverlap.sealCalls, 1);
    assert.equal(sealOverlap.completionRequestedBeforeSeal, true);
    assert.equal(sealOverlap.sealCompletedBeforeReply, true);
    sealService.applyServerSeal = applyServerSeal;
    scenario.consoleService.fetch = consoleFetch;
    scenario.beginConsoleOutage();
    await scenario.routeContext(context, 'OC');
    evidence.stage = 'first_signature';
    const signature = await harness.signNearMessage('Combined registration completion through OC');
    assert.equal(evidence.requests.filter(isSigningStatus).length, 0);
    evidence.stage = 'explicit_refresh';
    const session = await page.evaluate(readCurrentWalletSession);
    assert.equal(session.authenticationKind, 'authenticated');
    assert.equal(evidence.requests.filter(isExplicitStatus).length, 1);
    evidence.stage = 'lock';
    await harness.lockWallet();
    await harness.assertWalletLocked();
    await expect(pageRoot).toHaveAttribute('data-login-state', 'logged_out');
    assert.deepEqual(scenario.consoleService.requests, []);
    const databaseWork = await evidence.databaseWork();
    assertRoundTripCeilings(databaseWork);
    await writeFile(
      path.join(output, 'proof.json'),
      JSON.stringify(
        {
          consoleRequests,
          finalizationD1,
          finalizationTiming,
          signature,
          signingIngress: 'OC',
          signingConsoleCalls: 0,
          walletStartup: {
            routerRequests: startups.length,
            sentBeforeRespondMs: respond.atMs - startups[0].atMs,
          },
          gatewayDatabaseWork: databaseWork,
          sessionObservation: {
            registrationStatusRequests: 0,
            firstSignatureStatusRequests: 0,
            explicitRefreshStatusRequests: 1,
            reactLoginPublished: true,
            nearIdentityPublished: true,
            lockClearsAuthentication: true,
          },
          sessionSealing: {
            computationsDuringRegistration: sealOverlap.sealCalls,
            completionRequestedBeforeSeal: sealOverlap.completionRequestedBeforeSeal,
            completedBeforeDirectoryReply: sealOverlap.sealCompletedBeforeReply,
          },
          gatewayRequests: evidence.requests,
        },
        null,
        2,
      ),
    );
  } finally {
    sealService.applyServerSeal = applyServerSeal;
    scenario.consoleService.fetch = consoleFetch;
    context.off('request', record);
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
}

export async function verifyLostRegistrationCompletion(
  { harness, context, page }: BrowserFixture,
  testInfo: TestInfo,
): Promise<void> {
  const output = path.resolve(root, '.artifacts/r155b-session-observation/lost-reply');
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

function isWalletStartup(request: { path: string }): boolean {
  return request.path === '/router-ab/router/wallet/start';
}

function isRespond(request: { stage: string; path: string }): boolean {
  return request.stage === 'registration' && request.path === '/wallets/register/respond';
}

function isRegistrationStatus(request: { stage: string; path: string }): boolean {
  return request.stage === 'registration' && request.path === '/wallet/session/status';
}

/**
 * The most Gateway database round trips each request may make. A change that
 * adds one must raise its ceiling here and say why. Finalize ends with its
 * cleanup, one read and one delete. They run after the response, and the trace
 * holds those that finish before it is read. The ceiling includes both.
 *
 * Setup reads and stores the wallet's object addresses: one read and one
 * write. Every other request takes them from the Gateway's admission query.
 */
const ROUND_TRIP_CEILINGS: Readonly<Record<string, number>> = {
  '/wallets/register/setup': 4,
  '/wallets/register/respond': 5,
  '/router-ab/ed25519/yao/registration/execute': 1,
  '/wallets/register/near-provisioning': 15,
  '/router-ab/ed25519/sign/prepare': 2,
  '/router-ab/ed25519/sign': 3,
};

function assertRoundTripCeilings(work: readonly GatewayD1Work[]): void {
  const measured = new Set<string>();
  for (const request of work) {
    const ceiling = ROUND_TRIP_CEILINGS[request.path];
    if (ceiling === undefined) continue;
    measured.add(request.path);
    assert.ok(
      request.roundTrips <= ceiling,
      `${request.path} made ${request.roundTrips} database round trips; the ceiling is ${ceiling}`,
    );
  }
  assert.deepEqual([...measured].sort(), Object.keys(ROUND_TRIP_CEILINGS).sort());
}

function isSigningStatus(request: { stage: string; path: string }): boolean {
  return request.stage === 'first_signature' && request.path === '/wallet/session/status';
}

function isExplicitStatus(request: { stage: string; path: string }): boolean {
  return request.stage === 'explicit_refresh' && request.path === '/wallet/session/status';
}

async function readCurrentWalletSession(): Promise<{ authenticationKind: string }> {
  const read = window.__seamsIntendedE2EReadWalletLockState;
  if (!read) throw new Error('The wallet session reader is unavailable');
  return read();
}

function isNearFinalizationResponse(response: BrowserResponse): boolean {
  return (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/wallets/register/near-provisioning'
  );
}
