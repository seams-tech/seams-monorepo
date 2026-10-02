import { expect, test } from '@playwright/test';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { buildTenantDeploymentBindingV1 } from '../../packages/wallet-console-shared-ts/src/tenant-deployment';
import type { ActivateTenantDeploymentBindingInputV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/types';
import type { NamespaceD1HomeV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/namespaceHome';
import {
  activeCutoverFixture,
  bindingForLane,
  namespaceHome,
  readyActivation,
} from '../helpers/tenantDeploymentFixtures';

const migrationDirectory = new URL(
  '../../packages/wallet-console-server-ts/migrations/d1-console/',
  import.meta.url,
);
const nowMs = 1_800_000_000_000;

function fixtureNow(): Date {
  return new Date(nowMs);
}
function expiredNow(): Date {
  return new Date(nowMs + 120_000);
}

async function insertActivationRow(
  database: D1DatabaseLike,
  input: ActivateTenantDeploymentBindingInputV1,
  evidence: { kind: 'historical' } | { kind: 'scoped'; home: NamespaceD1HomeV1 | null },
) {
  const store = createD1TenantDeploymentServiceV1({ database, now: fixtureNow });
  const candidate = await store.findBinding(input.deploymentLane, input.bindingRevision);
  const ready = await store.findCutover(input.operationId);
  if (!candidate || !ready) throw new Error('activation fixture is missing');
  const active = activeCutoverFixture(input, candidate, nowMs);
  const values = [
    input.operationId,
    input.deploymentLane,
    input.bindingRevision,
    input.expectedActive?.revision ?? null,
    input.expectedActive?.activationSequence ?? null,
    active.activationReceipt.activationSequence,
    nowMs,
    input.expectedCutoverRecordRevision,
    JSON.stringify(ready.state),
    JSON.stringify(active),
    JSON.stringify(active.activationReceipt),
  ];
  let columns = '';
  let parameters = '';
  if (evidence.kind === 'scoped') {
    columns = ', home_account_id, home_database_id, home_verification_json';
    parameters = ', ?12, ?13, ?14';
    values.push(
      evidence.home?.accountId ?? null,
      evidence.home?.databaseId ?? null,
      JSON.stringify(input.homeVerification),
    );
  }
  return database
    .prepare(
      `INSERT INTO tenant_deployment_activations (
    operation_id, deployment_lane, binding_revision, expected_previous_revision, expected_activation_sequence,
    activation_sequence, activated_at_ms, expected_cutover_record_revision, ready_state_json, active_state_json, receipt_json${columns}
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11${parameters})`,
    )
    .bind(...values)
    .run();
}

test('activation enforces the reserved resource through races, retries and historical adoption', async ({
  request,
}, testInfo) => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ready"); } };',
    d1Databases: { CONSOLE_DB: 'activation-home-e2e' },
  });
  const migrations = [];
  try {
    expect((await request.get(String(await runtime.ready))).status()).toBe(200);
    const database = await runtime.getD1Database('CONSOLE_DB');
    if (!isD1DatabaseLike(database)) throw new Error('D1 database is unavailable');
    for (const name of ['0046_tenant_deployment_bindings.sql', '0047_namespace_d1_homes.sql']) {
      const sql = await readFile(new URL(name, migrationDirectory), 'utf8');
      for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
      migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
    }
    const store = createD1TenantDeploymentServiceV1({ database, now: fixtureNow });
    const home = namespaceHome('wallet', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const wrongHome = namespaceHome('wallet', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const historical = await store.putBinding(
      await bindingForLane(nowMs - 1000, 'historical-lane'),
    );
    const historicalInput = await readyActivation(
      store,
      historical,
      home,
      'tco_historical',
      null,
      nowMs,
    );
    await insertActivationRow(database, historicalInput, { kind: 'historical' });
    const oldRow = await database
      .prepare('SELECT binding_json FROM tenant_deployment_bindings WHERE revision = ?1')
      .bind(historical.revision)
      .first('binding_json');
    const migration = await readFile(
      new URL('0048_tenant_deployment_activation_homes.sql', migrationDirectory),
      'utf8',
    );
    for (const statement of unstable_splitSqlQuery(migration))
      await database.prepare(statement).run();
    migrations.push({
      name: '0048_tenant_deployment_activation_homes.sql',
      sha256: createHash('sha256').update(migration).digest('hex'),
    });
    const bindingHomeMigration = await readFile(
      new URL('0049_tenant_deployment_binding_homes.sql', migrationDirectory),
      'utf8',
    );
    for (const statement of unstable_splitSqlQuery(bindingHomeMigration))
      await database.prepare(statement).run();
    migrations.push({
      name: '0049_tenant_deployment_binding_homes.sql',
      sha256: createHash('sha256').update(bindingHomeMigration).digest('hex'),
    });
    const verificationMigration = await readFile(
      new URL('0050_tenant_deployment_home_verification.sql', migrationDirectory),
      'utf8',
    );
    for (const statement of unstable_splitSqlQuery(verificationMigration))
      await database.prepare(statement).run();
    migrations.push({
      name: '0050_tenant_deployment_home_verification.sql',
      sha256: createHash('sha256').update(verificationMigration).digest('hex'),
    });
    expect(await store.resolveActiveBinding(historical.deploymentLane)).toEqual(historical);
    expect(
      await database
        .prepare('SELECT binding_json FROM tenant_deployment_bindings WHERE revision = ?1')
        .bind(historical.revision)
        .first('binding_json'),
    ).toBe(oldRow);
    expect(
      await database
        .prepare(
          'SELECT home_account_id, home_database_id FROM tenant_deployment_activations WHERE operation_id = ?1',
        )
        .bind(historicalInput.operationId)
        .first(),
    ).toEqual({ home_account_id: null, home_database_id: null });
    await expect(store.activateBinding(historicalInput)).rejects.toMatchObject({
      code: 'namespace_home_unassigned',
    });
    await store.reserveNamespaceHome(home);
    await expect(store.activateBinding(historicalInput)).rejects.toMatchObject({
      code: 'activation_conflict',
    });
    const adoptedInput = await readyActivation(
      store,
      historical,
      home,
      'tco_adopted',
      { revision: historical.revision, activationSequence: 1 },
      nowMs,
    );
    const adopted = await store.activateBinding(adoptedInput);
    expect(adopted.active.activationSequence).toBe(2);
    expect(await store.activateBinding(adoptedInput)).toEqual(adopted);
    expect(await store.resolveActiveBinding(historical.deploymentLane)).toEqual(historical);

    const candidate = await store.putBinding(await bindingForLane(nowMs, 'new-lane'));
    const correct = await readyActivation(store, candidate, home, 'tco_correct', null, nowMs);
    const wrong = await readyActivation(store, candidate, wrongHome, 'tco_wrong', null, nowMs);
    await expect(
      insertActivationRow(database, wrong, { kind: 'scoped', home: wrongHome }),
    ).rejects.toThrow(/home/);
    await expect(
      insertActivationRow(database, wrong, { kind: 'scoped', home: null }),
    ).rejects.toThrow(/home/);
    const rawDifferentHome = JSON.parse(JSON.stringify(candidate));
    delete rawDifferentHome.revision;
    rawDifferentHome.home.databaseId = wrongHome.databaseId;
    const different = await buildTenantDeploymentBindingV1(rawDifferentHome);
    if (!different.ok) throw new Error(different.message);
    const differentBinding = await store.putBinding(different.value);
    const mismatchedCanonicalHome = await readyActivation(
      store,
      differentBinding,
      home,
      'tco_canonical_mismatch',
      null,
      nowMs,
    );
    await expect(store.activateBinding(mismatchedCanonicalHome)).rejects.toMatchObject({
      code: 'namespace_home_conflict',
    });
    await expect(
      insertActivationRow(database, mismatchedCanonicalHome, { kind: 'scoped', home }),
    ).rejects.toThrow('activation home disagrees with the canonical binding');
    const races = await Promise.allSettled([
      store.activateBinding(correct),
      store.activateBinding(wrong),
    ]);
    expect(races[0].status).toBe('fulfilled');
    expect(races[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'namespace_home_conflict' },
    });
    const activated = races[0];
    if (activated.status !== 'fulfilled') throw new Error('matching home did not activate');
    const expired = createD1TenantDeploymentServiceV1({ database, now: expiredNow });
    expect(await expired.activateBinding(correct)).toEqual(activated.value);
    await expect(expired.activateBinding(wrong)).rejects.toMatchObject({
      code: 'namespace_home_conflict',
    });

    const next = await store.putBinding(await bindingForLane(nowMs + 1, 'new-lane'));
    const previous = { revision: candidate.revision, activationSequence: 1 };
    const replacementA = await readyActivation(
      store,
      next,
      home,
      'tco_replacement_a',
      previous,
      nowMs,
    );
    const replacementB = await readyActivation(
      store,
      next,
      home,
      'tco_replacement_b',
      previous,
      nowMs,
    );
    const replacements = await Promise.allSettled([
      store.activateBinding(replacementA),
      store.activateBinding(replacementB),
    ]);
    let successful = 0;
    let rejected = 0;
    for (const result of replacements) {
      if (result.status === 'fulfilled') successful += 1;
      else {
        expect(result.reason).toMatchObject({ code: 'activation_conflict' });
        rejected += 1;
      }
    }
    expect({ successful, rejected }).toEqual({ successful: 1, rejected: 1 });
    expect(await store.resolveActiveBinding('new-lane')).toEqual(next);
    await expect(store.activateBinding(correct)).rejects.toMatchObject({
      code: 'activation_conflict',
    });
    await expect(
      database
        .prepare(
          'INSERT OR REPLACE INTO tenant_deployment_activations SELECT * FROM tenant_deployment_activations WHERE operation_id = ?1',
        )
        .bind(correct.operationId)
        .run(),
    ).rejects.toThrow('activations are immutable');
    const rows = await database
      .prepare(
        'SELECT operation_id, home_account_id, home_database_id FROM tenant_deployment_activations ORDER BY operation_id',
      )
      .all();
    expect(rows.results).toHaveLength(4);
    const evidencePath = testInfo.outputPath('namespace-home-activation-evidence.json');
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          kind: 'namespace_home_activation_e2e_v1',
          at: new Date().toISOString(),
          topology: 'production Console activation store → local Worker D1',
          migrations,
          activationRows: rows.results,
          sameLaneRace: { successful, rejected },
          historicalBindingUnchanged: true,
          historicalRetryRequiresNewActivation: true,
          historicalBindingAdoptedByNewActivation: true,
          missingAndWrongSqlHomesRejected: true,
          canonicalHomeSqlMismatchRejected: true,
          expiredCompletedRetrySucceeded: true,
          replaceRejected: true,
          physicalResourceVerified: false,
          canonicalBindingIncludesHome: false,
        },
        null,
        2,
      )}\n`,
    );
    await testInfo.attach('namespace-home-activation-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
