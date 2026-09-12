import type { RecoveryDownloadHolders } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/custodyService';
import type {
  TenantRootDownloadEvidenceV1,
  TenantRootRecoveryBackupV1,
  TenantRootRecoverySetStateV1,
  TenantRootRestoreSessionV1,
  TenantRootRoleReceiptsV1,
  TenantRootRotationJobV1,
  TenantRootSourceCustodyDispositionV1,
} from '../../packages/shared-ts/src/tenant-root/tenantRootSecurityState';

declare const receipts: TenantRootRoleReceiptsV1;
declare const recoverySet: TenantRootRecoverySetStateV1;

// A completed rotation must carry activation and both retirement receipts.
const completeRotation: Extract<TenantRootRotationJobV1, { readonly status: 'complete' }> = {
  status: 'complete',
  jobId: 'job-1',
  requestedAt: '2026-09-05T12:00:00.000Z',
  completedAt: '2026-09-05T12:04:00.000Z',
  activatedEpoch: 4,
  activationReceiptDigestB64u: 'AAAA',
  retirementReceipts: receipts,
};
void completeRotation;

// @ts-expect-error A completed rotation cannot omit its retirement receipts.
const completeWithoutRetirement: Extract<TenantRootRotationJobV1, { readonly status: 'complete' }> =
  {
    status: 'complete',
    jobId: 'job-1',
    requestedAt: '2026-09-05T12:00:00.000Z',
    completedAt: '2026-09-05T12:04:00.000Z',
    activatedEpoch: 4,
    activationReceiptDigestB64u: 'AAAA',
  };
void completeWithoutRetirement;

const activatedButNotRetired: Extract<TenantRootRotationJobV1, { readonly status: 'complete' }> = {
  status: 'complete',
  jobId: 'job-1',
  requestedAt: '2026-09-05T12:00:00.000Z',
  completedAt: '2026-09-05T12:04:00.000Z',
  activatedEpoch: 4,
  activationReceiptDigestB64u: 'AAAA',
  // @ts-expect-error An activated rotation with incomplete retirement is not 'complete'.
  outstanding: { roles: ['deriver_b'], description: 'deriver-b-retirement' },
};
void activatedButNotRetired;

const failedWithOutstanding: Extract<
  TenantRootRotationJobV1,
  { readonly status: 'failed_before_activation' }
> = {
  status: 'failed_before_activation',
  jobId: 'job-1',
  requestedAt: '2026-09-05T12:00:00.000Z',
  failureCode: 'deriver_b_unavailable',
  // @ts-expect-error A failure branch cannot claim proved cleanup with outstanding material.
  outstanding: { roles: ['deriver_b'], description: 'deriver-b-share' },
};
void failedWithOutstanding;

// Browser evidence records issuance only.
const issued: Extract<TenantRootDownloadEvidenceV1, { readonly kind: 'download_issued' }> = {
  kind: 'download_issued',
  issuedAt: '2026-09-05T12:00:00.000Z',
  actorUserId: 'owner-1',
  contentDigestB64u: 'AAAA',
};
void issued;

const issuedAsDurable: Extract<TenantRootDownloadEvidenceV1, { readonly kind: 'download_issued' }> =
  {
    kind: 'download_issued',
    issuedAt: '2026-09-05T12:00:00.000Z',
    actorUserId: 'owner-1',
    contentDigestB64u: 'AAAA',
    // @ts-expect-error An issued browser response cannot carry CLI durability evidence.
    trustLevel: { kind: 'cryptographically_valid_offline' },
  };
void issuedAsDurable;

// @ts-expect-error Durable verification must record which trust result it obtained.
const durableWithoutTrust: Extract<
  TenantRootDownloadEvidenceV1,
  { readonly kind: 'durable_verified' }
> = {
  kind: 'durable_verified',
  verifiedAt: '2026-09-05T12:00:00.000Z',
  actorUserId: 'owner-1',
  contentDigestB64u: 'AAAA',
};
void durableWithoutTrust;

const externalWithActive: Extract<
  TenantRootRecoveryBackupV1,
  { readonly status: 'tenant_held_external' }
> = {
  status: 'tenant_held_external',
  governance: {
    kind: 'two_person_v1',
    selectedByOwnerId: 'owner-1',
    selectedAt: '2026-08-01T00:00:00.000Z',
  },
  recoverySetId: 'set-1',
  manifestDigestB64u: 'AAAA',
  // @ts-expect-error A restored external set is not a downloadable active set.
  active: recoverySet,
};
void externalWithActive;

const unacknowledgedSingleOwner: Extract<TenantRootRecoveryBackupV1, { readonly status: 'ready' }> =
  {
    status: 'ready',
    // @ts-expect-error Single-owner governance cannot skip its warning acknowledgement.
    governance: {
      kind: 'single_owner_v1',
      acknowledgedByOwnerId: 'owner-1',
      acknowledgedAt: '2026-08-01T00:00:00.000Z',
    },
    active: recoverySet,
  };
void unacknowledgedSingleOwner;

// @ts-expect-error An activated restore must record how the source was left.
const activeWithoutDisposition: Extract<TenantRootRestoreSessionV1, { readonly status: 'active' }> =
  {
    status: 'active',
    sessionId: 'session-1',
    destinationFingerprintB64u: 'AAAA',
    destinationLineageId: 'lineage-1',
    activatedEpoch: 1,
    activationReceiptDigestB64u: 'AAAA',
    forwardRefreshReceiptDigestB64u: 'CCCC',
    continuityCanaryReceiptDigestB64u: 'DDDD',
    bootstrapDestructionReceiptDigestB64u: 'BBBB',
    tenantHeldRecoverySet: {
      recoverySetId: 'set-1',
      manifestDigestB64u: 'AAAA',
    },
  };
void activeWithoutDisposition;

const revokedBoolean: TenantRootSourceCustodyDispositionV1 = {
  kind: 'retained_as_backup',
  acknowledgedByUserId: 'owner-1',
  incidentResponseNote: 'source retained',
  recordedAt: '2026-09-05T12:00:00.000Z',
  // @ts-expect-error Source custody has no generic revoked boolean.
  sourceRevoked: false,
};
void revokedBoolean;

const unverifiedWithReceipts: Extract<
  TenantRootSourceCustodyDispositionV1,
  { readonly kind: 'unavailable_retirement_unverified' }
> = {
  kind: 'unavailable_retirement_unverified',
  attemptedChecks: ['deriver_a_destruction'],
  recordedByUserId: 'owner-1',
  recordedAt: '2026-09-05T12:00:00.000Z',
  // @ts-expect-error An unverified retirement cannot claim destruction receipts.
  destructionReceipts: receipts,
};
void unverifiedWithReceipts;

const bothInstalled: Extract<
  TenantRootRestoreSessionV1,
  { readonly status: 'awaiting_role_imports' }
> = {
  status: 'awaiting_role_imports',
  sessionId: 'session-1',
  expiresAt: '2026-09-06T12:00:00.000Z',
  destinationFingerprintB64u: 'AAAA',
  recoverySetId: 'set-1',
  installed: {
    kind: 'deriver_a_installed',
    deriverAReceiptDigestB64u: 'AAAA',
    // @ts-expect-error A role import cannot report both roles installed in one branch.
    deriverBReceiptDigestB64u: 'BBBB',
  },
};
void bothInstalled;

// @ts-expect-error A receipt pair cannot be built from one role.
const oneRoleReceipts: TenantRootRoleReceiptsV1 = { deriverA: 'AAAA' };
void oneRoleReceipts;

// @ts-expect-error Both holder identities are required for two-person downloads.
const missingRecoveryHolder: RecoveryDownloadHolders = { kind: 'two_person', deriverA: 'owner-a' };
void missingRecoveryHolder;

declare const assignedRecoveryHolders: Extract<RecoveryDownloadHolders, { kind: 'two_person' }>;
// @ts-expect-error Changing the mode cannot retain role-specific identities through a spread.
const mixedRecoveryHolders: RecoveryDownloadHolders = {
  ...assignedRecoveryHolders,
  kind: 'single_owner',
};
void mixedRecoveryHolders;
