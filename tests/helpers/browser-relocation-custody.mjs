import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import dotenv from 'dotenv';
import { Miniflare } from 'miniflare';
import { unstable_readConfig, unstable_splitSqlQuery } from 'wrangler';
import { CustodyBinding } from './relocation-directory-runtime.mjs';

const execute = promisify(execFile);
const roles = ['router', 'deriver-a', 'deriver-b', 'signing-worker', 'tenant-root-control-plane'];

export async function createBrowserRelocationCustody({ publicRoot, localRoot }) {
  const configs = new Map();
  const workers = [];
  for (const role of roles) {
    const configRoot = resolve(localRoot, '.runtime/router-ab-strict');
    const config = unstable_readConfig({ config: resolve(configRoot, `wrangler.${role}.toml`) });
    const secrets = dotenv.parse(await readFile(resolve(configRoot, `.dev.vars.${role}`)));
    configs.set(role, config);
    workers.push(workerOptions(publicRoot, config, secrets));
  }
  const sourceNames = new Set(workers.map(workerName));
  const sharedControl = configs.get('tenant-root-control-plane').name;
  const sourceRouter = configs.get('router').name;
  for (const source of workers.slice()) {
    if (source.name === sharedControl) continue;
    workers.push(destinationWorker(source, sourceNames, sharedControl, sourceRouter));
  }
  const topology = new Miniflare({ workers, port: 0 });
  try {
    const routerUrl = await topology.ready;
    for (const role of roles) {
      const config = configs.get(role);
      for (const binding of config.d1_databases) {
        const database = await topology.getD1Database(binding.binding, config.name);
        await migrate(
          database,
          resolve(publicRoot, 'crates/router-ab-cloudflare/migrations', role),
        );
      }
    }
    const gatewaySecrets = dotenv.parse(
      await readFile(resolve(localRoot, '.runtime/wallet-gateway/.dev.vars.wallet-gateway')),
    );
    const deployment = JSON.parse(gatewaySecrets.WALLET_LOCAL_DEPLOYMENT_JSON);
    const { stdout } = await execute(
      process.execPath,
      [
        resolve(publicRoot, 'crates/router-ab-cloudflare/scripts/bootstrap-local-tenant-root.mjs'),
        '--root',
        localRoot,
        '--org-id',
        deployment.deployment.orgId,
        '--project-id',
        deployment.deployment.projectId,
        '--env-id',
        deployment.deployment.environmentId,
        '--signing-root-id',
        deployment.tenantRoot.signingRootId,
        '--signing-root-version',
        deployment.deployment.signingRootVersion,
        '--router-url',
        routerUrl.href,
      ],
      { cwd: publicRoot },
    );
    const root = JSON.parse(stdout);
    assert.equal(root.kind, 'wallet_local_tenant_root_ready_v1');
    const source = await roleBindings(topology, configs, false);
    const destination = await roleBindings(topology, configs, true);
    const namespaces = [];
    for (const [role, binding] of [
      ['router', 'ROUTER_WALLET_DO'],
      ['deriver-a', 'DERIVER_A_WALLET_DO'],
      ['deriver-b', 'DERIVER_B_WALLET_DO'],
      ['signing-worker', 'SIGNING_WORKER_WALLET_DO'],
    ]) {
      const name = configs.get(role).name;
      const left = await topology.getDurableObjectNamespace(binding, name);
      const right = await topology.getDurableObjectNamespace(binding, `destination-${name}`);
      assert.notEqual(
        left.idFromName('ownership-probe').toString(),
        right.idFromName('ownership-probe').toString(),
      );
      namespaces.push({ role, independent: true });
    }
    return {
      topology,
      tenantRoot: {
        identityDigestB64u: root.identityDigestB64u,
        custodyLineageB64u: root.custodyLineageB64u,
        signingRootId: deployment.tenantRoot.signingRootId,
      },
      regions: { US: source, WEUR: source, APAC: destination, OC: destination },
      namespaces,
      close: topology.dispose.bind(topology),
    };
  } catch (error) {
    await topology.dispose();
    throw error;
  }
}

function workerName(worker) {
  return worker.name;
}

function workerOptions(publicRoot, config, secrets) {
  const durableObjects = {};
  for (const binding of config.durable_objects.bindings) {
    durableObjects[binding.name] = {
      className: binding.class_name,
      ...(binding.script_name ? { scriptName: binding.script_name } : {}),
      useSQLite: true,
    };
  }
  const d1Databases = {};
  for (const binding of config.d1_databases) d1Databases[binding.binding] = binding.database_id;
  const r2Buckets = {};
  for (const binding of config.r2_buckets) r2Buckets[binding.binding] = binding.bucket_name;
  const serviceBindings = {};
  for (const binding of config.services) serviceBindings[binding.binding] = binding.service;
  return {
    name: config.name,
    modules: true,
    scriptPath: config.main,
    modulesRoot: publicRoot,
    modulesRules: [
      { type: 'ESModule', include: ['**/*.js', '**/*.mjs'] },
      { type: 'CompiledWasm', include: ['**/*.wasm'] },
    ],
    compatibilityDate: config.compatibility_date,
    bindings: { ...config.vars, ...secrets },
    durableObjects,
    d1Databases,
    r2Buckets,
    serviceBindings,
  };
}

function destinationWorker(source, sourceNames, sharedControl, sourceRouter) {
  const serviceBindings = {};
  for (const [binding, service] of Object.entries(source.serviceBindings)) {
    assert.ok(sourceNames.has(service));
    serviceBindings[binding] = service === sharedControl ? service : `destination-${service}`;
  }
  const durableObjects = {};
  for (const [binding, object] of Object.entries(source.durableObjects)) {
    durableObjects[binding] =
      binding === 'ROUTER_TENANT_ROOT_CREATION_DO'
        ? { ...object, scriptName: sourceRouter }
        : object;
  }
  return { ...source, name: `destination-${source.name}`, serviceBindings, durableObjects };
}

async function roleBindings(topology, configs, destination) {
  const result = {};
  for (const [binding, role] of [
    ['MPC_ROUTER', 'router'],
    ['DERIVER_A', 'deriver-a'],
    ['DERIVER_B', 'deriver-b'],
    ['SIGNING_WORKER', 'signing-worker'],
  ]) {
    const name = configs.get(role).name;
    result[binding] = new CustodyBinding(
      await topology.getWorker(destination ? `destination-${name}` : name),
    );
  }
  return result;
}

async function migrate(database, directory) {
  const files = (await readdir(directory)).filter(isMigration).sort();
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), 'utf8');
    for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
  }
}

function isMigration(file) {
  return file.endsWith('.sql');
}
