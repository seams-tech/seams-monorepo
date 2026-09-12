import type {
  TenantRootDownloadEvidenceV1,
  TenantRootRecipientPairV1,
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootRecoverySetStateV1,
  TenantRootRoleReceiptsV1,
  TenantRootTrustLevelV1,
} from '@seams-internal/shared-ts/tenant-root';

/**
 * Recovery-set generation, replacement, and download evidence.
 *
 * The rules that shape this module:
 *
 * - **The old set stays downloadable.** A tenant is never left without a
 *   recoverable backup while a replacement is being generated, so the active
 *   set survives until the replacement is fully verified.
 * - **A superseded set is never reactivated.** If a replacement fails after
 *   activation, the state is cleanup-incomplete, not a rollback.
 * - **A failure is a branch, not a hang.** Generation that fails before
 *   activation lands in a failed branch with its cleanup receipts, or in
 *   cleanup-incomplete without them; it never stays in flight.
 * - **Issued is not durable.** A browser response can only record that bytes
 *   were sent. Only the CLI, after writing, syncing, reopening, and
 *   re-digesting, can record durable verification.
 */

/** Why a recovery-set transition was refused. */
export type TenantRootRecoverySetErrorV1 =
  | { readonly kind: 'recipient_pair_not_committed' }
  | { readonly kind: 'generation_already_in_flight' }
  | { readonly kind: 'cleanup_outstanding' }
  | { readonly kind: 'no_generation_in_flight' }
  | { readonly kind: 'verification_incomplete'; readonly missing: readonly string[] }
  | { readonly kind: 'replacement_set_id_matches_active' }
  | { readonly kind: 'generated_set_is_not_the_pending_set' };

/** Result of one recovery-set transition. */
export type TenantRootRecoverySetResultV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TenantRootRecoverySetErrorV1 };

/**
 * Begins generating the first recovery set, or a replacement.
 *
 * Recovery-key rotation always creates fresh recovery shares under a new set
 * id. Old shares are never rewrapped to new recipients: rewrapping would leave
 * the previous recipients able to decrypt the same shares.
 *
 * A restored deployment holds `tenant_held_external` files it never stored, so
 * its first backup here is an initial generation: there is no active set to
 * keep downloadable while it runs.
 */
export function beginRecoverySetGenerationV1(input: {
  readonly backup: TenantRootRecoveryBackupV1;
  readonly governance: TenantRootRecoveryGovernanceV1;
  readonly recipientPair: TenantRootRecipientPairV1 | null;
  readonly pendingRecoverySetId: string;
}): TenantRootRecoverySetResultV1<
  Extract<TenantRootRecoveryBackupV1, { readonly status: 'preparing_initial' | 'replacing' }>
> {
  if (input.recipientPair === null) {
    return { ok: false, error: { kind: 'recipient_pair_not_committed' } };
  }
  switch (input.backup.status) {
    case 'preparing_initial':
    case 'replacing':
      return input.backup.pendingRecoverySetId === input.pendingRecoverySetId
        ? { ok: true, value: input.backup }
        : { ok: false, error: { kind: 'generation_already_in_flight' } };
    case 'not_configured':
    case 'recipients_pending':
    case 'failed_initial':
    case 'tenant_held_external':
      return {
        ok: true,
        value: {
          status: 'preparing_initial',
          governance: input.governance,
          recipientPair: input.recipientPair,
          pendingRecoverySetId: input.pendingRecoverySetId,
        },
      };
    case 'ready':
    case 'failed_replacement':
      if (input.backup.active.recoverySetId === input.pendingRecoverySetId) {
        return { ok: false, error: { kind: 'replacement_set_id_matches_active' } };
      }
      return {
        ok: true,
        value: {
          status: 'replacing',
          governance: input.governance,
          active: input.backup.active,
          pendingRecipientPair: input.recipientPair,
          pendingRecoverySetId: input.pendingRecoverySetId,
        },
      };
    case 'cleanup_incomplete':
      if (input.backup.active?.recoverySetId === input.pendingRecoverySetId) {
        return { ok: false, error: { kind: 'replacement_set_id_matches_active' } };
      }
      return {
        ok: true,
        value:
          input.backup.active === null
            ? {
                status: 'preparing_initial',
                governance: input.governance,
                recipientPair: input.recipientPair,
                pendingRecoverySetId: input.pendingRecoverySetId,
              }
            : {
                status: 'replacing',
                governance: input.governance,
                active: input.backup.active,
                pendingRecipientPair: input.recipientPair,
                pendingRecoverySetId: input.pendingRecoverySetId,
              },
      };
  }
}

/** The receipts a pending recovery set must produce before it can activate. */
export type TenantRootRecoverySetVerificationV1 = {
  readonly deriverAPackageSignatureVerified: boolean;
  readonly deriverBPackageSignatureVerified: boolean;
  readonly descriptorContinuityVerified: boolean;
  readonly manifestSignatureVerified: boolean;
  readonly packageDigestsVerified: boolean;
  readonly persistenceReceipts: TenantRootRoleReceiptsV1 | null;
};

function missingVerification(verification: TenantRootRecoverySetVerificationV1): readonly string[] {
  const missing: string[] = [];
  if (!verification.deriverAPackageSignatureVerified) missing.push('deriver_a_package_signature');
  if (!verification.deriverBPackageSignatureVerified) missing.push('deriver_b_package_signature');
  if (!verification.descriptorContinuityVerified) missing.push('descriptor_continuity');
  if (!verification.manifestSignatureVerified) missing.push('manifest_signature');
  if (!verification.packageDigestsVerified) missing.push('package_digests');
  if (verification.persistenceReceipts === null) missing.push('persistence_receipts');
  return missing;
}

/**
 * Activates a fully verified pending recovery set.
 *
 * Activation switches the recipient pair and the set together. Destroying the
 * old service-held packages is mandatory afterwards; when that destruction
 * cannot be proved the state becomes cleanup-incomplete rather than rolling
 * back to the superseded set.
 */
export function activateRecoverySetV1(input: {
  readonly backup: TenantRootRecoveryBackupV1;
  readonly pending: TenantRootRecoverySetStateV1;
  readonly verification: TenantRootRecoverySetVerificationV1;
  readonly oldPackagesDestroyed: boolean;
}): TenantRootRecoverySetResultV1<TenantRootRecoveryBackupV1> {
  const missing = missingVerification(input.verification);
  if (missing.length > 0) {
    return { ok: false, error: { kind: 'verification_incomplete', missing } };
  }

  if (input.backup.status === 'preparing_initial') {
    if (input.pending.recoverySetId !== input.backup.pendingRecoverySetId) {
      return { ok: false, error: { kind: 'generated_set_is_not_the_pending_set' } };
    }
    if (!input.oldPackagesDestroyed) {
      return {
        ok: true,
        value: {
          status: 'cleanup_incomplete',
          governance: input.backup.governance,
          active: input.pending,
          outstanding: {
            roles: ['deriver_a', 'deriver_b'],
            description: 'earlier recovery packages',
          },
        },
      };
    }
    return {
      ok: true,
      value: { status: 'ready', governance: input.backup.governance, active: input.pending },
    };
  }
  if (input.backup.status !== 'replacing') {
    return { ok: false, error: { kind: 'no_generation_in_flight' } };
  }
  if (input.backup.active.recoverySetId === input.pending.recoverySetId) {
    return { ok: false, error: { kind: 'replacement_set_id_matches_active' } };
  }
  if (input.pending.recoverySetId !== input.backup.pendingRecoverySetId) {
    return { ok: false, error: { kind: 'generated_set_is_not_the_pending_set' } };
  }
  if (!input.oldPackagesDestroyed) {
    // The replacement is active; the superseded set is not restored.
    return {
      ok: true,
      value: {
        status: 'cleanup_incomplete',
        governance: input.backup.governance,
        active: input.pending,
        outstanding: {
          roles: ['deriver_a', 'deriver_b'],
          description: 'superseded recovery packages',
        },
      },
    };
  }
  return {
    ok: true,
    value: { status: 'ready', governance: input.backup.governance, active: input.pending },
  };
}

/**
 * Records that generation failed before the pending set activated.
 *
 * With both cleanup receipts the state is a clean failure: the initial branch
 * has no set, the replacement branch keeps the old set active. Without them
 * the state is cleanup-incomplete. The generation journal retains pending
 * cleanup while a fresh backup can be generated.
 */
export function failRecoverySetGenerationV1(input: {
  readonly backup: TenantRootRecoveryBackupV1;
  readonly failureCode: string;
  readonly cleanupReceipts: TenantRootRoleReceiptsV1 | null;
}): TenantRootRecoverySetResultV1<TenantRootRecoveryBackupV1> {
  if (input.backup.status !== 'preparing_initial' && input.backup.status !== 'replacing') {
    return { ok: false, error: { kind: 'no_generation_in_flight' } };
  }
  const active = input.backup.status === 'replacing' ? input.backup.active : null;
  if (input.cleanupReceipts === null) {
    return {
      ok: true,
      value: {
        status: 'cleanup_incomplete',
        governance: input.backup.governance,
        active,
        outstanding: {
          roles: ['deriver_a', 'deriver_b'],
          description: `pending recovery set ${input.backup.pendingRecoverySetId}`,
        },
      },
    };
  }
  if (active === null) {
    return {
      ok: true,
      value: {
        status: 'failed_initial',
        governance: input.backup.governance,
        failureCode: input.failureCode,
        cleanupReceipts: input.cleanupReceipts,
      },
    };
  }
  return {
    ok: true,
    value: {
      status: 'failed_replacement',
      governance: input.backup.governance,
      active,
      failureCode: input.failureCode,
      cleanupReceipts: input.cleanupReceipts,
    },
  };
}

/** Which artifact one download evidence entry describes. */
export type TenantRootDownloadArtifactV1 = 'deriver_a_package' | 'deriver_b_package' | 'manifest';

/** How the artifact left the service. */
export type TenantRootDownloadChannelV1 = 'browser_response' | 'cli_durable_verification';

/**
 * Records one download.
 *
 * A browser response can only ever record issuance: returning HTTP 200 says
 * nothing about whether the bytes reached durable storage. Durable
 * verification, once recorded for a digest, is never downgraded by a later
 * browser response for the same digest.
 */
export function recordDownloadEvidenceV1(input: {
  readonly existing: TenantRootDownloadEvidenceV1;
  readonly channel: TenantRootDownloadChannelV1;
  readonly actorUserId: string;
  readonly contentDigestB64u: string;
  readonly atIso: string;
  readonly trustLevel: TenantRootTrustLevelV1 | null;
}): TenantRootDownloadEvidenceV1 {
  if (input.channel === 'browser_response') {
    if (
      input.existing.kind === 'durable_verified' &&
      input.existing.contentDigestB64u === input.contentDigestB64u
    ) {
      return input.existing;
    }
    return {
      kind: 'download_issued',
      issuedAt: input.atIso,
      actorUserId: input.actorUserId,
      contentDigestB64u: input.contentDigestB64u,
    };
  }
  if (input.trustLevel === null) {
    // Durability without a trust result is not durable verification.
    return {
      kind: 'download_issued',
      issuedAt: input.atIso,
      actorUserId: input.actorUserId,
      contentDigestB64u: input.contentDigestB64u,
    };
  }
  return {
    kind: 'durable_verified',
    verifiedAt: input.atIso,
    actorUserId: input.actorUserId,
    contentDigestB64u: input.contentDigestB64u,
    trustLevel: input.trustLevel,
  };
}

/**
 * Returns true when a tenant has never taken delivery of a complete set.
 *
 * The page warns on this: a recovery set nobody downloaded cannot recover
 * anything.
 */
export function recoverySetNeedsDownloadWarningV1(set: TenantRootRecoverySetStateV1): boolean {
  return (
    set.deriverAPackage.kind === 'never_downloaded' ||
    set.deriverBPackage.kind === 'never_downloaded' ||
    set.manifest.kind === 'never_downloaded'
  );
}
