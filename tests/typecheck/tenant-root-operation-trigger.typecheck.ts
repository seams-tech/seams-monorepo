import type {
  TenantRootOperationKindV1,
  TenantRootOperationRecordV1,
} from '../../packages/shared-ts/src/tenant-root';
import type {
  TenantRootOperationCreateInputV1,
  TenantRootOperationEntryV1,
  TenantRootOperationStartInputV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';

const commonEntry = {
  operationId: 'operation-1',
  operationDigestB64u: 'digest-1',
  canonicalRecordJson: '{}',
  idempotencyKey: 'idempotency-1',
  requesterUserId: 'owner-1',
  approverUserId: null,
  nonceB64u: 'nonce-1',
  status: 'pending' as const,
  createdAtMs: 1,
  authorizationExpiresAtMs: 2,
  acceptedResultJson: null,
  failureCode: null,
  dispatchUncertainAtMs: null,
};

const scheduledRotationEntry: TenantRootOperationEntryV1 = {
  ...commonEntry,
  operationKind: 'tenant_root_operational_share_rotation_v1',
  triggerKind: 'scheduled',
};
void scheduledRotationEntry;

// @ts-expect-error A scheduled trigger cannot be attached to a non-rotation operation.
const scheduledRecoveryEntry: TenantRootOperationEntryV1 = {
  ...commonEntry,
  operationKind: 'tenant_root_recovery_governance_change_v1',
  triggerKind: 'scheduled',
};
void scheduledRecoveryEntry;

const commonCreate = {
  operationId: 'operation-1',
  operationDigestB64u: 'digest-1',
  canonicalRecordJson: '{}',
  idempotencyKey: 'idempotency-1',
  requesterUserId: 'owner-1',
  approverUserId: null,
  consumedApprovalDigestB64u: null,
  nonceB64u: 'nonce-1',
  createdAtMs: 1,
  authorizationExpiresAtMs: 2,
};

// @ts-expect-error The durable create input enforces the same trigger relation.
const scheduledRecoveryCreate: TenantRootOperationCreateInputV1 = {
  ...commonCreate,
  operationKind: 'tenant_root_recovery_governance_change_v1',
  triggerKind: 'scheduled',
};
void scheduledRecoveryCreate;

declare const rotationRecord: TenantRootOperationRecordV1 & {
  readonly operationKind: 'tenant_root_operational_share_rotation_v1';
};
declare const recoveryRecord: TenantRootOperationRecordV1 & {
  readonly operationKind: Exclude<
    TenantRootOperationKindV1,
    'tenant_root_operational_share_rotation_v1'
  >;
};

const commonStart = {
  operationDigestB64u: 'digest-1',
  governance: null,
  governanceDigestB64u: 'governance-1',
  requesterStepUp: null,
  approverIsOwner: async () => true,
  operationId: 'operation-1',
  nonceB64u: 'nonce-1',
  nowMs: 1,
};

const scheduledRotationStart: TenantRootOperationStartInputV1 = {
  ...commonStart,
  record: rotationRecord,
  triggerKind: 'scheduled',
};
void scheduledRotationStart;

// @ts-expect-error Widening the operation kind cannot make a scheduled recovery valid.
const scheduledRecoveryStart: TenantRootOperationStartInputV1 = {
  ...commonStart,
  record: recoveryRecord,
  triggerKind: 'scheduled',
};
void scheduledRecoveryStart;
