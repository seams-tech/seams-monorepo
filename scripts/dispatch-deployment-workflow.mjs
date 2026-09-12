#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { readBackendLane } from './deployment-targets.mjs';

const authority = String(process.argv[2] || '').trim();
const args = process.argv.slice(3).filter((argument) => argument !== '--');
const laneId = requireOption(args, '--lane');
const lane = readBackendLane(laneId);
const repository = readOption(args, '--repo') || 'seams-tech/seams-monorepo';
const ref = readOption(args, '--ref') || (lane.release === 'staging' ? 'dev' : 'main');
const workflow = resolveWorkflow(authority, laneId);

const command = ['workflow', 'run', workflow, '--repo', repository, '--ref', ref];
if (authority === 'console') command.push('-f', `lane=${laneId}`);
const child = spawnSync(process.env.GITHUB_CLI_BIN || 'gh', command, {
  encoding: 'utf8',
  stdio: 'inherit',
});
if (child.status !== 0) process.exit(child.status ?? 1);

function resolveWorkflow(selectedAuthority, selectedLaneId) {
  if (selectedAuthority === 'console') return 'deploy-console-backend.yml';
  if (selectedAuthority !== 'wallet-system') printUsageAndExit();
  return {
    'staging-testnet': 'deploy-staging-backend.yml',
    'production-testnet': 'deploy-production-testnet-backend.yml',
    'production-mainnet': 'deploy-production-mainnet-backend.yml',
  }[selectedLaneId];
}

function requireOption(argumentsList, name) {
  const value = readOption(argumentsList, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readOption(argumentsList, name) {
  const index = argumentsList.indexOf(name);
  if (index === -1) return undefined;
  const value = String(argumentsList[index + 1] || '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function printUsageAndExit() {
  process.stderr.write(
    'Usage: dispatch-deployment-workflow.mjs <console|wallet-system> --lane <lane> [--repo <owner/repo>] [--ref <branch>]\n',
  );
  process.exit(1);
}
