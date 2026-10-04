import type { Route } from '@playwright/test';
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
}, testInfo) => {
  await context.route(`${process.env.SEAMS_INTENDED_APP_URL}/**`, candidateAsset);
  await context.route(`${process.env.SEAMS_INTENDED_WALLET_ORIGIN}/**`, candidateAsset);
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
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
    expect(stages).toHaveLength(4);
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
  }
});
