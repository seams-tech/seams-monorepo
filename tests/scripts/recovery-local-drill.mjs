import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, '.local', `recovery-drill-${Date.now()}`);
const input = path.join(directory, 'backup');
const state = path.join(directory, 'destination');
const cliHome = path.join(directory, 'cli-home');
const cli = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'crates/seams-cli/target/release/seams-wallet');
const fixtureWriter = path.join(root, 'crates/seams-cli/target/debug/examples/local_restore_drill');
const caddy = path.join(homedir(), 'Library/Application Support/Caddy');
const ca = readFileSync(path.join(caddy, 'pki/authorities/local/root.crt'));
let destination;
let backendPort;
let lostResponse = false;
let service;
let proxy;

function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, ...options, env: { ...process.env, ...options.env, HOME: command === cli ? cliHome : process.env.HOME } });
  return new Promise(waitForCommand.bind(null, child));
}

function waitForCommand(child, resolve, reject) {
  const output = { text: '' };
  child.stdout?.on('data', appendOutput.bind(null, output));
  child.stderr?.on('data', appendOutput.bind(null, output));
  child.once('error', reject);
  child.once('exit', finishCommand.bind(null, output, resolve));
}
function appendOutput(output, chunk) {
  output.text += chunk;
}
function finishCommand(output, resolve, code) {
  resolve({ code, output: output.text });
}

async function requestDestination(url, options) {
  return new Promise(sendRequest.bind(null, url, options));
}

function sendRequest(url, options, resolve, reject) {
  const request = https.request(url, { ...options, ca }, receiveResponse.bind(null, resolve));
  request.once('error', reject);
  request.end(options.body);
}
function receiveResponse(resolve, response) {
  const output = { text: '' };
  response.on('data', appendOutput.bind(null, output));
  response.once('end', finishResponse.bind(null, response, output, resolve));
}
function finishResponse(response, output, resolve) {
  resolve({ status: response.statusCode, body: output.text });
}

function findPort(resolve, reject) {
  const socket = net.createServer();
  socket.once('error', reject);
  socket.once('listening', releasePort.bind(null, socket, resolve));
  socket.listen(0, '127.0.0.1');
}
function releasePort(socket, resolve) {
  const port = socket.address().port;
  socket.close(resolve.bind(null, port));
}

async function forward(request, response) {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const result = await requestDestination(`https://localhost:${backendPort}${request.url}`, {
      method: request.method,
      headers: request.headers,
      body,
    });
    if (
      !lostResponse &&
      request.url.endsWith('/restore/import') &&
      JSON.parse(body).role === 'deriver_b' &&
      result.status === 200
    ) {
      lostResponse = true;
      response.destroy();
      return;
    }
    response.writeHead(result.status, { 'content-type': 'application/json' });
    response.end(result.body);
  } catch (error) {
    response.writeHead(502);
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function invoke(args, expected = 0) {
  const credential = openSync(path.join(state, 'bootstrap.secret'), 'r');
  const result = await run(cli, ['derivation-root', ...args, '--bootstrap-fd', '3'], {
    cwd: input,
    stdio: ['ignore', 'pipe', 'pipe', credential],
  });
  closeSync(credential);
  if (expected === 0) assert.equal(result.code, 0, result.output);
  else assert.notEqual(result.code, 0, 'Expected a lost-response failure');
  console.log(result.output.trim());
  return result;
}

async function startService() {
  const commands = path.join(state, 'commands.txt');
  const previousWrite = existsSync(commands) ? statSync(commands).mtimeMs : -1;
  const log = openSync(path.join(directory, 'server.log'), 'w', 0o600);
  service = spawn(
    process.execPath,
    [
      path.join(root, 'scripts/local-wallet/recovery-local.mjs'),
      '--manifest',
      path.join(input, 'manifest.json'),
      '--state-dir',
      state,
      '--cli',
      cli,
      '--port',
      String(backendPort),
      '--trust-bundle',
      path.join(
        root,
        'crates/router-ab-core/tests/fixtures/tenant-root-recovery/trust-bundle.json',
      ),
    ],
    { cwd: root, stdio: ['ignore', log, log] },
  );
  closeSync(log);
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    if (service.exitCode !== null)
      throw new Error(readFileSync(path.join(directory, 'server.log'), 'utf8'));
    // Commands are refreshed after migrations and destination access checks succeed.
    if (existsSync(commands) && statSync(commands).mtimeMs > previousWrite) return;
    await delay(1000);
  }
  throw new Error('Local recovery startup timed out');
}

async function stopService() {
  if (service && service.exitCode === null) {
    const stopped = new Promise(waitForExit);
    service.kill('SIGTERM');
    await stopped;
  }
}

async function main() {
  mkdirSync(directory, { mode: 0o700 });
  backendPort = await new Promise(findPort);
  const proxyPort = await new Promise(findPort);
  destination = `https://localhost:${proxyPort}`;
  assert.equal(
    (
      await run(
        'cargo',
        [
          'build',
          '--quiet',
          '--manifest-path',
          'crates/seams-cli/Cargo.toml',
          '--example',
          'local_restore_drill',
        ],
        { stdio: 'ignore' },
      )
    ).code,
    0,
  );
  assert.equal((await run(fixtureWriter, ['prepare', input])).code, 0);
  await startService();
  const connected = await run(cli, ['derivation-root', 'trust', 'connect', '--console-url', `https://localhost:${backendPort}`, '--manifest', path.join(input, 'manifest.json')]);
  assert.equal(connected.code, 0, connected.output);
  proxy = https.createServer(
    {
      key: readFileSync(path.join(caddy, 'certificates/local/localhost/localhost.key')),
      cert: readFileSync(path.join(caddy, 'certificates/local/localhost/localhost.crt')),
    },
    forward,
  );
  proxy.listen(proxyPort, '127.0.0.1');
  await new Promise(listen);
  const connectedDestination = await run(cli, ['derivation-root', 'trust', 'connect', '--console-url', destination, '--manifest', path.join(input, 'manifest.json')]);
  assert.equal(connectedDestination.code, 0, connectedDestination.output);

  await invoke([
    'restore',
    '--destination',
    destination,
    '--role',
    'deriver-a',
    '--wrapping-key-file',
    './deriver-a-wrapper.key',
  ]);
  await invoke(
    [
      'restore',
      '--destination',
      destination,
      '--role',
      'deriver-b',
      '--wrapping-key-file',
      './deriver-b-wrapper.key',
    ],
    1,
  );
  assert(lostResponse, 'The server must accept the second import before the response is dropped');
  await invoke([
    'restore',
    '--destination',
    destination,
    '--role',
    'deriver-b',
    '--wrapping-key-file',
    './absent.key',
  ]);
  await invoke([
    'restore',
    'activate',
    '--destination',
    destination,
    '--session-file',
    './restore-session.json',
    '--acknowledge-offline-trust',
  ]);
  const session = JSON.parse(readFileSync(path.join(input, 'restore-session.json'), 'utf8'));
  const status = await requestDestination(
    `${destination}/console/tenant-root/security/restore/status`,
    { headers: { 'x-seams-restore-session': session.sessionToken } },
  );
  assert.equal(status.status, 200, status.body);
  const restored = JSON.parse(status.body).session;
  const manifest = JSON.parse(readFileSync(path.join(input, 'manifest.json'), 'utf8'));
  assert.equal(restored.status, 'active');
  assert.equal(restored.rootCommitmentB64u, manifest.descriptor.stableRootCommitment);
  for (const field of [
    'activationReceiptDigestB64u',
    'forwardRefreshReceiptDigestB64u',
    'continuityCanaryReceiptDigestB64u',
    'bootstrapDestructionReceiptDigestB64u',
  ])
    assert(restored[field], field);
  const consumed = await requestDestination(
    `${destination}/console/tenant-root/security/restore/bootstrap-session`,
    {
      method: 'POST',
      headers: {
        'x-seams-destination-bootstrap': readFileSync(path.join(state, 'bootstrap.secret'), 'utf8'),
      },
    },
  );
  assert.equal(consumed.status, 401, consumed.body);
  await stopService();
  await startService();
  await invoke([
    'restore',
    'activate',
    '--destination',
    destination,
    '--session-file',
    './restore-session.json',
  ]);
  writeFileSync(
    path.join(directory, 'result.json'),
    JSON.stringify(
      { result: 'passed', restored, lostFinalImportResponse: lostResponse, restarted: true },
      null,
      2,
    ),
  );
  console.log(
    `PASS: Real Workers restored the expected root, recovered a lost import response, destroyed bootstrap access, and survived restart. Evidence: ${directory}`,
  );
}

function listen(resolve, reject) {
  proxy.once('listening', resolve);
  proxy.once('error', reject);
}
async function cleanup() {
  proxy?.close();
  await stopService();
}
function waitForExit(resolve) {
  service.once('exit', resolve);
}
async function fail(error) {
  console.error(error);
  process.exitCode = 1;
}
main().catch(fail).finally(cleanup);
