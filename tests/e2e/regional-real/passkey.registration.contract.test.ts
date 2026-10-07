import { createHash, randomUUID } from 'node:crypto';
import type { ConsoleRegistrationHomeAdmission } from '../../../packages/wallet-console-server-ts/src/walletPlacement/registrationAdmission';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { APIRequestContext, BrowserContext, Page, Request as BrowserRequest, Route, TestInfo } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRestartingRegionalGateway } from '../../helpers/restarting-regional-gateway.mjs';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';
import { BrowserWalletRelocation } from '../../helpers/browser-wallet-relocation.mjs';
import { createBrowserRelocationCustody } from '../../helpers/browser-relocation-custody.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { expect } = await import(pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href);
const { createRegistrationSetupOperationId } = await import(
  pathToFileURL(path.join(publicRoot, 'packages/shared-ts/src/utils/registrationSetupOperation.ts')).href
);
const { intendedTest: test, IntendedBehaviourHarness, requireNearSigningResult, verifyNearEd25519Signature, waitForWalletIframeConfirmationSettlement } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);

for (const curve of ['ecdsa', 'ed25519']) {
  test(`${curve} signs through WEUR, APAC and OC while Console is unavailable`, async ({
    harness,
    context,
    page,
    browser,
  }) => {
    test.setTimeout(600_000);
    const custody = await createBrowserRelocationCustody({
      publicRoot,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    });
    let scenario: Awaited<ReturnType<typeof createRegionalRealGateway>> | null = null;
    let linkedContext: BrowserContext | null = null;
    try {
      scenario = await createRegionalRealGateway({
        root,
        candidate,
        lostAcknowledgements: 0,
        localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
        output: path.resolve(root, '.artifacts/r155b/console-outage', curve),
        custody,
      });
      const relocation = new BrowserWalletRelocation({ root, candidate, scenario });
      const observe = relocation.observe.bind(relocation);
      context.on('request', observe);
      await scenario.routeContext(context, 'US');
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      const previousContexts = browser.contexts();
      const offlineDevice = await harness.openLinkedDevice(browser);
      const [offlineContext] = browser.contexts().filter(isNewContext.bind(null, previousContexts));
      assert.ok(offlineContext, 'The enrolled device must have a separate browser context');
      linkedContext = offlineContext;
      await scenario.routeContext(offlineContext, 'US');
      await harness.linkDeviceWithPasskey(offlineDevice);
      await offlineContext.setOffline(true);
      scenario.beginConsoleOutage();
      let signingPhase: 'post_registration' | 'post_unlock' = 'post_registration';
      let unlockDirectoryRequests: string[] = [];
      for (const ingress of ['WEUR', 'APAC', 'OC']) {
        await scenario.routeContext(context, ingress);
        if (ingress === 'APAC') {
          assert.equal(scenario.consoleService.requests.length, 0);
          scenario.consoleService.available = true;
          await harness.unlockPasskeyWallet();
          unlockDirectoryRequests = scenario.consoleService.requests.splice(0);
          scenario.consoleService.available = false;
          signingPhase = 'post_unlock';
        }
        if (curve === 'ecdsa') await harness.signTempoTransaction(signingPhase);
        else await harness.signNearTransactionAfterRefresh();
      }
      await scenario.verifyConsoleOutage(curve);
      await writeFile(
        path.join(scenario.output, 'fresh-unlock.json'),
        JSON.stringify(
          {
            curve,
            home: 'US',
            unlockIngress: 'APAC',
            freshUnlockAfterRuntimeReset: true,
            signaturesBeforeUnlock: 1,
            signaturesAfterUnlock: 2,
            consoleRequests: scenario.consoleService.requests.length,
            unlockDirectoryRequests,
            custodyNamespaces: custody.namespaces,
            scope:
              'Browser registration, runtime reset and passkey unlock with directory coordination available. Console is unavailable for signing before and after unlock through foreign ingress. Excludes relocation and Console-independent unlock.',
          },
          null,
          2,
        ),
      );
      const moved = await relocation.move(page, {
        sourceRegion: 'US',
        destinationRegion: 'APAC',
        expectedGeneration: 1,
      });
      context.off('request', observe);
      await harness.unlockPasskeyWallet();
      scenario.beginConsoleOutage();
      await scenario.routeContext(context, 'WEUR');
      if (curve === 'ecdsa') await harness.signTempoTransaction('post_unlock');
      else await harness.signNearTransactionAfterRefresh();
      assert.equal(scenario.consoleService.requests.length, 0);
      const home = await scenario.consoleService.database
        .prepare('SELECT region, state FROM wallet_homes WHERE wallet_id = ?')
        .bind(moved.walletId)
        .first();
      assert.deepEqual(home, { region: 'APAC', state: 'established' });
      scenario.consoleService.available = true;
      await scenario.routeContext(offlineContext, 'WEUR');
      await offlineContext.setOffline(false);
      await offlineDevice.unlockPasskeyWallet();
      scenario.beginConsoleOutage();
      if (curve === 'ecdsa') await offlineDevice.signTempoTransaction('post_unlock');
      else await offlineDevice.signNearTransactionAfterRefresh();
      assert.equal(scenario.consoleService.requests.length, 0);

      await writeFile(
        path.join(scenario.output, 'browser-relocation.json'),
        JSON.stringify(
          {
            curve,
            ...moved,
            source: 'US',
            destination: 'APAC',
            approval: 'Registered browser passkey',
            freshUnlockAfterMove: true,
            enrolledDeviceOfflineThroughActivation: true,
            offlineDeviceUnlockedWithoutEnrollment: true,
            offlineDeviceSignedAfterMove: true,
            signaturesAfterMove: 2,
            signingIngress: 'WEUR',
            consoleRequestsDuringDestinationSigning: scenario.consoleService.requests.length,
            custodyNamespaces: custody.namespaces,
            scope:
              'Local production coordinator, browser registration and passkey approval, independent custody namespaces, fresh unlock and destination signing. Excludes hosted latency.',
          },
          null,
          2,
        ),
      );
      if (curve === 'ecdsa') {
        scenario.consoleService.available = true;
        context.on('request', observe);
        await harness.recoverPasskeyWalletFromFreshBrowser();
        scenario.beginConsoleOutage();
        await harness.signTempoTransaction('post_unlock');
        await harness.signNearTransactionAfterRefresh();
        assert.equal(scenario.consoleService.requests.length, 0);
        await writeFile(
          path.join(scenario.output, 'recovery-after-relocation.json'),
          JSON.stringify(
            {
              walletId: moved.walletId,
              region: 'APAC',
              freshBrowserRecovery: true,
              signingCurves: ['ecdsa', 'ed25519'],
              consoleRequestsDuringSigning: 0,
            },
            null,
            2,
          ),
        );
        scenario.consoleService.available = true;
        while (Date.now() <= moved.nextMoveAtMs) {
          await page.waitForTimeout(Math.min(30_000, moved.nextMoveAtMs - Date.now() + 1));
        }
        const returned = await relocation.move(page, {
          sourceRegion: 'APAC',
          destinationRegion: 'US',
          expectedGeneration: 2,
        });
        context.off('request', observe);
        await harness.unlockPasskeyWallet();
        scenario.beginConsoleOutage();
        await harness.signTempoTransaction('post_unlock');
        await harness.signNearTransactionAfterRefresh();
        assert.equal(scenario.consoleService.requests.length, 0);
        const returnedHome = await scenario.consoleService.database
          .prepare('SELECT region, state FROM wallet_homes WHERE wallet_id = ?')
          .bind(returned.walletId)
          .first();
        assert.deepEqual(returnedHome, { region: 'US', state: 'established' });
        await writeFile(
          path.join(scenario.output, 'return-relocation.json'),
          JSON.stringify(
            {
              ...returned,
              source: 'APAC',
              destination: 'US',
              expectedGeneration: 2,
              freshUnlockAfterMove: true,
              signingCurves: ['ecdsa', 'ed25519'],
              consoleRequestsDuringSigning: 0,
            },
            null,
            2,
          ),
        );
      }
    } finally {
      if (linkedContext) await linkedContext.close();
      await context.unrouteAll({ behavior: 'wait' });
      if (scenario) await scenario.close();
      await custody.close();
    }
  });
}

for (const curve of ['ecdsa', 'ed25519']) {
  test(`linked ${curve} signs then rejects signing after revocation while Console is unavailable`, async ({
    harness,
    context,
    browser,
  }) => {
    const scenario = await createRegionalRealGateway({
      root,
      candidate,
      lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
      output: path.resolve(root, '.artifacts/r155b/console-outage', `linked-${curve}`),
    });
    try {
      await scenario.routeContext(context, 'US');
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      const previous = browser.contexts();
      const device = await harness.openLinkedDevice(browser);
      const opened = browser.contexts().filter(isNewContext.bind(null, previous));
      if (opened.length !== 1) throw new Error('Expected one linked browser context');
      await scenario.routeContext(opened[0], 'WEUR');
      await harness.linkDeviceWithPasskey(device);
      scenario.beginConsoleOutage();
      for (let index = 0; index < 3; index += 1) {
        if (curve === 'ecdsa') await device.signTempoTransaction('post_device_link');
        else await device.signNearTransaction('post_device_link');
      }
      await harness.revokeLinkedDeviceWithOwnerPasskey();
      await device.assertRevokedDeviceCannotSign();
      await scenario.verifyConsoleOutage(curve);
    } finally {
      await scenario.close();
    }
  });
}

function isNewContext(previous: BrowserContext[], context: BrowserContext): boolean {
  return !previous.includes(context);
}

for (const curve of ['ecdsa', 'ed25519']) {
  test(`${curve} signs after Gateway and role restart during Console outage`, async ({
    harness,
    context,
  }) => {
    const scenario = await createRestartingRegionalGateway({
      root,
      candidate,
      lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
      output: path.resolve(root, '.artifacts/r155b/console-outage', `restart-${curve}`),
    });
    try {
      await scenario.routeContext(context, 'US');
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      await scenario.beginConsoleOutageAndRestart('WEUR');
      await scenario.routeContext(context, 'WEUR');
      for (let index = 0; index < 3; index += 1) {
        if (curve === 'ecdsa') await harness.signTempoTransaction('post_registration');
        else await harness.signNearTransactionAfterRefresh();
      }
      await scenario.verifyConsoleOutage(curve, 'WEUR');
    } finally {
      await scenario.close();
    }
  });
}

class OwnerLaneRequestCapture {
  request: BrowserRequest | null = null;

  observe(request: BrowserRequest): void {
    if (
      this.request === null &&
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/wallet/execution-lane/owner' &&
      request.postDataJSON()?.curve === 'ed25519'
    ) {
      this.request = request;
    }
  }
}

async function verifySharedBudgetAndStepUp(
  { context, page, request }: { context: BrowserContext; page: Page; request: APIRequestContext },
  testInfo: TestInfo,
) {
  const scenario = await createRegionalRealGateway({
    root,
    candidate,
    lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    output: path.resolve(root, '.artifacts/r155b/console-outage/shared-budget-step-up'),
  });
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request: scenario.requestsFor('US', request),
    flow: 'passkey.registration',
    networkMode: 'managed_local',
  });
  const ownerLane = new OwnerLaneRequestCapture();
  const observe = ownerLane.observe.bind(ownerLane);
  try {
    await harness.initialize();
    await scenario.routeContext(context, 'US');
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    await harness.unlockPasskeyWallet();
    scenario.beginConsoleOutage();
    await scenario.routeContext(context, 'WEUR');
    context.on('request', observe);
    await harness.signNearTransaction('post_unlock');
    await harness.signTempoAndArcEvmConcurrently('post_unlock');
    const preflight = ownerLane.request;
    assert.ok(preflight, 'Expected the NEAR owner-lane request before budget exhaustion');
    const body = preflight.postDataBuffer();
    assert.ok(body);
    const exhaustedRead = await scenario.gateways.get('WEUR').handle(new Request(preflight.url(), {
      method: 'POST', headers: await preflight.allHeaders(), body,
    }), 'ingress');
    assert.equal(exhaustedRead.status, 200, 'Exhaustion must preserve authenticated lane metadata reads');
    const projection = await exhaustedRead.json();
    assert.equal(projection.ok, true);
    assert.equal(projection.projection.kind, 'active_owner_wallet_execution_lane_projection_v1');
    await writeFile(path.resolve(root, '.artifacts/r155b/console-outage/shared-budget-step-up/exhausted-preflight.json'), JSON.stringify({
      curve: 'ed25519', status: exhaustedRead.status, ingress: 'WEUR', home: 'US',
      precedingReusableSignatures: 3,
    }, null, 2));
    await scenario.routeContext(context, 'APAC');
    await harness.signNearTransaction('step_up_required');
    await scenario.routeContext(context, 'OC');
    await harness.signTempoTransaction('step_up_required');
    await scenario.verifyStepUpConsoleOutage();
    harness.assertNoLifecycleViolations();
  } finally {
    context.off('request', observe);
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
}

test('shared budget exhaustion and both signing step-ups work while Console is unavailable', verifySharedBudgetAndStepUp);


class SigningRequestCapture {
  request: BrowserRequest | null = null;

  observe(request: BrowserRequest): void {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/router-ab/ed25519/sign/prepare') {
      this.request = request;
    }
  }
}

async function verifyRegionalRoutingRejections(
  { harness, context }: { harness: InstanceType<typeof IntendedBehaviourHarness>; context: BrowserContext },
  testInfo: TestInfo,
) {
  const output = path.resolve(root, '.artifacts/r155b/console-outage/routing-rejections');
  const scenario = await createRegionalRealGateway({
    root, candidate, lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    output,
  });
  const capture = new SigningRequestCapture();
  const observe = capture.observe.bind(capture);
  context.on('request', observe);
  try {
    await scenario.routeContext(context, 'US');
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    scenario.beginConsoleOutage();
    await scenario.routeContext(context, 'WEUR');
    await harness.signNearTransaction('post_registration');
    const signed = capture.request;
    assert.ok(signed, 'Expected the real browser prepare request');
    const headers = await signed.allHeaders();
    const body = signed.postDataBuffer();
    assert.ok(body);
    const cases = [
      { name: 'malformed_region', region: 'invalid', status: 400, code: 'invalid_wallet_region' },
      { name: 'wrong_home', region: 'APAC', status: 409, code: 'wallet_home_discovery_required' },
    ];
    const rejections = [];
    for (const rejected of cases) {
      const response = await scenario.gateways.get('WEUR').handle(new Request(signed.url(), {
        method: 'POST', headers: { ...headers, 'x-seams-wallet-region': rejected.region }, body,
      }), 'ingress');
      const result = await response.json();
      assert.equal(response.status, rejected.status);
      assert.equal(result.code, rejected.code);
      rejections.push({ name: rejected.name, status: response.status, code: result.code });
    }
    const mismatch = await scenario.gateways.get('WEUR').handle(new Request(
      'http://127.0.0.1:4100/wallet/email-otp/challenge', {
        method: 'POST', headers,
        body: JSON.stringify({ walletId: 'another-wallet', operation: 'transaction_sign' }),
      },
    ), 'ingress');
    const mismatchBody = await mismatch.json();
    assert.equal(mismatch.status, 403);
    assert.equal(mismatchBody.code, 'wallet_session_scope_mismatch');
    rejections.push({ name: 'session_wallet_mismatch', status: mismatch.status, code: mismatchBody.code });
    await scenario.routeContext(context, 'APAC');
    await harness.signNearTransaction('post_registration');
    await scenario.routeContext(context, 'OC');
    await harness.signNearTransaction('post_registration');
    await scenario.verifyConsoleOutage('ed25519');
    await writeFile(path.join(output, 'rejections.json'), JSON.stringify({
      rejections, verifiedSignatures: 3, attemptedConsoleCalls: 0,
    }, null, 2));
    harness.assertNoLifecycleViolations();
  } finally {
    context.off('request', observe);
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
}

test('regional routing rejects malformed hints and wallet mismatches without consuming signing budget', verifyRegionalRoutingRejections);

class RetireDuringSigningPrepare {
  attempts = 0;
  retired = false;

  constructor(
    readonly scenario: Awaited<ReturnType<typeof createRegionalRealGateway>>,
    readonly preparePath: string,
  ) {}

  async beforeExecution(request: Request): Promise<void> {
    if (new URL(request.url).pathname !== this.preparePath) return;
    this.attempts += 1;
    assert.equal(this.attempts, 1, 'The rejected prepare must not retry');
    await retireRegionalWriter(this.scenario);
    this.retired = true;
  }
}

async function retireRegionalWriter(
  scenario: Awaited<ReturnType<typeof createRegionalRealGateway>>,
): Promise<string> {
  const gateway = scenario.gateways.get('US');
  const binding = scenario.consoleService.binding;
  const proofs = [];
  const gatewayVersion = randomUUID();
  for (const resource of binding.resources) {
    proofs.push(gateway.api.regionalResourceProof(
      binding,
      resource.databaseId,
      gatewayVersion,
      randomUUID(),
      Date.now(),
    ));
  }
  const admission = {
    binding,
    activationSequence: 2,
    resourceVerificationsJson: JSON.stringify(proofs),
  };
  await gateway.localAdmission.prepare(admission);
  await gateway.localAdmission.activate(admission);
  return gatewayVersion;
}

async function readSigningBudgetSnapshot(database: {
  prepare(sql: string): { all(): Promise<{ results: readonly unknown[] }> };
}) {
  const quotas = await database.prepare(
    'SELECT * FROM authorization_wallet_session_quotas ORDER BY quota_id',
  ).all();
  const operations = await database.prepare(
    'SELECT * FROM authorized_operations ORDER BY authorized_operation_id',
  ).all();
  return {
    quotaRows: quotas.results.length,
    quotaSha256: createHash('sha256').update(JSON.stringify(quotas.results)).digest('hex'),
    operationRows: operations.results.length,
    operationSha256: createHash('sha256').update(JSON.stringify(operations.results)).digest('hex'),
  };
}

for (const curve of ['ed25519', 'ecdsa']) {
  test(`in-flight ${curve} signing rejects a retired regional writer without spending budget`, async ({
    harness,
    context,
  }, testInfo) => {
    const output = path.resolve(root, '.artifacts/r155b/console-outage', `live-retirement-${curve}`);
    const scenario = await createRegionalRealGateway({
      root, candidate, lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
      output,
    });
    try {
      await scenario.routeContext(context, 'US');
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      if (curve === 'ed25519') await harness.signNearTransaction('post_registration');
      else await harness.signTempoTransaction('post_registration');
      for (const gateway of scenario.gateways.values()) await Promise.all(gateway.pending);
      scenario.beginConsoleOutage();
      await scenario.routeContext(context, 'WEUR');
      const home = scenario.gateways.get('US');
      const before = await readSigningBudgetSnapshot(home.database);
      const signingPath = curve === 'ed25519'
        ? '/router-ab/ed25519/sign'
        : '/router-ab/ecdsa-derivation/sign';
      const fault = new RetireDuringSigningPrepare(scenario, `${signingPath}/prepare`);
      home.beforeHomeExecution = fault.beforeExecution.bind(fault);
      const signing = curve === 'ed25519'
        ? harness.signNearTransaction('post_registration')
        : harness.signTempoTransaction('post_registration');
      await assert.rejects(signing, /HTTP 503/);
      assert.equal(fault.retired, true);
      assert.equal(fault.attempts, 1);
      const after = await readSigningBudgetSnapshot(home.database);
      assert.deepEqual(after, before, 'Retired admission must not spend budget or create an operation');
      assert.deepEqual(scenario.consoleService.requests, []);
      const homeFinalize = home.requests.filter(isSuccessfulSigningFinalize);
      assert.equal(homeFinalize.length, 0);
      await writeFile(path.join(output, 'retirement.json'), JSON.stringify({
        curve,
        verifiedBaselineSignatures: 1,
        retiredAfterHomeRouting: true,
        rejectedPrepareAttempts: fault.attempts,
        unchangedQuotaAndOperations: true,
        storageBefore: before,
        storageAfter: after,
        successfulFinalizesAfterRetirement: homeFinalize.length,
        attemptedConsoleCalls: scenario.consoleService.requests.length,
        scope: 'Regional D1 deployment retirement during live browser signing prepare; excludes custody relocation and retirement after MPC execution begins.',
      }, null, 2));
    } finally {
      await harness.attachTrace(testInfo);
      await scenario.close();
    }
  });
}

function isSuccessfulSigningFinalize(request: { path: string; status: number }): boolean {
  return request.status === 200 && (
    request.path === '/router-ab/ed25519/sign' ||
    request.path === '/router-ab/ecdsa-derivation/sign'
  );
}

class RegistrationProvisioningReplyLoss {
  walletId = '';
  nearAccountId = '';
  publicKey = '';
  attempts = 0;
  statuses: number[] = [];

  constructor(private readonly scenario: Awaited<ReturnType<typeof createRegionalRealGateway>>) {}

  async intercept(route: Route): Promise<void> {
    this.attempts += 1;
    assert.equal(this.attempts, 1);
    const request = route.request();
    const original = new Request(request.url(), {
      method: request.method(),
      headers: await request.allHeaders(),
      body: request.postDataBuffer(),
    });
    const committed = await this.scenario.gateways.get('US').handle(original.clone(), 'ingress');
    this.statuses.push(committed.status);
    assert.equal(committed.status, 200);
    const committedBody = await committed.json();
    this.walletId = committedBody.walletId;
    this.nearAccountId = committedBody.ed25519.nearAccountId;
    this.publicKey = committedBody.ed25519.publicKey;
    const before = await readSigningBudgetSnapshot(this.scenario.gateways.get('US').database);
    this.scenario.beginConsoleOutage();
    const replay = await this.scenario.gateways.get('WEUR').handle(original.clone(), 'ingress');
    this.statuses.push(replay.status);
    const replayBody = await replay.text();
    const replayCode = JSON.parse(replayBody).code ?? null;
    await writeFile(path.join(this.scenario.output, 'replay-diagnostics.json'), JSON.stringify({
      status: replay.status, code: replayCode,
      consolePaths: this.scenario.consoleService.requests,
    }, null, 2));
    assert.equal(replay.status, 200, `Provisioning replay failed: ${replayCode}`);
    const replayed = JSON.parse(replayBody);
    for (const field of ['walletId', 'ed25519', 'custodyKeyManifestDigestB64u', 'authMethod']) {
      assert.ok(Object.hasOwn(committedBody, field), `Missing committed ${field}`);
      assert.deepEqual(replayed[field], committedBody[field], `Provisioning retry changed ${field}`);
    }
    const after = await readSigningBudgetSnapshot(this.scenario.gateways.get('US').database);
    assert.deepEqual(after, before, 'Provisioning retry must preserve budget and operation records');
    await route.fulfill({
      status: replay.status,
      headers: Object.fromEntries(replay.headers),
      body: replayBody,
    });
  }
}

for (const signerSet of ['mixed', 'near-only']) {
  test(`${signerSet} NEAR provisioning reply loss resumes through another region during Console outage`, async ({
    harness, context, page,
  }, testInfo) => {
    const output = path.resolve(root, `.artifacts/r155b/console-outage/registration-provisioning-retry-${signerSet}`);
    const scenario = await createRegionalRealGateway({
      root, candidate, lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
      output,
    });
    const fault = new RegistrationProvisioningReplyLoss(scenario);
    try {
      await scenario.routeContext(context, 'US');
      await context.route('**/wallets/register/near-provisioning', fault.intercept.bind(fault));
      if (signerSet === 'near-only') {
        await assert.rejects(harness.registerPasskeyEd25519YaoWallet(), /exact-method unlock/u);
        assert.deepEqual(scenario.consoleService.requests, []);
        await context.unroute('**/wallets/register/near-provisioning');
        scenario.consoleService.available = true;
        const recoveredUrl = new URL(page.url());
        recoveredUrl.searchParams.set('nearAccountId', fault.nearAccountId);
        await page.goto(recoveredUrl.href);
        await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute('data-login-state', 'logged_out');
        await page.getByLabel('Wallet to unlock', { exact: true }).fill(fault.walletId);
        await page.getByLabel('Require NEAR', { exact: true }).check();
        await page.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
        const recovery = page.getByTestId('wallet-unlock-result');
        await expect(recovery).toHaveAttribute('data-state', 'unlocked', { timeout: 60_000 });
        const recovered = JSON.parse(await recovery.innerText());
        assert.equal(recovered.result.walletId, fault.walletId);
        assert.equal(recovered.result.success, true);
        scenario.beginConsoleOutage();
      } else {
        await harness.registerPasskeyWallet();
        await harness.awaitNearReady();
      }
      assert.equal(fault.attempts, 1);
      for (const ingress of ['WEUR', 'APAC', 'OC']) {
        await scenario.routeContext(context, ingress);
        if (signerSet === 'near-only') {
          await page.getByTestId('intended-sign-near').click();
          const confirm = page.frameLocator('iframe.seams-wallet-overlay-iframe')
            .locator('#seams-confirm-portal button.btn-confirm, #seams-confirm-portal button.confirm').last();
          await confirm.click({ timeout: 30_000 });
          const result = page.getByTestId('intended-result-json');
          await expect(result).toContainText('near_sign_success', { timeout: 60_000 });
          const signed = requireNearSigningResult(JSON.parse(await result.innerText()), {
            walletId: fault.walletId, nearAccountId: fault.nearAccountId,
          });
          await verifyNearEd25519Signature({ registration: { operationalPublicKey: fault.publicKey }, result: signed });
          await waitForWalletIframeConfirmationSettlement(page);
        } else {
          await harness.signNearTransaction('post_registration');
        }
      }
      await scenario.verifyConsoleOutage('ed25519');
      await writeFile(path.join(output, 'registration-retry.json'), JSON.stringify({
        scope: 'The harness discards the committed provisioning reply and retries the identical request before delivering the replay to the SDK.',
        signerSet,
        exactMethodUnlockRequired: signerSet === 'near-only',
        statuses: fault.statuses,
        sameWalletAndSigner: true,
        unchangedBudgetAndOperations: true,
        verifiedSignatures: 3,
        attemptedConsoleCalls: scenario.consoleService.requests.length,
      }, null, 2));
      harness.assertNoLifecycleViolations();
    } finally {
      await harness.attachTrace(testInfo);
      await scenario.close();
    }
  });
}

class ForeignNearRegistrationProtocol {
  readonly requests: { path: string; ingress: string; home: string; status: number; consolePaths: string[] }[] = [];

  constructor(private readonly scenario: Awaited<ReturnType<typeof createRegionalRealGateway>>) {}

  async intercept(route: Route): Promise<void> {
    const browserRequest = route.request();
    const headers = await browserRequest.allHeaders();
    assert.equal(headers['x-seams-wallet-region'], 'US');
    const pathname = new URL(browserRequest.url()).pathname;
    const ingress = pathname.endsWith('/admit') ? 'WEUR' : 'APAC';
    const request = new Request(browserRequest.url(), {
      method: browserRequest.method(), headers, body: browserRequest.postDataBuffer(),
    });
    const callsBefore = this.scenario.consoleService.requests.length;
    const response = await this.scenario.gateways.get(ingress).handle(request, 'ingress');
    const consolePaths = this.scenario.consoleService.requests.slice(callsBefore);
    this.requests.push({ path: pathname, ingress, home: 'US', status: response.status, consolePaths });
    await writeFile(path.join(this.scenario.output, 'protocol-requests.json'), JSON.stringify(this.requests, null, 2));
    assert.equal(response.status, 200);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  }
}

async function verifyNearRegistrationProtocolHome(
  { harness, context }: { harness: InstanceType<typeof IntendedBehaviourHarness>; context: BrowserContext },
  testInfo: TestInfo,
) {
  const output = path.resolve(root, '.artifacts/r155b/console-outage/near-registration-protocol-home');
  const scenario = await createRegionalRealGateway({
    root, candidate, lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT, output,
  });
  const protocol = new ForeignNearRegistrationProtocol(scenario);
  try {
    await scenario.routeContext(context, 'US');
    await context.route('**/router-ab/ed25519/yao/registration/*', protocol.intercept.bind(protocol));
    await harness.registerPasskeyEd25519YaoWallet();
    assert.ok(protocol.requests.some(isYaoAdmission));
    assert.ok(protocol.requests.some(isYaoExecution));
    scenario.beginConsoleOutage();
    for (const ingress of ['WEUR', 'APAC', 'OC']) {
      await scenario.routeContext(context, ingress);
      await harness.signNearTransaction('post_registration');
    }
    await scenario.verifyConsoleOutage('ed25519');
    await writeFile(path.join(output, 'protocol-home.json'), JSON.stringify({
      signerSet: 'near-only', requests: protocol.requests,
      verifiedSignatures: 3, signingConsoleCalls: scenario.consoleService.requests.length,
      scope: 'Console is unavailable during subsequent signing. Registration retains its tenant-root context dependency; admission and execution carry the known home through foreign ingress.',
    }, null, 2));
    harness.assertNoLifecycleViolations();
  } finally {
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
}

function isYaoAdmission(request: { path: string }): boolean {
  return request.path.endsWith('/admit');
}

function isYaoExecution(request: { path: string }): boolean {
  return request.path.endsWith('/execute');
}

test('NEAR-only Yao registration uses its fixed home through foreign ingress', verifyNearRegistrationProtocolHome);

class RetireAfterSigningResponse {
  retired = false;
  replacementVersion: string | null = null;
  request: BrowserRequest | null = null;
  custodyResponseHash: string | null = null;
  replayedCustodyResponses = 0;
  responseStatus: number | null = null;
  before: Awaited<ReturnType<typeof readSigningBudgetSnapshot>> | null = null;

  constructor(
    readonly scenario: Awaited<ReturnType<typeof createRegionalRealGateway>>,
  ) {}

  capture(request: BrowserRequest): void {
    if (new URL(request.url()).pathname.endsWith('/sign')) this.request = request;
  }

  async fetch(
    delegate: { fetch(input: Request): Promise<Response> },
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init);
    const response = await delegate.fetch(request);
    if (!new URL(request.url).pathname.endsWith('/sign')) return response;
    const responseHash = createHash('sha256').update(await response.clone().text()).digest('hex');
    if (this.retired) {
      assert.equal(response.status, 200);
      assert.equal(responseHash, this.custodyResponseHash, 'Custody must return the same terminal result');
      this.replayedCustodyResponses += 1;
      return response;
    }
    this.custodyResponseHash = responseHash;
    assert.equal(response.status, 200, 'The custody operation must finish before writer retirement');
    this.responseStatus = response.status;
    this.before = await readSigningBudgetSnapshot(this.scenario.gateways.get('US').database);
    this.replacementVersion = await retireRegionalWriter(this.scenario);
    this.retired = true;
    return response;
  }
}

for (const curve of ['ed25519', 'ecdsa']) {
  test(`${curve} retirement after custody response prevents stale Gateway settlement`, async ({
    harness, context,
  }, testInfo) => {
    const output = path.resolve(root, `.artifacts/r155b/console-outage/post-custody-retirement-${curve}`);
    const scenario = await createRegionalRealGateway({
      root, candidate, lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT, output,
    });
    try {
      await scenario.routeContext(context, 'US');
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      scenario.beginConsoleOutage();
      await scenario.routeContext(context, 'WEUR');
      const home = scenario.gateways.get('US');
      const retirement = new RetireAfterSigningResponse(scenario);
      context.on('request', retirement.capture.bind(retirement));
      const environment = home.environment;
      home.environment = {
        ...environment,
        MPC_ROUTER: { fetch: retirement.fetch.bind(retirement, environment.MPC_ROUTER) },
        SIGNING_WORKER: { fetch: retirement.fetch.bind(retirement, environment.SIGNING_WORKER) },
      };
      const signing = curve === 'ecdsa'
        ? harness.signTempoTransaction('post_registration')
        : harness.signNearTransaction('post_registration');
      await assert.rejects(signing, /HTTP 50[03]/u);
      assert.equal(retirement.retired, true);
      assert.equal(retirement.responseStatus, 200);
      assert.ok(retirement.before);
      const after = await readSigningBudgetSnapshot(home.database);
      assert.deepEqual(after, retirement.before, 'A retired writer cannot settle the admitted operation');
      assert.deepEqual(scenario.consoleService.requests, []);
      assert.equal(home.requests.filter(isSuccessfulSigningFinalize).length, 0);
      assert.ok(retirement.replacementVersion);
      assert.ok(retirement.request);
      const retry = new Request(retirement.request.url(), {
        method: retirement.request.method(),
        headers: await retirement.request.allHeaders(),
        body: retirement.request.postDataBuffer(),
      });
      home.writerVersion = retirement.replacementVersion;
      const replay = await scenario.gateways.get('WEUR').handle(retry, 'ingress');
      const replayCode = (await replay.clone().json()).code ?? null;
      assert.equal(replay.status, 200, `Replacement writer replay failed: ${replayCode}`);
      assert.equal(retirement.replayedCustodyResponses, 1);
      const settled = await readSigningBudgetSnapshot(home.database);
      assert.equal(settled.quotaSha256, after.quotaSha256, 'Terminal replay cannot spend another use');
      assert.equal(settled.operationRows, after.operationRows);
      assert.notEqual(settled.operationSha256, after.operationSha256, 'The replacement must settle the pending operation');
      assert.deepEqual(scenario.consoleService.requests, []);
      await writeFile(path.join(output, 'post-custody-retirement.json'), JSON.stringify({
        curve, custodyResponseStatus: retirement.responseStatus,
        retirementPoint: 'After successful custody response, before Gateway operation settlement',
        unchangedQuotaAndOperations: true,
        before: retirement.before, after, settled,
        replacementReplayStatus: replay.status,
        sameCustodyResult: true,
        unchangedQuotaOnReplay: true,
        attemptedConsoleCalls: scenario.consoleService.requests.length,
        scope: 'Gateway deployment retirement. The custody operation already completed; this does not prove custody-side relocation fencing.',
      }, null, 2));
    } finally {
      await harness.attachTrace(testInfo);
      await scenario.close();
    }
  });
}

class LostRegistrationSetupReply {
  attempts = 0;
  identity: { operationId: string; walletId: string; ceremonyId: string } | null = null;
  readonly statuses: number[] = [];

  constructor(readonly scenario: Awaited<ReturnType<typeof createRegionalRealGateway>>) {}

  async intercept(route: Route): Promise<void> {
    this.attempts += 1;
    assert.ok(this.attempts <= 2, 'Setup recovery must remain bounded');
    const browserRequest = route.request();
    const requestBody = browserRequest.postDataJSON();
    const request = new Request(browserRequest.url(), {
      method: browserRequest.method(),
      headers: await browserRequest.allHeaders(),
      body: browserRequest.postDataBuffer(),
    });
    const ingress = this.attempts === 1 ? 'US' : 'APAC';
    const response = await this.scenario.gateways.get(ingress).handle(request, 'ingress');
    this.statuses.push(response.status);
    assert.equal(response.status, 200);
    const result = await response.clone().json();
    assert.deepEqual(result.home, { kind: 'regional', region: 'US' });
    assert.equal(typeof requestBody.registrationOperationId, 'string');
    const identity = {
      operationId: requestBody.registrationOperationId,
      walletId: result.walletId,
      ceremonyId: result.registrationCeremonyId,
    };
    if (this.identity === null) {
      this.identity = identity;
      await route.abort('connectionreset');
      return;
    }
    assert.deepEqual(identity, this.identity, 'Reload and foreign ingress must reuse the same registration');
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  }
}

for (const signerSet of ['mixed', 'near-only']) {
  test(`${signerSet} setup reply loss survives reload and foreign-region retry`, async ({
    harness, context, page,
  }, testInfo) => {
    const output = path.resolve(root, `.artifacts/r155b/console-outage/setup-retry-${signerSet}`);
    const scenario = await createRegionalRealGateway({
      root, candidate, lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT, output,
    });
    const fault = new LostRegistrationSetupReply(scenario);
    try {
      await scenario.routeContext(context, 'US');
      await context.route('**/wallets/register/setup', fault.intercept.bind(fault));
      const first = signerSet === 'near-only'
        ? harness.registerPasskeyEd25519YaoWallet()
        : harness.registerPasskeyWallet();
      await assert.rejects(first, /Failed to fetch|NetworkError|Load failed/u);
      assert.equal(fault.attempts, 1);
      await page.reload();
      if (signerSet === 'near-only') await harness.registerPasskeyEd25519YaoWallet();
      else {
        await harness.registerPasskeyWallet();
        await harness.awaitNearReady();
      }
      assert.equal(fault.attempts, 2);
      const placement = await scenario.consoleService.database.prepare(
        'SELECT region, state FROM wallet_homes',
      ).all();
      assert.deepEqual(placement.results, [{ region: 'US', state: 'established' }]);
      scenario.beginConsoleOutage();
      const curve = signerSet === 'near-only' ? 'ed25519' : 'ecdsa';
      for (const ingress of ['WEUR', 'APAC', 'OC']) {
        await scenario.routeContext(context, ingress);
        if (curve === 'ed25519') await harness.signNearTransaction('post_registration');
        else await harness.signTempoTransaction('post_registration');
      }
      await scenario.verifyConsoleOutage(curve);
      await writeFile(path.join(output, 'setup-retry.json'), JSON.stringify({
        signerSet, statuses: fault.statuses,
        lostReplyBeforeClientAcceptance: true,
        browserReloaded: true,
        identicalOperationWalletAndCeremony: true,
        ingress: ['US', 'APAC'], home: 'US', directoryRows: placement.results.length,
        verifiedSignatures: 3, signingConsoleCalls: scenario.consoleService.requests.length,
        scope: 'Actual SDK retry after a caller retries registration following a lost response and browser reload; no automatic network retry is claimed.',
      }, null, 2));
      harness.assertNoLifecycleViolations();
    } finally {
      await harness.attachTrace(testInfo);
      await scenario.close();
    }
  });
}

class RetirementDuringPendingSignature {
  attempts = 0;
  request: BrowserRequest | null = null;

  constructor(
    readonly sessions: { hasPendingOperations(walletId: string): Promise<boolean>; retire(source: unknown, nowMs: number): Promise<number> },
    readonly source: { walletId: string },
    readonly path: string,
    readonly database: Parameters<typeof readSigningBudgetSnapshot>[0],
  ) {}

  capture(request: BrowserRequest): void {
    if (new URL(request.url()).pathname === this.path) this.request = request;
  }

  async beforeExecution(request: Request): Promise<void> {
    if (new URL(request.url).pathname !== this.path) return;
    this.attempts += 1;
    assert.equal(this.attempts, 1);
    assert.equal(await this.sessions.hasPendingOperations(this.source.walletId), true);
    const before = await readSigningBudgetSnapshot(this.database);
    await assert.rejects(this.sessions.retire(this.source, Date.now()), /wallet_operations_unsettled/u);
    assert.deepEqual(await readSigningBudgetSnapshot(this.database), before);
  }
}

for (const curve of ['ed25519', 'ecdsa']) {
  test(`${curve} relocation retirement waits for admitted signing to settle`, async ({
    harness, context,
  }, testInfo) => {
    const output = path.resolve(root, `.artifacts/r155b/console-outage/relocation-signing-settlement-${curve}`);
    const scenario = await createRegionalRealGateway({
      root, candidate, lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT, output,
    });
    try {
      await scenario.routeContext(context, 'US');
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      const home = scenario.gateways.get('US');
      const wallet = await home.database.prepare(
        "SELECT wallet_id, generation FROM wallet_execution_generations WHERE state = 'active'",
      ).first();
      assert.ok(wallet);
      const source = home.api.WalletRelocationSessionSource.parse({
        walletId: wallet.wallet_id,
        sourceGeneration: wallet.generation,
        moveId: `wmove_${createHash('sha256').update(randomUUID()).digest('base64url')}`,
        requestDigestHex: createHash('sha256').update(randomUUID()).digest('hex'),
      });
      const sessions = new home.api.D1WalletRelocationSessions(home.database, {
        namespace: home.scope.namespace,
        orgId: home.scope.organizationId,
        projectId: home.scope.projectId,
        envId: home.scope.environmentId,
      });
      const signingPath = curve === 'ecdsa' ? '/router-ab/ecdsa-derivation/sign' : '/router-ab/ed25519/sign';
      const retirement = new RetirementDuringPendingSignature(sessions, source, signingPath, home.database);
      home.beforeHomeExecution = retirement.beforeExecution.bind(retirement);
      context.on('request', retirement.capture.bind(retirement));
      scenario.beginConsoleOutage();
      await scenario.routeContext(context, 'WEUR');
      if (curve === 'ecdsa') await harness.signTempoTransaction('post_registration');
      else await harness.signNearTransaction('post_registration');
      assert.equal(retirement.attempts, 1);
      assert.equal(await sessions.hasPendingOperations(source.walletId), false);
      home.beforeHomeExecution = null;
      const retiredAt = await sessions.retire(source, Date.now());
      assert.equal(await sessions.retire(source, Date.now()), retiredAt);
      const execution = await home.database.prepare(
        'SELECT state, generation FROM wallet_execution_generations WHERE wallet_id = ?',
      ).bind(source.walletId).first();
      assert.deepEqual(execution, { state: 'retired', generation: source.sourceGeneration });
      const settled = await readSigningBudgetSnapshot(home.database);
      assert.ok(retirement.request);
      const original = retirement.request;
      const rejected = await scenario.gateways.get('WEUR').handle(new Request(original.url(), {
        method: original.method(), headers: await original.allHeaders(), body: original.postDataBuffer(),
      }), 'ingress');
      assert.equal(rejected.status, 401, 'Retired session replay must fail authentication');
      assert.deepEqual(await readSigningBudgetSnapshot(home.database), settled);
      assert.deepEqual(scenario.consoleService.requests, []);
      await writeFile(path.join(output, 'settlement.json'), JSON.stringify({
        curve, pendingRetirementRejections: retirement.attempts,
        verifiedSignaturesBeforeRetirement: 1,
        retirementAfterSettlement: 'succeeded',
        exactRetirementReplay: true,
        retiredSessionFinalizeReplayStatus: rejected.status,
        noAdditionalQuotaOrOperationMutation: true,
        attemptedConsoleCalls: scenario.consoleService.requests.length,
        scope: 'Production regional session-retirement participant during live signing. Excludes directory orchestration, custody freeze, transfer and destination activation.',
      }, null, 2));
    } finally {
      await harness.attachTrace(testInfo);
      await scenario.close();
    }
  });
}

class ConcurrentRegistrationSetup {
  attempts = 0;
  readonly statuses: number[] = [];
  readonly conflicts: { status: number; code: string }[] = [];
  home: string | null = null;
  competingWallet: { walletId: string; ceremonyId: string; region: string } | null = null;

  constructor(readonly scenario: Awaited<ReturnType<typeof createRegionalRealGateway>>) {}

  async intercept(route: Route): Promise<void> {
    this.attempts += 1;
    assert.equal(this.attempts, 1);
    const browserRequest = route.request();
    const request = new Request(browserRequest.url(), {
      method: browserRequest.method(),
      headers: await browserRequest.allHeaders(),
      body: browserRequest.postDataBuffer(),
    });
    const responses = await Promise.all([
      this.scenario.gateways.get('US').handle(request.clone(), 'ingress'),
      this.scenario.gateways.get('APAC').handle(request.clone(), 'ingress'),
      this.scenario.gateways.get('OC').handle(request.clone(), 'ingress'),
    ]);
    const accepted = await responses[0].clone().json();
    assert.equal(accepted.home.kind, 'regional');
    this.home = accepted.home.region;
    for (const response of responses) {
      this.statuses.push(response.status);
      assert.equal(response.status, 200);
      const result = await response.clone().json();
      assert.equal(result.walletId, accepted.walletId);
      assert.equal(result.registrationCeremonyId, accepted.registrationCeremonyId);
      assert.deepEqual(result.home, accepted.home);
    }
    const setup = browserRequest.postDataJSON();
    const contenderBody = {
      registrationOperationId: createRegistrationSetupOperationId(),
      wallet: { kind: 'provided', walletId: accepted.walletId },
      signerSelection: setup.signerSelection,
      authMethod: setup.authMethod,
    };
    const contender = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(contenderBody),
    });
    const conflicts = await Promise.all([
      this.scenario.gateways.get('WEUR').handle(contender.clone(), 'ingress'),
      this.scenario.gateways.get('OC').handle(contender.clone(), 'ingress'),
    ]);
    for (const response of conflicts) {
      const result = await response.json();
      this.conflicts.push({ status: response.status, code: result.code });
      assert.equal(response.status, 409);
      assert.equal(result.code, 'wallet_conflict');
    }
    const separateOperation = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({
        registrationOperationId: createRegistrationSetupOperationId(),
        wallet: { kind: 'server_allocated' },
        signerSelection: setup.signerSelection,
        authMethod: setup.authMethod,
      }),
    });
    const separateResponse = await this.scenario.gateways.get('APAC').handle(separateOperation, 'ingress');
    assert.equal(separateResponse.status, 200);
    const separate = await separateResponse.json();
    assert.notEqual(separate.walletId, accepted.walletId);
    assert.equal(separate.home.region, 'APAC');
    this.competingWallet = {
      walletId: separate.walletId,
      ceremonyId: separate.registrationCeremonyId,
      region: separate.home.region,
    };
    await route.fulfill({
      status: responses[0].status,
      headers: Object.fromEntries(responses[0].headers),
      body: await responses[0].text(),
    });
  }
}

test('concurrent NEAR-only setup through three regions establishes one wallet', async ({
  harness, context,
}, testInfo) => {
  const output = path.resolve(root, '.artifacts/r155b/console-outage/concurrent-setup');
  const scenario = await createRegionalRealGateway({
    root, candidate, lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT, output,
  });
  const concurrent = new ConcurrentRegistrationSetup(scenario);
  try {
    await scenario.routeContext(context, 'US');
    await context.route('**/wallets/register/setup', concurrent.intercept.bind(concurrent));
    await harness.registerPasskeyEd25519YaoWallet();
    assert.equal(concurrent.attempts, 1);
    assert.ok(concurrent.competingWallet);
    const credentialOwnership = await verifyCompetingCredentialOwnership(scenario, concurrent.competingWallet);
    const placement = await scenario.consoleService.database.prepare(
      "SELECT region, state FROM wallet_homes WHERE state = 'established'",
    ).all();
    assert.deepEqual(placement.results, [{ region: concurrent.home, state: 'established' }]);
    scenario.beginConsoleOutage();
    for (const ingress of ['WEUR', 'APAC', 'OC']) {
      await scenario.routeContext(context, ingress);
      await harness.signNearTransaction('post_registration');
    }
    await scenario.verifyConsoleOutage('ed25519');
    await writeFile(path.join(output, 'concurrent-setup.json'), JSON.stringify({
      simultaneousIngress: ['US', 'APAC', 'OC'],
      statuses: concurrent.statuses,
      competingOperation: concurrent.conflicts,
      credentialOwnership,
      home: concurrent.home,
      identicalWalletAndCeremony: true,
      establishedDirectoryRows: placement.results.length,
      verifiedSignatures: 3,
      signingConsoleCalls: scenario.consoleService.requests.length,
      scope: 'Concurrent copies of one SDK registration operation, then a different operation claims the reserved wallet through two regions. Includes production directory credential claims and cancellation; excludes browser credential reuse and regional cancellation cleanup.',
    }, null, 2));
    harness.assertNoLifecycleViolations();
  } finally {
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
});


function registrationAuthorityAt(
  scenario: Awaited<ReturnType<typeof createRegionalRealGateway>>,
  region: string,
): ConsoleRegistrationHomeAdmission {
  const gateway = scenario.gateways.get(region);
  const home = gateway.catalog.select(region);
  const resource = { accountId: home.accountId, databaseId: home.databaseId };
  const writer = gateway.api.parseTenantRuntimeWriterV1('gateway', gateway.writerVersion, resource);
  return new gateway.api.ConsoleRegistrationHomeAdmission({
    environmentKey: gateway.environmentKey,
    service: scenario.consoleService,
    scope: gateway.scope,
    writer,
    localResource: resource,
    catalogJson: scenario.consoleService.catalogJson,
    ingressRegion: region,
  });
}

async function verifyCompetingCredentialOwnership(
  scenario: Awaited<ReturnType<typeof createRegionalRealGateway>>,
  competing: { walletId: string; ceremonyId: string; region: string },
) {
  const before = await scenario.consoleService.database.prepare(
    `SELECT claim.wallet_id, claim.rp_id, claim.credential_id, home.region
     FROM wallet_passkey_claims claim JOIN wallet_homes home ON
       home.namespace = claim.namespace AND home.organization_id = claim.organization_id
       AND home.project_id = claim.project_id AND home.environment_id = claim.environment_id
       AND home.wallet_id = claim.wallet_id`,
  ).all();
  assert.equal(before.results.length, 1);
  const owner = before.results[0];
  assert.notEqual(owner.wallet_id, competing.walletId);
  const ownerAuthority = registrationAuthorityAt(scenario, owner.region);
  const competingAuthority = registrationAuthorityAt(scenario, competing.region);
  const results = await Promise.all([
    ownerAuthority.identityStore().claim({
      walletId: owner.wallet_id, rpId: owner.rp_id, credentialIdB64u: owner.credential_id,
    }),
    competingAuthority.identityStore().claim({
      walletId: competing.walletId, rpId: owner.rp_id, credentialIdB64u: owner.credential_id,
    }),
  ]);
  assert.deepEqual(results, [true, false]);
  const assignment = await competingAuthority.findHome({ kind: 'ceremony', ceremonyId: competing.ceremonyId });
  assert.ok(assignment);
  const cancellation = await competingAuthority.complete({
    walletId: assignment.wallet.walletId, ceremonyId: competing.ceremonyId, outcome: 'cancelled',
  });
  assert.deepEqual(cancellation, { ok: true });
  const after = await scenario.consoleService.database.prepare(
    'SELECT wallet_id FROM wallet_passkey_claims',
  ).all();
  assert.deepEqual(after.results, [{ wallet_id: owner.wallet_id }]);
  const cancelledClaim = await competingAuthority.identityStore().claim({
    walletId: competing.walletId, rpId: owner.rp_id, credentialIdB64u: owner.credential_id,
  });
  assert.equal(cancelledClaim, false);
  const cancelled = await scenario.consoleService.database.prepare(
    'SELECT state FROM wallet_homes WHERE wallet_id = ?',
  ).bind(competing.walletId).first('state');
  assert.equal(cancelled, 'cancelled');
  return {
    ownerReplayAccepted: results[0],
    competingClaimAccepted: results[1],
    competingDirectoryReservationCancelled: true,
    cancelledClaimAccepted: cancelledClaim,
    originalClaimPreserved: true,
  };
}
