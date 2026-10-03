import type { BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { intendedTest: test } = await import(
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

function isNewContext(previous: BrowserContext[], context: BrowserContext) {
  return !previous.includes(context);
}
