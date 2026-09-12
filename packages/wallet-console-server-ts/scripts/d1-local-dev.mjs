import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { getCACertificates } from 'node:tls';
import { unstable_startWorker } from 'wrangler';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  ensureFriendlyD1DatabasePaths,
  resolveD1LocalFriendlyRoot,
  resolveD1LocalPersistRoot,
} from './d1-local-friendly-paths.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export function resolveD1LocalDevEnvFiles(input = {}) {
  const env = input.env || process.env;
  if (env.SEAMS_D1_LOCAL_SKIP_ENV_FILE === '1') return [];
  const resolvedRepoRoot = input.repoRoot || repoRoot;
  const candidates = [path.join(resolvedRepoRoot, '.env.local')];
  const existing = [];
  for (const candidate of candidates) {
    if (existsSync(candidate)) existing.push(candidate);
  }
  return existing;
}

export function buildD1LocalDevWranglerArgs(input = {}) {
  const env = input.env || process.env;
  const config = env.SEAMS_D1_LOCAL_WRANGLER_CONFIG || 'wrangler.d1-local.toml';
  const persistTo = env.SEAMS_D1_LOCAL_PERSIST_TO || '.wrangler/state/seams-d1';
  const port = env.SEAMS_D1_LOCAL_PORT || '4100';
  const envFiles = input.envFiles || resolveD1LocalDevEnvFiles(input);
  const args = ['dev', '--config', config, '--persist-to', persistTo, '--port', port];
  for (const envFile of envFiles) {
    args.push('--env-file', envFile);
  }
  return { args, envFiles };
}

// Workerd has a separate trust store; import the OS roots for local HTTPS.
function systemCertificateEnvironment(env, root) {
  if (env.NODE_EXTRA_CA_CERTS) return env;
  const directory = path.join(root, '.runtime');
  mkdirSync(directory, { recursive: true });
  const certificates = path.join(directory, 'system-ca.pem');
  writeFileSync(certificates, getCACertificates('system').join('\n'));
  return { ...env, NODE_EXTRA_CA_CERTS: certificates };
}

export async function runD1LocalDev(input = {}) {
  const resolvedPackageRoot = input.packageRoot || packageRoot;
  const env = systemCertificateEnvironment(input.env || process.env, input.repoRoot || repoRoot);
  const linkedDatabases = ensureFriendlyD1DatabasePaths({
    packageRoot: resolvedPackageRoot,
    repoRoot: input.repoRoot || repoRoot,
    env,
    persistRoot: resolveD1LocalPersistRoot({
      packageRoot: resolvedPackageRoot,
      env,
    }),
    friendlyRoot: resolveD1LocalFriendlyRoot({
      repoRoot: input.repoRoot || repoRoot,
      env,
    }),
  });
  printFriendlyPaths(linkedDatabases);
  const { envFiles } = buildD1LocalDevWranglerArgs({
    ...input,
    packageRoot: resolvedPackageRoot,
  });
  if (envFiles.length === 0) {
    console.warn('[d1-local] No root .env.local file found; local secrets are not configured.');
  } else {
    printEnvFiles(envFiles);
  }
  const worker = await unstable_startWorker({
    config: path.resolve(
      resolvedPackageRoot,
      env.SEAMS_D1_LOCAL_WRANGLER_CONFIG || 'wrangler.d1-local.toml',
    ),
    envFiles,
    dev: {
      server: { hostname: '127.0.0.1', port: Number(env.SEAMS_D1_LOCAL_PORT || '4100') },
      persist: path.resolve(
        resolvedPackageRoot,
        env.SEAMS_D1_LOCAL_PERSIST_TO || '.wrangler/state/seams-d1',
      ),
      watch: true,
      registry: resolveDevRegistry(env),
      outboundService: {
        network: {
          allow: ['public', 'private'],
          tlsOptions: { trustBrowserCas: true, trustedCertificates: getCACertificates('system') },
        },
      },
    },
  });
  process.once('SIGINT', stopWorker.bind(null, worker));
  process.once('SIGTERM', stopWorker.bind(null, worker));
  await worker.ready;
  return worker;
}

async function stopWorker(worker) {
  await worker.dispose();
  process.exit(0);
}

function printFriendlyPaths(linkedDatabases) {
  for (const database of linkedDatabases) {
    console.log(`[d1-local] ${database.databaseName}: ${database.friendlyPath}`);
  }
}

function printEnvFiles(envFiles) {
  for (const envFile of envFiles) {
    console.log(`[d1-local] Loading local env file ${path.relative(repoRoot, envFile)}`);
  }
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  runD1LocalDev().catch(reportStartupError);
}

function reportStartupError(error) {
  console.error('[d1-local] Unable to start:', error.message);
  process.exitCode = 1;
}

function resolveDevRegistry(env) {
  if (env.WRANGLER_REGISTRY_PATH) return env.WRANGLER_REGISTRY_PATH;
  const legacy = path.join(homedir(), '.wrangler');
  if (existsSync(legacy)) return path.join(legacy, 'registry');
  const config =
    process.platform === 'darwin'
      ? path.join(homedir(), 'Library/Preferences')
      : env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(config, '.wrangler', 'registry');
}
