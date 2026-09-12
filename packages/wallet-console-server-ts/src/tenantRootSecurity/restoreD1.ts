import { decodeTenantRootIdentityWireV1 } from '@seams-internal/shared-ts/tenant-root';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import {
  base64UrlDecode,
  base64UrlEncode,
  d1ChangedRows,
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
  type D1ResultLike,
  type D1Row,
} from '@seams/wallet-server/cloud-host';
import type {
  TenantRootDeriverRoleV1,
  TenantRootOutstandingCleanupV1,
  TenantRootRestoreActivationEvidenceV1,
  TenantRootRestoreBootstrapCleanupV1,
  TenantRootRestoreCleanupEvidenceV1,
  TenantRootRestoreRoleCleanupV1,
  TenantRootRoleImportProgressV1,
  TenantRootRoleReceiptsV1,
  TenantRootSourceCustodyDispositionV1,
  TenantRootTenantHeldExternalRecoverySetV1,
  TenantRootTrustLevelV1,
} from '@seams-internal/shared-ts/tenant-root';
import { isPlainObject } from '@seams-internal/shared-ts/utils/validation';
import type {
  TenantRootDestinationStateV1,
  TenantRootRestoreBootstrapSessionV1,
  TenantRootRestoreContextV1,
  TenantRootRestoreExpiredSessionFinalizationInputV1,
  TenantRootRestoreExpiredSessionFinalizationV1,
  TenantRootRestoreInstalledImportV1,
  TenantRootRestoreRegisteredManifestBundleV1,
  TenantRootRestoreRegisteredManifestV1,
  TenantRootRestoreRoleImportKeyV1,
  TenantRootRestoreRoleImportKeyIssueAdmissionInputV1,
  TenantRootRestoreRoleImportKeyIssueAdmissionV1,
  TenantRootRestoreRoleImportKeyIssueResponseV1,
  TenantRootRestoreRoleImportOperationStoreV1,
  TenantRootRestoreRefreshGrantAdmissionV1,
  TenantRootRestoreSessionStartAdmissionInputV1,
  TenantRootRestoreSessionStartAdmissionV1,
  TenantRootRestoreStoreV1,
} from './restoreService';
import {
  TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_LIFETIME_MS_V1,
  type SignedTenantRootRestoreRefreshGrantV1,
} from './restoreRefreshGrantSigner';
import type { TenantRootRestoreSessionV1 } from '@seams-internal/shared-ts/tenant-root';
import type { TenantRootOperationEntryV1, TenantRootOperationStoreV1 } from './service';
import { createD1TenantRootOperationStoreV1 } from './d1';

/**
 * D1 persistence for one destination restore context.
 *
 * The destination reader is the live authority for whether this deployment
 * is empty or already holds a root. A persisted active session cannot replace
 * that check; disagreement fails closed. The interface has no compare-and-swap
 * token, so callers must serialize restore transitions at the route/control-
 * plane boundary.
 */
export interface D1TenantRootRestoreStoreOptionsV1 {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly identityDigestB64u: string;
  /** Reads current destination state from the authoritative control plane. */
  readonly readDestination: () => Promise<TenantRootDestinationStateV1>;
  readonly destinationLineageB64u: string;
  readonly now?: () => number;
}

type RestoreScope = {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly identityDigestB64u: string;
  readonly destinationLineageB64u: string;
  readonly now: () => number;
};

type ParsedImportKeys = {
  readonly deriver_a: TenantRootRestoreRoleImportKeyV1 | null;
  readonly deriver_b: TenantRootRestoreRoleImportKeyV1 | null;
};

type ParsedRestoreStateRow = {
  readonly session: TenantRootRestoreSessionV1 | null;
  readonly registeredManifest: TenantRootRestoreRegisteredManifestBundleV1 | null;
};

const TENANT_ROOT_RECOVERY_PACKAGE_MAX_BYTES_V1 = 16 * 1024;
const TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1 = 16 * 1024;
const TENANT_ROOT_RESTORE_REFRESH_GRANT_KEY_ID_MAX_BYTES_V1 = 256;

function systemNow(): number {
  return Date.now();
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.length > 0 && value.trim() === value
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return parsed;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  const parsed = requiredInteger(value, label);
  if (parsed <= 0) throw new Error(`tenant-root restore ${label} is invalid`);
  return parsed;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return value;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function parseJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return requiredRecord(parsed, label);
}

function recordValue(record: Record<string, unknown>, key: string, label: string): unknown {
  if (!Object.hasOwn(record, key))
    throw new Error(`tenant-root restore ${label}.${key} is missing`);
  return record[key];
}

function recordText(record: Record<string, unknown>, key: string, label: string): string {
  return requiredText(recordValue(record, key, label), `${label}.${key}`);
}

function recordPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  return requiredPositiveInteger(recordValue(record, key, label), `${label}.${key}`);
}

function recordCanonicalBase64Url(
  record: Record<string, unknown>,
  key: string,
  expectedBytes: number,
  label: string,
): string {
  const value = recordText(record, key, label);
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`tenant-root restore ${label}.${key} is invalid`);
  }
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(value);
  } catch {
    throw new Error(`tenant-root restore ${label}.${key} is invalid`);
  }
  if (decoded.length !== expectedBytes || base64UrlEncode(decoded) !== value) {
    throw new Error(`tenant-root restore ${label}.${key} is invalid`);
  }
  return value;
}

function recordCanonicalNonzeroBase64Url(
  record: Record<string, unknown>,
  key: string,
  expectedBytes: number,
  label: string,
): string {
  const value = recordCanonicalBase64Url(record, key, expectedBytes, label);
  const bytes = base64UrlDecode(value);
  if (bytes.every((byte) => byte === 0)) {
    throw new Error(`tenant-root restore ${label}.${key} is invalid`);
  }
  return value;
}

function canonicalNonzeroBase64Url(value: unknown, expectedBytes: number, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(value);
  } catch {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  if (
    bytes.length !== expectedBytes ||
    bytes.every((byte) => byte === 0) ||
    base64UrlEncode(bytes) !== value
  ) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return value;
}

function canonicalGrantBytes(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(value);
  } catch {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  if (
    bytes.length === 0 ||
    bytes.length > TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1 ||
    base64UrlEncode(bytes) !== value
  ) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return value;
}

function canonicalGrantKeyId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error('tenant-root restore refresh grant key id is invalid');
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > TENANT_ROOT_RESTORE_REFRESH_GRANT_KEY_ID_MAX_BYTES_V1) {
    throw new Error('tenant-root restore refresh grant key id is invalid');
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      throw new Error('tenant-root restore refresh grant key id is invalid');
    }
  }
  return value;
}

const SIGNED_RESTORE_REFRESH_GRANT_KEYS = [
  'operationDigestB64u',
  'destinationIdentityDigestB64u',
  'destinationFingerprintB64u',
  'destinationLineageB64u',
  'restoreSessionIdB64u',
  'manifestDigestB64u',
  'deriverAAcceptanceReceiptDigestB64u',
  'deriverBAcceptanceReceiptDigestB64u',
  'nonceB64u',
  'grantKeyId',
  'grantB64u',
  'grantDigestB64u',
  'issuedAtMs',
  'expiresAtMs',
] as const;

function hasExactSignedGrantKeys(value: Record<string, unknown>): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === SIGNED_RESTORE_REFRESH_GRANT_KEYS.length &&
    SIGNED_RESTORE_REFRESH_GRANT_KEYS.every((key) => actual.includes(key))
  );
}

async function validateSignedRestoreRefreshGrant(
  value: SignedTenantRootRestoreRefreshGrantV1,
): Promise<void> {
  if (!isPlainObject(value) || !hasExactSignedGrantKeys(value)) {
    throw new Error('tenant-root restore refresh grant is invalid');
  }
  canonicalNonzeroBase64Url(value.operationDigestB64u, 32, 'refresh grant operation digest');
  canonicalNonzeroBase64Url(
    value.destinationIdentityDigestB64u,
    32,
    'refresh grant destination identity digest',
  );
  canonicalNonzeroBase64Url(
    value.destinationFingerprintB64u,
    32,
    'refresh grant destination fingerprint',
  );
  canonicalNonzeroBase64Url(value.destinationLineageB64u, 16, 'refresh grant destination lineage');
  canonicalNonzeroBase64Url(value.restoreSessionIdB64u, 16, 'refresh grant session id');
  canonicalNonzeroBase64Url(value.manifestDigestB64u, 32, 'refresh grant manifest digest');
  const deriverAAcceptanceReceiptDigestB64u = canonicalNonzeroBase64Url(
    value.deriverAAcceptanceReceiptDigestB64u,
    32,
    'refresh grant Deriver A receipt digest',
  );
  const deriverBAcceptanceReceiptDigestB64u = canonicalNonzeroBase64Url(
    value.deriverBAcceptanceReceiptDigestB64u,
    32,
    'refresh grant Deriver B receipt digest',
  );
  if (deriverAAcceptanceReceiptDigestB64u === deriverBAcceptanceReceiptDigestB64u) {
    throw new Error('tenant-root restore refresh grant receipt digests must differ');
  }
  canonicalNonzeroBase64Url(value.nonceB64u, 32, 'refresh grant nonce');
  canonicalGrantKeyId(value.grantKeyId);
  const grantB64u = canonicalGrantBytes(value.grantB64u, 'refresh grant bytes');
  const grantDigestB64u = canonicalNonzeroBase64Url(
    value.grantDigestB64u,
    32,
    'refresh grant digest',
  );
  const issuedAtMs = requiredPositiveInteger(value.issuedAtMs, 'refresh grant issue time');
  const expiresAtMs = requiredPositiveInteger(value.expiresAtMs, 'refresh grant expiry');
  if (
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_LIFETIME_MS_V1
  ) {
    throw new Error('tenant-root restore refresh grant time window is invalid');
  }
  const grantBytes = base64UrlDecode(grantB64u);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', grantBytes));
  if (base64UrlEncode(digest) !== grantDigestB64u) {
    throw new Error('tenant-root restore refresh grant digest does not match its bytes');
  }
}

function parseRestoreRefreshGrantRow(row: D1Row): SignedTenantRootRestoreRefreshGrantV1 {
  return {
    operationDigestB64u: canonicalNonzeroBase64Url(
      row.operation_digest_b64u,
      32,
      'refresh grant operation digest',
    ),
    destinationIdentityDigestB64u: canonicalNonzeroBase64Url(
      row.destination_identity_digest_b64u,
      32,
      'refresh grant destination identity digest',
    ),
    destinationFingerprintB64u: canonicalNonzeroBase64Url(
      row.destination_fingerprint_b64u,
      32,
      'refresh grant destination fingerprint',
    ),
    destinationLineageB64u: canonicalNonzeroBase64Url(
      row.grant_destination_lineage_b64u,
      16,
      'refresh grant destination lineage',
    ),
    restoreSessionIdB64u: canonicalNonzeroBase64Url(
      row.grant_session_id_b64u,
      16,
      'refresh grant session id',
    ),
    manifestDigestB64u: canonicalNonzeroBase64Url(
      row.manifest_digest_b64u,
      32,
      'refresh grant manifest digest',
    ),
    deriverAAcceptanceReceiptDigestB64u: canonicalNonzeroBase64Url(
      row.deriver_a_acceptance_receipt_digest_b64u,
      32,
      'refresh grant Deriver A receipt digest',
    ),
    deriverBAcceptanceReceiptDigestB64u: canonicalNonzeroBase64Url(
      row.deriver_b_acceptance_receipt_digest_b64u,
      32,
      'refresh grant Deriver B receipt digest',
    ),
    nonceB64u: canonicalNonzeroBase64Url(row.nonce_b64u, 32, 'refresh grant nonce'),
    grantKeyId: canonicalGrantKeyId(row.grant_key_id),
    grantB64u: canonicalGrantBytes(row.grant_b64u, 'refresh grant bytes'),
    grantDigestB64u: canonicalNonzeroBase64Url(row.grant_digest_b64u, 32, 'refresh grant digest'),
    issuedAtMs: requiredPositiveInteger(row.issued_at_ms, 'refresh grant issue time'),
    expiresAtMs: requiredPositiveInteger(row.expires_at_ms, 'refresh grant expiry'),
  };
}

function recordCanonicalTimestamp(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = recordText(record, key, label);
  const parsed = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new Error(`tenant-root restore ${label}.${key} is invalid`);
  }
  return value;
}

function parseRole(value: unknown, label: string): TenantRootDeriverRoleV1 {
  if (value === 'deriver_a' || value === 'deriver_b') return value;
  throw new Error(`tenant-root restore ${label} is invalid`);
}

function parseStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`tenant-root restore ${label} is invalid`);
  const parsed: string[] = [];
  for (const entry of value) parsed.push(requiredText(entry, label));
  return parsed;
}

function parseTrustLevel(value: unknown, label: string): TenantRootTrustLevelV1 {
  const record = requiredRecord(value, label);
  const kind = recordText(record, 'kind', label);
  switch (kind) {
    case 'cryptographically_valid_offline':
      if (!hasExactKeys(record, ['kind'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return { kind };
    case 'valid_at_trust_snapshot':
      if (!hasExactKeys(record, ['kind', 'snapshotVersion', 'snapshotIssuedAt'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        kind,
        snapshotVersion: recordPositiveInteger(record, 'snapshotVersion', label),
        snapshotIssuedAt: recordCanonicalTimestamp(record, 'snapshotIssuedAt', label),
      };
    case 'current_trust_confirmed':
      if (!hasExactKeys(record, ['kind', 'snapshotVersion', 'snapshotIssuedAt', 'checkedAt'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        kind,
        snapshotVersion: recordPositiveInteger(record, 'snapshotVersion', label),
        snapshotIssuedAt: recordCanonicalTimestamp(record, 'snapshotIssuedAt', label),
        checkedAt: recordCanonicalTimestamp(record, 'checkedAt', label),
      };
    default:
      throw new Error(`tenant-root restore ${label}.kind is unknown`);
  }
}

function parseRoleReceipts(value: unknown, label: string): TenantRootRoleReceiptsV1 {
  const record = requiredRecord(value, label);
  if (!hasExactKeys(record, ['deriverA', 'deriverB'])) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return {
    deriverA: recordText(record, 'deriverA', label),
    deriverB: recordText(record, 'deriverB', label),
  };
}

function parseTenantHeldRecoverySet(
  value: unknown,
  label: string,
): TenantRootTenantHeldExternalRecoverySetV1 {
  const record = requiredRecord(value, label);
  if (!hasExactKeys(record, ['recoverySetId', 'manifestDigestB64u'])) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return {
    recoverySetId: recordCanonicalBase64Url(record, 'recoverySetId', 16, label),
    manifestDigestB64u: recordCanonicalBase64Url(record, 'manifestDigestB64u', 32, label),
  };
}

function parseOutstandingCleanup(value: unknown, label: string): TenantRootOutstandingCleanupV1 {
  const record = requiredRecord(value, label);
  if (!hasExactKeys(record, ['roles', 'description'])) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  const rawRoles = recordValue(record, 'roles', label);
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    throw new Error(`tenant-root restore ${label}.roles is invalid`);
  }
  const roles: TenantRootDeriverRoleV1[] = [];
  for (const role of rawRoles) roles.push(parseRole(role, `${label}.roles`));
  if (new Set(roles).size !== roles.length) {
    throw new Error(`tenant-root restore ${label}.roles is invalid`);
  }
  return {
    roles,
    description: recordText(record, 'description', label),
  };
}

function parseBootstrapCleanup(value: unknown, label: string): TenantRootRestoreBootstrapCleanupV1 {
  const record = requiredRecord(value, label);
  const kind = recordText(record, 'kind', label);
  switch (kind) {
    case 'destroyed':
      if (!hasExactKeys(record, ['kind', 'receiptDigestB64u'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        kind,
        receiptDigestB64u: recordText(record, 'receiptDigestB64u', label),
      };
    case 'outstanding':
      if (!hasExactKeys(record, ['kind', 'outstanding'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        kind,
        outstanding: parseOutstandingCleanup(
          recordValue(record, 'outstanding', label),
          `${label}.outstanding`,
        ),
      };
    default:
      throw new Error(`tenant-root restore ${label}.kind is unknown`);
  }
}

function parseRoleCleanup(value: unknown, label: string): TenantRootRestoreRoleCleanupV1 {
  const record = requiredRecord(value, label);
  const kind = recordText(record, 'kind', label);
  switch (kind) {
    case 'both_roles_incomplete':
      if (!hasExactKeys(record, ['kind', 'outstanding'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        kind,
        outstanding: parseOutstandingCleanup(
          recordValue(record, 'outstanding', label),
          `${label}.outstanding`,
        ),
      };
    case 'deriver_a_incomplete':
      if (!hasExactKeys(record, ['kind', 'deriverBReceiptDigestB64u', 'outstanding'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        kind,
        deriverBReceiptDigestB64u: recordText(record, 'deriverBReceiptDigestB64u', label),
        outstanding: parseOutstandingCleanup(
          recordValue(record, 'outstanding', label),
          `${label}.outstanding`,
        ),
      };
    case 'deriver_b_incomplete':
      if (!hasExactKeys(record, ['kind', 'deriverAReceiptDigestB64u', 'outstanding'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        kind,
        deriverAReceiptDigestB64u: recordText(record, 'deriverAReceiptDigestB64u', label),
        outstanding: parseOutstandingCleanup(
          recordValue(record, 'outstanding', label),
          `${label}.outstanding`,
        ),
      };
    case 'complete':
      if (!hasExactKeys(record, ['kind', 'receipts'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        kind,
        receipts: parseRoleReceipts(recordValue(record, 'receipts', label), `${label}.receipts`),
      };
    default:
      throw new Error(`tenant-root restore ${label}.kind is unknown`);
  }
}

function parseCleanupEvidence(value: unknown, label: string): TenantRootRestoreCleanupEvidenceV1 {
  const record = requiredRecord(value, label);
  if (!hasExactKeys(record, ['bootstrap', 'roles'])) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return {
    bootstrap: parseBootstrapCleanup(recordValue(record, 'bootstrap', label), `${label}.bootstrap`),
    roles: parseRoleCleanup(recordValue(record, 'roles', label), `${label}.roles`),
  };
}

function parseActivationEvidence(
  value: unknown,
  label: string,
): TenantRootRestoreActivationEvidenceV1 {
  const record = requiredRecord(value, label);
  if (
    !hasExactKeys(record, [
      'destinationFingerprintB64u',
      'destinationLineageId',
      'activatedEpoch',
      'rootCommitmentB64u',
      'activationReceiptB64u',
      'activationReceiptDigestB64u',
      'forwardRefreshReceiptDigestB64u',
      'continuityCanaryReceiptDigestB64u',
      'sourceDisposition',
      'tenantHeldRecoverySet',
    ])
  ) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  return {
    rootCommitmentB64u: recordText(record, 'rootCommitmentB64u', label),
    destinationFingerprintB64u: recordText(record, 'destinationFingerprintB64u', label),
    destinationLineageId: recordText(record, 'destinationLineageId', label),
    activatedEpoch: recordPositiveInteger(record, 'activatedEpoch', label),
    activationReceiptB64u: recordText(record, 'activationReceiptB64u', label),
    activationReceiptDigestB64u: recordText(record, 'activationReceiptDigestB64u', label),
    forwardRefreshReceiptDigestB64u: recordText(record, 'forwardRefreshReceiptDigestB64u', label),
    continuityCanaryReceiptDigestB64u: recordText(
      record,
      'continuityCanaryReceiptDigestB64u',
      label,
    ),
    sourceDisposition: parseSourceDisposition(
      recordValue(record, 'sourceDisposition', label),
      `${label}.sourceDisposition`,
    ),
    tenantHeldRecoverySet: parseTenantHeldRecoverySet(
      recordValue(record, 'tenantHeldRecoverySet', label),
      `${label}.tenantHeldRecoverySet`,
    ),
  };
}

function parseSourceDisposition(
  value: unknown,
  label: string,
): TenantRootSourceCustodyDispositionV1 {
  const record = requiredRecord(value, label);
  const kind = recordText(record, 'kind', label);
  switch (kind) {
    case 'verified_retired':
      return {
        kind,
        destructionReceipts: parseRoleReceipts(
          recordValue(record, 'destructionReceipts', label),
          `${label}.destructionReceipts`,
        ),
        decryptProbeReceipts: parseRoleReceipts(
          recordValue(record, 'decryptProbeReceipts', label),
          `${label}.decryptProbeReceipts`,
        ),
        credentialRevocationReceiptDigestB64u: recordText(
          record,
          'credentialRevocationReceiptDigestB64u',
          label,
        ),
        endpointCanaryReceiptDigestB64u: recordText(
          record,
          'endpointCanaryReceiptDigestB64u',
          label,
        ),
        recordedByUserId: recordText(record, 'recordedByUserId', label),
        recordedAt: recordText(record, 'recordedAt', label),
      };
    case 'unavailable_retirement_unverified':
      return {
        kind,
        attemptedChecks: parseStringArray(
          recordValue(record, 'attemptedChecks', label),
          `${label}.attemptedChecks`,
        ),
        recordedByUserId: recordText(record, 'recordedByUserId', label),
        recordedAt: recordText(record, 'recordedAt', label),
      };
    case 'retained_as_backup':
      return {
        kind,
        acknowledgedByUserId: recordText(record, 'acknowledgedByUserId', label),
        incidentResponseNote: recordText(record, 'incidentResponseNote', label),
        recordedAt: recordText(record, 'recordedAt', label),
      };
    default:
      throw new Error(`tenant-root restore ${label}.kind is unknown`);
  }
}

function parseRoleImportProgress(value: unknown, label: string): TenantRootRoleImportProgressV1 {
  const record = requiredRecord(value, label);
  const kind = recordText(record, 'kind', label);
  switch (kind) {
    case 'neither_installed':
      return { kind };
    case 'deriver_a_installed':
      return {
        kind,
        deriverAReceiptDigestB64u: recordText(record, 'deriverAReceiptDigestB64u', label),
      };
    case 'deriver_b_installed':
      return {
        kind,
        deriverBReceiptDigestB64u: recordText(record, 'deriverBReceiptDigestB64u', label),
      };
    default:
      throw new Error(`tenant-root restore ${label}.kind is unknown`);
  }
}

function parseRestoreSession(value: unknown, label: string): TenantRootRestoreSessionV1 {
  const record = requiredRecord(value, label);
  const status = recordText(record, 'status', label);
  switch (status) {
    case 'awaiting_manifest':
      if (
        !hasExactKeys(record, ['status', 'sessionId', 'expiresAt', 'destinationFingerprintB64u'])
      ) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        status,
        sessionId: recordText(record, 'sessionId', label),
        expiresAt: recordText(record, 'expiresAt', label),
        destinationFingerprintB64u: recordText(record, 'destinationFingerprintB64u', label),
      };
    case 'awaiting_role_imports':
      if (
        !hasExactKeys(record, [
          'status',
          'sessionId',
          'expiresAt',
          'destinationFingerprintB64u',
          'recoverySetId',
          'installed',
        ])
      ) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        status,
        sessionId: recordText(record, 'sessionId', label),
        expiresAt: recordText(record, 'expiresAt', label),
        destinationFingerprintB64u: recordText(record, 'destinationFingerprintB64u', label),
        recoverySetId: recordText(record, 'recoverySetId', label),
        installed: parseRoleImportProgress(
          recordValue(record, 'installed', label),
          `${label}.installed`,
        ),
      };
    case 'verifying':
      if (
        !hasExactKeys(record, [
          'status',
          'sessionId',
          'expiresAt',
          'destinationFingerprintB64u',
          'recoverySetId',
          'installationReceipts',
        ])
      ) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        status,
        sessionId: recordText(record, 'sessionId', label),
        expiresAt: recordText(record, 'expiresAt', label),
        destinationFingerprintB64u: recordText(record, 'destinationFingerprintB64u', label),
        recoverySetId: recordText(record, 'recoverySetId', label),
        installationReceipts: parseRoleReceipts(
          recordValue(record, 'installationReceipts', label),
          `${label}.installationReceipts`,
        ),
      };
    case 'ready_to_activate':
      if (
        !hasExactKeys(record, [
          'status',
          'sessionId',
          'expiresAt',
          'destinationFingerprintB64u',
          'recoverySetId',
          'installationReceipts',
          'trustLevel',
        ])
      ) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        status,
        sessionId: recordText(record, 'sessionId', label),
        expiresAt: recordText(record, 'expiresAt', label),
        destinationFingerprintB64u: recordText(record, 'destinationFingerprintB64u', label),
        recoverySetId: recordText(record, 'recoverySetId', label),
        installationReceipts: parseRoleReceipts(
          recordValue(record, 'installationReceipts', label),
          `${label}.installationReceipts`,
        ),
        trustLevel: parseTrustLevel(
          recordValue(record, 'trustLevel', label),
          `${label}.trustLevel`,
        ),
      };
    case 'refreshing':
      if (
        !hasExactKeys(record, [
          'status',
          'sessionId',
          'expiresAt',
          'destinationFingerprintB64u',
          'recoverySetId',
          'installationReceipts',
        ])
      ) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        status,
        sessionId: recordText(record, 'sessionId', label),
        expiresAt: recordText(record, 'expiresAt', label),
        destinationFingerprintB64u: recordText(record, 'destinationFingerprintB64u', label),
        recoverySetId: recordText(record, 'recoverySetId', label),
        installationReceipts: parseRoleReceipts(
          recordValue(record, 'installationReceipts', label),
          `${label}.installationReceipts`,
        ),
      };
    case 'active':
      if (
        !hasExactKeys(record, [
          'rootCommitmentB64u',
          'status',
          'sessionId',
          'destinationFingerprintB64u',
          'destinationLineageId',
          'activatedEpoch',
          'activationReceiptDigestB64u',
          'forwardRefreshReceiptDigestB64u',
          'continuityCanaryReceiptDigestB64u',
          'bootstrapDestructionReceiptDigestB64u',
          'sourceDisposition',
          'tenantHeldRecoverySet',
        ])
      ) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        rootCommitmentB64u: recordText(record, 'rootCommitmentB64u', label),
        status,
        sessionId: recordText(record, 'sessionId', label),
        destinationFingerprintB64u: recordText(record, 'destinationFingerprintB64u', label),
        destinationLineageId: recordText(record, 'destinationLineageId', label),
        activatedEpoch: recordPositiveInteger(record, 'activatedEpoch', label),
        activationReceiptDigestB64u: recordText(record, 'activationReceiptDigestB64u', label),
        forwardRefreshReceiptDigestB64u: recordText(
          record,
          'forwardRefreshReceiptDigestB64u',
          label,
        ),
        continuityCanaryReceiptDigestB64u: recordText(
          record,
          'continuityCanaryReceiptDigestB64u',
          label,
        ),
        bootstrapDestructionReceiptDigestB64u: recordText(
          record,
          'bootstrapDestructionReceiptDigestB64u',
          label,
        ),
        sourceDisposition: parseSourceDisposition(
          recordValue(record, 'sourceDisposition', label),
          `${label}.sourceDisposition`,
        ),
        tenantHeldRecoverySet: parseTenantHeldRecoverySet(
          recordValue(record, 'tenantHeldRecoverySet', label),
          `${label}.tenantHeldRecoverySet`,
        ),
      };
    case 'failed_before_activation':
      if (!hasExactKeys(record, ['status', 'sessionId', 'failureCode', 'cleanupReceipts'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        status,
        sessionId: recordText(record, 'sessionId', label),
        failureCode: recordText(record, 'failureCode', label),
        cleanupReceipts: parseRoleReceipts(
          recordValue(record, 'cleanupReceipts', label),
          `${label}.cleanupReceipts`,
        ),
      };
    case 'cleanup_incomplete': {
      const phase = recordText(record, 'phase', label);
      switch (phase) {
        case 'pre_activation':
          if (!hasExactKeys(record, ['status', 'phase', 'sessionId', 'expiresAt', 'destinationFingerprintB64u', 'outstanding'])) {
            throw new Error(`tenant-root restore ${label} is invalid`);
          }
          return {
            status,
            phase,
            sessionId: recordText(record, 'sessionId', label),
            expiresAt: recordText(record, 'expiresAt', label),
            destinationFingerprintB64u: recordText(record, 'destinationFingerprintB64u', label),
            outstanding: parseOutstandingCleanup(
              recordValue(record, 'outstanding', label),
              `${label}.outstanding`,
            ),
          };
        case 'post_activation':
          if (
            !hasExactKeys(record, [
              'status',
              'phase',
              'sessionId',
              'activationEvidence',
              'bootstrapCleanup',
              'roleCleanup',
            ])
          ) {
            throw new Error(`tenant-root restore ${label} is invalid`);
          }
          return {
            status,
            phase,
            sessionId: recordText(record, 'sessionId', label),
            activationEvidence: parseActivationEvidence(
              recordValue(record, 'activationEvidence', label),
              `${label}.activationEvidence`,
            ),
            bootstrapCleanup: parseBootstrapCleanup(
              recordValue(record, 'bootstrapCleanup', label),
              `${label}.bootstrapCleanup`,
            ),
            roleCleanup: parseRoleCleanup(
              recordValue(record, 'roleCleanup', label),
              `${label}.roleCleanup`,
            ),
          };
        default:
          throw new Error(`tenant-root restore ${label}.phase is unknown`);
      }
    }
    case 'expired':
      if (!hasExactKeys(record, ['status', 'sessionId', 'expiredAt', 'cleanupReceipts'])) {
        throw new Error(`tenant-root restore ${label} is invalid`);
      }
      return {
        status,
        sessionId: recordText(record, 'sessionId', label),
        expiredAt: recordText(record, 'expiredAt', label),
        cleanupReceipts: parseRoleReceipts(
          recordValue(record, 'cleanupReceipts', label),
          `${label}.cleanupReceipts`,
        ),
      };
    default:
      throw new Error(`tenant-root restore session status ${status} is unknown`);
  }
}

function parseSessionColumn(value: unknown): TenantRootRestoreSessionV1 | null {
  if (value === null || value === undefined) return null;
  return parseRestoreSession(parseJsonRecord(value, 'session_json'), 'session');
}

function parseRegisteredManifestRole(
  value: unknown,
  label: string,
  expectedShareId: 1,
): TenantRootRestoreRegisteredManifestV1['deriverA'];
function parseRegisteredManifestRole(
  value: unknown,
  label: string,
  expectedShareId: 2,
): TenantRootRestoreRegisteredManifestV1['deriverB'];
function parseRegisteredManifestRole(
  value: unknown,
  label: string,
  expectedShareId: 1 | 2,
):
  | TenantRootRestoreRegisteredManifestV1['deriverA']
  | TenantRootRestoreRegisteredManifestV1['deriverB'] {
  const record = requiredRecord(value, label);
  if (
    !hasExactKeys(record, [
      'shareId',
      'recipientPublicKeyB64u',
      'recipientFingerprintB64u',
      'recoveryShareCommitmentB64u',
      'deriverSigningKeyId',
    ])
  ) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  const shareId = recordPositiveInteger(record, 'shareId', label);
  const recipientPublicKeyB64u = recordCanonicalBase64Url(
    record,
    'recipientPublicKeyB64u',
    32,
    label,
  );
  const recipientFingerprintB64u = recordCanonicalBase64Url(
    record,
    'recipientFingerprintB64u',
    32,
    label,
  );
  const recoveryShareCommitmentB64u = recordCanonicalBase64Url(
    record,
    'recoveryShareCommitmentB64u',
    34,
    label,
  );
  const deriverSigningKeyId = recordText(record, 'deriverSigningKeyId', label);
  if (expectedShareId === 1) {
    if (shareId !== 1) throw new Error(`tenant-root restore ${label}.shareId is invalid`);
    return {
      shareId: 1,
      recipientPublicKeyB64u,
      recipientFingerprintB64u,
      recoveryShareCommitmentB64u,
      deriverSigningKeyId,
    };
  }
  if (shareId !== 2) throw new Error(`tenant-root restore ${label}.shareId is invalid`);
  return {
    shareId: 2,
    recipientPublicKeyB64u,
    recipientFingerprintB64u,
    recoveryShareCommitmentB64u,
    deriverSigningKeyId,
  };
}

function parseRegisteredManifestDescriptor(
  record: Record<string, unknown>,
  expectedIdentityDigestB64u: string,
): TenantRootRestoreRegisteredManifestV1 {
  const label = 'registeredManifest';
  if (
    !hasExactKeys(record, [
      'identityDigestB64u',
      'sourceCustodyLineageB64u',
      'recoverySetId',
      'stableRootCommitmentB64u',
      'deriverA',
      'deriverB',
      'deriverAPackageLength',
      'deriverAPackageDigestB64u',
      'deriverBPackageLength',
      'deriverBPackageDigestB64u',
      'manifestDigestB64u',
      'artifactCreatedAtIso',
      'trustLevel',
    ])
  ) {
    throw new Error(`tenant-root restore ${label} is invalid`);
  }
  const identityDigestB64u = recordCanonicalBase64Url(record, 'identityDigestB64u', 32, label);
  if (identityDigestB64u !== expectedIdentityDigestB64u) {
    throw new Error(`tenant-root restore ${label}.identityDigestB64u is out of scope`);
  }
  const deriverA = parseRegisteredManifestRole(
    recordValue(record, 'deriverA', label),
    `${label}.deriverA`,
    1,
  );
  const deriverB = parseRegisteredManifestRole(
    recordValue(record, 'deriverB', label),
    `${label}.deriverB`,
    2,
  );
  if (
    deriverA.recipientFingerprintB64u === deriverB.recipientFingerprintB64u ||
    deriverA.deriverSigningKeyId === deriverB.deriverSigningKeyId
  ) {
    throw new Error(`tenant-root restore ${label} has duplicate role bindings`);
  }
  const deriverAPackageLength = recordPositiveInteger(record, 'deriverAPackageLength', label);
  const deriverBPackageLength = recordPositiveInteger(record, 'deriverBPackageLength', label);
  if (
    deriverAPackageLength > TENANT_ROOT_RECOVERY_PACKAGE_MAX_BYTES_V1 ||
    deriverBPackageLength > TENANT_ROOT_RECOVERY_PACKAGE_MAX_BYTES_V1
  ) {
    throw new Error(`tenant-root restore ${label} package length is invalid`);
  }
  return {
    identityDigestB64u,
    sourceCustodyLineageB64u: recordCanonicalBase64Url(
      record,
      'sourceCustodyLineageB64u',
      16,
      label,
    ),
    recoverySetId: recordCanonicalBase64Url(record, 'recoverySetId', 16, label),
    stableRootCommitmentB64u: recordCanonicalBase64Url(
      record,
      'stableRootCommitmentB64u',
      32,
      label,
    ),
    deriverA,
    deriverB,
    deriverAPackageLength,
    deriverAPackageDigestB64u: recordCanonicalBase64Url(
      record,
      'deriverAPackageDigestB64u',
      32,
      label,
    ),
    deriverBPackageLength,
    deriverBPackageDigestB64u: recordCanonicalBase64Url(
      record,
      'deriverBPackageDigestB64u',
      32,
      label,
    ),
    manifestDigestB64u: recordCanonicalBase64Url(record, 'manifestDigestB64u', 32, label),
    artifactCreatedAtIso: recordCanonicalTimestamp(record, 'artifactCreatedAtIso', label),
    trustLevel: parseTrustLevel(recordValue(record, 'trustLevel', label), `${label}.trustLevel`),
  };
}

function parseRegisteredManifestColumn(
  value: unknown,
  expectedIdentityDigestB64u: string,
): TenantRootRestoreRegisteredManifestBundleV1 | null {
  if (value === null || value === undefined) return null;
  const envelope = parseJsonRecord(value, 'registered_manifest_json');
  if (!hasExactKeys(envelope, ['descriptor', 'manifestB64u'])) {
    throw new Error('tenant-root restore registered manifest envelope is invalid');
  }
  const manifestB64u = recordText(envelope, 'manifestB64u', 'registeredManifest');
  if (!/^[A-Za-z0-9_-]+$/u.test(manifestB64u)) {
    throw new Error('tenant-root restore registered manifest bytes are invalid');
  }
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = base64UrlDecode(manifestB64u);
  } catch {
    throw new Error('tenant-root restore registered manifest bytes are invalid');
  }
  if (manifestBytes.length === 0 || base64UrlEncode(manifestBytes) !== manifestB64u) {
    throw new Error('tenant-root restore registered manifest bytes are invalid');
  }
  return {
    descriptor: parseRegisteredManifestDescriptor(
      requiredRecord(
        recordValue(envelope, 'descriptor', 'registeredManifest'),
        'registeredManifest.descriptor',
      ),
      expectedIdentityDigestB64u,
    ),
    manifestB64u,
  };
}

function parseRestoreStateRow(
  row: D1Row | null,
  expectedIdentityDigestB64u: string,
): ParsedRestoreStateRow {
  if (row === null) return { session: null, registeredManifest: null };
  return {
    session: parseSessionColumn(row.session_json),
    registeredManifest: parseRegisteredManifestColumn(
      row.registered_manifest_json,
      expectedIdentityDigestB64u,
    ),
  };
}

function parseRoleImportKeyRow(row: D1Row): TenantRootRestoreRoleImportKeyV1 {
  return {
    role: parseRole(row.role, 'import key role'),
    importKeyId: requiredText(row.import_key_id, 'import key id'),
    importPublicKeyB64u: requiredText(row.import_public_key_b64u, 'import public key'),
    generation: requiredPositiveInteger(row.generation, 'import key generation'),
    issuedAtMs: requiredInteger(row.issued_at_ms, 'import key issued time'),
    expiresAtMs: requiredInteger(row.expires_at_ms, 'import key expiry'),
  };
}

function parseInstalledImportRow(row: D1Row): TenantRootRestoreInstalledImportV1 {
  return {
    role: parseRole(row.role, 'installed import role'),
    envelopeDigestB64u: requiredText(row.envelope_digest_b64u, 'envelope digest'),
    receiptDigestB64u: requiredText(row.receipt_digest_b64u, 'receipt digest'),
  };
}

function parseBootstrapSessionRow(row: D1Row): TenantRootRestoreBootstrapSessionV1 {
  return {
    tokenDigestB64u: requiredText(row.token_digest_b64u, 'bootstrap token digest'),
    actorUserId: requiredText(row.actor_user_id, 'bootstrap actor'),
    authenticatedAtMs: requiredInteger(row.authenticated_at_ms, 'bootstrap authentication time'),
    expiresAtMs: requiredInteger(row.expires_at_ms, 'bootstrap expiry'),
  };
}

function normalizeDestination(
  destination: TenantRootDestinationStateV1,
): TenantRootDestinationStateV1 {
  switch (destination.kind) {
    case 'empty':
      return {
        kind: destination.kind,
        deploymentFingerprintB64u: requiredText(
          destination.deploymentFingerprintB64u,
          'deployment fingerprint',
        ),
      };
    case 'active_root_present':
      return { kind: destination.kind };
    default:
      throw new Error('tenant-root restore destination state is invalid');
  }
}

function scopeValues(scope: RestoreScope): readonly unknown[] {
  return [scope.namespace, scope.orgId, scope.identityDigestB64u, scope.destinationLineageB64u];
}

function refreshGrantBindings(
  scope: RestoreScope,
  expectedSessionId: string,
  grant: SignedTenantRootRestoreRefreshGrantV1,
): readonly unknown[] {
  return [
    ...scopeValues(scope),
    expectedSessionId,
    grant.operationDigestB64u,
    grant.destinationIdentityDigestB64u,
    grant.destinationFingerprintB64u,
    grant.destinationLineageB64u,
    grant.restoreSessionIdB64u,
    grant.manifestDigestB64u,
    grant.deriverAAcceptanceReceiptDigestB64u,
    grant.deriverBAcceptanceReceiptDigestB64u,
    grant.nonceB64u,
    grant.grantKeyId,
    grant.grantB64u,
    grant.grantDigestB64u,
    grant.issuedAtMs,
    grant.expiresAtMs,
    scope.now(),
  ];
}

function refreshGrantMatchesScope(
  scope: RestoreScope,
  sessionId: string,
  grant: SignedTenantRootRestoreRefreshGrantV1,
): boolean {
  return (
    grant.destinationIdentityDigestB64u === scope.identityDigestB64u &&
    grant.destinationLineageB64u === scope.destinationLineageB64u &&
    grant.restoreSessionIdB64u === sessionId
  );
}

async function readRestoreRefreshGrantForScope(
  scope: RestoreScope,
  sessionId: string,
): Promise<SignedTenantRootRestoreRefreshGrantV1 | null> {
  const normalizedSessionId = canonicalNonzeroBase64Url(sessionId, 16, 'refresh grant session id');
  const row = await queryD1One(
    scope.database,
    `SELECT session_id_b64u, operation_digest_b64u,
            destination_identity_digest_b64u, destination_fingerprint_b64u,
            grant_destination_lineage_b64u, grant_session_id_b64u,
            manifest_digest_b64u, deriver_a_acceptance_receipt_digest_b64u,
            deriver_b_acceptance_receipt_digest_b64u, nonce_b64u, grant_key_id,
            grant_b64u, grant_digest_b64u, issued_at_ms, expires_at_ms
       FROM tenant_root_security_restore_refresh_grants
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND destination_lineage_b64u = ?4
        AND session_id_b64u = ?5`,
    [...scopeValues(scope), normalizedSessionId],
  );
  if (row === null) return null;
  const storedSessionId = canonicalNonzeroBase64Url(
    row.session_id_b64u,
    16,
    'refresh grant row session id',
  );
  const grant = parseRestoreRefreshGrantRow(row);
  if (!refreshGrantMatchesScope(scope, storedSessionId, grant)) {
    throw new Error('tenant-root restore refresh grant row is out of scope');
  }
  if (storedSessionId !== normalizedSessionId) {
    throw new Error('tenant-root restore refresh grant row session id is inconsistent');
  }
  await validateSignedRestoreRefreshGrant(grant);
  return grant;
}

async function admitRestoreRefreshGrantForScope(
  scope: RestoreScope,
  input: {
    readonly expectedSessionId: string;
    readonly grant: SignedTenantRootRestoreRefreshGrantV1;
    readonly nowMs: number;
  },
): Promise<TenantRootRestoreRefreshGrantAdmissionV1> {
  const expectedSessionId = canonicalNonzeroBase64Url(
    input.expectedSessionId,
    16,
    'refresh grant expected session id',
  );
  const nowMs = requiredPositiveInteger(input.nowMs, 'refresh grant admission time');
  await validateSignedRestoreRefreshGrant(input.grant);
  if (!refreshGrantMatchesScope(scope, expectedSessionId, input.grant)) {
    return { kind: 'conflict' };
  }
  if (nowMs < input.grant.issuedAtMs || nowMs >= input.grant.expiresAtMs) {
    return { kind: 'expired' };
  }

  const values = refreshGrantBindings(scope, expectedSessionId, input.grant);
  const results = await scope.database.batch<D1ResultLike>([
    scope.database
      .prepare(
        `INSERT INTO tenant_root_security_restore_refresh_grants (
           namespace, org_id, identity_digest_b64u, destination_lineage_b64u,
           session_id_b64u, operation_digest_b64u, destination_identity_digest_b64u,
           destination_fingerprint_b64u, grant_destination_lineage_b64u,
           grant_session_id_b64u, manifest_digest_b64u,
           deriver_a_acceptance_receipt_digest_b64u,
           deriver_b_acceptance_receipt_digest_b64u, nonce_b64u, grant_key_id,
           grant_b64u, grant_digest_b64u, issued_at_ms, expires_at_ms,
           created_at_ms, updated_at_ms
         )
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20
          WHERE EXISTS (
            SELECT 1
              FROM tenant_root_security_restore_state AS state
             WHERE state.namespace = ?1
               AND state.org_id = ?2
               AND state.identity_digest_b64u = ?3
               AND state.destination_lineage_b64u = ?4
               AND json_extract(state.session_json, '$.sessionId') = ?5
               AND json_extract(state.session_json, '$.status') IN (
                 'verifying', 'ready_to_activate', 'refreshing'
               )
               AND json_extract(state.session_json, '$.destinationFingerprintB64u') = ?8
               AND json_extract(state.session_json, '$.installationReceipts.deriverA') = ?12
               AND json_extract(state.session_json, '$.installationReceipts.deriverB') = ?13
               AND state.registered_manifest_json IS NOT NULL
               AND json_extract(
                 state.registered_manifest_json,
                 '$.descriptor.manifestDigestB64u'
               ) = ?11
          )
          AND ?7 = ?3
          AND ?9 = ?4
          AND ?10 = ?5
         ON CONFLICT (
           namespace, org_id, identity_digest_b64u, destination_lineage_b64u,
           session_id_b64u
         ) DO NOTHING`,
      )
      .bind(...values.slice(0, 20)),
    scope.database
      .prepare(
        `UPDATE tenant_root_security_restore_state
            SET session_json = json_set(session_json, '$.status', 'refreshing'),
                updated_at_ms = ?7
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND json_extract(session_json, '$.sessionId') = ?5
            AND json_extract(session_json, '$.status') IN (
              'verifying', 'ready_to_activate', 'refreshing'
            )
            AND EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_refresh_grants AS stored_grant
               WHERE stored_grant.namespace = ?1
                 AND stored_grant.org_id = ?2
                 AND stored_grant.identity_digest_b64u = ?3
                 AND stored_grant.destination_lineage_b64u = ?4
                 AND stored_grant.session_id_b64u = ?5
                 AND stored_grant.grant_digest_b64u = ?6
            )`,
      )
      .bind(values[0], values[1], values[2], values[3], values[4], values[16], values[19]),
  ]);
  const stored = await readRestoreRefreshGrantForScope(scope, expectedSessionId);
  const state = parseRestoreStateRow(await readStateRow(scope), scope.identityDigestB64u);
  if (stored !== null && state.session?.sessionId === expectedSessionId) {
    if (state.session.status === 'refreshing') {
      return {
        kind: results[0] !== undefined && d1ChangedRows(results[0]) === 1 ? 'admitted' : 'replayed',
        grant: stored,
      };
    }
    return { kind: 'conflict' };
  }
  if (
    state.session === null ||
    state.session.sessionId !== expectedSessionId ||
    !(
      state.session.status === 'verifying' ||
      state.session.status === 'ready_to_activate' ||
      state.session.status === 'refreshing'
    )
  ) {
    return { kind: 'session_not_ready' };
  }
  return { kind: 'conflict' };
}

async function readStateRow(scope: RestoreScope): Promise<D1Row | null> {
  return await queryD1One(
    scope.database,
    `SELECT session_json, registered_manifest_json
       FROM tenant_root_security_restore_state
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND destination_lineage_b64u = ?4`,
    scopeValues(scope),
  );
}

async function readImportKeyRows(scope: RestoreScope): Promise<readonly D1Row[]> {
  return await queryD1All(
    scope.database,
    `SELECT role, import_key_id, import_public_key_b64u, generation,
            issued_at_ms, expires_at_ms
       FROM tenant_root_security_restore_import_keys
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND destination_lineage_b64u = ?4
      ORDER BY role ASC`,
    scopeValues(scope),
  );
}

async function readInstalledImportRows(scope: RestoreScope): Promise<readonly D1Row[]> {
  return await queryD1All(
    scope.database,
    `SELECT role, envelope_digest_b64u, receipt_digest_b64u
       FROM tenant_root_security_restore_installed_imports
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND destination_lineage_b64u = ?4
      ORDER BY role ASC`,
    scopeValues(scope),
  );
}

function addImportKey(
  importKeys: {
    deriver_a: TenantRootRestoreRoleImportKeyV1 | null;
    deriver_b: TenantRootRestoreRoleImportKeyV1 | null;
  },
  key: TenantRootRestoreRoleImportKeyV1,
): void {
  if (importKeys[key.role] !== null) {
    throw new Error(`tenant-root restore has duplicate ${key.role} import keys`);
  }
  importKeys[key.role] = key;
}

function addInstalledImport(
  installedImports: TenantRootRestoreInstalledImportV1[],
  installed: TenantRootRestoreInstalledImportV1,
): void {
  for (const existing of installedImports) {
    if (existing.role === installed.role) {
      throw new Error(`tenant-root restore has duplicate ${installed.role} imports`);
    }
  }
  installedImports.push(installed);
}

function liveBootstrapSessionGateSql(): string {
  return `EXISTS (
    SELECT 1
      FROM tenant_root_security_restore_bootstrap_sessions AS bootstrap
     WHERE bootstrap.namespace = ?1
       AND bootstrap.org_id = ?2
       AND bootstrap.identity_digest_b64u = ?3
       AND bootstrap.destination_lineage_b64u = ?4
       AND bootstrap.token_digest_b64u = ?5
       AND bootstrap.actor_user_id = ?6
       AND bootstrap.authenticated_at_ms = ?7
       AND bootstrap.expires_at_ms = ?8
       AND bootstrap.authenticated_at_ms <= ?9
       AND bootstrap.expires_at_ms > ?9
  )`;
}

function startableStateGateSql(): string {
  return `(
    (?10 IS NULL AND NOT EXISTS (
      SELECT 1
        FROM tenant_root_security_restore_state AS state
       WHERE state.namespace = ?1
         AND state.org_id = ?2
         AND state.identity_digest_b64u = ?3
         AND state.destination_lineage_b64u = ?4
    ))
    OR EXISTS (
      SELECT 1
        FROM tenant_root_security_restore_state AS state
       WHERE state.namespace = ?1
         AND state.org_id = ?2
         AND state.identity_digest_b64u = ?3
         AND state.destination_lineage_b64u = ?4
         AND (
           (state.session_json IS NULL AND ?10 IS NULL)
           OR (
             json_extract(state.session_json, '$.status') IN ('expired', 'failed_before_activation')
             AND json_extract(state.session_json, '$.sessionId') = ?10
           )
         )
    )
  )`;
}

function existingStartableStateGateSql(): string {
  return `(
    (session_json IS NULL AND ?10 IS NULL)
    OR (
      json_extract(session_json, '$.status') IN ('expired', 'failed_before_activation')
      AND json_extract(session_json, '$.sessionId') = ?10
    )
  )`;
}

function sessionStartBindings(
  scope: RestoreScope,
  input: TenantRootRestoreSessionStartAdmissionInputV1,
): readonly unknown[] {
  return [
    ...scopeValues(scope),
    input.authenticatedSession.tokenDigestB64u,
    input.authenticatedSession.actorUserId,
    input.authenticatedSession.authenticatedAtMs,
    input.authenticatedSession.expiresAtMs,
    input.nowMs,
    input.expectedSessionId,
    JSON.stringify(input.session),
    input.nowMs,
  ];
}

function sameBootstrapSessionAtTime(
  stored: TenantRootRestoreBootstrapSessionV1 | null,
  expected: TenantRootRestoreBootstrapSessionV1,
  nowMs: number,
): boolean {
  return (
    stored !== null &&
    sameBootstrapSession(stored, expected) &&
    stored.authenticatedAtMs <= nowMs &&
    stored.expiresAtMs > nowMs
  );
}

async function admitSessionStartForScope(
  scope: RestoreScope,
  input: TenantRootRestoreSessionStartAdmissionInputV1,
): Promise<TenantRootRestoreSessionStartAdmissionV1> {
  const bindings = sessionStartBindings(scope, input);
  const bootstrapGate = liveBootstrapSessionGateSql();
  const stateGate = startableStateGateSql();
  const results = await scope.database.batch<D1ResultLike>([
    scope.database
      .prepare(
        `DELETE FROM tenant_root_security_restore_import_keys
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND ${bootstrapGate}
            AND ${stateGate}`,
      )
      .bind(...bindings.slice(0, 10)),
    scope.database
      .prepare(
        `DELETE FROM tenant_root_security_restore_installed_imports
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND ${bootstrapGate}
            AND ${stateGate}`,
      )
      .bind(...bindings.slice(0, 10)),
    scope.database
      .prepare(
        `DELETE FROM tenant_root_security_restore_refresh_grants
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND ${bootstrapGate}
            AND ${stateGate}`,
      )
      .bind(...bindings.slice(0, 10)),
    scope.database
      .prepare(
        `UPDATE tenant_root_security_restore_state
            SET session_json = ?11, registered_manifest_json = NULL, updated_at_ms = ?12
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND ${bootstrapGate}
            AND ${existingStartableStateGateSql()}`,
      )
      .bind(...bindings),
    scope.database
      .prepare(
        `INSERT INTO tenant_root_security_restore_state (
           namespace, org_id, identity_digest_b64u, destination_lineage_b64u,
           session_json, registered_manifest_json, updated_at_ms
         )
         SELECT ?1, ?2, ?3, ?4, ?11, NULL, ?12
          WHERE ?10 IS NULL
            AND ${bootstrapGate}
            AND NOT EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_state AS state
               WHERE state.namespace = ?1
                 AND state.org_id = ?2
                 AND state.identity_digest_b64u = ?3
                 AND state.destination_lineage_b64u = ?4
            )`,
      )
      .bind(...bindings),
  ]);
  const stateChanged =
    (results[3] === undefined ? 0 : d1ChangedRows(results[3])) +
      (results[4] === undefined ? 0 : d1ChangedRows(results[4])) >
    0;
  if (stateChanged) return { kind: 'started' };

  const storedBootstrap = await readBootstrapSessionForDigest(
    scope,
    input.authenticatedSession.tokenDigestB64u,
  );
  if (!sameBootstrapSessionAtTime(storedBootstrap, input.authenticatedSession, input.nowMs)) {
    return { kind: 'bootstrap_authentication_failed' };
  }
  const state = parseRestoreStateRow(await readStateRow(scope), scope.identityDigestB64u);
  if (state.session === null) return { kind: 'session_start_conflict' };
  if (JSON.stringify(state.session) === JSON.stringify(input.session)) {
    return { kind: 'replayed' };
  }
  switch (state.session.status) {
    case 'cleanup_incomplete':
      return { kind: 'cleanup_incomplete' };
    case 'awaiting_manifest':
    case 'awaiting_role_imports':
    case 'verifying':
    case 'ready_to_activate':
    case 'refreshing':
    case 'active':
      return { kind: 'session_in_progress' };
    case 'failed_before_activation':
    case 'expired':
      return { kind: 'session_start_conflict' };
  }
}

async function finalizeExpiredSessionForScope(
  scope: RestoreScope,
  input: TenantRootRestoreExpiredSessionFinalizationInputV1,
): Promise<TenantRootRestoreExpiredSessionFinalizationV1> {
  const endedJson = JSON.stringify(input.endedSession);
  const results = await scope.database.batch<D1ResultLike>([
    scope.database
      .prepare(
        `UPDATE tenant_root_security_restore_state
            SET session_json = ?5, registered_manifest_json = NULL, updated_at_ms = ?6
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND json_extract(session_json, '$.sessionId') = ?7
            AND (
              json_extract(session_json, '$.status') IN (
                'awaiting_manifest', 'awaiting_role_imports', 'verifying',
                'ready_to_activate', 'refreshing'
              ) OR (
                json_extract(session_json, '$.status') = 'cleanup_incomplete'
                AND json_extract(session_json, '$.phase') = 'pre_activation'
              )
            )
            AND json_extract(session_json, '$.expiresAt') IS NOT NULL
            AND json_extract(session_json, '$.expiresAt') <= ?8`,
      )
      .bind(
        ...scopeValues(scope),
        endedJson,
        input.nowMs,
        input.expectedSessionId,
        new Date(input.nowMs).toISOString(),
      ),
    scope.database
      .prepare(
        `DELETE FROM tenant_root_security_restore_import_keys
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_state AS state
               WHERE state.namespace = ?1
                 AND state.org_id = ?2
                 AND state.identity_digest_b64u = ?3
                 AND state.destination_lineage_b64u = ?4
                 AND state.session_json = ?5
            )`,
      )
      .bind(...scopeValues(scope), endedJson),
    scope.database
      .prepare(
        `DELETE FROM tenant_root_security_restore_installed_imports
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_state AS state
               WHERE state.namespace = ?1
                 AND state.org_id = ?2
                 AND state.identity_digest_b64u = ?3
                 AND state.destination_lineage_b64u = ?4
                 AND state.session_json = ?5
            )`,
      )
      .bind(...scopeValues(scope), endedJson),
    scope.database
      .prepare(
        `DELETE FROM tenant_root_security_restore_refresh_grants
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_state AS state
               WHERE state.namespace = ?1
                 AND state.org_id = ?2
                 AND state.identity_digest_b64u = ?3
                 AND state.destination_lineage_b64u = ?4
                 AND state.session_json = ?5
            )`,
      )
      .bind(...scopeValues(scope), endedJson),
  ]);
  return results[0] !== undefined && d1ChangedRows(results[0]) === 1
    ? { kind: 'finalized' }
    : { kind: 'stale' };
}

async function readContextForScope(
  scope: RestoreScope,
  readDestination: () => Promise<TenantRootDestinationStateV1>,
): Promise<TenantRootRestoreContextV1> {
  const [destination, stateRow, keyRows, installedRows] = await Promise.all([
    readDestination(),
    readStateRow(scope),
    readImportKeyRows(scope),
    readInstalledImportRows(scope),
  ]);
  const liveDestination = normalizeDestination(destination);
  const state = parseRestoreStateRow(stateRow, scope.identityDigestB64u);
  const importKeys: ParsedImportKeys = { deriver_a: null, deriver_b: null };
  for (const row of keyRows) addImportKey(importKeys, parseRoleImportKeyRow(row));
  const installedImports: TenantRootRestoreInstalledImportV1[] = [];
  for (const row of installedRows)
    addInstalledImport(installedImports, parseInstalledImportRow(row));

  if (state.session?.status === 'active' && liveDestination.kind !== 'active_root_present') {
    throw new Error('tenant-root restore destination disagrees with persisted active session');
  }
  return {
    orgId: scope.orgId,
    identityDigestB64u: scope.identityDigestB64u,
    destination: liveDestination,
    destinationLineageB64u: scope.destinationLineageB64u,
    session: state.session,
    registeredManifest: state.registeredManifest,
    importKeys,
    installedImports,
  };
}

async function putSessionForScope(
  scope: RestoreScope,
  session: TenantRootRestoreSessionV1,
): Promise<void> {
  await scope.database
    .prepare(
      `INSERT INTO tenant_root_security_restore_state (
         namespace, org_id, identity_digest_b64u, destination_lineage_b64u,
         session_json, updated_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (
         namespace, org_id, identity_digest_b64u, destination_lineage_b64u
       ) DO UPDATE SET
         session_json = excluded.session_json,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .bind(...scopeValues(scope), JSON.stringify(session), scope.now())
    .run();
}

async function putManifestForScope(
  scope: RestoreScope,
  manifest: TenantRootRestoreRegisteredManifestV1,
  manifestB64u: string,
): Promise<void> {
  if (manifest.identityDigestB64u !== scope.identityDigestB64u) {
    throw new Error('tenant-root restore registered manifest identity is out of scope');
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(manifestB64u)) {
    throw new Error('tenant-root restore registered manifest bytes are invalid');
  }
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = base64UrlDecode(manifestB64u);
  } catch {
    throw new Error('tenant-root restore registered manifest bytes are invalid');
  }
  if (manifestBytes.length === 0 || base64UrlEncode(manifestBytes) !== manifestB64u) {
    throw new Error('tenant-root restore registered manifest bytes are invalid');
  }
  const rawManifest = parseJsonRecord(
    new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
    'manifest',
  );
  const descriptor = requiredRecord(rawManifest.descriptor, 'manifest descriptor');
  const identity = decodeTenantRootIdentityWireV1(descriptor.tenantRootIdentity);
  if (
    !identity.ok ||
    identity.value.orgId !== scope.orgId ||
    (await tenantRootIdentityDigestB64uV1(identity.value)) !== scope.identityDigestB64u
  ) {
    throw new Error('tenant-root restore manifest logical identity is out of scope');
  }
  const identityJson = JSON.stringify(identity.value);
  const encoded = JSON.stringify({ descriptor: manifest, manifestB64u });
  await scope.database
    .prepare(
      `INSERT INTO tenant_root_security_restore_state (
         namespace, org_id, identity_digest_b64u, destination_lineage_b64u,
         registered_manifest_json, updated_at_ms, identity_json
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (
         namespace, org_id, identity_digest_b64u, destination_lineage_b64u
       ) DO UPDATE SET
         registered_manifest_json = excluded.registered_manifest_json,
         identity_json = excluded.identity_json,
         updated_at_ms = excluded.updated_at_ms
       WHERE tenant_root_security_restore_state.registered_manifest_json IS NULL`,
    )
    .bind(...scopeValues(scope), encoded, scope.now(), identityJson)
    .run();
  const stored = await readStateRow(scope);
  if (stored?.registered_manifest_json !== encoded) {
    throw new Error('tenant-root restore registered manifest write conflicted');
  }
}

function sameImportKey(
  left: TenantRootRestoreRoleImportKeyV1,
  right: TenantRootRestoreRoleImportKeyV1,
): boolean {
  return (
    left.role === right.role &&
    left.importKeyId === right.importKeyId &&
    left.importPublicKeyB64u === right.importPublicKeyB64u &&
    left.generation === right.generation &&
    left.issuedAtMs === right.issuedAtMs &&
    left.expiresAtMs === right.expiresAtMs
  );
}

async function readImportKeyForRole(
  scope: RestoreScope,
  role: TenantRootDeriverRoleV1,
): Promise<TenantRootRestoreRoleImportKeyV1 | null> {
  const row = await queryD1One(
    scope.database,
    `SELECT role, import_key_id, import_public_key_b64u, generation,
            issued_at_ms, expires_at_ms
       FROM tenant_root_security_restore_import_keys
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND destination_lineage_b64u = ?4
        AND role = ?5`,
    [...scopeValues(scope), role],
  );
  return row === null ? null : parseRoleImportKeyRow(row);
}

async function putRoleImportKeyForScope(
  scope: RestoreScope,
  key: TenantRootRestoreRoleImportKeyV1,
): Promise<void> {
  await scope.database
    .prepare(
      `INSERT INTO tenant_root_security_restore_import_keys (
         namespace, org_id, identity_digest_b64u, destination_lineage_b64u,
         role, import_key_id, import_public_key_b64u, generation,
         issued_at_ms, expires_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (
         namespace, org_id, identity_digest_b64u, destination_lineage_b64u, role
       ) DO UPDATE SET
         import_key_id = excluded.import_key_id,
         import_public_key_b64u = excluded.import_public_key_b64u,
         generation = excluded.generation,
         issued_at_ms = excluded.issued_at_ms,
         expires_at_ms = excluded.expires_at_ms
       WHERE excluded.generation > tenant_root_security_restore_import_keys.generation`,
    )
    .bind(
      ...scopeValues(scope),
      key.role,
      key.importKeyId,
      key.importPublicKeyB64u,
      key.generation,
      key.issuedAtMs,
      key.expiresAtMs,
    )
    .run();

  const stored = await readImportKeyForRole(scope, key.role);
  if (stored !== null && stored.generation > key.generation) {
    throw new Error(`tenant-root restore ${key.role} import key generation regressed`);
  }
  if (stored === null || !sameImportKey(stored, key)) {
    throw new Error(`tenant-root restore ${key.role} import key write conflicted`);
  }
}

async function readInstalledImportForRole(
  scope: RestoreScope,
  role: TenantRootDeriverRoleV1,
): Promise<TenantRootRestoreInstalledImportV1 | null> {
  const row = await queryD1One(
    scope.database,
    `SELECT role, envelope_digest_b64u, receipt_digest_b64u
       FROM tenant_root_security_restore_installed_imports
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND destination_lineage_b64u = ?4
        AND role = ?5`,
    [...scopeValues(scope), role],
  );
  return row === null ? null : parseInstalledImportRow(row);
}

async function finalizeRoleImportForScope(
  scope: RestoreScope,
  input: Parameters<TenantRootRestoreStoreV1['finalizeRoleImport']>[0],
): ReturnType<TenantRootRestoreStoreV1['finalizeRoleImport']> {
  const values = [
    ...scopeValues(scope),
    input.installed.role,
    input.installed.envelopeDigestB64u,
    input.installed.receiptDigestB64u,
    input.sessionId,
    input.key.importKeyId,
    input.key.generation,
  ];
  const stateGate = `state.namespace = ?1 AND state.org_id = ?2
    AND state.identity_digest_b64u = ?3 AND state.destination_lineage_b64u = ?4
    AND json_extract(state.session_json, '$.sessionId') = ?8
    AND json_extract(state.session_json, '$.status') = 'awaiting_role_imports'`;
  const keyGate = `EXISTS (SELECT 1 FROM tenant_root_security_restore_import_keys AS key
    WHERE key.namespace = ?1 AND key.org_id = ?2 AND key.identity_digest_b64u = ?3
      AND key.destination_lineage_b64u = ?4 AND key.role = ?5
      AND key.import_key_id = ?9 AND key.generation = ?10)`;
  const receiptA = `(SELECT receipt_digest_b64u FROM tenant_root_security_restore_installed_imports
    WHERE namespace = ?1 AND org_id = ?2 AND identity_digest_b64u = ?3
      AND destination_lineage_b64u = ?4 AND role = 'deriver_a')`;
  const receiptB = `(SELECT receipt_digest_b64u FROM tenant_root_security_restore_installed_imports
    WHERE namespace = ?1 AND org_id = ?2 AND identity_digest_b64u = ?3
      AND destination_lineage_b64u = ?4 AND role = 'deriver_b')`;
  await scope.database.batch([
    scope.database
      .prepare(
        `INSERT INTO tenant_root_security_restore_installed_imports
      (namespace, org_id, identity_digest_b64u, destination_lineage_b64u, role, envelope_digest_b64u, receipt_digest_b64u)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
      WHERE EXISTS (SELECT 1 FROM tenant_root_security_restore_state AS state WHERE ${stateGate})
        AND ${keyGate}
      ON CONFLICT(namespace, org_id, identity_digest_b64u, destination_lineage_b64u, role) DO NOTHING`,
      )
      .bind(...values),
    scope.database
      .prepare(
        `UPDATE tenant_root_security_restore_state AS state SET session_json =
      CASE WHEN ${receiptA} IS NOT NULL AND ${receiptB} IS NOT NULL
        THEN json_object('status', 'verifying',
          'sessionId', json_extract(state.session_json, '$.sessionId'),
          'expiresAt', json_extract(state.session_json, '$.expiresAt'),
          'destinationFingerprintB64u', json_extract(state.session_json, '$.destinationFingerprintB64u'),
          'recoverySetId', json_extract(state.session_json, '$.recoverySetId'),
          'installationReceipts', json_object('deriverA', ${receiptA}, 'deriverB', ${receiptB}))
        ELSE json_set(state.session_json, '$.installed',
          CASE WHEN ?5 = 'deriver_a' THEN json_object('kind', 'deriver_a_installed', 'deriverAReceiptDigestB64u', ?7)
               ELSE json_object('kind', 'deriver_b_installed', 'deriverBReceiptDigestB64u', ?7) END)
      END, updated_at_ms = ?11
      WHERE ${stateGate} AND ${keyGate} AND EXISTS (
        SELECT 1 FROM tenant_root_security_restore_installed_imports AS installed
        WHERE installed.namespace = ?1 AND installed.org_id = ?2 AND installed.identity_digest_b64u = ?3
          AND installed.destination_lineage_b64u = ?4 AND installed.role = ?5
          AND installed.envelope_digest_b64u = ?6 AND installed.receipt_digest_b64u = ?7)`,
      )
      .bind(...values, scope.now()),
  ]);
  const state = parseRestoreStateRow(await readStateRow(scope), scope.identityDigestB64u);
  const installed = await readInstalledImportForRole(scope, input.installed.role);
  if (
    state.session === null ||
    state.session.sessionId !== input.sessionId ||
    (state.session.status !== 'awaiting_role_imports' && state.session.status !== 'verifying') ||
    installed?.envelopeDigestB64u !== input.installed.envelopeDigestB64u ||
    installed.receiptDigestB64u !== input.installed.receiptDigestB64u
  )
    return { kind: 'stale' };
  return { kind: 'finalized', session: state.session };
}

async function clearSessionMaterialForScope(scope: RestoreScope): Promise<void> {
  await scope.database.batch([
    scope.database
      .prepare(
        `UPDATE tenant_root_security_restore_state
            SET registered_manifest_json = NULL, updated_at_ms = ?5
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND json_extract(session_json, '$.status') = 'active'`,
      )
      .bind(...scopeValues(scope), scope.now()),
    scope.database
      .prepare(
        `DELETE FROM tenant_root_security_restore_import_keys
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_state AS state
               WHERE state.namespace = ?1
                 AND state.org_id = ?2
                 AND state.identity_digest_b64u = ?3
                 AND state.destination_lineage_b64u = ?4
                 AND json_extract(state.session_json, '$.status') = 'active'
            )`,
      )
      .bind(...scopeValues(scope)),
    scope.database
      .prepare(
        `DELETE FROM tenant_root_security_restore_installed_imports
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_state AS state
               WHERE state.namespace = ?1
                 AND state.org_id = ?2
                 AND state.identity_digest_b64u = ?3
                 AND state.destination_lineage_b64u = ?4
                 AND json_extract(state.session_json, '$.status') = 'active'
            )`,
      )
      .bind(...scopeValues(scope)),
    scope.database
      .prepare(
        `DELETE FROM tenant_root_security_restore_refresh_grants
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND destination_lineage_b64u = ?4
            AND EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_state AS state
               WHERE state.namespace = ?1
                 AND state.org_id = ?2
                 AND state.identity_digest_b64u = ?3
                 AND state.destination_lineage_b64u = ?4
                 AND json_extract(state.session_json, '$.status') = 'active'
            )`,
      )
      .bind(...scopeValues(scope)),
  ]);
}

async function readBootstrapSessionForDigest(
  scope: RestoreScope,
  tokenDigestB64u: string,
): Promise<TenantRootRestoreBootstrapSessionV1 | null> {
  const row = await queryD1One(
    scope.database,
    `SELECT token_digest_b64u, actor_user_id, authenticated_at_ms, expires_at_ms
       FROM tenant_root_security_restore_bootstrap_sessions
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND destination_lineage_b64u = ?4
        AND token_digest_b64u = ?5`,
    [...scopeValues(scope), requiredText(tokenDigestB64u, 'bootstrap token digest')],
  );
  return row === null ? null : parseBootstrapSessionRow(row);
}

function sameBootstrapSession(
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

async function putBootstrapSessionForScope(
  scope: RestoreScope,
  session: TenantRootRestoreBootstrapSessionV1,
): Promise<void> {
  await scope.database
    .prepare(
      `INSERT INTO tenant_root_security_restore_bootstrap_sessions (
         namespace, org_id, identity_digest_b64u, destination_lineage_b64u,
         token_digest_b64u, actor_user_id, authenticated_at_ms, expires_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (
         namespace, org_id, identity_digest_b64u, destination_lineage_b64u,
         token_digest_b64u
       ) DO NOTHING`,
    )
    .bind(
      ...scopeValues(scope),
      session.tokenDigestB64u,
      session.actorUserId,
      session.authenticatedAtMs,
      session.expiresAtMs,
    )
    .run();

  const stored = await readBootstrapSessionForDigest(scope, session.tokenDigestB64u);
  if (stored === null || !sameBootstrapSession(stored, session)) {
    throw new Error('tenant-root restore bootstrap session write conflicted');
  }
}

const RESTORE_ROLE_IMPORT_OPERATION_KIND_V1 =
  'tenant_root_restore_role_import_key_issue_v1' as const;

function operationValues(
  scope: RestoreScope,
  input: TenantRootRestoreRoleImportKeyIssueAdmissionInputV1,
): readonly unknown[] {
  const record = input.operationRecord;
  return [
    scope.namespace,
    scope.orgId,
    scope.identityDigestB64u,
    scope.destinationLineageB64u,
    input.authenticatedSession.tokenDigestB64u,
    input.authenticatedSession.actorUserId,
    input.authenticatedSession.authenticatedAtMs,
    input.authenticatedSession.expiresAtMs,
    input.nowMs,
    RESTORE_ROLE_IMPORT_OPERATION_KIND_V1,
    input.operationDigestB64u,
    input.canonicalRecordJson,
    record.idempotencyKey,
    record.requesterActorId,
    record.nonceB64u,
    Date.parse(record.issuedAt),
    Date.parse(record.expiresAt),
    record.role,
    record.restoreSessionIdB64u,
    record.destinationFingerprintB64u,
    record.subject.recoverySetId,
    record.manifestDigestB64u,
    record.generation,
    input.operationDigestB64u,
  ];
}

function restoreRoleImportAdmissionInsertSql(): string {
  return `INSERT INTO tenant_root_security_operations (
    namespace, operation_id, org_id, identity_digest_b64u, custody_lineage_b64u,
    operation_kind, trigger_kind, operation_digest_b64u, canonical_record_json,
    idempotency_key, requester_user_id, approver_user_id, nonce_b64u, status,
    created_at_ms, authorization_expires_at_ms, updated_at_ms
  )
  SELECT ?1, ?24, ?2, ?3, ?4, ?10, 'manual', ?11, ?12, ?13, ?14, NULL, ?15,
         'pending', ?16, ?17, ?16
   WHERE ${liveBootstrapSessionGateSql()}
     AND EXISTS (
       SELECT 1
         FROM tenant_root_security_restore_state AS state
        WHERE state.namespace = ?1
          AND state.org_id = ?2
          AND state.identity_digest_b64u = ?3
          AND state.destination_lineage_b64u = ?4
          AND json_extract(state.session_json, '$.status') = 'awaiting_role_imports'
          AND json_extract(state.session_json, '$.sessionId') = ?19
          AND json_extract(state.session_json, '$.destinationFingerprintB64u') = ?20
          AND json_extract(state.session_json, '$.recoverySetId') = ?21
          AND state.registered_manifest_json IS NOT NULL
          AND json_extract(state.registered_manifest_json, '$.descriptor.manifestDigestB64u') = ?22
     )
     AND NOT EXISTS (
       SELECT 1
         FROM tenant_root_security_restore_installed_imports AS installed
        WHERE installed.namespace = ?1
          AND installed.org_id = ?2
          AND installed.identity_digest_b64u = ?3
          AND installed.destination_lineage_b64u = ?4
          AND installed.role = ?18
     )
     AND (
       (?23 = 1 AND NOT EXISTS (
         SELECT 1
           FROM tenant_root_security_restore_import_keys AS prior
          WHERE prior.namespace = ?1
            AND prior.org_id = ?2
            AND prior.identity_digest_b64u = ?3
            AND prior.destination_lineage_b64u = ?4
            AND prior.role = ?18
       ))
       OR EXISTS (
         SELECT 1
           FROM tenant_root_security_restore_import_keys AS prior
          WHERE prior.namespace = ?1
            AND prior.org_id = ?2
            AND prior.identity_digest_b64u = ?3
            AND prior.destination_lineage_b64u = ?4
            AND prior.role = ?18
            AND prior.generation = ?23 - 1
       )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM tenant_root_security_operations AS pending
        WHERE pending.namespace = ?1
          AND pending.identity_digest_b64u = ?3
          AND pending.custody_lineage_b64u = ?4
          AND pending.operation_kind = ?10
          AND pending.status = 'pending'
          AND pending.idempotency_key <> ?13
          AND json_extract(pending.canonical_record_json, '$.role') = ?18
          AND json_extract(pending.canonical_record_json, '$.restoreSessionIdB64u') = ?19
     )
     AND NOT EXISTS (
       SELECT 1
         FROM tenant_root_security_operations AS prior
        WHERE prior.namespace = ?1
          AND prior.identity_digest_b64u = ?3
          AND prior.idempotency_key = ?13
     )`;
}

async function readPendingRoleImportOperationForScope(
  scope: RestoreScope,
  role: TenantRootDeriverRoleV1,
  sessionIdB64u: string,
  operationStore: TenantRootOperationStoreV1,
): Promise<TenantRootOperationEntryV1 | null> {
  const rows = await queryD1All(
    scope.database,
    `SELECT operation_id, operation_kind, trigger_kind, operation_digest_b64u,
            canonical_record_json, idempotency_key, requester_user_id,
            approver_user_id, nonce_b64u, status, created_at_ms,
            authorization_expires_at_ms, accepted_result_json, failure_code,
            dispatch_uncertain_at_ms
       FROM tenant_root_security_operations
      WHERE namespace = ?1
        AND identity_digest_b64u = ?2
        AND custody_lineage_b64u = ?3
        AND operation_kind = ?4
        AND status = 'pending'
        AND json_extract(canonical_record_json, '$.role') = ?5
        AND json_extract(canonical_record_json, '$.restoreSessionIdB64u') = ?6
      ORDER BY created_at_ms ASC
      LIMIT 1`,
    [
      scope.namespace,
      scope.identityDigestB64u,
      scope.destinationLineageB64u,
      RESTORE_ROLE_IMPORT_OPERATION_KIND_V1,
      role,
      sessionIdB64u,
    ],
  );
  const row = rows[0] ?? null;
  if (row === null) return null;
  const existing = await operationStore.findByIdempotencyKey(
    requiredText(row.idempotency_key, 'idempotency key'),
  );
  return existing;
}

async function admitRestoreRoleImportOperationForScope(
  scope: RestoreScope,
  readDestination: () => Promise<TenantRootDestinationStateV1>,
  operationStore: TenantRootOperationStoreV1,
  input: TenantRootRestoreRoleImportKeyIssueAdmissionInputV1,
): Promise<TenantRootRestoreRoleImportKeyIssueAdmissionV1> {
  const existing = await operationStore.findByIdempotencyKey(input.operationRecord.idempotencyKey);
  if (existing !== null) {
    return existing.operationDigestB64u === input.operationDigestB64u
      ? { kind: 'replayed', entry: existing }
      : { kind: 'idempotency_conflict' };
  }
  if ((await readDestination()).kind !== 'empty') return { kind: 'destination_not_empty' };

  const values = operationValues(scope, input);
  const inserted = await scope.database
    .prepare(restoreRoleImportAdmissionInsertSql())
    .bind(...values.slice(0, 23), values[23])
    .run();
  if (d1ChangedRows(inserted) === 1) {
    const admitted = await operationStore.findByIdempotencyKey(
      input.operationRecord.idempotencyKey,
    );
    if (admitted === null) throw new Error('tenant-root restore operation admission disappeared');
    return { kind: 'admitted', entry: admitted };
  }

  const raced = await operationStore.findByIdempotencyKey(input.operationRecord.idempotencyKey);
  if (raced !== null) {
    return raced.operationDigestB64u === input.operationDigestB64u
      ? { kind: 'replayed', entry: raced }
      : { kind: 'idempotency_conflict' };
  }
  const pending = await readPendingRoleImportOperationForScope(
    scope,
    input.operationRecord.role,
    input.operationRecord.restoreSessionIdB64u,
    operationStore,
  );
  if (pending !== null) return { kind: 'role_operation_pending' };

  const storedBootstrap = await readBootstrapSessionForDigest(
    scope,
    input.authenticatedSession.tokenDigestB64u,
  );
  if (!sameBootstrapSessionAtTime(storedBootstrap, input.authenticatedSession, input.nowMs)) {
    return { kind: 'bootstrap_authentication_failed' };
  }
  const state = parseRestoreStateRow(await readStateRow(scope), scope.identityDigestB64u);
  if (state.session === null || state.session.status === 'awaiting_manifest') {
    return { kind: 'session_not_started' };
  }
  if (
    state.session.status !== 'awaiting_role_imports' ||
    state.registeredManifest === null ||
    state.session.sessionId !== input.operationRecord.restoreSessionIdB64u
  ) {
    return { kind: 'manifest_not_registered' };
  }
  if (
    state.registeredManifest.descriptor.manifestDigestB64u !==
    input.operationRecord.manifestDigestB64u
  ) {
    return { kind: 'manifest_not_registered' };
  }
  const installed = await readInstalledImportForRole(scope, input.operationRecord.role);
  if (installed !== null) return { kind: 'role_share_already_installed' };
  const prior = await readImportKeyForRole(scope, input.operationRecord.role);
  if (
    (prior === null && input.operationRecord.generation !== 1) ||
    (prior !== null && prior.generation !== input.operationRecord.generation - 1)
  ) {
    return { kind: 'generation_conflict' };
  }
  return { kind: 'generation_conflict' };
}

async function finalizeRestoreRoleImportOperationForScope(
  scope: RestoreScope,
  operationStore: TenantRootOperationStoreV1,
  input: {
    readonly entry: TenantRootOperationEntryV1;
    readonly response: TenantRootRestoreRoleImportKeyIssueResponseV1;
    readonly key: TenantRootRestoreRoleImportKeyV1;
  },
): Promise<TenantRootOperationEntryV1> {
  const acceptedResultJson = JSON.stringify(input.response);
  const updatedAtMs = scope.now();
  const results = await scope.database.batch<D1ResultLike>([
    scope.database
      .prepare(
        `UPDATE tenant_root_security_operations
            SET status = 'accepted', accepted_result_json = ?1, updated_at_ms = ?2
          WHERE namespace = ?3
            AND identity_digest_b64u = ?4
            AND operation_id = ?5
            AND operation_digest_b64u = ?6
            AND status = 'pending'
            AND json_extract(canonical_record_json, '$.role') = ?9
            AND json_extract(canonical_record_json, '$.generation') = ?10
            AND json_extract(canonical_record_json, '$.importKeyId') = ?11
            AND EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_state AS state
               WHERE state.namespace = ?3
                 AND state.org_id = ?7
                 AND state.identity_digest_b64u = ?4
                 AND state.destination_lineage_b64u = ?8
                 AND json_extract(state.session_json, '$.status') = 'awaiting_role_imports'
                 AND json_extract(state.session_json, '$.sessionId') =
                     json_extract(tenant_root_security_operations.canonical_record_json, '$.restoreSessionIdB64u')
                 AND json_extract(state.session_json, '$.destinationFingerprintB64u') =
                     json_extract(tenant_root_security_operations.canonical_record_json, '$.destinationFingerprintB64u')
                 AND json_extract(state.session_json, '$.recoverySetId') =
                     json_extract(tenant_root_security_operations.canonical_record_json, '$.subject.recoverySetId')
                 AND state.registered_manifest_json IS NOT NULL
                 AND json_extract(state.registered_manifest_json, '$.descriptor.manifestDigestB64u') =
                     json_extract(tenant_root_security_operations.canonical_record_json, '$.manifestDigestB64u')
            )
            AND NOT EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_installed_imports AS installed
               WHERE installed.namespace = ?3
                 AND installed.org_id = ?7
                 AND installed.identity_digest_b64u = ?4
                 AND installed.destination_lineage_b64u = ?8
                 AND installed.role = ?9
            )
            AND (
              (?10 = 1 AND NOT EXISTS (
                SELECT 1
                  FROM tenant_root_security_restore_import_keys AS prior
                 WHERE prior.namespace = ?3
                   AND prior.org_id = ?7
                   AND prior.identity_digest_b64u = ?4
                   AND prior.destination_lineage_b64u = ?8
                   AND prior.role = ?9
              ))
              OR EXISTS (
                SELECT 1
                  FROM tenant_root_security_restore_import_keys AS prior
                 WHERE prior.namespace = ?3
                   AND prior.org_id = ?7
                   AND prior.identity_digest_b64u = ?4
                   AND prior.destination_lineage_b64u = ?8
                   AND prior.role = ?9
                   AND prior.generation = ?10 - 1
              )
            )
            AND NOT EXISTS (
              SELECT 1
                FROM tenant_root_security_restore_import_keys AS prior
               WHERE prior.namespace = ?3
                 AND prior.org_id = ?7
                 AND prior.identity_digest_b64u = ?4
                 AND prior.destination_lineage_b64u = ?8
                 AND prior.role = ?9
                 AND prior.generation >= ?10
            )`,
      )
      .bind(
        acceptedResultJson,
        updatedAtMs,
        scope.namespace,
        scope.identityDigestB64u,
        input.entry.operationId,
        input.entry.operationDigestB64u,
        scope.orgId,
        scope.destinationLineageB64u,
        input.key.role,
        input.key.generation,
        input.key.importKeyId,
      ),
    scope.database
      .prepare(
        `INSERT INTO tenant_root_security_restore_import_keys (
           namespace, org_id, identity_digest_b64u, destination_lineage_b64u,
           role, import_key_id, import_public_key_b64u, generation,
           issued_at_ms, expires_at_ms
         )
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
          WHERE EXISTS (
            SELECT 1
              FROM tenant_root_security_operations AS operation
             WHERE operation.namespace = ?1
               AND operation.org_id = ?2
               AND operation.identity_digest_b64u = ?3
               AND operation.custody_lineage_b64u = ?4
               AND operation.operation_id = ?11
               AND operation.operation_digest_b64u = ?12
               AND operation.status = 'accepted'
               AND json_extract(operation.canonical_record_json, '$.role') = ?5
               AND json_extract(operation.canonical_record_json, '$.importKeyId') = ?6
               AND json_extract(operation.canonical_record_json, '$.generation') = ?8
               AND EXISTS (
                 SELECT 1
                   FROM tenant_root_security_restore_state AS state
                  WHERE state.namespace = ?1
                    AND state.org_id = ?2
                    AND state.identity_digest_b64u = ?3
                    AND state.destination_lineage_b64u = ?4
                    AND json_extract(state.session_json, '$.status') = 'awaiting_role_imports'
                    AND json_extract(state.session_json, '$.sessionId') =
                        json_extract(operation.canonical_record_json, '$.restoreSessionIdB64u')
                    AND json_extract(state.session_json, '$.destinationFingerprintB64u') =
                        json_extract(operation.canonical_record_json, '$.destinationFingerprintB64u')
                    AND json_extract(state.session_json, '$.recoverySetId') =
                        json_extract(operation.canonical_record_json, '$.subject.recoverySetId')
                    AND state.registered_manifest_json IS NOT NULL
                    AND json_extract(state.registered_manifest_json, '$.descriptor.manifestDigestB64u') =
                        json_extract(operation.canonical_record_json, '$.manifestDigestB64u')
               )
               AND NOT EXISTS (
                 SELECT 1
                   FROM tenant_root_security_restore_installed_imports AS installed
                  WHERE installed.namespace = ?1
                    AND installed.org_id = ?2
                    AND installed.identity_digest_b64u = ?3
                    AND installed.destination_lineage_b64u = ?4
                    AND installed.role = ?5
               )
               AND (
                 (?8 = 1 AND NOT EXISTS (
                   SELECT 1
                     FROM tenant_root_security_restore_import_keys AS prior
                    WHERE prior.namespace = ?1
                      AND prior.org_id = ?2
                      AND prior.identity_digest_b64u = ?3
                      AND prior.destination_lineage_b64u = ?4
                      AND prior.role = ?5
                 ))
                 OR EXISTS (
                   SELECT 1
                     FROM tenant_root_security_restore_import_keys AS prior
                    WHERE prior.namespace = ?1
                      AND prior.org_id = ?2
                      AND prior.identity_digest_b64u = ?3
                      AND prior.destination_lineage_b64u = ?4
                      AND prior.role = ?5
                      AND prior.generation = ?8 - 1
                 )
               )
          )
         ON CONFLICT (
           namespace, org_id, identity_digest_b64u, destination_lineage_b64u, role
         ) DO UPDATE SET
           import_key_id = excluded.import_key_id,
           import_public_key_b64u = excluded.import_public_key_b64u,
           generation = excluded.generation,
           issued_at_ms = excluded.issued_at_ms,
           expires_at_ms = excluded.expires_at_ms
         WHERE excluded.generation > tenant_root_security_restore_import_keys.generation`,
      )
      .bind(
        scope.namespace,
        scope.orgId,
        scope.identityDigestB64u,
        scope.destinationLineageB64u,
        input.key.role,
        input.key.importKeyId,
        input.key.importPublicKeyB64u,
        input.key.generation,
        input.key.issuedAtMs,
        input.key.expiresAtMs,
        input.entry.operationId,
        input.entry.operationDigestB64u,
      ),
  ]);
  if (results[0] === undefined || d1ChangedRows(results[0]) === 0) {
    const existing = await operationStore.findByIdempotencyKey(input.entry.idempotencyKey);
    if (existing === null || existing.status !== 'accepted') {
      throw new Error('tenant-root restore operation finalization lost its compare-and-swap');
    }
  }
  const stored = await readImportKeyForRole(scope, input.key.role);
  if (stored === null || !sameImportKey(stored, input.key)) {
    throw new Error('tenant-root restore import key finalization conflicted');
  }
  const accepted = await operationStore.findByIdempotencyKey(input.entry.idempotencyKey);
  if (accepted === null) throw new Error('tenant-root restore accepted operation disappeared');
  return accepted;
}

class D1TenantRootRestoreStoreV1
  implements TenantRootRestoreStoreV1, TenantRootRestoreRoleImportOperationStoreV1
{
  private readonly scope: RestoreScope;
  private readonly readDestination: () => Promise<TenantRootDestinationStateV1>;
  private readonly operationStore: TenantRootOperationStoreV1;

  constructor(options: D1TenantRootRestoreStoreOptionsV1) {
    this.scope = {
      database: options.database,
      namespace: requiredText(options.namespace, 'namespace'),
      orgId: requiredText(options.orgId, 'org id'),
      identityDigestB64u: requiredText(options.identityDigestB64u, 'identity digest'),
      destinationLineageB64u: requiredText(options.destinationLineageB64u, 'destination lineage'),
      now: options.now ?? systemNow,
    };
    this.readDestination = options.readDestination;
    this.operationStore = createD1TenantRootOperationStoreV1({
      database: options.database,
      namespace: this.scope.namespace,
      orgId: this.scope.orgId,
      identityDigestB64u: this.scope.identityDigestB64u,
      custodyLineageB64u: this.scope.destinationLineageB64u,
      now: this.scope.now,
    });
  }

  readContext(): Promise<TenantRootRestoreContextV1> {
    return readContextForScope(this.scope, this.readDestination);
  }

  admitSessionStart(
    input: TenantRootRestoreSessionStartAdmissionInputV1,
  ): Promise<TenantRootRestoreSessionStartAdmissionV1> {
    return admitSessionStartForScope(this.scope, input);
  }

  finalizeExpiredSession(
    input: TenantRootRestoreExpiredSessionFinalizationInputV1,
  ): Promise<TenantRootRestoreExpiredSessionFinalizationV1> {
    return finalizeExpiredSessionForScope(this.scope, input);
  }

  admitRestoreRefreshGrant(input: {
    readonly expectedSessionId: string;
    readonly grant: SignedTenantRootRestoreRefreshGrantV1;
    readonly nowMs: number;
  }): Promise<TenantRootRestoreRefreshGrantAdmissionV1> {
    return admitRestoreRefreshGrantForScope(this.scope, input);
  }

  readRestoreRefreshGrant(
    sessionId: string,
  ): Promise<SignedTenantRootRestoreRefreshGrantV1 | null> {
    return readRestoreRefreshGrantForScope(this.scope, sessionId);
  }

  putSession(session: TenantRootRestoreSessionV1): Promise<void> {
    return putSessionForScope(this.scope, session);
  }

  putRegisteredManifest(
    manifest: TenantRootRestoreRegisteredManifestV1,
    manifestB64u: string,
  ): Promise<void> {
    return putManifestForScope(this.scope, manifest, manifestB64u);
  }

  putRoleImportKey(key: TenantRootRestoreRoleImportKeyV1): Promise<void> {
    return putRoleImportKeyForScope(this.scope, key);
  }

  finalizeRoleImport(
    input: Parameters<TenantRootRestoreStoreV1['finalizeRoleImport']>[0],
  ): ReturnType<TenantRootRestoreStoreV1['finalizeRoleImport']> {
    return finalizeRoleImportForScope(this.scope, input);
  }

  clearSessionMaterial(): Promise<void> {
    return clearSessionMaterialForScope(this.scope);
  }

  putBootstrapSession(session: TenantRootRestoreBootstrapSessionV1): Promise<void> {
    return putBootstrapSessionForScope(this.scope, session);
  }

  findBootstrapSession(
    tokenDigestB64u: string,
  ): Promise<TenantRootRestoreBootstrapSessionV1 | null> {
    return readBootstrapSessionForDigest(this.scope, tokenDigestB64u);
  }

  findRestoreRoleImportOperation(operationId: string): Promise<TenantRootOperationEntryV1 | null> {
    return this.operationStore.findByIdempotencyKey(operationId);
  }

  async findRestoreRoleImportOperationForKey(
    role: TenantRootDeriverRoleV1,
    importKeyId: string,
  ): Promise<TenantRootOperationEntryV1 | null> {
    const rows = await queryD1All(
      this.scope.database,
      `SELECT idempotency_key FROM tenant_root_security_operations
        WHERE namespace = ?1 AND org_id = ?2 AND identity_digest_b64u = ?3
          AND custody_lineage_b64u = ?4 AND operation_kind = ?5 AND status = 'accepted'
          AND json_extract(canonical_record_json, '$.role') = ?6
          AND json_extract(canonical_record_json, '$.importKeyId') = ?7`,
      [
        this.scope.namespace,
        this.scope.orgId,
        this.scope.identityDigestB64u,
        this.scope.destinationLineageB64u,
        RESTORE_ROLE_IMPORT_OPERATION_KIND_V1,
        role,
        importKeyId,
      ],
    );
    if (rows.length !== 1) return null;
    return this.operationStore.findByIdempotencyKey(
      requiredText(rows[0].idempotency_key, 'idempotency key'),
    );
  }

  admitRestoreRoleImportOperation(
    input: TenantRootRestoreRoleImportKeyIssueAdmissionInputV1,
  ): Promise<TenantRootRestoreRoleImportKeyIssueAdmissionV1> {
    return admitRestoreRoleImportOperationForScope(
      this.scope,
      this.readDestination,
      this.operationStore,
      input,
    );
  }

  markRestoreRoleImportDispatchUncertain(
    operationId: string,
    atMs: number,
  ): Promise<TenantRootOperationEntryV1> {
    return this.operationStore.markDispatchUncertain(operationId, atMs);
  }

  finalizeRestoreRoleImportOperation(input: {
    readonly entry: TenantRootOperationEntryV1;
    readonly response: TenantRootRestoreRoleImportKeyIssueResponseV1;
    readonly key: TenantRootRestoreRoleImportKeyV1;
  }): Promise<TenantRootOperationEntryV1> {
    return finalizeRestoreRoleImportOperationForScope(this.scope, this.operationStore, input);
  }

  failRestoreRoleImportOperation(
    operationId: string,
    failureCode: string,
  ): Promise<TenantRootOperationEntryV1> {
    return this.operationStore.markFailed(operationId, failureCode);
  }
}

/** Creates a D1-backed restore store without mounting the restore routes. */
export function createD1TenantRootRestoreStoreV1(
  options: D1TenantRootRestoreStoreOptionsV1,
): TenantRootRestoreStoreV1 & TenantRootRestoreRoleImportOperationStoreV1 {
  return new D1TenantRootRestoreStoreV1(options);
}

/** Resolves only a fully activated restore; partial cleanup cannot select a signing lineage. */
export async function findD1RestoredTenantRootActiveLineageV1(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly identityDigestB64u: string;
}): Promise<{
  readonly custodyLineageB64u: string;
  readonly rootCommitmentB64u: string;
  readonly restore: Extract<TenantRootRestoreSessionV1, { status: 'active' }>;
} | null> {
  const rows = await queryD1All(
    input.database,
    `SELECT session_json, destination_lineage_b64u FROM tenant_root_security_restore_state
     WHERE namespace = ?1 AND org_id = ?2 AND identity_digest_b64u = ?3
       AND json_extract(session_json, '$.status') = 'active' LIMIT 2`,
    [input.namespace, input.orgId, input.identityDigestB64u],
  );
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error('Tenant identity has multiple active restored lineages');
  const row = rows[0];
  const session = parseSessionColumn(row.session_json);
  if (
    session?.status !== 'active' ||
    session.destinationLineageId !== row.destination_lineage_b64u
  ) {
    throw new Error('Active restore lineage differs from its persisted scope');
  }
  return {
    custodyLineageB64u: session.destinationLineageId,
    rootCommitmentB64u: session.rootCommitmentB64u,
    restore: session,
  };
}
