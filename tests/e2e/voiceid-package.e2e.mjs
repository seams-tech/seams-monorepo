#!/usr/bin/env node
// Check the relocatable package and its idle loopback service without opening Keychain.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = path.join(ROOT, 'voiceId/engine/target/package-journey');
const ADDRESS = 'http://127.0.0.1:4318';

async function main() {
  const [archive, extra] = process.argv.slice(2);
  assert(archive && !extra && path.isAbsolute(archive) && archive.endsWith('.tar.gz'),
    'Pass the absolute VoiceID package archive.');
  await requireFreePort();
  await fs.mkdir(OUTPUT, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "VoiceID user's package-"));
  let service;
  try {
    const directory = path.basename(archive, '.tar.gz');
    const entries = execFileSync('/usr/bin/tar', ['-tf', archive], { encoding: 'utf8' })
      .trim()
      .split('\n');
    for (const entry of entries) {
      assert.equal(entry.split('/')[0], directory);
      assert(!entry.split('/').includes('..'));
    }
    execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', temporary]);
    const packageRoot = path.join(temporary, "Relocated VoiceID's package");
    await fs.rename(path.join(temporary, directory), packageRoot);
    const config = JSON.parse(await fs.readFile(path.join(packageRoot, 'native-inputs.json'), 'utf8'));
    assert.equal(config.schemaVersion, 'voiceid_native_journey_input_v1');
    for (const entry of [
      config.moonshineLibrary,
      config.onnxRuntimeLibrary,
      config.speakerModel,
    ]) {
      assert.equal(path.isAbsolute(entry.path), false);
      assert.equal(hash(await fs.readFile(path.join(packageRoot, entry.path))),
        Buffer.from(entry.sha256).toString('hex'));
    }
    for (const file of [
      'bin/voiceid-host',
      'lib/libvoiceid_engine.dylib',
      'serve.mjs',
      'enroll-web.mjs',
      'enroll-web.html',
      'SETUP.txt',
      'NOTICE.txt',
    ]) {
      assert((await fs.stat(path.join(packageRoot, file))).size > 0);
    }
    execFileSync('/usr/bin/codesign',
      ['--verify', '--strict', path.join(packageRoot, 'bin/voiceid-host')]);
    execFileSync('/usr/bin/codesign',
      ['--verify', '--strict', path.join(packageRoot, 'lib/libvoiceid_engine.dylib')]);
    service = spawn(process.execPath, [path.join(packageRoot, 'serve.mjs'), packageRoot], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitReady(service);
    const denied = await fetch(`${ADDRESS}/voiceid`, {
      method: 'POST',
      headers: {
        origin: 'https://example.com',
        'content-type': 'application/json',
        'x-voiceid-protocol': 'v1',
      },
      body: JSON.stringify({ kind: 'status', id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
    });
    assert.equal(denied.status, 403);
    const report = {
      schemaVersion: 'voiceid_package_journey_v2',
      status: 'passed',
      keychainAccess: 'none; the native host remains idle',
      relocation: 'outside checkout with spaces and apostrophe',
      archiveSha256: hash(await fs.readFile(archive)),
      nativeHostSha256: hash(await fs.readFile(path.join(packageRoot, 'bin/voiceid-host'))),
      modelAndLibraryHashesVerified: true,
      codeSignaturesVerified: true,
      idleBridgeReady: true,
      unauthorizedOriginRejected: true,
    };
    await fs.writeFile(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`VoiceID package journey passed: ${path.join(OUTPUT, 'report.json')}\n`);
  } finally {
    if (service) {
      service.kill('SIGTERM');
      await new Promise(waitForExit.bind(null, service));
    }
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function waitReady(child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'The packaged bridge exited before startup.');
    try {
      const response = await fetch(`${ADDRESS}/readyz`);
      if (response.ok) return;
    } catch {}
    await delay(20);
  }
  throw new Error('The packaged bridge did not start.');
}

async function requireFreePort() {
  const server = net.createServer();
  await new Promise(listen.bind(null, server));
  await new Promise(closeServer.bind(null, server));
}

function listen(server, resolve, reject) {
  server.once('error', reject);
  server.listen(4318, '127.0.0.1', resolve);
}

function closeServer(server, resolve) {
  server.close(resolve);
}

function waitForExit(child, resolve) {
  if (child.exitCode !== null || child.signalCode !== null) {
    resolve();
    return;
  }
  child.once('exit', resolve);
}

function delay(milliseconds) {
  return new Promise(schedule.bind(null, milliseconds));
}

function schedule(milliseconds, resolve) {
  setTimeout(resolve, milliseconds);
}

await main();
