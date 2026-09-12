import type {
  TenantRootOperationKindV1,
  TenantRootOperationRecordResultV1,
  TenantRootOperationRecordV1,
  TenantRootRecoveryGovernanceV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import {
  canonicalTenantRootOperationRecordJsonV1,
  parseTenantRootOperationRecordV1,
  tenantRootOperationDigestB64uV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import {
  authorizeTenantRootOperationV1,
  type TenantRootAuthorizationErrorV1,
  type TenantRootOperationApprovalRecordV1,
} from './authorization';
import type { TenantRootStepUpProofV1, TenantRootStepUpSessionRecordV1 } from './stepUp';

/**
 * Creating, approving, and dispatching one authorized tenant-root operation.
 *
 * Three properties the store must provide, and this service depends on:
 *
 * - **One transaction.** Consuming the approval and creating the operation and
 *   its outbox item happen together, so a crash can never leave an approval
 *   spent with no operation, or an operation with an unspent approval.
 * - **Idempotency by key.** Repeating a request with the same idempotency key
 *   returns the existing operation and consumes nothing further, so a retry
 *   never needs a second owner to approve again.
 * - **One record per key.** A retry reuses the exact record bytes the first
 *   attempt produced. The server's own timestamps are in the record, so a
 *   freshly built record would carry a different digest and a retry would
 *   look like a different operation.
 */

/** How an authorized operation is progressing toward the control plane. */
export type TenantRootOutboxStatusV1 = 'pending' | 'accepted' | 'authorization_expired' | 'failed';

/** The caller that admitted one operation to the durable outbox. */
export type TenantRootOperationTriggerKindV1 = 'manual' | 'scheduled';

type TenantRootRotationOperationKindV1 = 'tenant_root_operational_share_rotation_v1';
type TenantRootNonRotationOperationKindV1 = Exclude<
  TenantRootOperationKindV1,
  TenantRootRotationOperationKindV1
>;

/** Trigger and operation kind are correlated at the persistence boundary. */
export type TenantRootOperationTriggerV1 =
  | {
      readonly operationKind: TenantRootRotationOperationKindV1;
      readonly triggerKind: TenantRootOperationTriggerKindV1;
    }
  | {
      readonly operationKind: TenantRootNonRotationOperationKindV1;
      readonly triggerKind: 'manual';
    };

export type TenantRootOperationTriggerKindForOperationV1<
  TOperationKind extends TenantRootOperationKindV1,
> = TOperationKind extends TenantRootRotationOperationKindV1
  ? TenantRootOperationTriggerKindV1
  : 'manual';

/** Parses the stored trigger relation once at the D1 boundary. */
export function parseTenantRootOperationTriggerV1(
  operationKind: TenantRootOperationKindV1,
  value: unknown,
): TenantRootOperationTriggerV1 {
  if (operationKind === 'tenant_root_operational_share_rotation_v1') {
    if (value === 'manual' || value === 'scheduled') {
      return { operationKind, triggerKind: value };
    }
  } else if (value === 'manual') {
    return { operationKind, triggerKind: value };
  }
  throw new Error(`invalid trigger ${String(value)} for tenant-root operation ${operationKind}`);
}

/** One immutable authorized operation and its dispatch state. */
export type TenantRootOperationEntryV1 = TenantRootOperationTriggerV1 & {
  readonly operationId: string;
  readonly operationDigestB64u: string;
  readonly canonicalRecordJson: string;
  readonly idempotencyKey: string;
  readonly requesterUserId: string;
  readonly approverUserId: string | null;
  readonly nonceB64u: string;
  readonly status: TenantRootOutboxStatusV1;
  readonly createdAtMs: number;
  readonly authorizationExpiresAtMs: number;
  readonly acceptedResultJson: string | null;
  readonly failureCode: string | null;
  /**
   * Recorded before possible delivery. It survives a process crash even when
   * the catch handler never ran. Admission and replay are decided by the Router.
   */
  readonly dispatchUncertainAtMs: number | null;
};

/** One pending operation together with the tenant scope needed to replay it. */
export type TenantRootPendingOperationV1 = {
  readonly orgId: string;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly entry: TenantRootOperationEntryV1;
};

/** What the store writes in one transaction. */
export type TenantRootOperationCreateInputV1 = TenantRootOperationTriggerV1 & {
  readonly operationId: string;
  readonly operationDigestB64u: string;
  readonly canonicalRecordJson: string;
  readonly idempotencyKey: string;
  readonly requesterUserId: string;
  readonly approverUserId: string | null;
  readonly consumedApprovalDigestB64u: string | null;
  readonly nonceB64u: string;
  readonly createdAtMs: number;
  readonly authorizationExpiresAtMs: number;
};

/**
 * One operation waiting for a second owner.
 *
 * The exact record is kept so the approver approves, and the requester later
 * presents, the same digest.
 */
export type TenantRootApprovalRequestV1 = {
  readonly operationDigestB64u: string;
  readonly operationKind: TenantRootOperationKindV1;
  readonly canonicalRecordJson: string;
  /**
   * What the operation will do beyond what the frozen record encodes, such as
   * the target governance branch. Canonical JSON, or null when the record
   * says everything. An approver sees it; a retry must present the same.
   */
  readonly payloadJson: string | null;
  readonly idempotencyKey: string;
  readonly requesterUserId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
};

/** What the store writes when a second owner approves. */
export type TenantRootApprovalCreateInputV1 = {
  readonly operationDigestB64u: string;
  readonly operationKind: TenantRootOperationKindV1;
  readonly requesterUserId: string;
  readonly approverUserId: string;
  readonly approverStepUp: TenantRootStepUpSessionRecordV1;
  readonly approvedAtMs: number;
};

/** The persistence port this service needs. */
export interface TenantRootOperationStoreV1 {
  /** Returns an existing operation for one idempotency key, if any. */
  findByIdempotencyKey(idempotencyKey: string): Promise<TenantRootOperationEntryV1 | null>;
  /** Returns the pending approval for one operation digest, if any. */
  findApproval(operationDigestB64u: string): Promise<TenantRootOperationApprovalRecordV1 | null>;
  /** Returns the approval request for one idempotency key, if any. */
  findApprovalRequestByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<TenantRootApprovalRequestV1 | null>;
  /** Returns the approval request for one operation digest, if any. */
  findApprovalRequestByDigest(
    operationDigestB64u: string,
  ): Promise<TenantRootApprovalRequestV1 | null>;
  /** Records one operation waiting for a second owner. Idempotent by digest. */
  putApprovalRequest(request: TenantRootApprovalRequestV1): Promise<void>;
  /** Returns every unconsumed approval request for this tenant root. */
  listApprovalRequests(): Promise<readonly TenantRootApprovalRequestV1[]>;
  /**
   * Records one second-owner approval. Must fail if the approver is the
   * requester or an approval for the digest already exists.
   */
  recordApproval(input: TenantRootApprovalCreateInputV1): Promise<void>;
  /**
   * Consumes the approval, if one is named, and creates the operation and its
   * outbox item. Must be atomic and must fail if the approval was already
   * consumed or the idempotency key already exists.
   */
  consumeApprovalAndCreateOperation(
    input: TenantRootOperationCreateInputV1,
  ): Promise<TenantRootOperationEntryV1>;
  /** Records the control plane's accepted result for one operation. */
  markAccepted(
    operationId: string,
    acceptedResultJson: string,
  ): Promise<TenantRootOperationEntryV1>;
  /** Records that one authorized operation was refused when it ran. */
  markFailed(operationId: string, failureCode: string): Promise<TenantRootOperationEntryV1>;
  /**
   * Records that a dispatch outcome is unknown, so a later retry of this exact
   * operation must reconcile with the control plane rather than refuse.
   */
  markDispatchUncertain(operationId: string, atMs: number): Promise<TenantRootOperationEntryV1>;
  /** Marks one never-accepted operation as past its authorization expiry. */
  markAuthorizationExpired(operationId: string): Promise<TenantRootOperationEntryV1>;
}

/** Answers whether an approving owner still holds the organization's owner role. */
export type TenantRootOwnerCheckV1 = (userId: string) => Promise<boolean>;

/** Why one operation could not be started. */
export type TenantRootOperationStartErrorV1 =
  | { readonly kind: 'authorization_failed'; readonly error: TenantRootAuthorizationErrorV1 }
  | {
      /** The operation is recorded and waits for a different owner's approval. */
      readonly kind: 'approval_pending';
      readonly operationDigestB64u: string;
      readonly expiresAtMs: number;
    }
  | { readonly kind: 'idempotency_key_reused_with_different_operation' }
  | { readonly kind: 'approval_consumed_concurrently' };

/** Result of starting one operation. */
export type TenantRootOperationStartResultV1 =
  | {
      readonly ok: true;
      readonly entry: TenantRootOperationEntryV1;
      /** True when an existing operation was returned rather than created. */
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly error: TenantRootOperationStartErrorV1 };

/** The fields every start request resolves before authorization. */
export type TenantRootOperationStartFieldsV1 = {
  readonly operationDigestB64u: string;
  readonly governance: TenantRootRecoveryGovernanceV1 | null;
  readonly governanceDigestB64u: string;
  readonly targetGovernance?: TenantRootRecoveryGovernanceV1;
  readonly requesterStepUp: TenantRootStepUpSessionRecordV1 | null;
  readonly requesterSessionId?: string;
  /** Rechecked at consumption: an approver removed as owner no longer counts. */
  readonly approverIsOwner: TenantRootOwnerCheckV1;
  /** Bound into the approval request alongside the record; see the request type. */
  readonly payloadJson?: string;
  readonly operationId: string;
  readonly nonceB64u: string;
  readonly nowMs: number;
};

/** Everything one start request resolves before authorization. */
export type TenantRootOperationStartInputV1<
  TOperationKind extends TenantRootOperationKindV1 = TenantRootOperationKindV1,
> = TenantRootOperationStartFieldsV1 &
  (
    | {
        /** Manual admission is valid for every operation kind. */
        readonly record: TenantRootOperationRecordV1;
        readonly triggerKind: 'manual';
      }
    | (TOperationKind extends TenantRootRotationOperationKindV1
        ? {
            readonly record: TenantRootOperationRecordV1 & {
              readonly operationKind: TenantRootRotationOperationKindV1;
            };
            readonly triggerKind: TenantRootOperationTriggerKindV1;
          }
        : never)
  );

/**
 * Starts one authorized tenant-root operation.
 *
 * A repeat with the same idempotency key returns the existing operation
 * unchanged. It does not re-authorize and does not consume another approval:
 * a dispatch retry must never cost a second owner's signature.
 *
 * When the operation needs a second owner and none has approved yet, the
 * exact record is stored as an approval request and the caller is told which
 * digest to have approved. The request is what a later retry reuses.
 */
export async function startTenantRootOperationV1<TOperationKind extends TenantRootOperationKindV1>(
  store: TenantRootOperationStoreV1,
  input: TenantRootOperationStartInputV1<TOperationKind>,
): Promise<TenantRootOperationStartResultV1> {
  const existing = await store.findByIdempotencyKey(input.record.idempotencyKey);
  if (existing !== null) {
    if (
      existing.operationDigestB64u !== input.operationDigestB64u ||
      existing.triggerKind !== input.triggerKind
    ) {
      return {
        ok: false,
        error: { kind: 'idempotency_key_reused_with_different_operation' },
      };
    }
    return { ok: true, entry: existing, replayed: true };
  }

  const approval = await store.findApproval(input.operationDigestB64u);
  const authorized = authorizeTenantRootOperationV1({
    record: input.record,
    operationDigestB64u: input.operationDigestB64u,
    governance: input.governance,
    governanceDigestB64u: input.governanceDigestB64u,
    ...(input.targetGovernance === undefined ? {} : { targetGovernance: input.targetGovernance }),
    requesterStepUp: input.requesterStepUp,
    ...(input.requesterSessionId === undefined
      ? {}
      : { requesterSessionId: input.requesterSessionId }),
    approval,
    nowMs: input.nowMs,
  });
  if (!authorized.ok) {
    if (authorized.error.kind === 'approval_required') {
      const expiresAtMs = Date.parse(input.record.expiresAt);
      await store.putApprovalRequest({
        operationDigestB64u: input.operationDigestB64u,
        operationKind: input.record.operationKind,
        canonicalRecordJson: canonicalTenantRootOperationRecordJsonV1(input.record),
        payloadJson: input.payloadJson ?? null,
        idempotencyKey: input.record.idempotencyKey,
        requesterUserId: input.record.requesterActorId,
        createdAtMs: input.nowMs,
        expiresAtMs,
      });
      return {
        ok: false,
        error: {
          kind: 'approval_pending',
          operationDigestB64u: input.operationDigestB64u,
          expiresAtMs,
        },
      };
    }
    return { ok: false, error: { kind: 'authorization_failed', error: authorized.error } };
  }

  // Removing the second owner after approval does not preserve the capability.
  const approverUserId = authorized.authorized.approverUserId;
  if (approverUserId !== null && !(await input.approverIsOwner(approverUserId))) {
    return {
      ok: false,
      error: { kind: 'authorization_failed', error: { kind: 'approver_no_longer_owner' } },
    };
  }

  const authorizationExpiresAtMs = Date.parse(input.record.expiresAt);
  try {
    const trigger = parseTenantRootOperationTriggerV1(
      input.record.operationKind,
      input.triggerKind,
    );
    const entry = await store.consumeApprovalAndCreateOperation({
      operationId: input.operationId,
      ...trigger,
      operationDigestB64u: input.operationDigestB64u,
      canonicalRecordJson: canonicalTenantRootOperationRecordJsonV1(input.record),
      idempotencyKey: input.record.idempotencyKey,
      requesterUserId: authorized.authorized.requesterUserId,
      approverUserId,
      consumedApprovalDigestB64u: approverUserId === null ? null : input.operationDigestB64u,
      nonceB64u: input.nonceB64u,
      createdAtMs: input.nowMs,
      authorizationExpiresAtMs,
    });
    return { ok: true, entry, replayed: false };
  } catch (error) {
    if (isApprovalRaceError(error)) {
      return { ok: false, error: { kind: 'approval_consumed_concurrently' } };
    }
    throw error;
  }
}

/** Why a second owner's approval was refused. */
export type TenantRootApproveErrorV1 =
  | { readonly kind: 'approval_request_not_found' }
  | { readonly kind: 'approval_request_expired' }
  | { readonly kind: 'approver_is_the_requester' }
  | { readonly kind: 'approval_already_recorded' };

/** Result of one approval. */
export type TenantRootApproveResultV1 =
  | { readonly ok: true; readonly request: TenantRootApprovalRequestV1 }
  | { readonly ok: false; readonly error: TenantRootApproveErrorV1 };

/**
 * Records one second owner's approval of an exact pending operation digest.
 *
 * The approver's step-up proof is server-issued and belongs to the approver's
 * own session; it is what the requester's later consumption rechecks for
 * freshness. A requester can never approve their own operation, and an
 * operation is approved at most once.
 */
export async function approveTenantRootOperationV1(
  store: TenantRootOperationStoreV1,
  input: {
    readonly operationDigestB64u: string;
    readonly approver: TenantRootStepUpProofV1;
    readonly nowMs: number;
  },
): Promise<TenantRootApproveResultV1> {
  const request = await store.findApprovalRequestByDigest(input.operationDigestB64u);
  if (request === null) {
    return { ok: false, error: { kind: 'approval_request_not_found' } };
  }
  if (request.expiresAtMs <= input.nowMs) {
    return { ok: false, error: { kind: 'approval_request_expired' } };
  }
  if (request.requesterUserId === input.approver.actorUserId) {
    return { ok: false, error: { kind: 'approver_is_the_requester' } };
  }
  if ((await store.findApproval(input.operationDigestB64u)) !== null) {
    return { ok: false, error: { kind: 'approval_already_recorded' } };
  }
  await store.recordApproval({
    operationDigestB64u: input.operationDigestB64u,
    operationKind: request.operationKind,
    requesterUserId: request.requesterUserId,
    approverUserId: input.approver.actorUserId,
    approverStepUp: {
      actorUserId: input.approver.actorUserId,
      sessionId: input.approver.sessionId,
      method: input.approver.method,
      verifiedAtMs: input.approver.verifiedAtMs,
    },
    approvedAtMs: input.nowMs,
  });
  return { ok: true, request };
}

/** Why a stored record could not be reused for a retry. */
export type TenantRootRecordResolutionErrorV1 =
  | { readonly kind: 'idempotency_key_reused_with_different_operation' }
  | { readonly kind: 'stored_record_unreadable' }
  | {
      readonly kind: 'invalid_operation_record';
      readonly error: Extract<TenantRootOperationRecordResultV1, { ok: false }>['error'];
    };

/** One record and its digest, either reused or freshly built. */
export type TenantRootRecordResolutionV1 =
  | {
      readonly ok: true;
      readonly record: TenantRootOperationRecordV1;
      readonly operationDigestB64u: string;
      /** True when the record came from a prior attempt with this key. */
      readonly reused: boolean;
    }
  | { readonly ok: false; readonly error: TenantRootRecordResolutionErrorV1 };

/**
 * Resolves the exact record one idempotency key names.
 *
 * A prior operation or approval request with this key owns the record: the
 * retry presents those bytes, so its digest matches what was consumed or
 * approved. Only a key nobody has used yet builds a fresh record, whose
 * issue and expiry times are the server's.
 */
export async function resolveTenantRootOperationRecordV1(
  store: TenantRootOperationStoreV1,
  input: {
    readonly idempotencyKey: string;
    readonly operationKind: TenantRootOperationKindV1;
    readonly requesterUserId: string;
    /** Must equal what a prior attempt with this key bound, when it bound one. */
    readonly payloadJson?: string;
    readonly nowMs: number;
    readonly build: () => TenantRootOperationRecordResultV1;
  },
): Promise<TenantRootRecordResolutionV1> {
  const reuse = (
    canonicalRecordJson: string,
    operationDigestB64u: string,
    storedPayloadJson: string | null,
  ): TenantRootRecordResolutionV1 => {
    const record = parseTenantRootOperationRecordV1(canonicalRecordJson);
    if (record === null) {
      return { ok: false, error: { kind: 'stored_record_unreadable' } };
    }
    if (
      record.operationKind !== input.operationKind ||
      record.requesterActorId !== input.requesterUserId ||
      (storedPayloadJson !== null && storedPayloadJson !== (input.payloadJson ?? null))
    ) {
      return { ok: false, error: { kind: 'idempotency_key_reused_with_different_operation' } };
    }
    return { ok: true, record, operationDigestB64u, reused: true };
  };

  const existing = await store.findByIdempotencyKey(input.idempotencyKey);
  if (existing !== null) {
    return reuse(existing.canonicalRecordJson, existing.operationDigestB64u, null);
  }
  const request = await store.findApprovalRequestByIdempotencyKey(input.idempotencyKey);
  if (request !== null && request.expiresAtMs > input.nowMs) {
    return reuse(request.canonicalRecordJson, request.operationDigestB64u, request.payloadJson);
  }

  const built = input.build();
  if (!built.ok) {
    return { ok: false, error: { kind: 'invalid_operation_record', error: built.error } };
  }
  return {
    ok: true,
    record: built.record,
    operationDigestB64u: await tenantRootOperationDigestB64uV1(built.record),
    reused: false,
  };
}

/**
 * Records the control plane's result for one operation.
 *
 * The control plane consumes the nonce once and returns the same result for an
 * exact replay, so recording an accepted result twice is not an error.
 */
export async function recordTenantRootOperationAcceptedV1(
  store: TenantRootOperationStoreV1,
  operationId: string,
  acceptedResultJson: string,
): Promise<TenantRootOperationEntryV1> {
  return await store.markAccepted(operationId, acceptedResultJson);
}

/**
 * Expires one operation that was never accepted before its authorization ran out.
 *
 * Expiry never affects an operation the control plane already accepted; that
 * result stays replayable.
 */
export async function expireTenantRootOperationV1(
  store: TenantRootOperationStoreV1,
  entry: TenantRootOperationEntryV1,
  nowMs: number,
): Promise<TenantRootOperationEntryV1> {
  if (entry.status !== 'pending' || nowMs < entry.authorizationExpiresAtMs) {
    return entry;
  }
  return await store.markAuthorizationExpired(entry.operationId);
}

/** The store signals a lost approval race with this marker. */
export const TENANT_ROOT_APPROVAL_RACE_MARKER_V1 = 'tenant_root_approval_consumed_concurrently';

/**
 * Marker for an approval request whose idempotency key a live request for a
 * different record already holds. The caller's record was not stored; a retry
 * resolves the live record under that key instead.
 */
export const TENANT_ROOT_APPROVAL_REQUEST_CONFLICT_MARKER_V1 =
  'tenant_root_approval_request_key_held_by_another_record';

function isApprovalRaceError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(TENANT_ROOT_APPROVAL_RACE_MARKER_V1);
}
