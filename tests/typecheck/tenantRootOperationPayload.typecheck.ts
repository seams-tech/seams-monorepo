import type {
  TenantRootOperationCreateInputV1,
  TenantRootOperationEntryV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';

declare const operation: TenantRootOperationEntryV1;
declare const creation: TenantRootOperationCreateInputV1;

const { payloadJson: _storedPayload, ...entryWithoutPayload } = operation;
// @ts-expect-error A stored operation must carry its frozen execution payload.
const missingStoredPayload: TenantRootOperationEntryV1 = { ...entryWithoutPayload };

const { payloadJson: _creationPayload, ...creationWithoutPayload } = creation;
// @ts-expect-error An operation insert must persist the execution payload.
const missingCreationPayload: TenantRootOperationCreateInputV1 = { ...creationWithoutPayload };

// @ts-expect-error A governance operation cannot use the scheduled rotation trigger.
const invalidTrigger: TenantRootOperationCreateInputV1 = {
  ...creation,
  operationKind: 'tenant_root_recovery_governance_change_v1',
  triggerKind: 'scheduled',
};

void [missingStoredPayload, missingCreationPayload, invalidTrigger];
