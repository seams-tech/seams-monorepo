import { expect, test } from '@playwright/test';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import {
  buildTenantDeploymentBindingV1,
  adoptTenantDeploymentBindingHomeV1,
  decodeTenantDeploymentBindingV1,
} from '../../packages/wallet-console-shared-ts/src/tenant-deployment';
import {
  historicalBindingFixture,
  namespaceHome,
  readyActivation,
} from '../helpers/tenantDeploymentFixtures';
import { bindTenantDeploymentToRuntimeEnvironmentV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/runtimeBinding';

function unusedService(): Promise<Response> {
  throw new Error('runtime binding must not fetch');
}

test('historical bindings require explicit adoption and home identity is revision-bound', async ({
  request,
}, testInfo) => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ready"); } };',
    d1Databases: { CONSOLE_DB: 'home-adoption' },
  });
  const migrations = [];
  try {
    expect((await request.get(String(await runtime.ready))).status()).toBe(200);
    const database = await runtime.getD1Database('CONSOLE_DB');
    if (!isD1DatabaseLike(database)) throw new Error('D1 is unavailable');
    for (const name of [
      '0046_tenant_deployment_bindings.sql',
      '0047_namespace_d1_homes.sql',
      '0048_tenant_deployment_activation_homes.sql',
      '0049_tenant_deployment_binding_homes.sql',
      '0050_tenant_deployment_home_verification.sql',
    ]) {
      const sql = await readFile(
        new URL(
          `../../packages/wallet-console-server-ts/migrations/d1-console/${name}`,
          import.meta.url,
        ),
        'utf8',
      );
      for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
      migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
    }
    const historical = await historicalBindingFixture(Date.now() - 1000, 'adoption-lane');
    const originalJson = JSON.stringify(historical);
    await database
      .prepare(
        `INSERT INTO tenant_deployment_bindings (deployment_lane, revision, schema_version, binding_json, namespace, org_id, project_id, environment_id, tenant_root_identity_digest_b64u, custody_lineage_id, credential_id, runtime_policy_digest_b64u, created_at_ms) VALUES (?1,?2,1,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
      )
      .bind(
        historical.deploymentLane,
        historical.revision,
        originalJson,
        historical.tenant.namespace,
        historical.tenant.organizationId,
        historical.tenant.projectId,
        historical.tenant.environmentId,
        historical.tenantRoot.identityDigestB64u,
        historical.tenantRoot.custodyLineageId,
        historical.browserCredential.credentialId,
        historical.runtimePolicyDigestB64u,
        historical.createdAtMs,
      )
      .run();
    await database
      .prepare(`INSERT INTO active_tenant_deployment_bindings VALUES (?1,?2,NULL,1,?3)`)
      .bind(historical.deploymentLane, historical.revision, Date.now())
      .run();
    const store = createD1TenantDeploymentServiceV1({ database });
    const home = namespaceHome('wallet', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect((await decodeTenantDeploymentBindingV1(historical)).ok).toBe(false);
    const corruptHistorical = JSON.parse(originalJson);
    corruptHistorical.createdAtMs += 1;
    expect(
      (
        await adoptTenantDeploymentBindingHomeV1(corruptHistorical, {
          accountId: home.accountId,
          databaseId: home.databaseId,
        })
      ).ok,
    ).toBe(false);
    await expect(store.resolveActiveBinding(historical.deploymentLane)).rejects.toMatchObject({
      code: 'invalid_record',
    });
    await expect(
      store.adoptBindingHome(historical.deploymentLane, historical.revision, home),
    ).rejects.toMatchObject({ code: 'namespace_home_unassigned' });
    await store.reserveNamespaceHome(home);
    const wrongHome = namespaceHome('wallet', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    await expect(
      store.adoptBindingHome(historical.deploymentLane, historical.revision, wrongHome),
    ).rejects.toMatchObject({ code: 'namespace_home_conflict' });
    const adopted = await store.adoptBindingHome(
      historical.deploymentLane,
      historical.revision,
      home,
    );
    expect(adopted.revision).not.toBe(historical.revision);
    expect(
      await store.adoptBindingHome(historical.deploymentLane, historical.revision, home),
    ).toEqual(adopted);
    expect(await store.findActiveBinding(historical.deploymentLane)).toMatchObject({
      revision: historical.revision,
      activationSequence: 1,
    });
    const nowMs = Date.now();
    const activation = await readyActivation(
      store,
      adopted,
      home,
      'tco_adopt_binding',
      { revision: historical.revision, activationSequence: 1 },
      nowMs,
    );
    const result = await store.activateBinding(activation);
    expect(await store.activateBinding(activation)).toEqual(result);
    expect(await store.resolveActiveBinding(historical.deploymentLane)).toEqual(adopted);
    expect(
      await database
        .prepare('SELECT binding_json FROM tenant_deployment_bindings WHERE revision = ?1')
        .bind(historical.revision)
        .first('binding_json'),
    ).toBe(originalJson);
    const tampered = JSON.parse(JSON.stringify(adopted));
    tampered.home.databaseId = wrongHome.databaseId;
    expect((await decodeTenantDeploymentBindingV1(tampered)).ok).toBe(false);
    delete tampered.revision;
    const rebuilt = await buildTenantDeploymentBindingV1(tampered);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) throw new Error(rebuilt.message);
    expect(rebuilt.value.revision).not.toBe(adopted.revision);
    const env = {
      WALLET_CONSOLE: { fetch: unusedService },
      SEAMS_TENANT_DEPLOYMENT_LANE: adopted.deploymentLane,
      SEAMS_D1_HOME_ACCOUNT_ID: home.accountId,
      SEAMS_D1_HOME_DATABASE_ID: home.databaseId,
    };
    expect(
      bindTenantDeploymentToRuntimeEnvironmentV1(env, adopted).SEAMS_TENANT_STORAGE_NAMESPACE,
    ).toBe('wallet');
    env.SEAMS_D1_HOME_DATABASE_ID = wrongHome.databaseId;
    expect(bindTenantDeploymentToRuntimeEnvironmentV1.bind(null, env, adopted)).toThrow(
      'runtime D1 resource conflicts',
    );
    const evidence = {
      kind: 'canonical_binding_home_adoption_e2e_v1',
      at: new Date().toISOString(),
      migrations,
      oldRevision: historical.revision,
      newRevision: adopted.revision,
      changedHomeRevision: rebuilt.value.revision,
      originalRowPreserved: true,
      adoptionRetryStable: true,
      activationRetryStable: true,
      wrongRuntimeRejected: true,
      physicalResourceVerified: false,
      readiness: 'fixture receipt; authenticated readiness/adoption orchestration remains open',
    };
    const evidencePath = testInfo.outputPath('binding-home-adoption-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('binding-home-adoption-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
