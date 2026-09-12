#!/usr/bin/env node
import https from 'node:https';
import http from 'node:http';
import { writeFileSync } from 'node:fs';

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
  environment: { id: environmentId, name: 'Test environment' },
});
await callConsole('/console/auth/environment', {
  projectId: project.result.project.id,
  environmentId: project.result.environment.id,
});
const credential = await callConsole('/console/api-keys', {
  kind: 'publishable_key',
  name: 'Test application',
  environmentId: project.result.environment.id,
  allowedOrigins: [
    requiredEnvironment('SEAMS_INTENDED_APP_URL'),
    requiredEnvironment('SEAMS_INTENDED_WALLET_ORIGIN'),
  ],
  rateLimitBucket: 'default',
  quotaBucket: 'default',
});
const current = await callConsole('/console/session');
writeFileSync(
  outputPath,
  JSON.stringify({
    userId: current.claims.userId,
    cookie,
    organizationId,
    projectId: project.result.project.id,
    environmentId: project.result.environment.id,
    publishableKey: credential.secret,
  }),
  { mode: 0o600 },
);
console.log(
  '[intended-console] created organization, project, environment and key through Console APIs',
);

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for isolated Console setup`);
  return value;
}

async function callConsole(path, body) {
  const response = await sendRequest(new URL(path, baseUrl), body);
  const parsed = JSON.parse(response.body);
  if (response.status < 200 || response.status >= 300 || parsed.ok !== true) {
    throw new Error(
      `Console setup ${path} failed (${response.status}): ${parsed.code || 'invalid_response'}`,
    );
  }
  if (response.cookie) cookie = response.cookie;
  return parsed;
}

function sendRequest(url, body) {
  return new Promise(sendRequestExecutor.bind(null, url, body));
}

function sendRequestExecutor(url, body, resolve, reject) {
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
