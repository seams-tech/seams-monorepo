import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
const observer = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
  const config = {
    name: 'tenant-root-restore-observer',
    main: 'restore-observer.mjs',
    compatibility_date: '2026-06-12',
    services: [],
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
    if (role === 'router') worker.vars.TENANT_ROOT_RETIREMENT_GRACE_MS = '1000';
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
  fetch(input, options) {
    return fetch(address + '/' + this.role + new URL(input).pathname, options);
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
    return new Worker(role);
  },
  getR2Bucket(binding, role) {
    assert.equal(binding, 'TENANT_ROOT_MANAGED_BACKUP_BUCKET');
    return new Bucket(role);
  },
};
const databases = { deriverA: new Database('deriver-a'), deriverB: new Database('deriver-b') };

async function run() {
  const fixture = await read('restore-fixture.json');
  const { tenantRoot } = await scenarios.testTenantRootCreationOperatingPath(
    topology,
    fixture,
    databases,
  );
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
  await save('restore-result.json', result);
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
    durableRestoreOutcomePreserved: true,
    ownershipRecovery: { refusals, elapsedMs },
    epochs,
    retirement: ['superseded', 'superseded'],
  });
}

switch (action) {
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
