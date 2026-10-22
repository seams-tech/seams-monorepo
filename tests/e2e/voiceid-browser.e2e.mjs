#!/usr/bin/env node
// Real Chromium extension, native messaging, Moonshine/ECAPA, Keychain, and wallet review gate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE = path.join(ROOT, 'voiceId/engine');
const HOST_NAME = 'com.seams.voiceid.prototype';
const EXTENSION_ID = 'ackhkimailmgolplljlhgoclgdjcgdba';
const WALLET_ORIGIN = 'http://127.0.0.1:4313';
const APP_ORIGIN = 'http://localhost:4313';
const MODEL_INPUTS = path.join(
  ROOT,
  'voiceId/verifier-spike/.cache/native-models/native-inputs.json',
);
const MEDIA = path.join(ENGINE, 'target/local-host.e2e.media');
const EXAMPLE = path.join(ENGINE, 'target/release/examples/browser_host_journey');
const OUTPUT = path.join(ENGINE, 'target/browser-journey');
const NAMESPACE = `com.seams.voiceid.browser-journey.${randomUUID()}`;
const EVIDENCE = [];

function quote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  const code = await new Promise(resolveExit.bind(null, child));
  assert.equal(code, 0, `${command} failed`);
}
function resolveExit(child, resolve) {
  child.once('exit', resolve);
}

async function main() {
  const wallet = process.argv[2];
  assert(
    wallet && path.isAbsolute(wallet),
    'Pass the isolated seams-wallet worktree as an absolute path',
  );
  const require = createRequire(path.join(wallet, 'tests/package.json'));
  const { chromium } = require('@playwright/test');
  await fs.mkdir(OUTPUT, { recursive: true });
  await fs.writeFile(path.join(OUTPUT, 'native-errors.log'), '');
  const chunks = JSON.parse(
    execFileSync(
      process.execPath,
      [path.join(wallet, 'tests/scripts/build-preact-probe.mjs'), 'VoiceIdWalletHostProbe.ts'],
      { encoding: 'utf8' },
    ),
  );
  await fs.mkdir(path.join(OUTPUT, 'probe'), { recursive: true });
  for (const chunk of chunks) {
    assert.equal(path.basename(chunk.fileName), chunk.fileName);
    await fs.writeFile(path.join(OUTPUT, 'probe', chunk.fileName), chunk.code);
  }
  const profile = await fs.mkdtemp(path.join(OUTPUT, 'chromium-'));
  const extension = path.join(ROOT, 'voiceId/browser/extension');
  const launcher = path.join(profile, 'journey-native-host');
  const server = http.createServer(serveRequest.bind(null, wallet));
  let context;
  try {
    await run(EXAMPLE, ['init', MODEL_INPUTS, NAMESPACE, MEDIA], wallet);
    await fs.mkdir(path.join(profile, 'NativeMessagingHosts'));
    await fs.writeFile(
      path.join(profile, 'NativeMessagingHosts', `${HOST_NAME}.json`),
      JSON.stringify({
        name: HOST_NAME,
        description: 'Disposable VoiceID journey host',
        path: launcher,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
      }),
    );
    await installCapture(launcher, 'approve-48k');
    await new Promise(listenServer.bind(null, server));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const page = await context.newPage();
    page.on('pageerror', logPageError);
    await page.goto(`${WALLET_ORIGIN}/sdk/voiceid.html`);
    await page.getByRole('button', { name: 'Enable VoiceID', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'VoiceID is required' }).waitFor();
    EVIDENCE.push({
      case: 'wallet_origin_opt_in',
      result: 'required_after_real_native_enrollment_status',
    });

    const application = await context.newPage();
    await application.goto(`${APP_ORIGIN}/sdk/voiceid.html`);
    await application.getByRole('button', { name: 'Enable VoiceID', exact: true }).click();
    await application
      .getByRole('status')
      .filter({ hasText: 'Install the VoiceID Chrome extension' })
      .waitFor();
    EVIDENCE.push({ case: 'application_origin', result: 'cannot_connect' });
    await application.close();
    await page.goto(WALLET_ORIGIN);
    await page.waitForFunction(journeyLoaded);

    await begin(page, 25_000, '1000000000000000000000');
    const bypass = await page.evaluate(tryBypass);
    assert.match(bypass, /current voice approval is required/);
    assert.equal((await snapshot(page)).signingBoundaryCount, 0);
    await page.evaluate(cancelReview);
    await waitResult(page, 'cancelled');
    EVIDENCE.push({ case: 'signing_without_voice', result: 'rejected' });

    await begin(page, 25_000, '2000000000000000000000');
    assert.equal(await page.evaluate(tryChange), true);
    await page.screenshot({ path: path.join(OUTPUT, 'review.png'), fullPage: true });
    await confirm(page);
    await page.getByRole('status').filter({ hasText: 'Microphone is ready' }).waitFor();
    await page.screenshot({ path: path.join(OUTPUT, 'listening.png'), fullPage: true });
    await waitResult(page, 'ready_to_sign');
    assert.equal((await snapshot(page)).signingBoundaryCount, 1);
    assert.match(await page.evaluate(tryReuse), /current voice approval is required/);
    EVIDENCE.push({
      case: 'enrolled_approval',
      result: 'one_signing_admission',
      operationFrozen: true,
      reuse: 'rejected',
    });

    for (const fixture of ['cancel-44k1', 'different-speaker', 'extra-words']) {
      await installCapture(launcher, fixture);
      await begin(page, 25_000, '3000000000000000000000');
      await confirm(page);
      await waitResult(page, 'cancelled');
      assert.equal((await snapshot(page)).signingBoundaryCount, 1);
      assert.match(
        (await snapshot(page)).error,
        fixture === 'cancel-44k1' ? /speaker cancelled/ : /could not approve/,
      );
      EVIDENCE.push({ case: fixture, result: 'zero_additional_signing_admissions' });
    }

    await installCapture(launcher, 'approve-48k');
    await begin(page, 25_000, '4000000000000000000000');
    await confirm(page);
    await page.evaluate(cancelReview);
    await waitResult(page, 'cancelled');
    assert.equal((await snapshot(page)).signingBoundaryCount, 1);
    EVIDENCE.push({ case: 'cancel_pending_startup', result: 'zero_additional_signing_admissions' });

    await begin(page, 25_000, '4500000000000000000000');
    await confirm(page);
    await page.getByRole('status').filter({ hasText: 'Microphone is ready' }).waitFor();
    await page.evaluate(cancelReview);
    await waitResult(page, 'cancelled');
    assert.equal((await snapshot(page)).signingBoundaryCount, 1);
    EVIDENCE.push({
      case: 'cancel_after_capture_started',
      result: 'zero_additional_signing_admissions',
    });

    await begin(page, 900, '5000000000000000000000');
    await confirm(page);
    await waitResult(page, 'cancelled');
    assert.equal((await snapshot(page)).signingBoundaryCount, 1);
    EVIDENCE.push({ case: 'review_expiry', result: 'zero_additional_signing_admissions' });

    // A new operation after cancellation must obtain its own native result.
    await begin(page, 25_000, '6000000000000000000000');
    await confirm(page);
    await waitResult(page, 'ready_to_sign');
    assert.equal((await snapshot(page)).signingBoundaryCount, 2);
    EVIDENCE.push({
      case: 'new_operation_after_cancel_and_expiry',
      result: 'fresh_native_approval_required',
    });
    await context.close();
    context = undefined;
  } finally {
    if (context) await context.close();
    if (server.listening) await new Promise(closeServer.bind(null, server));
    await run(EXAMPLE, ['delete', MODEL_INPUTS, NAMESPACE], wallet);
    await fs.rm(profile, { recursive: true, force: true });
  }
  await writeReport(wallet);
}

async function installCapture(launcher, name) {
  const script = `#!/bin/sh\nexec /usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' ${quote(EXAMPLE)} serve ${quote(MODEL_INPUTS)} ${quote(NAMESPACE)} ${quote(path.join(MEDIA, `${name}.canonical.f32`))} "$@" 2>> ${quote(path.join(OUTPUT, 'native-errors.log'))}\n`;
  await fs.writeFile(launcher, script, { mode: 0o700 });
  await fs.chmod(launcher, 0o700);
}

async function serveRequest(wallet, request, response) {
  try {
    const url = new URL(request.url, WALLET_ORIGIN);
    let file;
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/sdk/wallet-ui.css"></head><body><script type="module" src="/probe/probe.js"></script></body></html>',
      );
      return;
    }
    if (url.pathname.startsWith('/probe/'))
      file = path.join(OUTPUT, 'probe', path.basename(url.pathname));
    else if (url.pathname.startsWith('/sdk/') && !url.pathname.includes('..')) {
      file = path.join(wallet, 'packages/wallet/dist/public', url.pathname);
    } else {
      response.writeHead(404).end();
      return;
    }
    const type = file.endsWith('.css')
      ? 'text/css'
      : file.endsWith('.html')
        ? 'text/html'
        : 'application/javascript';
    response.setHeader('Content-Type', type);
    response.end(await fs.readFile(file));
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
}
function listenServer(server, resolve, reject) {
  server.once('error', reject);
  server.listen(4313, resolve);
}
function closeServer(server, resolve) {
  server.close(resolve);
}
function logPageError(error) {
  process.stderr.write(`Browser: ${error.message}\n`);
}
function journeyLoaded() {
  return Boolean(window.voiceJourney);
}
function cancelReview() {
  window.voiceJourney.cancel();
}
function tryBypass() {
  return window.voiceJourney.trySigningWithoutVoice();
}
function tryChange() {
  return window.voiceJourney.tryChangingOperation();
}
function tryReuse() {
  return window.voiceJourney.trySecondConsumption();
}
function readSnapshot() {
  return window.voiceJourney.snapshot();
}
function startReview({ timeoutMs, amount }) {
  return window.voiceJourney.begin(timeoutMs, amount);
}
function isSettled() {
  return window.voiceJourney.snapshot().kind === 'settled';
}
async function snapshot(page) {
  return page.evaluate(readSnapshot);
}
async function begin(page, timeoutMs, amount) {
  await page.evaluate(startReview, { timeoutMs, amount });
  await page.locator('button.confirm').waitFor();
  await page.waitForFunction(reviewIsActive);
}
function reviewIsActive() {
  const surface = document.querySelector('.seams-confirmation-surface');
  return surface instanceof HTMLElement && !surface.inert;
}
async function confirm(page) {
  await page.locator('button.confirm').click();
}
async function waitResult(page, expected) {
  await page.waitForFunction(isSettled, undefined, { timeout: 40_000 });
  assert.equal((await snapshot(page)).result, expected, JSON.stringify(await snapshot(page)));
}
async function writeReport(wallet) {
  const engine = await fs.readFile(EXAMPLE);
  const bridge = await fs.readFile(path.join(ROOT, 'voiceId/browser/extension/bridge.js'));
  const walletProbe = await fs.readFile(path.join(OUTPUT, 'probe/probe.js'));
  const report = {
    schemaVersion: 'voiceid-browser-journey-v1',
    status: 'passed',
    models: 'real_native_moonshine_and_ecapa',
    capture: 'real_time_synthetic_pcm_replay',
    store: 'disposable_login_keychain_namespace',
    browser: 'real_chromium_extension_and_native_messaging',
    boundary: 'production_wallet_review_beforeSigning',
    transactionBroadcast: false,
    walletWorktree: wallet,
    disposableNamespaceDeleted: true,
    nativeNetworkAccess: 'denied_by_macos_sandbox',
    nativeHostSha256: createHash('sha256').update(engine).digest('hex'),
    extensionBridgeSha256: createHash('sha256').update(bridge).digest('hex'),
    cases: EVIDENCE,
    walletProbeSha256: createHash('sha256').update(walletProbe).digest('hex'),
  };
  await fs.writeFile(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`VoiceID browser journey passed: ${path.join(OUTPUT, 'report.json')}\n`);
}

await main();
