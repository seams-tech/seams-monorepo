import { expect, test } from '@playwright/test';
import type { D1DatabaseLike } from '../../packages/wallet-server/src/storage/tenantRoute';
import {
  type TenantRootDownloadEvidenceV1,
  type TenantRootRecipientPairV1,
  type TenantRootRecoverySetStateV1,
  type TenantRootTrustLevelV1,
} from '../../packages/shared-ts/src/tenant-root';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';
import {
  createD1TenantRootCustodyStoreV1,
  type D1TenantRootCustodyStoreOptionsV1,
  type TenantRootCurrentRootStateV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/custodyD1';
import {
  serveRecoveryArtifactV1,
  readRecoveryDownloadHolders,
  commitRecipientPairV1,
  confirmRecipientV1,
  createRecoveryBackupV1,
  recordArtifactDownloadV1,
  retireSourceLineageOperationV1,
  setRecoveryGovernanceV1,
  startRecipientChallengeV1,
  type TenantRootCustodyControlPlaneV1,
  type TenantRootCustodyStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/custodyService';
import { buildTenantRootRecoveryGovernanceV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/recipients';

const NAMESPACE = 'console-test';
const ORG_ID = 'org-1';
const IDENTITY_DIGEST = 'identity-digest';
const CUSTODY_LINEAGE = 'custody-lineage';
const ROOT_COMMITMENT = 'root-commitment';
const ACTOR = 'owner-1';
const NOW_MS = Date.parse('2026-09-07T12:00:00.000Z');
const AT_ISO = '2026-09-07T12:00:00.000Z';

class MutableRootReader {
  current: TenantRootCurrentRootStateV1 = {
    lifecycleRevision: 7,
    rootCommitmentB64u: ROOT_COMMITMENT,
  };
  calls = 0;

  readonly readRoot = async (): Promise<TenantRootCurrentRootStateV1> => {
    this.calls += 1;
    return this.current;
  };
}

class ModelledCustodyControlPlane implements TenantRootCustodyControlPlaneV1 {
  private challengeNumber = 0;
  readonly calls: string[] = [];

  async sealRecipientChallenge(input: {
    readonly role: 'deriver_a' | 'deriver_b';
    readonly recipientPublicKeyB64u: string;
    readonly actorUserId: string;
    readonly lifecycleRevision: number;
  }) {
    this.challengeNumber += 1;
    const challengeIdB64u = `challenge-${this.challengeNumber}`;
    this.calls.push(`seal:${input.role}`);
    return {
      challengeIdB64u,
      envelopeB64u: `envelope-${input.role}`,
      expectedConfirmationB64u: 'A'.repeat(43),
      recipientFingerprintB64u: `fingerprint-${input.role}`,
    };
  }

  async verifyRecipientConfirmation(input: {
    readonly expectedConfirmationB64u: string;
    readonly confirmationB64u: string;
  }): Promise<boolean> {
    this.calls.push(`verify:${input.expectedConfirmationB64u}`);
    return input.confirmationB64u === 'confirmation';
  }

  async createRecoverySet(input: {
    readonly recipientPair: TenantRootRecipientPairV1;
    readonly recoverySetId: string;
  }) {
    this.calls.push(`create:${input.recoverySetId}`);
    return {
      set: recoverySet(input.recoverySetId, input.recipientPair),
      verification: {
        deriverAPackageSignatureVerified: true,
        deriverBPackageSignatureVerified: true,
        descriptorContinuityVerified: true,
        manifestSignatureVerified: true,
        packageDigestsVerified: true,
        persistenceReceipts: { deriverA: 'persist-a', deriverB: 'persist-b' },
      },
      oldPackagesDestroyed: true,
    };
  }

  async cleanupPendingRecoverySet(input: { readonly recoverySetId: string }) {
    this.calls.push(`cleanup:${input.recoverySetId}`);
    return { cleanupReceipts: { deriverA: 'cleanup-a', deriverB: 'cleanup-b' } };
  }

  async openRolePackage(input: {
    readonly recoverySetId: string;
    readonly role: 'deriver_a' | 'deriver_b';
  }) {
    this.calls.push(`open:${input.recoverySetId}:${input.role}`);
    return {
      artifactB64u: `package-${input.role}`,
      contentDigestB64u: `digest-${input.role}`,
    };
  }

  async readManifest(input: { readonly recoverySetId: string }) {
    this.calls.push(`manifest:${input.recoverySetId}`);
    return { artifactB64u: 'manifest', contentDigestB64u: 'digest-manifest' };
  }

  async retireSourceLineage(input: { readonly destinationActivationReceiptDigestB64u: string }) {
    this.calls.push(`retire:${input.destinationActivationReceiptDigestB64u}`);
    return {
      destructionReceipts: { deriverA: 'destroy-a', deriverB: 'destroy-b' },
      decryptProbeReceipts: { deriverA: 'probe-a', deriverB: 'probe-b' },
      credentialRevocationReceipt: 'revoke-1',
      endpointCanaryReceipt: 'canary-1',
    };
  }
}

function recoverySet(
  recoverySetId: string,
  recipientPair: TenantRootRecipientPairV1,
): TenantRootRecoverySetStateV1 {
  const never: TenantRootDownloadEvidenceV1 = { kind: 'never_downloaded' };
  return {
    recoverySetId,
    recipientPair,
    createdAt: AT_ISO,
    rootCommitmentFingerprintB64u: ROOT_COMMITMENT,
    deriverAPackage: never,
    deriverBPackage: never,
    manifest: never,
  };
}

function createStore(
  database: D1DatabaseLike,
  reader: MutableRootReader,
  overrides: Partial<
    Pick<
      D1TenantRootCustodyStoreOptionsV1,
      'namespace' | 'orgId' | 'identityDigestB64u' | 'custodyLineageB64u'
    >
  > = {},
): TenantRootCustodyStoreV1 {
  return createD1TenantRootCustodyStoreV1({
    database,
    namespace: overrides.namespace ?? NAMESPACE,
    orgId: overrides.orgId ?? ORG_ID,
    identityDigestB64u: overrides.identityDigestB64u ?? IDENTITY_DIGEST,
    custodyLineageB64u: overrides.custodyLineageB64u ?? CUSTODY_LINEAGE,
    readRoot: reader.readRoot,
    now: () => NOW_MS,
  });
}

async function withDatabase(run: (database: D1DatabaseLike) => Promise<void>): Promise<void> {
  const { database, tempDir } = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(database, listD1MigrationFiles('d1-console'));
    await run(database);
  } finally {
    cleanupTemporaryD1Database(tempDir);
  }
}

function expectOk<T>(
  outcome:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly kind: string } },
): T {
  if (!outcome.ok) throw new Error(`unexpected custody failure: ${outcome.error.kind}`);
  return outcome.value;
}

async function enrolRecipient(
  store: TenantRootCustodyStoreV1,
  controlPlane: TenantRootCustodyControlPlaneV1,
  role: 'deriver_a' | 'deriver_b',
  actorUserId: string,
): Promise<void> {
  const challenge = await startRecipientChallengeV1(store, controlPlane, {
    role,
    recipientPublicKeyB64u: `public-${role}`,
    actorUserId,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  const challengeValue = expectOk(challenge);
  const confirmed = await confirmRecipientV1(store, controlPlane, {
    challengeIdB64u: challengeValue.challengeIdB64u,
    confirmationB64u: 'confirmation',
    role,
    actorUserId,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expectOk(confirmed);
}

test('persists custody lifecycle, scoped state, and modelled control-plane evidence through SQLite', async () => {
  await withDatabase(async (database) => {
    const reader = new MutableRootReader();
    const controlPlane = new ModelledCustodyControlPlane();
    const store = createStore(database, reader);

    expect((await store.readState()).backup).toEqual({ status: 'not_configured' });

    const governanceResult = buildTenantRootRecoveryGovernanceV1({
      choice: { kind: 'single_owner_v1', acknowledgeWarning: true },
      actorUserId: ACTOR,
      atIso: AT_ISO,
    });
    if (!governanceResult.ok) throw new Error('governance fixture was refused');
    const governance = governanceResult.governance;
    expectOk(
      await setRecoveryGovernanceV1(store, {
        target: governance,
        actorUserId: ACTOR,
        atIso: AT_ISO,
      }),
    );

    await enrolRecipient(store, controlPlane, 'deriver_a', ACTOR);
    await enrolRecipient(store, controlPlane, 'deriver_b', ACTOR);
    const twoPerson = buildTenantRootRecoveryGovernanceV1({ choice: { kind: 'two_person_v1' }, actorUserId: ACTOR, atIso: AT_ISO });
    if (!twoPerson.ok) throw new Error('Governance refused');
    await store.putGovernance(twoPerson.governance);
    expect(await commitRecipientPairV1(store, { actorUserId: ACTOR, atIso: AT_ISO })).toMatchObject({
      ok: false, error: { kind: 'recipient', error: { kind: 'recipient_pair_requires_two_owners' } },
    });
    await store.putGovernance(governance);
    const pair = expectOk(
      await commitRecipientPairV1(store, { actorUserId: ACTOR, atIso: AT_ISO }),
    );
    const backup = expectOk(
      await createRecoveryBackupV1(store, controlPlane, {
        pendingRecoverySetId: 'recovery-set-1',
        actorUserId: ACTOR,
        atIso: AT_ISO,
      }),
    );
    expect(backup.status).toBe('ready');

    await recordArtifactDownloadV1(store, {
      artifact: 'manifest',
      existing: { kind: 'never_downloaded' },
      channel: 'browser_response',
      contentDigestB64u: 'manifest-digest',
      trustLevel: null,
      actorUserId: ACTOR,
      atIso: AT_ISO,
    });
    const trustLevel: TenantRootTrustLevelV1 = { kind: 'cryptographically_valid_offline' };
    await recordArtifactDownloadV1(store, {
      artifact: 'deriver_a_package',
      existing: { kind: 'never_downloaded' },
      channel: 'cli_durable_verification',
      contentDigestB64u: 'package-a-digest',
      trustLevel,
      actorUserId: ACTOR,
      atIso: AT_ISO,
    });
    // This models the control-plane receipt path for persistence evidence;
    // it makes no provider or erasure claim.
    expectOk(
      await retireSourceLineageOperationV1(store, controlPlane, {
        destinationActivationReceiptDigestB64u: 'activation-receipt',
        actorUserId: ACTOR,
        atIso: AT_ISO,
      }),
    );

    reader.current = { lifecycleRevision: 8, rootCommitmentB64u: ROOT_COMMITMENT };
    const reloaded = createStore(database, reader);
    const persisted = await reloaded.readState();
    expect(persisted.lifecycleRevision).toBe(8);
    expect(persisted.rootCommitmentB64u).toBe(ROOT_COMMITMENT);
    expect(persisted.recipientPair).toEqual(pair);
    expect(persisted.stagedRecipients).toHaveLength(2);
    expect(persisted.backup).toMatchObject({
      status: 'ready',
      active: {
        recoverySetId: 'recovery-set-1',
        deriverAPackage: {
          kind: 'durable_verified',
          contentDigestB64u: 'package-a-digest',
        },
        manifest: {
          kind: 'download_issued',
          contentDigestB64u: 'manifest-digest',
        },
      },
    });
    expect(persisted.sourceDisposition).toMatchObject({ kind: 'verified_retired' });
    expect(reader.calls).toBeGreaterThan(1);

    const challenge = await startRecipientChallengeV1(store, controlPlane, {
      role: 'deriver_a',
      recipientPublicKeyB64u: 'public-deriver_a-next',
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    });
    const challengeValue = expectOk(challenge);
    await store.consumeChallenge(challengeValue.challengeIdB64u, NOW_MS + 1);
    await expect(
      store.consumeChallenge(challengeValue.challengeIdB64u, NOW_MS + 2),
    ).rejects.toThrow(/already consumed/u);
    expect((await store.takeChallenge(challengeValue.challengeIdB64u))?.consumedAtMs).toBe(
      NOW_MS + 1,
    );

    reader.current = { lifecycleRevision: 8, rootCommitmentB64u: 'changed-root' };
    await expect(reloaded.readState()).rejects.toThrow(/root commitment/u);
  });
});

test('custody state is isolated by every tenant and lineage scope dimension', async () => {
  await withDatabase(async (database) => {
    const reader = new MutableRootReader();
    const primary = createStore(database, reader);
    const governanceResult = buildTenantRootRecoveryGovernanceV1({
      choice: { kind: 'two_person_v1' },
      actorUserId: ACTOR,
      atIso: AT_ISO,
    });
    if (!governanceResult.ok) throw new Error('governance fixture was refused');
    const governance = governanceResult.governance;
    expectOk(
      await setRecoveryGovernanceV1(primary, {
        target: governance,
        actorUserId: ACTOR,
        atIso: AT_ISO,
      }),
    );

    const variants = [
      { namespace: 'other-namespace' },
      { orgId: 'other-org' },
      { identityDigestB64u: 'other-identity' },
      { custodyLineageB64u: 'other-lineage' },
    ];
    for (const variant of variants) {
      const isolated = createStore(database, reader, variant);
      const state = await isolated.readState();
      expect(state.governance).toBeNull();
      expect(state.backup).toEqual({ status: 'not_configured' });
    }
    expect((await primary.readState()).governance).toEqual(governance);
  });
});

test('malformed persisted custody unions fail at the D1 boundary', async () => {
  await withDatabase(async (database) => {
    const reader = new MutableRootReader();
    const store = createStore(database, reader);
    await store.readState();
    await database
      .prepare(
        `UPDATE tenant_root_security_custody_state
            SET backup_json = ?1
          WHERE namespace = ?2
            AND org_id = ?3
            AND identity_digest_b64u = ?4
            AND custody_lineage_b64u = ?5`,
      )
      .bind('{"status":"retired_forever"}', NAMESPACE, ORG_ID, IDENTITY_DIGEST, CUSTODY_LINEAGE)
      .run();
    await expect(store.readState()).rejects.toThrow(/backup_json.status/u);
  });
});

async function exerciseSplitDownloads(database: D1DatabaseLike): Promise<void> {
  const reader = new MutableRootReader();
  const controlPlane = new ModelledCustodyControlPlane();
  const store = createStore(database, reader);
  const governance = buildTenantRootRecoveryGovernanceV1({
    choice: { kind: 'two_person_v1' },
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
  if (!governance.ok) throw new Error('Governance refused');
  await store.putGovernance(governance.governance);
  await enrolRecipient(store, controlPlane, 'deriver_a', ACTOR);
  await enrolRecipient(store, controlPlane, 'deriver_b', 'owner-2');
  expectOk(await commitRecipientPairV1(store, { actorUserId: ACTOR, atIso: AT_ISO }));
  expectOk(
    await createRecoveryBackupV1(store, controlPlane, {
      pendingRecoverySetId: 'split-set',
      actorUserId: ACTOR,
      atIso: AT_ISO,
    }),
  );
  const reloaded = createStore(database, reader);
  expect(await readRecoveryDownloadHolders(reloaded, (await reloaded.readState()).backup)).toEqual({
    kind: 'two_person',
    deriverA: ACTOR,
    deriverB: 'owner-2',
  });
  for (const actorUserId of [ACTOR, 'owner-2', 'unassigned-owner']) {
    for (const artifact of ['manifest', 'deriver_a_package', 'deriver_b_package'] as const) {
      const callsBefore = controlPlane.calls.length;
      const result = await serveRecoveryArtifactV1(reloaded, controlPlane, {
        artifact,
        actorUserId,
        atIso: AT_ISO,
      });
      const allowed =
        actorUserId !== 'unassigned-owner' &&
        (artifact === 'manifest' ||
          (artifact === 'deriver_a_package' ? actorUserId === ACTOR : actorUserId === 'owner-2'));
      expect(result.ok).toBe(allowed);
      if (!allowed) {
        expect(result).toMatchObject({
          error: { kind: 'download', error: { kind: 'recovery_holder_required' } },
        });
        expect(controlPlane.calls.length).toBe(callsBefore);
      }
    }
  }
  expect(
    await reloaded.readRecipientOwner('deriver_a', 'fingerprint-deriver_a', NOW_MS - 1),
  ).toBeNull();
  expect(
    await reloaded.readRecipientOwner('deriver_b', 'fingerprint-deriver_a', NOW_MS),
  ).toBeNull();
}

test('two-person downloads stay bound to each enrolled holder after reloading persisted custody', async () => {
  await withDatabase(exerciseSplitDownloads);
});
