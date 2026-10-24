import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteCliD1Database } from '../helpers/sqliteD1.ts';
import {
  fourRegionBinding,
  seedHistoricalActiveBinding,
} from '../helpers/tenantDeploymentFixtures.ts';
import { parseDeploymentTargets, readBackendLane } from '../../scripts/deployment-targets.mjs';
import { CloudflareD1Operator } from '../../deployment/wallet-system/scripts/cloudflare-d1-operator.mjs';
import { allocateGetSignalResources } from '../../deployment/wallet-system/scripts/allocate-getsignal-resources.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const accountId = '0123456789abcdef0123456789abcdef';

class CloudflareDatabaseEndpoint {
  databases = new Map();
  requests = [];
  deriverBAttempts = 0;
  origin = null;

  constructor(directory, accountDatabaseId, accountDatabase) {
    this.directory = directory;
    this.databases.set(accountDatabaseId, {
      uuid: accountDatabaseId,
      name: 'seams-console',
      database: accountDatabase,
      location: { region: 'APAC', colo: 'SIN' },
    });
    this.server = createServer(this.handle.bind(this));
  }

  async start() {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Provider fixture address unavailable');
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  fetch(input, options) {
    const url = new URL(input);
    if (url.origin !== 'https://api.cloudflare.com' || !this.origin) {
      throw new Error('Unexpected provider origin');
    }
    return fetch(new URL(url.pathname + url.search, this.origin), options);
  }

  async stop() {
    const closed = once(this.server, 'close');
    this.server.closeAllConnections();
    this.server.close();
    await closed;
  }

  async handle(request, response) {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const base = `/client/v4/accounts/${accountId}/d1/database`;
      this.requests.push({ method: request.method, path: url.pathname });
      if (url.pathname === base && request.method === 'GET') {
        const databases = [];
        for (const database of this.databases.values()) {
          if (database.name === url.searchParams.get('name')) {
            databases.push({ uuid: database.uuid, name: database.name });
          }
        }
        sendJson(response, databases);
        return;
      }
      if (url.pathname === base && request.method === 'POST') {
        const body = await readBody(request);
        const uuid = randomUUID();
        let region;
        let colo;
        switch (body.primary_location_hint) {
          case 'enam':
            region = 'ENAM';
            colo = 'IAD';
            break;
          case 'weur':
            region = 'WEUR';
            colo = 'LHR';
            break;
          case 'oc':
            region = 'OC';
            colo = 'SYD';
            break;
          case 'apac':
            region = 'APAC';
            colo = 'SIN';
            break;
          default:
            throw new Error('Unexpected location hint');
        }
        if (body.name === 'seams-private-getsignal-deriver-b') {
          this.deriverBAttempts += 1;
          if (this.deriverBAttempts === 1) colo = 'ICN';
        }
        this.databases.set(uuid, {
          uuid,
          name: body.name,
          database: new SqliteCliD1Database(path.join(this.directory, `${uuid}.sqlite`)),
          location: { region, colo },
        });
        sendJson(response, { uuid, name: body.name });
        return;
      }
      const tail = url.pathname.slice(base.length + 1).split('/');
      const database = this.databases.get(tail[0]);
      if (!database) throw new Error('Unknown database');
      if (request.method === 'POST' && tail[1] === 'query') {
        const body = await readBody(request);
        if (
          typeof body.sql !== 'string' ||
          !body.sql.trimStart().startsWith('SELECT') ||
          !Array.isArray(body.params)
        )
          throw new Error('Provider fixture permits read queries only');
        const result = await database.database
          .prepare(body.sql)
          .bind(...body.params)
          .all();
        sendJson(response, [
          {
            success: true,
            results: result.results,
            meta: {
              served_by_primary: true,
              served_by_region: database.location.region,
              served_by_colo: database.location.colo,
            },
          },
        ]);
        return;
      }
      if (request.method === 'DELETE' && tail.length === 1) {
        this.databases.delete(database.uuid);
        sendJson(response, null);
        return;
      }
      throw new Error('Unexpected provider operation');
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ success: false, message: error.message }));
    }
  }
}

function sendJson(response, result) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ success: true, result }));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function seedEnvironment(database, lane, namespace) {
  const identity = lane.identity;
  await database
    .prepare(
      "INSERT INTO organizations (namespace,id,name,slug,status,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?3,'ACTIVE',1,1)",
    )
    .bind(namespace, identity.organizationId, 'GetSignal')
    .run();
  await database
    .prepare(
      "INSERT INTO projects (namespace,id,org_id,name,slug,status,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?4,'ACTIVE',1,1)",
    )
    .bind(namespace, identity.projectId, identity.organizationId, 'GetSignal')
    .run();
  await database
    .prepare(
      "INSERT INTO environments (namespace,id,org_id,project_id,env_key,name,status,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,'dev','Development','ACTIVE',1,1)",
    )
    .bind(namespace, identity.environmentId, identity.organizationId, identity.projectId)
    .run();
}

async function readPointers(database) {
  return (
    await database
      .prepare('SELECT * FROM active_tenant_deployment_bindings ORDER BY deployment_lane')
      .all()
  ).results;
}

async function pendingGetSignalLane() {
  const source = JSON.parse(
    await readFile(path.join(repoRoot, 'deployment/wallet-system/targets.json'), 'utf8'),
  );
  source.customers.getsignal.provisioning = {
    kind: 'pending',
    runtimeProfileKind: 'testnet_service',
    requiredValues: ['SIGNING_WORKER_PRIVATE_D1_ID'],
  };
  return parseDeploymentTargets(source).backendLanes['getsignal-testnet'];
}

async function provisioningScenario() {
  const testInfo = test.info();
  test.setTimeout(120_000);
  const directory = testInfo.outputPath('databases');
  await mkdir(directory, { recursive: true });
  const registry = new SqliteCliD1Database(path.join(directory, 'account.sqlite'));
  for (const migration of [
    'packages/console-server-ts/migrations/d1-console-core/0001_console_core_initial.sql',
    'packages/wallet-console-server-ts/migrations/d1-console/0046_tenant_deployment_bindings.sql',
  ])
    await registry.exec(await readFile(path.join(repoRoot, migration), 'utf8'));
  const lane = await pendingGetSignalLane();
  const control = readBackendLane(lane.controlPlaneLane);
  const namespace = control.provisioning.gatewayDeploymentConfig.tenant.namespace;
  await seedEnvironment(registry, lane, namespace);
  const demo = await fourRegionBinding(Date.now(), 'production-mainnet');
  await seedHistoricalActiveBinding(registry, demo);
  const originalPointers = await readPointers(registry);
  const endpoint = new CloudflareDatabaseEndpoint(directory, control.console.database.id, registry);
  await endpoint.start();
  try {
    const provider = new CloudflareD1Operator({
      accountId,
      apiToken: 'controlled-provider-token',
      fetcher: endpoint.fetch.bind(endpoint),
    });
    const input = { provider, lane, sourceRevision: 'controlled-e2e' };
    const first = await allocateGetSignalResources(input);
    expect(first.regional).toHaveLength(4);
    expect(endpoint.databases.size).toBe(8);
    expect(first.privateRoles.deriverA.database.location.colo).toBe('SIN');
    expect(first.privateRoles.deriverB.database.location.colo).toBe('SIN');
    expect(endpoint.deriverBAttempts).toBe(2);
    expect(await readPointers(registry)).toEqual(originalPointers);
    const requestCount = endpoint.requests.length;
    const repeated = await allocateGetSignalResources(input);
    expect(repeated.privateRoles.signingWorker.database.id).toBe(
      first.privateRoles.signingWorker.database.id,
    );
    for (const request of endpoint.requests.slice(requestCount)) {
      expect(
        request.method === 'DELETE' ||
          (request.method === 'POST' && request.path.endsWith('/database')),
      ).toBe(false);
    }
    await expect(
      provider.removeEmptyCreatedDatabase({
        id: control.console.database.id,
        name: 'seams-console',
      }),
    ).rejects.toThrow('created by this operator run');
    const privateDatabase = endpoint.databases.get(first.privateRoles.signingWorker.database.id);
    await privateDatabase.database.exec(
      "CREATE TABLE wallet_state (value TEXT NOT NULL); INSERT INTO wallet_state VALUES ('preserve-me');",
    );
    await expect(
      provider.removeEmptyCreatedDatabase(first.privateRoles.signingWorker.database),
    ).rejects.toThrow('application data');
    await expect(allocateGetSignalResources(input)).rejects.toThrow('application data');
    const assigned = await fourRegionBinding(Date.now() + 1, 'getsignal-testnet', {
      namespace,
      organizationId: lane.identity.organizationId,
      projectId: lane.identity.projectId,
      environmentId: lane.identity.environmentId,
    });
    await seedHistoricalActiveBinding(registry, assigned);
    const assignedPointers = await readPointers(registry);
    await expect(allocateGetSignalResources(input)).rejects.toThrow(
      'already has an active deployment',
    );
    expect(await readPointers(registry)).toEqual(assignedPointers);
    const record = {
      result: 'passed',
      verificationScope: 'Local operator E2E with real SQLite and a loopback HTTP provider fixture',
      command:
        'pnpm -C tests exec playwright test -c playwright.relayer.config.ts relayer/getsignal-resource-provisioning.e2e.test.mjs --reporter=line --output ../.artifacts/getsignal/resource-provisioning-e2e',
      first,
      repeated,
      originalPointers,
      assignedPointers,
      guards: [
        'demo preserved',
        'colocation retry bounded to a fresh empty candidate',
        'idempotent allocation',
        'foreign database cleanup rejected',
        'wallet data preserved',
        'existing assignment blocks allocation',
      ],
      allocatorSha256: createHash('sha256')
        .update(
          await readFile(
            path.join(
              repoRoot,
              'deployment/wallet-system/scripts/allocate-getsignal-resources.mjs',
            ),
          ),
        )
        .digest('hex'),
      providerRequests: endpoint.requests,
    };
    const artifact = testInfo.outputPath('getsignal-resource-provisioning.json');
    await writeFile(artifact, JSON.stringify(record, null, 2) + '\n');
    await testInfo.attach('getsignal-resource-provisioning', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    await endpoint.stop();
  }
}

test(
  'GetSignal provisioning preserves demo assignments through placement retry, resume and refusal of existing wallet state',
  provisioningScenario,
);
