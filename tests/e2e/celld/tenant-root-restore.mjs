import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const [action, directory, checkout, address] = process.argv.slice(2);
assert.equal(
  process.argv.length,
  6,
  'Usage: tenant-root-restore.mjs ACTION DIRECTORY WALLET_CHECKOUT ADDRESS',
);
const scenarios = await import(
  pathToFileURL(path.join(checkout, 'crates/router-ab-cloudflare/scripts/test-private-d1.mjs'))
);
let walletAddresses;
let backupFaultPending = action === 'run';
const observer = `let signingPrepare = null;
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/held-signing-replay') {
      const gate = await fetch(url.searchParams.get('gate'));
      if (!gate.ok) throw new Error('Signing replay gate failed');
      url.pathname = '/router-ab/ecdsa-derivation/sign';
      url.search = '';
      return env.ROUTER.fetch(new Request(url, request));
    }
    if (url.pathname === '/addresses') return Response.json({
      router: env.ROUTER_WALLET.newUniqueId().toString(),
      deriver_a: env.DERIVER_A_WALLET.newUniqueId().toString(),
      deriver_b: env.DERIVER_B_WALLET.newUniqueId().toString(),
      signing_worker: env.SIGNING_WORKER_WALLET.newUniqueId().toString()
    });
    if (url.pathname === '/captured-signing-prepare') return Response.json(signingPrepare);
    if (url.pathname.startsWith('/router-ab/signing-worker/')) {
      if (url.pathname.endsWith('/sign/prepare')) {
        signingPrepare = { body: await request.clone().json(), headers: [...request.headers] };
      }
      return env.SIGNING_WORKER.fetch(request);
    }
    if (url.pathname === '/database') {
      const { binding, sql, values, method } = await request.json();
      const statement = env[binding].prepare(sql).bind(...values);
      return Response.json(await statement[method]());
    }
    if (url.pathname === '/bucket') {
      const { binding } = await request.json();
      return Response.json(await env[binding].list());
    }
    const role = url.pathname.split('/')[1];
    url.pathname = url.pathname.slice(role.length + 1);
    return env[role.toUpperCase().replaceAll('-', '_')].fetch(new Request(url, request));
  }
};
`;

function bindingName(role) {
  return role.toUpperCase().replaceAll('-', '_');
}

async function save(name, value) {
  await writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
}

async function read(name) {
  return JSON.parse(await readFile(path.join(directory, name), 'utf8'));
}

async function prepare() {
  const fixture = scenarios.loadFixture();
  const signer = scenarios.configureRouterJwt(fixture);
  await save('router-signer.json', {
    keyId: signer.keyId,
    privateKey: signer.privateKey.export({ format: 'jwk' }),
  });
  const config = {
    name: 'tenant-root-restore-observer',
    main: 'restore-observer.mjs',
    compatibility_date: '2026-06-12',
    services: [],
    durable_objects: { bindings: [] },
    d1_databases: [],
    r2_buckets: [],
  };
  for (const role of [
    'router',
    'deriver-a',
    'deriver-b',
    'signing-worker',
    'tenant-root-control-plane',
  ]) {
    const worker = await read(role + '.json');
    Object.assign(worker.vars, fixture[role.replaceAll('-', '_') + '_env']);
    if (role === 'router') {
      worker.vars.TENANT_ROOT_RETIREMENT_GRACE_MS = '1000';
      worker.vars.ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET =
        'private-d1-router-signing-worker-ecdsa-auth';
      for (const service of worker.services) {
        if (service.binding === 'SIGNING_WORKER') service.service = config.name;
      }
    }
    if (role === 'signing-worker') {
      worker.vars.ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET =
        'private-d1-router-signing-worker-ecdsa-auth';
      worker.vars.ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET =
        'private-d1-gateway-signing-worker-presign-auth';
    }
    for (const binding of worker.durable_objects?.bindings ?? []) {
      if (binding.name === bindingName(role) + '_WALLET_DO') {
        config.durable_objects.bindings.push({
          name: bindingName(role) + '_WALLET',
          class_name: binding.class_name,
          script_name: worker.name,
        });
      }
    }
    await save(role + '.json', worker);
    config.services.push({ binding: bindingName(role), service: worker.name });
    for (const database of worker.d1_databases ?? []) {
      config.d1_databases.push({ ...database, binding: bindingName(role) + '_DB' });
    }
    for (const bucket of worker.r2_buckets ?? []) {
      config.r2_buckets.push({ ...bucket, binding: bindingName(role) + '_BACKUP' });
    }
  }
  await save('restore-fixture.json', fixture);
  await save('restore-observer.json', config);
  await writeFile(path.join(directory, 'restore-observer.mjs'), observer);
}

function post(route, body) {
  return fetch(address + route, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': 'private-d1-integration-auth',
    },
    body: JSON.stringify(body),
  });
}

async function inspect(route, body) {
  const response = await post(route, body);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

class Statement {
  constructor(binding, sql, values = []) {
    this.binding = bindingName(binding);
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new Statement(this.binding, this.sql, values);
  }
  all() {
    return this.execute('all');
  }
  run() {
    return this.execute('run');
  }
  execute(method) {
    return inspect('/database', {
      binding: this.binding + '_DB',
      sql: this.sql,
      values: this.values,
      method,
    });
  }
}

class Database {
  constructor(binding) {
    this.binding = bindingName(binding);
  }
  prepare(sql) {
    return new Statement(this.binding, sql);
  }
}

class Worker {
  constructor(role) {
    this.role = role;
  }
  async fetch(input, options) {
    const headers = new Headers(options.headers);
    headers.set('x-seams-wallet-object-addresses', JSON.stringify(walletAddresses));
    const target = address + '/' + this.role + new URL(input).pathname;
    if (
      backupFaultPending &&
      this.role === 'router' &&
      new URL(input).pathname === '/router-ab/internal/tenant-root/restore/v1/execute'
    ) {
      backupFaultPending = false;
      await verifyUnavailableBackup(target, { ...options, headers });
    }
    return fetch(target, { ...options, headers });
  }
}

class Bucket {
  constructor(role) {
    this.role = role;
  }
  list() {
    return inspect('/bucket', { binding: bindingName(this.role) + '_BACKUP' });
  }
}

const topology = {
  getWorker(role) {
    return new Worker(role === 'fixture-signing-worker' ? 'signing-worker' : role);
  },
  getR2Bucket(binding, role) {
    assert.equal(binding, 'TENANT_ROOT_MANAGED_BACKUP_BUCKET');
    return new Bucket(role);
  },
};
const databases = { deriverA: new Database('deriver-a'), deriverB: new Database('deriver-b') };

function storageCommand(args) {
  const endpoint = new URL(process.env.S3_ENDPOINT);
  assert.equal(endpoint.hostname, '127.0.0.1', 'Fault injection requires the local emulator');
  return spawnSync('aws', ['--endpoint-url', endpoint.href, 's3api', ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function requireStorageSuccess(args) {
  const result = storageCommand(args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function rootMetadata(database) {
  return database
    .prepare(
      `SELECT tenant_identity_digest_hex, custody_lineage_b64u, tenant_root_share_epoch, lifecycle
       FROM tenant_root_role_shares
       ORDER BY tenant_identity_digest_hex, custody_lineage_b64u, tenant_root_share_epoch`,
    )
    .all();
}

async function verifyUnavailableBackup(target, options) {
  const aKeys = JSON.parse(
    requireStorageSuccess(['list-objects-v2', '--bucket', 'backup-deriver-a']),
  );
  const bKeys = JSON.parse(
    requireStorageSuccess(['list-objects-v2', '--bucket', 'backup-deriver-b']),
  );
  const aRead = [
    'get-object',
    '--bucket',
    'backup-deriver-a',
    '--key',
    aKeys.Contents[0].Key,
    '/dev/null',
  ];
  const bRead = [
    'get-object',
    '--bucket',
    'backup-deriver-b',
    '--key',
    bKeys.Contents[0].Key,
    '/dev/null',
  ];
  requireStorageSuccess(aRead);
  const before = await Promise.all([
    rootMetadata(databases.deriverA),
    rootMetadata(databases.deriverB),
  ]);
  requireStorageSuccess([
    'put-bucket-policy',
    '--bucket',
    'backup-deriver-a',
    '--policy',
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Deny',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::backup-deriver-a/*',
        },
      ],
    }),
  ]);
  try {
    const denied = storageCommand(aRead);
    assert.notEqual(denied.status, 0, 'The provider fault must deny an existing A backup');
    assert.match(denied.stderr, /403|Forbidden/);
    requireStorageSuccess(bRead);
    const response = await fetch(target, options);
    const body = await response.text();
    assert.equal(response.status, 500, body);
    const after = await Promise.all([
      rootMetadata(databases.deriverA),
      rootMetadata(databases.deriverB),
    ]);
    assert.deepEqual(
      after.map(rootRows),
      before.map(rootRows),
      'A denied backup must not advance role-share lifecycle',
    );
    await save('backup-refusal.json', {
      deniedRole: 'deriver-a',
      independentRoleReadable: 'deriver-b',
      providerReadStatus: 403,
      restoreStatus: response.status,
      restoreBody: body,
      roleShareMetadataUnchanged: true,
    });
  } finally {
    requireStorageSuccess(['delete-bucket-policy', '--bucket', 'backup-deriver-a']);
  }
  requireStorageSuccess(aRead);
}

function rootRows(result) {
  return result.results;
}

async function run() {
  const fixture = await read('restore-fixture.json');
  const { tenantRoot } = await scenarios.testTenantRootCreationOperatingPath(
    topology,
    fixture,
    databases,
  );
  walletAddresses = await inspect('/addresses', {});
  const signing = await signBeforeUpgrade(fixture, tenantRoot);
  const restored = await scenarios.testTenantRootManagedRestoreOperatingPath(
    topology,
    fixture,
    tenantRoot,
    databases,
  );
  const result = await scenarios.testTenantRootRefreshAfterManagedRestore(
    topology,
    tenantRoot,
    databases,
    restored,
  );
  await save('restore-replay.json', {
    tenantRoot,
    request: restored.restoreRequest,
    receipt: restored.refresh.activation_receipt_digest_b64u,
    revision: restored.refresh.lifecycle_revision,
  });
  await save('restore-result.json', { ...result, signing });
}

async function signBeforeUpgrade(fixture, tenantRoot) {
  const signer = await read('router-signer.json');
  const ecdsa = await scenarios.testEcdsaRegistrationAndActivation(topology, fixture, tenantRoot, {
    keyId: signer.keyId,
    privateKey: createPrivateKey({ key: signer.privateKey, format: 'jwk' }),
  });
  const signed = await scenarios.testEcdsaNormalSigning(topology, ecdsa, 'pool', false);
  const captured = await inspect('/captured-signing-prepare', {});
  assert.ok(captured?.body, 'SigningWorker prepare must be captured before upgrade');
  await save('signing-replay.json', { addresses: walletAddresses, signed, captured });
  return { signatureVerified: true, signatureSha256: signatureHash(signed.response) };
}

function signatureHash(signed) {
  return createHash('sha256')
    .update(Buffer.from(signed.signature65_b64u, 'base64url'))
    .digest('hex');
}

async function verifySigning() {
  const { addresses, signed, captured } = await read('signing-replay.json');
  walletAddresses = addresses;
  const router = new Worker('router');
  const options = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': 'private-d1-gateway-router-auth',
      'x-seams-wallet-home-region': 'US',
    },
    body: JSON.stringify(signed.finalizeRequest),
  };
  const response = await router.fetch(
    'https://fixture.test/router-ab/ecdsa-derivation/sign',
    options,
  );
  const text = await response.text();
  assert.equal(response.status, 200, text);
  assert.deepEqual(
    JSON.parse(text),
    signed.response,
    'Upgrade must preserve the exact stored signature',
  );
  const changed = structuredClone(signed.finalizeRequest);
  changed.client_signature_share32_b64u = Buffer.alloc(32, 0x66).toString('base64url');
  const rebound = await router.fetch('https://fixture.test/router-ab/ecdsa-derivation/sign', {
    ...options,
    body: JSON.stringify(changed),
  });
  const reboundBody = await rebound.text();
  assert.equal(rebound.ok, false, 'Consumed material must reject changed finalization input');
  assert.match(
    reboundBody,
    /ReplayedLocalRequest: SigningWorker ECDSA effect identity or authorization changed/,
  );
  const worker = new Worker('signing-worker');
  assert.ok(
    Date.now() < captured.body.request.expires_at_ms,
    'Consumed-material rejection must precede request expiry',
  );
  const consumed = await worker.fetch(
    'https://fixture.test/router-ab/signing-worker/ecdsa-derivation/sign/prepare',
    {
      method: 'POST',
      headers: captured.headers,
      body: JSON.stringify(captured.body),
    },
  );
  const consumedBody = await consumed.text();
  assert.equal(consumed.status, 409, consumedBody);
  assert.match(
    consumedBody,
    /ReplayedLocalRequest: SigningWorker ECDSA pool command used a stale revision/,
  );
  return {
    signatureSha256: signatureHash(signed.response),
    storedSignaturePreserved: true,
    changedFinalize: { status: rebound.status, body: reboundBody },
    consumedPrepare: { status: consumed.status, body: consumedBody },
  };
}

async function replayAfterTakeover(body) {
  const started = Date.now();
  const refusals = [];
  while (Date.now() - started < 60_000) {
    const response = await post('/router/router-ab/internal/tenant-root/restore/v1/execute', body);
    const text = await response.text();
    if (response.status === 200) {
      return { response: JSON.parse(text), refusals, elapsedMs: Date.now() - started };
    }
    assert.equal(response.status, 500, text);
    assert.match(text, /DurableObjectRoutingError.*owner is currently unreachable/);
    refusals.push({ status: response.status, body: text });
    await delay(250);
  }
  throw new Error('Restore object ownership did not recover: ' + JSON.stringify(refusals));
}

async function verifyState() {
  const previous = await read('restore-replay.json');
  const { response, refusals, elapsedMs } = await replayAfterTakeover(previous.request);
  assert.equal(response.activation_receipt_digest_b64u, previous.receipt);
  assert.equal(response.lifecycle_revision, previous.revision);
  assert.equal(response.retirement.deriver_a.kind, 'superseded');
  assert.equal(response.retirement.deriver_b.kind, 'superseded');
  const identity = Buffer.from(previous.tenantRoot.identity_digest_b64u, 'base64url').toString(
    'hex',
  );
  const epochs = {};
  for (const [role, database] of Object.entries(databases)) {
    const rows = await database
      .prepare(
        `SELECT tenant_root_share_epoch, lifecycle FROM tenant_root_role_shares
       WHERE tenant_identity_digest_hex = ? AND custody_lineage_b64u = ?
       ORDER BY tenant_root_share_epoch`,
      )
      .bind(identity, previous.tenantRoot.custody_lineage_b64u)
      .all();
    assert.deepEqual(rows.results, [
      { tenant_root_share_epoch: 2, lifecycle: 'retired' },
      { tenant_root_share_epoch: 3, lifecycle: 'active' },
    ]);
    epochs[role] = rows.results;
  }
  await save('state-result.json', {
    signing: await verifySigning(),
    durableRestoreOutcomePreserved: true,
    ownershipRecovery: { refusals, elapsedMs },
    epochs,
    retirement: ['superseded', 'superseded'],
  });
}

async function workerdControl() {
  const require = createRequire(path.join(checkout, 'package.json'));
  const { Miniflare } = require('miniflare');
  const workers = [];
  const configs = [];
  for (const role of [
    'restore-observer',
    'router',
    'deriver-a',
    'deriver-b',
    'signing-worker',
    'tenant-root-control-plane',
  ]) {
    const config = await read(role + '.json');
    configs.push(config);
    const worker = {
      name: config.name,
      modules: true,
      scriptPath: path.join(directory, config.main),
      modulesRoot: directory,
      compatibilityDate: config.compatibility_date,
      bindings: config.vars,
      modulesRules: [
        { type: 'ESModule', include: ['**/*.js', '**/*.mjs'] },
        { type: 'CompiledWasm', include: ['**/*.wasm'] },
      ],
      serviceBindings: {},
      d1Databases: {},
      r2Buckets: {},
      durableObjects: {},
    };
    for (const binding of config.services ?? [])
      worker.serviceBindings[binding.binding] = binding.service;
    for (const binding of config.d1_databases ?? [])
      worker.d1Databases[binding.binding] = binding.database_id;
    for (const binding of config.r2_buckets ?? [])
      worker.r2Buckets[binding.binding] = binding.bucket_name;
    for (const binding of config.durable_objects?.bindings ?? []) {
      worker.durableObjects[binding.name] = {
        className: binding.class_name,
        scriptName: binding.script_name ?? config.name,
        useSQLite: true,
      };
    }
    workers.push(worker);
  }
  const miniflare = new Miniflare({
    workers,
    host: '127.0.0.1',
    port: Number(new URL(address).port),
  });
  try {
    await miniflare.ready;
    for (const config of configs.slice(1)) {
      for (const database of config.d1_databases ?? []) {
        await scenarios.applyMigrations(
          miniflare,
          database.binding,
          config.name,
          path.join(directory, database.migrations_dir),
        );
      }
    }
    await run();
    await verifyState();
  } finally {
    await miniflare.dispose();
  }
}

switch (action) {
  case 'workerd':
    await workerdControl();
    break;
  case 'prepare':
    await prepare();
    break;
  case 'run':
    await run();
    break;
  case 'verify-state':
    await verifyState();
    break;
  default:
    throw new Error('Unknown action: ' + action);
}
