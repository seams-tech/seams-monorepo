import { expect, test } from '@playwright/test';
import type { ConsoleAuthAdapter } from '../../packages/console-server-ts/src/router/consoleAuth';
import type {
  TenantRootDownloadEvidenceV1,
  TenantRootRecipientPairV1,
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootSourceCustodyDispositionV1,
} from '../../packages/shared-ts/src/tenant-root';
import type { TenantRootAuditEventV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';
import type { TenantRootOperationApprovalRecordV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/authorization';
import { createTenantRootCustodyConsoleRouteV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/custodyRoute';
import type {
  TenantRootCustodyControlPlaneV1,
  TenantRootCustodyStateV1,
  TenantRootCustodyStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/custodyService';
import type {
  TenantRootRecipientChallengeRecordV1,
  TenantRootStagedRecipientV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/recipients';
import type { TenantRootDownloadArtifactV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/recoverySets';
import {
  TENANT_ROOT_APPROVAL_RACE_MARKER_V1,
  parseTenantRootOperationTriggerV1,
  type TenantRootApprovalCreateInputV1,
  type TenantRootApprovalRequestV1,
  type TenantRootOperationCreateInputV1,
  type TenantRootOperationEntryV1,
  type TenantRootOperationStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';
import type { TenantRootStepUpSessionRecordV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';

const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');
const ORG_ID = 'org-1';
const PROJECT_ID = 'project-2';
const ENV_ID = 'production';
const OWNER_1 = 'owner-1';
const OWNER_2 = 'owner-2';
const FINGERPRINT_A = 'GSYMSrbHNIS_I8s_-HNmSiE1IUPWtFBiAWyacCVe8uY';
const FINGERPRINT_B = 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos';

class MemoryCustodyStore implements TenantRootCustodyStoreV1 {
  governance: TenantRootRecoveryGovernanceV1 | null = null;
  backup: TenantRootRecoveryBackupV1 = { status: 'not_configured' };
  staged: TenantRootStagedRecipientV1[] = [];
  pair: TenantRootRecipientPairV1 | null = null;
  disposition: TenantRootSourceCustodyDispositionV1 | null = null;
  readonly challenges = new Map<string, TenantRootRecipientChallengeRecordV1>();
  readonly evidence = new Map<TenantRootDownloadArtifactV1, TenantRootDownloadEvidenceV1>();

  async readState(): Promise<TenantRootCustodyStateV1> {
    const backup = this.backup;
    const withEvidence: TenantRootRecoveryBackupV1 =
      backup.status === 'ready'
        ? {
            ...backup,
            active: {
              ...backup.active,
              deriverAPackage:
                this.evidence.get('deriver_a_package') ?? backup.active.deriverAPackage,
              deriverBPackage:
                this.evidence.get('deriver_b_package') ?? backup.active.deriverBPackage,
              manifest: this.evidence.get('manifest') ?? backup.active.manifest,
            },
          }
        : backup;
    return {
      orgId: ORG_ID,
      identityDigestB64u: 'identity-digest',
      custodyLineageB64u: 'lineage',
      lifecycleRevision: 7,
      rootCommitmentB64u: '6IKxMQFrUsHTM3CAGHz3aEI-_Mu1F7tJWrgSxBYP9E4',
      governance: this.governance,
      backup: withEvidence,
      stagedRecipients: this.staged,
      recipientPair: this.pair,
      sourceDisposition: this.disposition,
    };
  }

  async readRecipientOwner(
    role: 'deriver_a' | 'deriver_b',
    fingerprintB64u: string,
    beforeMs: number,
  ): Promise<string | null> {
    let first: TenantRootRecipientChallengeRecordV1 | null = null;
    for (const challenge of this.challenges.values()) {
      if (
        challenge.role !== role ||
        challenge.recipientFingerprintB64u !== fingerprintB64u ||
        challenge.consumedAtMs === null ||
        challenge.consumedAtMs > beforeMs
      )
        continue;
      if (first === null || challenge.consumedAtMs < first.consumedAtMs!) first = challenge;
    }
    return first?.actorUserId ?? null;
  }

  async putGovernance(governance: TenantRootRecoveryGovernanceV1): Promise<void> {
    this.governance = governance;
  }
  async putChallenge(challenge: TenantRootRecipientChallengeRecordV1): Promise<void> {
    this.challenges.set(challenge.challengeIdB64u, challenge);
  }
  async takeChallenge(id: string): Promise<TenantRootRecipientChallengeRecordV1 | null> {
    return this.challenges.get(id) ?? null;
  }
  async consumeChallenge(id: string, atMs: number): Promise<void> {
    const challenge = this.challenges.get(id);
    if (challenge !== undefined) this.challenges.set(id, { ...challenge, consumedAtMs: atMs });
  }
  async putStagedRecipient(recipient: TenantRootStagedRecipientV1): Promise<void> {
    this.staged = [...this.staged.filter((entry) => entry.role !== recipient.role), recipient];
  }
  async putRecipientPair(pair: TenantRootRecipientPairV1): Promise<void> {
    this.pair = pair;
  }
  async putBackup(backup: TenantRootRecoveryBackupV1): Promise<void> {
    this.backup = backup;
  }
  async putDownloadEvidence(
    artifact: TenantRootDownloadArtifactV1,
    evidence: TenantRootDownloadEvidenceV1,
  ): Promise<void> {
    this.evidence.set(artifact, evidence);
  }
  async putSourceDisposition(disposition: TenantRootSourceCustodyDispositionV1): Promise<void> {
    this.disposition = disposition;
  }
}

class MemoryOperationStore implements TenantRootOperationStoreV1 {
  readonly entries = new Map<string, TenantRootOperationEntryV1>();
  readonly byKey = new Map<string, string>();
  readonly approvals = new Map<string, TenantRootOperationApprovalRecordV1>();
  readonly requests = new Map<string, TenantRootApprovalRequestV1>();

  async findByIdempotencyKey(key: string) {
    const id = this.byKey.get(key);
    return id === undefined ? null : (this.entries.get(id) ?? null);
  }
  async findApproval(digest: string) {
    return this.approvals.get(digest) ?? null;
  }
  async findApprovalRequestByIdempotencyKey(key: string) {
    return [...this.requests.values()].find((request) => request.idempotencyKey === key) ?? null;
  }
  async findApprovalRequestByDigest(digest: string) {
    return this.requests.get(digest) ?? null;
  }
  async putApprovalRequest(request: TenantRootApprovalRequestV1) {
    if (!this.requests.has(request.operationDigestB64u)) {
      this.requests.set(request.operationDigestB64u, request);
    }
  }
  async listApprovalRequests() {
    return [...this.requests.values()];
  }
  async recordApproval(input: TenantRootApprovalCreateInputV1) {
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
  async consumeApprovalAndCreateOperation(input: TenantRootOperationCreateInputV1) {
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
    this.byKey.set(entry.idempotencyKey, entry.operationId);
    return entry;
  }
  async markAccepted(operationId: string, acceptedResultJson: string) {
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
  async markDispatchUncertain(operationId: string, atMs: number) {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    const updated = { ...entry, dispatchUncertainAtMs: atMs };
    this.entries.set(operationId, updated);
    return updated;
  }
  async markFailed(operationId: string, failureCode: string) {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    const failed: TenantRootOperationEntryV1 = { ...entry, status: 'failed', failureCode };
    this.entries.set(operationId, failed);
    return failed;
  }
  async markAuthorizationExpired(operationId: string) {
    const entry = this.entries.get(operationId);
    if (entry === undefined) throw new Error('unknown operation');
    return entry;
  }
}

function controlPlane(): TenantRootCustodyControlPlaneV1 & {
  readonly calls: string[];
  failGeneration: boolean;
} {
  const calls: string[] = [];
  const plane = {
    calls,
    failGeneration: false,
    sealRecipientChallenge: async (input: { role: 'deriver_a' | 'deriver_b' }) => ({
      challengeIdB64u: `challenge-${input.role}`,
      envelopeB64u: `envelope-${input.role}`,
      expectedConfirmationB64u: 'A'.repeat(43),
      recipientFingerprintB64u: input.role === 'deriver_a' ? FINGERPRINT_A : FINGERPRINT_B,
    }),
    verifyRecipientConfirmation: async () => true,
    createRecoverySet: async (input: {
      recipientPair: TenantRootRecipientPairV1;
      recoverySetId: string;
    }) => {
      calls.push(`create:${input.recoverySetId}`);
      if (plane.failGeneration) throw new Error('deriver b unavailable');
      return {
        set: {
          recoverySetId: input.recoverySetId,
          recipientPair: input.recipientPair,
          createdAt: new Date(NOW_MS).toISOString(),
          rootCommitmentFingerprintB64u: 'root-commitment',
          deriverAPackage: { kind: 'never_downloaded' as const },
          deriverBPackage: { kind: 'never_downloaded' as const },
          manifest: { kind: 'never_downloaded' as const },
        },
        verification: {
          deriverAPackageSignatureVerified: true,
          deriverBPackageSignatureVerified: true,
          descriptorContinuityVerified: true,
          manifestSignatureVerified: true,
          packageDigestsVerified: true,
          persistenceReceipts: { deriverA: 'receipt-a', deriverB: 'receipt-b' },
        },
        oldPackagesDestroyed: true,
      };
    },
    cleanupPendingRecoverySet: async (input: { recoverySetId: string }) => {
      calls.push(`cleanup:${input.recoverySetId}`);
      return { cleanupReceipts: { deriverA: 'cleanup-a', deriverB: 'cleanup-b' } };
    },
    openRolePackage: async (input: { recoverySetId: string; role: string }) => {
      calls.push(`package:${input.role}`);
      return { artifactB64u: `package-${input.role}`, contentDigestB64u: `digest-${input.role}` };
    },
    readManifest: async (input: { recoverySetId: string }) => {
      calls.push(`manifest:${input.recoverySetId}`);
      return { artifactB64u: 'manifest-bytes', contentDigestB64u: 'digest-manifest' };
    },
    retireSourceLineage: async () => ({
      destructionReceipts: { deriverA: 'destroy-a', deriverB: 'destroy-b' },
      decryptProbeReceipts: { deriverA: 'probe-a', deriverB: 'probe-b' },
      credentialRevocationReceipt: 'revoke-1',
      endpointCanaryReceipt: 'canary-1',
    }),
  };
  return plane;
}

function auth(userId: string, sessionId: string): ConsoleAuthAdapter {
  return {
    authenticate: () => ({
      ok: true,
      claims: {
        userId,
        orgId: ORG_ID,
        platformSupport: false,
        membershipId: `membership-${userId}`,
        role: 'OWNER',
        authorizationVersion: 1,
        adminPermissions: [],
        projectAccess: { kind: 'all' },
        projectId: PROJECT_ID,
        environmentId: ENV_ID,
        sessionId,
      },
    }),
  } as unknown as ConsoleAuthAdapter;
}

function stepUp(userId: string, sessionId: string, verifiedAtMs = NOW_MS - 30_000) {
  return {
    actorUserId: userId,
    sessionId,
    method: 'webauthn_platform_v1' as const,
    verifiedAtMs,
  };
}

type Harness = {
  readonly store: MemoryCustodyStore;
  readonly operations: MemoryOperationStore;
  readonly plane: ReturnType<typeof controlPlane>;
  readonly written: TenantRootAuditEventV1[];
  readonly owners: Set<string>;
  /** Builds a route for one actor's session; every actor shares the stores. */
  as(
    userId: string,
    options?: { stepUpRecord?: TenantRootStepUpSessionRecordV1 | null },
  ): (request: Request) => Promise<Response | null>;
};

function harness(): Harness {
  const store = new MemoryCustodyStore();
  const operations = new MemoryOperationStore();
  const plane = controlPlane();
  const written: TenantRootAuditEventV1[] = [];
  const owners = new Set([OWNER_1, OWNER_2]);
  let counter = 0;
  return {
    store,
    operations,
    plane,
    written,
    owners,
    as(userId, options = {}) {
      const sessionId = `session-${userId}`;
      return createTenantRootCustodyConsoleRouteV1({
        auth: auth(userId, sessionId),
        orgProjectEnv: {
          listEnvironments: async () => [
            { id: ENV_ID, projectId: PROJECT_ID, key: 'prod', runtimeVersion: 'v3' },
          ],
        } as never,
        stepUp: {
          readStepUp: async () =>
            options.stepUpRecord === undefined ? stepUp(userId, sessionId) : options.stepUpRecord,
        },
        custody: store,
        controlPlane: plane,
        operations,
        membership: { isOrganizationOwner: async (input) => owners.has(input.userId) },
        audit: {
          write: async (event) => {
            written.push(event);
          },
        },
        now: () => NOW_MS,
        newOperationId: () => `operation-${(counter += 1)}`,
        newNonceB64u: () => 'bm9uY2UtMQ',
        newRecoverySetId: () => 'QUFBQUFBQUFBQUFBQUFBQQ',
      });
    },
  };
}

function post(path: string, body: unknown = {}): Request {
  return new Request(`https://console.example${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`https://console.example${path}`, { method: 'GET' });
}

async function json<T>(response: Response | null): Promise<T> {
  if (response === null) throw new Error('expected a response');
  return (await response.json()) as T;
}

async function enrolBothRoles(
  deriverA: (request: Request) => Promise<Response | null>,
  deriverB: (request: Request) => Promise<Response | null>,
) {
  for (const role of ['deriver_a', 'deriver_b'] as const) {
    const route = role === 'deriver_a' ? deriverA : deriverB;
    const challenge = await route(
      post('/console/tenant-root/security/recipients/challenge', {
        role,
        recipientPublicKeyB64u: `public-${role}`,
      }),
    );
    expect(challenge?.status).toBe(200);
    const { challengeIdB64u } = await json<{ challengeIdB64u: string }>(challenge);
    const confirmed = await route(
      post('/console/tenant-root/security/recipients/confirm', {
        role,
        challengeIdB64u,
        confirmationB64u: 'confirmation',
      }),
    );
    expect(confirmed?.status).toBe(200);
  }
}

test('a custody mutation without fresh step-up is refused before any state changes', async () => {
  const { store, written, as } = harness();
  const route = as(OWNER_1, { stepUpRecord: null });
  const response = await route(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'two_person_v1' },
      idempotencyKey: 'governance-1',
    }),
  );
  expect(response?.status).toBe(403);
  expect(store.governance).toBeNull();
  expect(written).toHaveLength(0);
});

test('step-up recorded in another session of the same owner does not count', async () => {
  const { store, as } = harness();
  const route = as(OWNER_1, { stepUpRecord: stepUp(OWNER_1, 'session-elsewhere') });
  const response = await route(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'single_owner_v1', acknowledgeWarning: true },
      idempotencyKey: 'governance-1',
    }),
  );
  expect(response?.status).toBe(403);
  const body = await json<{ error: { kind: string } }>(response);
  expect(body.error.kind).toBe('session_mismatch');
  expect(store.governance).toBeNull();
});

test('a caller cannot assert its own second-owner approval', async () => {
  const { store, as } = harness();
  const owner1 = as(OWNER_1);
  // A body claiming approval is not an approval. The transition still waits.
  const response = await owner1(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'two_person_v1' },
      secondOwnerApproved: true,
      idempotencyKey: 'governance-1',
    }),
  );
  expect(response?.status).toBe(202);
  const body = await json<{ ok: boolean; code: string; operationDigestB64u: string }>(response);
  expect(body.ok).toBe(false);
  expect(body.code).toBe('approval_required');
  expect(body.operationDigestB64u).toHaveLength(43);
  expect(store.governance).toBeNull();
});

test('selecting two-person governance takes a different owner, and a retry reuses the digest', async () => {
  const { store, operations, written, as } = harness();
  const owner1 = as(OWNER_1);
  const owner2 = as(OWNER_2);

  const first = await owner1(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'two_person_v1' },
      idempotencyKey: 'governance-1',
    }),
  );
  expect(first?.status).toBe(202);
  const { operationDigestB64u } = await json<{ operationDigestB64u: string }>(first);

  // The pending operation is visible to the owners, with what it will do.
  const pending = await json<{
    pending: { operationDigestB64u: string; operationKind: string; payloadJson: string | null }[];
  }>(await owner2(get('/console/tenant-root/security/operations/pending')));
  expect(pending.pending).toHaveLength(1);
  expect(pending.pending[0]?.operationDigestB64u).toBe(operationDigestB64u);
  expect(pending.pending[0]?.payloadJson).toBe('{"targetGovernanceKind":"two_person_v1"}');

  // The requester cannot approve their own operation.
  const selfApproval = await owner1(
    post('/console/tenant-root/security/operations/approve', { operationDigestB64u }),
  );
  expect(selfApproval?.status).toBe(409);
  expect((await json<{ error: { kind: string } }>(selfApproval)).error.kind).toBe(
    'approver_is_the_requester',
  );

  const approved = await owner2(
    post('/console/tenant-root/security/operations/approve', { operationDigestB64u }),
  );
  expect(approved?.status).toBe(200);
  expect(operations.approvals.get(operationDigestB64u)?.approverUserId).toBe(OWNER_2);

  // The retry presents the same key and consumes the approval for that digest.
  const retry = await owner1(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'two_person_v1' },
      idempotencyKey: 'governance-1',
    }),
  );
  expect(retry?.status).toBe(200);
  expect(store.governance?.kind).toBe('two_person_v1');
  if (store.governance?.kind === 'two_person_v1') {
    // The owner recorded is the authenticated actor, never a body field.
    expect(store.governance.selectedByOwnerId).toBe(OWNER_1);
    expect(store.governance.selectedAt).toBe('2026-09-05T12:00:00.000Z');
  }
  expect(operations.approvals.get(operationDigestB64u)?.consumedAtMs).toBe(NOW_MS);
  expect([...operations.entries.values()][0]?.approverUserId).toBe(OWNER_2);

  // A second retry replays the recorded result without consuming anything.
  const replay = await owner1(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'two_person_v1' },
      idempotencyKey: 'governance-1',
    }),
  );
  expect(replay?.status).toBe(200);
  expect((await json<{ replayed: boolean }>(replay)).replayed).toBe(true);
  expect(operations.entries.size).toBe(1);

  const actions = written.map((event) => `${event.action}:${event.outcome}`);
  expect(actions).toContain('approval_capability_issued:success');
  expect(actions).toContain('approval_capability_consumed:success');
  expect(actions).toContain('approval_capability_replayed:success');
  expect(actions).toContain('recovery_governance_selected:success');
});

test('one owner cannot leave two-person governance alone', async () => {
  const { store, as } = harness();
  store.governance = {
    kind: 'two_person_v1',
    selectedByOwnerId: OWNER_1,
    selectedAt: '2026-08-01T00:00:00.000Z',
  };
  const downgrade = await as(OWNER_1)(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'single_owner_v1', acknowledgeWarning: true },
      idempotencyKey: 'downgrade-1',
    }),
  );
  expect(downgrade?.status).toBe(202);
  expect(store.governance.kind).toBe('two_person_v1');
});

test('an approver removed as owner no longer counts when the retry consumes', async () => {
  const { store, owners, as } = harness();
  const owner1 = as(OWNER_1);
  const started = await owner1(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'two_person_v1' },
      idempotencyKey: 'governance-1',
    }),
  );
  const { operationDigestB64u } = await json<{ operationDigestB64u: string }>(started);
  expect(
    (
      await as(OWNER_2)(
        post('/console/tenant-root/security/operations/approve', { operationDigestB64u }),
      )
    )?.status,
  ).toBe(200);
  owners.delete(OWNER_2);

  const retry = await owner1(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'two_person_v1' },
      idempotencyKey: 'governance-1',
    }),
  );
  expect(retry?.status).toBe(403);
  expect((await json<{ error: { error: { kind: string } } }>(retry)).error.error.kind).toBe(
    'approver_no_longer_owner',
  );
  expect(store.governance).toBeNull();
});

test('single-owner governance, enrolment, pair commit, backup, and download run in order', async () => {
  const { store, plane, written, as } = harness();
  const route = as(OWNER_1);

  // Without the acknowledgement the weaker branch is refused.
  const unacknowledged = await route(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'single_owner_v1', acknowledgeWarning: false },
      idempotencyKey: 'governance-0',
    }),
  );
  expect(unacknowledged?.status).toBe(409);

  const governance = await route(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'single_owner_v1', acknowledgeWarning: true },
      idempotencyKey: 'governance-1',
    }),
  );
  expect(governance?.status).toBe(200);
  expect(store.governance?.kind).toBe('single_owner_v1');
  if (store.governance?.kind === 'single_owner_v1') {
    expect(store.governance.acknowledgedByOwnerId).toBe(OWNER_1);
  }

  await enrolBothRoles(route, route);

  const commit = await route(
    post('/console/tenant-root/security/recipients/commit', { idempotencyKey: 'commit-1' }),
  );
  expect(commit?.status).toBe(200);
  expect(store.pair).toEqual({
    deriverAFingerprintB64u: FINGERPRINT_A,
    deriverBFingerprintB64u: FINGERPRINT_B,
  });

  const backup = await route(
    post('/console/tenant-root/security/backup', { idempotencyKey: 'backup-1' }),
  );
  expect(backup?.status).toBe(200);
  expect(store.backup.status).toBe('ready');
  expect(plane.calls).toContain('create:QUFBQUFBQUFBQUFBQUFBQQ');

  // Each download is one role, and records issuance rather than durability.
  const packageA = await route(
    post('/console/tenant-root/security/backup/package', { role: 'deriver_a' }),
  );
  expect(packageA?.status).toBe(200);
  expect(packageA?.headers.get('cache-control')).toBe('no-store');
  expect(packageA?.headers.get('x-content-type-options')).toBe('nosniff');
  expect((await json<{ artifactB64u: string }>(packageA)).artifactB64u).toBe('package-deriver_a');
  expect(store.evidence.get('deriver_a_package')?.kind).toBe('download_issued');

  const manifest = await route(get('/console/tenant-root/security/manifest'));
  expect(manifest?.status).toBe(200);
  expect(store.evidence.get('manifest')?.kind).toBe('download_issued');

  // The CLI's durability report only upgrades a digest the service issued.
  const wrongDigest = await route(
    post('/console/tenant-root/security/backup/durable-verification', {
      artifact: 'deriver_a_package',
      contentDigestB64u: 'not-what-was-served',
      trustLevel: { kind: 'cryptographically_valid_offline' },
    }),
  );
  expect(wrongDigest?.status).toBe(409);
  expect(store.evidence.get('deriver_a_package')?.kind).toBe('download_issued');
  const durable = await route(
    post('/console/tenant-root/security/backup/durable-verification', {
      artifact: 'deriver_a_package',
      contentDigestB64u: 'digest-deriver_a',
      trustLevel: { kind: 'cryptographically_valid_offline' },
    }),
  );
  expect(durable?.status).toBe(200);
  expect(store.evidence.get('deriver_a_package')?.kind).toBe('durable_verified');

  expect(written.every((event) => event.actorUserId === OWNER_1)).toBe(true);
  expect(
    written.filter((event) => event.outcome === 'failure').map((event) => event.failureCode),
  ).toEqual(['single_owner_warning_not_acknowledged', 'digest_not_issued']);
});

test('a failed generation lands in a failed branch, not a permanent in-flight state', async () => {
  const { store, plane, as } = harness();
  const route = as(OWNER_1);
  await route(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'single_owner_v1', acknowledgeWarning: true },
      idempotencyKey: 'governance-1',
    }),
  );
  await enrolBothRoles(route, route);
  await route(
    post('/console/tenant-root/security/recipients/commit', { idempotencyKey: 'commit-1' }),
  );

  plane.failGeneration = true;
  const failed = await route(
    post('/console/tenant-root/security/backup', { idempotencyKey: 'backup-1' }),
  );
  expect(failed?.status).toBe(409);
  expect(store.backup.status).toBe('failed_initial');
  expect(plane.calls).toContain('cleanup:QUFBQUFBQUFBQUFBQUFBQQ');

  // The failure did not consume the tenant's ability to try again.
  plane.failGeneration = false;
  const retried = await route(
    post('/console/tenant-root/security/backup', { idempotencyKey: 'backup-2' }),
  );
  expect(retried?.status).toBe(200);
  expect(store.backup.status).toBe('ready');
});

test('a restored deployment can create its first local backup', async () => {
  const { store, as } = harness();
  const route = as(OWNER_1);
  store.governance = {
    kind: 'single_owner_v1',
    acknowledgedByOwnerId: OWNER_1,
    acknowledgedAt: '2026-08-01T00:00:00.000Z',
    warningVersion: 'tenant_root_single_owner_v1',
  };
  store.backup = {
    status: 'tenant_held_external',
    governance: store.governance,
    recoverySetId: 'source-set',
    manifestDigestB64u: 'manifest-digest',
  };
  await enrolBothRoles(route, route);
  store.pair = { deriverAFingerprintB64u: FINGERPRINT_A, deriverBFingerprintB64u: FINGERPRINT_B };

  const created = await route(
    post('/console/tenant-root/security/backup', { idempotencyKey: 'backup-1' }),
  );
  expect(created?.status).toBe(200);
  // The route replaces store.backup through putBackup, which the compiler
  // cannot see, so it still holds the narrowing from the assignment above.
  const after = store.backup as TenantRootRecoveryBackupV1;
  expect(after.status).toBe('ready');
  if (after.status === 'ready') {
    expect(after.active.recoverySetId).toBe('QUFBQUFBQUFBQUFBQUFBQQ');
  }
});

test('recipient replacement under two-person governance needs the second owner', async () => {
  const { store, as } = harness();
  const owner1 = as(OWNER_1);
  store.governance = {
    kind: 'two_person_v1',
    selectedByOwnerId: OWNER_1,
    selectedAt: '2026-08-01T00:00:00.000Z',
  };
  await enrolBothRoles(owner1, as(OWNER_2));
  const commit = await owner1(
    post('/console/tenant-root/security/recipients/commit', { idempotencyKey: 'commit-1' }),
  );
  expect(commit?.status).toBe(202);
  expect(store.pair).toBeNull();

  const { operationDigestB64u } = await json<{ operationDigestB64u: string }>(commit);
  expect(
    (
      await as(OWNER_2)(
        post('/console/tenant-root/security/operations/approve', { operationDigestB64u }),
      )
    )?.status,
  ).toBe(200);
  const retry = await owner1(
    post('/console/tenant-root/security/recipients/commit', { idempotencyKey: 'commit-1' }),
  );
  expect(retry?.status).toBe(200);
  expect(store.pair).not.toBeNull();
  const backup = await owner1(post('/console/tenant-root/security/backup', { idempotencyKey: 'split-backup' }));
  expect(backup?.status).toBe(200);
  const ownPackage = await owner1(post('/console/tenant-root/security/backup/package', { role: 'deriver_a' }));
  expect(ownPackage?.status).toBe(200);
  const otherPackage = await owner1(post('/console/tenant-root/security/backup/package', { role: 'deriver_b' }));
  expect(otherPackage?.status).toBe(403);
  expect(await otherPackage?.json()).toMatchObject({ code: 'recovery_holder_required' });
  const holderBPackage = await as(OWNER_2)(post('/console/tenant-root/security/backup/package', { role: 'deriver_b' }));
  expect(holderBPackage?.status).toBe(200);
});

test('source retirement is an approved operation and records the disposition', async () => {
  const { store, as } = harness();
  const route = as(OWNER_1);
  store.governance = {
    kind: 'single_owner_v1',
    acknowledgedByOwnerId: OWNER_1,
    acknowledgedAt: '2026-08-01T00:00:00.000Z',
    warningVersion: 'tenant_root_single_owner_v1',
  };
  const retired = await route(
    post('/console/tenant-root/security/source/retire', {
      destinationActivationReceiptDigestB64u: 'destination-activation-receipt',
      idempotencyKey: 'retire-1',
    }),
  );
  expect(retired?.status).toBe(200);
  expect(store.disposition?.kind).toBe('verified_retired');
});

test('a refusal is audited and returns the exact reason', async () => {
  const { written, as } = harness();
  const early = await as(OWNER_1)(
    post('/console/tenant-root/security/recipients/challenge', {
      role: 'deriver_a',
      recipientPublicKeyB64u: 'public-a',
    }),
  );
  expect(early?.status).toBe(409);
  const body = await json<{ error: { error: { kind: string } } }>(early);
  expect(body.error.error.kind).toBe('governance_not_selected');
  expect(written).toHaveLength(1);
  expect(written[0]?.outcome).toBe('failure');
  expect(written[0]?.failureCode).toBe('governance_not_selected');
});

test('a malformed governance body is rejected without writing anything', async () => {
  const { store, written, as } = harness();
  const response = await as(OWNER_1)(
    post('/console/tenant-root/security/governance', {
      governance: { kind: 'something_else' },
      idempotencyKey: 'governance-1',
    }),
  );
  expect(response?.status).toBe(400);
  expect(store.governance).toBeNull();
  expect(written).toHaveLength(0);
});

test('an unrelated path is not handled by this route', async () => {
  const { as } = harness();
  expect(await as(OWNER_1)(post('/console/policies'))).toBeNull();
});
