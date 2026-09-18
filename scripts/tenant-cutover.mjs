#!/usr/bin/env node

import process from 'node:process';
import { readBackendLane } from './deployment-targets.mjs';

const OIDC_AUDIENCE = 'seams-tenant-cutover';
const CUTOVER_PATH = '/internal/tenant-deployment/v1/cutover';

function requireValue(args, index, flag) {
  const value = String(args[index + 1] || '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArguments(args) {
  const values = { lane: '', environmentId: '' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--lane') {
      values.lane = requireValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--environment-id') {
      values.environmentId = requireValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  if (!values.lane) throw new Error('--lane is required');
  if (!values.environmentId) throw new Error('--environment-id is required');
  return values;
}

async function requestGithubOidcToken() {
  const requestUrl = String(process.env.ACTIONS_ID_TOKEN_REQUEST_URL || '').trim();
  const requestToken = String(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || '').trim();
  if (!requestUrl || !requestToken) {
    throw new Error('tenant:cutover must run from the protected GitHub deployment workflow');
  }
  const url = new URL(requestUrl);
  url.searchParams.set('audience', OIDC_AUDIENCE);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${requestToken}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.value !== 'string' || !body.value) {
    throw new Error(`GitHub OIDC token request failed with HTTP ${response.status}`);
  }
  return body.value;
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const lane = readBackendLane(options.lane);
  if (lane.branch !== 'main') throw new Error('tenant cutover requires a production lane');
  const token = await requestGithubOidcToken();
  const response = await fetch(`${lane.console.origin}${CUTOVER_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      deploymentLane: lane.id,
      environmentId: options.environmentId,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw new Error(`Tenant cutover failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  process.stdout.write(`${JSON.stringify(body.result, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
