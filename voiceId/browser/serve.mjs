#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const ORIGINS = new Set(['https://localhost:4002', 'http://localhost:4313']);
const ADDRESS = '127.0.0.1';
const PORT = 4318;
const MAXIMUM_MESSAGE_BYTES = 4096;
const [packageRoot, extra] = process.argv.slice(2);
assert(packageRoot && !extra && path.isAbsolute(packageRoot),
  'Usage: node serve.mjs /absolute/voiceid-package');
const binary = path.join(packageRoot, 'bin/voiceid-host');
const models = path.join(packageRoot, 'native-inputs.json');
let active = null;
let native = null;
let nativeOrigin = null;
let stopped = false;
const server = http.createServer(serve);
server.listen(PORT, ADDRESS, ready);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function ready() {
  process.stdout.write(`VoiceID local bridge ready at http://${ADDRESS}:${PORT}/readyz\n`);
}

function stop() {
  native?.child.kill('SIGTERM');
  server.close();
}

function serve(request, response) {
  void handle(request, response).catch(handleError.bind(null, response));
}

async function handle(request, response) {
  if (request.headers.host !== `${ADDRESS}:${PORT}`) {
    reply(response, 403, 'Invalid local host');
    return;
  }
  if (request.method === 'GET' && request.url === '/readyz') {
    reply(response, stopped ? 503 : 200, stopped ? 'VoiceID host stopped' : 'ready');
    return;
  }
  if (request.url !== '/voiceid' || !ORIGINS.has(request.headers.origin)) {
    reply(response, 403, 'Invalid Wallet origin');
    return;
  }
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
  response.setHeader('Access-Control-Allow-Private-Network', 'true');
  response.setHeader('Vary', 'Origin');
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, x-voiceid-protocol');
    reply(response, 204, '');
    return;
  }
  if (
    request.method !== 'POST' ||
    request.headers['x-voiceid-protocol'] !== 'v1' ||
    !request.headers['content-type']?.startsWith('application/json')
  ) {
    reply(response, 403, 'Invalid VoiceID request');
    return;
  }
  const body = await readBody(request);
  const message = parseRequest(body);
  if (!message) {
    reply(response, 400, 'Invalid VoiceID request');
    return;
  }
  if (stopped) {
    reply(response, 503, 'Restart the VoiceID local service');
    return;
  }
  if (active) {
    reply(response, 409, 'VoiceID is busy');
    return;
  }
  if (nativeOrigin && nativeOrigin !== request.headers.origin) {
    reply(response, 403, 'A different Wallet origin owns this VoiceID session');
    return;
  }
  response.writeHead(200, {
    'Access-Control-Allow-Origin': request.headers.origin,
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  });
  response.flushHeaders();
  if (!native) {
    nativeOrigin = request.headers.origin;
    native = new NativeHost(nativeOrigin);
  }
  active = new NativeExchange(message, response, native);
  active.start();
}

async function readBody(request) {
  let bytes = Buffer.alloc(0);
  for await (const chunk of request) {
    if (bytes.length + chunk.length > MAXIMUM_MESSAGE_BYTES) {
      throw new Error('VoiceID request exceeds its size limit');
    }
    bytes = Buffer.concat([bytes, chunk]);
  }
  return bytes;
}

function parseRequest(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind === 'status') {
    return exactKeys(value, ['kind', 'id']) && attempt(value.id) ? value : null;
  }
  if (value.kind === 'activate') {
    if (!exactKeys(value, ['kind', 'binding'])) return null;
    const binding = value.binding;
    if (!record(binding) || !exactKeys(binding, [
      'attemptId', 'walletId', 'walletAuthMethodId', 'expiresAtMs',
    ])) return null;
    const remaining = binding.expiresAtMs - Date.now();
    return attempt(binding.attemptId) && walletId(binding.walletId) &&
      methodId(binding.walletAuthMethodId) &&
      Number.isSafeInteger(binding.expiresAtMs) &&
      remaining >= 250 && remaining <= 60_000 ? value : null;
  }
  if (value.kind === 'unlock') {
    if (!exactKeys(value, ['kind', 'binding'])) return null;
    const binding = value.binding;
    if (!record(binding) || !exactKeys(binding, [
      'attemptId', 'walletId', 'walletAuthMethodId', 'challenge',
    ])) return null;
    if (!record(binding.challenge)) return null;
    const remaining = binding.challenge.expiresAtMs - Date.now();
    return attempt(binding.attemptId) && walletId(binding.walletId) &&
      methodId(binding.walletAuthMethodId) &&
      Number.isSafeInteger(binding.challenge.expiresAtMs) &&
      remaining >= 250 && remaining <= 60_000 ? value : null;
  }
  if (value.kind !== 'listen' || !exactKeys(value, ['kind', 'binding'])) return null;
  const binding = value.binding;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return null;
  if (!exactKeys(binding, ['attemptId', 'operationHash', 'expiresAtMs'])) return null;
  const remaining = binding.expiresAtMs - Date.now();
  if (
    !attempt(binding.attemptId) ||
    typeof binding.operationHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(binding.operationHash) ||
    !Number.isSafeInteger(binding.expiresAtMs) ||
    remaining < 250 ||
    remaining > 25_000
  ) return null;
  return value;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function walletId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    /^[\x21-\x7e]+$/.test(value);
}

function methodId(value) {
  return walletId(value) && value.startsWith('wallet-auth-method:');
}

function exactKeys(value, names) {
  const keys = Object.keys(value);
  return keys.length === names.length && names.every(hasKey.bind(null, value));
}

function hasKey(value, key) {
  return Object.hasOwn(value, key);
}

function attempt(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
}

class NativeHost {
  constructor(origin) {
    this.child = spawn(binary, ['bridge', models, 'com.seams.voiceid.prototype', origin], {
      cwd: packageRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pending = Buffer.alloc(0);
    this.errorTail = '';
    this.nativeError = 'unknown';
    this.readOutput = this.readOutput.bind(this);
    this.closed = this.closed.bind(this);
    this.processError = this.failed.bind(this, 'process_error');
    this.readError = this.readError.bind(this);
    this.child.stderr.on('data', this.readError);
    this.child.stdout.on('data', this.readOutput);
    this.child.stdin.on('error', this.processError);
    this.child.on('close', this.closed);
    this.child.on('error', this.processError);
  }

  send(message) {
    if (stopped) return;
    const bytes = Buffer.from(JSON.stringify(message));
    const framed = Buffer.alloc(4 + bytes.length);
    framed.writeUInt32LE(bytes.length, 0);
    bytes.copy(framed, 4);
    this.child.stdin.write(framed);
  }

  readOutput(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    if (this.pending.length > 2 * (MAXIMUM_MESSAGE_BYTES + 4)) {
      this.failed('buffer_limit');
      return;
    }
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32LE(0);
      if (length === 0 || length > MAXIMUM_MESSAGE_BYTES) {
        this.failed('invalid_frame');
        return;
      }
      if (this.pending.length < length + 4) return;
      const text = this.pending.subarray(4, length + 4).toString('utf8');
      this.pending = this.pending.subarray(length + 4);
      if (!active || !active.receive(text)) {
        this.failed('invalid_reply');
        return;
      }
    }
  }

  readError(chunk) {
    this.errorTail = (this.errorTail + chunk.toString('utf8')).slice(-4096);
    const match = this.errorTail.match(
      /VoiceID local bridge: (InvalidInput|InvalidHandle|Busy|Missing|Expired|Cancelled|Discontinuity|Failed|Conflict|NotReady|Stopped|Panicked|KeychainAccessRequired)\b/,
    );
    if (match) this.nativeError = match[1];
  }

  closed(code, signal) {
    this.failed('process_closed', code, signal);
  }

  failed(reason, code = null, signal = null) {
    if (stopped) return;
    stopped = true;
    process.stderr.write(`${JSON.stringify({
      kind: 'voiceid_native_host_stopped',
      reason,
      nativeError: this.nativeError,
      exitCode: Number.isInteger(code) ? code : null,
      signal: typeof signal === 'string' && /^SIG[A-Z0-9]{1,12}$/.test(signal) ? signal : null,
    })}\n`);
    this.errorTail = '';
    this.child.kill('SIGTERM');
    active?.fail(this.nativeError);
  }
}

class NativeExchange {
  constructor(request, response, host) {
    this.request = request;
    this.response = response;
    this.host = host;
    this.finished = false;
    this.cancelled = false;
    this.aborted = this.aborted.bind(this);
    response.on('close', this.aborted);
  }

  start() {
    this.host.send(this.request);
  }

  receive(text) {
    let reply;
    try {
      reply = JSON.parse(text);
    } catch {
      return false;
    }
    if (reply.kind === 'device_listening') {
      if (!['activate', 'unlock'].includes(this.request.kind) ||
          reply.id !== this.request.binding.attemptId) return false;
      if (!this.cancelled) this.response.write(`${text}\n`);
      return true;
    }
    if (reply.kind === 'listening') {
      if (this.request.kind !== 'listen' || !sameBinding(reply.binding, this.request.binding)) {
        return false;
      }
      if (!this.cancelled) this.response.write(`${text}\n`);
      return true;
    }
    if (reply.kind === 'activation_approved') {
      if (this.request.kind !== 'activate' ||
          reply.id !== this.request.binding.attemptId ||
          Date.now() >= this.request.binding.expiresAtMs ||
          !base64Url(reply.publicKeyB64u, 43) ||
          !base64Url(reply.deviceKeyId, 43) ||
          !base64Url(reply.factorSecretB64u, 43)) return false;
    } else if (reply.kind === 'unlock_approved') {
      if (this.request.kind !== 'unlock' ||
          reply.id !== this.request.binding.attemptId ||
          Date.now() >= this.request.binding.challenge.expiresAtMs ||
          !base64Url(reply.signatureB64u, 86) ||
          !base64Url(reply.factorSecretB64u, 43)) return false;
    } else if (reply.kind === 'device_rejected') {
      if (!['activate', 'unlock'].includes(this.request.kind) ||
          reply.id !== this.request.binding.attemptId ||
          !['cancelled', 'rejected'].includes(reply.outcome)) return false;
    } else if (reply.kind === 'status') {
      if (this.request.kind !== 'status' || reply.id !== this.request.id) return false;
      if (reply.enrollment !== 'ready' && reply.enrollment !== 'empty') return false;
    } else if (reply.kind === 'result') {
      if (this.request.kind !== 'listen' || !sameBinding(reply.binding, this.request.binding)) {
        return false;
      }
      if (!['approved', 'cancelled', 'rejected', 'failed'].includes(reply.outcome)) {
        return false;
      }
    } else {
      return false;
    }
    this.finished = true;
    active = null;
    if (!this.cancelled) this.response.end(`${text}\n`);
    return true;
  }

  aborted() {
    if (this.finished || this.cancelled) return;
    this.cancelled = true;
    const id = this.request.kind === 'status'
      ? this.request.id
      : this.request.binding.attemptId;
    this.host.send({ kind: 'cancel', id });
  }

  fail(nativeError) {
    if (this.finished) return;
    this.finished = true;
    active = null;
    if (!this.cancelled) {
      const reason = nativeError === 'KeychainAccessRequired'
        ? 'keychain_access_required'
        : 'native_host_stopped';
      this.response.end(`${JSON.stringify({ kind: 'service_failed', reason })}\n`);
    }
  }
}

function base64Url(value, length) {
  return typeof value === 'string' && value.length === length &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function sameBinding(left, right) {
  return left && right &&
    left.attemptId === right.attemptId &&
    left.operationHash === right.operationHash &&
    left.expiresAtMs === right.expiresAtMs;
}

function handleError(response, error) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const status = error.message === 'VoiceID request exceeds its size limit' ? 413 : 400;
  reply(response, status, 'Invalid VoiceID request');
}

function reply(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}
