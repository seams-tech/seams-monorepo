#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const PUBLIC_REPOSITORY = 'seams-tech/seams-wallet';

main(process.argv.slice(2));

function main(args) {
  const options = parseArguments(args);
  requireEmptyOutputDirectory(options.outputDirectory);
  requireCheckoutRevision(options.checkoutDirectory, options.revision);
  const sourceDirectory = path.join(options.checkoutDirectory, 'apps', 'docs', 'dist');
  assertFile(path.join(sourceDirectory, 'index.html'), 'Wallet docs entry');
  mkdirSync(options.outputDirectory, { recursive: true });
  cpSync(sourceDirectory, options.outputDirectory, { recursive: true });
  writeReceipt(options);
  process.stdout.write(`Staged Wallet docs from ${PUBLIC_REPOSITORY}@${options.revision}\n`);
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error(usage());
    values.set(name, value);
  }
  const revision = requiredOption(values, '--revision');
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error('--revision must be a full lowercase Git commit SHA');
  }
  return {
    checkoutDirectory: path.resolve(requiredOption(values, '--checkout')),
    revision,
    outputDirectory: path.resolve(requiredOption(values, '--output')),
  };
}

function requiredOption(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(usage());
  return value;
}

function usage() {
  return 'usage: prepare-wallet-docs-source.mjs --checkout <directory> --revision <full-sha> --output <directory>';
}

function requireCheckoutRevision(checkoutDirectory, revision) {
  const result = spawnSync('git', ['-C', checkoutDirectory, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  const actualRevision = result.stdout.trim();
  if (result.status !== 0 || actualRevision !== revision) {
    throw new Error(
      `Wallet docs checkout revision mismatch: expected ${revision}, received ${actualRevision || 'unknown'}`,
    );
  }
}

function requireEmptyOutputDirectory(outputDirectory) {
  if (!existsSync(outputDirectory)) return;
  if (readdirSync(outputDirectory).length !== 0) {
    throw new Error(`Wallet docs output directory must be empty: ${outputDirectory}`);
  }
}

function writeReceipt(options) {
  const receipt = {
    schemaVersion: 'seams_wallet_docs_source_v1',
    repository: PUBLIC_REPOSITORY,
    revision: options.revision,
  };
  writeFileSync(
    path.join(options.outputDirectory, 'seams-wallet-docs-artifact.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
}

function assertFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  readFileSync(filePath);
}
