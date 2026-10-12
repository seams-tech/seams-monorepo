import { installCandidateAssets } from './candidate-assets';
import type { Route } from '@playwright/test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const projectionFile = process.env.SEAMS_HOSTED_PROJECTION;
if (!projectionFile) throw new Error('SEAMS_HOSTED_PROJECTION is required');
const publicRoot = path.resolve(candidate, '../..');
const { expect, test } = await import(
  pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href
);
const { IntendedBehaviourHarness } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);

async function oldClientPage(route: Route): Promise<void> {
  await route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Published Wallet client</title>',
  });
}

async function oldClientModule(bundle: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: bundle });
}

async function requestOldRegistration(input: {
  gateway: string;
  relyingPartyId: string;
  publishableKey: string;
  environmentId: string;
}) {
  const modulePath = '/__published-wallet-client.js';
  const { setupWalletRegistration } = await import(modulePath);
  try {
    await setupWalletRegistration({
      relayerUrl: input.gateway,
      request: {
        wallet: { kind: 'server_allocated' },
        signerSelection: {
          kind: 'signer_set',
          signers: [
            {
              kind: 'near_ed25519',
              accountProvisioning: {
                kind: 'implicit_account',
                accountIdSource: 'ed25519_public_key',
              },
              signerSlot: 1,
              participantIds: [1, 2],
              derivationVersion: 1,
            },
          ],
        },
        authMethod: { kind: 'passkey', rpId: input.relyingPartyId },
      },
      auth: { publishableKey: input.publishableKey, environmentId: input.environmentId },
    });
    return { kind: 'unexpected_success' };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

test('published client is rejected by hosted Gateway and reload completes candidate registration', async ({
  context,
  page,
  request,
}, testInfo) => {
  const run = promisify(execFile);
  const packageDirectory = testInfo.outputPath('published-client');
  await mkdir(packageDirectory, { recursive: true });
  await run('npm', [
    'pack',
    '@seams/wallet@0.7.3',
    '--ignore-scripts',
    '--pack-destination',
    packageDirectory,
  ]);
  await run('tar', [
    '-xzf',
    path.join(packageDirectory, 'seams-wallet-0.7.3.tgz'),
    '-C',
    packageDirectory,
  ]);
  const installed = path.join(packageDirectory, 'package');
  const definition = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  expect(definition.version).toBe('0.7.3');
  const entry = path.join(installed, 'dist/esm/core/rpcClients/relayer/walletRegistration.js');
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  await installCandidateAssets(context);
  await context.route('**/__published-wallet-client.html', oldClientPage);
  await context.route(
    '**/__published-wallet-client.js',
    oldClientModule.bind(undefined, bundle.outputFiles[0].text),
  );
  const projection = JSON.parse(await readFile(projectionFile, 'utf8'));
  await page.goto(`${projection.applicationOrigin}/__published-wallet-client.html`);
  const outcome = await page.evaluate(requestOldRegistration, {
    gateway: projection.gatewayOrigin,
    relyingPartyId: projection.relyingPartyId,
    publishableKey: projection.publishableKey,
    environmentId: projection.environmentId,
  });
  expect(outcome).toEqual({
    kind: 'error',
    message:
      'Your wallet application needs an update. Reload this page and try again. If the problem continues, ask the application developer to upgrade the Wallet SDK.',
  });
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'hosted_product',
  });
  try {
    await harness.initialize();
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    await harness.signTempoTransaction('post_registration');
    const output = path.resolve(
      process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/r152/hosted-cutover',
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'client-cutover.json'),
      JSON.stringify(
        {
          oldVersion: definition.version,
          oldSourceSha256: createHash('sha256')
            .update(await readFile(entry))
            .digest('hex'),
          outcome,
          candidateRegistrationAndSignatureVerified: true,
          scope:
            'Published registration transport in Chromium against real hosted Gateway; same browser reloads candidate app and registers/signs. Does not load the entire historical app UI.',
        },
        null,
        2,
      ),
    );
  } finally {
    await harness.attachTrace(testInfo);
  }
});
