import type { Route, BrowserContext } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const { expect, test } = await import(
  pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href
);
const site = process.env.SEAMS_HOSTED_CANDIDATE_SITE;
if (!site) throw new Error('SEAMS_HOSTED_CANDIDATE_SITE is required');
const { IntendedBehaviourHarness } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);
const { GatewayRequestEvidence } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/gateway-request-evidence.ts'))
    .href
);

const { LostLinkedAcknowledgement } = await import(
  pathToFileURL(
    path.join(publicRoot, 'tests/e2e/intended-behaviours/linked-device-acknowledgement-fault.ts'),
  ).href
);

function isNewContext(previous: readonly BrowserContext[], context: BrowserContext): boolean {
  return !previous.includes(context);
}

async function installCandidateAssets(context: BrowserContext): Promise<void> {
  await context.route(`${process.env.SEAMS_INTENDED_APP_URL}/**`, candidateAsset);
  await context.route(`${process.env.SEAMS_INTENDED_WALLET_ORIGIN}/**`, candidateAsset);
}

async function candidateAsset(route: Route): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/__storage-reset') {
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reset</title>' });
    return;
  }
  let relative = pathname.slice(1);
  if (pathname === '/' || pathname === '/__intended-e2e') {
    relative = 'index.html';
  } else if (pathname === '/wallet-service') {
    relative = 'wallet-service/index.html';
  } else if (pathname.endsWith('/')) {
    relative += 'index.html';
  }
  const file = path.resolve(site, relative);
  if (!file.startsWith(`${path.resolve(site)}/`)) throw new Error('Invalid candidate asset path');
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
  };
  await route.fulfill({
    body: await readFile(file),
    contentType: types[path.extname(file)] || 'application/octet-stream',
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

test('hosted registration, lock, unlock, export and verified ECDSA signing', async ({
  context,
  page,
  request,
  browser,
}, testInfo) => {
  await installCandidateAssets(context);
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'hosted_product',
  });
  const evidence = new GatewayRequestEvidence();
  evidence.start(context);
  const startedAt = performance.now();
  const stages = [];
  try {
    await harness.initialize();
    let start = performance.now();
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    stages.push({ operation: 'registration', elapsedMs: performance.now() - start });
    await harness.assertLockedPageReloadStaysLocked();
    start = performance.now();
    await harness.unlockPasskeyWallet();
    stages.push({ operation: 'unlock', elapsedMs: performance.now() - start });
    start = performance.now();
    await harness.exportEcdsaKey();
    stages.push({ operation: 'export', elapsedMs: performance.now() - start });
    start = performance.now();
    await harness.signTempoTransaction('post_unlock');
    stages.push({ operation: 'signing', elapsedMs: performance.now() - start });
    const previousContexts = browser.contexts();
    const device = await harness.openLinkedDevice(browser, installCandidateAssets);
    const opened = browser.contexts().filter(isNewContext.bind(undefined, previousContexts));
    expect(opened).toHaveLength(1);
    const deviceContext = opened[0];
    evidence.start(deviceContext);
    const lostAcknowledgement = new LostLinkedAcknowledgement(deviceContext, 2);
    await lostAcknowledgement.arm();
    const lostActivation = await device.loseLinkedActivationResponseOnce();
    start = performance.now();
    try {
      await harness.linkDeviceWithPasskey(device);
    } finally {
      await lostAcknowledgement.release();
      await lostActivation.release();
    }
    lostActivation.assertReplayed();
    await lostAcknowledgement.verify(testInfo);
    stages.push({ operation: 'link_with_lost_replies', elapsedMs: performance.now() - start });
    start = performance.now();
    await device.signNearTransaction('post_device_link');
    await device.signTempoTransaction('post_device_link');
    await harness.revokeLinkedDeviceWithOwnerPasskey();
    await device.assertRevokedDeviceCannotSign();
    await harness.signTempoTransaction('post_unlock');
    stages.push({
      operation: 'linked_signing_and_revocation_verified',
      elapsedMs: performance.now() - start,
    });
    device.assertNoWrongAuthPath();
    evidence.stop(deviceContext);
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
    expect(stages).toHaveLength(6);
  } finally {
    const output = path.resolve(
      process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/r152/hosted-product',
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'lifecycle.json'),
      JSON.stringify(
        {
          scope:
            'Local candidate browser assets; real hosted Gateway, Console and custody roles; no backend stubs',
          stages,
          requests: await evidence.window(startedAt, performance.now()),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await harness.attachTrace(testInfo);
    evidence.stop(context);
    await harness.closeLinkedDevice(testInfo);
  }
});
