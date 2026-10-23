#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const [packageRoot, extra] = process.argv.slice(2);
assert(packageRoot && !extra && path.isAbsolute(packageRoot),
  'Usage: node enroll-web.mjs /absolute/voiceid-package');
const host = path.join(packageRoot, 'bin/voiceid-host');
const models = path.join(packageRoot, 'native-inputs.json');
const html = await readFile(path.join(source, 'enroll-web.html'), 'utf8');
const server = http.createServer(serve);
let origin = '';
let child = null;
let stdout = '';
let stderr = '';
let state = { kind: 'loading' };

server.listen(0, '127.0.0.1', start);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function start() {
  const address = server.address();
  assert(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
  process.stdout.write(`Open ${origin}/ to enroll your voice.\n`);
  startHost();
}

function startHost() {
  assert(child === null, 'A voice host is already running.');
  state = { kind: 'loading' };
  stdout = '';
  stderr = '';
  child = spawn(host, ['enroll', models], {
    cwd: packageRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', readHostOutput);
  child.stderr.on('data', readHostError);
  child.on('error', readProcessError);
  child.on('close', finishHost);
}

function readHostOutput(chunk) {
  stdout += chunk;
  if (stdout.length > 4096) {
    state = { kind: 'failed', message: 'The voice host sent too much output.' };
    child.kill();
    return;
  }
  let newline = stdout.indexOf('\n');
  while (newline >= 0) {
    const line = stdout.slice(0, newline).trim();
    stdout = stdout.slice(newline + 1);
    readHostLine(line);
    newline = stdout.indexOf('\n');
  }
}

function readHostLine(line) {
  const sample = /^Sample ([123])\/3:/.exec(line);
  if (sample) {
    state = { kind: 'ready', sample: Number(sample[1]) };
    return;
  }
  if (line === 'Listening…' && state.kind === 'starting') {
    state = { kind: 'listening', sample: state.sample };
    return;
  }
  if (line === 'Voice enrolled. Run check to try a spoken command.') {
    state = { kind: 'complete' };
  }
}

function readHostError(chunk) {
  stderr = `${stderr}${chunk}`.slice(-4096);
}

function readProcessError(error) {
  stderr = error.message;
}

function finishHost(code) {
  child = null;
  if (state.kind === 'complete' && code === 0) return;
  const error = /Error: "([^"]+)"/.exec(stderr);
  state = {
    kind: 'failed',
    message: error ? error[1] : 'The voice host stopped. Restart enrollment.',
  };
}

function serve(request, response) {
  if (request.headers.host !== new URL(origin).host) {
    respond(response, 403, 'text/plain; charset=utf-8', 'Invalid host');
    return;
  }
  if (request.method === 'GET' && request.url === '/') {
    const nonce = randomBytes(16).toString('base64');
    response.setHeader('Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    respond(response, 200, 'text/html; charset=utf-8', html.replaceAll('__NONCE__', nonce));
    return;
  }
  if (request.method === 'GET' && request.url === '/state') {
    respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(state));
    return;
  }
  if (request.method !== 'POST' || !['/capture', '/restart'].includes(request.url)) {
    respond(response, 404, 'text/plain; charset=utf-8', 'Unknown route');
    return;
  }
  if (
    request.headers.origin !== origin ||
    request.headers['x-voiceid-action'] !== 'enroll' ||
    Number(request.headers['content-length'] ?? '0') !== 0 ||
    request.headers['transfer-encoding']
  ) {
    respond(response, 403, 'text/plain; charset=utf-8', 'Request rejected');
    return;
  }
  request.resume();
  if (request.url === '/capture' && state.kind === 'ready' && child) {
    state = { kind: 'starting', sample: state.sample };
    child.stdin.write('\n');
    respond(response, 202, 'application/json; charset=utf-8', JSON.stringify(state));
    return;
  }
  if (request.url === '/restart' && state.kind === 'failed' && child === null) {
    startHost();
    respond(response, 202, 'application/json; charset=utf-8', JSON.stringify(state));
    return;
  }
  respond(response, 409, 'application/json; charset=utf-8', JSON.stringify(state));
}

function respond(response, status, contentType, body) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function stop() {
  if (child) child.kill('SIGTERM');
  server.close();
}
