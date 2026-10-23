#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BRIDGE = path.join(ROOT, 'voiceId/browser/serve.mjs');
const ADDRESS = 'http://127.0.0.1:4318';
const WALLET_ORIGIN = 'http://localhost:4313';
const OUTPUT = path.join(ROOT, 'voiceId/engine/target/local-bridge-journey');

async function main() {
  await requireFreePort();
  await fs.mkdir(OUTPUT, { recursive: true });
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voiceid-bridge-'));
  const countFile = path.join(packageRoot, 'native-launches.txt');
  const cancelFile = path.join(packageRoot, 'native-cancellations.txt');
  await fs.mkdir(path.join(packageRoot, 'bin'));
  await fs.writeFile(path.join(packageRoot, 'native-inputs.json'), '{}\n');
  await fs.writeFile(path.join(packageRoot, 'bin/voiceid-host'), FAKE_HOST, { mode: 0o700 });
  const bridge = spawn(process.execPath, [BRIDGE, packageRoot], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VOICEID_FAKE_LAUNCHES: countFile,
      VOICEID_FAKE_CANCELLATIONS: cancelFile,
    },
  });
  try {
    await waitReady(bridge);
    const rejected = await request({ kind: 'status', id: randomUUID() }, 'https://example.com');
    assert.equal(rejected.status, 403);
    assert.equal(await launchCount(countFile), 0);

    const first = await request({ kind: 'status', id: randomUUID() }, WALLET_ORIGIN);
    const second = await request({ kind: 'status', id: randomUUID() }, WALLET_ORIGIN);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.replies[0].enrollment, 'ready');
    assert.equal(second.replies[0].enrollment, 'ready');
    assert.equal(await launchCount(countFile), 1);

    const binding = nextBinding();
    const approval = await request({ kind: 'listen', binding }, WALLET_ORIGIN);
    assert.deepEqual(approval.replies.map(replyKind), ['listening', 'result']);
    assert.equal(approval.replies[1].outcome, 'approved');
    assert.deepEqual(approval.replies[1].binding, binding);

    const activation = await request({
      kind: 'activate', binding: nextActivationBinding(),
    }, WALLET_ORIGIN);
    assert.deepEqual(activation.replies.map(replyKind), [
      'device_listening', 'activation_approved',
    ]);
    assert.equal(activation.replies[1].factorSecretB64u, 'A'.repeat(43));

    const unlock = await request({
      kind: 'unlock', binding: nextUnlockBinding(),
    }, WALLET_ORIGIN);
    assert.deepEqual(unlock.replies.map(replyKind), [
      'device_listening', 'unlock_approved',
    ]);
    assert.equal(unlock.replies[1].signatureB64u, 'D'.repeat(86));

    const invalidActivation = await request({
      kind: 'activate',
      binding: { ...nextActivationBinding(), walletId: 'invalid wallet' },
    }, WALLET_ORIGIN);
    assert.equal(invalidActivation.status, 400);

    const abortedBinding = nextBinding();
    const controller = new AbortController();
    const response = await fetch(`${ADDRESS}/voiceid`, {
      method: 'POST',
      headers: headers(WALLET_ORIGIN),
      body: JSON.stringify({ kind: 'listen', binding: abortedBinding }),
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const listening = await reader.read();
    assert.match(new TextDecoder().decode(listening.value), /"kind":"listening"/);
    controller.abort();
    await waitForCancellation(cancelFile);
    const afterCancel = await retryStatus();
    assert.equal(afterCancel.replies[0].enrollment, 'ready');
    assert.equal(await launchCount(countFile), 1);

    const switched = await request({ kind: 'status', id: randomUUID() }, 'https://localhost:4002');
    assert.equal(switched.status, 403);
    try {
      await request({ kind: 'status', id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }, WALLET_ORIGIN);
    } catch {}
    await waitStopped();
    const afterFailure = await request({ kind: 'status', id: randomUUID() }, WALLET_ORIGIN);
    assert.equal(afterFailure.status, 503);
    assert.equal(await launchCount(countFile), 1);
    const report = {
      schemaVersion: 'voiceid_local_bridge_journey_v1',
      status: 'passed',
      keychainAccess: 'none; fake native host',
      unauthorizedOriginRejectedBeforeLaunch: true,
      statusChecksAndApprovalsShareOneNativeProcess: true,
      voiceGatedActivationAndUnlockMessagesForwarded: true,
      invalidActivationRejectedBeforeNativeHost: true,
      abandonedCaptureCancelled: true,
      secondWalletOriginRejected: true,
      hostFailureDoesNotRestart: true,
      nativeLaunches: await launchCount(countFile),
    };
    await fs.writeFile(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`VoiceID local bridge journey passed: ${path.join(OUTPUT, 'report.json')}\n`);
  } finally {
    bridge.kill('SIGTERM');
    await new Promise(waitForExit.bind(null, bridge));
    await fs.rm(packageRoot, { recursive: true, force: true });
  }
}

function replyKind(reply) {
  return reply.kind;
}

function nextBinding() {
  return {
    attemptId: randomUUID(),
    operationHash: 'a'.repeat(64),
    expiresAtMs: Date.now() + 20_000,
  };
}

function nextActivationBinding() {
  return {
    attemptId: randomUUID(),
    walletId: 'wallet:test',
    walletAuthMethodId: 'wallet-auth-method:test',
    expiresAtMs: Date.now() + 20_000,
  };
}

function nextUnlockBinding() {
  return {
    attemptId: randomUUID(),
    walletId: 'wallet:test',
    walletAuthMethodId: 'wallet-auth-method:test',
    challenge: {
      kind: 'voiceid_wallet_session_challenge_v1',
      walletId: 'wallet:test',
      walletAuthMethodId: 'wallet-auth-method:test',
      walletAuthorityId: 'wallet-authority:test',
      deviceKeyId: 'C'.repeat(43),
      challengeId: 'wallet-session-mint:test',
      nonce: 'N'.repeat(43),
      requestOrigin: WALLET_ORIGIN,
      audience: 'https://localhost:4101',
      issuedAtMs: Date.now(),
      expiresAtMs: Date.now() + 20_000,
    },
  };
}

function headers(origin) {
  return {
    origin,
    'content-type': 'application/json',
    'x-voiceid-protocol': 'v1',
  };
}

async function request(message, origin) {
  const response = await fetch(`${ADDRESS}/voiceid`, {
    method: 'POST',
    headers: headers(origin),
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.text();
  return {
    status: response.status,
    replies: body.trim().startsWith('{') ? body.trim().split('\n').map(JSON.parse) : [],
  };
}

async function retryStatus() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await request({ kind: 'status', id: randomUUID() }, WALLET_ORIGIN);
    if (result.status === 200) return result;
    assert.equal(result.status, 409);
    await delay(20);
  }
  throw new Error('The abandoned native capture kept the local bridge busy.');
}

async function waitForCancellation(file) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if ((await fs.readFile(file, 'utf8')).includes('cancelled')) return;
    } catch {}
    await delay(20);
  }
  throw new Error('The native host did not receive cancellation.');
}

async function launchCount(file) {
  try {
    return (await fs.readFile(file, 'utf8')).trim().split('\n').length;
  } catch {
    return 0;
  }
}

async function waitReady(child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'The local bridge exited before startup.');
    try {
      const response = await fetch(`${ADDRESS}/readyz`);
      if (response.ok) return;
    } catch {}
    await delay(20);
  }
  throw new Error('The local bridge did not start.');
}

async function waitStopped() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${ADDRESS}/readyz`);
    if (response.status === 503) return;
    await delay(20);
  }
  throw new Error('The failed native host was restarted or remained ready.');
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

const FAKE_HOST = `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.VOICEID_FAKE_LAUNCHES, 'launched\\n');
let pending = Buffer.alloc(0);
let active = null;
process.stdin.on('data', read);

function read(chunk) {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32LE(0);
    if (pending.length < length + 4) return;
    const request = JSON.parse(pending.subarray(4, length + 4).toString('utf8'));
    pending = pending.subarray(length + 4);
    receive(request);
  }
}

function receive(request) {
  if (request.kind === 'status') {
    if (request.id === 'ffffffff-ffff-ffff-ffff-ffffffffffff') process.exit(1);
    send({ kind: 'status', id: request.id, enrollment: 'ready' });
    return;
  }
  if (request.kind === 'cancel') {
    if (request.id !== active?.attemptId) process.exit(1);
    fs.appendFileSync(process.env.VOICEID_FAKE_CANCELLATIONS, 'cancelled\\n');
    clearTimeout(active.timer);
    if (active.kind === 'listen') {
      send({ kind: 'result', binding: active.binding, outcome: 'failed' });
    } else {
      send({ kind: 'device_rejected', id: active.attemptId, outcome: 'cancelled' });
    }
    active = null;
    return;
  }
  if (request.kind === 'activate' || request.kind === 'unlock') {
    if (active) process.exit(1);
    send({ kind: 'device_listening', id: request.binding.attemptId });
    const timer = setTimeout(approve, 20);
    active = {
      kind: request.kind, attemptId: request.binding.attemptId,
      binding: request.binding, timer,
    };
    return;
  }
  if (request.kind !== 'listen' || active) process.exit(1);
  send({ kind: 'listening', binding: request.binding });
  const timer = setTimeout(approve, 500);
  active = { kind: 'listen', attemptId: request.binding.attemptId,
    binding: request.binding, timer };
}

function approve() {
  if (active.kind === 'activate') {
    send({ kind: 'activation_approved', id: active.attemptId,
      publicKeyB64u: 'B'.repeat(43), deviceKeyId: 'C'.repeat(43),
      factorSecretB64u: 'A'.repeat(43) });
  } else if (active.kind === 'unlock') {
    send({ kind: 'unlock_approved', id: active.attemptId,
      signatureB64u: 'D'.repeat(86), factorSecretB64u: 'A'.repeat(43) });
  } else {
    send({ kind: 'result', binding: active.binding, outcome: 'approved' });
  }
  active = null;
}

function send(message) {
  const bytes = Buffer.from(JSON.stringify(message));
  const frame = Buffer.alloc(4 + bytes.length);
  frame.writeUInt32LE(bytes.length, 0);
  bytes.copy(frame, 4);
  process.stdout.write(frame);
}
`;

await main();
