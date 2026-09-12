import type {
  TenantRootDeriverRoleV1,
  TenantRootRecipientEnrolmentV1,
  TenantRootRecipientPairV1,
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
} from '@seams-internal/shared-ts/tenant-root';

export function recipientPairMatchesStagedV1(
  pair: TenantRootRecipientPairV1,
  staged: readonly TenantRootStagedRecipientV1[],
): boolean {
  const candidate = commitTenantRootRecipientPairV1({ staged, previousPair: null });
  return (
    candidate.ok &&
    candidate.value.deriverA.recipientFingerprintB64u === pair.deriverAFingerprintB64u &&
    candidate.value.deriverB.recipientFingerprintB64u === pair.deriverBFingerprintB64u
  );
}

/**
 * Recovery governance and recipient enrolment.
 *
 * Two rules shape every function here:
 *
 * - **Both roles, two keys.** A recovery set is only meaningful if Deriver A
 *   and Deriver B hold different keys, so a pair cannot be committed until both
 *   have proved control and their fingerprints differ.
 * - **Proof before ciphertext.** Nothing may be generated or downloaded from a
 *   partially verified pair, so staging a recipient and activating a pair are
 *   separate steps with separate authorization.
 *
 * Who may select or change governance is not decided here. The quorum a
 * governance transition needs is enforced by the operation layer, which
 * consumes a second owner's approval when the stronger branch requires one.
 */

/** How long a proof-of-control challenge stays open. */
export const TENANT_ROOT_RECIPIENT_CHALLENGE_TTL_MS_V1 = 600_000;

/** One outstanding proof-of-control challenge. */
export type TenantRootRecipientChallengeRecordV1 = {
  readonly challengeIdB64u: string;
  readonly expectedConfirmationB64u: string;
  readonly role: TenantRootDeriverRoleV1;
  readonly recipientPublicKeyB64u: string;
  readonly recipientFingerprintB64u: string;
  readonly actorUserId: string;
  readonly lifecycleRevision: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly consumedAtMs: number | null;
};

/** One recipient that has proved control but is not yet part of an active pair. */
export type TenantRootStagedRecipientV1 = {
  readonly role: TenantRootDeriverRoleV1;
  readonly recipientPublicKeyB64u: string;
  readonly recipientFingerprintB64u: string;
  readonly verifiedAtMs: number;
};

/**
 * What a tenant chooses; the server fills in who chose it and when.
 *
 * The acknowledging owner id and the timestamps never come from a request
 * body: the authenticated actor and the server clock are the only sources.
 */
export type TenantRootGovernanceChoiceV1 =
  | { readonly kind: 'single_owner_v1'; readonly acknowledgeWarning: boolean }
  | { readonly kind: 'two_person_v1' };

/** Why a governance selection was refused. */
export type TenantRootGovernanceErrorV1 =
  | { readonly kind: 'single_owner_warning_not_acknowledged' }
  | { readonly kind: 'governance_unchanged' };

/** Why a recipient step was refused. */
export type TenantRootRecipientErrorV1 =
  | { readonly kind: 'governance_not_selected' }
  | { readonly kind: 'challenge_not_found' }
  | { readonly kind: 'challenge_already_consumed' }
  | { readonly kind: 'challenge_expired' }
  | { readonly kind: 'challenge_role_mismatch' }
  | { readonly kind: 'challenge_actor_mismatch' }
  | { readonly kind: 'challenge_lifecycle_revision_stale' }
  | { readonly kind: 'confirmation_invalid' }
  | { readonly kind: 'recipient_pair_incomplete'; readonly missingRole: TenantRootDeriverRoleV1 }
  | { readonly kind: 'recipient_pair_reuses_one_key' }
  | { readonly kind: 'recipient_pair_requires_two_owners' }
  | { readonly kind: 'recovery_set_generation_in_flight' };

/** Result of one governance selection. */
export type TenantRootGovernanceResultV1 =
  | { readonly ok: true; readonly governance: TenantRootRecoveryGovernanceV1 }
  | { readonly ok: false; readonly error: TenantRootGovernanceErrorV1 };

/** Result of one recipient step. */
export type TenantRootRecipientResultV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TenantRootRecipientErrorV1 };

/**
 * Builds the governance branch one choice produces.
 *
 * Single-owner governance requires its warning acknowledgement; the fixed
 * warning version is the contract's, never the caller's. The owner and time
 * recorded are the authenticated actor and the server clock.
 */
export function buildTenantRootRecoveryGovernanceV1(input: {
  readonly choice: TenantRootGovernanceChoiceV1;
  readonly actorUserId: string;
  readonly atIso: string;
}): TenantRootGovernanceResultV1 {
  if (input.choice.kind === 'single_owner_v1') {
    if (!input.choice.acknowledgeWarning) {
      return { ok: false, error: { kind: 'single_owner_warning_not_acknowledged' } };
    }
    return {
      ok: true,
      governance: {
        kind: 'single_owner_v1',
        acknowledgedByOwnerId: input.actorUserId,
        acknowledgedAt: input.atIso,
        warningVersion: 'tenant_root_single_owner_v1',
      },
    };
  }
  return {
    ok: true,
    governance: {
      kind: 'two_person_v1',
      selectedByOwnerId: input.actorUserId,
      selectedAt: input.atIso,
    },
  };
}

/**
 * Validates one governance transition's shape.
 *
 * The quorum the transition needs is the operation layer's to obtain; this
 * only refuses a target that is malformed or that changes nothing.
 */
export function selectTenantRootRecoveryGovernanceV1(input: {
  readonly current: TenantRootRecoveryGovernanceV1 | null;
  readonly target: TenantRootRecoveryGovernanceV1;
}): TenantRootGovernanceResultV1 {
  const { target } = input;
  if (
    target.kind === 'single_owner_v1' &&
    target.warningVersion !== 'tenant_root_single_owner_v1'
  ) {
    return { ok: false, error: { kind: 'single_owner_warning_not_acknowledged' } };
  }
  if (input.current !== null && input.current.kind === target.kind) {
    return { ok: false, error: { kind: 'governance_unchanged' } };
  }
  return { ok: true, governance: target };
}

/** Checks eligibility before generating any proof material. */
export function recipientChallengeRefusalV1(
  governance: TenantRootRecoveryGovernanceV1 | null,
  backup: TenantRootRecoveryBackupV1,
): TenantRootRecipientErrorV1 | null {
  if (governance === null) return { kind: 'governance_not_selected' };
  if (backup.status === 'preparing_initial' || backup.status === 'replacing') {
    return { kind: 'recovery_set_generation_in_flight' };
  }
  return null;
}

/** Inputs for opening one proof-of-control challenge. */
export type TenantRootRecipientChallengeInputV1 = {
  readonly role: TenantRootDeriverRoleV1;
  readonly recipientPublicKeyB64u: string;
  readonly recipientFingerprintB64u: string;
  readonly actorUserId: string;
  readonly lifecycleRevision: number;
  readonly challengeIdB64u: string;
  readonly expectedConfirmationB64u: string;
  readonly nowMs: number;
  readonly governance: TenantRootRecoveryGovernanceV1 | null;
  readonly backup: TenantRootRecoveryBackupV1;
};

/**
 * Opens one proof-of-control challenge for one role.
 *
 * Governance must be chosen first: which owners may enrol recipients depends
 * on it, so enrolling before it is settled would authorize under a policy
 * nobody selected.
 */
export function openTenantRootRecipientChallengeV1(
  input: TenantRootRecipientChallengeInputV1,
): TenantRootRecipientResultV1<TenantRootRecipientChallengeRecordV1> {
  const refusal = recipientChallengeRefusalV1(input.governance, input.backup);
  if (refusal !== null) return { ok: false, error: refusal };
  return {
    ok: true,
    value: {
      challengeIdB64u: input.challengeIdB64u,
      expectedConfirmationB64u: input.expectedConfirmationB64u,
      role: input.role,
      recipientPublicKeyB64u: input.recipientPublicKeyB64u,
      recipientFingerprintB64u: input.recipientFingerprintB64u,
      actorUserId: input.actorUserId,
      lifecycleRevision: input.lifecycleRevision,
      issuedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + TENANT_ROOT_RECIPIENT_CHALLENGE_TTL_MS_V1,
      consumedAtMs: null,
    },
  };
}

/**
 * Verifies one proof of control and stages that role's recipient.
 *
 * The challenge is one-use and bound to the role, actor, and lifecycle
 * revision it was opened for; a stale revision means the tenant state moved
 * under the challenge and the proof no longer says what it claimed.
 */
export function confirmTenantRootRecipientV1(input: {
  readonly challenge: TenantRootRecipientChallengeRecordV1 | null;
  readonly role: TenantRootDeriverRoleV1;
  readonly actorUserId: string;
  readonly lifecycleRevision: number;
  readonly confirmationVerified: boolean;
  readonly nowMs: number;
}): TenantRootRecipientResultV1<TenantRootStagedRecipientV1> {
  const { challenge } = input;
  if (challenge === null) {
    return { ok: false, error: { kind: 'challenge_not_found' } };
  }
  if (challenge.consumedAtMs !== null) {
    return { ok: false, error: { kind: 'challenge_already_consumed' } };
  }
  if (input.nowMs >= challenge.expiresAtMs) {
    return { ok: false, error: { kind: 'challenge_expired' } };
  }
  if (challenge.role !== input.role) {
    return { ok: false, error: { kind: 'challenge_role_mismatch' } };
  }
  if (challenge.actorUserId !== input.actorUserId) {
    return { ok: false, error: { kind: 'challenge_actor_mismatch' } };
  }
  if (challenge.lifecycleRevision !== input.lifecycleRevision) {
    return { ok: false, error: { kind: 'challenge_lifecycle_revision_stale' } };
  }
  if (!input.confirmationVerified) {
    return { ok: false, error: { kind: 'confirmation_invalid' } };
  }
  return {
    ok: true,
    value: {
      role: challenge.role,
      recipientPublicKeyB64u: challenge.recipientPublicKeyB64u,
      recipientFingerprintB64u: challenge.recipientFingerprintB64u,
      verifiedAtMs: input.nowMs,
    },
  };
}

/** One committed recipient pair, ready for recovery-set generation. */
export type TenantRootCommittedRecipientPairV1 = {
  readonly deriverA: TenantRootStagedRecipientV1;
  readonly deriverB: TenantRootStagedRecipientV1;
};

/**
 * Commits one verified Deriver A and Deriver B pair.
 *
 * Both proofs must have succeeded and the two fingerprints must differ. One
 * key serving both roles would put a single secret in control of both recovery
 * shares, which is exactly what splitting the set prevents.
 */
export function commitTenantRootRecipientPairV1(input: {
  readonly previousPair: TenantRootRecipientPairV1 | null;
  readonly staged: readonly TenantRootStagedRecipientV1[];
}): TenantRootRecipientResultV1<TenantRootCommittedRecipientPairV1> {
  const deriverA = input.staged.find((recipient) => recipient.role === 'deriver_a');
  const deriverB = input.staged.find((recipient) => recipient.role === 'deriver_b');
  if (deriverA === undefined) {
    return { ok: false, error: { kind: 'recipient_pair_incomplete', missingRole: 'deriver_a' } };
  }
  if (deriverB === undefined) {
    return { ok: false, error: { kind: 'recipient_pair_incomplete', missingRole: 'deriver_b' } };
  }
  if (deriverA.recipientFingerprintB64u === deriverB.recipientFingerprintB64u) {
    return { ok: false, error: { kind: 'recipient_pair_reuses_one_key' } };
  }
  if (input.previousPair !== null) {
    const replacedA =
      deriverA.recipientFingerprintB64u !== input.previousPair.deriverAFingerprintB64u;
    const replacedB =
      deriverB.recipientFingerprintB64u !== input.previousPair.deriverBFingerprintB64u;
    if (replacedA !== replacedB) {
      return {
        ok: false,
        error: {
          kind: 'recipient_pair_incomplete',
          missingRole: replacedA ? 'deriver_b' : 'deriver_a',
        },
      };
    }
  }
  return { ok: true, value: { deriverA, deriverB } };
}

/** Projects the staged recipients into the console's enrolment branch. */
export function tenantRootRecipientEnrolmentV1(
  staged: readonly TenantRootStagedRecipientV1[],
): TenantRootRecipientEnrolmentV1 {
  const deriverA = staged.find((recipient) => recipient.role === 'deriver_a');
  const deriverB = staged.find((recipient) => recipient.role === 'deriver_b');
  if (deriverA !== undefined && deriverB === undefined) {
    return {
      kind: 'deriver_a_enrolled',
      deriverAFingerprintB64u: deriverA.recipientFingerprintB64u,
    };
  }
  if (deriverB !== undefined && deriverA === undefined) {
    return {
      kind: 'deriver_b_enrolled',
      deriverBFingerprintB64u: deriverB.recipientFingerprintB64u,
    };
  }
  // Both present is not an enrolment branch: it is a committed pair.
  return { kind: 'neither_enrolled' };
}
