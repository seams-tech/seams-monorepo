import { expect, test } from '@playwright/test';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import {
  buildTenantRootOperationRecordV1,
  canonicalTenantRootOperationRecordJsonV1,
  type TenantRootOperationRecordInputV1,
  type TenantRootOperationRecordV1,
  type TenantRootRecoveryGovernanceV1,
} from '../../packages/shared-ts/src/tenant-root';

type ActiveTenantRootOperationRecordInputV1 = Exclude<
  TenantRootOperationRecordInputV1,
  { readonly operationKind: 'tenant_root_restore_role_import_key_issue_v1' }
>;
import type { TenantRootOperationApprovalRecordV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/authorization';
import {
  approveTenantRootOperationV1,
  expireTenantRootOperationV1,
  recordTenantRootOperationAcceptedV1,
  resolveTenantRootOperationRecordV1,
  startTenantRootOperationV1,
  TENANT_ROOT_APPROVAL_RACE_MARKER_V1,
  parseTenantRootOperationTriggerV1,
  type TenantRootApprovalCreateInputV1,
  type TenantRootApprovalRequestV1,
  type TenantRootOperationCreateInputV1,
  type TenantRootOperationEntryV1,
  type TenantRootOperationStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';
import {
  parseTenantRootStepUpV1,
  type TenantRootStepUpProofV1,
  type TenantRootStepUpSessionRecordV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';

const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');
const EXPIRES_AT = '2026-09-05T12:05:00.000Z';
const GOVERNANCE_DIGEST = 'hUXBekkP6CYYQtt4VJAzSMt0jTshXPte-Te5Q0uBKpc';
const REQUESTER = 'owner-1';
const APPROVER = 'owner-2';

const TWO_PERSON: TenantRootRecoveryGovernanceV1 = {
  kind: 'two_person_v1',
  selectedByOwnerId: REQUESTER,
  selectedAt: '2026-08-01T00:00:00.000Z',
};

/**
 * A reference store with the atomicity the port requires: the approval and the
 * operation are written together, and a second consumption of the same
 * approval fails rather than silently succeeding.
 */
class MemoryStore implements TenantRootOperationStoreV1 {
  readonly entries = new Map<string, TenantRootOperationEntryV1>();
  readonly byIdempotencyKey = new Map<string, string>();
  readonly approvals = new Map<string, TenantRootOperationApprovalRecordV1>();
  readonly requests = new Map<string, TenantRootApprovalRequestV1>();

  async findByIdempotencyKey(key: string): Promise<TenantRootOperationEntryV1 | null> {
    const id = this.byIdempotencyKey.get(key);
    return id === undefined ? null : (this.entries.get(id) ?? null);
  }

  async findApproval(digest: string): Promise<TenantRootOperationApprovalRecordV1 | null> {
    return this.approvals.get(digest) ?? null;
  }

  async findApprovalRequestByIdempotencyKey(
    key: string,
  ): Promise<TenantRootApprovalRequestV1 | null> {
    return [...this.requests.values()].find((request) => request.idempotencyKey === key) ?? null;
  }

  async findApprovalRequestByDigest(digest: string): Promise<TenantRootApprovalRequestV1 | null> {
    return this.requests.get(digest) ?? null;
  }

  async putApprovalRequest(request: TenantRootApprovalRequestV1): Promise<void> {
    if (!this.requests.has(request.operationDigestB64u)) {
      this.requests.set(request.operationDigestB64u, request);
    }
  }

  async listApprovalRequests(): Promise<readonly TenantRootApprovalRequestV1[]> {
    return [...this.requests.values()];
  }

  async recordApproval(input: TenantRootApprovalCreateInputV1): Promise<void> {
    if (input.approverUserId === input.requesterUserId) throw new Error('self-approval');
    if (this.approvals.has(input.operationDigestB64u)) throw new Error('already approved');
    this.approvals.set(input.operationDigestB64u, {
      operationDigestB64u: input.operationDigestB64u,
      approverUserId: input.approverUserId,
      approverStepUp: input.approverStepUp,
      approvedAtMs: input.approvedAtMs,
      consumedAtMs: null,
    });
  }

  async consumeApprovalAndCreateOperation(
    input: TenantRootOperationCreateInputV1,
  ): Promise<TenantRootOperationEntryV1> {
    if (this.byIdempotencyKey.has(input.idempotencyKey)) {
      throw new Error('idempotency key already exists');
    }
    if (input.consumedApprovalDigestB64u !== null) {
      const approval = this.approvals.get(input.consumedApprovalDigestB64u);
      if (approval === undefined || approval.consumedAtMs !== null) {
        throw new Error(TENANT_ROOT_APPROVAL_RACE_MARKER_V1);
      }
      this.approvals.set(input.consumedApprovalDigestB64u, {
        ...approval,
        consumedAtMs: input.createdAtMs,
      });
    }
    this.requests.delete(input.operationDigestB64u);
    const entry: TenantRootOperationEntryV1 = {
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
    this.entries.set(entry.operationId, entry);
    this.byIdempotencyKey.set(entry.idempotencyKey, entry.operationId);
    return entry;
  }

  async markAccepted(
    operationId: string,
    acceptedResultJson: string,
  ): Promise<TenantRootOperationEntryV1> {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    const accepted: TenantRootOperationEntryV1 = {
      ...entry,
      status: 'accepted',
      acceptedResultJson: entry.acceptedResultJson ?? acceptedResultJson,
    };
    this.entries.set(operationId, accepted);
    return accepted;
  }

  async markDispatchUncertain(
    operationId: string,
    atMs: number,
  ): Promise<TenantRootOperationEntryV1> {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    const marked: TenantRootOperationEntryV1 = { ...entry, dispatchUncertainAtMs: atMs };
    this.entries.set(operationId, marked);
    return marked;
  }

  async markFailed(operationId: string, failureCode: string): Promise<TenantRootOperationEntryV1> {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    const failed: TenantRootOperationEntryV1 = { ...entry, status: 'failed', failureCode };
    this.entries.set(operationId, failed);
    return failed;
  }

  async markAuthorizationExpired(operationId: string): Promise<TenantRootOperationEntryV1> {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    if (entry.status === 'accepted') return entry;
    const expired: TenantRootOperationEntryV1 = { ...entry, status: 'authorization_expired' };
    this.entries.set(operationId, expired);
    return expired;
  }
}

function identity() {
  const result = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: 'org-1',
    projectId: 'project-2',
    envId: 'production',
    signingRootId: 'root-main',
    signingRootVersion: 'v3',
  });
  if (!result.ok) throw new Error('identity fixture is invalid');
  return result.value;
}

function record(
  idempotencyKey: string,
  operationKind: ActiveTenantRootOperationRecordInputV1['operationKind'] =
    'tenant_root_recovery_recipient_pair_replace_v1',
  issuedAt = '2026-09-05T11:58:00.000Z',
): TenantRootOperationRecordV1 {
  const built = buildTenantRootOperationRecordV1({
    operationKind,
    identity: identity(),
    tenantRootIdentityDigest: 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos',
    custodyLineageId: 'MTExMTExMTExMTExMTExMQ',
    expectedLifecycleRevision: 7,
    recoveryGovernanceDigest: GOVERNANCE_DIGEST,
    subject:
      operationKind === 'tenant_root_recovery_recipient_pair_replace_v1'
        ? {
            kind: 'recipient_pair',
            recipientPairDigest: 'mpqampqampqampqampqampqampqampqampqampqampo',
          }
        : { kind: 'tenant_root' },
    requesterActorId: REQUESTER,
    idempotencyKey,
    issuedAt,
    expiresAt: EXPIRES_AT,
    expectedRootCommitment: '6IKxMQFrUsHTM3CAGHz3aEI-_Mu1F7tJWrgSxBYP9E4',
  });
  if (!built.ok) throw new Error(`record rejected: ${JSON.stringify(built.error)}`);
  return built.record;
}

function stepUp(actorUserId: string): TenantRootStepUpSessionRecordV1 {
  return {
    actorUserId,
    sessionId: `session-${actorUserId}`,
    method: 'webauthn_platform_v1',
    verifiedAtMs: NOW_MS - 30_000,
  };
}

function proof(actorUserId: string): TenantRootStepUpProofV1 {
  const parsed = parseTenantRootStepUpV1({
    record: stepUp(actorUserId),
    expectedActorUserId: actorUserId,
    nowMs: NOW_MS,
  });
  if (!parsed.ok) throw new Error('step-up fixture is invalid');
  return parsed.proof;
}

function digestFor(value: TenantRootOperationRecordV1): string {
  // A stand-in digest: the service only requires that it identify the record.
  return `digest-${canonicalTenantRootOperationRecordJsonV1(value).length}-${value.idempotencyKey}`;
}

async function start(
  store: MemoryStore,
  value: TenantRootOperationRecordV1,
  overrides: {
    operationId?: string;
    nowMs?: number;
    approverIsOwner?: (userId: string) => Promise<boolean>;
  } = {},
) {
  return await startTenantRootOperationV1(store, {
    record: value,
    triggerKind: 'manual',
    operationDigestB64u: digestFor(value),
    governance: TWO_PERSON,
    governanceDigestB64u: GOVERNANCE_DIGEST,
    requesterStepUp: stepUp(REQUESTER),
    approverIsOwner: overrides.approverIsOwner ?? (async () => true),
    operationId: overrides.operationId ?? `operation-${value.idempotencyKey}`,
    nonceB64u: 'bm9uY2UtMQ',
    nowMs: overrides.nowMs ?? NOW_MS,
  });
}

function approvalFor(digest: string): TenantRootOperationApprovalRecordV1 {
  return {
    operationDigestB64u: digest,
    approverUserId: APPROVER,
    approverStepUp: stepUp(APPROVER),
    approvedAtMs: NOW_MS - 60_000,
    consumedAtMs: null,
  };
}

test('a repeated idempotency key returns the same operation and consumes nothing further', async () => {
  const store = new MemoryStore();
  const value = record('idempotency-1');
  store.approvals.set(digestFor(value), approvalFor(digestFor(value)));

  const first = await start(store, value);
  expect(first.ok).toBe(true);
  if (first.ok) expect(first.replayed).toBe(false);

  const second = await start(store, value);
  expect(second.ok).toBe(true);
  if (second.ok) {
    expect(second.replayed).toBe(true);
    expect(second.entry.operationId).toBe('operation-idempotency-1');
  }
  expect(store.entries.size).toBe(1);
  // The approval was consumed exactly once.
  expect(store.approvals.get(digestFor(value))?.consumedAtMs).toBe(NOW_MS);
});

test('one approval cannot authorize a second operation', async () => {
  const store = new MemoryStore();
  const first = record('idempotency-1');
  const digest = digestFor(first);
  store.approvals.set(digest, approvalFor(digest));
  expect((await start(store, first)).ok).toBe(true);

  // A different request whose digest happens to resolve to the consumed approval.
  const second = record('idempotency-2');
  store.approvals.set(digestFor(second), {
    ...approvalFor(digestFor(second)),
    consumedAtMs: NOW_MS,
  });
  const result = await start(store, second);
  expect(result).toEqual({
    ok: false,
    error: { kind: 'authorization_failed', error: { kind: 'approval_already_consumed' } },
  });
});

test('an idempotency key cannot be reused for a different operation', async () => {
  const store = new MemoryStore();
  const original = record('idempotency-1');
  store.approvals.set(digestFor(original), approvalFor(digestFor(original)));
  expect((await start(store, original)).ok).toBe(true);

  const different = record('idempotency-1', 'tenant_root_operational_share_rotation_v1');
  const result = await startTenantRootOperationV1(store, {
    record: different,
    triggerKind: 'manual',
    operationDigestB64u: 'a-different-digest',
    governance: TWO_PERSON,
    governanceDigestB64u: GOVERNANCE_DIGEST,
    requesterStepUp: stepUp(REQUESTER),
    approverIsOwner: async () => true,
    operationId: 'operation-2',
    nonceB64u: 'bm9uY2UtMg',
    nowMs: NOW_MS,
  });
  expect(result).toEqual({
    ok: false,
    error: { kind: 'idempotency_key_reused_with_different_operation' },
  });
});

test('a lost approval race is reported rather than raised', async () => {
  const store = new MemoryStore();
  const value = record('idempotency-1');
  const digest = digestFor(value);
  store.approvals.set(digest, approvalFor(digest));
  // The approval disappears between authorization and the write.
  const racing: TenantRootOperationStoreV1 = {
    ...store,
    markDispatchUncertain: (operationId, atMs) => store.markDispatchUncertain(operationId, atMs),
    findByIdempotencyKey: (key) => store.findByIdempotencyKey(key),
    findApproval: (value_) => store.findApproval(value_),
    findApprovalRequestByIdempotencyKey: (key) => store.findApprovalRequestByIdempotencyKey(key),
    findApprovalRequestByDigest: (value_) => store.findApprovalRequestByDigest(value_),
    putApprovalRequest: (request) => store.putApprovalRequest(request),
    listApprovalRequests: () => store.listApprovalRequests(),
    recordApproval: (input) => store.recordApproval(input),
    consumeApprovalAndCreateOperation: async () => {
      throw new Error(TENANT_ROOT_APPROVAL_RACE_MARKER_V1);
    },
    markAccepted: (id, json) => store.markAccepted(id, json),
    markFailed: (id, code) => store.markFailed(id, code),
    markAuthorizationExpired: (id) => store.markAuthorizationExpired(id),
  };
  const result = await startTenantRootOperationV1(racing, {
    record: value,
    triggerKind: 'manual',
    operationDigestB64u: digest,
    governance: TWO_PERSON,
    governanceDigestB64u: GOVERNANCE_DIGEST,
    requesterStepUp: stepUp(REQUESTER),
    approverIsOwner: async () => true,
    operationId: 'operation-1',
    nonceB64u: 'bm9uY2UtMQ',
    nowMs: NOW_MS,
  });
  expect(result).toEqual({ ok: false, error: { kind: 'approval_consumed_concurrently' } });
});

test('authorization expiry never disturbs an accepted operation', async () => {
  const store = new MemoryStore();
  const value = record('idempotency-1');
  store.approvals.set(digestFor(value), approvalFor(digestFor(value)));
  const started = await start(store, value);
  if (!started.ok) throw new Error('expected the operation to start');

  const pastExpiry = Date.parse(EXPIRES_AT) + 1;
  const expired = await expireTenantRootOperationV1(store, started.entry, pastExpiry);
  expect(expired.status).toBe('authorization_expired');

  // An accepted operation stays accepted and keeps its recorded result.
  const accepted = await recordTenantRootOperationAcceptedV1(
    store,
    started.entry.operationId,
    '{"jobId":"job-1"}',
  );
  expect(accepted.status).toBe('accepted');
  const replayed = await recordTenantRootOperationAcceptedV1(
    store,
    started.entry.operationId,
    '{"jobId":"job-2"}',
  );
  expect(replayed.acceptedResultJson).toBe('{"jobId":"job-1"}');
  expect((await expireTenantRootOperationV1(store, replayed, pastExpiry)).status).toBe('accepted');
});

test('a second owner approves the exact pending digest, and only a different owner may', async () => {
  const store = new MemoryStore();
  const value = record('idempotency-1');
  const digest = digestFor(value);

  // No approval yet: the record is stored and the digest handed back.
  const pending = await start(store, value);
  expect(pending).toEqual({
    ok: false,
    error: {
      kind: 'approval_pending',
      operationDigestB64u: digest,
      expiresAtMs: Date.parse(EXPIRES_AT),
    },
  });
  expect(store.requests.get(digest)?.canonicalRecordJson).toBe(
    canonicalTenantRootOperationRecordJsonV1(value),
  );
  expect(store.entries.size).toBe(0);

  // The requester cannot approve their own operation.
  expect(
    await approveTenantRootOperationV1(store, {
      operationDigestB64u: digest,
      approver: proof(REQUESTER),
      nowMs: NOW_MS,
    }),
  ).toEqual({ ok: false, error: { kind: 'approver_is_the_requester' } });
  // Nor can anyone approve a digest nobody requested.
  expect(
    await approveTenantRootOperationV1(store, {
      operationDigestB64u: 'unknown-digest',
      approver: proof(APPROVER),
      nowMs: NOW_MS,
    }),
  ).toEqual({ ok: false, error: { kind: 'approval_request_not_found' } });

  const approved = await approveTenantRootOperationV1(store, {
    operationDigestB64u: digest,
    approver: proof(APPROVER),
    nowMs: NOW_MS,
  });
  expect(approved.ok).toBe(true);
  expect(store.approvals.get(digest)?.approverUserId).toBe(APPROVER);
  // One approval per digest.
  expect(
    await approveTenantRootOperationV1(store, {
      operationDigestB64u: digest,
      approver: proof(APPROVER),
      nowMs: NOW_MS,
    }),
  ).toEqual({ ok: false, error: { kind: 'approval_already_recorded' } });

  // The requester's retry now consumes it and the request is gone.
  const started = await start(store, value);
  expect(started.ok).toBe(true);
  if (started.ok) expect(started.entry.approverUserId).toBe(APPROVER);
  expect(store.requests.has(digest)).toBe(false);

  // An expired request cannot be approved at all.
  const late = record('idempotency-9');
  await start(store, late);
  expect(
    await approveTenantRootOperationV1(store, {
      operationDigestB64u: digestFor(late),
      approver: proof(APPROVER),
      nowMs: Date.parse(EXPIRES_AT),
    }),
  ).toEqual({ ok: false, error: { kind: 'approval_request_expired' } });
});

test('an approver removed as owner no longer counts at consumption', async () => {
  const store = new MemoryStore();
  const value = record('idempotency-1');
  store.approvals.set(digestFor(value), approvalFor(digestFor(value)));

  const refused = await start(store, value, {
    approverIsOwner: async (userId) => userId !== APPROVER,
  });
  expect(refused).toEqual({
    ok: false,
    error: { kind: 'authorization_failed', error: { kind: 'approver_no_longer_owner' } },
  });
  // Nothing was consumed: the approval is still unspent, and no operation exists.
  expect(store.approvals.get(digestFor(value))?.consumedAtMs).toBeNull();
  expect(store.entries.size).toBe(0);
});

test('a retry reuses the stored record so its digest survives the clock moving', async () => {
  const store = new MemoryStore();
  const original = record('idempotency-1');
  const originalDigest = digestFor(original);
  await start(store, original);
  expect(store.requests.has(originalDigest)).toBe(true);

  // Two minutes later the route would build a record with a later issue time.
  const later = record(
    'idempotency-1',
    'tenant_root_recovery_recipient_pair_replace_v1',
    '2026-09-05T12:00:00.000Z',
  );
  expect(canonicalTenantRootOperationRecordJsonV1(later)).not.toBe(
    canonicalTenantRootOperationRecordJsonV1(original),
  );
  const resolved = await resolveTenantRootOperationRecordV1(store, {
    idempotencyKey: 'idempotency-1',
    operationKind: 'tenant_root_recovery_recipient_pair_replace_v1',
    requesterUserId: REQUESTER,
    nowMs: NOW_MS + 120_000,
    build: () => ({ ok: true, record: later }),
  });
  expect(resolved.ok).toBe(true);
  if (resolved.ok) {
    expect(resolved.reused).toBe(true);
    expect(resolved.operationDigestB64u).toBe(originalDigest);
    expect(canonicalTenantRootOperationRecordJsonV1(resolved.record)).toBe(
      canonicalTenantRootOperationRecordJsonV1(original),
    );
  }

  // The same key for another operation kind is refused, not reinterpreted.
  expect(
    await resolveTenantRootOperationRecordV1(store, {
      idempotencyKey: 'idempotency-1',
      operationKind: 'tenant_root_operational_share_rotation_v1',
      requesterUserId: REQUESTER,
      nowMs: NOW_MS,
      build: () => ({ ok: true, record: later }),
    }),
  ).toEqual({ ok: false, error: { kind: 'idempotency_key_reused_with_different_operation' } });

  // Once the operation exists, its record is the one a retry presents.
  store.approvals.set(originalDigest, approvalFor(originalDigest));
  const started = await start(store, original);
  expect(started.ok).toBe(true);
  const afterStart = await resolveTenantRootOperationRecordV1(store, {
    idempotencyKey: 'idempotency-1',
    operationKind: 'tenant_root_recovery_recipient_pair_replace_v1',
    requesterUserId: REQUESTER,
    nowMs: NOW_MS + 600_000,
    build: () => {
      throw new Error('a stored record must not be rebuilt');
    },
  });
  expect(afterStart.ok && afterStart.operationDigestB64u === originalDigest).toBe(true);
});
