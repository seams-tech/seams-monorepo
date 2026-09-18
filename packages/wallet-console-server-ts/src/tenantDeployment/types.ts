import type {
  ActiveTenantDeploymentBindingV1,
  TenantDeploymentActivationReceiptV1,
  TenantDeploymentBindingRevision,
  TenantDeploymentBindingV1,
  TenantDeploymentCutoverId,
  TenantDeploymentCutoverV1,
  TenantDeploymentReadinessReceiptV1,
} from '@seams-internal/wallet-console-shared/tenant-deployment';

export type {
  ActiveTenantDeploymentBindingV1,
  TenantDeploymentActivationReceiptV1,
  TenantDeploymentBindingRevision,
  TenantDeploymentBindingV1,
  TenantDeploymentCutoverId,
  TenantDeploymentCutoverV1,
  TenantDeploymentReadinessReceiptV1,
} from '@seams-internal/wallet-console-shared/tenant-deployment';

export type ExpectedActiveTenantDeploymentBindingV1 = {
  readonly revision: TenantDeploymentBindingRevision;
  readonly activationSequence: number;
};

export type ActivateTenantDeploymentBindingInputV1 = {
  readonly operationId: TenantDeploymentCutoverId;
  readonly expectedCutoverRecordRevision: number;
  readonly deploymentLane: string;
  readonly bindingRevision: TenantDeploymentBindingRevision;
  readonly expectedActive: ExpectedActiveTenantDeploymentBindingV1 | null;
  readonly readinessReceipt: TenantDeploymentReadinessReceiptV1;
};

export type ActivateTenantDeploymentBindingResultV1 = {
  readonly active: ActiveTenantDeploymentBindingV1;
  readonly receipt: TenantDeploymentActivationReceiptV1;
};

export type TenantDeploymentCutoverRecordV1 = {
  readonly state: TenantDeploymentCutoverV1;
  readonly recordRevision: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type TenantDeploymentCutoverTransitionStateV1 = Exclude<
  TenantDeploymentCutoverV1,
  { readonly kind: 'planning' | 'active' }
>;

export interface TenantDeploymentBindingReaderV1 {
  findBinding(
    deploymentLane: string,
    revision: TenantDeploymentBindingRevision,
  ): Promise<TenantDeploymentBindingV1 | null>;
  findActiveBinding(deploymentLane: string): Promise<ActiveTenantDeploymentBindingV1 | null>;
  resolveActiveBinding(deploymentLane: string): Promise<TenantDeploymentBindingV1 | null>;
}

export interface TenantDeploymentBindingStoreV1 extends TenantDeploymentBindingReaderV1 {
  putBinding(binding: TenantDeploymentBindingV1): Promise<TenantDeploymentBindingV1>;
  activateBinding(
    input: ActivateTenantDeploymentBindingInputV1,
  ): Promise<ActivateTenantDeploymentBindingResultV1>;
  createCutover(state: TenantDeploymentCutoverV1): Promise<TenantDeploymentCutoverRecordV1>;
  findCutover(operationId: string): Promise<TenantDeploymentCutoverRecordV1 | null>;
  transitionCutover(
    expected: TenantDeploymentCutoverRecordV1,
    next: TenantDeploymentCutoverTransitionStateV1,
  ): Promise<TenantDeploymentCutoverRecordV1>;
}
