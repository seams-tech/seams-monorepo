import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudflareD1ConsoleOnlyServiceBundle } from '../../packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleServices';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { createProductionTenantDeploymentReadinessAdapterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/productionReadiness';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/wallet-console-shared-ts/src/tenant-root';
import { consoleWorkerEnvironment } from '../helpers/consoleWorkerEnvironment';
import { GithubDeploymentOidcFixture } from '../helpers/githubDeploymentOidc';
import {
  namespaceHome,
  seedAdoptionRoot,
  seedHistoricalActiveBinding,
} from '../helpers/tenantDeploymentFixtures';

const root = fileURLToPath(new URL('../../', import.meta.url));
const namespace = 'operator-home-e2e';
const lane = 'adoption-lane';
const home = namespaceHome(namespace, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const adoptionUrl = 'https://console.example.test/internal/tenant-deployment/v1/adopt-home';
const surfaces = {
  applicationOrigin: 'https://wallet.example.test',
  hostedWalletOrigin: 'https://wallet.example.test',
  gatewayOrigin: 'https://gateway.example.test',
  relyingPartyId: 'wallet.example.test',
};

class AdoptionDependencies {
  readonly oidc = new GithubDeploymentOidcFixture();
  readonly walletRequests: string[] = [];
  readonly unexpectedRequests: string[] = [];
  inFlight = 1;
  canaryFails = true;
  canaryCalls = 0;

  outbound(request: Request): Response {
    if (request.url === 'https://token.actions.githubusercontent.com/.well-known/jwks')
      return this.oidc.jwks();
    if (request.url === `${surfaces.gatewayOrigin}/wallets/register/setup`) {
      this.canaryCalls += 1;
      return this.canaryFails
        ? new Response('Injected canary outage', { status: 503 })
        : Response.json({ ok: true, fixture: 'registration-setup-response' });
    }
    this.unexpectedRequests.push(request.url);
    return new Response('Unexpected external request', { status: 503 });
  }

  async wallet(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    this.walletRequests.push(pathname);
    const body = await request.json();
    if (pathname === '/internal/wallet-runtime/v1/tenant-root-control/status') {
      return Response.json({
        identity_digest_b64u: body.identity_digest_b64u,
        custody_lineage_b64u: body.custody_lineage_b64u,
        root_commitment_b64u: 'adoption-commitment',
        lifecycle_revision: 1,
        active_epoch: 1,
        last_refresh_completed_at_ms: null,
        next_scheduled_rotation_at_ms: null,
        activation_receipt_digest_b64u: 'fixture-activation',
        deriver_a_status: 'healthy',
        deriver_b_status: 'healthy',
        job: null,
      });
    }
    if (pathname === '/internal/wallet-runtime/v1/tenant-deployment/readiness') {
      expect(body.source).toBeNull();
      expect(body.target.namespace).toBe(namespace);
      return Response.json({
        kind: 'tenant_deployment_runtime_inspection_v1',
        acknowledgedBindingRevision: body.bindingRevision,
        sourceDurableWalletCount: 0,
        targetDurableWalletCount: 7,
        inFlightCeremonyCount: this.inFlight,
      });
    }
    this.unexpectedRequests.push(request.url);
    return new Response('Unexpected Wallet operation', { status: 503 });
  }
}

function unusedDependency(): never {
  throw new Error('candidate construction must not inspect custody or runtime');
}

test('protected operator adoption refreshes readiness and retries a failed canary without reactivation', async ({
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const output = testInfo.outputPath('workers');
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: [
      path.join(
        root,
        'packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleStagingWorker.ts',
      ),
    ],
    outfile: path.join(output, 'console.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*'],
    loader: { '.wasm': 'file' },
    tsconfig: path.join(root, 'packages/wallet-console-server-ts/tsconfig.json'),
  });
  const dependencies = new AdoptionDependencies();
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: 0,
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
    d1Databases: { CONSOLE_DB: 'operator-home-adoption' },
    serviceBindings: { WALLET_RUNTIME: dependencies.wallet.bind(dependencies) },
    outboundService: dependencies.outbound.bind(dependencies),
  });
  const migrations = [];
  try {
    const database = await runtime.getD1Database('CONSOLE_DB');
    if (!isD1DatabaseLike(database)) throw new Error('D1 unavailable');
    const directory = path.join(root, 'packages/wallet-console-server-ts/migrations/d1-console');
    for (const name of (await readdir(directory)).sort()) {
      if (!name.endsWith('.sql')) continue;
      const sql = await readFile(path.join(directory, name), 'utf8');
      for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
      migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
    }
    const bundle = await createCloudflareD1ConsoleOnlyServiceBundle({
      bindings: { consoleDatabase: database },
      route: { namespace },
      adapters: { ensureSchema: false },
    });
    const context = { orgId: 'org_adoption_e2e', actorUserId: 'fixture-owner' };
    await bundle.orgProjectEnv.upsertOrganization(context, { name: 'Adoption' });
    await bundle.orgProjectEnv.createProject(context, { id: 'proj_adoption', name: 'Adoption' });
    const environments = await bundle.orgProjectEnv.listEnvironments(context, {
      projectId: 'proj_adoption',
      status: 'ACTIVE',
    });
    const environment = environments.find((candidate) => candidate.key === 'dev');
    if (!environment) throw new Error('environment missing');
    const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
      orgId: context.orgId,
      projectId: environment.projectId,
      envId: environment.id,
      signingRootId: `${environment.projectId}:dev`,
      signingRootVersion: environment.runtimeVersion,
    });
    if (!identity.ok) throw new Error(JSON.stringify(identity.error));
    const activeTenantRoot = await seedAdoptionRoot(database, namespace, identity.value);
    const credential = await bundle.apiKeys.createApiKey(context, {
      kind: 'publishable_key',
      name: 'Adoption fixture',
      environmentId: environment.id,
      allowedOrigins: [surfaces.applicationOrigin],
      rateLimitBucket: 'managed-registration',
      quotaBucket: 'included-registration',
    });
    const store = createD1TenantDeploymentServiceV1({ database });
    const adapter = createProductionTenantDeploymentReadinessAdapterV1({
      namespace,
      deploymentLane: lane,
      orgProjectEnv: bundle.orgProjectEnv,
      apiKeys: bundle.apiKeys,
      policies: bundle.policies,
      runtimeSnapshots: bundle.runtimeSnapshots,
      bindings: store,
      tenantRootState: { readStatus: unusedDependency },
      walletRuntime: { inspect: unusedDependency },
    });
    const candidate = await adapter.buildCandidate({
      home,
      identity: identity.value,
      activeTenantRoot,
      credentialId: credential.apiKey.id,
      publishableKey: credential.secret,
      surfaces,
    });
    const historical = await seedHistoricalActiveBinding(database, candidate);
    await store.reserveNamespaceHome(home);
    const data = {
      deploymentLane: lane,
      operationId: 'tco_operator_adoption',
      expectedActive: { revision: historical.revision, activationSequence: 1 },
    };
    const worker = await runtime.getWorker();
    const headers = {
      authorization: dependencies.oidc.authorization(),
      'content-type': 'application/json',
    };
    expect(
      (
        await request.post(`${await runtime.ready}internal/tenant-deployment/v1/adopt-home`, {
          data,
        })
      ).status(),
    ).toBe(401);
    const invalid = await worker.fetch(adoptionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...data, home }),
    });
    expect(invalid.status).toBe(409);
    expect(dependencies.walletRequests).toHaveLength(0);
    const blocked = await worker.fetch(adoptionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    expect(await blocked.json()).toMatchObject({ ok: false, code: 'readiness_invalid' });
    expect(blocked.status).toBe(409);
    expect(await store.findActiveBinding(lane)).toMatchObject({
      revision: historical.revision,
      activationSequence: 1,
    });
    expect(dependencies.canaryCalls).toBe(0);
    dependencies.inFlight = 0;
    const failedCanary = await worker.fetch(adoptionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    expect(await failedCanary.json()).toMatchObject({
      ok: false,
      message: expect.stringContaining('registration canary failed with HTTP 503'),
    });
    expect(failedCanary.status).toBe(409);
    expect(await store.findActiveBinding(lane)).toMatchObject({
      revision: candidate.revision,
      activationSequence: 2,
    });
    const afterFailureRequests = dependencies.walletRequests.length;
    dependencies.canaryFails = false;
    const recovered = await worker.fetch(adoptionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    const recoveredBody = await recovered.json();
    expect(recovered.status).toBe(200);
    expect(recoveredBody).toMatchObject({
      ok: true,
      result: {
        bindingRevision: candidate.revision,
        activationSequence: 2,
        canaryReceipt: { bindingRevision: candidate.revision },
      },
    });
    // Simulate a lost success response: the same operator request must verify the canary again.
    const repeated = await worker.fetch(adoptionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    expect(repeated.status).toBe(200);
    expect(dependencies.canaryCalls).toBe(3);
    expect(dependencies.walletRequests).toHaveLength(afterFailureRequests);
    expect(await store.findActiveBinding(lane)).toMatchObject({
      revision: candidate.revision,
      activationSequence: 2,
    });
    const stale = await worker.fetch(adoptionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...data, operationId: 'tco_stale_adoption' }),
    });
    expect(await stale.json()).toMatchObject({ code: 'activation_conflict' });
    expect(dependencies.canaryCalls).toBe(3);
    expect(
      await database
        .prepare('SELECT COUNT(*) AS count FROM tenant_deployment_activations')
        .first('count'),
    ).toBe(1);
    expect(
      await database
        .prepare('SELECT binding_json FROM tenant_deployment_bindings WHERE revision = ?1')
        .bind(historical.revision)
        .first('binding_json'),
    ).toBe(JSON.stringify(historical));
    expect(await bundle.apiKeys.listApiKeys(context)).toHaveLength(1);
    expect(dependencies.unexpectedRequests).toEqual([]);
    const evidence = {
      kind: 'operator_home_adoption_e2e_v1',
      at: new Date().toISOString(),
      migrations,
      originalRevision: historical.revision,
      adoptedRevision: candidate.revision,
      productionConsoleWorker: true,
      githubOidc: 'signed fixture JWT with controlled JWKS',
      readiness:
        'production adapter, real D1 environment/credential/policy/root lookup; controlled Wallet status and inventory responses',
      canary: 'production HTTP client, injected 503 then controlled success responses',
      blockedDuringCeremony: true,
      preservedCustodyAndCredential: true,
      activationCount: 1,
      activationSequence: 2,
      canaryCalls: dependencies.canaryCalls,
      retryAfterCanaryFailure: true,
      retryAfterLostResponse: true,
      staleRequestRejected: true,
      originalBindingPreserved: true,
      physicalResourceVerified: false,
    };
    const evidencePath = testInfo.outputPath('operator-home-adoption-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('operator-home-adoption-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
