import type { BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRestartingRegionalGateway } from '../../helpers/restarting-regional-gateway.mjs';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { intendedTest: test } = await import(
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
  test(`linked ${curve} signs three times while Console is unavailable`, async ({
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
