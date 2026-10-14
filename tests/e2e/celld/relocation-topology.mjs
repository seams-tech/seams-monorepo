import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, open, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function jsonResponse(response) {
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

async function handleCallback(callbacks, topology, directory, request, response) {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const callback = callbacks.get(new URL(request.url, 'http://fixture').pathname);
    assert.ok(callback, 'Unknown alarm callback');
    const headers = new Headers(request.headers);
    const connectionHeaders = (headers.get('connection') ?? '').split(',');
    for (const name of connectionHeaders) {
      if (name.trim()) headers.delete(name.trim());
    }
    for (const name of [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
      'host',
      'content-length',
      'x-test-callback-url',
    ]) {
      headers.delete(name);
    }
    const reply = await callback(
      new Request(request.headers['x-test-callback-url'], {
        method: request.method,
        headers,
        body: Buffer.concat(chunks),
      }),
      topology,
    );
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(Buffer.from(await reply.arrayBuffer()));
  } catch (error) {
    await writeFile(
      path.join(directory, 'callback-error.json'),
      JSON.stringify(
        {
          name: error.name,
          message: error.message,
          causeCode: error.cause?.code ?? null,
          causeMessage: error.cause?.message ?? null,
          headerNames: Object.keys(request.headers),
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    response.writeHead(500);
    response.end('Test callback failed; see callback-error.json');
  }
}

function bindingKey(name, binding) {
  return name + '/' + binding;
}

function command(directory, binary, args, environment) {
  const result = spawnSync(binary, args, {
    cwd: directory,
    env: environment,
    encoding: 'utf8',
    timeout: 90_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

async function stop(process) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exited = once(process, 'exit');
  process.kill('SIGTERM');
  const timer = setTimeout(forceStop, 45_000, process);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

function forceStop(process) {
  process.kill('SIGKILL');
}

export async function createCelldRelocationTopology(workers) {
  const directory = process.env.CELLD_RELOCATION_DIRECTORY;
  const binary = process.env.CELLD_RELOCATION_BINARY;
  const nodes = {
    source: {
      address: process.env.CELLD_RELOCATION_ADDRESS,
      operator: process.env.CELLD_RELOCATION_OPERATOR,
    },
    destination: {
      address: process.env.CELLD_RELOCATION_DESTINATION_ADDRESS,
      operator: process.env.CELLD_RELOCATION_DESTINATION_OPERATOR,
    },
  };
  for (const node of Object.values(nodes)) {
    assert.equal(new URL(node.address).hostname, '127.0.0.1');
    assert.equal(new URL(node.operator).hostname, '127.0.0.1');
  }
  const registry = {
    workers: new Map(),
    databases: new Map(),
    buckets: new Map(),
    namespaces: new Map(),
  };
  const callbacks = new Map();
  const callbackTopology = { getWorker: remoteWorker.bind(null, registry.workers) };
  const callbackServer = http.createServer(
    handleCallback.bind(null, callbacks, callbackTopology, directory),
  );
  callbackServer.listen(0, '127.0.0.1');
  await once(callbackServer, 'listening');
  const callbackOrigin = 'http://127.0.0.1:' + callbackServer.address().port;
  const inspector = {
    name: 'relocation-inspector',
    main: path.join(import.meta.dirname, 'relocation-inspector.mjs'),
    compatibility_date: '2026-06-12',
    services: [],
    d1_databases: [],
    r2_buckets: [],
    durable_objects: { bindings: [] },
  };
  const configs = [];
  const databaseIds = new Map();
  const bucketIds = new Map();
  const namespaceIds = new Map();
  const buckets = {};
  const processes = [];
  try {
    for (const worker of workers) {
      const service = 'WORKER_' + registry.workers.size;
      registry.workers.set(worker.name, {
        binding: service,
        node: worker.name.startsWith('destination-') ? nodes.destination : nodes.source,
      });
      inspector.services.push({ binding: service, service: worker.name });
      const config = {
        name: worker.name,
        main: worker.scriptPath,
        compatibility_date: worker.compatibilityDate,
        vars: worker.bindings,
        services: [],
        d1_databases: [],
        r2_buckets: [],
        durable_objects: { bindings: [] },
      };
      for (const [binding, target] of Object.entries(worker.serviceBindings ?? {})) {
        if (typeof target === 'function') {
          const callbackPath = '/callback/' + worker.name + '/' + binding;
          callbacks.set(callbackPath, target);
          const shim = path.join(directory, worker.name + '-' + binding + '.mjs');
          await writeFile(
            shim,
            `export default { fetch(request) { const forwarded = new Request(${JSON.stringify(callbackOrigin + callbackPath)}, request); forwarded.headers.set('x-test-callback-url', request.url); return fetch(forwarded); } };\n`,
          );
          const callbackName = worker.name + '-' + binding.toLowerCase().replaceAll('_', '-');
          configs.push({
            name: callbackName,
            main: shim,
            compatibility_date: worker.compatibilityDate,
          });
          config.services.push({ binding, service: callbackName });
        } else {
          assert.equal(typeof target, 'string');
          config.services.push({ binding, service: target });
        }
      }
      for (const [binding, id] of Object.entries(worker.d1Databases ?? {})) {
        const entry = { binding, database_name: id, database_id: id };
        config.d1_databases.push(entry);
        let name = databaseIds.get(id);
        if (name === undefined) {
          name = 'DATABASE_' + databaseIds.size;
          databaseIds.set(id, name);
          inspector.d1_databases.push({ ...entry, binding: name });
        }
        registry.databases.set(bindingKey(worker.name, binding), name);
      }
      for (const [binding, id] of Object.entries(worker.r2Buckets ?? {})) {
        const entry = { binding, bucket_name: id };
        config.r2_buckets.push(entry);
        let name = bucketIds.get(id);
        if (name === undefined) {
          name = 'BUCKET_' + bucketIds.size;
          bucketIds.set(id, name);
          inspector.r2_buckets.push({ ...entry, binding: name });
        }
        registry.buckets.set(bindingKey(worker.name, binding), name);
        const role = worker.name.endsWith('deriver-a') ? 'deriver-a' : 'deriver-b';
        buckets[id] = 's3://backup-' + role;
      }
      const localClasses = new Set();
      for (const [binding, object] of Object.entries(worker.durableObjects ?? {})) {
        const owner = object.scriptName ?? worker.name;
        const entry = { name: binding, class_name: object.className, script_name: owner };
        config.durable_objects.bindings.push(entry);
        if (owner === worker.name) localClasses.add(object.className);
        const ownerClass = bindingKey(owner, object.className);
        let name = namespaceIds.get(ownerClass);
        if (name === undefined) {
          name = 'OBJECT_' + namespaceIds.size;
          namespaceIds.set(ownerClass, name);
          inspector.durable_objects.bindings.push({ ...entry, name });
        }
        registry.namespaces.set(bindingKey(worker.name, binding), {
          name,
          className: object.className,
        });
      }
      config.migrations = [{ tag: 'initial', new_sqlite_classes: [...localClasses] }];
      configs.push(config);
    }
    configs.push(inspector);
    const environment = { ...process.env, CELLD_R2_BUCKETS: JSON.stringify(buckets) };
    const renderer = path.resolve(import.meta.dirname, '../../../deployment/celld/render.mjs');
    const secrets = path.join(directory, 'renderer-secrets.json');
    await writeFile(secrets, '{}\n', { mode: 0o600 });
    await mkdir(path.join(directory, 'migrations'));
    for (const config of configs) {
      const file = path.join(directory, config.name + '.json');
      await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
      const rendered = path.join(directory, 'rendered-' + config.name);
      command(directory, process.execPath, [renderer, file, secrets, rendered], environment);
      command(
        directory,
        binary,
        ['deploy', path.join(rendered, 'wrangler.json'), '--bucket', 'fleet-test'],
        environment,
      );
    }
    for (const [name, node] of Object.entries(nodes)) {
      const log = await open(path.join(directory, 'runtime-' + name + '.log'), 'w');
      const runtime = spawn(
        binary,
        [
          '--no-control-plane',
          '--bucket',
          'fleet-test',
          '--listen',
          new URL(node.address).host,
          '--internal-listen',
          new URL(node.operator).host,
          '--advertise',
          new URL(node.operator).host,
        ],
        {
          cwd: directory,
          env: { ...environment, CELLD_WATCH: path.join(directory, 'state-' + name) },
          stdio: ['ignore', log.fd, log.fd],
        },
      );
      processes.push(runtime);
      node.runtime = runtime;
      await log.close();
      await waitForRuntime(node);
    }
    return new CelldRelocationTopology(nodes, registry, callbackServer, directory);
  } catch (error) {
    for (const process of processes) await stop(process);
    callbackServer.closeAllConnections();
    callbackServer.close();
    throw error;
  }
}

async function waitForRuntime(node) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.equal(node.runtime.exitCode, null, 'Runtime exited before listening');
    try {
      const response = await fetch(node.address + '/.well-known/celld/health', {
        signal: AbortSignal.timeout(300),
      });
      if (response.status === 200) return;
    } catch {
      // The native listener is still starting.
    }
    await delay(100);
  }
  throw new Error('Relocation runtime did not start');
}

class CelldRelocationTopology {
  constructor(nodes, registry, callbackServer, directory) {
    Object.assign(this, { nodes, registry, callbackServer, directory });
    this.ready = Promise.resolve();
  }
  getWorker(name) {
    return remoteWorker(this.registry.workers, name);
  }
  getD1Database(binding, name) {
    const id = this.registry.databases.get(bindingKey(name, binding));
    assert.ok(id, bindingKey(name, binding));
    return new RemoteDatabase(this.registry.workers.get(name).node.address, id);
  }
  getR2Bucket(binding, name) {
    const id = this.registry.buckets.get(bindingKey(name, binding));
    assert.ok(id, bindingKey(name, binding));
    return new RemoteBucket(this.registry.workers.get(name).node.address, id);
  }
  getDurableObjectNamespace(binding, name) {
    const entry = this.registry.namespaces.get(bindingKey(name, binding));
    assert.ok(entry, bindingKey(name, binding));
    return new RemoteNamespace(this.registry.workers.get(name).node.address, entry.name);
  }
  async listDurableObjectIds(className, worker) {
    let namespace;
    for (const [key, entry] of this.registry.namespaces) {
      if (key.startsWith(worker + '/') && entry.className === className) namespace = entry.name;
    }
    assert.ok(namespace, worker + '/' + className);
    const ids = new Set();
    for (const node of Object.values(this.nodes)) {
      const state = await jsonResponse(await fetch(node.operator + '/state'));
      for (const scope of state.residents) {
        const id = scope.slice(scope.lastIndexOf(':') + 1);
        if (/^[0-9a-f]{64}$/.test(id)) ids.add(id);
      }
    }
    const address = this.registry.workers.get(worker).node.address;
    return jsonResponse(
      await remoteRequest(address, '/namespace/' + namespace + '/validate', {
        ids: [...ids],
      }),
    );
  }
  async unsafeEvictDurableObject(worker, className, { id }) {
    const matches = [];
    for (const node of Object.values(this.nodes)) {
      const state = await jsonResponse(await fetch(node.operator + '/state'));
      for (const scope of state.residents) {
        if (scope === className + ':' + id) matches.push({ node, scope });
      }
    }
    assert.equal(matches.length, 1, worker + '/' + className + '/' + id);
    const [{ node, scope }] = matches;
    await jsonResponse(await fetch(node.operator + '/evict/' + scope, { method: 'POST' }));
    const after = await jsonResponse(await fetch(node.operator + '/state'));
    assert.ok(!after.residents.includes(scope), 'The object must leave residency before replay');
  }
  async dispose() {
    try {
      const snapshots = {};
      for (const [name, node] of Object.entries(this.nodes)) {
        snapshots[name] = {
          pid: node.runtime.pid,
          address: node.address,
          operator: node.operator,
          state: await jsonResponse(await fetch(node.operator + '/state')),
        };
      }
      await writeFile(
        path.join(this.directory, 'runtime-residency.json'),
        JSON.stringify(snapshots, null, 2) + '\n',
      );
    } finally {
      const stops = [];
      for (const node of Object.values(this.nodes)) stops.push(stop(node.runtime));
      await Promise.all(stops);
      this.callbackServer.closeAllConnections();
      this.callbackServer.close();
      const exits = {};
      for (const [name, node] of Object.entries(this.nodes)) {
        exits[name] = {
          pid: node.runtime.pid,
          exitCode: node.runtime.exitCode,
          signal: node.runtime.signalCode,
        };
      }
      await writeFile(
        path.join(this.directory, 'runtime-stop.json'),
        JSON.stringify(exits, null, 2) + '\n',
      );
    }
  }
}

function remoteWorker(workers, name) {
  const entry = workers.get(name);
  assert.ok(entry, name);
  return new RemoteWorker(entry.node.address, entry.binding);
}

function remoteRequest(address, route, body) {
  return fetch(address + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

class RemoteWorker {
  constructor(address, binding) {
    Object.assign(this, { address, binding });
  }
  async fetch(input, init) {
    const request = new Request(input, init);
    request.headers.set('x-test-target-url', request.url);
    return fetch(this.address + '/worker/' + this.binding, {
      method: request.method,
      headers: request.headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
    });
  }
}
class RemoteDatabase {
  constructor(address, binding) {
    Object.assign(this, { address, binding });
  }
  prepare(sql) {
    return new RemoteStatement(this, sql, []);
  }
  async exec(sql) {
    return this.call('exec', { sql });
  }
  async batch(statements) {
    const inputs = [];
    for (const statement of statements)
      inputs.push({ sql: statement.sql, values: statement.values });
    return this.call('batch', { statements: inputs });
  }
  async call(method, input) {
    return jsonResponse(
      await remoteRequest(this.address, '/database/' + this.binding + '/' + method, input),
    );
  }
}
class RemoteStatement {
  constructor(database, sql, values) {
    Object.assign(this, { database, sql, values });
  }
  bind(...values) {
    return new RemoteStatement(this.database, this.sql, values);
  }
  all(...args) {
    return this.call('all', args);
  }
  first(...args) {
    return this.call('first', args);
  }
  run(...args) {
    return this.call('run', args);
  }
  raw(...args) {
    return this.call('raw', args);
  }
  call(method, args) {
    return this.database.call(method, { sql: this.sql, values: this.values, args });
  }
}
class RemoteBucket {
  constructor(address, binding) {
    Object.assign(this, { address, binding });
  }
  async list() {
    return jsonResponse(await remoteRequest(this.address, '/bucket/' + this.binding, {}));
  }
}
class RemoteNamespace {
  constructor(address, binding) {
    Object.assign(this, { address, binding });
  }
  async idFromName(name) {
    return jsonResponse(
      await remoteRequest(this.address, '/namespace/' + this.binding + '/name', { name }),
    );
  }
  idFromString(id) {
    return id;
  }
  get(id) {
    return new RemoteObject(this.address, this.binding, id);
  }
}
class RemoteObject {
  constructor(address, binding, id) {
    Object.assign(this, { address, binding, id });
  }
  async fetch(input, init) {
    const request = new Request(input, init);
    return remoteRequest(this.address, '/namespace/' + this.binding + '/fetch', {
      id: await this.id,
      url: request.url,
      method: request.method,
      headers: [...request.headers],
      body: await request.text(),
    });
  }
}
