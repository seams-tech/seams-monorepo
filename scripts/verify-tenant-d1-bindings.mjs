#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readBackendLane } from './deployment-targets.mjs';
import { walletRuntimeWorkerNameFor } from '../packages/wallet-console-server-ts/scripts/render-d1-gateway-config.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} must be a UUID`);
  return value;
}

async function providerGet(accountId, apiToken, resourcePath) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${resourcePath}`,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${apiToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`Cloudflare read failed with HTTP ${response.status}`);
  let raw;
  try {
    raw = await response.json();
  } catch {
    throw new Error('Cloudflare response is not valid JSON');
  }
  const body = record(raw, 'Cloudflare response');
  if (body.success !== true) throw new Error('Cloudflare read did not succeed');
  return record(body.result, 'Cloudflare result');
}

async function readDeployment(accountId, apiToken, workerName) {
  const result = await providerGet(
    accountId,
    apiToken,
    `${encodeURIComponent(workerName)}/deployments`,
  );
  if (!Array.isArray(result.deployments) || result.deployments.length === 0) {
    throw new Error(`${workerName} has no serving deployment`);
  }
  // Cloudflare returns the currently serving deployment first, including gradual rollout versions.
  const deployment = record(result.deployments[0], 'serving deployment');
  const deploymentId = uuid(deployment.id, 'deployment ID');
  if (
    deployment.strategy !== 'percentage' ||
    !Array.isArray(deployment.versions) ||
    deployment.versions.length === 0
  ) {
    throw new Error(`${workerName} has an unsupported deployment strategy`);
  }
  const versions = [];
  const seen = new Set();
  let total = 0;
  for (const raw of deployment.versions) {
    const version = record(raw, 'deployment version');
    const versionId = uuid(version.version_id, 'version ID');
    const percentage = version.percentage;
    if (
      seen.has(versionId) ||
      typeof percentage !== 'number' ||
      !Number.isFinite(percentage) ||
      percentage <= 0 ||
      percentage > 100
    ) {
      throw new Error(`${workerName} has invalid serving version weights`);
    }
    seen.add(versionId);
    total += percentage;
    versions.push({ versionId, percentage });
  }
  if (Math.abs(total - 100) > 0.000001)
    throw new Error(`${workerName} serving percentages do not total 100`);
  versions.sort(compareVersions);
  return { workerName, deploymentId, versions };
}

function compareVersions(left, right) {
  return left.versionId < right.versionId ? -1 : left.versionId > right.versionId ? 1 : 0;
}

async function readSignerBinding(accountId, apiToken, workerName, versionId) {
  const result = await providerGet(
    accountId,
    apiToken,
    `${encodeURIComponent(workerName)}/versions/${versionId}`,
  );
  if (result.id !== versionId) throw new Error(`${workerName} returned another version`);
  const resources = record(result.resources, 'version resources');
  if (!Array.isArray(resources.bindings))
    throw new Error(`${workerName} version bindings are unavailable`);
  let signer = null;
  for (const raw of resources.bindings) {
    const binding = record(raw, 'version binding');
    if (binding.name !== 'SIGNER_DB') continue;
    if (signer !== null || binding.type !== 'd1')
      throw new Error(`${workerName} has an ambiguous SIGNER_DB binding`);
    signer = uuid(binding.id, 'SIGNER_DB ID');
  }
  if (signer === null) throw new Error(`${workerName} version is missing SIGNER_DB`);
  return signer;
}

async function inspectBindings(lane, accountId, apiToken) {
  if (lane.provisioning.kind !== 'provisioned') throw new Error('Lane is not provisioned');
  const deployment = lane.provisioning.gatewayDeploymentConfig;
  const databaseId = uuid(deployment.resources.signerD1.id, 'configured signer D1 ID');
  const gateway = lane.resources.gateway.workerName;
  const workers = [gateway, walletRuntimeWorkerNameFor(gateway)];
  const before = [];
  for (const worker of workers) before.push(await readDeployment(accountId, apiToken, worker));
  const checked = [];
  for (const worker of before) {
    const versions = [];
    for (const version of worker.versions) {
      const boundDatabaseId = await readSignerBinding(
        accountId,
        apiToken,
        worker.workerName,
        version.versionId,
      );
      if (boundDatabaseId !== databaseId)
        throw new Error(
          `${worker.workerName} version ${version.versionId} SIGNER_DB disagrees with the configured home`,
        );
      versions.push({
        versionId: version.versionId,
        percentage: version.percentage,
        databaseId: boundDatabaseId,
      });
    }
    checked.push({ workerName: worker.workerName, deploymentId: worker.deploymentId, versions });
  }
  for (const worker of before) {
    const after = await readDeployment(accountId, apiToken, worker.workerName);
    if (JSON.stringify(after) !== JSON.stringify(worker)) {
      throw new Error(
        `${worker.workerName} deployment changed during verification; repeat against a stable deployment`,
      );
    }
  }
  return {
    kind: 'tenant_d1_provider_binding_checkpoint_v1',
    status: 'provider_bindings_match',
    deploymentLane: lane.id,
    home: { namespace: deployment.tenant.namespace, accountId, databaseId },
    checkedAt: new Date().toISOString(),
    workers: checked,
    runtimeChallengeVerified: false,
    activationAuthorized: false,
  };
}

async function main() {
  const { values } = parseArgs({
    options: { lane: { type: 'string' }, output: { type: 'string' } },
    strict: true,
  });
  if (!values.lane || !values.output) throw new Error('--lane and --output are required');
  const lane = readBackendLane(values.lane);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
  if (!/^[a-f0-9]{32}$/u.test(accountId) || !apiToken.trim())
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  // Reserve the output before any network read so a failed rerun cannot leave an old success artifact.
  const output = path.resolve(values.output);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ status: 'checking', deploymentLane: lane.id })}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    const result = await inspectBindings(lane, accountId, apiToken);
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`Provider SIGNER_DB bindings match: ${output}\n`);
  } catch (error) {
    writeFileSync(
      output,
      `${JSON.stringify({ kind: 'tenant_d1_provider_binding_checkpoint_v1', status: 'failed', deploymentLane: lane.id, checkedAt: new Date().toISOString(), message: error instanceof Error ? error.message : 'Provider verification failed', runtimeChallengeVerified: false, activationAuthorized: false }, null, 2)}\n`,
    );
    throw error;
  }
}

function fail(error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Provider verification failed'}\n`,
  );
  process.exitCode = 1;
}

main().catch(fail);
