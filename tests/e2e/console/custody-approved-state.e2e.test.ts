import { expect, test } from '@playwright/test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  buildTenantRootOperationRecordV1,
  canonicalTenantRootOperationRecordJsonV1,
  tenantRootOperationDigestB64uV1,
  type TenantRootOperationRecordResultV1,
} from '../../../packages/wallet-console-shared-ts/src/tenant-root';
import { createD1TenantRootCustodyStoreV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/custodyD1';
import { commitRecipientPairV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/custodyService';
import { createD1TenantRootOperationStoreV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/d1';
import { resolveTenantRootOperationRecordV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const namespace = 'custody-approved-state';
const orgId = 'custody-approved-state-org';
const identityDigestB64u = 'custody-approved-state-identity';
const custodyLineageB64u = 'custody-approved-state-lineage';
const issuedAtMs = Date.parse('2026-10-22T12:00:00.000Z');
const expectedPair = {
  deriverAFingerprintB64u: 'deriver-a-approved',
  deriverBFingerprintB64u: 'deriver-b-approved',
};

function fixedNow(): number {
  return issuedAtMs;
}

async function readRoot() {
  return { lifecycleRevision: 1, rootCommitmentB64u: 'custody-root-commitment' };
}

async function migrate(database: Awaited<ReturnType<Miniflare['getD1Database']>>): Promise<void> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    const sql = await readFile(path.join(directory, name), 'utf8');
    for (const statement of unstable_splitSqlQuery(sql)) {
      await database.prepare(statement).run();
    }
  }
}

function stagedRecipient(role: 'deriver_a' | 'deriver_b', fingerprint: string) {
  return {
    role,
    recipientPublicKeyB64u: `public-key-${fingerprint}`,
    recipientFingerprintB64u: fingerprint,
    verifiedAtMs: issuedAtMs,
  };
}

function shouldNotBuild(): TenantRootOperationRecordResultV1 {
  throw new Error('A reused operation must not build another record');
}

test('custody retries preserve the stored target and recipient pair', async ({
  request: _request,
}, testInfo) => {
  const worker = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("custody fixture"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'custody-approved-state' },
    d1Persist: testInfo.outputPath('state'),
  });
  try {
    const database = await worker.getD1Database('CONSOLE_DB');
    if (!isD1DatabaseLike(database)) throw new Error('D1 test database is unavailable');
    await migrate(database);

    const custody = createD1TenantRootCustodyStoreV1({
      database,
      namespace,
      orgId,
      identityDigestB64u,
      custodyLineageB64u,
      readRoot,
      now: fixedNow,
    });
    await custody.putStagedRecipient(
      stagedRecipient('deriver_a', expectedPair.deriverAFingerprintB64u),
    );
    await custody.putStagedRecipient(
      stagedRecipient('deriver_b', expectedPair.deriverBFingerprintB64u),
    );
    await custody.putStagedRecipient(stagedRecipient('deriver_a', 'deriver-a-replaced'));

    const changedPair = await commitRecipientPairV1(custody, {
      actorUserId: 'requester-owner',
      atIso: new Date(issuedAtMs).toISOString(),
      expectedPair,
    });
    expect(changedPair).toMatchObject({
      ok: false,
      error: { kind: 'recipient', error: { kind: 'recipient_pair_changed' } },
    });
    await expect(custody.putRecipientPair(expectedPair)).rejects.toThrow(
      'recipient pair write conflicted',
    );
    expect((await custody.readState()).recipientPair).toBeNull();

    await custody.putStagedRecipient(
      stagedRecipient('deriver_a', expectedPair.deriverAFingerprintB64u),
    );
    const committed = await commitRecipientPairV1(custody, {
      actorUserId: 'requester-owner',
      atIso: new Date(issuedAtMs).toISOString(),
      expectedPair,
    });
    expect(committed).toMatchObject({ ok: true, value: expectedPair });
    expect((await custody.readState()).recipientPair).toEqual(expectedPair);

    const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
      orgId,
      projectId: 'custody-project',
      envId: 'custody-environment',
      signingRootId: 'signing-root-id',
      signingRootVersion: 'v1',
    });
    if (!identity.ok) throw new Error('Custody test identity was invalid');
    const built = buildTenantRootOperationRecordV1({
      operationKind: 'tenant_root_recovery_governance_change_v1',
      identity: identity.value,
      tenantRootIdentityDigest: identityDigestB64u,
      custodyLineageId: custodyLineageB64u,
      expectedLifecycleRevision: 1,
      recoveryGovernanceDigest: 'current-governance-digest',
      subject: { kind: 'tenant_root' },
      requesterActorId: 'requester-owner',
      idempotencyKey: 'governance-choice-key',
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(issuedAtMs + 600_000).toISOString(),
      expectedRootCommitment: 'custody-root-commitment',
    });
    if (!built.ok) throw new Error('Custody test operation was invalid');
    const operationStore = createD1TenantRootOperationStoreV1({
      database,
      namespace,
      orgId,
      identityDigestB64u,
      custodyLineageB64u,
      now: fixedNow,
    });
    const approvedPayload = JSON.stringify({ targetGovernanceKind: 'two_person_v1' });
    await operationStore.consumeApprovalAndCreateOperation({
      operationId: 'governance-choice-operation',
      operationKind: 'tenant_root_recovery_governance_change_v1',
      triggerKind: 'manual',
      operationDigestB64u: await tenantRootOperationDigestB64uV1(built.record),
      canonicalRecordJson: canonicalTenantRootOperationRecordJsonV1(built.record),
      payloadJson: approvedPayload,
      idempotencyKey: built.record.idempotencyKey,
      requesterUserId: built.record.requesterActorId,
      approverUserId: null,
      consumedApprovalDigestB64u: null,
      nonceB64u: 'operation-nonce',
      createdAtMs: issuedAtMs,
      authorizationExpiresAtMs: issuedAtMs + 600_000,
    });
    const acceptedRetry = await resolveTenantRootOperationRecordV1(operationStore, {
      idempotencyKey: built.record.idempotencyKey,
      operationKind: built.record.operationKind,
      requesterUserId: built.record.requesterActorId,
      payloadJson: approvedPayload,
      nowMs: issuedAtMs + 1_000,
      build: shouldNotBuild,
    });
    expect(acceptedRetry).toMatchObject({ ok: true, reused: true });
    const changedTarget = await resolveTenantRootOperationRecordV1(operationStore, {
      idempotencyKey: built.record.idempotencyKey,
      operationKind: built.record.operationKind,
      requesterUserId: built.record.requesterActorId,
      payloadJson: JSON.stringify({ targetGovernanceKind: 'single_owner_v1' }),
      nowMs: issuedAtMs + 1_000,
      build: shouldNotBuild,
    });
    expect(changedTarget).toMatchObject({
      ok: false,
      error: { kind: 'idempotency_key_reused_with_different_operation' },
    });

    const evidencePath = testInfo.outputPath('custody-approved-state.json');
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          changedRecipientPairRejected: true,
          atomicPairWriteRejected: true,
          approvedRecipientPairCommitted: expectedPair,
          matchingGovernanceRetryAccepted: acceptedRetry.ok,
          changedGovernanceTargetRejected: !changedTarget.ok,
        },
        null,
        2,
      )}\n`,
    );
    await testInfo.attach('custody-approved-state', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await worker.dispose();
  }
});
