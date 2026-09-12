import type {
  TenantRootDeriverRoleV1,
  TenantRootDownloadEvidenceV1,
  TenantRootRecipientPairV1,
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootRecoverySetStateV1,
  TenantRootRoleReceiptsV1,
  TenantRootSourceCustodyDispositionV1,
  TenantRootTrustLevelV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import { tenantRootDownloadableRecoverySetV1 } from '@seams-internal/wallet-console-shared/tenant-root';
import { buildTenantRootAuditEventV1, type TenantRootAuditEventV1 } from './audit';
import {
  commitTenantRootRecipientPairV1,
  confirmTenantRootRecipientV1,
  openTenantRootRecipientChallengeV1,
  recipientChallengeRefusalV1,
  recipientPairMatchesStagedV1,
  selectTenantRootRecoveryGovernanceV1,
  type TenantRootGovernanceErrorV1,
  type TenantRootRecipientChallengeRecordV1,
  type TenantRootRecipientErrorV1,
  type TenantRootStagedRecipientV1,
} from './recipients';
import {
  activateRecoverySetV1,
  beginRecoverySetGenerationV1,
  failRecoverySetGenerationV1,
  recordDownloadEvidenceV1,
  type TenantRootDownloadArtifactV1,
  type TenantRootRecoverySetErrorV1,
  type TenantRootRecoverySetVerificationV1,
} from './recoverySets';
import {
  retireSourceLineageV1,
  type TenantRootRetirementErrorV1,
  type TenantRootSourceRetirementEvidenceV1,
} from './sourceRetirement';

/**
 * Recovery custody operations, composed from the state machines.
 *
 * Every operation here returns both its outcome and the audit event that
 * records it, including on refusal — an attempt that was rejected is exactly
 * what an incident review needs, so the caller cannot forget to write one.
 *
 * The operation layer enforces fresh step-up and second-owner approvals.
 * Artifact access here additionally checks the enrolled recovery holder.
 */

/** The recovery custody state one request acts on. */
export type TenantRootCustodyStateV1 = {
  readonly orgId: string;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly lifecycleRevision: number;
  /** The stable public root commitment every operation record is bound to. */
  readonly rootCommitmentB64u: string;
  readonly governance: TenantRootRecoveryGovernanceV1 | null;
  readonly backup: TenantRootRecoveryBackupV1;
  readonly stagedRecipients: readonly TenantRootStagedRecipientV1[];
  readonly recipientPair: TenantRootRecipientPairV1 | null;
  /** How this deployment left its source, once a destination has activated. */
  readonly sourceDisposition: TenantRootSourceCustodyDispositionV1 | null;
};

export type RecoveryDownloadHolders =
  | { readonly kind: 'unavailable'; readonly deriverA?: never; readonly deriverB?: never }
  | { readonly kind: 'single_owner'; readonly deriverA?: never; readonly deriverB?: never }
  | { readonly kind: 'two_person'; readonly deriverA: string; readonly deriverB: string };

export async function readRecoveryDownloadHolders(
  store: TenantRootCustodyStoreV1,
  backup: TenantRootRecoveryBackupV1,
): Promise<RecoveryDownloadHolders> {
  const set = tenantRootDownloadableRecoverySetV1(backup);
  if (set === null || backup.status === 'not_configured') return { kind: 'unavailable' };
  if (backup.governance.kind === 'single_owner_v1') return { kind: 'single_owner' };
  const beforeMs = Date.parse(set.createdAt);
  const deriverA = await store.readRecipientOwner(
    'deriver_a',
    set.recipientPair.deriverAFingerprintB64u,
    beforeMs,
  );
  const deriverB = await store.readRecipientOwner(
    'deriver_b',
    set.recipientPair.deriverBFingerprintB64u,
    beforeMs,
  );
  if (deriverA === null || deriverB === null || deriverA === deriverB)
    return { kind: 'unavailable' };
  return { kind: 'two_person', deriverA, deriverB };
}

function assertNeverRecoveryAccess(value: never): never {
  throw new Error(`Unexpected recovery access state: ${String(value)}`);
}

export function canDownloadRecoveryArtifact(
  holders: RecoveryDownloadHolders,
  artifact: TenantRootDownloadArtifactV1,
  actorUserId: string,
): boolean {
  switch (holders.kind) {
    case 'unavailable':
      return false;
    case 'single_owner':
      return true;
    case 'two_person':
      switch (artifact) {
        case 'manifest':
          return actorUserId === holders.deriverA || actorUserId === holders.deriverB;
        case 'deriver_a_package':
          return actorUserId === holders.deriverA;
        case 'deriver_b_package':
          return actorUserId === holders.deriverB;
        default:
          return assertNeverRecoveryAccess(artifact);
      }
    default:
      return assertNeverRecoveryAccess(holders);
  }
}

/** Persistence for recovery custody. */
export interface TenantRootCustodyStoreV1 {
  readState(): Promise<TenantRootCustodyStateV1>;
  readRecipientOwner(
    role: TenantRootDeriverRoleV1,
    fingerprintB64u: string,
    beforeMs: number,
  ): Promise<string | null>;
  putGovernance(governance: TenantRootRecoveryGovernanceV1): Promise<void>;
  putChallenge(challenge: TenantRootRecipientChallengeRecordV1): Promise<void>;
  takeChallenge(challengeIdB64u: string): Promise<TenantRootRecipientChallengeRecordV1 | null>;
  consumeChallenge(challengeIdB64u: string, atMs: number): Promise<void>;
  putStagedRecipient(recipient: TenantRootStagedRecipientV1): Promise<void>;
  putRecipientPair(pair: TenantRootRecipientPairV1): Promise<void>;
  putBackup(backup: TenantRootRecoveryBackupV1): Promise<void>;
  putDownloadEvidence(
    artifact: TenantRootDownloadArtifactV1,
    evidence: TenantRootDownloadEvidenceV1,
  ): Promise<void>;
  putSourceDisposition(disposition: TenantRootSourceCustodyDispositionV1): Promise<void>;
}

/** One artifact as the control plane serves it: ciphertext to everyone here. */
export type TenantRootServedArtifactV1 = {
  readonly artifactB64u: string;
  readonly contentDigestB64u: string;
};

/** Control-plane operations the console cannot perform itself. */
export interface TenantRootCustodyControlPlaneV1 {
  /** Seals one proof-of-control challenge to the submitted recipient key. */
  sealRecipientChallenge(input: {
    readonly identityDigestB64u: string;
    readonly custodyLineageB64u: string;
    readonly issuedAtMs: number;
    readonly role: TenantRootDeriverRoleV1;
    readonly recipientPublicKeyB64u: string;
    readonly actorUserId: string;
    readonly lifecycleRevision: number;
  }): Promise<{
    readonly challengeIdB64u: string;
    readonly envelopeB64u: string;
    readonly expectedConfirmationB64u: string;
    readonly recipientFingerprintB64u: string;
  }>;
  /** Verifies one confirmation against its challenge, in constant time. */
  verifyRecipientConfirmation(input: {
    readonly expectedConfirmationB64u: string;
    readonly confirmationB64u: string;
  }): Promise<boolean>;
  /** Generates one dedicated recovery sharing under the exact pending set id. */
  createRecoverySet(input: {
    readonly recipientPair: TenantRootRecipientPairV1;
    readonly recoverySetId: string;
  }): Promise<{
    readonly set: TenantRootRecoverySetStateV1;
    readonly verification: TenantRootRecoverySetVerificationV1;
    readonly oldPackagesDestroyed: boolean;
  }>;
  /**
   * Removes whatever a failed generation left behind.
   *
   * Returns both roles' cleanup receipts, or null when either role could not
   * prove removal; null selects the cleanup-incomplete branch.
   */
  cleanupPendingRecoverySet(input: {
    readonly recoverySetId: string;
  }): Promise<{ readonly cleanupReceipts: TenantRootRoleReceiptsV1 | null }>;
  /** Unwraps one role's active package straight into a response. */
  openRolePackage(input: {
    readonly recoverySetId: string;
    readonly role: TenantRootDeriverRoleV1;
  }): Promise<TenantRootServedArtifactV1>;
  /** Returns the active signed public manifest. */
  readManifest(input: { readonly recoverySetId: string }): Promise<TenantRootServedArtifactV1>;
  /** Asks this source deployment to retire its lineage and report evidence. */
  retireSourceLineage(input: {
    readonly destinationActivationReceiptDigestB64u: string;
  }): Promise<TenantRootSourceRetirementEvidenceV1>;
}

/** Why one custody operation was refused. */
export type TenantRootCustodyErrorV1 =
  | { readonly kind: 'governance'; readonly error: TenantRootGovernanceErrorV1 }
  | { readonly kind: 'recipient'; readonly error: TenantRootRecipientErrorV1 }
  | { readonly kind: 'recovery_set'; readonly error: TenantRootRecoverySetErrorV1 }
  | {
      readonly kind: 'download';
      readonly error: { readonly kind: 'no_downloadable_set' | 'recovery_holder_required' };
    }
  | { readonly kind: 'retirement'; readonly error: TenantRootRetirementErrorV1 };

/** One always-successful custody outcome and the event that records it. */
export type TenantRootCustodyRecordedV1<T> = {
  readonly value: T;
  readonly audit: TenantRootAuditEventV1;
};

/** One custody outcome and the event that records it. */
export type TenantRootCustodyOutcomeV1<T> =
  | { readonly ok: true; readonly value: T; readonly audit: TenantRootAuditEventV1 }
  | {
      readonly ok: false;
      readonly error: TenantRootCustodyErrorV1;
      readonly audit: TenantRootAuditEventV1;
    };

/** Returns the stable failure code one custody error maps to. */
export function tenantRootCustodyFailureCodeV1(error: TenantRootCustodyErrorV1): string {
  return error.error.kind;
}

type AuditContext = {
  readonly state: TenantRootCustodyStateV1;
  readonly actorUserId: string;
  readonly atIso: string;
};

function audit(
  context: AuditContext,
  action: TenantRootAuditEventV1['action'],
  outcome: TenantRootAuditEventV1['outcome'],
  extra: {
    readonly role?: TenantRootDeriverRoleV1;
    readonly recoverySetId?: string;
    readonly receiptDigestB64u?: string;
    readonly failureCode?: string;
  } = {},
): TenantRootAuditEventV1 {
  return buildTenantRootAuditEventV1({
    action,
    outcome,
    atIso: context.atIso,
    orgId: context.state.orgId,
    actorUserId: context.actorUserId,
    identityDigestB64u: context.state.identityDigestB64u,
    custodyLineageB64u: context.state.custodyLineageB64u,
    lifecycleRevision: context.state.lifecycleRevision,
    ...extra,
  });
}

/**
 * Installs one governance branch the operation layer already authorized.
 *
 * The branch arrives fully built: its owner id and time are the authenticated
 * actor and the server clock, set by the caller that also bound the target
 * into the approval request.
 */
export async function setRecoveryGovernanceV1(
  store: TenantRootCustodyStoreV1,
  input: {
    readonly target: TenantRootRecoveryGovernanceV1;
    readonly actorUserId: string;
    readonly atIso: string;
  },
): Promise<TenantRootCustodyOutcomeV1<TenantRootRecoveryGovernanceV1>> {
  const state = await store.readState();
  const context: AuditContext = { state, actorUserId: input.actorUserId, atIso: input.atIso };
  const action =
    state.governance === null ? 'recovery_governance_selected' : 'recovery_governance_changed';
  const selected = selectTenantRootRecoveryGovernanceV1({
    current: state.governance,
    target: input.target,
  });
  if (!selected.ok) {
    return {
      ok: false,
      error: { kind: 'governance', error: selected.error },
      audit: audit(context, action, 'failure', { failureCode: selected.error.kind }),
    };
  }
  await store.putGovernance(selected.governance);
  return {
    ok: true,
    value: selected.governance,
    audit: audit(context, action, 'success'),
  };
}

/** Opens one proof-of-control challenge for one role. */
export async function startRecipientChallengeV1(
  store: TenantRootCustodyStoreV1,
  controlPlane: Pick<TenantRootCustodyControlPlaneV1, 'sealRecipientChallenge'>,
  input: {
    readonly role: TenantRootDeriverRoleV1;
    readonly recipientPublicKeyB64u: string;
    readonly actorUserId: string;
    readonly atIso: string;
    readonly nowMs: number;
  },
): Promise<
  TenantRootCustodyOutcomeV1<{ readonly envelopeB64u: string; readonly challengeIdB64u: string }>
> {
  const state = await store.readState();
  const context: AuditContext = { state, actorUserId: input.actorUserId, atIso: input.atIso };

  // The state machine gates before the control plane is asked to seal
  // anything, so a refused request never mints a challenge.
  const refusal = recipientChallengeRefusalV1(state.governance, state.backup);
  if (refusal !== null) {
    return {
      ok: false,
      error: { kind: 'recipient', error: refusal },
      audit: audit(context, 'recovery_recipient_challenge_issued', 'failure', {
        role: input.role,
        failureCode: refusal.kind,
      }),
    };
  }

  const sealed = await controlPlane.sealRecipientChallenge({
    identityDigestB64u: state.identityDigestB64u,
    custodyLineageB64u: state.custodyLineageB64u,
    issuedAtMs: input.nowMs,
    role: input.role,
    recipientPublicKeyB64u: input.recipientPublicKeyB64u,
    actorUserId: input.actorUserId,
    lifecycleRevision: state.lifecycleRevision,
  });
  const opened = openTenantRootRecipientChallengeV1({
    role: input.role,
    recipientPublicKeyB64u: input.recipientPublicKeyB64u,
    recipientFingerprintB64u: sealed.recipientFingerprintB64u,
    actorUserId: input.actorUserId,
    lifecycleRevision: state.lifecycleRevision,
    challengeIdB64u: sealed.challengeIdB64u,
    expectedConfirmationB64u: sealed.expectedConfirmationB64u,
    nowMs: input.nowMs,
    governance: state.governance,
    backup: state.backup,
  });
  if (!opened.ok) {
    return {
      ok: false,
      error: { kind: 'recipient', error: opened.error },
      audit: audit(context, 'recovery_recipient_challenge_issued', 'failure', {
        role: input.role,
        failureCode: opened.error.kind,
      }),
    };
  }
  await store.putChallenge(opened.value);
  return {
    ok: true,
    value: { envelopeB64u: sealed.envelopeB64u, challengeIdB64u: sealed.challengeIdB64u },
    audit: audit(context, 'recovery_recipient_challenge_issued', 'success', { role: input.role }),
  };
}

/** Verifies one proof of control and stages that role's recipient. */
export async function confirmRecipientV1(
  store: TenantRootCustodyStoreV1,
  controlPlane: Pick<TenantRootCustodyControlPlaneV1, 'verifyRecipientConfirmation'>,
  input: {
    readonly challengeIdB64u: string;
    readonly confirmationB64u: string;
    readonly role: TenantRootDeriverRoleV1;
    readonly actorUserId: string;
    readonly atIso: string;
    readonly nowMs: number;
  },
): Promise<TenantRootCustodyOutcomeV1<TenantRootStagedRecipientV1>> {
  const state = await store.readState();
  const context: AuditContext = { state, actorUserId: input.actorUserId, atIso: input.atIso };
  const challenge = await store.takeChallenge(input.challengeIdB64u);
  const verified =
    challenge === null
      ? false
      : await controlPlane.verifyRecipientConfirmation({
          expectedConfirmationB64u: challenge.expectedConfirmationB64u,
          confirmationB64u: input.confirmationB64u,
        });

  const confirmed = confirmTenantRootRecipientV1({
    challenge,
    role: input.role,
    actorUserId: input.actorUserId,
    lifecycleRevision: state.lifecycleRevision,
    confirmationVerified: verified,
    nowMs: input.nowMs,
  });
  if (!confirmed.ok) {
    return {
      ok: false,
      error: { kind: 'recipient', error: confirmed.error },
      audit: audit(context, 'recovery_recipient_enrolled', 'failure', {
        role: input.role,
        failureCode: confirmed.error.kind,
      }),
    };
  }
  // Consuming the challenge and staging the recipient happen together; a
  // challenge that produced a recipient must never be answerable again.
  await store.consumeChallenge(input.challengeIdB64u, input.nowMs);
  await store.putStagedRecipient(confirmed.value);
  return {
    ok: true,
    value: confirmed.value,
    audit: audit(context, 'recovery_recipient_enrolled', 'success', { role: input.role }),
  };
}

/** Commits the verified Deriver A and Deriver B pair. */
export async function commitRecipientPairV1(
  store: TenantRootCustodyStoreV1,
  input: { readonly actorUserId: string; readonly atIso: string },
): Promise<TenantRootCustodyOutcomeV1<TenantRootRecipientPairV1>> {
  const state = await store.readState();
  const context: AuditContext = { state, actorUserId: input.actorUserId, atIso: input.atIso };
  const committed = commitTenantRootRecipientPairV1({
    staged: state.stagedRecipients,
    previousPair:
      tenantRootDownloadableRecoverySetV1(state.backup)?.recipientPair ?? state.recipientPair,
  });
  if (!committed.ok) {
    return {
      ok: false,
      error: { kind: 'recipient', error: committed.error },
      audit: audit(context, 'recovery_recipient_pair_committed', 'failure', {
        failureCode: committed.error.kind,
      }),
    };
  }
  const pair: TenantRootRecipientPairV1 = {
    deriverAFingerprintB64u: committed.value.deriverA.recipientFingerprintB64u,
    deriverBFingerprintB64u: committed.value.deriverB.recipientFingerprintB64u,
  };
  if (state.governance?.kind === 'two_person_v1') {
    const deriverA = await store.readRecipientOwner(
      'deriver_a',
      pair.deriverAFingerprintB64u,
      Date.parse(input.atIso),
    );
    const deriverB = await store.readRecipientOwner(
      'deriver_b',
      pair.deriverBFingerprintB64u,
      Date.parse(input.atIso),
    );
    if (deriverA === null || deriverB === null || deriverA === deriverB) {
      return {
        ok: false,
        error: { kind: 'recipient', error: { kind: 'recipient_pair_requires_two_owners' } },
        audit: audit(context, 'recovery_recipient_pair_committed', 'failure', {
          failureCode: 'recipient_pair_requires_two_owners',
        }),
      };
    }
  }
  await store.putRecipientPair(pair);
  return {
    ok: true,
    value: pair,
    audit: audit(context, 'recovery_recipient_pair_committed', 'success'),
  };
}

/**
 * Creates or replaces the recovery backup.
 *
 * The in-flight branch is written before the control plane is asked to
 * generate, so a crash mid-way is visible. A generation that fails lands in
 * its failed branch with the cleanup receipts the control plane produced, or
 * in cleanup-incomplete without them; it never stays in flight.
 */
export async function createRecoveryBackupV1(
  store: TenantRootCustodyStoreV1,
  controlPlane: TenantRootCustodyControlPlaneV1,
  input: {
    readonly pendingRecoverySetId: string;
    readonly actorUserId: string;
    readonly atIso: string;
  },
): Promise<TenantRootCustodyOutcomeV1<TenantRootRecoveryBackupV1>> {
  const state = await store.readState();
  const context: AuditContext = { state, actorUserId: input.actorUserId, atIso: input.atIso };
  const replacing = tenantRootDownloadableRecoverySetV1(state.backup) !== null;
  const action = replacing ? 'recovery_backup_replaced' : 'recovery_backup_created';

  if (state.governance === null) {
    return {
      ok: false,
      error: { kind: 'recipient', error: { kind: 'governance_not_selected' } },
      audit: audit(context, action, 'failure', { failureCode: 'governance_not_selected' }),
    };
  }
  if (
    state.recipientPair === null ||
    !recipientPairMatchesStagedV1(state.recipientPair, state.stagedRecipients)
  ) {
    return {
      ok: false,
      error: { kind: 'recovery_set', error: { kind: 'recipient_pair_not_committed' } },
      audit: audit(context, action, 'failure', { failureCode: 'recipient_pair_not_committed' }),
    };
  }
  const begun = beginRecoverySetGenerationV1({
    backup: state.backup,
    governance: state.governance,
    recipientPair: state.recipientPair,
    pendingRecoverySetId: input.pendingRecoverySetId,
  });
  if (!begun.ok) {
    return {
      ok: false,
      error: { kind: 'recovery_set', error: begun.error },
      audit: audit(context, action, 'failure', { failureCode: begun.error.kind }),
    };
  }
  await store.putBackup(begun.value);

  const fail = async (
    failureCode: string,
  ): Promise<TenantRootCustodyOutcomeV1<TenantRootRecoveryBackupV1>> => {
    let cleanupReceipts: TenantRootRoleReceiptsV1 | null = null;
    try {
      cleanupReceipts = (
        await controlPlane.cleanupPendingRecoverySet({ recoverySetId: input.pendingRecoverySetId })
      ).cleanupReceipts;
    } catch {
      cleanupReceipts = null;
    }
    const failed = failRecoverySetGenerationV1({
      backup: begun.value,
      failureCode,
      cleanupReceipts,
    });
    if (failed.ok) await store.putBackup(failed.value);
    return {
      ok: false,
      error: {
        kind: 'recovery_set',
        error: failed.ok
          ? failed.value.status === 'cleanup_incomplete'
            ? { kind: 'cleanup_outstanding' }
            : { kind: 'verification_incomplete', missing: [failureCode] }
          : failed.error,
      },
      audit: audit(context, action, 'failure', {
        recoverySetId: input.pendingRecoverySetId,
        failureCode,
      }),
    };
  };

  let generated: Awaited<ReturnType<TenantRootCustodyControlPlaneV1['createRecoverySet']>>;
  try {
    generated = await controlPlane.createRecoverySet({
      recipientPair:
        begun.value.status === 'preparing_initial'
          ? begun.value.recipientPair
          : begun.value.pendingRecipientPair,
      recoverySetId: input.pendingRecoverySetId,
    });
  } catch {
    // The control plane's own text is not an audit-safe failure code.
    return await fail('generation_failed');
  }
  const activated = activateRecoverySetV1({
    backup: begun.value,
    pending: generated.set,
    verification: generated.verification,
    oldPackagesDestroyed: generated.oldPackagesDestroyed,
  });
  if (!activated.ok) {
    return await fail(activated.error.kind);
  }
  await store.putBackup(activated.value);
  return {
    ok: true,
    value: activated.value,
    audit: audit(context, action, 'success', { recoverySetId: generated.set.recoverySetId }),
  };
}

/**
 * Serves one role package or the manifest from the downloadable set.
 *
 * A browser response records issuance only. The CLI upgrades that to durable
 * verification separately, after the bytes are on disk and reverified.
 */
export async function serveRecoveryArtifactV1(
  store: TenantRootCustodyStoreV1,
  controlPlane: TenantRootCustodyControlPlaneV1,
  input: {
    readonly artifact: TenantRootDownloadArtifactV1;
    readonly actorUserId: string;
    readonly atIso: string;
  },
): Promise<
  TenantRootCustodyOutcomeV1<
    TenantRootServedArtifactV1 & {
      readonly recoverySetId: string;
      readonly environmentSuffix: string;
    }
  >
> {
  const state = await store.readState();
  const context: AuditContext = { state, actorUserId: input.actorUserId, atIso: input.atIso };
  const role: TenantRootDeriverRoleV1 | undefined =
    input.artifact === 'manifest'
      ? undefined
      : input.artifact === 'deriver_a_package'
        ? 'deriver_a'
        : 'deriver_b';
  const action =
    input.artifact === 'manifest'
      ? 'recovery_manifest_download_issued'
      : 'recovery_role_package_download_issued';
  const set = tenantRootDownloadableRecoverySetV1(state.backup);
  if (set === null) {
    return {
      ok: false,
      error: { kind: 'download', error: { kind: 'no_downloadable_set' } },
      audit: audit(context, action, 'failure', {
        ...(role === undefined ? {} : { role }),
        failureCode: 'no_downloadable_set',
      }),
    };
  }
  const holders = await readRecoveryDownloadHolders(store, state.backup);
  if (!canDownloadRecoveryArtifact(holders, input.artifact, input.actorUserId)) {
    return {
      ok: false,
      error: { kind: 'download', error: { kind: 'recovery_holder_required' } },
      audit: audit(context, action, 'failure', { failureCode: 'recovery_holder_required' }),
    };
  }
  const served =
    role === undefined
      ? await controlPlane.readManifest({ recoverySetId: set.recoverySetId })
      : await controlPlane.openRolePackage({ recoverySetId: set.recoverySetId, role });
  const existing =
    input.artifact === 'manifest'
      ? set.manifest
      : input.artifact === 'deriver_a_package'
        ? set.deriverAPackage
        : set.deriverBPackage;
  await store.putDownloadEvidence(
    input.artifact,
    recordDownloadEvidenceV1({
      existing,
      channel: 'browser_response',
      actorUserId: input.actorUserId,
      contentDigestB64u: served.contentDigestB64u,
      atIso: input.atIso,
      trustLevel: null,
    }),
  );
  return {
    ok: true,
    value: {
      ...served,
      recoverySetId: set.recoverySetId,
      environmentSuffix:
        input.artifact === 'manifest'
          ? 'manifest.json'
          : input.artifact === 'deriver_a_package'
            ? 'deriver-a.backup'
            : 'deriver-b.backup',
    },
    audit: audit(context, action, 'success', {
      ...(role === undefined ? {} : { role }),
      recoverySetId: set.recoverySetId,
      receiptDigestB64u: served.contentDigestB64u,
    }),
  };
}

/** Records one download of a recovery artifact. */
export async function recordArtifactDownloadV1(
  store: TenantRootCustodyStoreV1,
  input: {
    readonly artifact: TenantRootDownloadArtifactV1;
    readonly existing: TenantRootDownloadEvidenceV1;
    readonly channel: 'browser_response' | 'cli_durable_verification';
    readonly contentDigestB64u: string;
    readonly trustLevel: TenantRootTrustLevelV1 | null;
    readonly actorUserId: string;
    readonly atIso: string;
  },
): Promise<TenantRootCustodyRecordedV1<TenantRootDownloadEvidenceV1>> {
  const state = await store.readState();
  const context: AuditContext = { state, actorUserId: input.actorUserId, atIso: input.atIso };
  const evidence = recordDownloadEvidenceV1({
    existing: input.existing,
    channel: input.channel,
    actorUserId: input.actorUserId,
    contentDigestB64u: input.contentDigestB64u,
    atIso: input.atIso,
    trustLevel: input.trustLevel,
  });
  await store.putDownloadEvidence(input.artifact, evidence);
  // Recording a download cannot fail: the evidence type itself refuses to
  // overstate what happened, so there is no branch to reject.
  return {
    value: evidence,
    audit: audit(
      context,
      evidence.kind === 'durable_verified'
        ? 'recovery_artifact_durably_verified'
        : input.artifact === 'manifest'
          ? 'recovery_manifest_download_issued'
          : 'recovery_role_package_download_issued',
      'success',
      input.artifact === 'manifest'
        ? {}
        : { role: input.artifact === 'deriver_a_package' ? 'deriver_a' : 'deriver_b' },
    ),
  };
}

/**
 * Records the CLI's durability report for one artifact of the downloadable set.
 *
 * The report is digest-bound: a digest that is not the served artifact's is
 * recorded as nothing, because the CLI would then be describing some other
 * file.
 */
export async function recordDurableVerificationV1(
  store: TenantRootCustodyStoreV1,
  input: {
    readonly artifact: TenantRootDownloadArtifactV1;
    readonly contentDigestB64u: string;
    readonly trustLevel: TenantRootTrustLevelV1 | null;
    readonly actorUserId: string;
    readonly atIso: string;
  },
): Promise<TenantRootCustodyOutcomeV1<TenantRootDownloadEvidenceV1>> {
  const state = await store.readState();
  const context: AuditContext = { state, actorUserId: input.actorUserId, atIso: input.atIso };
  const set = tenantRootDownloadableRecoverySetV1(state.backup);
  if (set === null) {
    return {
      ok: false,
      error: { kind: 'download', error: { kind: 'no_downloadable_set' } },
      audit: audit(context, 'recovery_artifact_durably_verified', 'failure', {
        failureCode: 'no_downloadable_set',
      }),
    };
  }
  const holders = await readRecoveryDownloadHolders(store, state.backup);
  if (!canDownloadRecoveryArtifact(holders, input.artifact, input.actorUserId)) {
    return {
      ok: false,
      error: { kind: 'download', error: { kind: 'recovery_holder_required' } },
      audit: audit(context, 'recovery_artifact_durably_verified', 'failure', {
        failureCode: 'recovery_holder_required',
      }),
    };
  }
  const existing =
    input.artifact === 'manifest'
      ? set.manifest
      : input.artifact === 'deriver_a_package'
        ? set.deriverAPackage
        : set.deriverBPackage;
  if (
    existing.kind === 'never_downloaded' ||
    existing.contentDigestB64u !== input.contentDigestB64u
  ) {
    return {
      ok: false,
      error: { kind: 'download', error: { kind: 'no_downloadable_set' } },
      audit: audit(context, 'recovery_artifact_durably_verified', 'failure', {
        recoverySetId: set.recoverySetId,
        failureCode: 'digest_not_issued',
      }),
    };
  }
  const recorded = await recordArtifactDownloadV1(store, {
    artifact: input.artifact,
    existing,
    channel: 'cli_durable_verification',
    contentDigestB64u: input.contentDigestB64u,
    trustLevel: input.trustLevel,
    actorUserId: input.actorUserId,
    atIso: input.atIso,
  });
  return { ok: true, value: recorded.value, audit: recorded.audit };
}

/**
 * Retires this source lineage against one destination's activation receipt.
 *
 * The control plane produces whatever evidence it can; the disposition is
 * `verified_retired` only with every receipt, and the weaker branch otherwise.
 */
export async function retireSourceLineageOperationV1(
  store: TenantRootCustodyStoreV1,
  controlPlane: TenantRootCustodyControlPlaneV1,
  input: {
    readonly destinationActivationReceiptDigestB64u: string;
    readonly actorUserId: string;
    readonly atIso: string;
  },
): Promise<TenantRootCustodyOutcomeV1<TenantRootSourceCustodyDispositionV1>> {
  const state = await store.readState();
  const evidence = await controlPlane.retireSourceLineage({
    destinationActivationReceiptDigestB64u: input.destinationActivationReceiptDigestB64u,
  });
  const outcome = retireSourceLineageV1({
    orgId: state.orgId,
    identityDigestB64u: state.identityDigestB64u,
    custodyLineageB64u: state.custodyLineageB64u,
    lifecycleRevision: state.lifecycleRevision,
    destinationActivationReceiptDigestB64u: input.destinationActivationReceiptDigestB64u,
    expectedActivationReceiptDigestB64u: null,
    evidence,
    actorUserId: input.actorUserId,
    atIso: input.atIso,
  });
  if (!outcome.ok) {
    return { ok: false, error: { kind: 'retirement', error: outcome.error }, audit: outcome.audit };
  }
  await store.putSourceDisposition(outcome.disposition);
  return { ok: true, value: outcome.disposition, audit: outcome.audit };
}
