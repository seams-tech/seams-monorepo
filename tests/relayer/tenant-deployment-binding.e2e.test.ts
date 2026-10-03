import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import type { TenantDeploymentResourceVerificationsV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import {
  regionalBinding,
  regionalResourceProof,
  deploymentResource,
  readyActivation,
  activeCutoverFixture,
} from '../helpers/tenantDeploymentFixtures';

import type {
  ActivateTenantDeploymentBindingInputV1,
  TenantDeploymentBindingV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/types';
import type { TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/service';

import { seedSingleResourceDeployment } from '../fixtures/tenant-deployment/resourceSetMigration';

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
      regionalConsumer(
        output,
        'runtime-us',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'walletRuntime',
      ),
      regionalConsumer(
        output,
        'runtime-weur',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'walletRuntime',
      ),
      regionalConsumer(
        output,
        'runtime-apac',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        'walletRuntime',
      ),
      regionalConsumer(
        output,
        'weur',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'gateway',
      ),
      regionalConsumer(
        output,
        'apac',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'gateway',
      ),
      {
        name: 'consumer',
        modules: true,
        scriptPath: path.join(output, 'consumer.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          DEPLOYMENT_LANE: 'live-demo',
          WRITER_ROLE: 'gateway',
          WRITER_VERSION: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
          WRITER_ROLE: 'gateway',
          WRITER_VERSION: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
          WRITER_ROLE: 'gateway',
          WRITER_VERSION: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
    const historical = await seedSingleResourceDeployment(database);
    const resourceSetMigration = await readFile(
      path.join(path.dirname(migrationPath), '0054_deployment_resource_sets.sql'),
      'utf8',
    );
    for (const statement of unstable_splitSqlQuery(resourceSetMigration))
      await database.prepare(statement).run();
    expect(
      await database
        .prepare('SELECT count(*) AS count FROM active_tenant_deployment_bindings')
        .first('count'),
    ).toBe(0);
    expect(
      await database
        .prepare(
          'SELECT count(*) AS count FROM tenant_deployment_activations WHERE operation_id = ?1',
        )
        .bind(historical.operationId)
        .first('count'),
    ).toBe(1);
    expect(
      await database
        .prepare(
          'SELECT operation_id FROM tenant_deployment_resource_challenges WHERE challenge_id = ?1',
        )
        .bind(historical.challengeId)
        .first('operation_id'),
    ).toBe(historical.operationId);
    const migratedStore = createD1TenantDeploymentServiceV1({ database });
    expect((await migratedStore.findCutover(historical.pendingOperationId))?.state).toMatchObject({
      kind: 'failed',
      failedPhase: 'readiness',
      failure: { code: 'resource_set_cutover' },
    });
    const columns = await database
      .prepare('PRAGMA table_info(tenant_deployment_activations)')
      .all<{ name: string }>();
    expect(columns.results?.map(columnName)).not.toContain('home_account_id');
    expect(columns.results?.map(columnName)).not.toContain('home_database_id');
    expect(columns.results?.map(columnName)).not.toContain('home_verification_json');
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
    const first = await store.putBinding(await regionalBinding(1_700_000_000_000, 'live-demo'));
    const second = await store.putBinding(await regionalBinding(1_700_000_000_001, 'live-demo'));
    const home = deploymentResource(first.tenant.namespace, first.resources[0].databaseId);
    let previousProofs: TenantDeploymentResourceVerificationsV1 | null = null;
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
      const proofs: TenantDeploymentResourceVerificationsV1 = [
        regionalResourceProof(
          current,
          current.resources[0].databaseId,
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          now,
        ),
        regionalResourceProof(
          current,
          current.resources[1].databaseId,
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          now,
        ),
        regionalResourceProof(
          current,
          current.resources[2].databaseId,
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
          now,
        ),
      ];
      await expect(
        store.activateBinding({ ...input, resourceVerifications: [proofs[0]] }),
      ).rejects.toMatchObject({ code: 'readiness_invalid' });
      await expect(
        store.activateBinding({
          ...input,
          resourceVerifications: [proofs[0], proofs[0], proofs[2]],
        }),
      ).rejects.toMatchObject({ code: 'readiness_invalid' });
      const reusedWriter = regionalResourceProof(
        current,
        current.resources[1].databaseId,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        now,
      );
      await expect(
        store.activateBinding({
          ...input,
          resourceVerifications: [proofs[0], reusedWriter, proofs[2]],
        }),
      ).rejects.toMatchObject({ code: 'readiness_invalid' });
      expect((await store.findActiveBinding('live-demo'))?.revision ?? null).toBe(
        current === first ? null : first.revision,
      );
      await expect(
        insertActivation(database, store, current, input, [proofs[0]], now),
      ).rejects.toThrow('deployment resource proof mismatch');
      await expect(
        insertActivation(
          database,
          store,
          current,
          input,
          [proofs[0], reusedWriter, proofs[2]],
          now,
        ),
      ).rejects.toThrow('deployment writer version is duplicated');
      if (previousProofs) {
        await expect(
          store.activateBinding({
            ...input,
            resourceVerifications: [previousProofs[0], proofs[1], proofs[2]],
          }),
        ).rejects.toMatchObject({ code: 'activation_conflict' });
        expect(
          await database
            .prepare(
              'SELECT count(*) AS count FROM tenant_deployment_activations WHERE operation_id = ?1',
            )
            .bind(input.operationId)
            .first('count'),
        ).toBe(0);
      }
      const verifiedInput = { ...input, resourceVerifications: proofs };
      const activated = await store.activateBinding(verifiedInput);
      expect(await store.activateBinding(verifiedInput)).toEqual(activated);
      previousProofs = proofs;
      const runtimeUs = await runtime.getWorker('runtime-us');
      const runtimeWeur = await runtime.getWorker('runtime-weur');
      const runtimeApac = await runtime.getWorker('runtime-apac');
      const weur = await runtime.getWorker('weur');
      const apac = await runtime.getWorker('apac');
      const responses = await Promise.all([
        reader.fetch('https://consumer.test/'),
        wrongLane.fetch('https://consumer.test/'),
        reader.fetch('https://consumer.test/'),
        wrongHome.fetch('https://consumer.test/'),
        weur.fetch('https://consumer.test/'),
        apac.fetch('https://consumer.test/'),
        runtimeUs.fetch('https://consumer.test/'),
        runtimeWeur.fetch('https://consumer.test/'),
        runtimeApac.fetch('https://consumer.test/'),
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
      migrationPreservesHistoryAndConsumedProofs: true,
      migrationRetiresActivePointersAndPendingCutovers: true,
      regionalLatencyMeasured: false,
      verifiedResources: 3,
      admittedWriters: 6,
      partialAndDuplicateProofsRejected: true,
      wrongResourceWithAdmittedVersionRejected: true,
      lostActivationReplyReplay: true,
      databaseRejectsIncompleteProofsAndDuplicateWriters: true,
      partiallyReusedChallengeRollsBackActivation: true,
      resourceSetMigrationSha256: createHash('sha256')
        .update(
          await readFile(
            path.join(path.dirname(migrationPath), '0054_deployment_resource_sets.sql'),
          ),
        )
        .digest('hex'),
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

function regionalConsumer(
  output: string,
  name: string,
  databaseId: string,
  versionId: string,
  role: 'gateway' | 'walletRuntime',
) {
  return {
    name,
    modules: true,
    scriptPath: path.join(output, 'consumer.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    bindings: {
      DEPLOYMENT_LANE: 'live-demo',
      WRITER_VERSION: versionId,
      WRITER_ROLE: role,
      SEAMS_D1_HOME_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      SEAMS_D1_HOME_DATABASE_ID: databaseId,
    },
    serviceBindings: { WALLET_CONSOLE: 'console' },
  };
}

async function insertActivation(
  database: D1DatabaseLike,
  store: TenantDeploymentServiceV1,
  candidate: TenantDeploymentBindingV1,
  input: ActivateTenantDeploymentBindingInputV1,
  proofs: readonly unknown[],
  nowMs: number,
) {
  const cutover = await store.findCutover(input.operationId);
  const active = activeCutoverFixture(input, candidate, nowMs);
  return database
    .prepare(
      `INSERT INTO tenant_deployment_activations (
    operation_id, deployment_lane, binding_revision, expected_previous_revision,
    expected_activation_sequence, activation_sequence, activated_at_ms,
    expected_cutover_record_revision, ready_state_json, active_state_json, receipt_json,
    resource_verifications_json
  ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
    )
    .bind(
      input.operationId,
      input.deploymentLane,
      candidate.revision,
      input.expectedActive?.revision ?? null,
      input.expectedActive?.activationSequence ?? null,
      active.activationReceipt.activationSequence,
      nowMs,
      input.expectedCutoverRecordRevision,
      JSON.stringify(cutover?.state),
      JSON.stringify(active),
      JSON.stringify(active.activationReceipt),
      JSON.stringify(proofs),
    )
    .run();
}

function columnName(column: { name: string }): string {
  return column.name;
}
