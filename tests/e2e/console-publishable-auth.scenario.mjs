import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

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
    export { createD1ConsoleApiKeyService } from './packages/console-server-ts/src/apiKeys/d1';
    export { createRouterApiPublishableKeyAuthAdapter } from './packages/wallet-console-server-ts/src/router/routerApiKeyAuth';
    export { createWalletConsoleOpsHandler } from './packages/wallet-console-server-ts/src/serviceBinding/walletConsoleOpsHandler';
    export { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from './packages/wallet-console-shared-ts/src/apiKeyScopes';
    export { WALLET_CONSOLE_OP_PATHS_V1, WALLET_CONSOLE_SERVICE_ORIGIN_V1 } from '@seams/wallet-server/cloud-host';
  `,
  },
});
const api = await import(pathToFileURL(bundlePath).href);

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
  constructor(database) {
    this.database = database;
  }
  prepare(query) {
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
  const delayed = new DelayedUsageDatabase(database);
  const clock = new Clock();
  const service = await api.createD1ConsoleApiKeyService({
    database: delayed,
    namespace: 'setup-telemetry',
    now: clock.now.bind(clock),
    scopeValidation: api.WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
  });
  const owner = { orgId: 'org', actorUserId: 'owner' };
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
  };
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(
    'Console authentication passed with delayed, reordered telemetry and concurrent revocation.',
  );
} finally {
  await runtime.dispose();
}
