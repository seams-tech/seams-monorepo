#!/usr/bin/env node
import https from 'node:https';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const baseUrl = requiredEnvironment('SEAMS_INTENDED_ROUTER_URL');
const outputPath = requiredEnvironment('SEAMS_INTENDED_CONSOLE_FIXTURE_PATH');
const organizationId = requiredEnvironment('SEAMS_LOCAL_CONSOLE_ORG_ID');
const environmentId = requiredEnvironment('SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID');
let cookie = '';

await callConsole('/console/auth/google', {
  idToken: requiredEnvironment('SEAMS_INTENDED_GOOGLE_ID_TOKEN'),
});
const created = await callConsole('/console/account/organizations', {
  id: organizationId,
  name: 'Test organization',
});
if (created.organization)
  await callConsole(`/console/account/organizations/${organizationId}/switch-context`, {});
const project = await callConsole('/console/onboarding/project', {
  project: { id: 'local-smoke-project', name: 'Test project' },
});
const projectId = project.result.project.id;
await enableWallet(projectId);
const selectionHeaders = {
  'X-Console-Project-Id': projectId,
  'X-Console-Environment-Id': environmentId,
};
const environments = await callConsole(
  `/console/environments?projectId=${encodeURIComponent(projectId)}`,
  undefined,
  selectionHeaders,
);
if (!environments.environments.some(matchesActiveEnvironment)) {
  throw new Error('Wallet activation did not create the requested development environment');
}
const credential = await callConsole(
  '/console/api-keys',
  {
    kind: 'publishable_key',
    name: 'Test application',
    environmentId,
    allowedOrigins: [
      requiredEnvironment('SEAMS_INTENDED_APP_URL'),
      requiredEnvironment('SEAMS_INTENDED_WALLET_ORIGIN'),
    ],
    rateLimitBucket: 'default',
    quotaBucket: 'default',
  },
  selectionHeaders,
);
const current = await callConsole('/console/session');
writeFileSync(
  outputPath,
  JSON.stringify({
    userId: current.claims.userId,
    cookie,
    organizationId,
    projectId,
    environmentId,
    publishableKey: credential.secret,
  }),
  { mode: 0o600 },
);
console.log(
  '[intended-console] created account and project, enabled Wallet, and created its application key',
);

function matchesActiveEnvironment(environment) {
  return (
    environment.id === environmentId &&
    environment.projectId === projectId &&
    environment.status === 'ACTIVE'
  );
}

async function enableWallet(projectId) {
  const path = `/console/projects/${encodeURIComponent(projectId)}/services`;
  const initial = await callConsole(path);
  const existing = initial.instances.find(isWallet);
  if (existing?.state.kind === 'active') return;
  if (existing?.state.kind === 'archived')
    throw new Error('The isolated Wallet instance is archived');
  const operation =
    existing?.state.kind === 'provisioning'
      ? {
          operationId: existing.command.operationId,
          desiredRevision: existing.command.desiredRevision,
        }
      : {
          operationId: randomUUID(),
          desiredRevision: existing ? existing.command.desiredRevision + 1 : 1,
        };
  await callConsole(`${path}/wallet/enable`, operation);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const observed = await callConsole(path);
    const instance = observed.instances.find(isWallet);
    if (instance?.state.kind === 'active') return;
    if (instance?.state.kind === 'failed') throw new Error('Isolated Wallet provisioning failed');
    await setTimeout(1000);
  }
  throw new Error('Isolated Wallet provisioning did not finish');
}

function isWallet(instance) {
  return instance.serviceId === 'wallet';
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for isolated Console setup`);
  return value;
}

async function callConsole(path, body, headers = {}) {
  const response = await sendRequest(new URL(path, baseUrl), body, headers);
  const parsed = JSON.parse(response.body);
  if (response.status < 200 || response.status >= 300 || parsed.ok !== true) {
    throw new Error(
      `Console setup ${path} failed (${response.status}): ${parsed.code || 'invalid_response'}`,
    );
  }
  if (response.cookie) cookie = response.cookie;
  return parsed;
}

function sendRequest(url, body, headers) {
  return new Promise(sendRequestExecutor.bind(null, url, body, headers));
}

function sendRequestExecutor(url, body, headers, resolve, reject) {
  const encoded = body === undefined ? '' : JSON.stringify(body);
  const transport = url.protocol === 'https:' ? https : http;
  const request = transport.request(
    url,
    {
      method: body === undefined ? 'GET' : 'POST',
      rejectUnauthorized: false,
      timeout: 180_000,
      headers: {
        cookie,
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(encoded),
      },
    },
    readResponse.bind(null, resolve),
  );
  request.on('error', reject);
  request.on('timeout', destroyTimedOutRequest.bind(null, request));
  request.end(encoded);
}

function destroyTimedOutRequest(request) {
  request.destroy(new Error('Console setup timed out'));
}

function readResponse(resolve, response) {
  const chunks = [];
  response.on('data', chunks.push.bind(chunks));
  response.on('end', finishResponse.bind(null, resolve, response, chunks));
}

function finishResponse(resolve, response, chunks) {
  resolve({
    status: response.statusCode,
    body: Buffer.concat(chunks).toString('utf8'),
    cookie: response.headers['set-cookie']?.[0]?.split(';')[0] || '',
  });
}
