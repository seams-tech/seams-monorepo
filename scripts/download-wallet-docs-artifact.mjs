#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const PUBLIC_REPOSITORY = 'seams-tech/seams-wallet';

main(process.argv.slice(2));

function main(args) {
  const options = parseArguments(args);
  requireEmptyOutputDirectory(options.outputDirectory);
  const artifact = resolveArtifact(options.revision);
  downloadArtifact(artifact, options.outputDirectory);
  assertFile(path.join(options.outputDirectory, 'index.html'), 'Wallet docs entry');
  writeReceipt(options, artifact);
  process.stdout.write(
    `Downloaded ${artifact.name} from ${PUBLIC_REPOSITORY} run ${String(artifact.workflow_run.id)}\n`,
  );
}

function parseArguments(args) {
  let revision = '';
  let outputDirectory = '';
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--revision') {
      revision = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--output') {
      outputDirectory = path.resolve(requireArgumentValue(args, index, argument));
      index += 1;
      continue;
    }
    throw new Error(usage());
  }
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error('--revision must be a full lowercase Git commit SHA');
  }
  if (!outputDirectory) throw new Error('--output is required');
  return { revision, outputDirectory };
}

function requireArgumentValue(args, index, name) {
  const value = String(args[index + 1] || '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function usage() {
  return 'usage: download-wallet-docs-artifact.mjs --revision <full-sha> --output <directory>';
}

function resolveArtifact(revision) {
  const name = `wallet-docs-${revision}`;
  const result = runGh([
    'api',
    '--method',
    'GET',
    `repos/${PUBLIC_REPOSITORY}/actions/artifacts`,
    '-f',
    `name=${name}`,
    '-f',
    'per_page=100',
  ]);
  const response = JSON.parse(result.stdout);
  if (!Array.isArray(response.artifacts)) {
    throw new Error('GitHub artifact response is missing artifacts');
  }
  const matches = response.artifacts.filter(
    (artifact) =>
      artifact.name === name &&
      artifact.expired === false &&
      artifact.workflow_run?.head_sha === revision,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one unexpired ${name} artifact for revision ${revision}; found ${String(matches.length)}`,
    );
  }
  return matches[0];
}

function downloadArtifact(artifact, outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  runGh([
    'run',
    'download',
    String(artifact.workflow_run.id),
    '--repo',
    PUBLIC_REPOSITORY,
    '--name',
    artifact.name,
    '--dir',
    outputDirectory,
  ]);
}

function requireEmptyOutputDirectory(outputDirectory) {
  if (!existsSync(outputDirectory)) return;
  if (readdirSync(outputDirectory).length !== 0) {
    throw new Error(`Wallet docs output directory must be empty: ${outputDirectory}`);
  }
}

function writeReceipt(options, artifact) {
  const receipt = {
    schemaVersion: 'seams_wallet_docs_artifact_v1',
    repository: PUBLIC_REPOSITORY,
    revision: options.revision,
    artifactId: artifact.id,
    artifactName: artifact.name,
    workflowRunId: artifact.workflow_run.id,
    createdAt: artifact.created_at,
  };
  writeFileSync(
    path.join(options.outputDirectory, 'seams-wallet-docs-artifact.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
}

function runGh(args) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `gh ${args.join(' ')} failed: ${String(result.stderr || result.stdout).trim()}`,
    );
  }
  return result;
}

function assertFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  readFileSync(filePath);
}
