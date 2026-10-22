#!/usr/bin/env node
// Compose native VoiceID with the public Wallet's real MPC journey.
// Run through the Wallet's tsx command and intended-test TypeScript configuration.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { fundVoiceIdTestnetWallet, nearRpc } from './voiceid-testnet-funding.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE = path.join(ROOT, 'voiceId/engine');
const MODEL_INPUTS = path.join(
  ROOT,
  'voiceId/verifier-spike/.cache/native-models/native-inputs.json',
);
const MEDIA = path.join(ENGINE, 'target/local-host.e2e.media');
const EXAMPLE = path.join(ENGINE, 'target/release/examples/browser_host_journey');
const OUTPUT = path.join(ENGINE, 'target/browser-journey');
const HOST_NAME = 'com.seams.voiceid.prototype';
const EXTENSION_ID = 'ackhkimailmgolplljlhgoclgdjcgdba';
const APP_ORIGIN = 'http://localhost:4312';
const WALLET_ORIGIN = 'http://localhost:4313';
const GATEWAY_ORIGIN = 'http://127.0.0.1:4510';
const NAMESPACE = `com.seams.voiceid.browser-journey.${randomUUID()}`;

function quote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function main() {
  const wallet = process.argv[2];
  assert(
    wallet && path.isAbsolute(wallet),
    'Pass the isolated seams-wallet worktree as an absolute path',
  );
  const require = createRequire(path.join(wallet, 'tests/package.json'));
  const { chromium } = require('@playwright/test');
  const harnessModule = await import(
    pathToFileURL(path.join(wallet, 'tests/e2e/intended-behaviours/harness.ts')).href
  );
  const signingModule = await import(
    pathToFileURL(path.join(wallet, 'tests/e2e/intended-behaviours/voiceid-near-signing.ts')).href
  );
  for (const port of [4312, 4313, 4510, 4512, 4513, 4514, 4515, 4516]) await requireFreePort(port);
  await fs.mkdir(OUTPUT, { recursive: true });
  await fs.writeFile(path.join(OUTPUT, 'native-errors.log'), '');
  const profile = await fs.mkdtemp(path.join(OUTPUT, 'chromium-'));
  const serviceRoot = path.join(profile, 'wallet-services');
  const launcher = path.join(profile, 'native-host');
  const extension = path.join(ROOT, 'voiceId/browser/extension');
  let services;
  let context;
  let report;
  try {
    await run(EXAMPLE, ['init', MODEL_INPUTS, NAMESPACE, MEDIA], wallet);
    await fs.mkdir(path.join(profile, 'NativeMessagingHosts'));
    await fs.writeFile(
      path.join(profile, 'NativeMessagingHosts', `${HOST_NAME}.json`),
      JSON.stringify({
        name: HOST_NAME,
        description: 'Disposable VoiceID wallet journey',
        path: launcher,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
      }),
    );
    await selectCapture(launcher, 'approve');
    Object.assign(process.env, {
      SEAMS_INTENDED_APP_URL: APP_ORIGIN,
      SEAMS_INTENDED_WALLET_ORIGIN: WALLET_ORIGIN,
      SEAMS_INTENDED_ROUTER_URL: GATEWAY_ORIGIN,
      SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID: 'local-smoke-project:dev',
      SEAMS_INTENDED_PUBLISHABLE_KEY: 'pk_local',
      SEAMS_INTENDED_ROUTER_AB_ROOT: serviceRoot,
      SEAMS_LOCAL_PORT_OFFSET: '410',
    });
    const serviceLog = await fs.open(path.join(OUTPUT, 'services.log'), 'w', 0o600);
    try {
      services = spawn(
        process.execPath,
        [path.join(wallet, 'tests/scripts/start-wallet-intended-services.mjs')],
        {
          cwd: wallet,
          env: process.env,
          detached: true,
          stdio: ['ignore', serviceLog.fd, serviceLog.fd],
        },
      );
    } finally {
      await serviceLog.close();
    }
    await waitReady(`${GATEWAY_ORIGIN}/readyz`, services);
    await waitReady(`${APP_ORIGIN}/__intended-e2e`, services);
    await waitReady(`${WALLET_ORIGIN}/wallet-service`, services);
    process.stdout.write('VoiceID journey: isolated Wallet services ready.\n');
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const page = await context.newPage();
    const harness = new harnessModule.IntendedBehaviourHarness({
      context,
      page,
      request: context.request,
      flow: 'passkey.registration',
      networkMode: 'managed_local',
    });
    await harness.initialize();
    const voice = { select: selectCapture.bind(null, launcher) };
    const signing = await signingModule.verifyVoiceIdNearSigning({
      context,
      page,
      harness,
      voice,
      walletOrigin: WALLET_ORIGIN,
      gatewayOrigin: GATEWAY_ORIGIN,
    });
    process.stdout.write('VoiceID journey: native approval and real MPC signature verified.\n');
    const funding = await fundVoiceIdTestnetWallet(wallet, signing.owner.accountId);
    process.stdout.write('VoiceID journey: testnet wallet funded and disposable funder deleted.\n');
    const liveTransfers = [];
    await context.route(
      'https://rpc.testnet.fastnear.com/**',
      broadcastToTestnet.bind(
        null,
        signingModule.verifyVoiceIdNearTransfer,
        signing.owner,
        liveTransfers,
      ),
    );
    await harnessModule.waitForWalletIframeConfirmationSettlement(page);
    await voice.select('approve');
    await signingModule.startReviewedTransfer(page);
    await page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm').click();
    await page.getByTestId('reviewed-near-result').waitFor({ state: 'visible' });
    await page.waitForFunction(transferSettled, undefined, { timeout: 60_000 });
    const transfer = JSON.parse(await page.getByTestId('reviewed-near-result').innerText());
    assert.equal(transfer.kind, 'submitted', transfer.message);
    assert.equal(liveTransfers.length, 1);
    const outcomes = await page
      .frameLocator('iframe.seams-wallet-overlay-iframe')
      .locator('body')
      .evaluate(voiceOutcomes);
    assert.deepEqual(outcomes, ['approved', 'approved']);
    const receipt = await nearRpc('tx', {
      tx_hash: transfer.transactionId,
      sender_account_id: signing.owner.accountId,
      wait_until: 'FINAL',
    });
    assert.equal(receipt.final_execution_status, 'FINAL');
    assert(Object.hasOwn(receipt.status, 'SuccessValue'));
    assert.equal(receipt.transaction.signer_id, signing.owner.accountId);
    assert.equal(receipt.transaction.receiver_id, signing.owner.accountId);
    assert.equal(receipt.transaction.public_key, signing.owner.publicKey);
    assert.deepEqual(receipt.transaction.actions, [{ Transfer: { deposit: '1' } }]);
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
    await page.screenshot({ path: path.join(OUTPUT, 'wallet-transfer.png'), fullPage: true });
    report = {
      schemaVersion: 'voiceid-wallet-journey-v1',
      status: 'passed',
      capture: 'real_time_synthetic_pcm_replay',
      models: 'real_native_moonshine_and_ecapa',
      browser: 'real_chromium_extension_and_native_messaging',
      nativeNetworkAccess: 'denied_by_macos_sandbox',
      signing,
      testnet: {
        onChainConfirmed: true,
        funding,
        transfers: liveTransfers,
        transactionId: transfer.transactionId,
        finalExecutionStatus: receipt.final_execution_status,
        explorerUrl: `https://testnet.nearblocks.io/txns/${transfer.transactionId}`,
      },
      nativeHostSha256: await sha256(EXAMPLE),
      extensionBridgeSha256: await sha256(path.join(extension, 'bridge.js')),
      walletScenarioSha256: await sha256(
        path.join(wallet, 'tests/e2e/intended-behaviours/voiceid-near-signing.ts'),
      ),
      walletCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: wallet,
        encoding: 'utf8',
      }).trim(),
    };
  } finally {
    if (context) await context.close();
    if (services) await stopServices(services);
    await run(EXAMPLE, ['delete', MODEL_INPUTS, NAMESPACE], wallet);
    await fs.rm(profile, { recursive: true, force: true });
  }
  report.disposableAuthorityAndEnrollmentDeleted = true;
  await fs.writeFile(
    path.join(OUTPUT, 'wallet-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(
    `VoiceID Wallet MPC journey passed: ${path.join(OUTPUT, 'wallet-report.json')}\n`,
  );
}

async function broadcastToTestnet(verify, identity, transfers, route) {
  const request = route.request();
  if (request.method() === 'POST') {
    const message = JSON.parse(request.postData());
    if (message.method === 'send_tx')
      transfers.push(await verify(identity, message.params.signed_tx_base64));
  }
  await route.continue();
}
function transferSettled() {
  return (
    document.querySelector('[data-testid="reviewed-near-result"]')?.getAttribute('data-state') !==
    'pending'
  );
}
function voiceOutcomes() {
  return window.voiceBridgeObservation.outcomes();
}

async function selectCapture(launcher, command) {
  let name;
  switch (command) {
    case 'approve':
      name = 'approve-48k';
      break;
    case 'cancel':
      name = 'cancel-44k1';
      break;
    case 'other_speaker':
      name = 'different-speaker';
      break;
    case 'extra_words':
      name = 'extra-words';
      break;
    default:
      throw new Error(`Unknown voice command fixture: ${command}`);
  }
  const script = `#!/bin/sh\nexec /usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' ${quote(EXAMPLE)} serve ${quote(MODEL_INPUTS)} ${quote(NAMESPACE)} ${quote(path.join(MEDIA, `${name}.canonical.f32`))} "$@" 2>> ${quote(path.join(OUTPUT, 'native-errors.log'))}\n`;
  await fs.writeFile(launcher, script, { mode: 0o700 });
  await fs.chmod(launcher, 0o700);
}

async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  const code = await new Promise(waitForExit.bind(null, child));
  assert.equal(code, 0, `${command} failed`);
}
function waitForExit(child, resolve, reject) {
  child.once('error', reject);
  child.once('exit', resolve);
}
async function sha256(file) {
  return createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
}
async function requireFreePort(port) {
  const server = net.createServer();
  await new Promise(listen.bind(null, server, port));
  await new Promise(closeServer.bind(null, server));
}
function listen(server, port, resolve, reject) {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
}
function closeServer(server, resolve) {
  server.close(resolve);
}
async function delay(milliseconds) {
  await new Promise(schedule.bind(null, milliseconds));
}
function schedule(milliseconds, resolve) {
  setTimeout(resolve, milliseconds);
}
async function waitReady(url, child) {
  const deadline = Date.now() + 1_800_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Wallet services exited: ${child.signalCode || child.exitCode}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Wallet service did not become ready: ${url}`);
}
async function stopServices(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 15_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline)
    await delay(100);
  if (child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, 'SIGKILL');
    await new Promise(waitForExit.bind(null, child));
  }
}

await main();
