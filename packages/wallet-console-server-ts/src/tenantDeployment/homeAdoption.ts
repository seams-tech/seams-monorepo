import type {
  TenantDeploymentBindingV1,
  TenantDeploymentCutoverId,
} from '@seams-internal/wallet-console-shared/tenant-deployment';
import type {
  TenantDeploymentProvisionerOptionsV1,
  TenantDeploymentProvisioningResultV1,
} from './provisioning';
import type {
  ExpectedActiveTenantDeploymentBindingV1,
  TenantDeploymentCutoverRecordV1,
} from './types';
import { TenantDeploymentStoreError } from './service';
import type { TenantHomeVerificationV1 } from './homeVerification';

export type TenantDeploymentHomeAdoptionRequestV1 = {
  readonly homeVerification: TenantHomeVerificationV1;
  readonly deploymentLane: string;
  readonly operationId: TenantDeploymentCutoverId;
  readonly expectedActive: ExpectedActiveTenantDeploymentBindingV1;
};

type TenantDeploymentHomeAdoptionOptionsV1 = Pick<
  TenantDeploymentProvisionerOptionsV1,
  'home' | 'deploymentLane' | 'store' | 'readiness' | 'canary' | 'audit'
>;

function assertNever(value: never): never {
  throw new Error(`Unexpected adoption state: ${String(value)}`);
}

function assertOperationMatches(
  record: TenantDeploymentCutoverRecordV1,
  request: TenantDeploymentHomeAdoptionRequestV1,
  binding: TenantDeploymentBindingV1,
): void {
  const state = record.state;
  if (
    state.deploymentLane !== request.deploymentLane ||
    state.operationId !== request.operationId
  ) {
    throw new TenantDeploymentStoreError('cutover_conflict', 'adoption operation identity changed');
  }
  switch (state.kind) {
    case 'planning':
    case 'awaiting_tenant_root':
    case 'awaiting_browser_credential':
      if (
        state.expectedActiveRevision === request.expectedActive.revision &&
        state.targetIdentity.organizationId === binding.tenant.organizationId &&
        state.targetIdentity.projectId === binding.tenant.projectId &&
        state.targetIdentity.environmentId === binding.tenant.environmentId &&
        state.targetIdentity.signingRootId === binding.tenantRoot.signingRootId &&
        state.targetIdentity.signingRootVersion === binding.tenantRoot.signingRootVersion
      )
        return;
      break;
    case 'ready':
      if (
        state.expectedActiveRevision === request.expectedActive.revision &&
        state.binding.revision === binding.revision
      )
        return;
      break;
    case 'active':
      if (
        state.binding.revision === binding.revision &&
        state.activationReceipt.previousRevision === request.expectedActive.revision &&
        state.activationReceipt.activationSequence === request.expectedActive.activationSequence + 1
      )
        return;
      break;
    case 'failed':
      break;
    default:
      assertNever(state);
  }
  throw new TenantDeploymentStoreError(
    'cutover_conflict',
    'adoption operation names another cutover',
  );
}

async function assertActive(
  options: TenantDeploymentHomeAdoptionOptionsV1,
  expected: ExpectedActiveTenantDeploymentBindingV1,
): Promise<void> {
  const active = await options.store.findActiveBinding(options.deploymentLane);
  if (
    active?.revision !== expected.revision ||
    active.activationSequence !== expected.activationSequence
  ) {
    throw new TenantDeploymentStoreError(
      'activation_conflict',
      'active deployment changed during adoption',
    );
  }
}

export async function adoptTenantDeploymentHomeV1(
  options: TenantDeploymentHomeAdoptionOptionsV1,
  request: TenantDeploymentHomeAdoptionRequestV1,
): Promise<Extract<TenantDeploymentProvisioningResultV1, { disposition: 'activated' }>> {
  if (request.deploymentLane !== options.deploymentLane) {
    throw new TenantDeploymentStoreError(
      'invalid_input',
      'adoption lane does not match this runtime',
    );
  }
  const existing = await options.store.findCutover(request.operationId);
  if (existing?.state.kind !== 'active')
    request.homeVerification.assertFor(options.home, request.deploymentLane, Date.now());
  if (existing?.state.kind !== 'active') await assertActive(options, request.expectedActive);
  const binding = await options.store.adoptBindingHome(
    request.deploymentLane,
    request.expectedActive.revision,
    options.home,
  );
  const targetIdentity = {
    organizationId: binding.tenant.organizationId,
    projectId: binding.tenant.projectId,
    environmentId: binding.tenant.environmentId,
    signingRootId: binding.tenantRoot.signingRootId,
    signingRootVersion: binding.tenantRoot.signingRootVersion,
  };
  let record =
    existing ??
    (await options.store.createCutover({
      kind: 'planning',
      operationId: request.operationId,
      deploymentLane: request.deploymentLane,
      targetIdentity,
      expectedActiveRevision: request.expectedActive.revision,
    }));
  assertOperationMatches(record, request, binding);
  if (record.state.kind === 'planning') {
    record = await options.store.transitionCutover(record, {
      kind: 'awaiting_tenant_root',
      operationId: request.operationId,
      deploymentLane: request.deploymentLane,
      targetIdentity,
      expectedActiveRevision: request.expectedActive.revision,
    });
  }
  if (record.state.kind === 'awaiting_tenant_root') {
    // Adoption preserves custody and credentials; production readiness validates both before activation.
    record = await options.store.transitionCutover(record, {
      kind: 'awaiting_browser_credential',
      operationId: request.operationId,
      deploymentLane: request.deploymentLane,
      targetIdentity,
      activeTenantRoot: binding.tenantRoot,
      expectedActiveRevision: request.expectedActive.revision,
    });
  }
  if (record.state.kind === 'awaiting_browser_credential' || record.state.kind === 'ready') {
    const readinessReceipt = await options.readiness.issue({
      binding,
      expectedActiveRevision: request.expectedActive.revision,
    });
    record = await options.store.transitionCutover(record, {
      kind: 'ready',
      operationId: request.operationId,
      deploymentLane: request.deploymentLane,
      binding,
      readinessReceipt,
      expectedActiveRevision: request.expectedActive.revision,
    });
    await options.store.activateBinding({
      homeVerification: request.homeVerification,
      home: options.home,
      operationId: request.operationId,
      expectedCutoverRecordRevision: record.recordRevision,
      deploymentLane: request.deploymentLane,
      bindingRevision: binding.revision,
      expectedActive: request.expectedActive,
      readinessReceipt,
    });
    const activated = await options.store.findCutover(request.operationId);
    if (!activated)
      throw new TenantDeploymentStoreError('cutover_not_found', 'adoption operation disappeared');
    record = activated;
  }
  assertOperationMatches(record, request, binding);
  if (record.state.kind !== 'active') {
    throw new TenantDeploymentStoreError('cutover_conflict', 'adoption did not activate');
  }
  const expected = {
    revision: binding.revision,
    activationSequence: record.state.activationReceipt.activationSequence,
  };
  await assertActive(options, expected);
  // The active cutover is durable even if the canary or response fails. Every retry repeats the canary.
  const canaryReceipt = await options.canary.run({
    bindingRevision: binding.revision,
    environmentId: binding.tenant.environmentId,
    publishableKey: binding.browserCredential.publishableKey,
    surfaces: binding.surfaces,
  });
  await assertActive(options, expected);
  await options.audit.appendEvent(
    { orgId: binding.tenant.organizationId, actorUserId: 'system:tenant-deployment-provisioner' },
    {
      projectId: binding.tenant.projectId,
      environmentId: binding.tenant.environmentId,
      actorUserId: 'system:tenant-deployment-provisioner',
      actorType: 'SYSTEM',
      category: 'SYSTEM',
      action: 'tenant_deployment.adopt_home',
      outcome: 'SUCCESS',
      summary: 'Adopted the namespace D1 home and verified the registration canary',
      metadata: {
        operationId: request.operationId,
        deploymentLane: request.deploymentLane,
        previousRevision: request.expectedActive.revision,
        bindingRevision: binding.revision,
        activationSequence: expected.activationSequence,
        canaryResponseDigestB64u: canaryReceipt.responseDigestB64u,
      },
    },
  );
  return {
    disposition: 'activated',
    operationId: request.operationId,
    bindingRevision: binding.revision,
    credentialId: binding.browserCredential.credentialId,
    activationSequence: expected.activationSequence,
    canaryReceipt,
  };
}
