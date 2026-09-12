import type {
  TenantRootDeriverRoleV1,
  TenantRootOperationKindV1,
} from '@seams-internal/wallet-console-shared/tenant-root';

/**
 * Audit events for tenant derivation-root custody.
 *
 * Every action and every rejection emits exactly one event, and a failed
 * mutation never suppresses its event — an operation that was attempted and
 * refused is precisely what an incident review needs to see.
 *
 * Redaction is enforced by an allowlist rather than a denylist of suspicious
 * names. A denylist silently admits whatever a future field happens to be
 * called; an allowlist fails closed on anything new.
 */

/** What happened. */
export type TenantRootAuditActionV1 =
  | 'recovery_governance_selected'
  | 'recovery_governance_changed'
  | 'approval_capability_issued'
  | 'approval_capability_rejected'
  | 'approval_capability_consumed'
  | 'approval_capability_replayed'
  | 'cli_enrollment_approved'
  | 'cli_enrollment_denied'
  | 'recovery_recipient_challenge_issued'
  | 'recovery_recipient_enrolled'
  | 'recovery_recipient_pair_committed'
  | 'recovery_backup_created'
  | 'recovery_backup_replaced'
  | 'recovery_role_package_download_issued'
  | 'recovery_manifest_download_issued'
  | 'recovery_artifact_durably_verified'
  | 'offline_trust_acknowledged'
  | 'rotation_requested'
  | 'rotation_activated'
  | 'rotation_retired'
  | 'rotation_failed'
  | 'restore_session_started'
  | 'restore_session_expired'
  | 'restore_role_import_accepted'
  | 'restore_role_import_rejected'
  | 'restore_root_activated'
  | 'restore_material_destroyed'
  | 'source_custody_disposition_recorded';

/** Writes one redacted audit event. */
export interface TenantRootAuditWriterV1 {
  write(event: TenantRootAuditEventV1): Promise<void>;
}

/** Outcome observed for the action. */
export type TenantRootAuditOutcomeV1 = 'success' | 'failure' | 'pending';

/** What authorized the action. */
export type TenantRootAuditAuthorizationV1 = {
  readonly stepUpMethod: string | null;
  readonly approverUserId: string | null;
  readonly operationKind: TenantRootOperationKindV1 | null;
  readonly operationDigestB64u: string | null;
};

/** One redacted audit event. */
export type TenantRootAuditEventV1 = {
  readonly action: TenantRootAuditActionV1;
  readonly outcome: TenantRootAuditOutcomeV1;
  readonly atIso: string;
  readonly orgId: string;
  readonly actorUserId: string;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly lifecycleRevision: number;
  readonly role: TenantRootDeriverRoleV1 | null;
  readonly recoverySetId: string | null;
  readonly receiptDigestB64u: string | null;
  readonly failureCode: string | null;
  readonly authorization: TenantRootAuditAuthorizationV1;
};

const EVENT_FIELDS: ReadonlySet<string> = new Set([
  'action',
  'outcome',
  'atIso',
  'orgId',
  'actorUserId',
  'identityDigestB64u',
  'custodyLineageB64u',
  'lifecycleRevision',
  'role',
  'recoverySetId',
  'receiptDigestB64u',
  'failureCode',
  'authorization',
]);

const AUTHORIZATION_FIELDS: ReadonlySet<string> = new Set([
  'stepUpMethod',
  'approverUserId',
  'operationKind',
  'operationDigestB64u',
]);

/**
 * The longest a single audit value may be.
 *
 * A base64url SHA-256 digest is 43 characters. This cap leaves room for
 * identifiers while refusing anything large enough to carry a package, a
 * manifest, or an encrypted share.
 */
export const TENANT_ROOT_AUDIT_MAX_VALUE_LENGTH_V1 = 128;

/** Why an event failed its redaction check. */
export type TenantRootAuditRedactionErrorV1 =
  | { readonly kind: 'unexpected_field'; readonly path: string }
  | { readonly kind: 'value_too_long'; readonly path: string; readonly length: number }
  | { readonly kind: 'unsupported_value_type'; readonly path: string };

/** Result of one redaction check. */
export type TenantRootAuditRedactionResultV1 =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly TenantRootAuditRedactionErrorV1[] };

const ROTATION_AUDIT_ACTIONS_V1: ReadonlySet<TenantRootAuditActionV1> = new Set([
  'rotation_requested',
  'rotation_activated',
  'rotation_retired',
  'rotation_failed',
]);

/**
 * Returns a stable persistence identity for a correlated rotation event.
 *
 * Other audit actions keep the console service's generated IDs: recovery
 * events can legitimately repeat for one recovery set or receipt.
 */
export function tenantRootAuditEventPersistenceIdV1(
  event: TenantRootAuditEventV1,
): string | undefined {
  if (!ROTATION_AUDIT_ACTIONS_V1.has(event.action)) return undefined;
  const operationDigestB64u = event.authorization.operationDigestB64u;
  if (operationDigestB64u === null || operationDigestB64u === '') return undefined;
  return [
    'tenant-root-audit-v1',
    event.action,
    event.outcome,
    event.identityDigestB64u,
    event.custodyLineageB64u,
    event.role ?? 'root',
    operationDigestB64u,
    event.failureCode ?? 'none',
  ].join(':');
}

function checkValue(path: string, value: unknown, errors: TenantRootAuditRedactionErrorV1[]): void {
  if (value === null) return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      errors.push({ kind: 'unsupported_value_type', path });
    }
    return;
  }
  if (typeof value !== 'string') {
    errors.push({ kind: 'unsupported_value_type', path });
    return;
  }
  if (value.length > TENANT_ROOT_AUDIT_MAX_VALUE_LENGTH_V1) {
    errors.push({ kind: 'value_too_long', path, length: value.length });
  }
}

/**
 * Checks that one event carries only the allowed public fields.
 *
 * This runs before an event is written, so a new field added to the event
 * builder without being added here fails loudly rather than shipping a value
 * nobody reviewed.
 */
export function checkTenantRootAuditEventRedactionV1(
  event: unknown,
): TenantRootAuditRedactionResultV1 {
  const errors: TenantRootAuditRedactionErrorV1[] = [];
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, errors: [{ kind: 'unsupported_value_type', path: '' }] };
  }
  for (const [key, value] of Object.entries(event)) {
    if (!EVENT_FIELDS.has(key)) {
      errors.push({ kind: 'unexpected_field', path: key });
      continue;
    }
    if (key === 'authorization') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push({ kind: 'unsupported_value_type', path: key });
        continue;
      }
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (!AUTHORIZATION_FIELDS.has(nestedKey)) {
          errors.push({ kind: 'unexpected_field', path: `authorization.${nestedKey}` });
          continue;
        }
        checkValue(`authorization.${nestedKey}`, nestedValue, errors);
      }
      continue;
    }
    checkValue(key, value, errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Everything one audit event is built from. */
export type TenantRootAuditEventInputV1 = {
  readonly action: TenantRootAuditActionV1;
  readonly outcome: TenantRootAuditOutcomeV1;
  readonly atIso: string;
  readonly orgId: string;
  readonly actorUserId: string;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly lifecycleRevision: number;
  readonly role?: TenantRootDeriverRoleV1;
  readonly recoverySetId?: string;
  readonly receiptDigestB64u?: string;
  readonly failureCode?: string;
  readonly stepUpMethod?: string;
  readonly approverUserId?: string;
  readonly operationKind?: TenantRootOperationKindV1;
  readonly operationDigestB64u?: string;
};

/** Builds one redacted audit event. */
export function buildTenantRootAuditEventV1(
  input: TenantRootAuditEventInputV1,
): TenantRootAuditEventV1 {
  return {
    action: input.action,
    outcome: input.outcome,
    atIso: input.atIso,
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    identityDigestB64u: input.identityDigestB64u,
    custodyLineageB64u: input.custodyLineageB64u,
    lifecycleRevision: input.lifecycleRevision,
    role: input.role ?? null,
    recoverySetId: input.recoverySetId ?? null,
    receiptDigestB64u: input.receiptDigestB64u ?? null,
    failureCode: input.failureCode ?? null,
    authorization: {
      stepUpMethod: input.stepUpMethod ?? null,
      approverUserId: input.approverUserId ?? null,
      operationKind: input.operationKind ?? null,
      operationDigestB64u: input.operationDigestB64u ?? null,
    },
  };
}

/**
 * Returns the audit action one operation kind records.
 *
 * Every operation in the union maps to an action, so an operation cannot be
 * added without deciding what it audits.
 */
export function tenantRootAuditActionForOperationV1(
  kind: TenantRootOperationKindV1,
): TenantRootAuditActionV1 {
  switch (kind) {
    case 'tenant_root_operational_share_rotation_v1':
      return 'rotation_requested';
    case 'tenant_root_recovery_governance_change_v1':
      return 'recovery_governance_changed';
    case 'tenant_root_recovery_recipient_pair_enroll_v1':
      return 'recovery_recipient_enrolled';
    case 'tenant_root_recovery_recipient_pair_replace_v1':
      return 'recovery_recipient_pair_committed';
    case 'tenant_root_recovery_backup_create_v1':
      return 'recovery_backup_created';
    case 'tenant_root_recovery_backup_replace_v1':
      return 'recovery_backup_replaced';
    case 'tenant_root_recovery_role_package_download_v1':
      return 'recovery_role_package_download_issued';
    case 'tenant_root_recovery_manifest_download_v1':
      return 'recovery_manifest_download_issued';
    case 'tenant_root_restore_session_start_v1':
      return 'restore_session_started';
    case 'tenant_root_restore_manifest_register_v1':
      return 'restore_session_started';
    case 'tenant_root_restore_role_import_key_issue_v1':
      return 'restore_role_import_accepted';
    case 'tenant_root_restore_role_import_v1':
      return 'restore_role_import_accepted';
    case 'tenant_root_restore_activate_v1':
      return 'restore_root_activated';
    case 'tenant_root_source_lineage_retire_v1':
      return 'source_custody_disposition_recorded';
  }
}
