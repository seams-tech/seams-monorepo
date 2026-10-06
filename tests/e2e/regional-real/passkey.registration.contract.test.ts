import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { APIRequestContext, BrowserContext, Page, Request as BrowserRequest, Route, TestInfo } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRestartingRegionalGateway } from '../../helpers/restarting-regional-gateway.mjs';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { expect } = await import(pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href);
const { intendedTest: test, IntendedBehaviourHarness, requireNearSigningResult, verifyNearEd25519Signature, waitForWalletIframeConfirmationSettlement } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);

for (const curve of ['ecdsa', 'ed25519']) {
  test(`${curve} signs through WEUR, APAC and OC while Console is unavailable`, async ({
    harness,
    context,
  }) => {
    const scenario = await createRegionalRealGateway({
      root,
      candidate,
      lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
      output: path.resolve(root, '.artifacts/r155b/console-outage', curve),
    });
    try {
      await scenario.routeContext(context, 'US');
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      scenario.beginConsoleOutage();
      for (const ingress of ['WEUR', 'APAC', 'OC']) {
        await scenario.routeContext(context, ingress);
        if (curve === 'ecdsa') await harness.signTempoTransaction('post_registration');
        else await harness.signNearTransactionAfterRefresh();
      }
      await scenario.verifyConsoleOutage(curve);
    } finally {
      await scenario.close();
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
    const gateway = this.scenario.gateways.get('US');
    const binding = this.scenario.consoleService.binding;
    const proofs = [];
    for (const resource of binding.resources) {
      proofs.push(gateway.api.regionalResourceProof(
        binding,
        resource.databaseId,
        randomUUID(),
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
    this.retired = true;
  }
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
