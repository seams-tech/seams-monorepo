import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { TenantHomeVerificationV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/homeVerification';
import {
  binding,
  deploymentResource,
  operatorHomeCheckpoint,
  readyActivation,
} from '../helpers/tenantDeploymentFixtures';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const migrationPath = path.join(
  repoRoot,
  'packages/wallet-console-server-ts/migrations/d1-console/0046_tenant_deployment_bindings.sql',
);

test('Console binding reads stay fresh through service bindings and retain D1 timing', async ({
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const output = testInfo.outputPath('workers');
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: {
      console: path.join(
        repoRoot,
        'packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleStagingWorker.ts',
      ),
      consumer: path.join(repoRoot, 'tests/fixtures/tenant-deployment/bindingConsumer.ts'),
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
        bindings: {
          DEPLOYMENT_LANE: 'live-demo',
          SEAMS_D1_HOME_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
          SEAMS_D1_HOME_DATABASE_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        serviceBindings: { WALLET_CONSOLE: 'console' },
      },
      {
        name: 'wrong-lane',
        modules: true,
        scriptPath: path.join(output, 'consumer.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          DEPLOYMENT_LANE: 'another-lane',
          SEAMS_D1_HOME_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
          SEAMS_D1_HOME_DATABASE_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        serviceBindings: { WALLET_CONSOLE: 'console' },
      },
      {
        name: 'console',
        modules: true,
        scriptPath: path.join(output, 'console.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        bindings: { SEAMS_TENANT_DEPLOYMENT_LANE: 'live-demo' },
        d1Databases: { CONSOLE_DB: 'isolated-console-binding-e2e' },
      },
      {
        name: 'wrong-home',
        modules: true,
        scriptPath: path.join(output, 'consumer.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          DEPLOYMENT_LANE: 'live-demo',
          SEAMS_D1_HOME_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
          SEAMS_D1_HOME_DATABASE_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
        serviceBindings: { WALLET_CONSOLE: 'console' },
      },
    ],
  });
  const observations = [];
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'console');
    if (!isD1DatabaseLike(database)) throw new Error('Local Console D1 binding is unavailable');
    const migration = await readFile(migrationPath, 'utf8');
    for (const statement of unstable_splitSqlQuery(migration)) {
      await database.prepare(statement).run();
    }
    for (const name of [
      '0047_namespace_d1_homes.sql',
      '0048_tenant_deployment_activation_homes.sql',
      '0049_tenant_deployment_binding_homes.sql',
      '0050_tenant_deployment_home_verification.sql',
      '0052_drop_namespace_placement.sql',
    ]) {
      const sql = await readFile(path.join(path.dirname(migrationPath), name), 'utf8');
      for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
    }
    const reader = await runtime.getWorker('consumer');
    const wrongLane = await runtime.getWorker('wrong-lane');
    const wrongHome = await runtime.getWorker('wrong-home');
    const unavailable = await request.get(String(await runtime.ready));
    expect(unavailable.status()).toBe(503);
    expect(await unavailable.json()).toEqual({ kind: 'unavailable' });
    observations.push({
      stage: 'empty',
      status: unavailable.status(),
      timing: unavailable.headers()['server-timing'],
    });

    const store = createD1TenantDeploymentServiceV1({ database });
    const first = await store.putBinding(await binding(1_700_000_000_000));
    const second = await store.putBinding(await binding(1_700_000_000_001));
    const home = deploymentResource(first.tenant.namespace, first.home.databaseId);
    for (const current of [first, second]) {
      const now = Date.now();
      const input = await readyActivation(
        store,
        current,
        home,
        current === first ? 'tco_first' : 'tco_second',
        current === first ? null : { revision: first.revision, activationSequence: 1 },
        now,
      );
      await store.activateBinding({
        ...input,
        homeVerification: TenantHomeVerificationV1.fromOperatorCheckpoint(
          operatorHomeCheckpoint(home, current.deploymentLane, now),
          now,
        ),
      });
      const responses = await Promise.all([
        reader.fetch('https://consumer.test/'),
        wrongLane.fetch('https://consumer.test/'),
        reader.fetch('https://consumer.test/'),
        wrongHome.fetch('https://consumer.test/'),
      ]);
      for (const [index, response] of responses.entries()) {
        const body = await response.json();
        const timing = response.headers.get('Server-Timing');
        expect(timing).toMatch(/wallet_console_binding_d1;dur=\d/);
        expect(timing).toMatch(/wallet_console_binding_sql;dur=\d/);
        // Local D1 supplies no placement evidence; absence must remain observable.
        expect(timing).not.toContain('wallet_console_binding_region');
        expect(timing).not.toContain('wallet_console_binding_primary');
        if (index === 1 || index === 3) {
          expect(response.status).toBe(502);
          expect(body).toEqual({ kind: 'rejected' });
        } else {
          expect(response.status).toBe(200);
          expect(body).toEqual({ revision: current.revision, namespace: current.tenant.namespace });
        }
        observations.push({
          stage: current === first ? 'first' : 'second',
          status: response.status,
          body,
          timing,
        });
      }
    }
    await database.prepare('DELETE FROM active_tenant_deployment_bindings').run();
    const removed = await reader.fetch('https://consumer.test/');
    expect(removed.status).toBe(503);
    observations.push({
      stage: 'removed',
      status: removed.status,
      timing: removed.headers.get('Server-Timing'),
    });

    const evidence = {
      kind: 'console_binding_service_e2e_v1',
      at: new Date().toISOString(),
      topology: 'consumer Worker → production Console Worker → local D1',
      migrationSha256: createHash('sha256').update(migration).digest('hex'),
      consoleBundleSha256: createHash('sha256')
        .update(await readFile(path.join(output, 'console.js')))
        .digest('hex'),
      observations,
      regionalLatencyMeasured: false,
    };
    const evidencePath = testInfo.outputPath('console-binding-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('console-binding-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
