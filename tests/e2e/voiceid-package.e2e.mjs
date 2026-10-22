#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE = path.join(ROOT, 'voiceId/engine');
const OUTPUT = path.join(ENGINE, 'target/package-journey');
const HOST = 'com.seams.voiceid.prototype';
const ORIGIN = 'http://localhost:4313';
const MEDIA = [
  'enroll-1',
  'enroll-2',
  'enroll-3',
  'approve-48k',
  'cancel-44k1',
  'different-speaker',
  'extra-words',
];

async function main() {
  const [wallet, archive] = process.argv.slice(2);
  assert(
    wallet &&
      archive &&
      path.isAbsolute(wallet) &&
      path.isAbsolute(archive) &&
      archive.endsWith('.tar.gz'),
    'Pass an absolute Wallet directory and package archive.',
  );
  const { chromium, expect } = createRequire(path.join(wallet, 'tests/package.json'))(
    '@playwright/test',
  );
  await fs.mkdir(OUTPUT, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "VoiceID user's package-"));
  const relocated = path.join(temporary, 'Relocated VoiceID');
  const profile = path.join(temporary, 'Chrome user data');
  const models = path.join(relocated, 'native-inputs.json');
  let browser;
  let server;
  let report;
  try {
    const prefix = path.basename(archive, '.tar.gz');
    const entries = execFileSync('/usr/bin/tar', ['-tf', archive], { encoding: 'utf8' })
      .trim()
      .split('\n');
    for (const entry of entries) {
      assert(entry.split('/')[0] === prefix && !entry.split('/').includes('..'));
    }
    execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', temporary]);
    await fs.rename(path.join(temporary, prefix), relocated);
    await fs.mkdir(profile);
    const config = JSON.parse(await fs.readFile(models, 'utf8'));
    assert.deepEqual(
      Object.keys(config).sort(),
      [
        'schemaVersion',
        'modelDirectory',
        'moonshineLibrary',
        'onnxRuntimeLibrary',
        'speakerModel',
        'speakerAcceptSimilarity',
        'speakerMinimumSamples',
        'speakerMinimumRms',
      ].sort(),
    );
    for (const asset of [
      config.modelDirectory,
      config.moonshineLibrary.path,
      config.onnxRuntimeLibrary.path,
      config.speakerModel.path,
    ])
      assert(!path.isAbsolute(asset));
    await fs.mkdir(path.join(temporary, 'media'));
    const media = [];
    for (const name of MEDIA) {
      const destination = path.join(temporary, 'media', `${name}.f32`);
      await fs.copyFile(
        path.join(ENGINE, 'target/local-host.e2e.media', `${name}.canonical.f32`),
        destination,
      );
      media.push(destination);
    }
    const native = path.join(temporary, 'c-host');
    execFileSync('clang', [
      '-std=c11',
      '-Wall',
      '-Wextra',
      '-Werror',
      `-I${path.join(relocated, 'include')}`,
      path.join(ENGINE, 'examples/native_host_journey.c'),
      `-L${path.join(relocated, 'lib')}`,
      '-lvoiceid_engine',
      `-Wl,-rpath,${path.join(relocated, 'lib')}`,
      '-o',
      native,
    ]);
    const policy = `(version 1) (allow default) (deny file-read-data (subpath ${JSON.stringify(ROOT)})) (deny file-read-data (subpath ${JSON.stringify(wallet)}))`;
    for (const file of [
      path.join(ROOT, 'voiceId/browser/SETUP.txt'),
      path.join(wallet, 'AGENTS.md'),
    ]) {
      assert.equal(spawnSync('/bin/cat', [file]).status, 0);
      const denied = spawnSync('/usr/bin/sandbox-exec', ['-p', policy, '/bin/cat', file], {
        encoding: 'utf8',
      });
      assert.notEqual(denied.status, 0);
      assert.match(denied.stderr, /Operation not permitted/);
    }
    await run(
      '/usr/bin/sandbox-exec',
      [
        '-p',
        `${policy} (deny network*)`,
        native,
        models,
        `com.seams.voiceid.package-journey.${randomUUID()}`,
        ...media,
        path.join(OUTPUT, 'c-report.json'),
      ],
      temporary,
    );
    const c = JSON.parse(await fs.readFile(path.join(OUTPUT, 'c-report.json'), 'utf8'));
    assert.equal(c.status, 'passed');
    process.stdout.write(
      'Relocated package: real-model C journey passed with source and network access denied.\n',
    );
    const installer = path.join(relocated, 'install.mjs');
    execFileSync(process.execPath, [installer, 'install', '--user-data-dir', profile]);
    const manifest = path.join(profile, 'NativeMessagingHosts', `${HOST}.json`);
    const installed = JSON.parse(await fs.readFile(manifest, 'utf8'));
    assert.equal(installed.name, HOST);
    assert.deepEqual(installed.allowed_origins, [
      'chrome-extension://ackhkimailmgolplljlhgoclgdjcgdba/',
    ]);
    const chromiumLauncher = path.join(temporary, 'chromium');
    await fs.writeFile(
      chromiumLauncher,
      `#!/bin/sh\nexec /usr/bin/sandbox-exec -p ${quote(policy)} ${quote(chromium.executablePath())} "$@"\n`,
      { mode: 0o700 },
    );
    server = http.createServer(serveProbe);
    await new Promise(listen.bind(null, server));
    const extension = path.join(relocated, 'extension');
    browser = await chromium.launchPersistentContext(profile, {
      executablePath: chromiumLauncher,
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const page = await browser.newPage();
    await page.goto(ORIGIN);
    const enrollment = await inspectHost(page, expect);
    assert(enrollment === 'empty' || enrollment === 'ready');
    const speakerModel = path.join(relocated, config.speakerModel.path);
    const bytes = await fs.readFile(speakerModel);
    const changed = Buffer.from(bytes);
    changed[0] ^= 1;
    await fs.writeFile(speakerModel, changed);
    assert.equal(await inspectHost(page, expect), 'failed');
    await fs.writeFile(speakerModel, bytes);
    assert.equal(await inspectHost(page, expect), enrollment);
    execFileSync(process.execPath, [installer, 'install', '--user-data-dir', profile]);
    assert.equal(await inspectHost(page, expect), enrollment);
    execFileSync(process.execPath, [installer, 'remove', '--user-data-dir', profile]);
    assert.equal(await inspectHost(page, expect), 'failed');
    await page.screenshot({ path: path.join(OUTPUT, 'removed-host.png') });
    report = {
      schemaVersion: 'voiceid_package_journey_v1',
      status: 'passed',
      sourceCheckoutReads: 'denied_for_native_and_chromium',
      sourceDenialControl: 'both_checkouts_readable_normally_and_denied_under_policy',
      inferenceNetwork: 'denied_in_c_journey',
      capture: 'synthetic_pcm_through_real_native_models',
      liveMicrophoneCapture: false,
      relocation: 'outside_checkout_with_spaces_and_apostrophe',
      runtimeMetadataContainsEvaluationData: false,
      archiveSha256: sha256(await fs.readFile(archive)),
      nativeHostSha256: sha256(await fs.readFile(path.join(relocated, 'bin/voiceid-host'))),
      sharedLibrarySha256: sha256(
        await fs.readFile(path.join(relocated, 'lib/libvoiceid_engine.dylib')),
      ),
      runtimeMetadataSha256: sha256(await fs.readFile(models)),
      cJourney: c,
      browser: {
        installedHostLoaded: true,
        enrollment,
        tamperedModelRejected: true,
        restoredModelLoaded: true,
        reinstallPassed: true,
        removalPreventedConnection: true,
      },
    };
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(closeServer.bind(null, server));
    await fs.rm(temporary, { recursive: true });
  }
  report.disposableProfileAndPackageDeleted = true;
  await fs.writeFile(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`VoiceID package journey passed: ${path.join(OUTPUT, 'report.json')}\n`);
}

async function inspectHost(page, expect) {
  await page.getByRole('button', { name: 'Check installed host', exact: true }).click();
  const output = page.locator('output');
  await expect(output).not.toHaveText('pending', { timeout: 60_000 });
  return await output.innerText();
}
function serveProbe(_request, response) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(PROBE);
}
function listen(server, resolve, reject) {
  server.once('error', reject);
  server.listen(4313, '127.0.0.1', resolve);
}
function closeServer(server, resolve) {
  server.close(resolve);
}
function quote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  const code = await new Promise(waitForExit.bind(null, child));
  assert.equal(code, 0, 'Relocated native journey failed.');
}
function waitForExit(child, resolve, reject) {
  child.once('error', reject);
  child.once('exit', resolve);
}

const PROBE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Installed VoiceID host</title>
<button type="button" onclick="inspectHost()">Check installed host</button>
<output>idle</output>
<script>
let state = { kind: 'idle' };
function publish(value) {
  document.querySelector('output').textContent = value;
}
function inspectHost() {
  if (state.kind === 'pending') return;
  publish('pending');
  const id = crypto.randomUUID();
  const port = chrome.runtime.connect('ackhkimailmgolplljlhgoclgdjcgdba', {
    name: 'seams-voiceid-v1',
  });
  state = { kind: 'pending', id, port };
  port.onMessage.addListener(receive);
  port.onDisconnect.addListener(disconnected);
  port.postMessage({ kind: 'status', id });
}
function receive(reply) {
  if (
    state.kind !== 'pending' || reply.kind !== 'status' ||
    reply.id !== state.id || !['empty', 'ready'].includes(reply.enrollment)
  ) {
    throw new Error('Invalid native status');
  }
  const port = state.port;
  state = { kind: 'settled' };
  publish(reply.enrollment);
  port.disconnect();
}
function disconnected() {
  void chrome.runtime.lastError;
  if (state.kind !== 'pending') return;
  state = { kind: 'settled' };
  publish('failed');
}
</script>
</html>`;

await main();
