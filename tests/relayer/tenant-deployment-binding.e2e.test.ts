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
import { binding } from '../helpers/tenantDeploymentFixtures';

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
    await database
      .prepare(
        `INSERT INTO active_tenant_deployment_bindings
       (deployment_lane, revision, previous_revision, activation_sequence, activated_at_ms)
       VALUES (?1, ?2, NULL, 1, ?3)`,
      )
      .bind(first.deploymentLane, first.revision, 1_800_000_000_000)
      .run();

    for (const current of [first, second]) {
      if (current === second) {
        await database
          .prepare(
            `UPDATE active_tenant_deployment_bindings
           SET revision = ?1, previous_revision = ?2, activation_sequence = 2
           WHERE deployment_lane = ?3`,
          )
          .bind(second.revision, first.revision, first.deploymentLane)
          .run();
      }
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
