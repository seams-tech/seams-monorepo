import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { APIRequestContext, BrowserContext, Page, Request as BrowserRequest, TestInfo } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRestartingRegionalGateway } from '../../helpers/restarting-regional-gateway.mjs';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { intendedTest: test, IntendedBehaviourHarness } = await import(
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
