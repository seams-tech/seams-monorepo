import { expect, test } from '@playwright/test';
import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  buildTenantRootOperationRecordV1,
  canonicalTenantRootOperationRecordJsonV1,
  parseTenantRootOperationRecordV1,
  type TenantRootIdentityV1,
  type TenantRootSecurityStatusV1,
} from '../../packages/shared-ts/src/tenant-root';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import {
  createTenantRootScheduledRotationIntentV1,
  TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1,
  TENANT_ROOT_SCHEDULED_ROTATION_REQUESTER_V1,
  type TenantRootScheduledActiveGrantV1,
  type TenantRootScheduledIntentDependenciesV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/scheduledIntent';
import {
  parseTenantRootOperationTriggerV1,
  type TenantRootOperationCreateInputV1,
  type TenantRootOperationEntryV1 as StoredOperationEntryV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';

const NOW_MS = Date.parse('2026-09-06T12:00:00.000Z');
const ROOT_COMMITMENT = 'root-commitment-scheduled-intent';
const LINEAGE = 'custody-lineage-scheduled-intent';

function identity(suffix = 'one'): TenantRootIdentityV1 {
  const built = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: `org-scheduled-${suffix}`,
    projectId: `project-scheduled-${suffix}`,
    envId: `env-scheduled-${suffix}`,
    signingRootId: `root-scheduled-${suffix}`,
    signingRootVersion: 'v1',
  });
  if (!built.ok) throw new Error('scheduled intent identity fixture is invalid');
  return built.value;
}

function status(
  value: TenantRootIdentityV1,
  digest: string,
  nextScheduledRotationAt: string | null,
  overrides: { readonly lifecycleRevision?: number; readonly activeEpoch?: number } = {},
): Awaited<ReturnType<TenantRootScheduledIntentDependenciesV1['state']['readStatus']>> {
  const securityStatus: TenantRootSecurityStatusV1 = {
    identity: value,
    custodyLineageId: LINEAGE,
    lifecycleRevision: overrides.lifecycleRevision ?? 11,
    operationalShares: {
      activeEpoch: overrides.activeEpoch ?? 4,
      rootCommitmentFingerprintB64u: ROOT_COMMITMENT,
      deriverAStatus: 'healthy',
      deriverBStatus: 'healthy',
      lastCompletedRotationAt: null,
      nextScheduledRotationAt,
      securityProfile: 'operational_rotation_v1',
      job: null,
    },
    recoveryBackup: { status: 'not_configured' },
    restore: null,
    trustLevel: { kind: 'cryptographically_valid_offline' },
  };
  return {
    status: securityStatus,
    identityDigestB64u: digest,
    custodyLineageB64u: LINEAGE,
    governance: null,
    governanceDigestB64u: 'governance-digest-scheduled-intent',
    rootCommitmentB64u: ROOT_COMMITMENT,
  };
}

async function grant(value: TenantRootIdentityV1): Promise<TenantRootScheduledActiveGrantV1> {
  return {
    identity: value,
    identityDigestB64u: await tenantRootIdentityDigestB64uV1(value),
    custodyLineageB64u: LINEAGE,
    rootCommitmentB64u: ROOT_COMMITMENT,
  };
}

function operationEntry(input: TenantRootOperationCreateInputV1): StoredOperationEntryV1 {
  return {
    operationId: input.operationId,
    ...parseTenantRootOperationTriggerV1(input.operationKind, input.triggerKind),
    operationDigestB64u: input.operationDigestB64u,
    canonicalRecordJson: input.canonicalRecordJson,
    idempotencyKey: input.idempotencyKey,
    requesterUserId: input.requesterUserId,
    approverUserId: input.approverUserId,
    nonceB64u: input.nonceB64u,
    status: 'pending',
    createdAtMs: input.createdAtMs,
    authorizationExpiresAtMs: input.authorizationExpiresAtMs,
    acceptedResultJson: null,
    failureCode: null,
    dispatchUncertainAtMs: null,
  };
}

function operationStore(existing: StoredOperationEntryV1 | null = null) {
  let current = existing;
  const creates: TenantRootOperationCreateInputV1[] = [];
  return {
    creates,
    store: {
      async findByIdempotencyKey(key: string): Promise<StoredOperationEntryV1 | null> {
        return current?.idempotencyKey === key ? current : null;
      },
      async consumeApprovalAndCreateOperation(
        input: TenantRootOperationCreateInputV1,
      ): Promise<StoredOperationEntryV1> {
        creates.push(input);
        current = operationEntry(input);
        return current;
      },
    },
  };
}

async function fixture(input: {
  readonly nextScheduledRotationAt: string | null;
  readonly pending?: readonly {
    readonly entry: StoredOperationEntryV1;
    readonly grant: TenantRootScheduledActiveGrantV1;
  }[];
  readonly grants?: readonly TenantRootScheduledActiveGrantV1[];
  readonly existing?: StoredOperationEntryV1 | null;
}) {
  const selectedIdentity = identity();
  const selectedGrant = await grant(selectedIdentity);
  const selectedStatus = await status(
    selectedIdentity,
    selectedGrant.identityDigestB64u,
    input.nextScheduledRotationAt,
  );
  const memory = operationStore(input.existing ?? null);
  const dependencies: TenantRootScheduledIntentDependenciesV1 = {
    grants: {
      async listActive() {
        return input.grants ?? [selectedGrant];
      },
    },
    state: {
      async readStatus({ identity: requestedIdentity }) {
        expect(requestedIdentity).toBe(selectedIdentity);
        return selectedStatus;
      },
    },
    pending: {
      async listPending() {
        return (input.pending ?? []).map((value) => ({
          orgId: value.grant.identity.orgId,
          identityDigestB64u: value.grant.identityDigestB64u,
          custodyLineageB64u: value.grant.custodyLineageB64u,
          entry: value.entry,
        }));
      },
    },
    operations: () => memory.store,
    newOperationId: () => 'scheduled-operation-row',
    newNonceB64u: () => 'scheduled-operation-nonce',
  };
  return { dependencies, selectedGrant, memory, selectedStatus };
}

async function pendingEntry(
  value: TenantRootIdentityV1,
  input: {
    readonly idempotencyKey: string;
    readonly expiresAtMs: number;
    readonly dispatchUncertainAtMs?: number | null;
  },
): Promise<{ readonly entry: StoredOperationEntryV1; readonly grant: TenantRootScheduledActiveGrantV1 }> {
  const selectedGrant = await grant(value);
  const issuedAt = new Date(input.expiresAtMs - 60_000).toISOString();
  const expiresAt = new Date(input.expiresAtMs).toISOString();
  const built = buildTenantRootOperationRecordV1({
    operationKind: TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1,
    identity: value,
    tenantRootIdentityDigest: selectedGrant.identityDigestB64u,
    custodyLineageId: LINEAGE,
    expectedLifecycleRevision: 11,
    recoveryGovernanceDigest: 'governance-digest-scheduled-intent',
    subject: { kind: 'tenant_root' },
    requesterActorId: TENANT_ROOT_SCHEDULED_ROTATION_REQUESTER_V1,
    idempotencyKey: input.idempotencyKey,
    issuedAt,
    expiresAt,
    expectedRootCommitment: ROOT_COMMITMENT,
  });
  if (!built.ok) throw new Error('scheduled pending operation fixture is invalid');
  const entry: StoredOperationEntryV1 = {
    operationId: 'scheduled-old-row',
    operationKind: TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1,
    triggerKind: 'scheduled',
    operationDigestB64u: 'scheduled-old-digest',
    canonicalRecordJson: canonicalTenantRootOperationRecordJsonV1(built.record),
    idempotencyKey: input.idempotencyKey,
    requesterUserId: TENANT_ROOT_SCHEDULED_ROTATION_REQUESTER_V1,
    approverUserId: null,
    nonceB64u: 'scheduled-old-nonce',
    status: 'pending',
    createdAtMs: input.expiresAtMs - 60_000,
    authorizationExpiresAtMs: input.expiresAtMs,
    acceptedResultJson: null,
    failureCode: null,
    dispatchUncertainAtMs: input.dispatchUncertainAtMs ?? null,
  };
  return { entry, grant: selectedGrant };
}

test('creates one canonical system-owned scheduled rotation intent when due', async () => {
  const dueAt = new Date(NOW_MS - 1).toISOString();
  const setup = await fixture({ nextScheduledRotationAt: dueAt });
  const result = await createTenantRootScheduledRotationIntentV1(setup.dependencies, {
    nowMs: NOW_MS,
  });

  expect(result.kind).toBe('created');
  if (result.kind !== 'created') throw new Error('expected a created intent');
  expect(result.operation.entry.triggerKind).toBe('scheduled');
  expect(result.operation.entry.operationKind).toBe(
    TENANT_ROOT_SCHEDULED_ROTATION_OPERATION_KIND_V1,
  );
  expect(result.operation.entry.requesterUserId).toBe(TENANT_ROOT_SCHEDULED_ROTATION_REQUESTER_V1);
  expect(result.operation.entry.approverUserId).toBeNull();
  expect(setup.memory.creates).toHaveLength(1);
  expect(setup.memory.creates[0]?.consumedApprovalDigestB64u).toBeNull();
  expect(setup.memory.creates[0]?.triggerKind).toBe('scheduled');
  const record = parseTenantRootOperationRecordV1(result.operation.entry.canonicalRecordJson);
  if (record === null) throw new Error('expected the stored canonical operation record');
  expect(record.expectedLifecycleRevision).toBe(11);
  expect(record.expectedRootCommitment).toBe(ROOT_COMMITMENT);
});

test('leaves a future schedule untouched', async () => {
  const future = new Date(NOW_MS + 1_000).toISOString();
  const setup = await fixture({ nextScheduledRotationAt: future });
  const result = await createTenantRootScheduledRotationIntentV1(setup.dependencies, {
    nowMs: NOW_MS,
  });

  expect(result).toEqual({
    kind: 'not_due',
    identityDigestB64u: setup.selectedGrant.identityDigestB64u,
    nextScheduledRotationAtMs: NOW_MS + 1_000,
  });
  expect(setup.memory.creates).toHaveLength(0);
});

test('retries an unknown pending operation before applying the current due bound', async () => {
  const future = new Date(NOW_MS + 60_000).toISOString();
  const old = await pendingEntry(identity(), {
    idempotencyKey: 'scheduled-original-operation',
    expiresAtMs: NOW_MS - 1,
    dispatchUncertainAtMs: NOW_MS,
  });
  const retrySetup = await fixture({
    nextScheduledRotationAt: future,
    pending: [old],
  });
  const result = await createTenantRootScheduledRotationIntentV1(retrySetup.dependencies, {
    nowMs: NOW_MS,
  });

  expect(result.kind).toBe('retry');
  if (result.kind !== 'retry') throw new Error('expected pending retry');
  expect(result.operation.entry.operationId).toBe(old.entry.operationId);
  expect(result.reason).toBe('dispatch_uncertain');
  expect(retrySetup.memory.creates).toHaveLength(0);
});

test('creates a fresh binding after a pending intent expired before admission', async () => {
  const dueAt = new Date(NOW_MS - 1).toISOString();
  const old = await pendingEntry(identity(), {
    idempotencyKey: 'scheduled-expired-original-operation',
    expiresAtMs: NOW_MS - 1,
  });
  const setup = await fixture({
    nextScheduledRotationAt: dueAt,
    pending: [old],
  });
  const result = await createTenantRootScheduledRotationIntentV1(setup.dependencies, {
    nowMs: NOW_MS,
  });
  const repeated = await createTenantRootScheduledRotationIntentV1(setup.dependencies, {
    nowMs: NOW_MS + 60_000,
  });

  expect(result.kind).toBe('created');
  if (result.kind !== 'created') throw new Error('expected a fresh scheduled intent');
  expect(result.operation.entry.idempotencyKey).not.toBe(old.entry.idempotencyKey);
  expect(result.operation.entry.operationId).not.toBe(old.entry.operationId);
  const record = parseTenantRootOperationRecordV1(result.operation.entry.canonicalRecordJson);
  if (record === null) throw new Error('expected the fresh canonical operation record');
  expect(record.requesterActorId).toBe(TENANT_ROOT_SCHEDULED_ROTATION_REQUESTER_V1);
  expect(repeated.kind).toBe('retry');
  if (repeated.kind !== 'retry') throw new Error('expected the fresh intent to remain stable');
  expect(repeated.operation.entry.operationId).toBe(result.operation.entry.operationId);
  expect(setup.memory.creates).toHaveLength(1);
});

test('reuses one pending operation on a repeated tick', async () => {
  const dueAt = new Date(NOW_MS - 1).toISOString();
  const setup = await fixture({ nextScheduledRotationAt: dueAt });
  const first = await createTenantRootScheduledRotationIntentV1(setup.dependencies, {
    nowMs: NOW_MS,
  });
  const second = await createTenantRootScheduledRotationIntentV1(setup.dependencies, {
    nowMs: NOW_MS + 60_000,
  });

  expect(first.kind).toBe('created');
  expect(second.kind).toBe('retry');
  if (first.kind !== 'created' || second.kind !== 'retry') {
    throw new Error('expected the second tick to resume the first operation');
  }
  expect(second.operation.entry.operationId).toBe(first.operation.entry.operationId);
  expect(second.operation.entry.idempotencyKey).toBe(first.operation.entry.idempotencyKey);
  expect(second.reason).toBe('pending');
  expect(setup.memory.creates).toHaveLength(1);
});

test('round-robins active roots when the first root is not due', async () => {
  const active = [await grant(identity('one')), await grant(identity('two'))];
  const ordered = [...active].sort((left, right) =>
    left.identityDigestB64u.localeCompare(right.identityDigestB64u),
  );
  const dueAt = new Date(NOW_MS - 1).toISOString();
  const futureAt = new Date(NOW_MS + 60_000).toISOString();
  const states = new Map(
    ordered.map((value, index) => [
      value.identity.orgId,
      status(value.identity, value.identityDigestB64u, index === 0 ? futureAt : dueAt),
    ]),
  );
  const seen: string[] = [];
  const stores = new Map<string, ReturnType<typeof operationStore>>();
  const dependencies: TenantRootScheduledIntentDependenciesV1 = {
    grants: { listActive: async () => active },
    state: {
      async readStatus({ identity: requestedIdentity }) {
        seen.push(requestedIdentity.orgId);
        const current = states.get(requestedIdentity.orgId);
        if (current === undefined) throw new Error('missing scheduled state fixture');
        return current;
      },
    },
    pending: { listPending: async () => [] },
    operations: ({ orgId }) => {
      const existing = stores.get(orgId);
      if (existing !== undefined) return existing.store;
      const created = operationStore();
      stores.set(orgId, created);
      return created.store;
    },
    newOperationId: () => 'scheduled-round-robin-operation',
    newNonceB64u: () => 'scheduled-round-robin-nonce',
  };

  const first = await createTenantRootScheduledRotationIntentV1(dependencies, {
    nowMs: NOW_MS,
  });
  const second = await createTenantRootScheduledRotationIntentV1(dependencies, {
    nowMs: NOW_MS + 60_000,
  });

  expect(first.kind).toBe('not_due');
  expect(second.kind).toBe('created');
  expect(seen).toEqual([ordered[0]?.identity.orgId, ordered[1]?.identity.orgId]);
});
