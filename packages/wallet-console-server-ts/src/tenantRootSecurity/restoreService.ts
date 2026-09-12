import {
  TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_LIFETIME_MS_V1,
  type SignedTenantRootRestoreRefreshGrantV1,
  type TenantRootRestoreRefreshGrantSigningInputV1,
} from './restoreRefreshGrantSigner';
import { TENANT_ROOT_RESTORE_ROLE_IMPORT_MAX_LIFETIME_MS_V1 } from './restoreGrantSigner';
import type {
  TenantRootDeriverRoleV1,
  TenantRootRestoreActivationEvidenceV1,
  TenantRootRestoreBootstrapCleanupV1,
  TenantRootRestoreCleanupEvidenceV1,
  TenantRootRestoreRoleCleanupV1,
  TenantRootRestoreSessionV1,
  TenantRootSourceCustodyDispositionV1,
  TenantRootTrustLevelV1,
} from '@seams-internal/shared-ts/tenant-root';
import type { TenantRootRestoreRoleImportKeyIssueOperationRecordV1 } from '@seams-internal/shared-ts/tenant-root';
import type { TenantRootOperationEntryV1 } from './service';
import type { TenantRootIdentityV1 } from '@seams-internal/shared-ts/tenant-root';
import {
  buildTenantRootOperationRecordV1,
  canonicalTenantRootOperationRecordJsonV1,
  parseTenantRootOperationRecordV1,
  tenantRootOperationDigestB64uV1,
} from '@seams-internal/shared-ts/tenant-root';
import { base64UrlDecode, base64UrlEncode } from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams-internal/shared-ts/utils/validation';
import { buildTenantRootAuditEventV1, type TenantRootAuditEventV1 } from './audit';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';

/**
 * Destination-side restore.
 *
 * The properties this module exists to keep:
 *
 * - **An active root is never overwritten.** Restore targets an empty
 *   deployment; a destination that already holds a root refuses outright.
 * - **The bootstrap credential mints sessions; it is not a session.** The
 *   one-time token is presented to open a 30-minute administration session
 *   and never travels on any other request. Activation needs that credential
 *   presented again within five minutes.
 * - **Trust is what the destination verified.** The trust result and the
 *   artifact creation time come from manifest registration, never from the
 *   activation request.
 * - **Activation is not automatic.** It needs both role receipts, a trust
 *   result the destination admits, and bootstrap reauthentication — a health
 *   check can never trigger it.
 * - **A session ends.** Every step checks the 24-hour deadline; an expired
 *   session is cleaned up and recorded as expired, or as cleanup-incomplete
 *   when the material could not be proved removed.
 * - **The source is left alone.** Activation records how the source was left,
 *   defaulting to retained-as-backup, and never fences or retires it. A
 *   surviving source remains a valid custodian of the same root.
 * - **Every destination is a clone.** Each activation takes a fresh custody
 *   lineage, and the product says so rather than implying uniqueness.
 */

/** How long one restore administration session lives. */
export const TENANT_ROOT_RESTORE_ADMIN_SESSION_MS_V1 = 1_800_000;
/** How long one restore session lives. */
export const TENANT_ROOT_RESTORE_SESSION_MS_V1 = 86_400_000;
/** Lifetime of an import key, measured from its original issuance. */
export const TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_MS_V1 = 900_000;
/** How long bootstrap reauthentication stays fresh enough to activate. */
export const TENANT_ROOT_ACTIVATION_REAUTH_MAX_AGE_MS_V1 = 300_000;

/** Whether this deployment can be a restore destination at all. */
export type TenantRootDestinationStateV1 =
  | { readonly kind: 'empty'; readonly deploymentFingerprintB64u: string }
  | { readonly kind: 'active_root_present' };

/** One administration session minted from the bootstrap credential. */
export type TenantRootRestoreBootstrapSessionV1 = {
  /** SHA-256 of the session token; the token itself is never stored. */
  readonly tokenDigestB64u: string;
  readonly actorUserId: string;
  /** When the bootstrap credential was presented to mint this session. */
  readonly authenticatedAtMs: number;
  readonly expiresAtMs: number;
};

/** One role's authenticated recovery descriptor context. */
export type TenantRootRestoreRegisteredManifestRoleV1 = {
  readonly shareId: 1 | 2;
  readonly recipientPublicKeyB64u: string;
  readonly recipientFingerprintB64u: string;
  readonly recoveryShareCommitmentB64u: string;
  readonly deriverSigningKeyId: string;
};

export type TenantRootRestoreRegisteredManifestRoleAV1 = Omit<
  TenantRootRestoreRegisteredManifestRoleV1,
  'shareId'
> & { readonly shareId: 1 };

export type TenantRootRestoreRegisteredManifestRoleBV1 = Omit<
  TenantRootRestoreRegisteredManifestRoleV1,
  'shareId'
> & { readonly shareId: 2 };

/** What manifest registration established, kept for later restore steps. */
export type TenantRootRestoreRegisteredManifestV1 = {
  readonly identityDigestB64u: string;
  readonly sourceCustodyLineageB64u: string;
  readonly recoverySetId: string;
  readonly stableRootCommitmentB64u: string;
  readonly deriverA: TenantRootRestoreRegisteredManifestRoleAV1;
  readonly deriverB: TenantRootRestoreRegisteredManifestRoleBV1;
  readonly deriverAPackageLength: number;
  readonly deriverAPackageDigestB64u: string;
  readonly deriverBPackageLength: number;
  readonly deriverBPackageDigestB64u: string;
  readonly manifestDigestB64u: string;
  readonly artifactCreatedAtIso: string;
  readonly trustLevel: TenantRootTrustLevelV1;
};

/** The verified descriptor and the exact bytes that produced its digest. */
export type TenantRootRestoreRegisteredManifestBundleV1 = {
  readonly descriptor: TenantRootRestoreRegisteredManifestV1;
  readonly manifestB64u: string;
};

/** One issued role import key. The private key never leaves the Deriver. */
export type TenantRootRestoreRoleImportKeyV1 = {
  readonly role: TenantRootDeriverRoleV1;
  readonly importKeyId: string;
  readonly importPublicKeyB64u: string;
  /** Monotonic per role; reissuing invalidates every lower generation. */
  readonly generation: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
};

/** One role share the destination installed, kept for exact replay. */
export type TenantRootRestoreInstalledImportV1 = {
  readonly role: TenantRootDeriverRoleV1;
  readonly envelopeDigestB64u: string;
  readonly receiptDigestB64u: string;
};

/** Why one restore step was refused. */
export type TenantRootRestoreErrorV1 =
  | { readonly kind: 'destination_not_empty' }
  | { readonly kind: 'session_in_progress' }
  | { readonly kind: 'session_start_conflict' }
  | { readonly kind: 'bootstrap_authentication_failed' }
  | { readonly kind: 'bootstrap_reauthentication_stale'; readonly ageMs: number }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'session_not_started' }
  | { readonly kind: 'manifest_not_registered' }
  | { readonly kind: 'manifest_already_registered' }
  | { readonly kind: 'manifest_is_for_another_tenant' }
  | { readonly kind: 'import_key_not_issued'; readonly role: TenantRootDeriverRoleV1 }
  | { readonly kind: 'import_key_expired'; readonly role: TenantRootDeriverRoleV1 }
  | { readonly kind: 'role_share_already_installed'; readonly role: TenantRootDeriverRoleV1 }
  | { readonly kind: 'restore_operation_id_reused' }
  | { readonly kind: 'restore_role_operation_pending' }
  | { readonly kind: 'restore_role_import_refused' }
  | { readonly kind: 'restore_role_import_unavailable' }
  | { readonly kind: 'restore_role_import_result_mismatch' }
  | { readonly kind: 'role_shares_incomplete'; readonly missingRole: TenantRootDeriverRoleV1 }
  | { readonly kind: 'trust_not_admitted'; readonly level: TenantRootTrustLevelV1['kind'] }
  | { readonly kind: 'offline_trust_acknowledgement_required' }
  | { readonly kind: 'root_commitment_mismatch' }
  | { readonly kind: 'forward_refresh_unverified' }
  | { readonly kind: 'continuity_canary_failed' }
  | { readonly kind: 'restore_refresh_grant_missing' }
  | { readonly kind: 'restore_refresh_grant_conflict' }
  | { readonly kind: 'restore_refresh_grant_expired' }
  | { readonly kind: 'cleanup_incomplete' };

/** One restore outcome and the event that records it. */
export type TenantRootRestoreOutcomeV1<T> =
  | { readonly ok: true; readonly value: T; readonly audit: TenantRootAuditEventV1 }
  | {
      readonly ok: false;
      readonly error: TenantRootRestoreErrorV1;
      readonly audit: TenantRootAuditEventV1;
    };

/**
 * Decides whether one trust result admits restore.
 *
 * A saved snapshot vouches for an artifact only if it was issued at or after
 * the artifact was created. Offline verification is admitted only with an
 * explicit acknowledgement that revocation status was unavailable, which the
 * activation receipt then preserves.
 */
export function admitRestoreTrustV1(input: {
  readonly level: TenantRootTrustLevelV1;
  readonly artifactCreatedAtIso: string;
  readonly offlineAcknowledged: boolean;
}): { readonly ok: true } | { readonly ok: false; readonly error: TenantRootRestoreErrorV1 } {
  switch (input.level.kind) {
    case 'current_trust_confirmed':
      return { ok: true };
    case 'valid_at_trust_snapshot': {
      const issued = Date.parse(input.level.snapshotIssuedAt);
      const created = Date.parse(input.artifactCreatedAtIso);
      if (Number.isNaN(issued) || Number.isNaN(created) || issued < created) {
        return { ok: false, error: { kind: 'trust_not_admitted', level: input.level.kind } };
      }
      return { ok: true };
    }
    case 'cryptographically_valid_offline':
      return input.offlineAcknowledged
        ? { ok: true }
        : { ok: false, error: { kind: 'offline_trust_acknowledgement_required' } };
  }
}

/** The destination state one restore request acts on. */
export type TenantRootRestoreContextV1 = {
  readonly orgId: string;
  readonly identityDigestB64u: string;
  readonly destination: TenantRootDestinationStateV1;
  /** This destination's own custody lineage, bound into every import key. */
  readonly destinationLineageB64u: string;
  readonly session: TenantRootRestoreSessionV1 | null;
  readonly registeredManifest: TenantRootRestoreRegisteredManifestBundleV1 | null;
  readonly importKeys: {
    readonly deriver_a: TenantRootRestoreRoleImportKeyV1 | null;
    readonly deriver_b: TenantRootRestoreRoleImportKeyV1 | null;
  };
  readonly installedImports: readonly TenantRootRestoreInstalledImportV1[];
};

/** Input authenticated by the destination before one session admission. */
export type TenantRootRestoreSessionStartAdmissionInputV1 = {
  readonly session: Extract<TenantRootRestoreSessionV1, { readonly status: 'awaiting_manifest' }>;
  readonly authenticatedSession: TenantRootRestoreBootstrapSessionV1;
  /** The session observed before the atomic admission attempt, if any. */
  readonly expectedSessionId: string | null;
  readonly nowMs: number;
};

/** Result of the single-winner restore session admission. */
export type TenantRootRestoreSessionStartAdmissionV1 =
  | { readonly kind: 'started' }
  | { readonly kind: 'replayed' }
  | { readonly kind: 'bootstrap_authentication_failed' }
  | { readonly kind: 'session_in_progress' }
  | { readonly kind: 'cleanup_incomplete' }
  | { readonly kind: 'session_start_conflict' };

/** Input for finalizing exactly one expired in-flight session. */
export type TenantRootRestoreExpiredSessionFinalizationInputV1 = {
  readonly expectedSessionId: string;
  readonly endedSession: Extract<
    TenantRootRestoreSessionV1,
    | { readonly status: 'expired' }
    | { readonly status: 'cleanup_incomplete'; readonly phase: 'pre_activation' }
  >;
  readonly nowMs: number;
};

/** Result of a conditional expiry finalization. */
export type TenantRootRestoreExpiredSessionFinalizationV1 =
  | { readonly kind: 'finalized' }
  | { readonly kind: 'stale' };

/** Result of checking whether an in-flight restore session is due for cleanup. */
export type TenantRootRestoreExpiryCheckV1 =
  | {
      readonly kind: 'finalized';
      readonly session: TenantRootRestoreExpiredSessionFinalizationInputV1['endedSession'];
      readonly audit: TenantRootAuditEventV1;
    }
  | { readonly kind: 'stale' }
  | { readonly kind: 'not_due' };

/** Public scope fields signed into one private restore refresh grant. */
export type TenantRootRestoreRefreshGrantScopeV1 = Omit<
  TenantRootRestoreRefreshGrantSigningInputV1,
  'grantKeyId' | 'signingSeedB64u'
>;

/** Result of atomically persisting one refresh grant and entering refreshing. */
export type TenantRootRestoreRefreshGrantAdmissionV1 =
  | { readonly kind: 'admitted'; readonly grant: SignedTenantRootRestoreRefreshGrantV1 }
  | { readonly kind: 'replayed'; readonly grant: SignedTenantRootRestoreRefreshGrantV1 }
  | { readonly kind: 'session_not_ready' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'expired' };

/** Persistence for one destination restore session. */
export interface TenantRootRestoreStoreV1 {
  readContext(): Promise<TenantRootRestoreContextV1>;
  admitSessionStart(
    input: TenantRootRestoreSessionStartAdmissionInputV1,
  ): Promise<TenantRootRestoreSessionStartAdmissionV1>;
  finalizeExpiredSession(
    input: TenantRootRestoreExpiredSessionFinalizationInputV1,
  ): Promise<TenantRootRestoreExpiredSessionFinalizationV1>;
  admitRestoreRefreshGrant(input: {
    readonly expectedSessionId: string;
    readonly grant: SignedTenantRootRestoreRefreshGrantV1;
    readonly nowMs: number;
  }): Promise<TenantRootRestoreRefreshGrantAdmissionV1>;
  readRestoreRefreshGrant(sessionId: string): Promise<SignedTenantRootRestoreRefreshGrantV1 | null>;
  putSession(session: TenantRootRestoreSessionV1): Promise<void>;
  putRegisteredManifest(
    manifest: TenantRootRestoreRegisteredManifestV1,
    manifestB64u: string,
  ): Promise<void>;
  putRoleImportKey(key: TenantRootRestoreRoleImportKeyV1): Promise<void>;
  finalizeRoleImport(input: {
    readonly sessionId: string;
    readonly key: TenantRootRestoreRoleImportKeyV1;
    readonly installed: TenantRootRestoreInstalledImportV1;
  }): Promise<
    | { readonly kind: 'finalized'; readonly session: TenantRootRestoreSessionV1 }
    | { readonly kind: 'stale' }
  >;
  /** Forgets the manifest, keys, and installed imports of a finished session. */
  clearSessionMaterial(): Promise<void>;
  putBootstrapSession(session: TenantRootRestoreBootstrapSessionV1): Promise<void>;
  findBootstrapSession(
    tokenDigestB64u: string,
  ): Promise<TenantRootRestoreBootstrapSessionV1 | null>;
}

/** The one control-plane operation used to verify and register a manifest. */
export interface TenantRootRestoreManifestRegistrarV1 {
  registerManifest(input: {
    readonly manifestB64u: string;
  }): Promise<TenantRootRestoreRegisteredManifestV1>;
}

/** The public result returned by the owning Deriver after durable issuance. */
export type TenantRootRestoreRoleImportKeyIssueResponseV1 = {
  readonly role: TenantRootDeriverRoleV1;
  readonly importKeyId: string;
  readonly importPublicKeyB64u: string;
  readonly generation: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly operationDigestB64u: string;
  readonly commandDigestB64u: string;
};

/** The restore-specific D1 operation boundary. */
export type TenantRootRestoreRoleImportKeyIssueAdmissionInputV1 = {
  readonly operationRecord: TenantRootRestoreRoleImportKeyIssueOperationRecordV1;
  readonly operationDigestB64u: string;
  readonly canonicalRecordJson: string;
  readonly authenticatedSession: TenantRootRestoreBootstrapSessionV1;
  readonly nowMs: number;
};

export type TenantRootRestoreRoleImportKeyIssueAdmissionV1 =
  | { readonly kind: 'admitted'; readonly entry: TenantRootOperationEntryV1 }
  | { readonly kind: 'replayed'; readonly entry: TenantRootOperationEntryV1 }
  | { readonly kind: 'idempotency_conflict' }
  | { readonly kind: 'role_operation_pending' }
  | { readonly kind: 'bootstrap_authentication_failed' }
  | { readonly kind: 'destination_not_empty' }
  | { readonly kind: 'session_not_started' }
  | { readonly kind: 'manifest_not_registered' }
  | { readonly kind: 'role_share_already_installed' }
  | { readonly kind: 'generation_conflict' };

export interface TenantRootRestoreRoleImportOperationStoreV1 {
  findRestoreRoleImportOperation(operationId: string): Promise<TenantRootOperationEntryV1 | null>;
  findRestoreRoleImportOperationForKey(
    role: TenantRootDeriverRoleV1,
    importKeyId: string,
  ): Promise<TenantRootOperationEntryV1 | null>;
  admitRestoreRoleImportOperation(
    input: TenantRootRestoreRoleImportKeyIssueAdmissionInputV1,
  ): Promise<TenantRootRestoreRoleImportKeyIssueAdmissionV1>;
  markRestoreRoleImportDispatchUncertain(
    operationId: string,
    atMs: number,
  ): Promise<TenantRootOperationEntryV1>;
  finalizeRestoreRoleImportOperation(input: {
    readonly entry: TenantRootOperationEntryV1;
    readonly response: TenantRootRestoreRoleImportKeyIssueResponseV1;
    readonly key: TenantRootRestoreRoleImportKeyV1;
  }): Promise<TenantRootOperationEntryV1>;
  failRestoreRoleImportOperation(
    operationId: string,
    failureCode: string,
  ): Promise<TenantRootOperationEntryV1>;
}

/** Control-plane operations a destination restore needs. */
export interface TenantRootRestoreControlPlaneV1 extends TenantRootRestoreManifestRegistrarV1 {
  /** Signs and dispatches one exact role-import operation to the Deriver. */
  issueRoleImportKey(input: {
    readonly operationRecord: TenantRootRestoreRoleImportKeyIssueOperationRecordV1;
    readonly manifestB64u: string;
  }): Promise<TenantRootRestoreRoleImportKeyIssueResponseV1>;
  acceptRoleImport(input: {
    readonly operationRecord: TenantRootRestoreRoleImportKeyIssueOperationRecordV1;
    readonly manifestB64u: string;
    readonly importEnvelopeB64u: string;
  }): Promise<{ readonly receiptDigestB64u: string }>;
  /** Signs one exact refresh scope locally; dispatch happens only after D1 admission. */
  issueRestoreRefreshGrant(
    input: TenantRootRestoreRefreshGrantScopeV1,
  ): Promise<SignedTenantRootRestoreRefreshGrantV1>;
  /**
   * Verifies the root commitment, runs the mandatory forward refresh and the
   * continuity canaries, activates the new epoch, and destroys the imported
   * material. Each of those steps returns its own receipt; an empty receipt
   * means the step did not prove itself, and activation is refused.
   */
  activate(input: {
    readonly grant: SignedTenantRootRestoreRefreshGrantV1;
    readonly manifestB64u: string;
  }): Promise<TenantRootRestoreActivationResultV1>;
  /** Removes imported shares and role keys after expiry or before activation. */
  cleanupSession(input: {
    readonly destinationIdentityDigestB64u: string;
    readonly destinationFingerprintB64u: string;
    readonly destinationLineageB64u: string;
    readonly nowMs: number;
    readonly restoreSessionId: string;
  }): Promise<TenantRootRestoreRoleCleanupV1>;
  /** Retries cleanup after activation without activating the root again. */
  cleanupActivatedRoot(input: {
    readonly restoreSessionId: string;
    readonly activationEvidence: TenantRootRestoreActivationEvidenceV1;
    readonly bootstrapCleanup: TenantRootRestoreBootstrapCleanupV1;
    readonly roleCleanup: TenantRootRestoreRoleCleanupV1;
  }): Promise<TenantRootRestoreCleanupEvidenceV1>;
}

/** SHA-256 over one text value, base64url. Used for tokens and envelopes. */
export async function tenantRootRestoreDigestB64uV1(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

function restoreAudit(
  context: TenantRootRestoreContextV1,
  input: { readonly actorUserId: string; readonly atIso: string },
  action: TenantRootAuditEventV1['action'],
  outcome: TenantRootAuditEventV1['outcome'],
  extra: {
    readonly role?: TenantRootDeriverRoleV1;
    readonly recoverySetId?: string;
    readonly receiptDigestB64u?: string;
    readonly failureCode?: string;
    readonly operationKind?: Exclude<
      TenantRootAuditEventV1['authorization']['operationKind'],
      null
    >;
    readonly operationDigestB64u?: string;
  } = {},
): TenantRootAuditEventV1 {
  return buildTenantRootAuditEventV1({
    action,
    outcome,
    atIso: input.atIso,
    orgId: context.orgId,
    actorUserId: input.actorUserId,
    identityDigestB64u: context.identityDigestB64u,
    custodyLineageB64u: context.destinationLineageB64u,
    lifecycleRevision: 1,
    ...(extra.operationKind === undefined ? {} : { operationKind: extra.operationKind }),
    ...(extra.operationDigestB64u === undefined
      ? {}
      : { operationDigestB64u: extra.operationDigestB64u }),
    ...extra,
  });
}

function isInFlight(session: TenantRootRestoreSessionV1 | null): session is Extract<
  TenantRootRestoreSessionV1,
  {
    readonly status:
      | 'awaiting_manifest'
      | 'awaiting_role_imports'
      | 'verifying'
      | 'ready_to_activate'
      | 'refreshing';
  }
> {
  return (
    session !== null &&
    (session.status === 'awaiting_manifest' ||
      session.status === 'awaiting_role_imports' ||
      session.status === 'verifying' ||
      session.status === 'ready_to_activate' ||
      session.status === 'refreshing')
  );
}

type TenantRootRestorePostActivationCleanupSessionV1 = Extract<
  TenantRootRestoreSessionV1,
  { readonly status: 'cleanup_incomplete'; readonly phase: 'post_activation' }
>;

type TenantRootRestoreCompleteCleanupEvidenceV1 = {
  readonly bootstrap: Extract<TenantRootRestoreBootstrapCleanupV1, { readonly kind: 'destroyed' }>;
  readonly roles: Extract<TenantRootRestoreRoleCleanupV1, { readonly kind: 'complete' }>;
};

function cleanupEvidenceIsComplete(
  cleanup: TenantRootRestoreCleanupEvidenceV1,
): cleanup is TenantRootRestoreCompleteCleanupEvidenceV1 {
  return cleanup.bootstrap.kind === 'destroyed' && cleanup.roles.kind === 'complete';
}

function mergeRoleCleanupEvidence(
  previous: TenantRootRestoreRoleCleanupV1,
  next: TenantRootRestoreRoleCleanupV1,
): TenantRootRestoreRoleCleanupV1 {
  if (previous.kind === 'complete' || next.kind === 'complete') {
    return previous.kind === 'complete' ? previous : next;
  }
  if (previous.kind === 'both_roles_incomplete') return next;
  if (previous.kind === 'deriver_a_incomplete') {
    if (next.kind === 'deriver_a_incomplete' || next.kind === 'both_roles_incomplete') {
      return {
        kind: 'deriver_a_incomplete',
        deriverBReceiptDigestB64u: previous.deriverBReceiptDigestB64u,
        outstanding: next.outstanding,
      };
    }
    return previous;
  }
  if (next.kind === 'deriver_b_incomplete' || next.kind === 'both_roles_incomplete') {
    return {
      kind: 'deriver_b_incomplete',
      deriverAReceiptDigestB64u: previous.deriverAReceiptDigestB64u,
      outstanding: next.outstanding,
    };
  }
  return previous;
}

function mergeCleanupEvidence(
  previous: TenantRootRestoreCleanupEvidenceV1,
  next: TenantRootRestoreCleanupEvidenceV1,
): TenantRootRestoreCleanupEvidenceV1 {
  return {
    bootstrap: previous.bootstrap.kind === 'destroyed' ? previous.bootstrap : next.bootstrap,
    roles: mergeRoleCleanupEvidence(previous.roles, next.roles),
  };
}

function sameRestoreSession(
  left: TenantRootRestoreSessionV1,
  right: TenantRootRestoreSessionV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameRestoreBootstrapSession(
  left: TenantRootRestoreBootstrapSessionV1,
  right: TenantRootRestoreBootstrapSessionV1,
): boolean {
  return (
    left.tokenDigestB64u === right.tokenDigestB64u &&
    left.actorUserId === right.actorUserId &&
    left.authenticatedAtMs === right.authenticatedAtMs &&
    left.expiresAtMs === right.expiresAtMs
  );
}

function canonicalNonzeroBase64Url(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return false;
  try {
    const bytes = base64UrlDecode(value);
    return (
      bytes.length === expectedBytes &&
      bytes.some((byte) => byte !== 0) &&
      base64UrlEncode(bytes) === value
    );
  } catch {
    return false;
  }
}

function canonicalIdentifier(value: unknown, maximumBytes = 256): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return false;
  return (
    new TextEncoder().encode(value).length <= maximumBytes &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    })
  );
}

function canonicalMilliseconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function exactIssueResultKeys(record: Record<string, unknown>): boolean {
  const keys = [
    'role',
    'importKeyId',
    'importPublicKeyB64u',
    'generation',
    'issuedAtMs',
    'expiresAtMs',
    'operationDigestB64u',
    'commandDigestB64u',
  ];
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

/** Parses the exact public result retained in an accepted operation row. */
export function parseTenantRootRestoreRoleImportKeyIssueResultV1(
  value: unknown,
): TenantRootRestoreRoleImportKeyIssueResponseV1 | null {
  if (!isPlainObject(value) || !exactIssueResultKeys(value)) return null;
  if (value.role !== 'deriver_a' && value.role !== 'deriver_b') return null;
  if (!canonicalIdentifier(value.importKeyId, 128)) return null;
  if (!canonicalNonzeroBase64Url(value.importPublicKeyB64u, 32)) return null;
  if (!canonicalNonzeroBase64Url(value.operationDigestB64u, 32)) return null;
  if (!canonicalNonzeroBase64Url(value.commandDigestB64u, 32)) return null;
  if (
    typeof value.generation !== 'number' ||
    !Number.isSafeInteger(value.generation) ||
    value.generation <= 0 ||
    !canonicalMilliseconds(value.issuedAtMs) ||
    !canonicalMilliseconds(value.expiresAtMs) ||
    value.expiresAtMs <= value.issuedAtMs
  ) {
    return null;
  }
  return {
    role: value.role,
    importKeyId: value.importKeyId,
    importPublicKeyB64u: value.importPublicKeyB64u,
    generation: value.generation,
    issuedAtMs: value.issuedAtMs,
    expiresAtMs: value.expiresAtMs,
    operationDigestB64u: value.operationDigestB64u,
    commandDigestB64u: value.commandDigestB64u,
  };
}

function randomNonzeroBase64Url(expectedBytes: 16 | 32): string {
  const bytes = new Uint8Array(expectedBytes);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes.every((byte) => byte === 0));
  return base64UrlEncode(bytes);
}

function restoreRefreshGrantScope(
  context: TenantRootRestoreContextV1,
  session: Extract<
    TenantRootRestoreSessionV1,
    { readonly status: 'verifying' | 'ready_to_activate' | 'refreshing' }
  >,
  manifest: TenantRootRestoreRegisteredManifestV1,
  nowMs: number,
): TenantRootRestoreRefreshGrantScopeV1 {
  return {
    operationDigestB64u: randomNonzeroBase64Url(32),
    destinationIdentityDigestB64u: context.identityDigestB64u,
    destinationFingerprintB64u: session.destinationFingerprintB64u,
    destinationLineageB64u: context.destinationLineageB64u,
    restoreSessionIdB64u: session.sessionId,
    manifestDigestB64u: manifest.manifestDigestB64u,
    deriverAAcceptanceReceiptDigestB64u: session.installationReceipts.deriverA,
    deriverBAcceptanceReceiptDigestB64u: session.installationReceipts.deriverB,
    nonceB64u: randomNonzeroBase64Url(32),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_LIFETIME_MS_V1,
  };
}

function refreshGrantMatchesRestoreScope(
  grant: SignedTenantRootRestoreRefreshGrantV1,
  context: TenantRootRestoreContextV1,
  session: Extract<
    TenantRootRestoreSessionV1,
    { readonly status: 'verifying' | 'ready_to_activate' | 'refreshing' }
  >,
  manifest: TenantRootRestoreRegisteredManifestV1,
): boolean {
  return (
    grant.destinationIdentityDigestB64u === context.identityDigestB64u &&
    grant.destinationFingerprintB64u === session.destinationFingerprintB64u &&
    grant.destinationLineageB64u === context.destinationLineageB64u &&
    grant.restoreSessionIdB64u === session.sessionId &&
    grant.manifestDigestB64u === manifest.manifestDigestB64u &&
    grant.deriverAAcceptanceReceiptDigestB64u === session.installationReceipts.deriverA &&
    grant.deriverBAcceptanceReceiptDigestB64u === session.installationReceipts.deriverB
  );
}

async function importKeyIdForOperationId(operationId: string): Promise<string> {
  const digest = await tenantRootRestoreDigestB64uV1(operationId);
  return `restore-import-${digest}`;
}

function restoreOperationRecordFromEntry(
  entry: TenantRootOperationEntryV1,
): TenantRootRestoreRoleImportKeyIssueOperationRecordV1 | null {
  const record = parseTenantRootOperationRecordV1(entry.canonicalRecordJson);
  return record?.operationKind === 'tenant_root_restore_role_import_key_issue_v1' ? record : null;
}

async function restoreOperationEntryMatchesRecord(
  entry: TenantRootOperationEntryV1,
  record: TenantRootRestoreRoleImportKeyIssueOperationRecordV1,
): Promise<boolean> {
  return (await tenantRootOperationDigestB64uV1(record)) === entry.operationDigestB64u;
}

function issueResultMatchesRecord(
  response: TenantRootRestoreRoleImportKeyIssueResponseV1,
  record: TenantRootRestoreRoleImportKeyIssueOperationRecordV1,
  operationDigestB64u: string,
): boolean {
  return (
    response.operationDigestB64u === operationDigestB64u &&
    response.role === record.role &&
    response.importKeyId === record.importKeyId &&
    response.generation === record.generation &&
    response.issuedAtMs === Date.parse(record.issuedAt) &&
    response.expiresAtMs === Date.parse(record.issuedAt) + TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_MS_V1
  );
}

function staleExpiryError(context: TenantRootRestoreContextV1): TenantRootRestoreErrorV1 {
  if (context.destination.kind !== 'empty') return { kind: 'destination_not_empty' };
  if (context.session === null) return { kind: 'session_not_started' };
  if (context.session.status === 'cleanup_incomplete') {
    return { kind: 'cleanup_incomplete' };
  }
  if (isInFlight(context.session)) return { kind: 'session_in_progress' };
  return { kind: 'session_expired' };
}

async function restoreAuthenticationIsLive(
  store: TenantRootRestoreStoreV1,
  authenticatedSession: TenantRootRestoreBootstrapSessionV1,
  nowMs: number,
): Promise<boolean> {
  const stored = await store.findBootstrapSession(authenticatedSession.tokenDigestB64u);
  return (
    stored !== null &&
    sameRestoreBootstrapSession(stored, authenticatedSession) &&
    stored.authenticatedAtMs <= nowMs &&
    stored.expiresAtMs > nowMs
  );
}

/**
 * Mints one administration session from a bootstrap credential the route has
 * already authenticated.
 *
 * The token handed back is the only thing later requests present; the store
 * keeps its digest, so a store read cannot yield a usable session.
 */
export async function mintRestoreBootstrapSessionV1(
  store: TenantRootRestoreStoreV1,
  input: {
    readonly actorUserId: string;
    readonly nowMs: number;
    readonly newSessionToken: () => string;
  },
): Promise<{ readonly sessionToken: string; readonly expiresAtMs: number }> {
  const sessionToken = input.newSessionToken();
  const expiresAtMs = input.nowMs + TENANT_ROOT_RESTORE_ADMIN_SESSION_MS_V1;
  await store.putBootstrapSession({
    tokenDigestB64u: await tenantRootRestoreDigestB64uV1(sessionToken),
    actorUserId: input.actorUserId,
    authenticatedAtMs: input.nowMs,
    expiresAtMs,
  });
  return { sessionToken, expiresAtMs };
}

/** Resolves one presented session token to a live administration session. */
export async function authenticateRestoreSessionV1(
  store: TenantRootRestoreStoreV1,
  input: { readonly sessionToken: string; readonly nowMs: number },
): Promise<TenantRootRestoreBootstrapSessionV1 | null> {
  const session = await store.findBootstrapSession(
    await tenantRootRestoreDigestB64uV1(input.sessionToken),
  );
  if (session === null || session.expiresAtMs <= input.nowMs) return null;
  return session;
}

function isRestoreCleanupDue(
  session: TenantRootRestoreSessionV1 | null,
  nowMs: number,
): session is Extract<TenantRootRestoreSessionV1, { readonly expiresAt: string }> {
  return (
    (isInFlight(session) ||
      (session?.status === 'cleanup_incomplete' && session.phase === 'pre_activation')) &&
    Date.parse(session.expiresAt) <= nowMs
  );
}

/**
 * Ends a session whose 24 hours have passed.
 *
 * The control plane removes imported shares and role keys; with both role
 * receipts the session is recorded as expired, without them as
 * cleanup-incomplete. Pre-activation expiry leaves bootstrap authority
 * available for a later restore session.
 * A stale read never reports a successful expiry: its caller must reload the
 * context before deciding whether the requested restore step can continue.
 */
export async function expireRestoreSessionIfDueV1(
  store: TenantRootRestoreStoreV1,
  controlPlane: Pick<TenantRootRestoreControlPlaneV1, 'cleanupSession'>,
  input: {
    readonly context: TenantRootRestoreContextV1;
    readonly actorUserId: string;
    readonly atIso: string;
    readonly nowMs: number;
  },
): Promise<TenantRootRestoreExpiryCheckV1> {
  const { context } = input;
  const session = context.session;
  if (!isRestoreCleanupDue(session, input.nowMs)) {
    return { kind: 'not_due' };
  }

  let cleanupResult: TenantRootRestoreRoleCleanupV1 | null = null;
  try {
    cleanupResult = await controlPlane.cleanupSession({
      destinationIdentityDigestB64u: context.identityDigestB64u,
      destinationFingerprintB64u: session.destinationFingerprintB64u,
      destinationLineageB64u: context.destinationLineageB64u,
      nowMs: input.nowMs,
      restoreSessionId: session.sessionId,
    });
  } catch {
    cleanupResult = null;
  }
  const cleanupReceiptsValue = cleanupResult?.kind === 'complete' ? cleanupResult.receipts : null;
  const ended: TenantRootRestoreSessionV1 =
    cleanupReceiptsValue === null
      ? {
          status: 'cleanup_incomplete',
          phase: 'pre_activation',
          sessionId: session.sessionId,
          expiresAt: session.expiresAt,
          destinationFingerprintB64u: session.destinationFingerprintB64u,
          outstanding:
            cleanupResult === null || cleanupResult.kind === 'complete'
              ? {
                  roles: ['deriver_a', 'deriver_b'],
                  description: 'imported shares and role import keys of an expired session',
                }
              : cleanupResult.outstanding,
        }
      : {
          status: 'expired',
          sessionId: session.sessionId,
          expiredAt: session.expiresAt,
          cleanupReceipts: cleanupReceiptsValue,
        };
  const finalized = await store.finalizeExpiredSession({
    expectedSessionId: session.sessionId,
    endedSession: ended,
    nowMs: input.nowMs,
  });
  if (finalized.kind === 'stale') return { kind: 'stale' };
  return {
    kind: 'finalized',
    session: ended,
    audit: restoreAudit(
      context,
      input,
      'restore_session_expired',
      cleanupReceiptsValue === null ? 'failure' : 'success',
      cleanupReceiptsValue === null ? { failureCode: 'cleanup_incomplete' } : {},
    ),
  };
}

/** Starts one restore session on an empty destination. */
export async function startRestoreSessionV1(
  store: TenantRootRestoreStoreV1,
  controlPlane: Pick<TenantRootRestoreControlPlaneV1, 'cleanupSession'>,
  input: {
    readonly sessionId: string;
    readonly authenticatedSession: TenantRootRestoreBootstrapSessionV1;
    readonly atIso: string;
    readonly nowMs: number;
  },
): Promise<TenantRootRestoreOutcomeV1<TenantRootRestoreSessionV1>> {
  const auditInput = {
    actorUserId: input.authenticatedSession.actorUserId,
    atIso: input.atIso,
  };
  let context = await store.readContext();
  if (context.destination.kind !== 'empty') {
    return {
      ok: false,
      error: { kind: 'destination_not_empty' },
      audit: restoreAudit(context, auditInput, 'restore_session_started', 'failure', {
        failureCode: 'destination_not_empty',
      }),
    };
  }

  if (!(await restoreAuthenticationIsLive(store, input.authenticatedSession, input.nowMs))) {
    return {
      ok: false,
      error: { kind: 'bootstrap_authentication_failed' },
      audit: restoreAudit(context, auditInput, 'restore_session_started', 'failure', {
        failureCode: 'bootstrap_authentication_failed',
      }),
    };
  }

  if (isRestoreCleanupDue(context.session, input.nowMs)) {
    await expireRestoreSessionIfDueV1(store, controlPlane, {
      context,
      actorUserId: input.authenticatedSession.actorUserId,
      atIso: input.atIso,
      nowMs: input.nowMs,
    });
    context = await store.readContext();
  }
  if (context.destination.kind !== 'empty') {
    return {
      ok: false,
      error: { kind: 'destination_not_empty' },
      audit: restoreAudit(context, auditInput, 'restore_session_started', 'failure', {
        failureCode: 'destination_not_empty',
      }),
    };
  }
  if (context.session?.status === 'cleanup_incomplete') {
    return {
      ok: false,
      error: { kind: 'cleanup_incomplete' },
      audit: restoreAudit(context, auditInput, 'restore_session_started', 'failure', {
        failureCode: 'cleanup_incomplete',
      }),
    };
  }
  const destination = context.destination;
  const deploymentFingerprintB64u = destination.deploymentFingerprintB64u;
  const session: TenantRootRestoreSessionV1 = {
    status: 'awaiting_manifest',
    sessionId: input.sessionId,
    expiresAt: new Date(input.nowMs + TENANT_ROOT_RESTORE_SESSION_MS_V1).toISOString(),
    destinationFingerprintB64u: deploymentFingerprintB64u,
  };
  if (isInFlight(context.session)) {
    const error = sameRestoreSession(context.session, session)
      ? null
      : { kind: 'session_in_progress' as const };
    if (error === null) {
      return {
        ok: true,
        value: context.session,
        audit: restoreAudit(context, auditInput, 'restore_session_started', 'success'),
      };
    }
    return {
      ok: false,
      error,
      audit: restoreAudit(context, auditInput, 'restore_session_started', 'failure', {
        failureCode: error.kind,
      }),
    };
  }
  const admission = await store.admitSessionStart({
    session,
    authenticatedSession: input.authenticatedSession,
    expectedSessionId: context.session?.sessionId ?? null,
    nowMs: input.nowMs,
  });
  switch (admission.kind) {
    case 'started':
    case 'replayed':
      return {
        ok: true,
        value: session,
        audit: restoreAudit(context, auditInput, 'restore_session_started', 'success'),
      };
    case 'bootstrap_authentication_failed':
      return {
        ok: false,
        error: { kind: 'bootstrap_authentication_failed' },
        audit: restoreAudit(context, auditInput, 'restore_session_started', 'failure', {
          failureCode: 'bootstrap_authentication_failed',
        }),
      };
    case 'session_in_progress':
      return {
        ok: false,
        error: { kind: 'session_in_progress' },
        audit: restoreAudit(context, auditInput, 'restore_session_started', 'failure', {
          failureCode: 'session_in_progress',
        }),
      };
    case 'cleanup_incomplete':
      return {
        ok: false,
        error: { kind: 'cleanup_incomplete' },
        audit: restoreAudit(context, auditInput, 'restore_session_started', 'failure', {
          failureCode: 'cleanup_incomplete',
        }),
      };
    case 'session_start_conflict':
      return {
        ok: false,
        error: { kind: 'session_start_conflict' },
        audit: restoreAudit(context, auditInput, 'restore_session_started', 'failure', {
          failureCode: 'session_start_conflict',
        }),
      };
  }
}

/** Binds one public recovery manifest to the session. */
export async function registerRestoreManifestV1(
  store: TenantRootRestoreStoreV1,
  controlPlane: TenantRootRestoreManifestRegistrarV1 &
    Pick<TenantRootRestoreControlPlaneV1, 'cleanupSession'>,
  input: {
    readonly manifestB64u: string;
    readonly actorUserId: string;
    readonly atIso: string;
    readonly nowMs: number;
  },
): Promise<TenantRootRestoreOutcomeV1<TenantRootRestoreSessionV1>> {
  const context = await store.readContext();
  const fail = (
    error: TenantRootRestoreErrorV1,
  ): TenantRootRestoreOutcomeV1<TenantRootRestoreSessionV1> => ({
    ok: false,
    error,
    audit: restoreAudit(context, input, 'restore_session_started', 'failure', {
      failureCode: error.kind,
    }),
  });
  const expiration = await expireRestoreSessionIfDueV1(store, controlPlane, { context, ...input });
  if (expiration.kind === 'finalized') {
    return fail({ kind: 'session_expired' });
  }
  if (expiration.kind === 'stale') {
    const current = await store.readContext();
    const error = staleExpiryError(current);
    return {
      ok: false,
      error,
      audit: restoreAudit(current, input, 'restore_session_started', 'failure', {
        failureCode: error.kind,
      }),
    };
  }
  const session = context.session;
  if (session === null || !isInFlight(session)) return fail({ kind: 'session_not_started' });
  if (session.status !== 'awaiting_manifest') {
    if (
      session.status === 'awaiting_role_imports' &&
      context.registeredManifest?.manifestB64u === input.manifestB64u
    ) {
      return {
        ok: true,
        value: session,
        audit: restoreAudit(context, input, 'restore_session_started', 'success', {
          recoverySetId: session.recoverySetId,
          receiptDigestB64u: context.registeredManifest.descriptor.manifestDigestB64u,
        }),
      };
    }
    return fail({ kind: 'manifest_already_registered' });
  }

  const registered = await controlPlane.registerManifest({ manifestB64u: input.manifestB64u });
  if (registered.identityDigestB64u !== context.identityDigestB64u) {
    // A manifest for another tenant, project, environment, or signing root can
    // never be rebound to this destination.
    return fail({ kind: 'manifest_is_for_another_tenant' });
  }
  await store.putRegisteredManifest(registered, input.manifestB64u);
  const next: TenantRootRestoreSessionV1 = {
    status: 'awaiting_role_imports',
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    destinationFingerprintB64u: session.destinationFingerprintB64u,
    recoverySetId: registered.recoverySetId,
    installed: { kind: 'neither_installed' },
  };
  await store.putSession(next);
  return {
    ok: true,
    value: next,
    audit: restoreAudit(context, input, 'restore_session_started', 'success', {
      recoverySetId: registered.recoverySetId,
      receiptDigestB64u: registered.manifestDigestB64u,
    }),
  };
}

/** The binding a CLI reseals one share against. */
export type TenantRootRestoreImportKeyIssuanceV1 = TenantRootRestoreRoleImportKeyV1 & {
  readonly destinationFingerprintB64u: string;
  readonly destinationLineageB64u: string;
  readonly restoreSessionId: string;
  readonly operationId: string;
  readonly operationDigestB64u: string;
  readonly commandDigestB64u: string;
  readonly replayed: boolean;
};

function issueFailure(
  context: TenantRootRestoreContextV1,
  input: {
    readonly role: TenantRootDeriverRoleV1;
    readonly actorUserId: string;
    readonly atIso: string;
  },
  error: TenantRootRestoreErrorV1,
  outcome: TenantRootAuditEventV1['outcome'] = 'failure',
): TenantRootRestoreOutcomeV1<TenantRootRestoreImportKeyIssuanceV1> {
  return {
    ok: false,
    error,
    audit: restoreAudit(context, input, 'restore_role_import_rejected', outcome, {
      role: input.role,
      failureCode: error.kind,
    }),
  };
}

function issueSuccess(
  context: TenantRootRestoreContextV1,
  input: {
    readonly role: TenantRootDeriverRoleV1;
    readonly actorUserId: string;
    readonly atIso: string;
  },
  key: TenantRootRestoreRoleImportKeyV1,
  operation: TenantRootOperationEntryV1,
  record: TenantRootRestoreRoleImportKeyIssueOperationRecordV1,
  response: TenantRootRestoreRoleImportKeyIssueResponseV1,
  replayed: boolean,
): TenantRootRestoreOutcomeV1<TenantRootRestoreImportKeyIssuanceV1> {
  return {
    ok: true,
    value: {
      ...key,
      destinationFingerprintB64u: record.destinationFingerprintB64u,
      destinationLineageB64u: record.custodyLineageId,
      restoreSessionId: record.restoreSessionIdB64u,
      operationId: operation.idempotencyKey,
      operationDigestB64u: response.operationDigestB64u,
      commandDigestB64u: response.commandDigestB64u,
      replayed,
    },
    audit: restoreAudit(context, input, 'restore_role_import_accepted', 'success', {
      role: input.role,
      recoverySetId: record.subject.recoverySetId,
      receiptDigestB64u: response.commandDigestB64u,
      operationKind: operation.operationKind,
      operationDigestB64u: operation.operationDigestB64u,
    }),
  };
}

function operationError(
  role: TenantRootDeriverRoleV1,
  admission: Exclude<
    TenantRootRestoreRoleImportKeyIssueAdmissionV1,
    { readonly kind: 'admitted' } | { readonly kind: 'replayed' }
  >,
): TenantRootRestoreErrorV1 {
  switch (admission.kind) {
    case 'idempotency_conflict':
      return { kind: 'restore_operation_id_reused' };
    case 'role_operation_pending':
      return { kind: 'restore_role_operation_pending' };
    case 'bootstrap_authentication_failed':
      return { kind: 'bootstrap_authentication_failed' };
    case 'destination_not_empty':
      return { kind: 'destination_not_empty' };
    case 'session_not_started':
      return { kind: 'session_not_started' };
    case 'manifest_not_registered':
      return { kind: 'manifest_not_registered' };
    case 'role_share_already_installed':
      return { kind: 'role_share_already_installed', role };
    case 'generation_conflict':
      return { kind: 'restore_role_import_unavailable' };
  }
}

async function buildRestoreRoleImportOperationRecordV1(
  context: TenantRootRestoreContextV1,
  identity: TenantRootIdentityV1,
  input: {
    readonly role: TenantRootDeriverRoleV1;
    readonly operationId: string;
    readonly actorUserId: string;
    readonly nowMs: number;
  },
): Promise<
  | {
      readonly ok: true;
      readonly record: TenantRootRestoreRoleImportKeyIssueOperationRecordV1;
      readonly operationDigestB64u: string;
      readonly canonicalRecordJson: string;
    }
  | { readonly ok: false; readonly error: TenantRootRestoreErrorV1 }
> {
  const manifestBundle = context.registeredManifest;
  const session = context.session;
  if (manifestBundle === null) {
    return { ok: false, error: { kind: 'manifest_not_registered' } };
  }
  const manifest = manifestBundle.descriptor;
  if (session === null || session.status !== 'awaiting_role_imports') {
    return { ok: false, error: { kind: 'session_not_started' } };
  }
  const identityDigestB64u = await tenantRootIdentityDigestB64uV1(identity);
  if (identity.orgId !== context.orgId || identityDigestB64u !== context.identityDigestB64u) {
    return { ok: false, error: { kind: 'restore_role_import_unavailable' } };
  }
  const generation = context.importKeys[input.role]?.generation ?? 0;
  const importKeyId = await importKeyIdForOperationId(input.operationId);
  const issuedAt = new Date(input.nowMs).toISOString();
  const expiresAt = new Date(
    input.nowMs + TENANT_ROOT_RESTORE_ROLE_IMPORT_MAX_LIFETIME_MS_V1,
  ).toISOString();
  const built = buildTenantRootOperationRecordV1({
    operationKind: 'tenant_root_restore_role_import_key_issue_v1',
    identity,
    tenantRootIdentityDigest: context.identityDigestB64u,
    custodyLineageId: context.destinationLineageB64u,
    subject: { kind: 'recovery_set', recoverySetId: manifest.recoverySetId },
    role: input.role,
    requesterActorId: input.actorUserId,
    idempotencyKey: input.operationId,
    nonceB64u: randomNonzeroBase64Url(32),
    issuedAt,
    expiresAt,
    manifestDigestB64u: manifest.manifestDigestB64u,
    destinationFingerprintB64u: session.destinationFingerprintB64u,
    restoreSessionIdB64u: session.sessionId,
    importKeyId,
    generation: generation + 1,
  });
  if (!built.ok || built.record.operationKind !== 'tenant_root_restore_role_import_key_issue_v1') {
    return {
      ok: false,
      error: { kind: 'restore_role_import_unavailable' },
    };
  }
  const operationDigestB64u = await tenantRootOperationDigestB64uV1(built.record);
  return {
    ok: true,
    record: built.record,
    operationDigestB64u,
    canonicalRecordJson: canonicalTenantRootOperationRecordJsonV1(built.record),
  };
}

/** Issues one role import key through the durable restore outbox. */
export async function issueRestoreRoleImportKeyV1(
  store: TenantRootRestoreStoreV1 & TenantRootRestoreRoleImportOperationStoreV1,
  controlPlane: Pick<TenantRootRestoreControlPlaneV1, 'cleanupSession' | 'issueRoleImportKey'>,
  input: {
    readonly role: TenantRootDeriverRoleV1;
    readonly operationId: string;
    readonly identity: TenantRootIdentityV1;
    readonly authenticatedSession: TenantRootRestoreBootstrapSessionV1;
    readonly actorUserId: string;
    readonly atIso: string;
    readonly nowMs: number;
  },
): Promise<TenantRootRestoreOutcomeV1<TenantRootRestoreImportKeyIssuanceV1>> {
  let context = await store.readContext();

  const existing = await store.findRestoreRoleImportOperation(input.operationId);
  let operation: TenantRootOperationEntryV1 | null = null;
  let operationRecord: TenantRootRestoreRoleImportKeyIssueOperationRecordV1 | null = null;
  let replayed = false;
  if (!(await restoreAuthenticationIsLive(store, input.authenticatedSession, input.nowMs))) {
    return issueFailure(context, input, { kind: 'bootstrap_authentication_failed' });
  }
  if (input.actorUserId !== input.authenticatedSession.actorUserId) {
    return issueFailure(context, input, { kind: 'bootstrap_authentication_failed' });
  }
  if (existing !== null) {
    const existingRecord = restoreOperationRecordFromEntry(existing);
    if (
      existingRecord === null ||
      existingRecord.role !== input.role ||
      existingRecord.requesterActorId !== input.authenticatedSession.actorUserId
    ) {
      return issueFailure(context, input, { kind: 'restore_operation_id_reused' });
    }
    if (!(await restoreOperationEntryMatchesRecord(existing, existingRecord))) {
      return issueFailure(context, input, { kind: 'restore_role_import_unavailable' }, 'pending');
    }
    if (existing.status === 'accepted') {
      if (existing.acceptedResultJson === null)
        return issueFailure(context, input, { kind: 'restore_role_import_unavailable' });
      let parsed: unknown;
      try {
        parsed = JSON.parse(existing.acceptedResultJson);
      } catch {
        parsed = null;
      }
      const response = parseTenantRootRestoreRoleImportKeyIssueResultV1(parsed);
      if (
        response === null ||
        !issueResultMatchesRecord(response, existingRecord, existing.operationDigestB64u)
      ) {
        return issueFailure(context, input, { kind: 'restore_role_import_unavailable' });
      }
      const key: TenantRootRestoreRoleImportKeyV1 = {
        role: response.role,
        importKeyId: response.importKeyId,
        importPublicKeyB64u: response.importPublicKeyB64u,
        generation: response.generation,
        issuedAtMs: response.issuedAtMs,
        expiresAtMs: response.expiresAtMs,
      };
      return issueSuccess(context, input, key, existing, existingRecord, response, true);
    }
    if (existing.status === 'failed' || existing.status === 'authorization_expired') {
      return issueFailure(context, input, { kind: 'restore_role_import_refused' });
    }
    operation = existing;
    operationRecord = existingRecord;
    replayed = true;
  }

  // A pending dispatch is the durable source of truth. Give the Deriver an
  // exact replay opportunity before expiry cleanup can erase its bindings.
  if (existing === null) {
    const expiration = await expireRestoreSessionIfDueV1(store, controlPlane, {
      context,
      ...input,
    });
    if (expiration.kind === 'finalized') {
      return issueFailure(context, input, { kind: 'session_expired' });
    }
    if (expiration.kind === 'stale') {
      context = await store.readContext();
      return issueFailure(context, input, staleExpiryError(context));
    }
  }

  const session = context.session;
  if (session === null || !isInFlight(session)) {
    return existing === null
      ? issueFailure(context, input, { kind: 'session_not_started' })
      : issueFailure(context, input, { kind: 'restore_role_import_unavailable' }, 'pending');
  }
  if (session.status === 'awaiting_manifest') {
    return existing === null
      ? issueFailure(context, input, { kind: 'manifest_not_registered' })
      : issueFailure(context, input, { kind: 'restore_role_import_unavailable' }, 'pending');
  }
  if (
    session.status !== 'awaiting_role_imports' ||
    context.installedImports.some((installed) => installed.role === input.role)
  ) {
    return existing === null
      ? issueFailure(context, input, { kind: 'role_share_already_installed', role: input.role })
      : issueFailure(context, input, { kind: 'restore_role_import_unavailable' }, 'pending');
  }
  const currentManifest = context.registeredManifest;
  if (
    currentManifest === null ||
    currentManifest.descriptor.manifestDigestB64u === '' ||
    (operationRecord !== null &&
      (operationRecord.restoreSessionIdB64u !== session.sessionId ||
        operationRecord.destinationFingerprintB64u !== session.destinationFingerprintB64u ||
        operationRecord.subject.recoverySetId !== session.recoverySetId ||
        operationRecord.manifestDigestB64u !== currentManifest.descriptor.manifestDigestB64u ||
        operationRecord.custodyLineageId !== context.destinationLineageB64u ||
        operationRecord.tenantRootIdentityDigest !== context.identityDigestB64u))
  ) {
    return issueFailure(context, input, { kind: 'restore_role_import_unavailable' }, 'pending');
  }
  if (operation === null || operationRecord === null) {
    const built = await buildRestoreRoleImportOperationRecordV1(context, input.identity, {
      ...input,
      actorUserId: input.authenticatedSession.actorUserId,
    });
    if (!built.ok) return issueFailure(context, input, built.error);
    const admission = await store.admitRestoreRoleImportOperation({
      operationRecord: built.record,
      operationDigestB64u: built.operationDigestB64u,
      canonicalRecordJson: built.canonicalRecordJson,
      authenticatedSession: input.authenticatedSession,
      nowMs: input.nowMs,
    });
    if (admission.kind !== 'admitted' && admission.kind !== 'replayed') {
      return issueFailure(context, input, operationError(input.role, admission));
    }
    operation = admission.entry;
    operationRecord = restoreOperationRecordFromEntry(operation);
    replayed = admission.kind === 'replayed';
    if (
      operationRecord === null ||
      !(await restoreOperationEntryMatchesRecord(operation, operationRecord))
    ) {
      return issueFailure(context, input, { kind: 'restore_role_import_unavailable' }, 'pending');
    }
  }
  if (operation.status === 'accepted') {
    if (operation.acceptedResultJson === null)
      return issueFailure(context, input, { kind: 'restore_role_import_unavailable' });
    let parsed: unknown;
    try {
      parsed = JSON.parse(operation.acceptedResultJson);
    } catch {
      parsed = null;
    }
    const response = parseTenantRootRestoreRoleImportKeyIssueResultV1(parsed);
    if (
      response === null ||
      operationRecord === null ||
      !issueResultMatchesRecord(response, operationRecord, operation.operationDigestB64u)
    ) {
      return issueFailure(context, input, { kind: 'restore_role_import_unavailable' });
    }
    const key: TenantRootRestoreRoleImportKeyV1 = {
      role: response.role,
      importKeyId: response.importKeyId,
      importPublicKeyB64u: response.importPublicKeyB64u,
      generation: response.generation,
      issuedAtMs: response.issuedAtMs,
      expiresAtMs: response.expiresAtMs,
    };
    return issueSuccess(context, input, key, operation, operationRecord, response, true);
  }
  const registeredManifest = context.registeredManifest;
  if (registeredManifest === null) {
    return issueFailure(context, input, { kind: 'restore_role_import_unavailable' }, 'pending');
  }

  try {
    await store.markRestoreRoleImportDispatchUncertain(operation.operationId, input.nowMs);
    const response = await controlPlane.issueRoleImportKey({
      operationRecord,
      manifestB64u: registeredManifest.manifestB64u,
    });
    if (
      !parseTenantRootRestoreRoleImportKeyIssueResultV1(response) ||
      !issueResultMatchesRecord(response, operationRecord, operation.operationDigestB64u)
    ) {
      return issueFailure(
        context,
        input,
        { kind: 'restore_role_import_result_mismatch' },
        'pending',
      );
    }
    const key: TenantRootRestoreRoleImportKeyV1 = {
      role: response.role,
      importKeyId: response.importKeyId,
      importPublicKeyB64u: response.importPublicKeyB64u,
      generation: response.generation,
      issuedAtMs: response.issuedAtMs,
      expiresAtMs: response.expiresAtMs,
    };
    await store.finalizeRestoreRoleImportOperation({ entry: operation, response, key });
    return issueSuccess(context, input, key, operation, operationRecord, response, replayed);
  } catch {
    return issueFailure(context, input, { kind: 'restore_role_import_unavailable' }, 'pending');
  }
}

/**
 * Accepts one role's destination-encrypted import envelope.
 *
 * The destination role accepts one exact envelope. Repeating the same bytes
 * returns the existing installation receipt; different bytes for a role that
 * already installed are a conflict. The envelope must be for the current,
 * live import key of its role.
 */
export async function importRestoreRoleShareV1(
  store: TenantRootRestoreStoreV1 & TenantRootRestoreRoleImportOperationStoreV1,
  controlPlane: TenantRootRestoreControlPlaneV1,
  input: {
    readonly role: TenantRootDeriverRoleV1;
    readonly importEnvelopeB64u: string;
    readonly authenticatedSession: TenantRootRestoreBootstrapSessionV1;
    readonly actorUserId: string;
    readonly atIso: string;
    readonly nowMs: number;
  },
): Promise<
  TenantRootRestoreOutcomeV1<{
    readonly session: TenantRootRestoreSessionV1;
    readonly receiptDigestB64u: string;
    readonly replayed: boolean;
  }>
> {
  const context = await store.readContext();
  const fail = (
    error: TenantRootRestoreErrorV1,
  ): TenantRootRestoreOutcomeV1<{
    readonly session: TenantRootRestoreSessionV1;
    readonly receiptDigestB64u: string;
    readonly replayed: boolean;
  }> => ({
    ok: false,
    error,
    audit: restoreAudit(context, input, 'restore_role_import_rejected', 'failure', {
      role: input.role,
      failureCode: error.kind,
    }),
  });
  if (
    !(await restoreAuthenticationIsLive(store, input.authenticatedSession, input.nowMs)) ||
    input.actorUserId !== input.authenticatedSession.actorUserId
  ) {
    return fail({ kind: 'bootstrap_authentication_failed' });
  }
  const expiration = await expireRestoreSessionIfDueV1(store, controlPlane, { context, ...input });
  if (expiration.kind === 'finalized') {
    return fail({ kind: 'session_expired' });
  }
  if (expiration.kind === 'stale') {
    const current = await store.readContext();
    const error = staleExpiryError(current);
    return {
      ok: false,
      error,
      audit: restoreAudit(current, input, 'restore_role_import_rejected', 'failure', {
        role: input.role,
        failureCode: error.kind,
      }),
    };
  }
  const session = context.session;
  if (session === null || !isInFlight(session)) return fail({ kind: 'session_not_started' });
  if (session.status === 'awaiting_manifest') return fail({ kind: 'manifest_not_registered' });

  const envelopeDigestB64u = await tenantRootRestoreDigestB64uV1(input.importEnvelopeB64u);
  const installed = context.installedImports.find((entry) => entry.role === input.role);
  if (installed !== undefined) {
    if (installed.envelopeDigestB64u === envelopeDigestB64u) {
      // Exact replay: the receipt already proves the installed share.
      return {
        ok: true,
        value: { session, receiptDigestB64u: installed.receiptDigestB64u, replayed: true },
        audit: restoreAudit(context, input, 'restore_role_import_accepted', 'success', {
          role: input.role,
          receiptDigestB64u: installed.receiptDigestB64u,
        }),
      };
    }
    return fail({ kind: 'role_share_already_installed', role: input.role });
  }
  if (session.status !== 'awaiting_role_imports') {
    return fail({ kind: 'role_share_already_installed', role: input.role });
  }

  const key = context.importKeys[input.role];
  if (key === null) return fail({ kind: 'import_key_not_issued', role: input.role });
  // The Deriver reconciles a previously accepted envelope before checking key expiry.

  const entry = await store.findRestoreRoleImportOperationForKey(input.role, key.importKeyId);
  const operationRecord = entry === null ? null : restoreOperationRecordFromEntry(entry);
  const manifest = context.registeredManifest;
  if (
    entry === null ||
    entry.status !== 'accepted' ||
    operationRecord === null ||
    manifest === null ||
    operationRecord.restoreSessionIdB64u !== session.sessionId ||
    operationRecord.manifestDigestB64u !== manifest.descriptor.manifestDigestB64u ||
    operationRecord.destinationFingerprintB64u !== session.destinationFingerprintB64u ||
    !(await restoreOperationEntryMatchesRecord(entry, operationRecord))
  ) {
    return fail({ kind: 'restore_role_import_unavailable' });
  }
  let accepted: { readonly receiptDigestB64u: string };
  let finalized: Awaited<ReturnType<TenantRootRestoreStoreV1['finalizeRoleImport']>>;
  try {
    accepted = await controlPlane.acceptRoleImport({
      operationRecord,
      manifestB64u: manifest.manifestB64u,
      importEnvelopeB64u: input.importEnvelopeB64u,
    });
    finalized = await store.finalizeRoleImport({
      sessionId: session.sessionId,
      key,
      installed: {
        role: input.role,
        envelopeDigestB64u,
        receiptDigestB64u: accepted.receiptDigestB64u,
      },
    });
  } catch {
    return {
      ok: false,
      error: { kind: 'restore_role_import_unavailable' },
      audit: restoreAudit(context, input, 'restore_role_import_rejected', 'pending', {
        role: input.role,
        failureCode: 'restore_role_import_unavailable',
      }),
    };
  }
  if (finalized.kind === 'stale') return fail({ kind: 'restore_role_import_unavailable' });
  const next = finalized.session;
  return {
    ok: true,
    value: { session: next, receiptDigestB64u: accepted.receiptDigestB64u, replayed: false },
    audit: restoreAudit(context, input, 'restore_role_import_accepted', 'success', {
      role: input.role,
      receiptDigestB64u: accepted.receiptDigestB64u,
    }),
  };
}

/** What the tenant chooses about the source; the server fills in who and when. */
export type TenantRootSourceDispositionChoiceV1 =
  | { readonly kind: 'retained_as_backup'; readonly incidentResponseNote?: string }
  | {
      readonly kind: 'unavailable_retirement_unverified';
      readonly attemptedChecks: readonly string[];
    };

/** Activation evidence and cleanup progress returned by the control plane. */
export type TenantRootRestoreActivationResultV1 = {
  readonly activationReceiptB64u: string;
  readonly destinationLineageId: string;
  readonly activatedEpoch: number;
  readonly activationReceiptDigestB64u: string;
  readonly forwardRefreshReceiptDigestB64u: string;
  readonly continuityCanaryReceiptDigestB64u: string;
  readonly rootCommitmentMatches: boolean;
  readonly cleanup: TenantRootRestoreCleanupEvidenceV1;
};

function restoreActivationFailure(
  context: TenantRootRestoreContextV1,
  input: { readonly actorUserId: string; readonly atIso: string },
  error: TenantRootRestoreErrorV1,
): TenantRootRestoreOutcomeV1<TenantRootRestoreSessionV1> {
  return {
    ok: false,
    error,
    audit: restoreAudit(context, input, 'restore_root_activated', 'failure', {
      failureCode: error.kind,
    }),
  };
}

function sourceCustodyDispositionFromChoice(
  choice: TenantRootSourceDispositionChoiceV1,
  actorUserId: string,
  atIso: string,
): TenantRootSourceCustodyDispositionV1 {
  return choice.kind === 'retained_as_backup'
    ? defaultSourceCustodyDispositionV1({
        acknowledgedByUserId: actorUserId,
        recordedAtIso: atIso,
        ...(choice.incidentResponseNote === undefined
          ? {}
          : { incidentResponseNote: choice.incidentResponseNote }),
      })
    : {
        kind: 'unavailable_retirement_unverified',
        attemptedChecks: choice.attemptedChecks,
        recordedByUserId: actorUserId,
        recordedAt: atIso,
      };
}

function activationEvidenceFromResult(
  session: Extract<
    TenantRootRestoreSessionV1,
    { readonly status: 'verifying' | 'ready_to_activate' | 'refreshing' }
  >,
  manifest: TenantRootRestoreRegisteredManifestV1,
  result: TenantRootRestoreActivationResultV1,
  sourceDisposition: TenantRootSourceCustodyDispositionV1,
): TenantRootRestoreActivationEvidenceV1 {
  return {
    rootCommitmentB64u: manifest.stableRootCommitmentB64u,
    destinationFingerprintB64u: session.destinationFingerprintB64u,
    destinationLineageId: result.destinationLineageId,
    activatedEpoch: result.activatedEpoch,
    activationReceiptB64u: result.activationReceiptB64u,
    activationReceiptDigestB64u: result.activationReceiptDigestB64u,
    forwardRefreshReceiptDigestB64u: result.forwardRefreshReceiptDigestB64u,
    continuityCanaryReceiptDigestB64u: result.continuityCanaryReceiptDigestB64u,
    sourceDisposition,
    tenantHeldRecoverySet: {
      recoverySetId: session.recoverySetId,
      manifestDigestB64u: manifest.manifestDigestB64u,
    },
  };
}

function activeSessionFromCleanup(
  sessionId: string,
  activationEvidence: TenantRootRestoreActivationEvidenceV1,
  cleanup: TenantRootRestoreCompleteCleanupEvidenceV1,
): Extract<TenantRootRestoreSessionV1, { readonly status: 'active' }> {
  return {
    rootCommitmentB64u: activationEvidence.rootCommitmentB64u,
    status: 'active',
    sessionId,
    destinationFingerprintB64u: activationEvidence.destinationFingerprintB64u,
    destinationLineageId: activationEvidence.destinationLineageId,
    activatedEpoch: activationEvidence.activatedEpoch,
    activationReceiptDigestB64u: activationEvidence.activationReceiptDigestB64u,
    forwardRefreshReceiptDigestB64u: activationEvidence.forwardRefreshReceiptDigestB64u,
    continuityCanaryReceiptDigestB64u: activationEvidence.continuityCanaryReceiptDigestB64u,
    bootstrapDestructionReceiptDigestB64u: cleanup.bootstrap.receiptDigestB64u,
    sourceDisposition: activationEvidence.sourceDisposition,
    tenantHeldRecoverySet: activationEvidence.tenantHeldRecoverySet,
  };
}

function postActivationCleanupSessionFromEvidence(
  sessionId: string,
  activationEvidence: TenantRootRestoreActivationEvidenceV1,
  cleanup: TenantRootRestoreCleanupEvidenceV1,
): TenantRootRestorePostActivationCleanupSessionV1 {
  return {
    status: 'cleanup_incomplete',
    phase: 'post_activation',
    sessionId,
    activationEvidence,
    bootstrapCleanup: cleanup.bootstrap,
    roleCleanup: cleanup.roles,
  };
}

function postActivationCleanupRequest(
  session: TenantRootRestorePostActivationCleanupSessionV1,
): Parameters<TenantRootRestoreControlPlaneV1['cleanupActivatedRoot']>[0] {
  return {
    restoreSessionId: session.sessionId,
    activationEvidence: session.activationEvidence,
    bootstrapCleanup: session.bootstrapCleanup,
    roleCleanup: session.roleCleanup,
  };
}

async function retryPostActivationCleanupV1(
  store: TenantRootRestoreStoreV1,
  controlPlane: Pick<TenantRootRestoreControlPlaneV1, 'cleanupActivatedRoot'>,
  context: TenantRootRestoreContextV1,
  session: TenantRootRestorePostActivationCleanupSessionV1,
  input: {
    readonly actorUserId: string;
    readonly atIso: string;
  },
): Promise<TenantRootRestoreOutcomeV1<TenantRootRestoreSessionV1>> {
  let cleanup: TenantRootRestoreCleanupEvidenceV1;
  try {
    cleanup = await controlPlane.cleanupActivatedRoot(postActivationCleanupRequest(session));
  } catch {
    return {
      ok: false,
      error: { kind: 'cleanup_incomplete' },
      audit: restoreAudit(context, input, 'restore_material_destroyed', 'failure', {
        recoverySetId: session.activationEvidence.tenantHeldRecoverySet.recoverySetId,
        failureCode: 'cleanup_incomplete',
      }),
    };
  }
  const mergedCleanup = mergeCleanupEvidence(
    {
      bootstrap: session.bootstrapCleanup,
      roles: session.roleCleanup,
    },
    cleanup,
  );
  if (!cleanupEvidenceIsComplete(mergedCleanup)) {
    const incomplete = postActivationCleanupSessionFromEvidence(
      session.sessionId,
      session.activationEvidence,
      mergedCleanup,
    );
    await store.putSession(incomplete);
    return {
      ok: false,
      error: { kind: 'cleanup_incomplete' },
      audit: restoreAudit(context, input, 'restore_material_destroyed', 'failure', {
        recoverySetId: session.activationEvidence.tenantHeldRecoverySet.recoverySetId,
        failureCode: 'cleanup_incomplete',
      }),
    };
  }
  const active = activeSessionFromCleanup(
    session.sessionId,
    session.activationEvidence,
    mergedCleanup,
  );
  await store.putSession(active);
  await store.clearSessionMaterial();
  return {
    ok: true,
    value: active,
    audit: restoreAudit(context, input, 'restore_material_destroyed', 'success', {
      recoverySetId: session.activationEvidence.tenantHeldRecoverySet.recoverySetId,
      receiptDigestB64u: mergedCleanup.roles.receipts.deriverA,
    }),
  };
}

/**
 * Verifies, forward-refreshes, and activates the restored root.
 *
 * The trust result is what manifest registration established. The
 * acknowledging actor and every timestamp are the authenticated actor and the
 * server clock. Nothing here fences, retires, or revokes the source: a
 * surviving source is still a valid custodian of the same root, and saying
 * otherwise would be a false security claim.
 */
export async function activateRestoredRootV1(
  store: TenantRootRestoreStoreV1,
  controlPlane: TenantRootRestoreControlPlaneV1,
  input: {
    readonly offlineTrustAcknowledged: boolean;
    readonly sourceDisposition: TenantRootSourceDispositionChoiceV1;
    readonly authenticatedSession: TenantRootRestoreBootstrapSessionV1;
    readonly actorUserId: string;
    readonly atIso: string;
    readonly nowMs: number;
  },
): Promise<TenantRootRestoreOutcomeV1<TenantRootRestoreSessionV1>> {
  const context = await store.readContext();
  if (
    !(await restoreAuthenticationIsLive(store, input.authenticatedSession, input.nowMs)) ||
    input.actorUserId !== input.authenticatedSession.actorUserId
  ) {
    return restoreActivationFailure(context, input, { kind: 'bootstrap_authentication_failed' });
  }

  if (context.session?.status === 'active') {
    await store.clearSessionMaterial();
    return {
      ok: true,
      value: context.session,
      audit: restoreAudit(context, input, 'restore_root_activated', 'success', {
        recoverySetId: context.session.tenantHeldRecoverySet.recoverySetId,
        receiptDigestB64u: context.session.activationReceiptDigestB64u,
      }),
    };
  }

  if (context.session?.status === 'cleanup_incomplete') {
    if (context.session.phase === 'post_activation') {
      return await retryPostActivationCleanupV1(
        store,
        controlPlane,
        context,
        context.session,
        input,
      );
    }
    return restoreActivationFailure(context, input, { kind: 'cleanup_incomplete' });
  }

  const expiration = await expireRestoreSessionIfDueV1(store, controlPlane, { context, ...input });
  if (expiration.kind === 'finalized') {
    return restoreActivationFailure(context, input, { kind: 'session_expired' });
  }
  if (expiration.kind === 'stale') {
    const current = await store.readContext();
    const error = staleExpiryError(current);
    return {
      ok: false,
      error,
      audit: restoreAudit(current, input, 'restore_root_activated', 'failure', {
        failureCode: error.kind,
      }),
    };
  }
  const session = context.session;
  if (session === null || !isInFlight(session))
    return restoreActivationFailure(context, input, { kind: 'session_not_started' });
  if (session.status === 'awaiting_manifest')
    return restoreActivationFailure(context, input, { kind: 'manifest_not_registered' });
  if (session.status === 'awaiting_role_imports') {
    const missingRole: TenantRootDeriverRoleV1 =
      session.installed.kind === 'deriver_a_installed' ? 'deriver_b' : 'deriver_a';
    return restoreActivationFailure(context, input, {
      kind: 'role_shares_incomplete',
      missingRole,
    });
  }

  const reauthAgeMs = input.nowMs - input.authenticatedSession.authenticatedAtMs;
  if (reauthAgeMs < 0 || reauthAgeMs > TENANT_ROOT_ACTIVATION_REAUTH_MAX_AGE_MS_V1) {
    return restoreActivationFailure(context, input, {
      kind: 'bootstrap_reauthentication_stale',
      ageMs: reauthAgeMs,
    });
  }

  const manifestBundle = context.registeredManifest;
  if (
    manifestBundle === null ||
    manifestBundle.descriptor.recoverySetId !== session.recoverySetId
  ) {
    return restoreActivationFailure(context, input, { kind: 'manifest_not_registered' });
  }
  const manifest = manifestBundle.descriptor;
  const admitted = admitRestoreTrustV1({
    level: manifest.trustLevel,
    artifactCreatedAtIso: manifest.artifactCreatedAtIso,
    offlineAcknowledged: input.offlineTrustAcknowledged,
  });
  if (!admitted.ok) return restoreActivationFailure(context, input, admitted.error);

  let refreshGrant: SignedTenantRootRestoreRefreshGrantV1;
  if (session.status === 'refreshing') {
    const persisted = await store.readRestoreRefreshGrant(session.sessionId);
    if (persisted === null) {
      return restoreActivationFailure(context, input, { kind: 'restore_refresh_grant_missing' });
    }
    if (!refreshGrantMatchesRestoreScope(persisted, context, session, manifest)) {
      return restoreActivationFailure(context, input, { kind: 'restore_refresh_grant_conflict' });
    }
    refreshGrant = persisted;
  } else {
    const issued = await controlPlane.issueRestoreRefreshGrant(
      restoreRefreshGrantScope(context, session, manifest, input.nowMs),
    );
    const admission = await store.admitRestoreRefreshGrant({
      expectedSessionId: session.sessionId,
      grant: issued,
      nowMs: input.nowMs,
    });
    switch (admission.kind) {
      case 'admitted':
      case 'replayed':
        refreshGrant = admission.grant;
        break;
      case 'expired':
        return restoreActivationFailure(context, input, {
          kind: 'restore_refresh_grant_expired',
        });
      case 'conflict':
        return restoreActivationFailure(context, input, {
          kind: 'restore_refresh_grant_conflict',
        });
      case 'session_not_ready':
        return restoreActivationFailure(context, input, {
          kind: 'restore_refresh_grant_conflict',
        });
    }
  }

  const activated = await controlPlane.activate({
    grant: refreshGrant,
    manifestB64u: manifestBundle.manifestB64u,
  });
  if (!activated.rootCommitmentMatches) {
    return restoreActivationFailure(context, input, { kind: 'root_commitment_mismatch' });
  }
  // Decision 14: activation is the forward refresh and the canaries, not a
  // flag. A control plane that skipped either has no receipt to show, and
  // the session stays where it is so the operator can retry.
  if (activated.forwardRefreshReceiptDigestB64u.trim() === '') {
    return restoreActivationFailure(context, input, { kind: 'forward_refresh_unverified' });
  }
  if (activated.continuityCanaryReceiptDigestB64u.trim() === '') {
    return restoreActivationFailure(context, input, { kind: 'continuity_canary_failed' });
  }
  const activationEvidence = activationEvidenceFromResult(
    session,
    manifest,
    activated,
    sourceCustodyDispositionFromChoice(input.sourceDisposition, input.actorUserId, input.atIso),
  );
  if (!cleanupEvidenceIsComplete(activated.cleanup)) {
    const incomplete = postActivationCleanupSessionFromEvidence(
      session.sessionId,
      activationEvidence,
      activated.cleanup,
    );
    await store.putSession(incomplete);
    return {
      ok: false,
      error: { kind: 'cleanup_incomplete' },
      audit: restoreAudit(context, input, 'restore_material_destroyed', 'failure', {
        recoverySetId: session.recoverySetId,
        failureCode: 'cleanup_incomplete',
      }),
    };
  }
  const active = activeSessionFromCleanup(session.sessionId, activationEvidence, activated.cleanup);
  await store.putSession(active);
  await store.clearSessionMaterial();
  return {
    ok: true,
    value: active,
    audit: restoreAudit(
      context,
      input,
      manifest.trustLevel.kind === 'cryptographically_valid_offline'
        ? 'offline_trust_acknowledged'
        : 'restore_root_activated',
      'success',
      {
        recoverySetId: session.recoverySetId,
        receiptDigestB64u: activated.activationReceiptDigestB64u,
      },
    ),
  };
}

/** The disposition a restore uses unless the tenant chooses otherwise. */
export function defaultSourceCustodyDispositionV1(input: {
  readonly acknowledgedByUserId: string;
  readonly recordedAtIso: string;
  readonly incidentResponseNote?: string;
}): TenantRootSourceCustodyDispositionV1 {
  return {
    kind: 'retained_as_backup',
    acknowledgedByUserId: input.acknowledgedByUserId,
    incidentResponseNote:
      input.incidentResponseNote ??
      'The source deployment may still hold usable shares and remains in the incident-response model.',
    recordedAt: input.recordedAtIso,
  };
}
