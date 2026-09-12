import { expect, test } from '@playwright/test';
import type {
  TenantRootDownloadEvidenceV1,
  TenantRootRecipientPairV1,
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootRecoverySetStateV1,
  TenantRootSourceCustodyDispositionV1,
} from '../../packages/shared-ts/src/tenant-root';
import { checkTenantRootAuditEventRedactionV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';
import {
  commitRecipientPairV1,
  confirmRecipientV1,
  createRecoveryBackupV1,
  recordArtifactDownloadV1,
  setRecoveryGovernanceV1,
  startRecipientChallengeV1,
  type TenantRootCustodyControlPlaneV1,
  type TenantRootCustodyStateV1,
  type TenantRootCustodyStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/custodyService';
import type {
  TenantRootRecipientChallengeRecordV1,
  TenantRootStagedRecipientV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/recipients';
import type { TenantRootDownloadArtifactV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/recoverySets';

const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');
const AT_ISO = '2026-09-05T12:00:00.000Z';
const ACTOR = 'owner-1';

const SINGLE_OWNER: TenantRootRecoveryGovernanceV1 = {
  kind: 'single_owner_v1',
  acknowledgedByOwnerId: ACTOR,
  acknowledgedAt: '2026-08-01T00:00:00.000Z',
  warningVersion: 'tenant_root_single_owner_v1',
};

const TWO_PERSON: TenantRootRecoveryGovernanceV1 = {
  kind: 'two_person_v1',
  selectedByOwnerId: ACTOR,
  selectedAt: '2026-08-01T00:00:00.000Z',
};

const NEVER: TenantRootDownloadEvidenceV1 = { kind: 'never_downloaded' };

function recoverySet(id: string, pair: TenantRootRecipientPairV1): TenantRootRecoverySetStateV1 {
  return {
    recoverySetId: id,
    recipientPair: pair,
    createdAt: '2026-08-29T10:20:30.123Z',
    rootCommitmentFingerprintB64u: 'root-commitment',
    deriverAPackage: NEVER,
    deriverBPackage: NEVER,
    manifest: NEVER,
  };
}

class MemoryCustodyStore implements TenantRootCustodyStoreV1 {
  governance: TenantRootRecoveryGovernanceV1 | null = null;
  backup: TenantRootRecoveryBackupV1 = { status: 'not_configured' };
  staged: TenantRootStagedRecipientV1[] = [];
  pair: TenantRootRecipientPairV1 | null = null;
  disposition: TenantRootSourceCustodyDispositionV1 | null = null;
  readonly challenges = new Map<string, TenantRootRecipientChallengeRecordV1>();
  readonly evidence = new Map<TenantRootDownloadArtifactV1, TenantRootDownloadEvidenceV1>();

  async readState(): Promise<TenantRootCustodyStateV1> {
    return {
      orgId: 'org-1',
      identityDigestB64u: 'identity-digest',
      custodyLineageB64u: 'lineage',
      lifecycleRevision: 7,
      rootCommitmentB64u: 'root-commitment',
      governance: this.governance,
      backup: this.backup,
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
    if (challenge !== undefined) {
      this.challenges.set(id, { ...challenge, consumedAtMs: atMs });
    }
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

function controlPlane(
  options: {
    verify?: boolean;
    onSeal?: () => void;
    generationFails?: boolean;
    cleanupFails?: boolean;
  } = {},
) {
  let sealCount = 0;
  const plane: TenantRootCustodyControlPlaneV1 & { readonly sealCount: () => number } = {
    sealCount: () => sealCount,
    sealRecipientChallenge: async (input) => {
      sealCount += 1;
      options.onSeal?.();
      return {
        challengeIdB64u: `challenge-${input.role}`,
        envelopeB64u: `envelope-${input.role}`,
        expectedConfirmationB64u: 'A'.repeat(43),
        recipientFingerprintB64u: `fingerprint-${input.role}`,
      };
    },
    verifyRecipientConfirmation: async () => options.verify !== false,
    createRecoverySet: async (input) => {
      if (options.generationFails) throw new Error('deriver b unavailable');
      return {
        set: recoverySet(input.recoverySetId, input.recipientPair),
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
    cleanupPendingRecoverySet: async () => ({
      cleanupReceipts: options.cleanupFails
        ? null
        : { deriverA: 'cleanup-a', deriverB: 'cleanup-b' },
    }),
    openRolePackage: async (input) => ({
      artifactB64u: `package-${input.role}`,
      contentDigestB64u: `digest-${input.role}`,
    }),
    readManifest: async () => ({ artifactB64u: 'manifest', contentDigestB64u: 'digest-manifest' }),
    retireSourceLineage: async () => ({
      destructionReceipts: { deriverA: 'destroy-a', deriverB: 'destroy-b' },
      decryptProbeReceipts: { deriverA: 'probe-a', deriverB: 'probe-b' },
      credentialRevocationReceipt: 'revoke-1',
      endpointCanaryReceipt: 'canary-1',
    }),
  };
  return plane;
}

async function enrolBothRoles(store: MemoryCustodyStore, plane: TenantRootCustodyControlPlaneV1) {
  for (const role of ['deriver_a', 'deriver_b'] as const) {
    const challenge = await startRecipientChallengeV1(store, plane, {
      role,
      recipientPublicKeyB64u: `public-${role}`,
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    if (!challenge.ok) throw new Error('expected the challenge to open');
    const confirmed = await confirmRecipientV1(store, plane, {
      challengeIdB64u: challenge.value.challengeIdB64u,
      confirmationB64u: 'confirmation',
      role,
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    if (!confirmed.ok) throw new Error('expected the recipient to be staged');
  }
}

test('every custody outcome carries a redacted audit event, including refusals', async () => {
  const store = new MemoryCustodyStore();
  const plane = controlPlane();

  const refused = await startRecipientChallengeV1(store, plane, {
    role: 'deriver_a',
    recipientPublicKeyB64u: 'public-a',
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(refused.ok).toBe(false);
  expect(refused.audit.outcome).toBe('failure');
  expect(refused.audit.failureCode).toBe('governance_not_selected');
  expect(checkTenantRootAuditEventRedactionV1(refused.audit)).toEqual({ ok: true });

  // A refused request never asked the control plane to seal anything.
  expect(plane.sealCount()).toBe(0);
});

test('governance is recorded from the authorized target, and a no-op change is refused', async () => {
  const store = new MemoryCustodyStore();

  const first = await setRecoveryGovernanceV1(store, {
    target: TWO_PERSON,
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(first.ok).toBe(true);
  expect(first.audit.action).toBe('recovery_governance_selected');
  expect(store.governance).toEqual(TWO_PERSON);

  const unchanged = await setRecoveryGovernanceV1(store, {
    target: TWO_PERSON,
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(unchanged.ok).toBe(false);
  expect(unchanged.audit.action).toBe('recovery_governance_changed');
  expect(unchanged.audit.failureCode).toBe('governance_unchanged');

  const changed = await setRecoveryGovernanceV1(store, {
    target: SINGLE_OWNER,
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(changed.ok).toBe(true);
  expect(store.governance).toEqual(SINGLE_OWNER);
});

test('a challenge is consumed by the confirmation it answers', async () => {
  const store = new MemoryCustodyStore();
  const plane = controlPlane();
  await store.putGovernance(SINGLE_OWNER);

  const challenge = await startRecipientChallengeV1(store, plane, {
    role: 'deriver_a',
    recipientPublicKeyB64u: 'public-a',
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(challenge.ok).toBe(true);
  if (!challenge.ok) return;
  expect(challenge.value).not.toHaveProperty('expectedConfirmationB64u');
  expect(
    (await store.takeChallenge(challenge.value.challengeIdB64u))?.expectedConfirmationB64u,
  ).toBe('A'.repeat(43));

  const confirmed = await confirmRecipientV1(store, plane, {
    challengeIdB64u: challenge.value.challengeIdB64u,
    confirmationB64u: 'confirmation',
    role: 'deriver_a',
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(confirmed.ok).toBe(true);
  expect(store.staged).toHaveLength(1);

  // The same challenge cannot be answered twice.
  const replayed = await confirmRecipientV1(store, plane, {
    challengeIdB64u: challenge.value.challengeIdB64u,
    confirmationB64u: 'confirmation',
    role: 'deriver_a',
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(replayed.ok).toBe(false);
  if (!replayed.ok && replayed.error.kind === 'recipient') {
    expect(replayed.error.error.kind).toBe('challenge_already_consumed');
  }
});

test('an invalid confirmation stages nothing', async () => {
  const store = new MemoryCustodyStore();
  const plane = controlPlane({ verify: false });
  await store.putGovernance(SINGLE_OWNER);

  const challenge = await startRecipientChallengeV1(store, plane, {
    role: 'deriver_a',
    recipientPublicKeyB64u: 'public-a',
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  if (!challenge.ok) throw new Error('expected the challenge to open');

  const confirmed = await confirmRecipientV1(store, plane, {
    challengeIdB64u: challenge.value.challengeIdB64u,
    confirmationB64u: 'wrong',
    role: 'deriver_a',
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(confirmed.ok).toBe(false);
  expect(store.staged).toHaveLength(0);
  // The challenge stays open for a correct answer rather than being burned.
  expect(store.challenges.get(challenge.value.challengeIdB64u)?.consumedAtMs).toBeNull();
});

test('a backup needs a committed pair and becomes downloadable once verified', async () => {
  const store = new MemoryCustodyStore();
  const plane = controlPlane();
  await store.putGovernance(SINGLE_OWNER);

  const tooEarly = await createRecoveryBackupV1(store, plane, {
    pendingRecoverySetId: 'set-1',
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(tooEarly.ok).toBe(false);
  if (!tooEarly.ok && tooEarly.error.kind === 'recovery_set') {
    expect(tooEarly.error.error.kind).toBe('recipient_pair_not_committed');
  }

  await enrolBothRoles(store, plane);
  const committed = await commitRecipientPairV1(store, { actorUserId: ACTOR, atIso: AT_ISO });
  expect(committed.ok).toBe(true);
  expect(store.pair).toEqual({
    deriverAFingerprintB64u: 'fingerprint-deriver_a',
    deriverBFingerprintB64u: 'fingerprint-deriver_b',
  });

  const created = await createRecoveryBackupV1(store, plane, {
    pendingRecoverySetId: 'set-1',
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(created.ok).toBe(true);
  expect(store.backup.status).toBe('ready');
  expect(created.audit.action).toBe('recovery_backup_created');
  expect(created.audit.recoverySetId).toBe('set-1');
});

test('a generation that fails is a failed branch with its cleanup receipts', async () => {
  const store = new MemoryCustodyStore();
  await store.putGovernance(SINGLE_OWNER);
  await enrolBothRoles(store, controlPlane());
  await commitRecipientPairV1(store, { actorUserId: ACTOR, atIso: AT_ISO });

  const failed = await createRecoveryBackupV1(store, controlPlane({ generationFails: true }), {
    pendingRecoverySetId: 'set-1',
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(failed.ok).toBe(false);
  expect(failed.audit.failureCode).toBe('generation_failed');
  expect(store.backup.status).toBe('failed_initial');

  // Pending provider cleanup remains visible without blocking a fresh backup.
  const uncleaned = await createRecoveryBackupV1(
    store,
    controlPlane({ generationFails: true, cleanupFails: true }),
    { pendingRecoverySetId: 'set-2', actorUserId: ACTOR, atIso: AT_ISO },
  );
  expect(uncleaned.ok).toBe(false);
  expect(store.backup.status).toBe('cleanup_incomplete');
  const retried = await createRecoveryBackupV1(store, controlPlane(), {
    pendingRecoverySetId: 'set-3',
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(retried.ok).toBe(true);
  expect(store.backup.status).toBe('ready');
});

test('a replacement keeps the old set until the new one is verified', async () => {
  const store = new MemoryCustodyStore();
  const plane = controlPlane();
  await store.putGovernance(SINGLE_OWNER);
  await enrolBothRoles(store, plane);
  await commitRecipientPairV1(store, { actorUserId: ACTOR, atIso: AT_ISO });
  await createRecoveryBackupV1(store, plane, {
    pendingRecoverySetId: 'set-1',
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });

  const failedReplacement = await createRecoveryBackupV1(
    store,
    controlPlane({ generationFails: true }),
    { pendingRecoverySetId: 'set-2', actorUserId: ACTOR, atIso: AT_ISO },
  );
  expect(failedReplacement.ok).toBe(false);
  expect(failedReplacement.audit.action).toBe('recovery_backup_replaced');
  expect(store.backup.status).toBe('failed_replacement');
  if (store.backup.status === 'failed_replacement') {
    expect(store.backup.active.recoverySetId).toBe('set-1');
  }

  const replaced = await createRecoveryBackupV1(store, plane, {
    pendingRecoverySetId: 'set-3',
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(replaced.ok).toBe(true);
  if (store.backup.status === 'ready') expect(store.backup.active.recoverySetId).toBe('set-3');
});

test('a browser download and a CLI verification are recorded differently', async () => {
  const store = new MemoryCustodyStore();

  const issued = await recordArtifactDownloadV1(store, {
    artifact: 'deriver_a_package',
    existing: NEVER,
    channel: 'browser_response',
    contentDigestB64u: 'digest-1',
    trustLevel: { kind: 'cryptographically_valid_offline' },
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(issued.value.kind).toBe('download_issued');
  expect(issued.audit.action).toBe('recovery_role_package_download_issued');
  expect(issued.audit.role).toBe('deriver_a');

  const durable = await recordArtifactDownloadV1(store, {
    artifact: 'deriver_a_package',
    existing: issued.value,
    channel: 'cli_durable_verification',
    contentDigestB64u: 'digest-1',
    trustLevel: { kind: 'cryptographically_valid_offline' },
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  expect(durable.value.kind).toBe('durable_verified');
  expect(durable.audit.action).toBe('recovery_artifact_durably_verified');
  expect(checkTenantRootAuditEventRedactionV1(durable.audit)).toEqual({ ok: true });
});
