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
import { createRequire } from 'node:module';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { consoleWorkerEnvironment } from '../helpers/consoleWorkerEnvironment';
import { TenantHomeVerificationV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/homeVerification';
import {
  deploymentResource,
  bindingForHome,
  productionBindingForHome,
  readyActivation,
} from '../helpers/tenantDeploymentFixtures';
import { GithubDeploymentOidcFixture } from '../helpers/githubDeploymentOidc';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deployment = JSON.parse(
  readFileSync(path.join(root, 'deployment/wallet-system/targets.json'), 'utf8'),
).production.lanes.testnet.provisioning.gatewayDeploymentConfig;
const namespace: string = deployment.tenant.namespace;
const lane = 'production-testnet';
const home = deploymentResource(namespace, deployment.resources.signerD1.id);
const secondResource = deploymentResource(namespace, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
const execute = promisify(execFile);
const challengePath = '/internal/tenant-deployment/v1/resource-challenge';
const verifyUrl = 'https://console.example.test/internal/tenant-deployment/v1/verify-resource';
const gatewayVersion = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runtimeVersion = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const changedVersion = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const deploymentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const candidatePackageRoot = process.env.SEAMS_WALLET_SERVER_CANDIDATE;

function candidatePackageAliases(packageRoot: string): Record<string, string> {
  const packagePath = path.resolve(packageRoot, 'package.json');
  const definition = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (definition.name !== '@seams/wallet-server') throw new Error('Wrong candidate package');
  const resolveCandidate = createRequire(packagePath);
  const aliases: Record<string, string> = {};
  for (const key of Object.keys(definition.exports)) {
    if (key.includes('*')) continue;
    const specifier = key === '.' ? definition.name : `${definition.name}/${key.slice(2)}`;
    aliases[specifier] = resolveCandidate.resolve(specifier);
  }
  return aliases;
}

type ProviderScenario =
  | 'stable'
  | 'changed_deployment'
  | 'changed_version'
  | 'wrong_version'
  | 'gradual';

class Dependencies {
  readonly oidc = new GithubDeploymentOidcFixture();
  readonly unexpected: string[] = [];
  readonly prewarmRequests: { method: string; pathname: string; authenticated: boolean }[] = [];

  prewarm(request: Request): Response {
    this.prewarmRequests.push({
      method: request.method,
      pathname: new URL(request.url).pathname,
      authenticated: request.headers.get('x-router-ab-internal-service-auth') === 'fixture-prewarm',
    });
    return Response.json({ ok: true });
  }

  outbound(request: Request): Response {
    if (request.url === 'https://token.actions.githubusercontent.com/.well-known/jwks')
      return this.oidc.jwks();
    this.unexpected.push(request.url);
    return new Response('Unexpected outbound request', { status: 503 });
  }
}

class GatewaySmokeServer {
  constructor(readonly runtime: Miniflare) {}

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const name = request.url === '/changed' ? 'gateway-changed' : 'gateway';
    try {
      const gateway = await this.runtime.getWorker(name);
      const result = await gateway.fetch(
        'https://gateway.example.test/.well-known/seams-tenant-deployment.json',
      );
      response.writeHead(result.status);
      response.end(await result.text());
    } catch {
      response.writeHead(500);
      response.end('Worker refused admission');
    }
  }
}

async function smokeGateway(origin: string, route: string) {
  const result = await execute(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { isWalletSystemDeploymentReady, runReadinessChecks } from './scripts/deployment-smoke.mjs';
const results = await runReadinessChecks(
  [{ name: 'Gateway projection', url: process.env.SMOKE_URL, isReady: isWalletSystemDeploymentReady }],
  { budgetMs: 0, intervalMs: 0 },
);
process.stdout.write(JSON.stringify(results));`,
    ],
    { cwd: root, env: { ...process.env, SMOKE_URL: `${origin}${route}` } },
  );
  return JSON.parse(result.stdout);
}

class ChallengeProvider {
  scenario: ProviderScenario = 'stable';
  challengeWritten = false;
  reads = 0;
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
      if (request.method === 'GET') {
        this.readProvider(request, response);
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const insert =
        typeof input.sql === 'string' &&
        input.sql.startsWith('INSERT INTO deployment_resource_challenges ');
      const remove =
        typeof input.sql === 'string' &&
        input.sql.startsWith('DELETE FROM deployment_resource_challenges ');
      if (request.url !== '/query' || request.method !== 'POST' || (!insert && !remove))
        throw new Error('Unexpected provider query');
      const result = await this.database
        .prepare(input.sql)
        .bind(...input.params)
        .all();
      if (insert) {
        this.inserts += 1;
        this.challengeWritten = true;
      }
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

  readProvider(request: IncomingMessage, response: ServerResponse): void {
    const match = request.url?.match(
      /\/workers\/scripts\/(seams-sdk-d1-(gateway|wallet-runtime)-testnet)\/(deployments|versions\/[a-f0-9-]+)$/u,
    );
    if (!match) throw new Error('Unexpected provider read');
    this.reads += 1;
    const changed = this.challengeWritten && this.scenario === 'changed_version';
    let versionId = match[2] === 'gateway' ? gatewayVersion : runtimeVersion;
    if (changed || this.scenario === 'wrong_version') versionId = changedVersion;
    if (match[3] === 'deployments') {
      const versions =
        this.scenario === 'gradual'
          ? [
              { version_id: versionId, percentage: 75 },
              { version_id: changedVersion, percentage: 25 },
            ]
          : [{ version_id: versionId, percentage: 100 }];
      const id =
        this.challengeWritten && this.scenario === 'changed_deployment'
          ? changedVersion
          : deploymentId;
      response.end(
        JSON.stringify({
          success: true,
          result: { deployments: [{ id, strategy: 'percentage', versions }] },
        }),
      );
      return;
    }
    response.end(
      JSON.stringify({
        success: true,
        result: {
          id: match[3].slice('versions/'.length),
          resources: { bindings: [{ name: 'SIGNER_DB', type: 'd1', id: home.databaseId }] },
        },
      }),
    );
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
        path.join(root, 'tests/fixtures/tenant-deployment/resource-challenge-transport.mjs'),
        path.join(root, 'scripts/tenant-cutover.mjs'),
        'verify-resource',
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

function writer(
  output: string,
  deps: Dependencies,
  name: string,
  entry: string,
  database: string,
  databaseId: string,
  versionId: string | null,
) {
  return {
    name,
    modules: true,
    scriptPath: path.join(output, `${entry}.js`),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    bindings: {
      CF_VERSION_METADATA: versionId === null ? null : { id: versionId },
      ROUTER_AB_PREWARM_ENABLED: 'true',
      ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: 'fixture-prewarm',
      SEAMS_TENANT_STORAGE_NAMESPACE: namespace,
      SEAMS_TENANT_DEPLOYMENT_LANE: lane,
      SEAMS_D1_HOME_ACCOUNT_ID: home.accountId,
      SEAMS_D1_HOME_DATABASE_ID: databaseId,
    },
    d1Databases: { SIGNER_DB: database },
    serviceBindings: { WALLET_CONSOLE: 'console-good', MPC_ROUTER: deps.prewarm.bind(deps) },
  };
}

function consoleWorker(
  output: string,
  name: string,
  walletRuntime: string,
  deps: Dependencies,
  resource: typeof home,
  gateway: string,
) {
  return {
    name,
    modules: true,
    scriptPath: path.join(output, 'console.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    bindings: {
      ...consoleWorkerEnvironment({
        namespace,
        deploymentLane: lane,
        accountId: resource.accountId,
        databaseId: resource.databaseId,
      }),
      SEAMS_WALLET_HOME_CATALOG_JSON: JSON.stringify([
        {
          region: 'US',
          accountId: home.accountId,
          databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        { region: 'WEUR', accountId: home.accountId, databaseId: home.databaseId },
        {
          region: 'APAC',
          accountId: home.accountId,
          databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      ]),
    },
    d1Databases: { CONSOLE_DB: 'console-authority' },
    serviceBindings: { WALLET_GATEWAY: gateway, WALLET_RUNTIME: walletRuntime },
    outboundService: deps.outbound.bind(deps),
  };
}

async function insertChallenge(
  database: D1DatabaseLike,
  issuedAtMs: number,
  resource: typeof home,
) {
  const challengeId = randomBytes(32).toString('hex');
  const expectedProof = randomBytes(32).toString('hex');
  await database
    .prepare('INSERT INTO deployment_resource_challenges VALUES (?1,?2,?3,?4,?5,?6,?7)')
    .bind(
      namespace,
      challengeId,
      resource.accountId,
      resource.databaseId,
      expectedProof,
      issuedAtMs,
      issuedAtMs + 300_000,
    )
    .run();
  return { deploymentLane: lane, challengeId, expectedProof };
}

function fixedNow(timestamp: number): Date {
  return new Date(timestamp);
}

function requestInit(data: unknown, authorization: string) {
  return {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  };
}

async function signerDatabaseDigest(database: D1DatabaseLike): Promise<string> {
  const tables = await database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name",
    )
    .all<{ name: string }>();
  const digest = createHash('sha256');
  for (const table of tables.results ?? []) {
    const name = table.name.replaceAll('"', '""');
    const rows = await database.prepare(`SELECT * FROM "${name}"`).all();
    const records: string[] = [];
    for (const row of rows.results ?? []) records.push(JSON.stringify(row));
    records.sort();
    digest.update(JSON.stringify([table.name, records]));
  }
  return digest.digest('hex');
}

test('Console verifies both regional writer bindings against a fresh challenge', async ({
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const output = testInfo.outputPath('workers');
  await mkdir(output, { recursive: true });
  const directory = path.join(root, 'packages/wallet-console-server-ts/src/router/cloudflare');
  const bundle = await build({
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
    external: ['node:*', 'cloudflare:workers'],
    loader: { '.wasm': 'file' },
    alias: candidatePackageRoot ? candidatePackageAliases(candidatePackageRoot) : {},
    metafile: true,
    tsconfig: path.join(root, 'packages/wallet-console-server-ts/tsconfig.json'),
  });
  if (candidatePackageRoot) {
    for (const input of Object.keys(bundle.metafile.inputs)) {
      expect(path.resolve(input)).not.toContain(
        path.join(root, 'node_modules/@seams/wallet-server/'),
      );
    }
  }
  await writeFile(testInfo.outputPath('worker-build-inputs.json'), JSON.stringify(bundle.metafile));
  const deps = new Dependencies();
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    workers: [
      consoleWorker(output, 'console-good', 'runtime-good', deps, home, 'gateway'),
      consoleWorker(
        output,
        'console-wrong-database',
        'runtime-wrong-database',
        deps,
        home,
        'gateway',
      ),
      consoleWorker(output, 'console-wrong-config', 'runtime-wrong-config', deps, home, 'gateway'),
      consoleWorker(
        output,
        'console-missing-version',
        'runtime-missing-version',
        deps,
        home,
        'gateway',
      ),
      consoleWorker(
        output,
        'console-second-resource',
        'runtime-second-resource',
        deps,
        secondResource,
        'gateway-second-resource',
      ),
      writer(
        output,
        deps,
        'gateway-second-resource',
        'gateway',
        'database-b',
        secondResource.databaseId,
        changedVersion,
      ),
      writer(
        output,
        deps,
        'runtime-second-resource',
        'runtime',
        'database-b',
        secondResource.databaseId,
        deploymentId,
      ),
      writer(output, deps, 'gateway', 'gateway', 'database-a', home.databaseId, gatewayVersion),
      writer(
        output,
        deps,
        'gateway-changed',
        'gateway',
        'database-a',
        home.databaseId,
        changedVersion,
      ),
      writer(
        output,
        deps,
        'runtime-good',
        'runtime',
        'database-a',
        home.databaseId,
        runtimeVersion,
      ),
      writer(
        output,
        deps,
        'runtime-changed',
        'runtime',
        'database-a',
        home.databaseId,
        changedVersion,
      ),
      writer(
        output,
        deps,
        'runtime-wrong-database',
        'runtime',
        'database-b',
        home.databaseId,
        runtimeVersion,
      ),
      writer(
        output,
        deps,
        'runtime-missing-version',
        'runtime',
        'database-a',
        home.databaseId,
        null,
      ),
      writer(
        output,
        deps,
        'runtime-wrong-config',
        'runtime',
        'database-a',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        runtimeVersion,
      ),
    ],
  });
  const smoke = new GatewaySmokeServer(runtime);
  const smokeServer = createServer(smoke.handle.bind(smoke));
  smokeServer.listen(0, '127.0.0.1');
  await once(smokeServer, 'listening');
  const smokeAddress = smokeServer.address();
  if (!smokeAddress || typeof smokeAddress === 'string') throw new Error('Smoke address missing');
  const smokeOrigin = `http://127.0.0.1:${smokeAddress.port}`;
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
    const signerMigrations = path.join(
      candidatePackageRoot ?? path.join(root, '../seams-wallet/packages/wallet-server'),
      'migrations/d1-signer',
    );
    const challengeMigration = await readFile(
      path.join(signerMigrations, '0042_deployment_resource_challenges.sql'),
      'utf8',
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
    const missingVersion = await runtime.getWorker('console-missing-version');
    const gateway = await runtime.getWorker('gateway');
    const auth = deps.oidc.authorization();
    const challenge = await insertChallenge(databaseA, Date.now() - 100, home);
    expect(
      (
        await request.post(`${await runtime.ready}internal/tenant-deployment/v1/verify-resource`, {
          data: challenge,
        })
      ).status(),
    ).toBe(401);
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
    expect((await missingVersion.fetch(verifyUrl, requestInit(challenge, auth))).status).toBe(409);
    const tampered = await good.fetch(
      verifyUrl,
      requestInit({ ...challenge, expectedProof: randomBytes(32).toString('hex') }, auth),
    );
    expect(await tampered.json()).toMatchObject({ code: 'deployment_resource_conflict' });
    const [success, concurrent, retry] = await Promise.all([
      good.fetch(verifyUrl, requestInit(challenge, auth)),
      good.fetch(verifyUrl, requestInit(challenge, auth)),
      good.fetch(verifyUrl, requestInit(challenge, auth)),
    ]);
    expect(concurrent.status).toBe(200);
    expect(retry.status).toBe(200);
    const successText = await success.text();
    expect(success.status).toBe(200);
    expect(successText).not.toContain(challenge.expectedProof);
    expect(JSON.parse(successText)).toMatchObject({
      ok: true,
      result: {
        resource: { namespace, accountId: home.accountId, databaseId: home.databaseId },
        writerVersions: { gateway: gatewayVersion, walletRuntime: runtimeVersion },
        activationAuthorized: false,
      },
    });
    // The same tenant can prove independent physical resources without assigning a wallet.
    const secondChallenge = await insertChallenge(databaseB, Date.now() - 100, secondResource);
    const secondConsole = await runtime.getWorker('console-second-resource');
    const secondResponse = await secondConsole.fetch(verifyUrl, requestInit(secondChallenge, auth));
    expect(secondResponse.status).toBe(200);
    const secondCheckpoint: unknown = await secondResponse.json();
    expect(secondCheckpoint).toMatchObject({
      ok: true,
      result: {
        resource: secondResource,
        writerVersions: { gateway: changedVersion, walletRuntime: deploymentId },
        activationAuthorized: false,
      },
    });
    expect((await good.fetch(verifyUrl, requestInit(secondChallenge, auth))).status).toBe(409);
    expect((await secondConsole.fetch(verifyUrl, requestInit(challenge, auth))).status).toBe(409);
    for (const database of [databaseA, databaseB]) {
      expect(
        await database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'namespace_home_challenges' OR name = 'namespace_home_challenges_expiry_idx'",
          )
          .first('count'),
      ).toBe(0);
    }
    const expired = await insertChallenge(databaseA, Date.now() - 300_001, home);
    expect((await good.fetch(verifyUrl, requestInit(expired, auth))).status).toBe(409);
    const future = await insertChallenge(databaseA, Date.now() + 60_000, home);
    expect((await good.fetch(verifyUrl, requestInit(future, auth))).status).toBe(409);
    // A stale snapshot contains yesterday's proof; it cannot answer a new challenge ID.
    await databaseB
      .prepare('INSERT INTO deployment_resource_challenges VALUES (?1,?2,?3,?4,?5,?6,?7)')
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
    const fresh = await insertChallenge(databaseA, Date.now() - 100, home);
    expect((await wrongDatabase.fetch(verifyUrl, requestInit(fresh, auth))).status).toBe(409);
    await databaseA.prepare('DELETE FROM deployment_resource_challenges').run();
    expect((await good.fetch(verifyUrl, requestInit(challenge, auth))).status).toBe(409);
    expect(
      await authority
        .prepare('SELECT COUNT(*) AS count FROM tenant_deployment_activations')
        .first('count'),
    ).toBe(0);
    expect(deps.unexpected).toEqual([]);
    const beforeActivation = await smokeGateway(smokeOrigin, '/');
    expect(beforeActivation).toEqual([
      { name: 'Gateway projection', ok: false, status: 503, attempts: 1 },
    ]);
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
        kind: 'tenant_d1_resource_checkpoint_v1',
        writerVersions: { gateway: gatewayVersion, walletRuntime: runtimeVersion },
        runtimeChallengeVerified: true,
        activationAuthorized: false,
      });
      expect(provider.reads).toBe(12);
      expect(
        await databaseA
          .prepare('SELECT COUNT(*) AS count FROM deployment_resource_challenges')
          .first('count'),
      ).toBe(0);
      const verification = TenantHomeVerificationV1.fromOperatorCheckpoint(
        JSON.parse(completed.stdout),
        Date.now(),
      );
      const store = createD1TenantDeploymentServiceV1({ database: authority });
      const candidate = await store.putBinding(await bindingForHome(Date.now(), lane, home));
      const ready = await readyActivation(
        store,
        candidate,
        home,
        'tco_verified_home',
        null,
        Date.now(),
      );
      const input = { ...ready, homeVerification: verification };
      const activated = await store.activateBinding(input);
      const placementUrl = 'https://wallet-placement.internal/internal/wallet-placement/v1';
      const placementWallet = { ...candidate.tenant, walletId: 'writer-admission-wallet' };
      const placementBody = {
        allocation: 'provided',
        wallet: placementWallet,
        ingressRegion: 'WEUR',
        registrationId: 'writer-admission-registration',
        requestDigest: 'a'.repeat(64),
        registrationAllocation: {
          ceremonyId: 'wrc_writer-admission',
          preparationId: 'regprep_writer-admission',
          walletAuthorityId: 'wallet-authority:writer-admission',
          deviceId: 'device:writer-admission',
          walletAuthMethodId: 'wallet-auth-method:writer-admission',
        },
      };
      const missingPlacementWriter = await good.fetch(`${placementUrl}/reserve`, {
        method: 'POST',
        body: JSON.stringify(placementBody),
      });
      expect(missingPlacementWriter.status).toBe(403);
      const stalePlacementWriter = await good.fetch(`${placementUrl}/reserve`, {
        method: 'POST',
        headers: {
          'x-seams-writer-role': 'gateway',
          'x-seams-writer-version': changedVersion,
        },
        body: JSON.stringify(placementBody),
      });
      expect(stalePlacementWriter.status).toBe(403);
      const authorizedPlacementWriter = await good.fetch(`${placementUrl}/reserve`, {
        method: 'POST',
        headers: {
          'x-seams-writer-role': 'gateway',
          'x-seams-writer-version': gatewayVersion,
        },
        body: JSON.stringify(placementBody),
      });
      expect(authorizedPlacementWriter.status).toBe(200);
      expect(await authorizedPlacementWriter.json()).toMatchObject({
        assignment: { wallet: placementWallet, home: { region: 'WEUR' } },
      });
      await writeFile(
        testInfo.outputPath('wallet-home-writer-admission.json'),
        `${JSON.stringify(
          {
            missingWriterStatus: missingPlacementWriter.status,
            staleWriterStatus: stalePlacementWriter.status,
            authorizedWriterStatus: authorizedPlacementWriter.status,
            gatewayVersion,
            changedVersion,
          },
          null,
          2,
        )}\n`,
      );
      const afterActivation = await smokeGateway(smokeOrigin, '/');
      expect(afterActivation).toEqual([
        { name: 'Gateway projection', ok: true, status: 200, attempts: 1 },
      ]);
      const changedWriter = await smokeGateway(smokeOrigin, '/changed');
      expect(changedWriter).toEqual([
        { name: 'Gateway projection', ok: false, status: 500, attempts: 1 },
      ]);
      await writeFile(
        testInfo.outputPath('activation-smoke-evidence.json'),
        `${JSON.stringify({ beforeActivation, afterActivation, changedWriter }, null, 2)}\n`,
      );
      expect(await store.activateBinding(input)).toEqual(activated);
      const expiredStore = createD1TenantDeploymentServiceV1({
        database: authority,
        now: fixedNow.bind(null, verification.expiresAtMs + 1),
      });
      expect(await expiredStore.activateBinding(input)).toEqual(activated);
      const projection = await gateway.fetch(
        'https://gateway.example.test/.well-known/seams-tenant-deployment.json',
      );
      expect(projection.status).toBe(200);
      const changedGateway = await runtime.getWorker('gateway-changed');
      await expect(
        changedGateway.fetch(
          'https://gateway.example.test/.well-known/seams-tenant-deployment.json',
        ),
      ).rejects.toThrow();
      const signerStateBefore = await signerDatabaseDigest(databaseA);
      const rejectedWriterRequests = [];
      for (const name of ['gateway-changed', 'runtime-changed']) {
        const staleWriter = await runtime.getWorker(name);
        for (const pathname of [
          '/wallets/register/setup',
          '/wallets/fixture-wallet/auth-methods/intent',
        ]) {
          await expect(
            staleWriter.fetch(`https://wallet.example.test${pathname}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-seams-wallet-protocol': '2' },
              body: '{',
            }),
          ).rejects.toThrow('Runtime version is not authorized by the active home verification');
          rejectedWriterRequests.push({ writer: name, method: 'POST', pathname });
        }
      }
      const admittedSchedule = await gateway.scheduled({ cron: '* * * * *' });
      expect(admittedSchedule.outcome).toBe('ok');
      expect(deps.prewarmRequests).toEqual([
        { method: 'POST', pathname: '/internal/prewarm', authenticated: true },
      ]);
      const rejectedSchedule = await changedGateway.scheduled({ cron: '* * * * *' });
      expect(rejectedSchedule.outcome).toBe('exception');
      expect(deps.prewarmRequests).toHaveLength(1);
      await writeFile(
        testInfo.outputPath('scheduled-writer-admission.json'),
        `${JSON.stringify({ admittedSchedule, rejectedSchedule, prewarmRequests: deps.prewarmRequests }, null, 2)}\n`,
      );
      const signerStateAfter = await signerDatabaseDigest(databaseA);
      expect(signerStateAfter).toBe(signerStateBefore);
      await writeFile(
        testInfo.outputPath('stale-writer-admission.json'),
        `${JSON.stringify({ rejectedWriterRequests, signerStateBefore, signerStateAfter }, null, 2)}\n`,
      );
      for (const role of ['gateway', 'walletRuntime']) {
        const versionId = role === 'gateway' ? gatewayVersion : runtimeVersion;
        const admitted = await good.fetch(
          'https://tenant-deployment.internal/internal/tenant-deployment/v1/active',
          {
            headers: { 'x-seams-writer-role': role, 'x-seams-writer-version': versionId },
          },
        );
        expect(admitted.status).toBe(200);
      }
      const replay = await readyActivation(
        store,
        candidate,
        home,
        'tco_replayed_home',
        {
          revision: candidate.revision,
          activationSequence: 1,
        },
        Date.now(),
      );
      await expect(
        store.activateBinding({ ...replay, homeVerification: verification }),
      ).rejects.toMatchObject({ code: 'activation_conflict' });
      await expect(
        expiredStore.activateBinding({ ...replay, homeVerification: verification }),
      ).rejects.toMatchObject({ code: 'readiness_invalid' });
      expect((await store.findActiveBinding(lane))?.activationSequence).toBe(1);
      const recorded = await authority
        .prepare(
          'SELECT home_verification_json FROM tenant_deployment_activations WHERE operation_id = ?1',
        )
        .bind(input.operationId)
        .first('home_verification_json');
      expect(typeof recorded).toBe('string');
      await writeFile(testInfo.outputPath('activated-home-verification.json'), String(recorded));
      const productionCandidate = await store.putBinding(
        await productionBindingForHome(Date.now(), 'production-proof-lane', home),
      );
      const localAttempt = await readyActivation(
        store,
        productionCandidate,
        home,
        'tco_local_proof_for_production',
        null,
        Date.now(),
      );
      await expect(store.activateBinding(localAttempt)).rejects.toMatchObject({
        code: 'activation_conflict',
      });
      expect(await store.findActiveBinding(productionCandidate.deploymentLane)).toBeNull();
      provider.failInsertResponse = true;
      expect((await runChallengeCli(providerOrigin, String(await runtime.ready))).exitCode).toBe(1);
      expect(
        await databaseA
          .prepare('SELECT COUNT(*) AS count FROM deployment_resource_challenges')
          .first('count'),
      ).toBe(0);
      expect(provider.inserts).toBe(2);
      expect(provider.deletes).toBe(2);
      provider.failInsertResponse = false;
      const scenarios: ProviderScenario[] = [
        'wrong_version',
        'changed_deployment',
        'changed_version',
        'gradual',
      ];
      for (const scenario of scenarios) {
        provider.scenario = scenario;
        provider.challengeWritten = false;
        const insertsBefore = provider.inserts;
        const rejected = await runChallengeCli(providerOrigin, String(await runtime.ready));
        expect(rejected.exitCode, scenario).toBe(1);
        expect(rejected.stdout, scenario).toBe('');
        expect(provider.inserts - insertsBefore, scenario).toBe(scenario === 'gradual' ? 0 : 1);
        expect(
          await databaseA
            .prepare('SELECT COUNT(*) AS count FROM deployment_resource_challenges')
            .first('count'),
          scenario,
        ).toBe(0);
      }
      expect(provider.inserts).toBe(5);
      expect(provider.deletes).toBe(5);
      expect(provider.failures).toEqual([]);
      await writeFile(testInfo.outputPath('combined-home-checkpoint.json'), completed.stdout);
    } finally {
      providerServer.close();
      await once(providerServer, 'close');
    }
    const evidence = {
      kind: 'runtime_home_challenge_e2e_v1',
      checkedAt: new Date().toISOString(),
      productionWorkers: ['Console', 'Gateway', 'Wallet Runtime'],
      walletServerArtifact: candidatePackageRoot
        ? {
            kind: 'packed_candidate',
            packageJsonSha256: createHash('sha256')
              .update(await readFile(path.join(candidatePackageRoot, 'package.json')))
              .digest('hex'),
            manifestSha256: createHash('sha256')
              .update(await readFile(path.join(candidatePackageRoot, 'artifact-manifest.json')))
              .digest('hex'),
          }
        : { kind: 'installed_sdk_with_source_migrations' },
      signerDatabases: 2,
      independentResourceCheckpoint: secondCheckpoint,
      crossResourceProofsRejected: true,
      obsoleteChallengeSchemaRemoved: true,
      challengeMigrationSha256: createHash('sha256').update(challengeMigration).digest('hex'),
      signerMigrationHashes,
      verified: JSON.parse(successText).result,
      rejected: [
        'unauthenticated',
        'public request',
        'echo payload',
        'wrong database',
        'wrong configured home',
        'wrong proof',
        'expired',
        'future',
        'stale database copy',
        'deleted challenge',
        'missing version metadata',
      ],
      activationCount: 1,
      automaticHomeAssignment: { concurrentRequests: 3, invalidProofsLeftUnassigned: true },
      singleUseChallenge: true,
      localProofRejectedForProductionBinding: true,
      expiredCompletedRetrySucceeded: true,
      changedGatewayVersionRejected: true,
      bothWriterRolesAdmitted: true,
      operatorCli: {
        successfulChallengeCleanedUp: true,
        lostInsertResponseCleanedUp: true,
        versionScenariosRejected: [
          'wrong_version',
          'changed_deployment',
          'changed_version',
          'gradual',
        ],
        inserts: provider.inserts,
        deletes: provider.deletes,
      },
      providerResourceVerified: false,
      cloudflareUsed: false,
    };
    const evidencePath = testInfo.outputPath('runtime-resource-challenge-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('runtime-resource-challenge', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    smokeServer.close();
    await once(smokeServer, 'close');
    await runtime.dispose();
  }
});
