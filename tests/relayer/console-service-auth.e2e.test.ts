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
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1ConsoleApiKeyService } from '../../packages/console-server-ts/src/apiKeys/d1';
import { createD1ConsoleOrgProjectEnvService } from '../../packages/console-server-ts/src/orgProjectEnv/d1';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '../../packages/wallet-console-shared-ts/src/apiKeyScopes';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const namespace = 'console-service-auth-e2e';
const context = { orgId: 'org_console_preflight', actorUserId: 'fixture-owner' };
const projectId = 'console_preflight';
const environmentId = `${projectId}:dev`;
const origin = 'https://wallet.example.test';

function consoleEnvironment(): Record<string, string> {
  return {
    SEAMS_TENANT_STORAGE_NAMESPACE: namespace,
    SEAMS_TENANT_DEPLOYMENT_LANE: 'console-preflight',
    CONSOLE_BASE_URL: 'https://console.example.test',
    CONSOLE_EMAIL_RUNTIME_PROFILE: 'DEVELOPMENT',
    CONSOLE_EMAIL_PROVIDER: 'CAPTURE',
    CONSOLE_EMAIL_INVITATION_SECRET_KEY_ID: 'local-invitation',
    CONSOLE_EMAIL_INVITATION_SECRET_KEY_B64U: randomBytes(32).toString('base64url'),
    CONSOLE_WEBHOOK_SECRET_KEY_ID: 'local-webhook',
    CONSOLE_WEBHOOK_SECRET_KEY_B64U: randomBytes(32).toString('base64url'),
    CONSOLE_SESSION_HMAC_SECRET: randomBytes(32).toString('base64url'),
    CONSOLE_STEP_UP_RP_ID: 'console.example.test',
    CONSOLE_STEP_UP_ORIGIN: 'https://console.example.test',
    TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID: 'local-grant',
    TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED: randomBytes(32).toString('base64url'),
    TENANT_DEPLOYMENT_SURFACES_JSON: JSON.stringify({
      applicationOrigin: origin,
      hostedWalletOrigin: origin,
      gatewayOrigin: 'https://gateway.example.test',
      relyingPartyId: 'wallet.example.test',
    }),
    STRIPE_API_SK: 'sk_test_local_unusable',
    STRIPE_WEBHOOK_SECRET: 'whsec_local_unusable',
  };
}

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
    external: ['node:*'],
    loader: { '.wasm': 'file' },
    tsconfig: path.join(repoRoot, 'packages/wallet-console-server-ts/tsconfig.json'),
  });
  const guard = new ExternalRequestGuard();
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    workers: [
      {
        name: 'consumer',
        modules: true,
        scriptPath: path.join(output, 'consumer.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        serviceBindings: { WALLET_CONSOLE: 'console' },
        outboundService: guard.fetch.bind(guard),
      },
      {
        name: 'console',
        modules: true,
        scriptPath: path.join(output, 'console.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        bindings: consoleEnvironment(),
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

    const accepted = await client.publishableKeyAuth.authenticate({
      secret: credential.secret,
      origin,
      environmentId,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error(`Console authentication failed: ${accepted.code}`);
    expect(accepted.principal.orgId).toBe(context.orgId);
    expect(accepted.principal.environmentId).toBe(environmentId);
    observations.push({ stage: 'accepted', ok: accepted.ok });

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
      const result = await client.publishableKeyAuth.authenticate({
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

    const lineage = await client.tenantRootActiveLineage.resolveActiveLineage({
      orgId: context.orgId,
      projectId,
      envId: environmentId,
      signingRootId: 'unprovisioned-root',
      signingRootVersion: environments[0].signingRootVersion,
    });
    expect(lineage).toBeNull();
    observations.push({ stage: 'unprovisioned_root', result: lineage });

    const rotated = await keys.rotateApiKey(context, credential.apiKey.id, {
      reason: 'Preflight rotation',
    });
    if (!rotated) throw new Error('Console credential rotation failed');
    const replaced = await client.publishableKeyAuth.authenticate({
      secret: credential.secret,
      origin,
      environmentId,
    });
    expect(replaced.ok).toBe(false);
    if (replaced.ok) throw new Error('Console admitted a replaced credential');
    expect(replaced.code).toBe('publishable_key_invalid');
    const replacement = await client.publishableKeyAuth.authenticate({
      secret: rotated.secret,
      origin,
      environmentId,
    });
    expect(replacement.ok).toBe(true);
    observations.push({ stage: 'rotation', oldAccepted: replaced.ok, newAccepted: replacement.ok });

    await keys.revokeApiKey(context, rotated.apiKey.id, { reason: 'Preflight revocation' });
    const revoked = await client.publishableKeyAuth.authenticate({
      secret: rotated.secret,
      origin,
      environmentId,
    });
    expect(revoked.ok).toBe(false);
    if (revoked.ok) throw new Error('Console admitted a revoked credential');
    expect(revoked.code).toBe('publishable_key_revoked');
    observations.push({ stage: 'revoked', ok: revoked.ok, status: revoked.status });
    expect(guard.requests).toEqual([]);

    const evidence = {
      kind: 'console_service_auth_e2e_v1',
      at: new Date().toISOString(),
      topology: 'Wallet Console client → consumer Worker → production Console Worker → local D1',
      walletServerPackageSha256: sha256(
        await readFile(path.join(repoRoot, 'node_modules/@seams/wallet-server/package.json')),
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
