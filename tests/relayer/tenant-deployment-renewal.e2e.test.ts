import { expect, test } from '@playwright/test';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConsoleApiKeyService } from '../../packages/console-server-ts/src/apiKeys/service';
import type { TenantDeploymentBindingV1 } from '../../packages/wallet-console-shared-ts/src/tenant-deployment';
import type { TenantDeploymentResourceVerificationsV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import type { TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/service';
import {
  regionalResourceProof,
  bindingForResource,
  deploymentResource,
} from '../helpers/tenantDeploymentFixtures';
import type { TenantDeploymentRuntimeScopeV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/runtimeInspection';
import { provisioningScenario } from '../helpers/tenantDeploymentProvisioningScenario';
import { regionalReadinessScenario } from '../helpers/regionalReadinessScenario';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

class CanaryEndpoint {
  apiKeys: ConsoleApiKeyService | null = null;
  environmentId = '';
  accepted = 0;

  async handle(request: IncomingMessage, response: ServerResponse) {
    const authenticate = this.apiKeys?.authenticatePublishableKey;
    if (!authenticate || !this.apiKeys) throw new Error('Canary fixture was not initialized');
    const result = await authenticate.call(this.apiKeys, {
      secret: String(request.headers.authorization).slice(7),
      origin: String(request.headers.origin),
      environmentId: this.environmentId,
    });
    if (!result.ok || request.url !== '/wallets/register/setup' || request.method !== 'POST') {
      response.writeHead(403);
      response.end();
      return;
    }
    this.accepted += 1;
    response.end(JSON.stringify({ ok: true, fixture: 'authenticated-registration-canary' }));
  }
}

class LostActivationReply {
  constructor(readonly activate: TenantDeploymentServiceV1['activateBinding']) {}

  async activateBinding(
    input: Parameters<TenantDeploymentServiceV1['activateBinding']>[0],
  ): Promise<never> {
    await this.activate(input);
    throw new Error('Activation reply lost after commit');
  }
}

function proofs(reference: TenantDeploymentBindingV1): TenantDeploymentResourceVerificationsV1 {
  const [first, ...remaining] = reference.resources;
  const result: [ReturnType<typeof resourceProof>, ...ReturnType<typeof resourceProof>[]] = [
    resourceProof(reference, first.databaseId),
  ];
  for (const resource of remaining) result.push(resourceProof(reference, resource.databaseId));
  return result;
}

function resourceProof(reference: TenantDeploymentBindingV1, databaseId: string) {
  return regionalResourceProof(
    reference,
    databaseId,
    crypto.randomUUID(),
    crypto.randomUUID(),
    Date.now(),
  );
}

async function checkWriters(
  store: TenantDeploymentServiceV1,
  verifications: TenantDeploymentResourceVerificationsV1,
  expectedRevision: string | null,
): Promise<number> {
  let count = 0;
  for (const proof of verifications) {
    if (proof.authority.kind !== 'cloudflare') throw new Error('Missing hosted proof');
    for (const role of ['gateway', 'walletRuntime'] as const) {
      const lookup = store.resolveRuntimeBinding(proof.deploymentLane, {
        role,
        versionId: proof.authority[role].versionId,
        resource: proof.resource,
      });
      if (expectedRevision === null) {
        await expect(lookup).rejects.toMatchObject({ code: 'activation_conflict' });
      } else {
        expect((await lookup)?.revision).toBe(expectedRevision);
      }
      count += 1;
    }
  }
  return count;
}

async function migrate(database: D1DatabaseLike, directory: string) {
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    for (const sql of unstable_splitSqlQuery(await readFile(path.join(directory, name), 'utf8'))) {
      await database.prepare(sql).run();
    }
  }
}

async function seedOccupancy(
  database: D1DatabaseLike,
  scope: TenantDeploymentRuntimeScopeV1,
  count: number,
) {
  for (let index = 0; index < count; index += 1) {
    await database
      .prepare(
        `INSERT INTO wallets
      (namespace, org_id, project_id, env_id, wallet_id, record_json, created_at_ms, updated_at_ms)
      VALUES (?1,?2,?3,?4,?5,json_object('version','wallet_v1','walletId',?5),0,0)`,
      )
      .bind(
        scope.namespace,
        scope.organizationId,
        scope.projectId,
        scope.environmentId,
        `occupancy-${index}`,
      )
      .run();
  }
}

async function seedCeremony(
  database: D1DatabaseLike,
  scope: TenantDeploymentRuntimeScopeV1,
  expiresAtMs: number,
) {
  await database
    .prepare(
      `INSERT INTO registration_ceremony_records
    (namespace, org_id, project_id, env_id, record_scope, record_id, version, record_json, expires_at_ms)
    VALUES (?1,?2,?3,?4,'readiness-fixture','occupancy',1,'{}',?5)`,
    )
    .bind(scope.namespace, scope.organizationId, scope.projectId, scope.environmentId, expiresAtMs)
    .run();
}

test('regional deployment renewal preserves the browser key and retires previous writer versions', async () => {
  const testInfo = test.info();
  test.setTimeout(120_000);
  const regional = await regionalReadinessScenario(testInfo.outputPath('workers'));
  const { runtime } = regional;
  const endpoint = new CanaryEndpoint();
  const server = createServer(endpoint.handle.bind(endpoint));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Canary server address missing');
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'console');
    const usDatabase = await runtime.getD1Database('SIGNER_DB', 'runtime-us');
    const weurDatabase = await runtime.getD1Database('SIGNER_DB', 'runtime-weur');
    const apacDatabase = await runtime.getD1Database('SIGNER_DB', 'runtime-apac');
    if (
      !isD1DatabaseLike(database) ||
      !isD1DatabaseLike(usDatabase) ||
      !isD1DatabaseLike(weurDatabase) ||
      !isD1DatabaseLike(apacDatabase)
    )
      throw new Error('D1 unavailable');
    await migrate(
      database,
      path.join(repoRoot, 'packages/wallet-console-server-ts/migrations/d1-console'),
    );
    for (const signerDatabase of [usDatabase, weurDatabase, apacDatabase])
      await migrate(
        signerDatabase,
        path.join(
          process.env.SEAMS_WALLET_SERVER_CANDIDATE ??
            path.join(repoRoot, '../seams-wallet/packages/wallet-server'),
          'migrations/d1-signer',
        ),
      );
    const scenario = await provisioningScenario(
      database,
      regional.inspector,
      `http://127.0.0.1:${address.port}`,
    );
    const { provisioner, store, reference, apiKeys, router, adapter, context, environmentId } =
      scenario;
    endpoint.apiKeys = apiKeys;
    endpoint.environmentId = environmentId;
    const initialProofs = proofs(reference);
    const activate = store.activateBinding.bind(store);
    const lostReply = new LostActivationReply(activate);
    store.activateBinding = lostReply.activateBinding.bind(lostReply);
    await expect(
      provisioner.provision({
        deploymentLane: reference.deploymentLane,
        environmentId,
        authorization: { kind: 'activate', verifications: initialProofs },
      }),
    ).rejects.toThrow('Activation reply lost after commit');
    store.activateBinding = activate;
    const initial = await provisioner.provision({
      deploymentLane: reference.deploymentLane,
      environmentId,
      authorization: { kind: 'reuse_active' },
    });
    expect(initial.disposition).toBe('reused');
    expect(initial.activationSequence).toBe(1);
    const initialBinding = await store.resolveActiveBinding(reference.deploymentLane);
    if (!initialBinding) throw new Error('Missing active binding');
    await checkWriters(store, initialProofs, initial.bindingRevision);
    const reused = await provisioner.provision({
      deploymentLane: reference.deploymentLane,
      environmentId,
      authorization: { kind: 'reuse_active' },
    });
    expect(reused.disposition).toBe('reused');
    expect(reused.activationSequence).toBe(initial.activationSequence);
    const nextProofs = proofs(reference);
    const target = {
      namespace: initialBinding.tenant.namespace,
      organizationId: initialBinding.tenant.organizationId,
      projectId: initialBinding.tenant.projectId,
      environmentId,
    };
    const source = {
      namespace: target.namespace,
      organizationId: target.organizationId,
      projectId: 'project_source',
      environmentId: 'project_source:dev',
    };
    const inspectionRequest = { bindingRevision: initialBinding.revision, source, target };
    let walletCount = 1;
    for (const signerDatabase of [usDatabase, weurDatabase, apacDatabase]) {
      await seedOccupancy(signerDatabase, target, walletCount);
      await seedOccupancy(signerDatabase, source, 1);
      walletCount += 1;
    }
    await seedCeremony(weurDatabase, target, Date.now() - 1000);
    await seedCeremony(apacDatabase, target, Date.now() + 300_000);
    const regionalCounts = await regional.inspector.inspect(inspectionRequest);
    expect(regionalCounts).toMatchObject({
      sourceDurableWalletCount: 3,
      targetDurableWalletCount: 6,
      inFlightCeremonyCount: 1,
    });
    await expect(regional.wrongResourceInspector.inspect(inspectionRequest)).rejects.toThrow(
      'invalid readiness inspection',
    );
    await expect(
      adapter.inspect(
        await bindingForResource(
          Date.now(),
          reference.deploymentLane,
          deploymentResource('wallet', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        ),
      ),
    ).rejects.toThrow('do not cover the deployment resource set');
    await expect(
      provisioner.provision({
        deploymentLane: reference.deploymentLane,
        environmentId,
        authorization: { kind: 'activate', verifications: nextProofs },
      }),
    ).rejects.toMatchObject({ code: 'readiness_invalid' });
    await apacDatabase.prepare('DELETE FROM registration_ceremony_records').run();
    regional.apacTransport.available = false;
    await expect(
      provisioner.provision({
        deploymentLane: reference.deploymentLane,
        environmentId,
        authorization: { kind: 'activate', verifications: nextProofs },
      }),
    ).rejects.toThrow('HTTP 503');
    expect((await store.findActiveBinding(reference.deploymentLane))?.revision).toBe(
      initial.bindingRevision,
    );
    regional.apacTransport.available = true;
    await expect(
      provisioner.provision({
        deploymentLane: reference.deploymentLane,
        environmentId,
        authorization: { kind: 'activate', verifications: [nextProofs[0]] },
      }),
    ).rejects.toMatchObject({ code: 'readiness_invalid' });
    router.available = false;
    await expect(
      provisioner.provision({
        deploymentLane: reference.deploymentLane,
        environmentId,
        authorization: { kind: 'activate', verifications: nextProofs },
      }),
    ).rejects.toThrow('Router tenant-root status returned HTTP 503');
    expect((await store.findActiveBinding(reference.deploymentLane))?.revision).toBe(
      initial.bindingRevision,
    );
    await checkWriters(store, initialProofs, initial.bindingRevision);
    router.available = true;
    const renewed = await provisioner.provision({
      deploymentLane: reference.deploymentLane,
      environmentId,
      authorization: { kind: 'activate', verifications: nextProofs },
    });
    expect(renewed.disposition).toBe('activated');
    expect(renewed.activationSequence).toBe(initial.activationSequence + 1);
    expect(renewed.bindingRevision).not.toBe(initial.bindingRevision);
    expect(renewed.credentialId).toBe(initial.credentialId);
    expect((await store.resolveActiveBinding(reference.deploymentLane))?.browserCredential).toEqual(
      initialBinding.browserCredential,
    );
    const admitted = await checkWriters(store, nextProofs, renewed.bindingRevision);
    const retired = await checkWriters(store, initialProofs, null);
    expect(await apiKeys.listApiKeys(context)).toHaveLength(1);

    // A real persisted credential failure must release the lane for another attempt.
    await apiKeys.revokeApiKey(context, initial.credentialId, { reason: 'fixture invalidation' });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        provisioner.provision({
          deploymentLane: reference.deploymentLane,
          environmentId,
          authorization: { kind: 'activate', verifications: proofs(reference) },
        }),
      ).rejects.toThrow('configured publishable credential is invalid');
    }
    expect((await store.findActiveBinding(reference.deploymentLane))?.revision).toBe(
      renewed.bindingRevision,
    );
    expect(await apiKeys.listApiKeys(context)).toHaveLength(1);
    const failed = await database
      .prepare(
        "SELECT COUNT(*) AS count FROM tenant_deployment_cutovers WHERE json_extract(state_json, '$.kind') = 'failed'",
      )
      .first('count');
    expect(failed).toBe(5);
    expect(endpoint.accepted).toBe(1);
    const evidence = {
      kind: 'regional_deployment_renewal_evidence_v1',
      initialRevision: initial.bindingRevision,
      renewedRevision: renewed.bindingRevision,
      activationSequence: renewed.activationSequence,
      admittedWriters: admitted,
      retiredWriters: retired,
      credentialCount: 1,
      browserCredentialPreserved: true,
      committedActivationPreservedAfterLostReply: true,
      incompleteProofSetRejected: true,
      regionalCounts,
      crossResourceReadinessRejected: true,
      incompleteReadinessCoverageRejected: true,
      apacCeremonyBlockedRenewal: true,
      unavailableApacBlockedRenewal: true,
      failedRootAndCredentialAttemptsReleased: failed,
      authenticatedCanaries: endpoint.accepted,
      limits: [
        'Local D1 and production Console services; provider proofs and Router status are controlled fixtures.',
        'Canary endpoint authenticates the real persisted browser key; no wallet ceremony or regional latency is measured.',
      ],
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    const artifact = testInfo.outputPath('deployment-renewal-evidence.json');
    await writeFile(artifact, serialized);
    await testInfo.attach('deployment-renewal-evidence', {
      path: artifact,
      contentType: 'application/json',
    });
    console.log(
      `Deployment renewal evidence SHA-256: ${createHash('sha256').update(serialized).digest('hex')}`,
    );
  } finally {
    server.close();
    await runtime.dispose();
  }
});
