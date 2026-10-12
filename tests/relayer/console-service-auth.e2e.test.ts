import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  createWalletConsoleOpsClient,
  isD1DatabaseLike,
  type WalletConsoleServiceBinding,
} from '@seams/wallet-server/cloud-host';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { consoleWorkerEnvironment } from '../helpers/consoleWorkerEnvironment';
import { verifyUnactivatedConsoleOnboarding } from './console-onboarding.scenario';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1ConsoleApiKeyService } from '../../packages/console-server-ts/src/apiKeys/d1';
import { createD1ConsoleOrgProjectEnvService } from '../../packages/console-server-ts/src/orgProjectEnv/d1';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '../../packages/wallet-console-shared-ts/src/apiKeyScopes';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/wallet-console-shared-ts/src/tenant-root';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { WalletHomeCatalog, type WalletHomeAssignment } from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { WalletHomeServiceClient } from '../../packages/wallet-console-server-ts/src/walletPlacement/serviceClient';
import {
  deploymentResource,
  fourRegionBinding,
  readyActivation,
  regionalResourceProof,
  regionalResourceProofs,
  seedAdoptionRoot,
} from '../helpers/tenantDeploymentFixtures';
import { gatewaySetupInput } from '../fixtures/tenant-deployment/registrationHomeAdmission';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const namespace = 'console-service-auth-e2e';
const context = { orgId: 'org_console_preflight', actorUserId: 'fixture-owner' };
const projectId = 'console_preflight';
const environmentId = `${projectId}:dev`;
const origin = 'https://wallet.example.test';

class ExternalRequestGuard {
  readonly requests: string[] = [];

  fetch(request: Request): Response {
    this.requests.push(new URL(request.url).origin);
    return new Response('External dependencies are unavailable in this local preflight', {
      status: 503,
    });
  }
}

class LocalConsoleService implements WalletConsoleServiceBinding {
  readonly requests: { path: string; status: number }[] = [];
  lastDatabaseWork: { calls: number; statements: number } | null = null;
  failNextBatch = false;

  constructor(private readonly worker: Awaited<ReturnType<Miniflare['getWorker']>>) {}

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    if (this.failNextBatch) {
      request.headers.set('x-test-fail-d1-batch', 'true');
      this.failNextBatch = false;
    }
    const response = await this.worker.fetch(request.url, {
      method: request.method,
      headers: Array.from(request.headers.entries()),
      body: request.body === null ? undefined : await request.arrayBuffer(),
    });
    this.requests.push({ path: new URL(request.url).pathname, status: response.status });
    const calls = response.headers.get('x-test-d1-calls');
    const statements = response.headers.get('x-test-d1-statements');
    this.lastDatabaseWork =
      calls === null || statements === null
        ? null
        : { calls: Number(calls), statements: Number(statements) };
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: Array.from(response.headers.entries()),
    });
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function verifyRegistrationMutationTransactions(
  service: LocalConsoleService,
  database: Parameters<typeof createD1TenantDeploymentServiceV1>[0]['database'],
  assignment: WalletHomeAssignment,
) {
  const headers = {
    'Content-Type': 'application/json',
    'x-seams-writer-role': 'gateway',
    'x-seams-writer-version': assignment.home.databaseId,
    'x-seams-writer-account': assignment.home.accountId,
    'x-seams-writer-database': assignment.home.databaseId,
  };
  const wallet = assignment.wallet;
  const mutations = [
    {
      path: 'claim-passkey',
      body: {
        wallet,
        rpId: 'wallet.example.test',
        credentialIdB64u: randomBytes(32).toString('base64url'),
      },
    },
    {
      path: 'publish-routes',
      body: { wallet, locators: [{ kind: 'code', value: randomBytes(32).toString('base64url') }] },
    },
    {
      path: 'complete',
      body: {
        wallet,
        home: assignment.home,
        ceremonyId: assignment.registrationAllocation.ceremonyId,
        outcome: 'established',
        session: {
          kind: 'credential',
          walletId: wallet.walletId,
          digest: randomBytes(32).toString('base64url'),
          expiresAtMs: Date.now() + 60_000,
        },
      },
    },
  ];
  const observations = [];
  for (const mutation of mutations) {
    const url = `https://wallet-placement.internal/internal/wallet-placement/v1/${mutation.path}`;
    const body = JSON.stringify(mutation.body);
    const before = await registrationMutationState(database, wallet.namespace, wallet.walletId);
    const refused = await service.fetch(url, {
      method: 'POST',
      headers: { ...headers, 'x-seams-writer-version': 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
      body,
    });
    expect(refused.status).toBe(403);
    expect(service.lastDatabaseWork?.calls).toBe(1);
    expect(await registrationMutationState(database, wallet.namespace, wallet.walletId)).toEqual(
      before,
    );
    const accepted = await service.fetch(url, { method: 'POST', headers, body });
    expect(accepted.status, await accepted.text()).toBe(200);
    expect(service.lastDatabaseWork?.calls).toBe(1);
    observations.push({ operation: mutation.path, ...service.lastDatabaseWork });
    const replay = await service.fetch(url, { method: 'POST', headers, body });
    expect(replay.status, await replay.text()).toBe(200);
    expect(service.lastDatabaseWork?.calls).toBe(1);
  }
  expect(
    await database
      .prepare('SELECT COUNT(*) AS count FROM console_deployment_write_checks')
      .first<number>('count'),
  ).toBe(0);
  expect(
    await database
      .prepare('SELECT state FROM wallet_homes WHERE namespace = ? AND wallet_id = ?')
      .bind(wallet.namespace, wallet.walletId)
      .first<string>('state'),
  ).toBe('established');
  return {
    stage: 'registration_mutation_transactions',
    retiredWriterRejected: true,
    exactReplay: true,
    operations: observations,
  };
}

function registrationMutationState(
  database: Parameters<typeof createD1TenantDeploymentServiceV1>[0]['database'],
  namespace: string,
  walletId: string,
) {
  return database
    .prepare(
      `SELECT state,
    (SELECT COUNT(*) FROM wallet_passkey_claims WHERE namespace = ?1 AND wallet_id = ?2) AS claims,
    (SELECT COUNT(*) FROM wallet_routes WHERE namespace = ?1 AND wallet_id = ?2) AS routes,
    (SELECT COUNT(*) FROM wallet_session_locators WHERE namespace = ?1 AND wallet_id = ?2) AS sessions
    FROM wallet_homes WHERE namespace = ?1 AND wallet_id = ?2`,
    )
    .bind(namespace, walletId)
    .first();
}

test('production Console service bindings enforce durable credential changes and resolve environments', async () => {
  test.setTimeout(120_000);
  const testInfo = test.info();
  const output = testInfo.outputPath('workers');
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: {
      console: path.join(repoRoot, 'tests/fixtures/tenant-deployment/observedConsoleWorker.ts'),
      consumer: path.join(repoRoot, 'tests/fixtures/tenant-deployment/consoleOpsConsumer.ts'),
    },
    outdir: output,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*', 'cloudflare:*'],
    loader: { '.wasm': 'file' },
    tsconfig: path.join(repoRoot, 'packages/wallet-console-server-ts/tsconfig.json'),
    alias: process.env.SEAMS_WALLET_SERVER_CANDIDATE
      ? {
          '@seams/wallet-server/cloud-host': createRequire(
            path.resolve(process.env.SEAMS_WALLET_SERVER_CANDIDATE, 'package.json'),
          ).resolve('@seams/wallet-server/cloud-host'),
        }
      : {},
  });
  const guard = new ExternalRequestGuard();
  const consoleEnvironment = consoleWorkerEnvironment({
    namespace,
    deploymentLane: 'console-preflight',
    accountId: '0123456789abcdef0123456789abcdef',
    databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    workers: [
      {
        name: 'consumer',
        modules: true,
        modulesRoot: output,
        scriptPath: path.join(output, 'consumer.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        serviceBindings: { WALLET_CONSOLE: 'console' },
        outboundService: guard.fetch.bind(guard),
      },
      {
        name: 'console',
        modules: true,
        modulesRoot: output,
        scriptPath: path.join(output, 'console.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        bindings: consoleEnvironment,
        d1Databases: { CONSOLE_DB: 'console-service-auth-e2e' },
        serviceBindings: { WALLET_RUNTIME: guard.fetch.bind(guard) },
        outboundService: guard.fetch.bind(guard),
      },
    ],
  });
  const observations = [];
  const migrations = [];
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'console');
    if (!isD1DatabaseLike(database)) throw new Error('Local Console D1 binding is unavailable');
    const migrationDirectory = path.join(
      repoRoot,
      'packages/wallet-console-server-ts/migrations/d1-console',
    );
    for (const name of (await readdir(migrationDirectory)).sort()) {
      if (!name.endsWith('.sql')) continue;
      const sql = await readFile(path.join(migrationDirectory, name), 'utf8');
      for (const statement of unstable_splitSqlQuery(sql)) {
        await database.prepare(statement).run();
      }
      migrations.push({ name, sha256: sha256(sql) });
    }
    const sessionSecret = consoleEnvironment.CONSOLE_SESSION_HMAC_SECRET;
    if (!sessionSecret) throw new Error('Console fixture is missing its session secret');
    observations.push(
      await verifyUnactivatedConsoleOnboarding({
        service: new LocalConsoleService(await runtime.getWorker('console')),
        database,
        sessionSecret,
      }),
    );
    const organizations = await createD1ConsoleOrgProjectEnvService({
      database,
      namespace,
      ensureSchema: false,
    });
    await organizations.upsertOrganization(context, { name: 'Console preflight' });
    await organizations.createProject(context, { id: projectId, name: 'Console preflight' });
    const keys = await createD1ConsoleApiKeyService({
      database,
      namespace,
      ensureSchema: false,
      scopeValidation: WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
    });
    const credential = await keys.createApiKey(context, {
      kind: 'publishable_key',
      name: 'Local preflight',
      environmentId,
      allowedOrigins: [origin],
      rateLimitBucket: 'default',
      quotaBucket: 'default',
    });
    const consumer = await runtime.getWorker('consumer');
    const service = new LocalConsoleService(consumer);
    const client = createWalletConsoleOpsClient(service);
    // The Gateway sends its setup request with every registration-context call.
    const registration = gatewaySetupInput({
      operationId: `wreg_${randomBytes(32).toString('base64url')}`,
      origin,
    }).request;

    const accepted = await client.registrationContext.resolve({
      secret: credential.secret,
      origin,
      environmentId,
      registration,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error(`Console authentication failed: ${accepted.code}`);
    expect(accepted.principal.orgId).toBe(context.orgId);
    expect(accepted.principal.environmentId).toBe(environmentId);
    expect(accepted.environment.id).toBe(environmentId);
    expect(accepted.environment.projectId).toBe(projectId);
    expect(accepted.environment.status).toBe('ACTIVE');
    expect(service.requests).toEqual([
      { path: '/internal/wallet-console/v1/registration-context', status: 200 },
    ]);
    observations.push({
      stage: 'accepted',
      ok: accepted.ok,
      consoleRequests: service.requests.length,
    });

    const nowMs = Date.now();
    const deployments = createD1TenantDeploymentServiceV1({ database });
    const deployment = await deployments.putBinding(
      await fourRegionBinding(nowMs, 'console-preflight', {
        namespace,
        organizationId: context.orgId,
        projectId,
        environmentId,
      }),
    );
    const resource = deploymentResource(namespace, deployment.resources[0].databaseId);
    const activation = await readyActivation(
      deployments,
      deployment,
      resource,
      'tco_console_setup',
      null,
      nowMs,
    );
    const resourceVerifications = regionalResourceProofs(deployment, (resource) =>
      regionalResourceProof(
        deployment,
        resource.databaseId,
        resource.databaseId,
        relocationWriterVersion(resource.databaseId, 'walletRuntime'),
        nowMs,
      ),
    );
    await deployments.activateBinding({
      ...activation,
      resourceVerifications,
    });
    const catalog = WalletHomeCatalog.parse(
      JSON.parse(consoleEnvironment.SEAMS_WALLET_HOME_CATALOG_JSON),
    );
    const homes = new WalletHomeServiceClient(
      service,
      parseTenantRuntimeWriterV1('gateway', resource.databaseId, {
        accountId: resource.accountId,
        databaseId: resource.databaseId,
      }),
      deployment.tenant,
      catalog,
    );
    const setup = {
      secret: credential.secret,
      origin,
      environmentId,
      registration: gatewaySetupInput({
        operationId: `wreg_${randomBytes(32).toString('base64url')}`,
        origin,
      }).request,
    };
    const reserved = await homes.reserveAuthenticated(setup, 'APAC');
    expect(service.lastDatabaseWork).toEqual({ calls: 4, statements: 5 });
    observations.push({ stage: 'fresh_setup_database_work', ...service.lastDatabaseWork });
    expect(reserved).toMatchObject({ ok: true });
    if (!reserved.ok || !reserved.reservation.ok) throw new Error('Combined Console setup failed');
    expect(reserved.reservation.assignment.home.region).toBe('APAC');
    const retried = await homes.reserveAuthenticated(setup, 'WEUR');
    expect(retried).toMatchObject({
      ok: true,
      reservation: { ok: true, disposition: 'reused', assignment: reserved.reservation.assignment },
    });
    const refused = await homes.reserveAuthenticated(
      { ...setup, origin: 'https://untrusted.example.test' },
      'US',
    );
    expect(refused).toMatchObject({
      ok: false,
      context: { code: 'publishable_key_origin_blocked' },
    });
    observations.push({
      stage: 'combined_setup_and_foreign_retry',
      home: reserved.reservation.assignment.home.region,
      serviceRequests: service.requests.slice(-3),
      invalidOriginRefused: !refused.ok,
    });
    observations.push(await verifyRegistrationMutationTransactions(service, database, reserved.reservation.assignment));

    const homeCountBeforeFaults = await database
      .prepare('SELECT COUNT(*) AS count FROM wallet_homes WHERE namespace = ?')
      .bind(namespace)
      .first<number>('count');
    const faultSetup = {
      ...setup,
      registration: gatewaySetupInput({
        operationId: `wreg_${randomBytes(32).toString('base64url')}`,
        origin,
      }).request,
    };
    service.failNextBatch = true;
    await expect(homes.reserveAuthenticated(faultSetup, 'WEUR')).rejects.toThrow();
    observations.push({ stage: 'deployment_environment_batch_failure', accepted: false });
    const retiredHomes = new WalletHomeServiceClient(
      service,
      parseTenantRuntimeWriterV1('gateway', 'ffffffff-ffff-4fff-8fff-ffffffffffff', {
        accountId: resource.accountId,
        databaseId: resource.databaseId,
      }),
      deployment.tenant,
      catalog,
    );
    expect(await retiredHomes.reserveAuthenticated(faultSetup, 'APAC')).toMatchObject({
      ok: false,
    });
    expect(service.requests.at(-1)?.status).toBe(403);
    expect(service.lastDatabaseWork).toEqual({ calls: 1, statements: 2 });
    observations.push({ stage: 'retired_writer', accepted: false, ...service.lastDatabaseWork });
    expect(
      await database
        .prepare('SELECT COUNT(*) AS count FROM wallet_homes WHERE namespace = ?')
        .bind(namespace)
        .first<number>('count'),
    ).toBe(homeCountBeforeFaults);
    const usageTimestamp = await database
      .prepare('SELECT last_used_at_ms FROM api_keys WHERE namespace = ? AND id = ?')
      .bind(namespace, credential.apiKey.id)
      .first<number>('last_used_at_ms');
    expect(usageTimestamp).toBeGreaterThan(nowMs);
    observations.push({
      stage: 'setup_accounting',
      usageRecorded: true,
      faultReservationsCreated: 0,
    });

    const foreignContext = { orgId: 'org_foreign_setup', actorUserId: context.actorUserId };
    const foreignProjectId = 'foreign_setup';
    await organizations.upsertOrganization(foreignContext, { name: 'Other deployment' });
    await organizations.createProject(foreignContext, {
      id: foreignProjectId,
      name: 'Other deployment',
    });
    const foreignCredential = await keys.createApiKey(foreignContext, {
      kind: 'publishable_key',
      name: 'Other deployment',
      environmentId: `${foreignProjectId}:dev`,
      allowedOrigins: [origin],
      rateLimitBucket: 'default',
      quotaBucket: 'default',
    });
    expect(
      await homes.reserveAuthenticated(
        {
          ...setup,
          secret: foreignCredential.secret,
          environmentId: foreignCredential.apiKey.environmentId,
        },
        'APAC',
      ),
    ).toMatchObject({
      ok: false,
      context: { code: 'publishable_key_environment_mismatch' },
    });
    observations.push({ stage: 'foreign_deployment_key', accepted: false });

    const newVersion = `${accepted.environment.signingRootVersion}-updated`;
    await organizations.updateEnvironment(context, environmentId, { runtimeVersion: newVersion });
    const refreshed = await client.registrationContext.resolve({
      secret: credential.secret,
      origin,
      environmentId,
      registration,
    });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) throw new Error('Updated environment was unavailable');
    expect(refreshed.environment.signingRootVersion).toBe(newVersion);
    observations.push({
      stage: 'fresh_environment_version',
      version: refreshed.environment.signingRootVersion,
    });

    for (const scenario of [
      {
        secret: 'pk_r150_local_invalid',
        origin,
        environmentId,
        code: 'publishable_key_invalid',
      },
      {
        secret: credential.secret,
        origin: 'https://untrusted.example.test',
        environmentId,
        code: 'publishable_key_origin_blocked',
      },
      {
        secret: credential.secret,
        origin,
        environmentId: `${projectId}:prod`,
        code: 'publishable_key_environment_mismatch',
      },
    ]) {
      const result = await client.registrationContext.resolve({
        secret: scenario.secret,
        origin: scenario.origin,
        environmentId: scenario.environmentId,
        registration,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Console admitted a mismatched credential');
      expect(result.code).toBe(scenario.code);
      const setupResult = await homes.reserveAuthenticated(
        {
          ...setup,
          secret: scenario.secret,
          origin: scenario.origin,
          environmentId: scenario.environmentId,
        },
        'APAC',
      );
      expect(setupResult).toMatchObject({ ok: false, context: { code: scenario.code } });
      observations.push({ stage: scenario.code, ok: result.ok, status: result.status });
    }

    const environments = await client.projectEnvironments.listEnvironments(
      {
        orgId: accepted.principal.orgId,
        actorUserId: 'wallet-service',
        roles: [],
        projectId,
      },
      { status: 'ACTIVE' },
    );
    expect(environments).toHaveLength(1);
    expect(environments[0]).toMatchObject({
      id: environmentId,
      projectId,
      key: 'dev',
      status: 'ACTIVE',
    });
    observations.push({ stage: 'environments', count: environments.length });

    const serverCredential = await keys.createApiKey(context, {
      kind: 'secret_key',
      name: 'Concurrent service use',
      environmentId,
      scopes: ['accounts.create'],
    });
    const endpoint = '/wallets/register/setup';
    const authentications = [];
    for (let index = 0; index < 8; index += 1) {
      authentications.push(
        client.apiKeyAuth.authenticate({
          secret: serverCredential.secret,
          endpoint,
          environmentId,
          requiredScopes: ['accounts.create'],
        }),
      );
    }
    for (const result of await Promise.all(authentications)) expect(result.ok).toBe(true);
    const recordedUses = await database
      .prepare('SELECT endpoint_usage_counts_json FROM api_keys WHERE namespace = ? AND id = ?')
      .bind(namespace, serverCredential.apiKey.id)
      .first<string>('endpoint_usage_counts_json');
    expect(JSON.parse(recordedUses || '{}')).toEqual({ [endpoint]: 8 });
    observations.push({ stage: 'concurrent_authenticated_use', calls: 8, recordedUses: 8 });

    const lineageIdentity = {
      orgId: context.orgId,
      projectId,
      envId: environmentId,
      signingRootId: 'unprovisioned-root',
      signingRootVersion: environments[0].signingRootVersion,
    };
    const lineage = await client.tenantRootActiveLineage.resolveActiveLineage(lineageIdentity);
    expect(lineage).toBeNull();
    observations.push({ stage: 'unprovisioned_root', result: lineage });

    const lineageRoot = buildTenantRootIdentityFromAuthenticatedDeploymentV1(lineageIdentity);
    if (!lineageRoot.ok) throw new Error('Invalid tenant-root identity fixture');
    const createdRoot = await seedAdoptionRoot(database, namespace, lineageRoot.value);
    const createdLineage =
      await client.tenantRootActiveLineage.resolveActiveLineage(lineageIdentity);
    expect(createdLineage).toEqual({
      identityDigestB64u: createdRoot.identityDigestB64u,
      custodyLineageB64u: createdRoot.custodyLineageId,
    });
    observations.push({ stage: 'created_root', result: createdLineage });

    await database
      .prepare(
        'UPDATE tenant_root_creation_grants SET org_id = ? WHERE namespace = ? AND identity_digest_b64u = ?',
      )
      .bind('different-organization', namespace, createdRoot.identityDigestB64u)
      .run();
    await expect(
      client.tenantRootActiveLineage.resolveActiveLineage(lineageIdentity),
    ).rejects.toThrow();
    observations.push({ stage: 'conflicting_root_identity', rejected: true });
    await database
      .prepare(
        'UPDATE tenant_root_creation_grants SET org_id = ? WHERE namespace = ? AND identity_digest_b64u = ?',
      )
      .bind(context.orgId, namespace, createdRoot.identityDigestB64u)
      .run();
    expect(await client.tenantRootActiveLineage.resolveActiveLineage(lineageIdentity)).toEqual(
      createdLineage,
    );

    for (let delivery = 0; delivery < 2; delivery += 1) {
      await client.usageMeter.recordEvent({
        orgId: context.orgId,
        environmentId,
        apiKeyId: credential.apiKey.id,
        endpoint: '/wallets/register/commit',
        walletId: 'console-preflight-wallet',
        action: 'wallet_created',
        succeeded: true,
        sourceEventId: 'console-preflight-registration',
        occurredAt: '2026-10-01T00:00:00.000Z',
      });
    }
    const projection = await database
      .prepare(
        'SELECT id, project_id, environment_id FROM wallet_index WHERE namespace = ? AND org_id = ?',
      )
      .bind(namespace, context.orgId)
      .all();
    expect(projection.results).toHaveLength(2);
    expect(projection.results).toEqual(expect.arrayContaining([
      { id: reserved.reservation.assignment.wallet.walletId, project_id: projectId, environment_id: environmentId },
      { id: 'console-preflight-wallet', project_id: projectId, environment_id: environmentId },
    ]));
    const usage = await database
      .prepare(
        'SELECT COUNT(*) AS count FROM billing_monthly_active_resources WHERE namespace = ? AND org_id = ?',
      )
      .bind(namespace, context.orgId)
      .first<{ count: number }>();
    expect(usage?.count).toBe(0);
    observations.push({ stage: 'wallet_created_replay', projectionRows: 1, countedWallets: 0 });

    const rotated = await keys.rotateApiKey(context, credential.apiKey.id, {
      reason: 'Preflight rotation',
    });
    if (!rotated) throw new Error('Console credential rotation failed');
    const replaced = await client.registrationContext.resolve({
      secret: credential.secret,
      origin,
      environmentId,
      registration,
    });
    expect(replaced.ok).toBe(false);
    if (replaced.ok) throw new Error('Console admitted a replaced credential');
    expect(replaced.code).toBe('publishable_key_invalid');
    expect(await homes.reserveAuthenticated(setup, 'APAC')).toMatchObject({
      ok: false,
      context: { code: 'publishable_key_invalid' },
    });
    const replacement = await client.registrationContext.resolve({
      secret: rotated.secret,
      origin,
      environmentId,
      registration,
    });
    expect(replacement.ok).toBe(true);
    expect(
      await homes.reserveAuthenticated(
        {
          ...setup,
          secret: rotated.secret,
          registration: gatewaySetupInput({
            operationId: `wreg_${randomBytes(32).toString('base64url')}`,
            origin,
          }).request,
        },
        'OC',
      ),
    ).toMatchObject({
      ok: true,
      reservation: { ok: true, assignment: { home: { region: 'OC' } } },
      context: { environment: { signingRootVersion: newVersion } },
    });
    observations.push({ stage: 'rotation', oldAccepted: replaced.ok, newAccepted: replacement.ok });

    await keys.revokeApiKey(context, rotated.apiKey.id, { reason: 'Preflight revocation' });
    const revoked = await client.registrationContext.resolve({
      secret: rotated.secret,
      origin,
      environmentId,
      registration,
    });
    expect(revoked.ok).toBe(false);
    if (revoked.ok) throw new Error('Console admitted a revoked credential');
    expect(revoked.code).toBe('publishable_key_revoked');
    expect(
      await homes.reserveAuthenticated({ ...setup, secret: rotated.secret }, 'APAC'),
    ).toMatchObject({
      ok: false,
      context: { code: 'publishable_key_revoked' },
    });
    observations.push({ stage: 'revoked', ok: revoked.ok, status: revoked.status });
    const archiveCredential = await keys.createApiKey(context, {
      kind: 'publishable_key',
      name: 'Archive check',
      environmentId,
      allowedOrigins: [origin],
      rateLimitBucket: 'default',
      quotaBucket: 'default',
    });
    const beforeArchive = await client.registrationContext.resolve({
      secret: archiveCredential.secret,
      origin,
      environmentId,
      registration,
    });
    expect(beforeArchive.ok).toBe(true);
    await organizations.archiveEnvironment(context, environmentId);
    const archived = await client.registrationContext.resolve({
      secret: archiveCredential.secret,
      origin,
      environmentId,
      registration,
    });
    expect(archived.ok).toBe(false);
    if (archived.ok) throw new Error('Console admitted an archived environment');
    expect(archived.code).toBe('registration_environment_unavailable');
    expect(
      await homes.reserveAuthenticated({ ...setup, secret: archiveCredential.secret }, 'APAC'),
    ).toMatchObject({
      ok: false,
      context: { code: 'registration_environment_unavailable' },
    });
    observations.push({ stage: 'archived_environment', ok: archived.ok, status: archived.status });
    await database
      .prepare('DELETE FROM active_tenant_deployment_bindings WHERE deployment_lane = ?')
      .bind('console-preflight')
      .run();
    expect(await homes.reserveAuthenticated(setup, 'APAC')).toMatchObject({ ok: false });
    expect(service.requests.at(-1)?.status).toBe(503);
    expect(service.lastDatabaseWork).toEqual({ calls: 1, statements: 2 });
    observations.push({
      stage: 'missing_deployment',
      accepted: false,
      ...service.lastDatabaseWork,
    });
    expect(guard.requests).toEqual([]);

    const evidence = {
      kind: 'console_registration_context_e2e_v1',
      at: new Date().toISOString(),
      topology: 'Wallet Console client → consumer Worker → production Console Worker → local D1',
      walletServerPackageSha256: sha256(
        await readFile(
          path.join(
            process.env.SEAMS_WALLET_SERVER_CANDIDATE ??
              path.join(repoRoot, 'node_modules/@seams/wallet-server'),
            'package.json',
          ),
        ),
      ),
      consoleBundleSha256: sha256(await readFile(path.join(output, 'console.js'))),
      migrations,
      observations,
      serviceRequests: service.requests,
      externalRequests: guard.requests,
      verifiedSignatures: 0,
      regionalLatencyMeasured: false,
    };
    const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
    expect(evidenceText).not.toContain(credential.secret);
    expect(evidenceText).not.toContain(rotated.secret);
    expect(evidenceText).not.toContain(archiveCredential.secret);
    const evidencePath = testInfo.outputPath('console-service-auth-evidence.json');
    await writeFile(evidencePath, evidenceText);
    await testInfo.attach('console-service-auth-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
