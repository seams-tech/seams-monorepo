import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1ConsoleOrgProjectEnvService } from '../../packages/console-server-ts/src/orgProjectEnv/d1';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { NamespaceD1HomeV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/namespaceHome';
import { consoleWorkerEnvironment } from '../helpers/consoleWorkerEnvironment';

const root = fileURLToPath(new URL('../../', import.meta.url));
const namespace = 'provisioning-home-e2e';
const accountId = '0123456789abcdef0123456789abcdef';
const databaseA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const databaseB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const context = { orgId: 'org_home_admission', actorUserId: 'fixture-owner' };
const projectId = 'home_admission';
const environmentId = `${projectId}:dev`;
const cutoverUrl = 'https://console.example.test/internal/tenant-deployment/v1/cutover';

class ProvisioningDependencies {
  readonly walletRequests: string[] = [];
  readonly unexpectedRequests: string[] = [];
  readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

  outbound(request: Request): Response {
    if (request.url === 'https://token.actions.githubusercontent.com/.well-known/jwks') {
      return Response.json({
        keys: [{ ...this.keys.publicKey.export({ format: 'jwk' }), kid: 'fixture' }],
      });
    }
    this.unexpectedRequests.push(request.url);
    return new Response('Unexpected external request', { status: 503 });
  }

  wallet(request: Request): Response {
    this.walletRequests.push(new URL(request.url).pathname);
    return new Response('Injected custody service interruption', { status: 503 });
  }

  authorization(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://token.actions.githubusercontent.com',
        aud: 'seams-tenant-cutover',
        sub: 'repo:seams-tech@282445520/seams-monorepo@1366871528:environment:production-live-demo',
        repository: 'seams-tech/seams-monorepo',
        ref: 'refs/heads/main',
        workflow_ref:
          'seams-tech/seams-monorepo/.github/workflows/deploy-live-demo.yml@refs/heads/main',
        nbf: now - 10,
        exp: now + 300,
      }),
    ).toString('base64url');
    const message = `${header}.${payload}`;
    return `Bearer ${message}.${sign('RSA-SHA256', Buffer.from(message), this.keys.privateKey).toString('base64url')}`;
  }
}

function consoleWorker(
  output: string,
  name: string,
  databaseId: string,
  dependencies: ProvisioningDependencies,
) {
  return {
    name,
    modules: true,
    scriptPath: path.join(output, 'console.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    bindings: consoleWorkerEnvironment({ namespace, deploymentLane: name, accountId, databaseId }),
    d1Databases: { CONSOLE_DB: 'provisioning-home-e2e' },
    serviceBindings: { WALLET_RUNTIME: dependencies.wallet.bind(dependencies) },
    outboundService: dependencies.outbound.bind(dependencies),
  };
}

function requestInit(deploymentLane: string, authorization: string) {
  return {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ deploymentLane, environmentId }),
  };
}

test('authenticated provisioning checks the reserved home before custody work across lanes', async ({
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
  const dependencies = new ProvisioningDependencies();
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    workers: [
      consoleWorker(output, 'lane-a', databaseA, dependencies),
      consoleWorker(output, 'lane-b', databaseB, dependencies),
    ],
  });
  const migrations = [];
  const observations = [];
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'lane-a');
    if (!isD1DatabaseLike(database)) throw new Error('Console D1 is unavailable');
    const directory = path.join(root, 'packages/wallet-console-server-ts/migrations/d1-console');
    for (const name of (await readdir(directory)).sort()) {
      if (!name.endsWith('.sql')) continue;
      const sql = await readFile(path.join(directory, name), 'utf8');
      for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
      migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
    }
    const organizations = await createD1ConsoleOrgProjectEnvService({
      database,
      namespace,
      ensureSchema: false,
    });
    await organizations.upsertOrganization(context, { name: 'Home admission' });
    await organizations.createProject(context, { id: projectId, name: 'Home admission' });
    const laneA = await runtime.getWorker('lane-a');
    const laneB = await runtime.getWorker('lane-b');
    const authorization = dependencies.authorization();
    const unauthenticated = await request.post(
      `${await runtime.ready}internal/tenant-deployment/v1/cutover`,
      {
        data: { deploymentLane: 'lane-a', environmentId },
      },
    );
    expect(unauthenticated.status()).toBe(401);
    const missing = await laneA.fetch(cutoverUrl, requestInit('lane-a', authorization));
    const missingBody = await missing.json();
    expect(missing.status).toBe(409);
    expect(missingBody).toMatchObject({ code: 'namespace_home_unassigned' });
    expect(dependencies.walletRequests).toHaveLength(0);
    expect(
      await database
        .prepare('SELECT count(*) AS total FROM tenant_deployment_cutovers')
        .first('total'),
    ).toBe(0);
    observations.push({ stage: 'unassigned', status: missing.status, body: missingBody });

    const clientSelectedHome = await laneA.fetch(cutoverUrl, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        deploymentLane: 'lane-a',
        environmentId,
        home: { namespace, accountId, databaseId: databaseB },
      }),
    });
    expect(clientSelectedHome.status).toBe(409);
    expect(await clientSelectedHome.json()).toMatchObject({
      message: 'cutover request must contain only deploymentLane and environmentId',
    });
    expect(
      await database.prepare('SELECT count(*) AS total FROM namespace_d1_homes').first('total'),
    ).toBe(0);

    const store = createD1TenantDeploymentServiceV1({ database });
    const reservation = await store.reserveNamespaceHome(
      NamespaceD1HomeV1.parse({ namespace, accountId, databaseId: databaseA }),
    );
    expect(reservation.ok).toBe(true);
    const [admitted, conflicting] = await Promise.all([
      laneA.fetch(cutoverUrl, requestInit('lane-a', authorization)),
      laneB.fetch(cutoverUrl, requestInit('lane-b', authorization)),
    ]);
    const admittedBody = await admitted.json();
    const conflictBody = await conflicting.json();
    expect(conflicting.status).toBe(409);
    expect(conflictBody).toMatchObject({ code: 'namespace_home_conflict' });
    expect(admitted.status).toBe(409);
    expect(admittedBody).toMatchObject({ code: 'tenant_deployment_cutover_failed' });
    expect(dependencies.walletRequests.length).toBeGreaterThan(0);
    const cutovers = await database
      .prepare('SELECT deployment_lane, state_kind FROM tenant_deployment_cutovers')
      .all();
    expect(cutovers.results).toEqual([
      { deployment_lane: 'lane-a', state_kind: 'awaiting_tenant_root' },
    ]);
    observations.push({
      stage: 'concurrent',
      admitted: admittedBody,
      conflicting: conflictBody,
      cutovers: cutovers.results,
    });
    const beforeRetry = await store.findNamespaceHome(namespace);
    const retry = await laneA.fetch(cutoverUrl, requestInit('lane-a', authorization));
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ code: 'tenant_deployment_cutover_failed' });
    expect(await store.findNamespaceHome(namespace)).toEqual(beforeRetry);
    expect(
      await database
        .prepare(
          'SELECT count(*) AS total FROM tenant_deployment_cutovers WHERE deployment_lane = ?1',
        )
        .bind('lane-a')
        .first('total'),
    ).toBe(2);
    expect(
      await database
        .prepare(
          'SELECT count(*) AS total FROM tenant_deployment_cutovers WHERE deployment_lane = ?1',
        )
        .bind('lane-b')
        .first('total'),
    ).toBe(0);
    expect(await database.prepare('SELECT count(*) AS total FROM api_keys').first('total')).toBe(0);
    expect(
      await database
        .prepare('SELECT count(*) AS total FROM active_tenant_deployment_bindings')
        .first('total'),
    ).toBe(0);
    expect(dependencies.unexpectedRequests).toEqual([]);
    const evidencePath = testInfo.outputPath('namespace-home-provisioning-evidence.json');
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          kind: 'namespace_home_provisioning_e2e_v1',
          at: new Date().toISOString(),
          topology:
            'signed automation requests → production Console Workers → production provisioner → shared local D1',
          migrations,
          workerBundleSha256: createHash('sha256')
            .update(await readFile(path.join(output, 'console.js')))
            .digest('hex'),
          observations,
          custodyRequests: dependencies.walletRequests,
          reservationPreservedAfterRetry: true,
          conflictingLaneCutovers: 0,
          credentialsCreated: 0,
          requestCannotSelectHome: true,
          injectedFailure: 'custody service HTTP 503',
          completedActivationVerified: false,
          physicalResourceVerified: false,
        },
        null,
        2,
      )}\n`,
    );
    await testInfo.attach('namespace-home-provisioning-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
