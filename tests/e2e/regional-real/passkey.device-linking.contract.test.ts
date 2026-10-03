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

test('real regional registration and linked signing stay at the wallet home', async ({
  harness,
  context,
  browser,
}) => {
  const scenario = await createRegionalRealGateway({
    root,
    candidate,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    output: path.resolve(
      root,
      process.env.SEAMS_TEST_ARTIFACT_DIR ?? '.artifacts/r152/regional-real-20261004',
    ),
  });
  try {
    await scenario.routeContext(context, 'WEUR');
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    const previous = browser.contexts();
    const device = await harness.openLinkedDevice(browser);
    const opened = browser.contexts().filter(isNewContext.bind(undefined, previous));
    if (opened.length !== 1) throw new Error('Expected one linked browser context');
    await scenario.routeContext(opened[0], 'APAC');
    await harness.linkDeviceWithPasskey(device);
    await device.signNearTransaction('post_device_link');
    await device.signTempoTransaction('post_device_link');
    await scenario.verifyHome('WEUR');
  } finally {
    await scenario.close();
  }
});

function isNewContext(previous: BrowserContext[], context: BrowserContext) {
  return !previous.includes(context);
}
