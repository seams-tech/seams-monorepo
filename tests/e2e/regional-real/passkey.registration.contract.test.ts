import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test';
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
  try {
    await harness.initialize();
    await scenario.routeContext(context, 'US');
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    await harness.unlockPasskeyWallet();
    scenario.beginConsoleOutage();
    await scenario.routeContext(context, 'WEUR');
    await harness.signNearTransaction('post_unlock');
    await harness.signTempoAndArcEvmConcurrently('post_unlock');
    await scenario.routeContext(context, 'APAC');
    await harness.signNearTransaction('step_up_required');
    await scenario.routeContext(context, 'OC');
    await harness.signTempoTransaction('step_up_required');
    await scenario.verifyStepUpConsoleOutage();
    harness.assertNoLifecycleViolations();
  } finally {
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
}

test('shared budget exhaustion and both signing step-ups work while Console is unavailable', verifySharedBudgetAndStepUp);
