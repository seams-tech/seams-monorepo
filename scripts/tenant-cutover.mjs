#!/usr/bin/env node

import process from 'node:process';
import { readBackendLane } from './deployment-targets.mjs';
import { verifyTenantResourceChallenge } from './tenant-resource-challenge.mjs';

const OIDC_AUDIENCE = 'seams-tenant-cutover';

function requireValue(args, index, flag) {
  const value = String(args[index + 1] || '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArguments(args) {
  const operation = args[0] === 'verify-resource' ? args[0] : 'provision';
  const values = {
    lane: '',
    environmentId: '',
  };
  for (let index = operation === 'provision' ? 0 : 1; index < args.length; index += 1) {
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
  if (operation === 'verify-resource') {
    if (values.environmentId) throw new Error('verify-resource accepts only --lane');
    return { kind: 'verify_resource', lane: values.lane };
  }
  if (!values.environmentId) throw new Error('provisioning requires --environment-id');
  return {
    kind: 'cutover',
    lane: values.lane,
    path: '/internal/tenant-deployment/v1/cutover',
    body: { deploymentLane: values.lane, environmentId: values.environmentId },
  };
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
  if (options.kind === 'verify_resource') {
    const result = await verifyTenantResourceChallenge(lane, token);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const resourceCheckpoint = await verifyTenantResourceChallenge(lane, token);
  const response = await fetch(`${lane.console.origin}${options.path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...options.body, resourceCheckpoint }),
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
