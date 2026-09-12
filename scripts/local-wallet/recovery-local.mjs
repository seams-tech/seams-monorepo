import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { getCACertificates } from 'node:tls';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Miniflare } from 'miniflare';
import {
  unstable_getMiniflareWorkerOptions,
  unstable_readConfig,
  unstable_splitSqlQuery,
} from 'wrangler';
import { prepareRouterAbD1LocalRuntimeConfig } from './d1-local-runtime-config.mjs';
import { prepareRouterAbStrictLocalRuntimeConfigs } from '@seams/wallet-server/local-runtime';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const caddyRoot = path.join(homedir(), 'Library/Application Support/Caddy');
let runtime;

function color(text, code) {
  if (!process.stdout.isTTY || 'NO_COLOR' in process.env || process.env.TERM === 'dumb')
    return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function digest(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function privateFile(file, value) {
  writeFileSync(file, value, { mode: 0o600, flag: 'wx' });
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function canonicalIdentity(identity) {
  const parts = [Buffer.from('seams/tenant-root-identity/v1')];
  for (const field of ['orgId', 'projectId', 'envId', 'signingRootId', 'signingRootVersion']) {
    const value = identity[field];
    if (typeof value !== 'string' || !value.length)
      throw new Error(`Missing manifest identity ${field}`);
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
}

function prepareDestination(directory, descriptor, manifestDigest) {
  const configPath = path.join(directory, 'destination.json');
  if (existsSync(configPath)) {
    const existing = JSON.parse(readFileSync(configPath, 'utf8'));
    if (existing.manifestDigest !== manifestDigest)
      throw new Error(
        'This destination belongs to a different backup. Choose another --state-dir.',
      );
    return existing;
  }
  const identityBytes = canonicalIdentity(descriptor.tenantRootIdentity);
  if (digest(identityBytes).toString('base64url') !== descriptor.tenantRootIdentityDigest) {
    throw new Error('Manifest identity digest does not match its identity');
  }
  const fingerprint = randomBytes(32);
  const lineage = randomBytes(16);
  const token = randomBytes(32);
  const destination = {
    manifestDigest,
    identity: descriptor.tenantRootIdentity,
    custodyLineageB64u: lineage.toString('base64url'),
    bootstrap: {
      identity_b64u: identityBytes.toString('base64url'),
      deployment_fingerprint_b64u: fingerprint.toString('base64url'),
      custody_lineage_b64u: lineage.toString('base64url'),
      token_digest_b64u: digest('seams/destination-bootstrap/v1', fingerprint, token).toString(
        'base64url',
      ),
    },
  };
  privateFile(path.join(directory, 'bootstrap.secret'), token.toString('base64url'));
  privateFile(configPath, JSON.stringify(destination, null, 2));
  return destination;
}

function runLogged(command, args, logPath) {
  const log = openSync(logPath, 'a', 0o600);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: ['ignore', log, log] });
  closeSync(log);
  if (result.status !== 0) throw new Error(`${command} failed. See ${logPath}`);
}

function ensureWorkers() {
  const manifest = JSON.parse(readFileSync(require.resolve('@seams/wallet-server/artifact-manifest.json'), 'utf8'));
  if (!manifest.workers['tenant-root-control-plane']) {
    throw new Error('Install a Wallet release containing the tenant-root control-plane Worker.');
  }
}

function workerOptions(configPath, secretPath) {
  const config = unstable_readConfig({ config: configPath });
  const resolved = unstable_getMiniflareWorkerOptions(config);
  const worker = {
    ...resolved.workerOptions,
    name: config.name,
    modules: true,
    scriptPath: resolved.main,
    modulesRules: [
      { type: 'ESModule', include: ['**/*.js', '**/*.mjs'] },
      { type: 'CompiledWasm', include: ['**/*.wasm'] },
    ],
  };
  if (secretPath) Object.assign(worker.bindings, dotenv.parse(readFileSync(secretPath)));
  const databases = [];
  for (const database of config.d1_databases) {
    databases.push({
      binding: database.binding,
      migrations_dir: path.resolve(path.dirname(configPath), database.migrations_dir),
    });
  }
  return { worker, databases };
}

async function migrateDatabases(workers) {
  for (const { worker, databases } of workers) {
    for (const binding of databases) {
      const database = await runtime.getD1Database(binding.binding, worker.name);
      await database
        .prepare('CREATE TABLE IF NOT EXISTS local_recovery_migrations (name TEXT PRIMARY KEY)')
        .run();
      const files = readdirSync(binding.migrations_dir).sort();
      for (const name of files) {
        if (!name.endsWith('.sql')) continue;
        if (
          await database
            .prepare('SELECT name FROM local_recovery_migrations WHERE name = ?')
            .bind(name)
            .first()
        )
          continue;
        const sql = readFileSync(path.join(binding.migrations_dir, name), 'utf8');
        const statements = [];
        for (const query of unstable_splitSqlQuery(sql)) statements.push(database.prepare(query));
        statements.push(
          database.prepare('INSERT INTO local_recovery_migrations (name) VALUES (?)').bind(name),
        );
        await database.batch(statements);
      }
    }
  }
}

async function shutdown() {
  await runtime?.dispose();
  process.exit(0);
}

function commands(cli, directory, backupFolder, port, styled = false) {
  const prefix = `${shellQuote(cli)} derivation-root`;
  const destination = `  --destination https://localhost:${port}`;
  const credential = `  --bootstrap-fd 3 \\\n  3<${shellQuote(path.join(directory, 'bootstrap.secret'))}`;
  const lines = [
    '# 1. Open a second terminal and enter your backup folder',
    `cd ${shellQuote(backupFolder)}`,
    '',
    '# 2. Restore Deriver A',
    '# Use the original A key. Change the key-file path if needed.',
    `${prefix} restore \\\n${destination} \\\n  --role deriver-a --wrapping-key-file ./deriver-a-wrapper.key \\\n${credential}`,
    '',
    '# 3. Restore Deriver B',
    '# Use the original B key.',
    `${prefix} restore \\\n${destination} \\\n  --role deriver-b --wrapping-key-file ./deriver-b-wrapper.key \\\n${credential}`,
    '',
    '# 4. Check both imports',
    `${prefix} restore status \\\n${destination} \\\n${credential}`,
    '',
    '# 5. Activate recovery once both imports are ready',
    `${prefix} restore activate \\\n${destination} \\\n  --session-file ${shellQuote(path.join(directory, 'activation-session.json'))} \\\n${credential}`,
    '',
    '# If activation requests offline-trust acknowledgement, review the message,',
    '# then repeat activation with --acknowledge-offline-trust.',
  ];
  if (styled) {
    for (let index = 0; index < lines.length; index++) {
      if (/^# \d\./.test(lines[index])) lines[index] = color(lines[index], '1;36');
    }
  }
  return lines.join('\n');
}

function configureConsoleAccess(envFile, destination, directory, port) {
  const configuration = JSON.stringify({
    identity: destination.identity,
    destination: `https://localhost:${port}`,
    credential: readFileSync(path.join(directory, 'bootstrap.secret'), 'utf8').trim(),
  });
  const source = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const lines = source
    .split('\n')
    .filter((line) => !line.startsWith('TENANT_ROOT_RESTORE_ACCESS_JSON='));
  lines.push(`TENANT_ROOT_RESTORE_ACCESS_JSON='${configuration}'`);
  writeFileSync(envFile, `${lines.join('\n')}\n`, { mode: 0o600 });
  chmodSync(envFile, 0o600);
}

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string' },
      'console-env-file': { type: 'string' },
      'state-dir': { type: 'string' },
      cli: { type: 'string' },
      'trust-bundle': { type: 'string' },
      port: { type: 'string', default: '4201' },
    },
  });
  if (!values.manifest)
    throw new Error('Usage: pnpm recovery:local --manifest /path/to/manifest.json');
  const manifestPath = path.resolve(values.manifest);
  const backupFolder = path.dirname(manifestPath);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  const manifestBytes = readFileSync(manifestPath);
  const cli = values.cli ? path.resolve(values.cli) : 'seams-wallet';
  const manifest = JSON.parse(manifestBytes);
  const manifestDigest = digest(manifestBytes).toString('hex');
  const directory = path.resolve(
    values['state-dir'] ??
      path.join(repoRoot, '.local/recovery-local', manifestDigest.slice(0, 16)),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  ensureWorkers(directory);
  const destination = prepareDestination(directory, manifest.descriptor, manifestDigest);
  const configDirectory = path.join(directory, 'config');
  const consoleConfig = prepareRouterAbD1LocalRuntimeConfig({
    repoRoot,
    outputConfigPath: path.join(configDirectory, 'console.toml'),
    localConsoleProjectId: destination.identity.projectId,
    localConsoleEnvironmentId: destination.identity.envId,
  });
  const strict = prepareRouterAbStrictLocalRuntimeConfigs({
    repoRoot,
    outputRoot: configDirectory,
    ceremonyJwksJson: consoleConfig.ceremonyJwksJson,
  });
  const consoleWorker = workerOptions(consoleConfig.outputConfigPath);
  consoleWorker.worker.outboundService = {
    network: {
      allow: ['public', 'private'],
      tlsOptions: { trustBrowserCas: true, trustedCertificates: getCACertificates('system') },
    },
  };
  consoleWorker.worker.bindings.TENANT_ROOT_RESTORE_DESTINATION_JSON = JSON.stringify({
    identity: destination.identity,
    custodyLineageB64u: destination.custodyLineageB64u,
  });
  const bundleDirectory = path.join(directory, 'console-bundle');
  console.log('Building the console API and starting isolated recovery Workers...');
  runLogged(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules/wrangler/bin/wrangler.js'),
      'deploy',
      '--dry-run',
      '--config',
      consoleConfig.outputConfigPath,
      '--outdir',
      bundleDirectory,
    ],
    path.join(directory, 'build.log'),
  );
  consoleWorker.worker.scriptPath = path.join(bundleDirectory, 'd1LocalDevWorker.js');
  const workers = [consoleWorker];
  for (const config of strict.configs) {
    const worker = workerOptions(config.configPath, config.secretPath);
    if (config.role === 'router')
      worker.worker.bindings.TENANT_ROOT_DESTINATION_BOOTSTRAP_JSON = JSON.stringify(
        destination.bootstrap,
      );
    if (values['trust-bundle'] && config.role === 'tenant-root-control-plane')
      worker.worker.bindings.TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON = readFileSync(
        path.resolve(values['trust-bundle']),
        'utf8',
      );
    workers.push(worker);
  }
  runtime = new Miniflare({
    host: '127.0.0.1',
    port,
    https: true,
    httpsKeyPath: path.join(caddyRoot, 'certificates/local/localhost/localhost.key'),
    httpsCertPath: path.join(caddyRoot, 'certificates/local/localhost/localhost.crt'),
    workers: workers.map(selectWorker),
    d1Persist: path.join(directory, 'storage/d1'),
    durableObjectsPersist: path.join(directory, 'storage/do'),
    r2Persist: path.join(directory, 'storage/r2'),
    kvPersist: path.join(directory, 'storage/kv'),
  });
  await runtime.ready;
  await migrateDatabases(workers);
  const router = await runtime.getWorker('router-ab-mpc-router');
  const bootstrapState = await router.fetch(
    'https://router-ab-mpc-router/router-ab/internal/tenant-root/destination-bootstrap/v1/read-auth',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-router-ab-internal-service-auth':
          consoleWorker.worker.bindings.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET,
      },
      body: JSON.stringify({
        kind: 'read',
        identity_b64u: destination.bootstrap.identity_b64u,
        custody_lineage_b64u: destination.custodyLineageB64u,
      }),
    },
  );
  if (!bootstrapState.ok)
    throw new Error(`Destination state check failed (${bootstrapState.status})`);
  const state = await bootstrapState.json();
  const restored =
    state.kind === 'read_refused' &&
    (state.reason === 'destroyed' || state.reason === 'active_root_present');
  if (!restored) {
    const status = await runtime.dispatchFetch(
      'https://localhost/console/tenant-root/security/restore/bootstrap-session',
      {
        method: 'POST',
        headers: {
          'x-seams-destination-bootstrap': readFileSync(
            path.join(directory, 'bootstrap.secret'),
            'utf8',
          ),
        },
      },
    );
    if (!status.ok)
      throw new Error(`Destination access check failed (${status.status}): ${await status.text()}`);
  }
  if (values['console-env-file']) {
    configureConsoleAccess(path.resolve(values['console-env-file']), destination, directory, port);
    console.log(
      'Recovery access configured. Continue from the dashboard’s Restore a deployment tab.',
    );
  }
  const instructions = commands(cli, directory, backupFolder, port);
  writeFileSync(path.join(directory, 'commands.txt'), instructions, { mode: 0o600 });
  if (restored) {
    console.log(
      `${color('\n✓ Restored destination restarted', '1;32')}\n\n  Destination  https://localhost:${port}\n\nYour restored root and saved state are intact. Keep this terminal running.`,
    );
  } else {
    console.log(
      `${color('\n✓ Local recovery destination is ready', '1;32')}\n\n  Destination  https://localhost:${port}\n  Project      ${destination.identity.projectId}\n  Environment  ${destination.identity.envId}\n\n${color('Keep this terminal running. Continue in a second terminal.', '1')}\nBootstrap access is supplied automatically. Use your original recovery keys.\n\n${commands(cli, directory, backupFolder, port, true)}\n\nCommands saved to:\n  ${path.join(directory, 'commands.txt')}\n`,
    );
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function selectWorker(value) {
  return value.worker;
}
async function fail(error) {
  console.error(`error: ${error.message}`);
  await runtime?.dispose();
  process.exit(1);
}

main().catch(fail);
