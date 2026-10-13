import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

const output = path.resolve('.artifacts/console-publishable-auth');
await mkdir(output, { recursive: true });
const bundlePath = path.join(output, 'services.mjs');
await build({
  bundle: true,
  platform: 'node',
  loader: { '.wasm': 'binary' },
  external: ['cloudflare:workers'],
  format: 'esm',
  outfile: bundlePath,
  tsconfig: 'packages/wallet-console-server-ts/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
    export { createD1ConsoleApiKeyService } from './packages/wallet-console-server-ts/src/apiKeys/d1';
    export { createCloudflareD1AccountServiceBundle } from './packages/console-server-ts/src/router/cloudflare/d1AccountServices';
    export { createD1ConsoleWalletEnvironmentService } from './packages/wallet-console-server-ts/src/environments/d1';
    export { activateWalletProject } from './tests/helpers/accountWalletProject.fixtures';
    export { createRouterApiPublishableKeyAuthAdapter } from './packages/wallet-console-server-ts/src/router/routerApiKeyAuth';
    export { createWalletProjectEnvironmentResolver } from './packages/wallet-console-server-ts/src/router/projectEnvironmentAdapter';
    export { createWalletConsoleOpsHandler } from './packages/wallet-console-server-ts/src/serviceBinding/walletConsoleOpsHandler';
    export { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from './packages/wallet-console-shared-ts/src/apiKeyScopes';
    export { WALLET_CONSOLE_OP_PATHS_V1, WALLET_CONSOLE_SERVICE_ORIGIN_V1 } from '@seams/wallet-server/cloud-host';
  `,
  },
});
const api = await import(pathToFileURL(bundlePath).href);

async function migrate(database) {
  const directory = path.resolve('packages/wallet-console-server-ts/migrations/d1-console');
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith('.sql')) continue;
    const contents = await readFile(path.join(directory, filename), 'utf8');
    for (const sql of unstable_splitSqlQuery(contents)) await database.prepare(sql).run();
  }
}

class DelayedUsageStatement {
  constructor(database, statement) {
    this.database = database;
    this.statement = statement;
  }
  bind(...values) {
    return new DelayedUsageStatement(this.database, this.statement.bind(...values));
  }
  async first(...args) {
    const pending = Promise.withResolvers();
    this.database.pending.push(pending);
    await pending.promise;
    return this.statement.first(...args);
  }
}
class DelayedUsageDatabase {
  pending = [];
  credentialQuery = null;
  credentialReads = 0;
  environmentQuery = null;
  constructor(database) {
    this.database = database;
  }
  prepare(query) {
    if (query.startsWith('SELECT k.*')) {
      this.credentialQuery = query;
      this.credentialReads += 1;
    }
    if (query.startsWith('SELECT e.*')) this.environmentQuery = query;
    const statement = this.database.prepare(query);
    return /UPDATE api_keys\s+SET last_used_at_ms/u.test(query)
      ? new DelayedUsageStatement(this, statement)
      : statement;
  }
  batch(statements) {
    return this.database.batch(statements);
  }
  exec(query) {
    return this.database.exec(query);
  }
}
class RequestLifetime {
  writes = [];
  waitUntil(write) {
    this.writes.push(write);
  }
}
class Clock {
  milliseconds = Date.parse('2026-10-13T00:00:00Z');
  now() {
    return new Date(this.milliseconds);
  }
}
function unexpectedOperation() {
  throw new Error('Unexpected Console operation');
}
async function authenticate(
  handler,
  secret,
  origin = 'https://wallet.test',
  environmentId = 'project:dev',
) {
  const response = await handler(
    new Request(
      api.WALLET_CONSOLE_SERVICE_ORIGIN_V1 + api.WALLET_CONSOLE_OP_PATHS_V1.publishableKeyAuth,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, origin, environmentId }),
      },
    ),
  );
  assert.ok(response);
  return { status: response.status, result: await response.json() };
}

const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok"); } }',
  d1Databases: ['DB'],
});
try {
  const database = await runtime.getD1Database('DB');
  await migrate(database);
  const delayed = new DelayedUsageDatabase(database);
  const clock = new Clock();
  const namespace = 'setup-telemetry';
  const deploymentId = 'publishable-auth-wallet';
  const owner = { orgId: 'org', actorUserId: 'owner' };
  const core = await api.createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    ensureSchema: false,
    now: clock.now.bind(clock),
    externalDeletionGuard: null,
  });
  await core.orgProjects.upsertOrganization(owner, { name: 'Publishable auth account' });
  await core.organizationAccess.bootstrapInitialOwner({
    orgId: owner.orgId,
    userId: owner.actorUserId,
    email: 'owner@publishable-auth.invalid',
    displayName: 'Fixture owner',
  });
  await core.orgProjects.createProject(owner, { id: 'project', name: 'Publishable auth Wallet' });
  const environments = await api.createD1ConsoleWalletEnvironmentService({
    database,
    namespace,
    ensureSchema: false,
    now: clock.now.bind(clock),
  });
  await api.activateWalletProject({
    core,
    walletEnvironments: environments,
    namespace,
    deploymentId,
    context: owner,
    projectId: 'project',
  });
  const service = await api.createD1ConsoleApiKeyService({
    deploymentId,
    database: delayed,
    namespace,
    now: clock.now.bind(clock),
    scopeValidation: api.WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
  });
  const created = await service.createApiKey(owner, {
    kind: 'publishable_key',
    name: 'Registration',
    environmentId: 'project:dev',
    allowedOrigins: ['https://wallet.test'],
    rateLimitBucket: 'registration',
    quotaBucket: 'registration',
  });
  const lifetime = new RequestLifetime();
  const handler = api.createWalletConsoleOpsHandler({
    publishableKeyAuth: api.createRouterApiPublishableKeyAuthAdapter(
      service,
      lifetime.waitUntil.bind(lifetime),
    ),
    apiKeyAuth: { authenticate: unexpectedOperation },
    usageMeter: { recordEvent: unexpectedOperation },
    projectEnvironments: { resolve: unexpectedOperation },
    tenantRootActiveLineage: { resolveActiveLineage: unexpectedOperation },
  });
  clock.milliseconds += 1000;
  const first = await authenticate(handler, created.secret);
  assert.equal(first.status, 200);
  assert.equal(delayed.credentialReads, 1);
  assert.ok(delayed.credentialQuery);
  const queryPlan = await database
    .prepare(`EXPLAIN QUERY PLAN ${delayed.credentialQuery}`)
    .bind(namespace, deploymentId, namespace, 'publishable_key', '', '')
    .all();
  const resolver = api.createWalletProjectEnvironmentResolver({
    database: delayed,
    namespace,
    deploymentId,
  });
  const environmentsForOwner = await resolver.listEnvironments({ ...owner, roles: ['OWNER'] });
  assert.equal(environmentsForOwner.length, 3);
  assert.ok(delayed.environmentQuery);
  const environmentQueryPlan = await database
    .prepare(`EXPLAIN QUERY PLAN ${delayed.environmentQuery}`)
    .bind(namespace, deploymentId, namespace, owner.orgId)
    .all();
  assert.equal(delayed.pending.length, 1);
  assert.equal((await service.listApiKeys(owner))[0].lastUsedAt, null);
  clock.milliseconds += 1000;
  const second = await authenticate(handler, created.secret);
  assert.equal(second.status, 200);
  assert.equal(delayed.pending.length, 2);
  // Complete the newer write first. Revoke while the older write is still pending.
  delayed.pending[1].resolve();
  await lifetime.writes[1];
  const lastUsedAt = (await service.listApiKeys(owner))[0].lastUsedAt;
  assert.equal(lastUsedAt, clock.now().toISOString());
  const wrongOrigin = await authenticate(handler, created.secret, 'https://wrong.test');
  const wrongEnvironment = await authenticate(
    handler,
    created.secret,
    'https://wallet.test',
    'other',
  );
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongEnvironment.status, 403);
  const telemetryFailure = await authenticate(handler, created.secret);
  assert.equal(telemetryFailure.status, 200);
  const rejectedWrite = assert.rejects(lifetime.writes[2], /Controlled telemetry failure/u);
  delayed.pending[2].reject(new Error('Controlled telemetry failure'));
  await rejectedWrite;
  clock.milliseconds += 1000;
  await service.revokeApiKey(owner, created.apiKey.id);
  delayed.pending[0].resolve();
  await lifetime.writes[0];
  const persisted = (await service.listApiKeys(owner))[0];
  assert.equal(persisted.lastUsedAt, lastUsedAt);
  assert.equal(persisted.updatedAt, clock.now().toISOString());
  assert.equal(persisted.status, 'REVOKED');
  const revoked = await authenticate(handler, created.secret);
  assert.equal(revoked.status, 403);
  assert.equal(delayed.pending.length, 3);
  const evidence = {
    first,
    second,
    wrongOrigin,
    wrongEnvironment,
    revoked,
    usageWrites: lifetime.writes.length,
    lastUsedAt,
    updatedAt: persisted.updatedAt,
    status: persisted.status,
    completedOutOfOrder: true,
    telemetryFailureDidNotRejectAuthentication: true,
    activeWalletBindingRequired: true,
    credentialLookupPlan: queryPlan.results,
    environmentLookupPlan: environmentQueryPlan.results,
    credentialReadsBeforeFirstResponse: 1,
  };
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(
    'Console authentication passed with delayed, reordered telemetry and concurrent revocation.',
  );
} finally {
  await runtime.dispose();
}
