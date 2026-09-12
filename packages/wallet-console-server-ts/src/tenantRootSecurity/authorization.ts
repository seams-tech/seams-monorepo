import type {
  TenantRootOperationKindV1,
  TenantRootOperationRecordV1,
  TenantRootRecoveryGovernanceV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import {
  tenantRootGovernanceTransitionRequiresSecondOwnerV1,
  tenantRootOperationFollowsGovernanceV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import {
  parseTenantRootStepUpV1,
  type TenantRootStepUpProofV1,
  type TenantRootStepUpSessionRecordV1,
} from './stepUp';

/**
 * Authorization for tenant derivation-root console operations.
 *
 * The generic console approval service cannot be reused here: it accepts a
 * caller-provided `mfaVerified` boolean, lets a requester approve their own
 * request, and leaves an approved record reusable. This module replaces those
 * behaviours for the tenant-root operation union without widening the generic
 * KEY_EXPORT operation.
 */

/** How long an approval stays valid for its exact operation. */
export const TENANT_ROOT_APPROVAL_MAX_AGE_MS_V1 = 600_000;

/** One second owner's approval of one exact operation digest. */
export type TenantRootOperationApprovalRecordV1 = {
  readonly operationDigestB64u: string;
  readonly approverUserId: string;
  readonly approverStepUp: TenantRootStepUpSessionRecordV1;
  readonly approvedAtMs: number;
  readonly consumedAtMs: number | null;
};

/** Why one operation could not be authorized. */
export type TenantRootAuthorizationErrorV1 =
  | { readonly kind: 'step_up_required'; readonly reason: string }
  | { readonly kind: 'step_up_actor_mismatch' }
  | { readonly kind: 'governance_mismatch' }
  | { readonly kind: 'approval_required' }
  | { readonly kind: 'approval_not_for_this_operation' }
  | { readonly kind: 'approval_already_consumed' }
  | { readonly kind: 'approval_expired'; readonly ageMs: number }
  | { readonly kind: 'approver_is_the_requester' }
  | { readonly kind: 'approver_step_up_invalid'; readonly reason: string }
  | { readonly kind: 'approver_no_longer_owner' }
  | { readonly kind: 'approval_not_used_by_this_operation' }
  | { readonly kind: 'operation_expired' };

/** One authorized operation, ready for exactly one transactional consumption. */
export type AuthorizedTenantRootOperationV1 = {
  readonly record: TenantRootOperationRecordV1;
  readonly operationDigestB64u: string;
  readonly requesterUserId: string;
  readonly requesterStepUp: TenantRootStepUpProofV1;
  readonly approverUserId: string | null;
};

/** Result of one authorization decision. */
export type TenantRootAuthorizationResultV1 =
  | { readonly ok: true; readonly authorized: AuthorizedTenantRootOperationV1 }
  | { readonly ok: false; readonly error: TenantRootAuthorizationErrorV1 };

function stepUpReason(kind: string, ageMs?: number): string {
  return ageMs === undefined ? kind : `${kind}:${ageMs}`;
}

/**
 * Returns whether one operation needs a second owner's approval.
 *
 * The four governance-following operations take a second owner under
 * two-person governance. A governance change additionally uses the stronger
 * quorum of the current and target branches, so selecting two-person
 * governance takes two owners from the start and leaving it takes two owners.
 */
export function tenantRootOperationNeedsSecondOwnerV1(input: {
  readonly operationKind: TenantRootOperationKindV1;
  readonly governance: TenantRootRecoveryGovernanceV1 | null;
  readonly targetGovernance?: TenantRootRecoveryGovernanceV1;
}): boolean {
  if (!tenantRootOperationFollowsGovernanceV1(input.operationKind)) return false;
  if (input.operationKind === 'tenant_root_recovery_governance_change_v1') {
    if (input.targetGovernance === undefined) {
      throw new Error('a governance change must name the target governance');
    }
    return tenantRootGovernanceTransitionRequiresSecondOwnerV1(
      input.governance,
      input.targetGovernance,
    );
  }
  return input.governance?.kind === 'two_person_v1';
}

/**
 * Authorizes one tenant-root console operation.
 *
 * A governance-following operation under two-person governance needs an
 * approval from a *different* owner, bound to this exact digest, unconsumed,
 * and backed by that owner's own fresh step-up. Every other combination is
 * refused — including an approval supplied for an operation that does not use
 * one, which is a contract violation rather than something to ignore.
 *
 * Whether the approving owner is *still* an owner is rechecked by the caller
 * at consumption; this function decides on the evidence it is handed.
 */
export function authorizeTenantRootOperationV1(input: {
  readonly record: TenantRootOperationRecordV1;
  readonly operationDigestB64u: string;
  readonly governance: TenantRootRecoveryGovernanceV1 | null;
  readonly governanceDigestB64u: string;
  readonly targetGovernance?: TenantRootRecoveryGovernanceV1;
  readonly requesterStepUp: TenantRootStepUpSessionRecordV1 | null;
  readonly requesterSessionId?: string;
  readonly approval: TenantRootOperationApprovalRecordV1 | null;
  readonly nowMs: number;
}): TenantRootAuthorizationResultV1 {
  const { record } = input;
  if (record.recoveryGovernanceDigest !== input.governanceDigestB64u) {
    return { ok: false, error: { kind: 'governance_mismatch' } };
  }
  if (Date.parse(record.expiresAt) <= input.nowMs) {
    return { ok: false, error: { kind: 'operation_expired' } };
  }

  const requester = parseTenantRootStepUpV1({
    record: input.requesterStepUp,
    expectedActorUserId: record.requesterActorId,
    ...(input.requesterSessionId === undefined
      ? {}
      : { expectedSessionId: input.requesterSessionId }),
    nowMs: input.nowMs,
  });
  if (!requester.ok) {
    return requester.error.kind === 'actor_mismatch'
      ? { ok: false, error: { kind: 'step_up_actor_mismatch' } }
      : {
          ok: false,
          error: {
            kind: 'step_up_required',
            reason: stepUpReason(
              requester.error.kind,
              requester.error.kind === 'stale' ? requester.error.ageMs : undefined,
            ),
          },
        };
  }

  const needsSecondOwner = tenantRootOperationNeedsSecondOwnerV1({
    operationKind: record.operationKind,
    governance: input.governance,
    ...(input.targetGovernance === undefined ? {} : { targetGovernance: input.targetGovernance }),
  });

  if (!needsSecondOwner) {
    if (input.approval !== null) {
      return { ok: false, error: { kind: 'approval_not_used_by_this_operation' } };
    }
    return {
      ok: true,
      authorized: {
        record,
        operationDigestB64u: input.operationDigestB64u,
        requesterUserId: record.requesterActorId,
        requesterStepUp: requester.proof,
        approverUserId: null,
      },
    };
  }

  const approval = input.approval;
  if (approval === null) {
    return { ok: false, error: { kind: 'approval_required' } };
  }
  if (approval.operationDigestB64u !== input.operationDigestB64u) {
    return { ok: false, error: { kind: 'approval_not_for_this_operation' } };
  }
  if (approval.consumedAtMs !== null) {
    return { ok: false, error: { kind: 'approval_already_consumed' } };
  }
  const approvalAgeMs = input.nowMs - approval.approvedAtMs;
  if (approvalAgeMs < 0 || approvalAgeMs > TENANT_ROOT_APPROVAL_MAX_AGE_MS_V1) {
    return { ok: false, error: { kind: 'approval_expired', ageMs: approvalAgeMs } };
  }
  if (approval.approverUserId === record.requesterActorId) {
    return { ok: false, error: { kind: 'approver_is_the_requester' } };
  }
  const approver = parseTenantRootStepUpV1({
    record: approval.approverStepUp,
    expectedActorUserId: approval.approverUserId,
    nowMs: input.nowMs,
  });
  if (!approver.ok) {
    return {
      ok: false,
      error: {
        kind: 'approver_step_up_invalid',
        reason: stepUpReason(
          approver.error.kind,
          approver.error.kind === 'stale' ? approver.error.ageMs : undefined,
        ),
      },
    };
  }

  return {
    ok: true,
    authorized: {
      record,
      operationDigestB64u: input.operationDigestB64u,
      requesterUserId: record.requesterActorId,
      requesterStepUp: requester.proof,
      approverUserId: approval.approverUserId,
    },
  };
}

/**
 * Returns the operations this feature refuses to route through the generic
 * console approval service.
 *
 * The generic service's reusable approved records and self-approval path are
 * unsafe for anything that changes who can recover a tenant root.
 */
export function tenantRootOperationsRequiringDedicatedApprovalV1(): readonly TenantRootOperationKindV1[] {
  return [
    'tenant_root_recovery_governance_change_v1',
    'tenant_root_recovery_recipient_pair_enroll_v1',
    'tenant_root_recovery_recipient_pair_replace_v1',
    'tenant_root_source_lineage_retire_v1',
  ];
}
