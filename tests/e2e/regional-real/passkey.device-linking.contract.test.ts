import type { BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { intendedTest: test, IntendedBehaviourHarness } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);

for (const { home, ingress } of [
  { home: 'US', ingress: 'WEUR' },
  { home: 'WEUR', ingress: 'APAC' },
  { home: 'APAC', ingress: 'US' },
]) {
  test(`real ${home} registration and ${ingress} linked signing survive lost execution, activation and cleanup replies`, async ({
    harness,
    context,
    browser,
  }) => {
    const scenario = await createRegionalRealGateway({
      root,
      candidate,
      lostAcknowledgements: 2,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
      output: path.resolve(
        root,
        process.env.SEAMS_TEST_ARTIFACT_DIR ?? '.artifacts/r152/regional-real',
        home,
      ),
    });
    try {
      await scenario.routeContext(context, home);
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      const previous = browser.contexts();
      const device = await harness.openLinkedDevice(browser);
      const opened = browser.contexts().filter(isNewContext.bind(undefined, previous));
      if (opened.length !== 1) throw new Error('Expected one linked browser context');
      await scenario.routeContext(opened[0], ingress);
      await harness.linkDeviceWithPasskey(device);
      await device.signNearTransaction('post_device_link');
      await device.signTempoTransaction('post_device_link');
      await scenario.verifyHome(home);
    } finally {
      await scenario.close();
    }
  });
}

test('three real wallets retain distinct homes through travel, passkey unlock and key export', async ({
  browser,
  request,
}, testInfo) => {
  const scenario = await createRegionalRealGateway({
    root,
    candidate,
    lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    output: path.resolve(
      root,
      process.env.SEAMS_TEST_ARTIFACT_DIR ?? '.artifacts/r152/regional-real',
      'mixed-homes',
    ),
  });
  const owners = [];
  try {
    for (const { home, travel } of [
      { home: 'US', travel: 'APAC' },
      { home: 'WEUR', travel: 'US' },
      { home: 'APAC', travel: 'WEUR' },
    ]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const harness = new IntendedBehaviourHarness({
        context,
        page,
        request,
        flow: 'passkey.registration',
        networkMode: 'managed_local',
      });
      owners.push({ home, travel, context, harness, page });
      await harness.initialize();
      await scenario.routeContext(context, home);
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
    }
    const wallets = [];
    for (const owner of owners) {
      await scenario.routeContext(owner.context, owner.travel);
      await owner.harness.assertLockedPageReloadStaysLocked();
      await owner.harness.unlockPasskeyWallet();
      await owner.harness.exportEd25519Key();
      await owner.harness.exportEcdsaKey();
      await owner.harness.signNearTransaction('post_unlock');
      await owner.harness.signTempoTransaction('post_unlock');
      const walletId = await owner.page
        .getByTestId('intended-e2e-page')
        .getAttribute('data-login-wallet-id');
      if (!walletId) throw new Error('Registered owner must retain its wallet identity');
      wallets.push({ home: owner.home, travel: owner.travel, walletId });
    }
    await scenario.verifyMixedHomes(wallets);
    for (const owner of owners) {
      await owner.harness.attachTrace(testInfo, `${owner.home}-owner-trace.json`);
      owner.harness.assertNoLifecycleViolations();
      owner.harness.assertNoWrongAuthPath();
    }
  } finally {
    for (const owner of owners) await owner.context.close();
    await scenario.close();
  }
});

function isNewContext(previous: BrowserContext[], context: BrowserContext) {
  return !previous.includes(context);
}
