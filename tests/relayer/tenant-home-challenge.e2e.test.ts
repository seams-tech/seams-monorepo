import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { consoleWorkerEnvironment } from '../helpers/consoleWorkerEnvironment';
import { namespaceHome } from '../helpers/tenantDeploymentFixtures';
import { GithubDeploymentOidcFixture } from '../helpers/githubDeploymentOidc';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deployment = JSON.parse(
  readFileSync(path.join(root, 'deployment/wallet-system/targets.json'), 'utf8'),
).production.lanes.testnet.provisioning.gatewayDeploymentConfig;
const namespace: string = deployment.tenant.namespace;
const lane = 'production-testnet';
const home = namespaceHome(namespace, deployment.resources.signerD1.id);
const execute = promisify(execFile);
const challengePath = '/internal/tenant-deployment/v1/home-challenge';
const verifyUrl = 'https://console.example.test/internal/tenant-deployment/v1/verify-home';

class Dependencies {
  readonly oidc = new GithubDeploymentOidcFixture();
  readonly unexpected: string[] = [];
  outbound(request: Request): Response {
    if (request.url === 'https://token.actions.githubusercontent.com/.well-known/jwks')
      return this.oidc.jwks();
    this.unexpected.push(request.url);
    return new Response('Unexpected outbound request', { status: 503 });
  }
}

class ChallengeProvider {
  failInsertResponse = false;
  inserts = 0;
  deletes = 0;
  readonly failures: string[] = [];
  constructor(
    readonly database: D1DatabaseLike,
    readonly oidc: GithubDeploymentOidcFixture,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.url?.startsWith('/oidc')) {
        response.end(JSON.stringify({ value: this.oidc.authorization().slice(7) }));
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const insert =
        typeof input.sql === 'string' &&
        input.sql.startsWith('INSERT INTO namespace_home_challenges ');
      const remove =
        typeof input.sql === 'string' &&
        input.sql.startsWith('DELETE FROM namespace_home_challenges ');
      if (request.url !== '/query' || request.method !== 'POST' || (!insert && !remove))
        throw new Error('Unexpected provider query');
      const result = await this.database
        .prepare(input.sql)
        .bind(...input.params)
        .all();
      if (insert) this.inserts += 1;
      if (remove) this.deletes += 1;
      if (insert && this.failInsertResponse) {
        response.writeHead(503).end('Injected lost INSERT response');
        return;
      }
      response.end(JSON.stringify({ success: true, result: [result] }));
    } catch {
      this.failures.push('provider fixture failure');
      response.writeHead(500).end();
    }
  }
}

async function runChallengeCli(
  providerOrigin: string,
  consoleOrigin: string,
): Promise<{ exitCode: number; stdout: string }> {
  try {
    const result = await execute(
      process.execPath,
      [
        '--import',
        path.join(root, 'tests/fixtures/tenant-deployment/home-challenge-transport.mjs'),
        path.join(root, 'scripts/tenant-cutover.mjs'),
        'verify-home',
        '--lane',
        lane,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: home.accountId,
          CLOUDFLARE_API_TOKEN: 'fixture-only',
          ACTIONS_ID_TOKEN_REQUEST_URL: `${providerOrigin}/oidc`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-only',
          TENANT_CHALLENGE_PROVIDER: providerOrigin,
          TENANT_CHALLENGE_CONSOLE: consoleOrigin,
        },
      },
    );
    return { exitCode: 0, stdout: result.stdout };
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'number')
      return { exitCode: error.code, stdout: '' };
    throw error;
  }
}

function writer(output: string, name: string, entry: string, database: string, databaseId: string) {
  return {
    name,
    modules: true,
    scriptPath: path.join(output, `${entry}.js`),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    bindings: {
      SEAMS_TENANT_STORAGE_NAMESPACE: namespace,
      SEAMS_TENANT_DEPLOYMENT_LANE: lane,
      SEAMS_D1_HOME_ACCOUNT_ID: home.accountId,
      SEAMS_D1_HOME_DATABASE_ID: databaseId,
    },
    d1Databases: { SIGNER_DB: database },
  };
}

function consoleWorker(output: string, name: string, walletRuntime: string, deps: Dependencies) {
  return {
    name,
    modules: true,
    scriptPath: path.join(output, 'console.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    bindings: consoleWorkerEnvironment({
      namespace,
      deploymentLane: lane,
      accountId: home.accountId,
      databaseId: home.databaseId,
    }),
    d1Databases: { CONSOLE_DB: 'console-authority' },
    serviceBindings: { WALLET_GATEWAY: 'gateway', WALLET_RUNTIME: walletRuntime },
    outboundService: deps.outbound.bind(deps),
  };
}

async function insertChallenge(database: D1DatabaseLike, issuedAtMs: number) {
  const challengeId = randomBytes(32).toString('hex');
  const expectedProof = randomBytes(32).toString('hex');
  await database
    .prepare('INSERT INTO namespace_home_challenges VALUES (?1,?2,?3,?4,?5,?6,?7)')
    .bind(
      namespace,
      challengeId,
      home.accountId,
      home.databaseId,
      expectedProof,
      issuedAtMs,
      issuedAtMs + 300_000,
    )
    .run();
  return { deploymentLane: lane, challengeId, expectedProof };
}

function requestInit(data: unknown, authorization: string) {
  return {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  };
}

test('Console verifies both real writer bindings against a fresh challenge and immutable reservation', async ({
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const output = testInfo.outputPath('workers');
  await mkdir(output, { recursive: true });
  const directory = path.join(root, 'packages/wallet-console-server-ts/src/router/cloudflare');
  await build({
    entryPoints: {
      console: path.join(directory, 'd1ConsoleStagingWorker.ts'),
      gateway: path.join(directory, 'd1GatewayWorker.ts'),
      runtime: path.join(directory, 'd1WalletRuntimeWorker.ts'),
    },
    outdir: output,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*'],
    loader: { '.wasm': 'file' },
    tsconfig: path.join(root, 'packages/wallet-console-server-ts/tsconfig.json'),
  });
  const deps = new Dependencies();
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    workers: [
      consoleWorker(output, 'console-good', 'runtime-good', deps),
      consoleWorker(output, 'console-wrong-database', 'runtime-wrong-database', deps),
      consoleWorker(output, 'console-wrong-config', 'runtime-wrong-config', deps),
      writer(output, 'gateway', 'gateway', 'database-a', home.databaseId),
      writer(output, 'runtime-good', 'runtime', 'database-a', home.databaseId),
      writer(output, 'runtime-wrong-database', 'runtime', 'database-b', home.databaseId),
      writer(
        output,
        'runtime-wrong-config',
        'runtime',
        'database-a',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ),
    ],
  });
  try {
    const authority = await runtime.getD1Database('CONSOLE_DB', 'console-good');
    const databaseA = await runtime.getD1Database('SIGNER_DB', 'gateway');
    const databaseB = await runtime.getD1Database('SIGNER_DB', 'runtime-wrong-database');
    if (
      !isD1DatabaseLike(authority) ||
      !isD1DatabaseLike(databaseA) ||
      !isD1DatabaseLike(databaseB)
    )
      throw new Error('D1 unavailable');
    const migrations = path.join(root, 'packages/wallet-console-server-ts/migrations/d1-console');
    for (const name of (await readdir(migrations)).sort()) {
      if (!name.endsWith('.sql')) continue;
      for (const sql of unstable_splitSqlQuery(await readFile(path.join(migrations, name), 'utf8')))
        await authority.prepare(sql).run();
    }
    const challengeMigration = await readFile(
      path.join(
        root,
        '../seams-wallet/packages/wallet-server/migrations/d1-signer/0040_namespace_home_challenges.sql',
      ),
      'utf8',
    );
    const signerMigrations = path.join(
      root,
      '../seams-wallet/packages/wallet-server/migrations/d1-signer',
    );
    const signerMigrationHashes = [];
    for (const name of (await readdir(signerMigrations)).sort()) {
      if (!name.endsWith('.sql')) continue;
      const migration = await readFile(path.join(signerMigrations, name), 'utf8');
      for (const database of [databaseA, databaseB]) {
        for (const sql of unstable_splitSqlQuery(migration)) await database.prepare(sql).run();
      }
      signerMigrationHashes.push({
        name,
        sha256: createHash('sha256').update(migration).digest('hex'),
      });
    }
    const good = await runtime.getWorker('console-good');
    const wrongDatabase = await runtime.getWorker('console-wrong-database');
    const wrongConfig = await runtime.getWorker('console-wrong-config');
    const gateway = await runtime.getWorker('gateway');
    const auth = deps.oidc.authorization();
    const challenge = await insertChallenge(databaseA, Date.now() - 100);
    expect(
      (
        await request.post(`${await runtime.ready}internal/tenant-deployment/v1/verify-home`, {
          data: challenge,
        })
      ).status(),
    ).toBe(401);
    const missing = await good.fetch(verifyUrl, requestInit(challenge, auth));
    expect(await missing.json()).toMatchObject({ code: 'namespace_home_unassigned' });
    await createD1TenantDeploymentServiceV1({ database: authority }).reserveNamespaceHome(home);
    const publicAttempt = await gateway.fetch(
      `https://gateway.example.test${challengePath}`,
      requestInit({ namespace, challengeId: challenge.challengeId }, ''),
    );
    expect(publicAttempt.status).toBe(404);
    const echoAttempt = await gateway.fetch(
      `https://tenant-deployment.internal${challengePath}`,
      requestInit(
        { namespace, challengeId: challenge.challengeId, expectedProof: challenge.expectedProof },
        '',
      ),
    );
    expect(echoAttempt.status).toBe(400);
    const wrong = await wrongDatabase.fetch(verifyUrl, requestInit(challenge, auth));
    expect(wrong.status).toBe(409);
    const configuredWrong = await wrongConfig.fetch(verifyUrl, requestInit(challenge, auth));
    expect(configuredWrong.status).toBe(409);
    const tampered = await good.fetch(
      verifyUrl,
      requestInit({ ...challenge, expectedProof: randomBytes(32).toString('hex') }, auth),
    );
    expect(await tampered.json()).toMatchObject({ code: 'namespace_home_conflict' });
    const success = await good.fetch(verifyUrl, requestInit(challenge, auth));
    const successText = await success.text();
    expect(success.status).toBe(200);
    expect(successText).not.toContain(challenge.expectedProof);
    expect(JSON.parse(successText)).toMatchObject({
      ok: true,
      result: {
        home: { namespace, accountId: home.accountId, databaseId: home.databaseId },
        verifiedWriters: ['gateway', 'wallet-runtime'],
        activationAuthorized: false,
      },
    });
    const expired = await insertChallenge(databaseA, Date.now() - 300_001);
    expect((await good.fetch(verifyUrl, requestInit(expired, auth))).status).toBe(409);
    const future = await insertChallenge(databaseA, Date.now() + 60_000);
    expect((await good.fetch(verifyUrl, requestInit(future, auth))).status).toBe(409);
    // A stale snapshot contains yesterday's proof; it cannot answer a new challenge ID.
    await databaseB
      .prepare('INSERT INTO namespace_home_challenges VALUES (?1,?2,?3,?4,?5,?6,?7)')
      .bind(
        namespace,
        challenge.challengeId,
        home.accountId,
        home.databaseId,
        challenge.expectedProof,
        Date.now() - 1000,
        Date.now() + 299_000,
      )
      .run();
    const fresh = await insertChallenge(databaseA, Date.now() - 100);
    expect((await wrongDatabase.fetch(verifyUrl, requestInit(fresh, auth))).status).toBe(409);
    await databaseA.prepare('DELETE FROM namespace_home_challenges').run();
    expect((await good.fetch(verifyUrl, requestInit(challenge, auth))).status).toBe(409);
    expect(
      await authority
        .prepare('SELECT COUNT(*) AS count FROM tenant_deployment_activations')
        .first('count'),
    ).toBe(0);
    expect(deps.unexpected).toEqual([]);
    const provider = new ChallengeProvider(databaseA, deps.oidc);
    const providerServer = createServer(provider.handle.bind(provider));
    providerServer.listen(0, '127.0.0.1');
    await once(providerServer, 'listening');
    const address = providerServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Provider fixture address missing');
    const providerOrigin = `http://127.0.0.1:${address.port}`;
    try {
      const completed = await runChallengeCli(providerOrigin, String(await runtime.ready));
      expect(completed.exitCode).toBe(0);
      expect(JSON.parse(completed.stdout)).toMatchObject({
        kind: 'tenant_d1_runtime_home_checkpoint_v1',
        activationAuthorized: false,
      });
      expect(
        await databaseA
          .prepare('SELECT COUNT(*) AS count FROM namespace_home_challenges')
          .first('count'),
      ).toBe(0);
      provider.failInsertResponse = true;
      expect((await runChallengeCli(providerOrigin, String(await runtime.ready))).exitCode).toBe(1);
      expect(
        await databaseA
          .prepare('SELECT COUNT(*) AS count FROM namespace_home_challenges')
          .first('count'),
      ).toBe(0);
      expect(provider.inserts).toBe(2);
      expect(provider.deletes).toBe(2);
      expect(provider.failures).toEqual([]);
    } finally {
      providerServer.close();
      await once(providerServer, 'close');
    }
    const evidence = {
      kind: 'runtime_home_challenge_e2e_v1',
      checkedAt: new Date().toISOString(),
      productionWorkers: ['Console', 'Gateway', 'Wallet Runtime'],
      signerDatabases: 2,
      challengeMigrationSha256: createHash('sha256').update(challengeMigration).digest('hex'),
      signerMigrationHashes,
      verified: JSON.parse(successText).result,
      rejected: [
        'unauthenticated',
        'missing reservation',
        'public request',
        'echo payload',
        'wrong database',
        'wrong configured home',
        'wrong proof',
        'expired',
        'future',
        'stale database copy',
        'deleted challenge',
      ],
      activationCount: 0,
      operatorCli: {
        successfulChallengeCleanedUp: true,
        lostInsertResponseCleanedUp: true,
        inserts: provider.inserts,
        deletes: provider.deletes,
      },
      providerResourceVerified: false,
      cloudflareUsed: false,
    };
    const evidencePath = testInfo.outputPath('runtime-home-challenge-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('runtime-home-challenge', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
