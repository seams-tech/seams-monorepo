import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const { IntendedBehaviourHarness } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);
const { TracedD1Database } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/r150-hosted/gateway/d1Trace.ts')).href
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

type ReadQuery = { kind: string; tables: readonly string[] };

class RegistrationInitialReadBatch extends TracedD1Database {
  private armed = false;
  batchedReads = 0;
  request: Request | null = null;

  async intercept(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === 'POST') {
      this.armed = true;
      this.request = new Request(request.url(), {
        method: request.method(),
        headers: await request.allHeaders(),
        body: request.postDataBuffer(),
      });
    }
    await route.fallback();
  }

  async measure<T>(
    method: string,
    queries: readonly ReadQuery[],
    execute: () => Promise<T>,
  ): Promise<T> {
    if (this.armed && queries.some(isInitialHomeRead)) {
      this.armed = false;
      assert.equal(method, 'batch');
      assert.ok(queries.every(isReadOrDeploymentCheck));
      assert.ok(queries.some(isOperationRead));
      assert.ok(queries.some(isCeremonyRead));
      this.batchedReads += 1;
    }
    return super.measure(method, queries, execute);
  }
}

function isReadQuery(query: ReadQuery): boolean {
  return query.kind === 'SELECT';
}

function isReadOrDeploymentCheck(query: ReadQuery): boolean {
  return (
    isReadQuery(query) ||
    (query.kind === 'INSERT' &&
      query.tables.length === 1 &&
      query.tables[0] === 'regional_deployment_write_checks')
  );
}

function isInitialHomeRead(query: ReadQuery): boolean {
  return isReadQuery(query) && query.tables.includes('wallet_execution_generations');
}

function isOperationRead(query: ReadQuery): boolean {
  return isReadQuery(query) && query.tables.includes('router_ab_yao_versioned_json_records');
}

function isCeremonyRead(query: ReadQuery): boolean {
  return isReadQuery(query) && query.tables.includes('registration_ceremony_records');
}

async function verifyCompletedReplayAfterCleanup(
  scenario: Scenario,
  request: Request,
  sessionId: string,
) {
  const gateway = scenario.gateways.get('US');
  const body = await request.clone().json();
  const recordId = `gateway-registration:${body.registrationCeremonyId}`;
  await gateway.database
    .prepare(
      "DELETE FROM registration_ceremony_records WHERE record_scope = 'ceremony' AND record_id = ?",
    )
    .bind(recordId)
    .run();
  const remaining = await gateway.database
    .prepare(
      "SELECT count(*) AS count FROM registration_ceremony_records WHERE record_scope = 'ceremony' AND record_id = ?",
    )
    .bind(recordId)
    .first();
  assert.equal(remaining.count, 0);
  const response = await gateway.handle(request.clone(), 'ingress');
  assert.equal(response.status, 200);
  const trace = response.headers.get('x-benchmark-d1');
  assert.ok(trace);
  const d1 = JSON.parse(trace);
  assert.equal(d1.dropped, 0);
  const replay = await response.json();
  assert.equal(replay.registrationEstablishedSession.kind, 'already_committed');
  assert.equal(replay.registrationEstablishedSession.session.walletSessionId, sessionId);
  assert.equal('operationCredential' in replay.registrationEstablishedSession.session, false);
  return { ceremonyRecords: remaining.count, replayStatus: response.status, sameSession: true, d1 };
}

async function verifyFencedFinalizationReplay(
  scenario: Scenario,
  request: Request,
  walletId: string,
) {
  const gateway = scenario.gateways.get('US');
  const wallet = await gateway.database
    .prepare('SELECT generation FROM wallet_execution_generations WHERE wallet_id = ?')
    .bind(walletId)
    .first();
  assert.ok(wallet);
  const source = gateway.api.WalletRelocationSessionSource.parse({
    walletId,
    sourceGeneration: wallet.generation,
    moveId: `wmove_${createHash('sha256').update(walletId).digest('base64url')}`,
    requestDigestHex: createHash('sha256').update(walletId).digest('hex'),
  });
  const scope = {
    namespace: gateway.scope.namespace,
    orgId: gateway.scope.organizationId,
    projectId: gateway.scope.projectId,
    envId: gateway.scope.environmentId,
  };
  const block = new gateway.api.D1WalletRelocationWriteBlock(gateway.database, scope);
  assert.equal(await block.check(source, Date.now()), 'ready');
  const blocked = await gateway.handle(request.clone(), 'ingress');
  assert.equal(blocked.ok, false);
  assert.equal((await blocked.json()).code, 'wallet_home_unavailable');
  await block.release(source, Date.now());
  const sessions = new gateway.api.D1WalletRelocationSessions(gateway.database, scope);
  await sessions.retire(source, Date.now());
  const retired = await gateway.handle(request.clone(), 'ingress');
  assert.equal(retired.ok, false);
  assert.equal((await retired.json()).code, 'wallet_home_unavailable');
  return { relocationBlockStatus: blocked.status, retiredHomeStatus: retired.status };
}

// Hold Console's completion reply until the real server seal finishes. A
// completion requested before the seal would show that the response waits for it.
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

// Console commits the first completion, then its reply is lost. The registration
// response does not wait for that reply; the Gateway cron resends the completion.
class CompletionReplyLoss {
  readonly completions: unknown[] = [];
  walletId = '';

  constructor(private readonly consoleFetch: (request: Request) => Promise<Response>) {}

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
}

type RegionalGateway = ReturnType<Scenario['gateways']['get']>;

function executionState(gateway: RegionalGateway, walletId: string) {
  return gateway.database
    .prepare(
      'SELECT state, registration_completion FROM wallet_execution_generations WHERE wallet_id = ?',
    )
    .bind(walletId)
    .first();
}

function pendingPublication(gateway: RegionalGateway, walletId: string) {
  return gateway.database
    .prepare(
      'SELECT state, attempts FROM wallet_registration_directory_publications WHERE wallet_id = ?',
    )
    .bind(walletId)
    .first();
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
  const originalDatabase = gateway.database;
  const initialReads = new RegistrationInitialReadBatch(originalDatabase);
  gateway.database = initialReads;
  const sealService = gateway.api.stagingSigningSessionSealOptions(gateway.environment).service;
  const applyServerSeal = sealService.applyServerSeal.bind(sealService);
  const consoleFetch = scenario.consoleService.fetch.bind(scenario.consoleService);
  const sealOverlap = new RegistrationSealOverlap(applyServerSeal, consoleFetch);
  sealService.applyServerSeal = sealOverlap.apply.bind(sealOverlap);
  scenario.consoleService.fetch = sealOverlap.fetch.bind(sealOverlap);
  context.on('request', record);
  try {
    await scenario.routeContext(context, 'US');
    await context.route(
      '**/wallets/register/near-provisioning',
      initialReads.intercept.bind(initialReads),
    );
    const [finalization] = await Promise.all([
      page.waitForResponse(isNearFinalizationResponse),
      harness.registerPasskeyEd25519YaoWallet(),
    ]);
    const trace = await finalization.headerValue('x-benchmark-d1');
    assert.ok(trace);
    const finalizationD1 = JSON.parse(trace);
    assert.equal(finalizationD1.dropped, 0);
    assert.equal(initialReads.batchedReads, 1);
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
    // The Console completion follows the registration response.
    await gateway.settle();
    const consoleRequests = [...scenario.consoleService.requests];
    assert.equal(consoleRequests.filter(isCompletion).length, 1);
    // Respond claims the passkey while the Yao execution runs. Finalization
    // reads the recorded claim and sends no second request.
    assert.equal(consoleRequests.filter(isPasskeyClaim).length, 1);
    assert.ok(
      consoleRequests.findIndex(isPasskeyClaim) < consoleRequests.findIndex(isRouteClaim),
      'The passkey claim must precede finalization',
    );
    assert.equal(consoleRequests.filter(isStandaloneSessionPublication).length, 0);
    assert.equal(consoleRequests.filter(isRegistrationHome).length, 0);
    assert.equal(sealOverlap.sealCalls, 1);
    // The seal finishes before the response, so it never waits for Console.
    assert.equal(sealOverlap.completionRequestedBeforeSeal, false);
    assert.equal(sealOverlap.sealCompletedBeforeReply, true);
    sealService.applyServerSeal = applyServerSeal;
    scenario.consoleService.fetch = consoleFetch;
    assert.ok(initialReads.request);
    const original = await finalization.json();
    const completedReplay = await verifyCompletedReplayAfterCleanup(
      scenario,
      initialReads.request,
      original.registrationEstablishedSession.session.walletSessionId,
    );
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
    const fencedReplay = await verifyFencedFinalizationReplay(
      scenario,
      initialReads.request,
      walletId,
    );
    const databaseWork = await evidence.databaseWork();
    assertRoundTripCeilings(databaseWork);
    await writeFile(
      path.join(output, 'proof.json'),
      JSON.stringify(
        {
          consoleRequests,
          finalizationD1,
          finalizationTiming,
          initialReads: {
            batchedReads: initialReads.batchedReads,
            completedReplay,
            fencedReplay,
          },
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
    gateway.database = originalDatabase;
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
  const fault = new CompletionReplyLoss(scenario.consoleService.fetch.bind(scenario.consoleService));
  scenario.consoleService.fetch = fault.fetch.bind(fault);
  const gateway = scenario.gateways.get('US');
  try {
    await scenario.routeContext(context, 'US');
    const [finalization] = await Promise.all([
      page.waitForResponse(isNearFinalizationResponse),
      harness.registerPasskeyEd25519YaoWallet(),
    ]);
    // Registration and signing do not wait for Console's completion reply.
    assert.equal(finalization.status(), 200);
    await gateway.settle();
    assert.equal(fault.completions.length, 1);
    assert.deepEqual(await executionState(gateway, fault.walletId), {
      state: 'active',
      registration_completion: 'established',
    });
    assert.deepEqual(await pendingPublication(gateway, fault.walletId), {
      state: 'pending',
      attempts: 1,
    });
    const registrationConsoleRequests = [...scenario.consoleService.requests];
    // The Gateway cron resends the identical completion, then clears the record.
    assert.deepEqual(await gateway.resumeRegistrationPublications(Date.now() + 3_600_000), {
      acknowledged: 1,
      deferred: 0,
      refused: 0,
    });
    assert.equal(fault.completions.length, 2);
    assert.deepEqual(fault.completions[1], fault.completions[0]);
    assert.equal(await pendingPublication(gateway, fault.walletId), null);
    scenario.beginConsoleOutage();
    await scenario.routeContext(context, 'APAC');
    const signature = await harness.signNearMessage('Recovered combined completion');
    assert.deepEqual(scenario.consoleService.requests, []);
    await writeFile(
      path.join(output, 'proof.json'),
      JSON.stringify(
        {
          registrationConsoleRequests,
          finalizationStatus: finalization.status(),
          identicalCompletionRetries: fault.completions.length,
          responseWaitsForConsole: false,
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
function isPasskeyClaim(pathname: string): boolean {
  return pathname.endsWith('/claim-passkey');
}
// Finalization claims the recovery-code routes of its custody commit.
function isRouteClaim(pathname: string): boolean {
  return pathname.endsWith('/publish-routes');
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
 * Respond claims the passkey in the background with one write, which the trace
 * holds in the same way.
 *
 * Setup reads and stores the wallet's object addresses: one read and one
 * write. Every other request takes them from the Gateway's admission query.
 */
const ROUND_TRIP_CEILINGS: Readonly<Record<string, number>> = {
  '/wallets/register/setup': 4,
  '/wallets/register/respond': 6,
  '/wallets/register/near-provisioning': 13,
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
