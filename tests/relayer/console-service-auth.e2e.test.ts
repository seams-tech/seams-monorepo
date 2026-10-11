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
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1ConsoleApiKeyService } from '../../packages/console-server-ts/src/apiKeys/d1';
import { createD1ConsoleOrgProjectEnvService } from '../../packages/console-server-ts/src/orgProjectEnv/d1';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '../../packages/wallet-console-shared-ts/src/apiKeyScopes';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { WalletHomeCatalog } from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { WalletHomeServiceClient } from '../../packages/wallet-console-server-ts/src/walletPlacement/serviceClient';
import {
  deploymentResource,
  fourRegionBinding,
  readyActivation,
  regionalResourceProof,
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

  constructor(private readonly worker: Awaited<ReturnType<Miniflare['getWorker']>>) {}

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const response = await this.worker.fetch(request.url, {
      method: request.method,
      headers: Array.from(request.headers.entries()),
      body: request.body === null ? undefined : await request.arrayBuffer(),
    });
    this.requests.push({ path: new URL(request.url).pathname, status: response.status });
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: Array.from(response.headers.entries()),
    });
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

test('production Console service bindings enforce durable credential changes and resolve environments', async () => {
  test.setTimeout(120_000);
  const testInfo = test.info();
  const output = testInfo.outputPath('workers');
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: {
      console: path.join(
        repoRoot,
        'packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleStagingWorker.ts',
      ),
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

    const accepted = await client.registrationContext.resolve({
      secret: credential.secret,
      origin,
      environmentId,
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
    const resourceVerifications = [];
    for (const resource of deployment.resources) {
      resourceVerifications.push(
        regionalResourceProof(
          deployment,
          resource.databaseId,
          resource.databaseId,
          relocationWriterVersion(resource.databaseId, 'walletRuntime'),
          nowMs,
        ),
      );
    }
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

    const newVersion = `${accepted.environment.signingRootVersion}-updated`;
    await organizations.updateEnvironment(context, environmentId, { runtimeVersion: newVersion });
    const refreshed = await client.registrationContext.resolve({
      secret: credential.secret,
      origin,
      environmentId,
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
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Console admitted a mismatched credential');
      expect(result.code).toBe(scenario.code);
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

    const createdRoot = await seedAdoptionRoot(database, namespace, lineageIdentity);
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
    expect(projection.results).toEqual([
      { id: 'console-preflight-wallet', project_id: projectId, environment_id: environmentId },
    ]);
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
    });
    expect(replaced.ok).toBe(false);
    if (replaced.ok) throw new Error('Console admitted a replaced credential');
    expect(replaced.code).toBe('publishable_key_invalid');
    const replacement = await client.registrationContext.resolve({
      secret: rotated.secret,
      origin,
      environmentId,
    });
    expect(replacement.ok).toBe(true);
    observations.push({ stage: 'rotation', oldAccepted: replaced.ok, newAccepted: replacement.ok });

    await keys.revokeApiKey(context, rotated.apiKey.id, { reason: 'Preflight revocation' });
    const revoked = await client.registrationContext.resolve({
      secret: rotated.secret,
      origin,
      environmentId,
    });
    expect(revoked.ok).toBe(false);
    if (revoked.ok) throw new Error('Console admitted a revoked credential');
    expect(revoked.code).toBe('publishable_key_revoked');
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
    });
    expect(beforeArchive.ok).toBe(true);
    await organizations.archiveEnvironment(context, environmentId);
    const archived = await client.registrationContext.resolve({
      secret: archiveCredential.secret,
      origin,
      environmentId,
    });
    expect(archived.ok).toBe(false);
    if (archived.ok) throw new Error('Console admitted an archived environment');
    expect(archived.code).toBe('registration_environment_unavailable');
    observations.push({ stage: 'archived_environment', ok: archived.ok, status: archived.status });
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
