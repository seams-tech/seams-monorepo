import {
  d1ChangedRows,
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
  type D1Row,
} from '@seams/wallet-server/cloud-host';
import {
  tenantRootDownloadableRecoverySetV1,
  type TenantRootDeriverRoleV1,
  type TenantRootDownloadEvidenceV1,
  type TenantRootOutstandingCleanupV1,
  type TenantRootRecipientEnrolmentV1,
  type TenantRootRecoveryBackupV1,
  type TenantRootRecoveryGovernanceV1,
  type TenantRootRecipientPairV1,
  type TenantRootRecoverySetStateV1,
  type TenantRootRoleReceiptsV1,
  type TenantRootSourceCustodyDispositionV1,
  type TenantRootTrustLevelV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import type { TenantRootCustodyStateV1, TenantRootCustodyStoreV1 } from './custodyService';
import type {
  TenantRootRecipientChallengeRecordV1,
  TenantRootStagedRecipientV1,
} from './recipients';
import type { TenantRootDownloadArtifactV1 } from './recoverySets';

/** Current root facts supplied by the authoritative control-plane reader. */
export type TenantRootCurrentRootStateV1 = {
  readonly lifecycleRevision: number;
  readonly rootCommitmentB64u: string;
};

/**
 * D1 persistence for one tenant custody scope.
 *
 * The store interface exposes take, consume, and staging as separate
 * operations. Each statement is atomic, while the external verification
 * window has no compare-and-swap token. Callers must serialize that sequence;
 * consumeChallenge conditionally accepts one unconsumed row and rejects a
 * losing consume before staging.
 */
export interface D1TenantRootCustodyStoreOptionsV1 {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  /** Reads current lifecycle facts; persisted state never replaces this authority. */
  readonly readRoot: () => Promise<TenantRootCurrentRootStateV1>;
  readonly now?: () => number;
}

type CustodyScope = {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly now: () => number;
};

type StateJsonUpdate =
  | { readonly column: 'governance_json'; readonly value: TenantRootRecoveryGovernanceV1 }
  | { readonly column: 'backup_json'; readonly value: TenantRootRecoveryBackupV1 }
  | { readonly column: 'recipient_pair_json'; readonly value: TenantRootRecipientPairV1 }
  | {
      readonly column: 'source_disposition_json';
      readonly value: TenantRootSourceCustodyDispositionV1;
    };

const STATE_COLUMNS = `
  namespace, org_id, identity_digest_b64u, custody_lineage_b64u,
  lifecycle_revision, root_commitment_b64u, governance_json, backup_json,
  recipient_pair_json, source_disposition_json, updated_at_ms
`;

function systemNow(): number {
  return Date.now();
}

function invalid(label: string): never {
  throw new Error(`tenant-root custody ${label} is invalid`);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return invalid(label);
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
  if (!Number.isSafeInteger(parsed)) return invalid(label);
  return parsed;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  const parsed = requiredInteger(value, label);
  if (parsed <= 0) return invalid(label);
  return parsed;
}

function optionalInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return requiredInteger(value, label);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) return invalid(label);
  return value;
}

function recordValue(record: Record<string, unknown>, key: string, label: string): unknown {
  if (!(key in record)) return invalid(`${label}.${key}`);
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

function parseJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) return invalid(label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalid(label);
  }
  return requiredRecord(parsed, label);
}

function parseNullableJson<T>(
  value: unknown,
  label: string,
  parser: (value: unknown, label: string) => T,
): T | null {
  if (value === null || value === undefined) return null;
  return parser(parseJsonRecord(value, label), label);
}

function parseRole(value: unknown, label: string): TenantRootDeriverRoleV1 {
  if (value === 'deriver_a' || value === 'deriver_b') return value;
  return invalid(label);
}

function parseTrustLevel(value: unknown, label: string): TenantRootTrustLevelV1 {
  const record = requiredRecord(value, label);
  const kind = recordText(record, 'kind', label);
  switch (kind) {
    case 'cryptographically_valid_offline':
      return { kind };
    case 'valid_at_trust_snapshot':
      return {
        kind,
        snapshotVersion: recordPositiveInteger(record, 'snapshotVersion', label),
        snapshotIssuedAt: recordText(record, 'snapshotIssuedAt', label),
      };
    case 'current_trust_confirmed':
      return {
        kind,
        snapshotVersion: recordPositiveInteger(record, 'snapshotVersion', label),
        snapshotIssuedAt: recordText(record, 'snapshotIssuedAt', label),
        checkedAt: recordText(record, 'checkedAt', label),
      };
    default:
      return invalid(`${label}.kind`);
  }
}

function parseGovernance(value: unknown, label: string): TenantRootRecoveryGovernanceV1 {
  const record = requiredRecord(value, label);
  const kind = recordText(record, 'kind', label);
  switch (kind) {
    case 'single_owner_v1': {
      const warningVersion = recordText(record, 'warningVersion', label);
      if (warningVersion !== 'tenant_root_single_owner_v1') {
        return invalid(`${label}.warningVersion`);
      }
      return {
        kind,
        acknowledgedByOwnerId: recordText(record, 'acknowledgedByOwnerId', label),
        acknowledgedAt: recordText(record, 'acknowledgedAt', label),
        warningVersion,
      };
    }
    case 'two_person_v1':
      return {
        kind,
        selectedByOwnerId: recordText(record, 'selectedByOwnerId', label),
        selectedAt: recordText(record, 'selectedAt', label),
      };
    default:
      return invalid(`${label}.kind`);
  }
}

function parseRoleReceipts(value: unknown, label: string): TenantRootRoleReceiptsV1 {
  const record = requiredRecord(value, label);
  return {
    deriverA: recordText(record, 'deriverA', label),
    deriverB: recordText(record, 'deriverB', label),
  };
}

function parseOutstandingCleanup(value: unknown, label: string): TenantRootOutstandingCleanupV1 {
  const record = requiredRecord(value, label);
  const rawRoles = recordValue(record, 'roles', label);
  if (!Array.isArray(rawRoles)) return invalid(`${label}.roles`);
  const roles: TenantRootDeriverRoleV1[] = [];
  for (const role of rawRoles) roles.push(parseRole(role, `${label}.roles`));
  return {
    roles,
    description: recordText(record, 'description', label),
  };
}

function parseDownloadEvidence(value: unknown, label: string): TenantRootDownloadEvidenceV1 {
  const record = requiredRecord(value, label);
  const kind = recordText(record, 'kind', label);
  switch (kind) {
    case 'never_downloaded':
      return { kind };
    case 'download_issued':
      return {
        kind,
        issuedAt: recordText(record, 'issuedAt', label),
        actorUserId: recordText(record, 'actorUserId', label),
        contentDigestB64u: recordText(record, 'contentDigestB64u', label),
      };
    case 'durable_verified':
      return {
        kind,
        verifiedAt: recordText(record, 'verifiedAt', label),
        actorUserId: recordText(record, 'actorUserId', label),
        contentDigestB64u: recordText(record, 'contentDigestB64u', label),
        trustLevel: parseTrustLevel(
          recordValue(record, 'trustLevel', label),
          `${label}.trustLevel`,
        ),
      };
    default:
      return invalid(`${label}.kind`);
  }
}

function parseRecipientPair(value: unknown, label: string): TenantRootRecipientPairV1 {
  const record = requiredRecord(value, label);
  return {
    deriverAFingerprintB64u: recordText(record, 'deriverAFingerprintB64u', label),
    deriverBFingerprintB64u: recordText(record, 'deriverBFingerprintB64u', label),
  };
}

function parseRecoverySet(value: unknown, label: string): TenantRootRecoverySetStateV1 {
  const record = requiredRecord(value, label);
  return {
    recoverySetId: recordText(record, 'recoverySetId', label),
    recipientPair: parseRecipientPair(
      recordValue(record, 'recipientPair', label),
      `${label}.recipientPair`,
    ),
    createdAt: recordText(record, 'createdAt', label),
    rootCommitmentFingerprintB64u: recordText(record, 'rootCommitmentFingerprintB64u', label),
    deriverAPackage: parseDownloadEvidence(
      recordValue(record, 'deriverAPackage', label),
      `${label}.deriverAPackage`,
    ),
    deriverBPackage: parseDownloadEvidence(
      recordValue(record, 'deriverBPackage', label),
      `${label}.deriverBPackage`,
    ),
    manifest: parseDownloadEvidence(recordValue(record, 'manifest', label), `${label}.manifest`),
  };
}

function parseRecipientEnrolment(value: unknown, label: string): TenantRootRecipientEnrolmentV1 {
  const record = requiredRecord(value, label);
  const kind = recordText(record, 'kind', label);
  switch (kind) {
    case 'neither_enrolled':
      return { kind };
    case 'deriver_a_enrolled':
      return {
        kind,
        deriverAFingerprintB64u: recordText(record, 'deriverAFingerprintB64u', label),
      };
    case 'deriver_b_enrolled':
      return {
        kind,
        deriverBFingerprintB64u: recordText(record, 'deriverBFingerprintB64u', label),
      };
    default:
      return invalid(`${label}.kind`);
  }
}

function parseRecoveryBackup(value: unknown, label: string): TenantRootRecoveryBackupV1 {
  const record = requiredRecord(value, label);
  const status = recordText(record, 'status', label);
  switch (status) {
    case 'not_configured':
      return { status };
    case 'recipients_pending':
      return {
        status,
        governance: parseGovernance(
          recordValue(record, 'governance', label),
          `${label}.governance`,
        ),
        enrolled: parseRecipientEnrolment(
          recordValue(record, 'enrolled', label),
          `${label}.enrolled`,
        ),
      };
    case 'preparing_initial':
      return {
        status,
        governance: parseGovernance(
          recordValue(record, 'governance', label),
          `${label}.governance`,
        ),
        recipientPair: parseRecipientPair(
          recordValue(record, 'recipientPair', label),
          `${label}.recipientPair`,
        ),
        pendingRecoverySetId: recordText(record, 'pendingRecoverySetId', label),
      };
    case 'ready':
      return {
        status,
        governance: parseGovernance(
          recordValue(record, 'governance', label),
          `${label}.governance`,
        ),
        active: parseRecoverySet(recordValue(record, 'active', label), `${label}.active`),
      };
    case 'replacing':
      return {
        status,
        governance: parseGovernance(
          recordValue(record, 'governance', label),
          `${label}.governance`,
        ),
        active: parseRecoverySet(recordValue(record, 'active', label), `${label}.active`),
        pendingRecipientPair: parseRecipientPair(
          recordValue(record, 'pendingRecipientPair', label),
          `${label}.pendingRecipientPair`,
        ),
        pendingRecoverySetId: recordText(record, 'pendingRecoverySetId', label),
      };
    case 'failed_initial':
      return {
        status,
        governance: parseGovernance(
          recordValue(record, 'governance', label),
          `${label}.governance`,
        ),
        failureCode: recordText(record, 'failureCode', label),
        cleanupReceipts: parseRoleReceipts(
          recordValue(record, 'cleanupReceipts', label),
          `${label}.cleanupReceipts`,
        ),
      };
    case 'failed_replacement':
      return {
        status,
        governance: parseGovernance(
          recordValue(record, 'governance', label),
          `${label}.governance`,
        ),
        active: parseRecoverySet(recordValue(record, 'active', label), `${label}.active`),
        failureCode: recordText(record, 'failureCode', label),
        cleanupReceipts: parseRoleReceipts(
          recordValue(record, 'cleanupReceipts', label),
          `${label}.cleanupReceipts`,
        ),
      };
    case 'cleanup_incomplete':
      return {
        status,
        governance: parseGovernance(
          recordValue(record, 'governance', label),
          `${label}.governance`,
        ),
        active:
          recordValue(record, 'active', label) === null
            ? null
            : parseRecoverySet(recordValue(record, 'active', label), `${label}.active`),
        outstanding: parseOutstandingCleanup(
          recordValue(record, 'outstanding', label),
          `${label}.outstanding`,
        ),
      };
    case 'tenant_held_external':
      return {
        status,
        governance: parseGovernance(
          recordValue(record, 'governance', label),
          `${label}.governance`,
        ),
        recoverySetId: recordText(record, 'recoverySetId', label),
        manifestDigestB64u: recordText(record, 'manifestDigestB64u', label),
      };
    default:
      return invalid(`${label}.status`);
  }
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
    case 'unavailable_retirement_unverified': {
      const rawChecks = recordValue(record, 'attemptedChecks', label);
      if (!Array.isArray(rawChecks)) return invalid(`${label}.attemptedChecks`);
      const attemptedChecks: string[] = [];
      for (const check of rawChecks) {
        attemptedChecks.push(requiredText(check, `${label}.attemptedChecks`));
      }
      return {
        kind,
        attemptedChecks,
        recordedByUserId: recordText(record, 'recordedByUserId', label),
        recordedAt: recordText(record, 'recordedAt', label),
      };
    }
    case 'retained_as_backup':
      return {
        kind,
        acknowledgedByUserId: recordText(record, 'acknowledgedByUserId', label),
        incidentResponseNote: recordText(record, 'incidentResponseNote', label),
        recordedAt: recordText(record, 'recordedAt', label),
      };
    default:
      return invalid(`${label}.kind`);
  }
}

function normalizeCurrentRoot(value: unknown): TenantRootCurrentRootStateV1 {
  const record = requiredRecord(value, 'current root state');
  return {
    lifecycleRevision: recordPositiveInteger(record, 'lifecycleRevision', 'current root state'),
    rootCommitmentB64u: recordText(record, 'rootCommitmentB64u', 'current root state'),
  };
}

function assertScope(row: D1Row, scope: CustodyScope): void {
  if (requiredText(row.namespace, 'row namespace') !== scope.namespace)
    return invalid('row namespace');
  if (requiredText(row.org_id, 'row org id') !== scope.orgId) return invalid('row org id');
  if (requiredText(row.identity_digest_b64u, 'row identity digest') !== scope.identityDigestB64u) {
    return invalid('row identity digest');
  }
  if (requiredText(row.custody_lineage_b64u, 'row custody lineage') !== scope.custodyLineageB64u) {
    return invalid('row custody lineage');
  }
}

function parseStateRow(
  row: D1Row,
  scope: CustodyScope,
  currentRoot: TenantRootCurrentRootStateV1,
): TenantRootCustodyStateV1 {
  assertScope(row, scope);
  const persistedRevision = requiredPositiveInteger(
    row.lifecycle_revision,
    'persisted lifecycle revision',
  );
  const persistedCommitment = requiredText(row.root_commitment_b64u, 'persisted root commitment');
  if (persistedCommitment !== currentRoot.rootCommitmentB64u) {
    return invalid('persisted root commitment disagrees with current root');
  }
  if (persistedRevision > currentRoot.lifecycleRevision) {
    return invalid('current lifecycle revision regressed');
  }
  requiredPositiveInteger(row.updated_at_ms, 'state updated time');
  return {
    orgId: scope.orgId,
    identityDigestB64u: scope.identityDigestB64u,
    custodyLineageB64u: scope.custodyLineageB64u,
    lifecycleRevision: currentRoot.lifecycleRevision,
    rootCommitmentB64u: currentRoot.rootCommitmentB64u,
    governance: parseNullableJson(row.governance_json, 'governance_json', parseGovernance),
    backup: parseRecoveryBackup(parseJsonRecord(row.backup_json, 'backup_json'), 'backup_json'),
    stagedRecipients: [],
    recipientPair: parseNullableJson(
      row.recipient_pair_json,
      'recipient_pair_json',
      parseRecipientPair,
    ),
    sourceDisposition: parseNullableJson(
      row.source_disposition_json,
      'source_disposition_json',
      parseSourceDisposition,
    ),
  };
}

function parseChallengeRow(row: D1Row, scope: CustodyScope): TenantRootRecipientChallengeRecordV1 {
  assertScope(row, scope);
  const issuedAtMs = requiredPositiveInteger(row.issued_at_ms, 'challenge issued time');
  const expiresAtMs = requiredPositiveInteger(row.expires_at_ms, 'challenge expiry');
  const consumedAtMs = optionalInteger(row.consumed_at_ms, 'challenge consumed time');
  if (expiresAtMs <= issuedAtMs) return invalid('challenge expiry');
  if (consumedAtMs !== null && consumedAtMs < issuedAtMs) {
    return invalid('challenge consumed time');
  }
  return {
    challengeIdB64u: requiredText(row.challenge_id_b64u, 'challenge id'),
    expectedConfirmationB64u: requiredText(
      row.expected_confirmation_b64u,
      'challenge confirmation verifier',
    ),
    role: parseRole(row.role, 'challenge role'),
    recipientPublicKeyB64u: requiredText(
      row.recipient_public_key_b64u,
      'challenge recipient public key',
    ),
    recipientFingerprintB64u: requiredText(
      row.recipient_fingerprint_b64u,
      'challenge recipient fingerprint',
    ),
    actorUserId: requiredText(row.actor_user_id, 'challenge actor'),
    lifecycleRevision: requiredPositiveInteger(
      row.lifecycle_revision,
      'challenge lifecycle revision',
    ),
    issuedAtMs,
    expiresAtMs,
    consumedAtMs,
  };
}

function parseStagedRecipientRow(row: D1Row, scope: CustodyScope): TenantRootStagedRecipientV1 {
  assertScope(row, scope);
  return {
    role: parseRole(row.role, 'staged recipient role'),
    recipientPublicKeyB64u: requiredText(
      row.recipient_public_key_b64u,
      'staged recipient public key',
    ),
    recipientFingerprintB64u: requiredText(
      row.recipient_fingerprint_b64u,
      'staged recipient fingerprint',
    ),
    verifiedAtMs: requiredPositiveInteger(row.verified_at_ms, 'staged recipient verified time'),
  };
}

function scopeValues(scope: CustodyScope): readonly unknown[] {
  return [scope.namespace, scope.orgId, scope.identityDigestB64u, scope.custodyLineageB64u];
}

async function readStateRow(scope: CustodyScope): Promise<D1Row | null> {
  return await queryD1One(
    scope.database,
    `SELECT ${STATE_COLUMNS}
       FROM tenant_root_security_custody_state
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND custody_lineage_b64u = ?4`,
    scopeValues(scope),
  );
}

async function readStagedRows(scope: CustodyScope): Promise<readonly D1Row[]> {
  return await queryD1All(
    scope.database,
    `SELECT namespace, org_id, identity_digest_b64u, custody_lineage_b64u,
            role, recipient_public_key_b64u, recipient_fingerprint_b64u, verified_at_ms
       FROM tenant_root_security_custody_staged_recipients
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND custody_lineage_b64u = ?4
      ORDER BY role ASC`,
    scopeValues(scope),
  );
}

async function readChallengeRow(
  scope: CustodyScope,
  challengeIdB64u: string,
): Promise<D1Row | null> {
  return await queryD1One(
    scope.database,
    `SELECT namespace, org_id, identity_digest_b64u, custody_lineage_b64u,
            challenge_id_b64u, role, recipient_public_key_b64u,
            recipient_fingerprint_b64u, actor_user_id, lifecycle_revision,
            issued_at_ms, expires_at_ms, consumed_at_ms, expected_confirmation_b64u
       FROM tenant_root_security_custody_challenges
      WHERE namespace = ?1
        AND org_id = ?2
        AND identity_digest_b64u = ?3
        AND custody_lineage_b64u = ?4
        AND challenge_id_b64u = ?5`,
    [...scopeValues(scope), requiredText(challengeIdB64u, 'challenge id')],
  );
}

async function insertInitialState(
  scope: CustodyScope,
  currentRoot: TenantRootCurrentRootStateV1,
): Promise<void> {
  await scope.database
    .prepare(
      `INSERT OR IGNORE INTO tenant_root_security_custody_state (
         namespace, org_id, identity_digest_b64u, custody_lineage_b64u,
         lifecycle_revision, root_commitment_b64u, governance_json, backup_json,
         recipient_pair_json, source_disposition_json, updated_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, '{"status":"not_configured"}', NULL, NULL, ?7)`,
    )
    .bind(
      ...scopeValues(scope),
      currentRoot.lifecycleRevision,
      currentRoot.rootCommitmentB64u,
      requiredPositiveInteger(scope.now(), 'state updated time'),
    )
    .run();
}

async function readStateForScope(
  scope: CustodyScope,
  readRoot: () => Promise<TenantRootCurrentRootStateV1>,
): Promise<TenantRootCustodyStateV1> {
  const currentRoot = normalizeCurrentRoot(await readRoot());
  let row = await readStateRow(scope);
  if (row === null) {
    await insertInitialState(scope, currentRoot);
    row = await readStateRow(scope);
  }
  if (row === null) return invalid('state row was not persisted');
  const state = parseStateRow(row, scope, currentRoot);
  const stagedRows = await readStagedRows(scope);
  const stagedRecipients: TenantRootStagedRecipientV1[] = [];
  for (const stagedRow of stagedRows) {
    const staged = parseStagedRecipientRow(stagedRow, scope);
    if (stagedRecipients.some((entry) => entry.role === staged.role)) {
      return invalid(`duplicate staged recipient ${staged.role}`);
    }
    stagedRecipients.push(staged);
  }
  return {
    orgId: state.orgId,
    identityDigestB64u: state.identityDigestB64u,
    custodyLineageB64u: state.custodyLineageB64u,
    lifecycleRevision: state.lifecycleRevision,
    rootCommitmentB64u: state.rootCommitmentB64u,
    governance: state.governance,
    backup: state.backup,
    stagedRecipients,
    recipientPair: state.recipientPair,
    sourceDisposition: state.sourceDisposition,
  };
}

function serialize(value: StateJsonUpdate['value'], label: string): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') return invalid(label);
  return serialized;
}

async function updateStateJsonAfterRead(
  scope: CustodyScope,
  state: TenantRootCustodyStateV1,
  readRoot: () => Promise<TenantRootCurrentRootStateV1>,
  update: StateJsonUpdate,
): Promise<void> {
  const serialized = serialize(update.value, update.column);
  const result = await scope.database
    .prepare(
      `UPDATE tenant_root_security_custody_state
          SET ${update.column} = ?5,
              lifecycle_revision = ?6,
              root_commitment_b64u = ?7,
              updated_at_ms = ?8
        WHERE namespace = ?1
          AND org_id = ?2
          AND identity_digest_b64u = ?3
          AND custody_lineage_b64u = ?4
          AND root_commitment_b64u = ?7`,
    )
    .bind(
      ...scopeValues(scope),
      serialized,
      state.lifecycleRevision,
      state.rootCommitmentB64u,
      requiredPositiveInteger(scope.now(), 'state updated time'),
    )
    .run();
  if (d1ChangedRows(result) !== 1) return invalid(`${update.column} write conflicted`);

  const stored = await readStateRow(scope);
  if (stored === null) return invalid('state row disappeared after write');
  if (stored[update.column] !== serialized)
    return invalid(`${update.column} write was not retained`);
  parseStateRow(stored, scope, normalizeCurrentRoot(await readRoot()));
}

async function putStateJson(
  scope: CustodyScope,
  readRoot: () => Promise<TenantRootCurrentRootStateV1>,
  update: StateJsonUpdate,
): Promise<void> {
  const state = await readStateForScope(scope, readRoot);
  await updateStateJsonAfterRead(scope, state, readRoot, update);
}

function sameChallenge(
  left: TenantRootRecipientChallengeRecordV1,
  right: TenantRootRecipientChallengeRecordV1,
): boolean {
  return (
    left.challengeIdB64u === right.challengeIdB64u &&
    left.expectedConfirmationB64u === right.expectedConfirmationB64u &&
    left.role === right.role &&
    left.recipientPublicKeyB64u === right.recipientPublicKeyB64u &&
    left.recipientFingerprintB64u === right.recipientFingerprintB64u &&
    left.actorUserId === right.actorUserId &&
    left.lifecycleRevision === right.lifecycleRevision &&
    left.issuedAtMs === right.issuedAtMs &&
    left.expiresAtMs === right.expiresAtMs &&
    left.consumedAtMs === right.consumedAtMs
  );
}

function sameStagedRecipient(
  left: TenantRootStagedRecipientV1,
  right: TenantRootStagedRecipientV1,
): boolean {
  return (
    left.role === right.role &&
    left.recipientPublicKeyB64u === right.recipientPublicKeyB64u &&
    left.recipientFingerprintB64u === right.recipientFingerprintB64u &&
    left.verifiedAtMs === right.verifiedAtMs
  );
}

function updateRecoverySetEvidence(
  set: TenantRootRecoverySetStateV1,
  artifact: TenantRootDownloadArtifactV1,
  evidence: TenantRootDownloadEvidenceV1,
): TenantRootRecoverySetStateV1 {
  let deriverAPackage = set.deriverAPackage;
  let deriverBPackage = set.deriverBPackage;
  let manifest = set.manifest;
  switch (artifact) {
    case 'deriver_a_package':
      deriverAPackage = evidence;
      break;
    case 'deriver_b_package':
      deriverBPackage = evidence;
      break;
    case 'manifest':
      manifest = evidence;
      break;
    default: {
      const exhaustive: never = artifact;
      return invalid(`unknown custody artifact ${exhaustive}`);
    }
  }
  return {
    recoverySetId: set.recoverySetId,
    recipientPair: set.recipientPair,
    createdAt: set.createdAt,
    rootCommitmentFingerprintB64u: set.rootCommitmentFingerprintB64u,
    deriverAPackage,
    deriverBPackage,
    manifest,
  };
}

function updateBackupEvidence(
  backup: TenantRootRecoveryBackupV1,
  artifact: TenantRootDownloadArtifactV1,
  evidence: TenantRootDownloadEvidenceV1,
): TenantRootRecoveryBackupV1 {
  switch (backup.status) {
    case 'ready':
      return {
        status: 'ready',
        governance: backup.governance,
        active: updateRecoverySetEvidence(backup.active, artifact, evidence),
      };
    case 'replacing':
      return {
        status: 'replacing',
        governance: backup.governance,
        active: updateRecoverySetEvidence(backup.active, artifact, evidence),
        pendingRecipientPair: backup.pendingRecipientPair,
        pendingRecoverySetId: backup.pendingRecoverySetId,
      };
    case 'failed_replacement':
      return {
        status: 'failed_replacement',
        governance: backup.governance,
        active: updateRecoverySetEvidence(backup.active, artifact, evidence),
        failureCode: backup.failureCode,
        cleanupReceipts: backup.cleanupReceipts,
      };
    case 'cleanup_incomplete':
      if (backup.active === null) return invalid('download evidence has no active recovery set');
      return {
        status: 'cleanup_incomplete',
        governance: backup.governance,
        active: updateRecoverySetEvidence(backup.active, artifact, evidence),
        outstanding: backup.outstanding,
      };
    case 'not_configured':
    case 'recipients_pending':
    case 'preparing_initial':
    case 'failed_initial':
    case 'tenant_held_external':
      return invalid(`download evidence is unavailable in ${backup.status}`);
    default: {
      const exhaustive: never = backup;
      return invalid(`unknown custody backup ${exhaustive}`);
    }
  }
}

class D1TenantRootCustodyStoreV1 implements TenantRootCustodyStoreV1 {
  private readonly scope: CustodyScope;
  private readonly readRoot: () => Promise<TenantRootCurrentRootStateV1>;

  constructor(options: D1TenantRootCustodyStoreOptionsV1) {
    this.scope = {
      database: options.database,
      namespace: requiredText(options.namespace, 'namespace'),
      orgId: requiredText(options.orgId, 'org id'),
      identityDigestB64u: requiredText(options.identityDigestB64u, 'identity digest'),
      custodyLineageB64u: requiredText(options.custodyLineageB64u, 'custody lineage'),
      now: options.now ?? systemNow,
    };
    this.readRoot = options.readRoot;
  }

  readState(): Promise<TenantRootCustodyStateV1> {
    return readStateForScope(this.scope, this.readRoot);
  }

  putGovernance(governance: TenantRootRecoveryGovernanceV1): Promise<void> {
    return putStateJson(this.scope, this.readRoot, {
      column: 'governance_json',
      value: governance,
    });
  }

  async putChallenge(challenge: TenantRootRecipientChallengeRecordV1): Promise<void> {
    await readStateForScope(this.scope, this.readRoot);
    await this.scope.database
      .prepare(
        `INSERT OR IGNORE INTO tenant_root_security_custody_challenges (
           namespace, org_id, identity_digest_b64u, custody_lineage_b64u,
           challenge_id_b64u, role, recipient_public_key_b64u,
           recipient_fingerprint_b64u, actor_user_id, lifecycle_revision,
           issued_at_ms, expires_at_ms, consumed_at_ms, expected_confirmation_b64u
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
      .bind(
        ...scopeValues(this.scope),
        challenge.challengeIdB64u,
        challenge.role,
        challenge.recipientPublicKeyB64u,
        challenge.recipientFingerprintB64u,
        challenge.actorUserId,
        challenge.lifecycleRevision,
        challenge.issuedAtMs,
        challenge.expiresAtMs,
        challenge.consumedAtMs,
        challenge.expectedConfirmationB64u,
      )
      .run();
    const storedRow = await readChallengeRow(this.scope, challenge.challengeIdB64u);
    if (storedRow === null) return invalid('challenge row was not persisted');
    if (!sameChallenge(parseChallengeRow(storedRow, this.scope), challenge)) {
      return invalid('challenge id already names a different record');
    }
  }

  async takeChallenge(
    challengeIdB64u: string,
  ): Promise<TenantRootRecipientChallengeRecordV1 | null> {
    const row = await readChallengeRow(this.scope, challengeIdB64u);
    return row === null ? null : parseChallengeRow(row, this.scope);
  }

  async consumeChallenge(challengeIdB64u: string, atMs: number): Promise<void> {
    const challengeId = requiredText(challengeIdB64u, 'challenge id');
    const consumedAtMs = requiredPositiveInteger(atMs, 'challenge consumed time');
    const result = await this.scope.database
      .prepare(
        `UPDATE tenant_root_security_custody_challenges
            SET consumed_at_ms = ?6
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND custody_lineage_b64u = ?4
            AND challenge_id_b64u = ?5
            AND consumed_at_ms IS NULL
          RETURNING challenge_id_b64u`,
      )
      .bind(...scopeValues(this.scope), challengeId, consumedAtMs)
      .first();
    if (result === null) {
      const row = await readChallengeRow(this.scope, challengeId);
      if (row === null) return invalid('challenge was not found while consuming');
      const stored = parseChallengeRow(row, this.scope);
      if (stored.consumedAtMs !== null) return invalid('challenge was already consumed');
      return invalid('challenge consumption write conflicted');
    }
    const row = await readChallengeRow(this.scope, challengeId);
    if (row === null) return invalid('challenge disappeared after consumption');
    if (parseChallengeRow(row, this.scope).consumedAtMs !== consumedAtMs) {
      return invalid('challenge consumption was not retained');
    }
  }

  async readRecipientOwner(
    role: TenantRootDeriverRoleV1,
    fingerprintB64u: string,
    beforeMs: number,
  ): Promise<string | null> {
    // The first completed proof binds a key to its holder; later enrolment cannot transfer old backups.
    const row = await queryD1One(
      this.scope.database,
      `SELECT actor_user_id FROM tenant_root_security_custody_challenges
       WHERE namespace = ?1 AND org_id = ?2 AND identity_digest_b64u = ?3
         AND custody_lineage_b64u = ?4 AND role = ?5 AND recipient_fingerprint_b64u = ?6
         AND consumed_at_ms IS NOT NULL AND consumed_at_ms <= ?7
       ORDER BY consumed_at_ms, issued_at_ms, challenge_id_b64u LIMIT 1`,
      [...scopeValues(this.scope), role, fingerprintB64u, beforeMs],
    );
    return row === null ? null : requiredText(row.actor_user_id, 'recipient owner');
  }

  async putStagedRecipient(recipient: TenantRootStagedRecipientV1): Promise<void> {
    await readStateForScope(this.scope, this.readRoot);
    await this.scope.database
      .prepare(
        `INSERT INTO tenant_root_security_custody_staged_recipients (
           namespace, org_id, identity_digest_b64u, custody_lineage_b64u,
           role, recipient_public_key_b64u, recipient_fingerprint_b64u, verified_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (
           namespace, org_id, identity_digest_b64u, custody_lineage_b64u, role
         ) DO UPDATE SET
           recipient_public_key_b64u = excluded.recipient_public_key_b64u,
           recipient_fingerprint_b64u = excluded.recipient_fingerprint_b64u,
           verified_at_ms = excluded.verified_at_ms`,
      )
      .bind(
        ...scopeValues(this.scope),
        recipient.role,
        recipient.recipientPublicKeyB64u,
        recipient.recipientFingerprintB64u,
        recipient.verifiedAtMs,
      )
      .run();
    const row = await this.scope.database
      .prepare(
        `SELECT namespace, org_id, identity_digest_b64u, custody_lineage_b64u,
                role, recipient_public_key_b64u, recipient_fingerprint_b64u, verified_at_ms
           FROM tenant_root_security_custody_staged_recipients
          WHERE namespace = ?1
            AND org_id = ?2
            AND identity_digest_b64u = ?3
            AND custody_lineage_b64u = ?4
            AND role = ?5`,
      )
      .bind(...scopeValues(this.scope), recipient.role)
      .first<D1Row>();
    if (row === null) return invalid('staged recipient row was not persisted');
    if (!sameStagedRecipient(parseStagedRecipientRow(row, this.scope), recipient)) {
      return invalid('staged recipient write was not retained');
    }
  }

  putRecipientPair(pair: TenantRootRecipientPairV1): Promise<void> {
    return putStateJson(this.scope, this.readRoot, {
      column: 'recipient_pair_json',
      value: pair,
    });
  }

  putBackup(backup: TenantRootRecoveryBackupV1): Promise<void> {
    return putStateJson(this.scope, this.readRoot, {
      column: 'backup_json',
      value: backup,
    });
  }

  async putDownloadEvidence(
    artifact: TenantRootDownloadArtifactV1,
    evidence: TenantRootDownloadEvidenceV1,
  ): Promise<void> {
    const state = await readStateForScope(this.scope, this.readRoot);
    const downloadable = tenantRootDownloadableRecoverySetV1(state.backup);
    if (downloadable === null) return invalid('download evidence has no downloadable set');
    const nextBackup = updateBackupEvidence(state.backup, artifact, evidence);
    await updateStateJsonAfterRead(this.scope, state, this.readRoot, {
      column: 'backup_json',
      value: nextBackup,
    });
  }

  putSourceDisposition(disposition: TenantRootSourceCustodyDispositionV1): Promise<void> {
    return putStateJson(this.scope, this.readRoot, {
      column: 'source_disposition_json',
      value: disposition,
    });
  }
}

/** Creates a D1-backed custody store without mounting the recovery routes. */
export function createD1TenantRootCustodyStoreV1(
  options: D1TenantRootCustodyStoreOptionsV1,
): TenantRootCustodyStoreV1 {
  return new D1TenantRootCustodyStoreV1(options);
}
