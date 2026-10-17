#!/usr/bin/env node

import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unstable_readConfig } from 'wrangler';

const bindingKeys = [
  'compatibility_date',
  'compatibility_flags',
  'vars',
  'durable_objects',
  'migrations',
  'services',
  'kv_namespaces',
  'r2_buckets',
  'triggers',
];

function readSecrets(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The protected Worker secrets file must contain a JSON object');
  }
  for (const [name, secret] of Object.entries(value)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || typeof secret !== 'string') {
      throw new Error('Worker secrets must have environment names and string values');
    }
  }
  return value;
}

function rejectUnsupportedBindings(source) {
  const unsupported = [
    'assets',
    'ai',
    'browser',
    'images',
    'stream',
    'media',
    'vectorize',
    'hyperdrive',
    'analytics_engine_datasets',
    'dispatch_namespaces',
    'mtls_certificates',
    'send_email',
    'pipelines',
    'secrets_store_secrets',
    'ratelimits',
    'vpc_services',
    'vpc_networks',
    'worker_loaders',
    'containers',
    'workflows',
    'queues',
    'unsafe',
    'wasm_modules',
    'text_blobs',
    'data_blobs',
  ];
  for (const key of unsupported) {
    const value = source[key];
    if (hasConfiguration(value)) throw new Error(`The Wallet renderer does not support ${key}`);
  }
}

function hasConfiguration(value) {
  if (value === undefined || value === null || value === false) return false;
  if (Array.isArray(value)) return value.length !== 0;
  if (typeof value === 'object') return Object.values(value).some(hasConfiguration);
  return true;
}

async function main() {
  const [configuration, secretsFile, outputArgument, environment, ...extra] = process.argv.slice(2);
  if (!configuration || !secretsFile || !outputArgument || extra.length) {
    throw new Error(
      'Usage: node render.mjs WRANGLER_CONFIG WORKER_SECRETS_JSON NEW_DIRECTORY [ENVIRONMENT]',
    );
  }
  const source = unstable_readConfig({ config: path.resolve(configuration), env: environment });
  if (!source.main || !source.name)
    throw new Error('The existing Worker configuration needs a name and main module');
  rejectUnsupportedBindings(source);
  const secrets = readSecrets(path.resolve(secretsFile));
  const output = path.resolve(outputArgument);
  mkdirSync(output, { mode: 0o700 });
  await build({
    entryPoints: [source.main],
    outfile: path.join(output, 'worker.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2024',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*', 'cloudflare:*'],
    loader: { '.wasm': 'copy' },
    define: source.define,
    alias: source.alias,
    tsconfig: source.tsconfig,
    sourcemap: false,
  });
  const config = { name: source.name, main: './worker.mjs', no_bundle: true };
  for (const key of bindingKeys) {
    if (source[key] !== undefined) config[key] = source[key];
  }
  config.vars = { ...source.vars, ...secrets };
  config.d1_databases = [];
  for (const database of source.d1_databases) {
    const migrations = path.join('migrations', database.binding);
    const input = path.resolve(
      path.dirname(source.configPath),
      database.migrations_dir || 'migrations',
    );
    cpSync(input, path.join(output, migrations), { recursive: true, errorOnExist: true });
    config.d1_databases.push({
      binding: database.binding,
      database_name: database.database_name,
      database_id: database.database_id,
      migrations_dir: migrations,
    });
  }
  writeFileSync(path.join(output, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(`Prepared ${source.name}: ${path.join(output, 'wrangler.json')}`);
}

await main();
