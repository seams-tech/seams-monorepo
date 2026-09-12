#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { gatewaySecretNames, readBackendLane } from '../../../scripts/deployment-targets.mjs';

const OPTIONAL_SECRET_NAMES = ['RELAYER_PRIVATE_KEY', 'SPONSORED_EVM_EXECUTORS_JSON'];

function main() {
  const outputPath = readOutputPath(process.argv.slice(2));
  const laneId = readLaneId();
  const lane = readBackendLane(laneId);
  requireProvisionedLane(laneId, lane.provisioning);
  const secrets = readRequiredSecrets(gatewaySecretNames(lane));
  addOptionalSecrets(secrets);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(secrets)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  process.stdout.write(`${outputPath}\n`);
}

function readOutputPath(args) {
  let output = '';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output') {
      output = String(args[index + 1] || '').trim();
      index += 1;
      continue;
    }
    throw new Error('usage: write-wallet-system-secrets-file.mjs --output <path>');
  }
  if (!output) throw new Error('--output requires a value');
  return path.resolve(process.cwd(), output);
}

function readLaneId() {
  const lane = String(process.env.DEPLOYMENT_LANE || '').trim();
  if (!lane) throw new Error('DEPLOYMENT_LANE is required');
  return lane;
}

function requireProvisionedLane(laneId, provisioning) {
  if (provisioning.kind !== 'provisioned') {
    throw new Error(`lane ${laneId} is pending provisioning; Gateway secrets cannot be written`);
  }
}

function addOptionalSecrets(secrets) {
  for (const name of OPTIONAL_SECRET_NAMES) {
    const value = readEnvironmentValue(name);
    if (value) secrets[name] = value;
  }
}

function readRequiredSecrets(names) {
  const secrets = {};
  for (const name of names) {
    secrets[name] = requireEnvironmentValue(name);
  }
  return secrets;
}

function requireEnvironmentValue(name) {
  const value = readEnvironmentValue(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readEnvironmentValue(name) {
  return String(process.env[name] || '').trim();
}

main();
