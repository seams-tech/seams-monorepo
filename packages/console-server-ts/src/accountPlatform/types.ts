import {
  BoundServiceInstanceV1,
  PlatformScopeV1,
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  parseServiceProvisionReceiptV1,
  type AcceptedServiceReceiptV1,
  type PlatformResult,
  type PlatformServiceIdV1,
  type ServiceInstanceStateV1,
  type ServiceObservedStateV1,
} from '@seams-internal/console-shared/accountPlatform';
import {
  integer,
  object,
  textValue,
} from '@seams-internal/console-shared/accountPlatform/boundary';

export interface AccountPlatformError {
  readonly code:
    | 'scope_forbidden'
    | 'operation_conflict'
    | 'transition_conflict'
    | 'binding_conflict'
    | 'instance_archived'
    | 'instance_not_found'
    | 'service_instances_exist';
}

export interface ServiceProducerAuthorityV1 {
  readonly serviceId: PlatformServiceIdV1;
  readonly deploymentId: string;
}

export interface ServiceProvisionAdapterV1 {
  readonly authority: ServiceProducerAuthorityV1;
  provision(
    delivery: ServiceProvisionDeliveryV1,
  ): Promise<
    PlatformResult<
      AcceptedServiceReceiptV1,
      { readonly code: 'unavailable' | 'provisioning_failed' }
    >
  >;
}

export interface ServiceProvisionDeliveryV1 {
  readonly scope: PlatformScopeV1;
  readonly command: ServiceProvisionCommandV1;
  readonly authority: ServiceProducerAuthorityV1;
  readonly payloadDigest: string;
}

export interface ServiceProvisionAcknowledgementV1 {
  readonly disposition: 'applied' | 'stale';
  readonly instance: AccountServiceInstanceV1;
}

export type AccountPlatformResult<T> = PlatformResult<T, AccountPlatformError>;

function requireParsed<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected')
    throw new Error(`Invalid persisted platform record: ${JSON.stringify(result.error)}`);
  return result.value;
}

function readObservedState(record: Record<string, unknown>): ServiceObservedStateV1 {
  const revision = integer(record.observed_revision, 'observed_revision', 0);
  if (record.observed_state === 'unknown' && revision === 0)
    return Object.freeze({ kind: 'unknown' });
  if (
    revision > 0 &&
    (record.observed_state === 'active' ||
      record.observed_state === 'disabled' ||
      record.observed_state === 'archived')
  ) {
    return Object.freeze({ kind: 'confirmed', revision, status: record.observed_state });
  }
  throw new Error('Invalid persisted service observation');
}

export function readPlatformScopeColumns(record: Record<string, unknown>): PlatformScopeV1 {
  return requireParsed(
    PlatformScopeV1.parse({
      namespace: record.namespace,
      organizationId: record.org_id,
      projectId: record.project_id,
      billingAccountId: record.billing_account_id,
    }),
  );
}

export function readProvisionCommandColumn(value: unknown): ServiceProvisionCommandV1 {
  return requireParsed(
    ServiceProvisionCommandV1.parse(JSON.parse(textValue(value, 'payload_json'))),
  );
}

function readInstanceState(
  record: Record<string, unknown>,
  command: ServiceProvisionCommandV1,
): ServiceInstanceStateV1 {
  const observed = readObservedState(record);
  if (observed.kind === 'confirmed' && observed.revision > command.desiredRevision) {
    throw new Error('Observed service revision exceeds desired revision');
  }
  switch (record.phase) {
    case 'active':
      if (
        observed.kind !== 'confirmed' ||
        observed.status !== 'active' ||
        observed.revision !== command.desiredRevision
      ) {
        throw new Error('Active service observation does not match its desired revision');
      }
      return requireParsed(
        BoundServiceInstanceV1.active({
          instanceId: command.instanceId,
          operationId: command.operationId,
          desiredState: record.desired_state,
          desiredRevision: command.desiredRevision,
          receipt: JSON.parse(textValue(record.receipt_json, 'receipt_json')),
        }),
      ).state;
    case 'archived':
      if (
        observed.kind !== 'confirmed' ||
        observed.status !== 'archived' ||
        observed.revision !== command.desiredRevision
      ) {
        throw new Error('Archived service observation does not match its desired revision');
      }
      return requireParsed(
        BoundServiceInstanceV1.archived({
          instanceId: command.instanceId,
          operationId: command.operationId,
          desiredState: record.desired_state,
          desiredRevision: command.desiredRevision,
          receipt: JSON.parse(textValue(record.receipt_json, 'receipt_json')),
        }),
      ).state;
    case 'provisioning':
      if (command.command !== 'enable')
        throw new Error('Only enable commands can provision a service');
      return Object.freeze({
        kind: 'provisioning',
        desiredRevision: command.desiredRevision,
        operationId: command.operationId,
        target: command.binding,
        observed,
      });
    case 'failed':
      return Object.freeze({
        kind: 'failed',
        desiredRevision: command.desiredRevision,
        operationId: command.operationId,
        target: command.binding,
        command: command.command,
        failureCode: textValue(record.failure_code, 'failure_code'),
        observed,
      });
    case 'disabled': {
      if (record.receipt_json !== null) {
        const receipt = requireParsed(
          parseServiceProvisionReceiptV1(
            JSON.parse(textValue(record.receipt_json, 'receipt_json')),
          ),
        );
        if (
          receipt.result !== 'disabled' ||
          receipt.instanceId !== command.instanceId ||
          receipt.operationId !== command.operationId ||
          receipt.desiredRevision !== command.desiredRevision ||
          observed.kind !== 'confirmed' ||
          observed.status !== 'disabled' ||
          observed.revision !== command.desiredRevision
        ) {
          throw new Error('Invalid shutdown receipt');
        }
        return Object.freeze({
          kind: 'disabled',
          desiredRevision: command.desiredRevision,
          operationId: command.operationId,
          target: command.binding,
          shutdown: Object.freeze({
            kind: 'confirmed',
            receipt: Object.freeze({
              version: receipt.version,
              operationId: receipt.operationId,
              instanceId: receipt.instanceId,
              desiredRevision: receipt.desiredRevision,
              result: receipt.result,
              binding: receipt.binding,
            }),
          }),
        });
      }
      return Object.freeze({
        kind: 'disabled',
        desiredRevision: command.desiredRevision,
        operationId: command.operationId,
        target: command.binding,
        shutdown: Object.freeze({ kind: 'pending', observed }),
      });
    }
    default:
      throw new Error('Invalid persisted service phase');
  }
}

/** Storage is the only source for account state. A service receipt alone cannot grant readiness. */
export class AccountServiceInstanceV1 {
  private constructor(
    readonly scope: PlatformScopeV1,
    readonly instanceId: string,
    readonly serviceId: PlatformServiceIdV1,
    readonly deploymentId: string,
    readonly command: ServiceProvisionCommandV1,
    readonly state: ServiceInstanceStateV1,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static fromStorage(input: unknown): AccountServiceInstanceV1 {
    const record = object(input, 'instance');
    const command = readProvisionCommandColumn(record.payload_json);
    if (
      record.id !== command.instanceId ||
      record.operation_id !== command.operationId ||
      record.desired_revision !== command.desiredRevision
    ) {
      throw new Error('Persisted instance does not match its current operation');
    }
    if (record.service_id !== 'wallet' && record.service_id !== 'satyr')
      throw new Error('Invalid persisted service');
    const scope = readPlatformScopeColumns(record);
    const deploymentId = textValue(record.deployment_id, 'deployment_id');
    const binding = command.binding;
    let targetService: PlatformServiceIdV1;
    let targetDeployment: string;
    if (binding instanceof ServiceTenantBindingV1) {
      targetService = binding.nativeScope.serviceId;
      targetDeployment = binding.nativeScope.deploymentId;
      if (!platformScopesEqual(scope, binding.scope))
        throw new Error('Stored binding scope does not match its instance');
    } else if (binding.kind === 'attach_existing_scope') {
      targetService = binding.nativeScope.serviceId;
      targetDeployment = binding.nativeScope.deploymentId;
    } else {
      targetService = binding.serviceId;
      targetDeployment = binding.configuration.deploymentId;
      if (!platformScopesEqual(scope, binding.parent))
        throw new Error('Stored provisioning scope does not match its instance');
    }
    if (targetService !== record.service_id || targetDeployment !== deploymentId) {
      throw new Error('Stored command authority does not match its instance');
    }
    if (
      (command.command === 'enable' && record.desired_state !== 'enabled') ||
      (command.command === 'disable' && record.desired_state !== 'disabled') ||
      (command.command === 'archive' && record.desired_state !== 'archived')
    ) {
      throw new Error('Stored desired state does not match its command');
    }
    const state = readInstanceState(record, command);
    if (
      (state.kind === 'active' || state.kind === 'archived') &&
      !platformScopesEqual(scope, state.binding.scope)
    ) {
      throw new Error('Stored receipt scope does not match its instance');
    }
    if (
      (state.kind === 'active' || state.kind === 'archived') &&
      (state.binding.nativeScope.serviceId !== record.service_id ||
        state.binding.nativeScope.deploymentId !== deploymentId)
    ) {
      throw new Error('Stored receipt authority does not match its instance');
    }
    return new AccountServiceInstanceV1(
      scope,
      command.instanceId,
      record.service_id,
      deploymentId,
      command,
      state,
    );
  }
}

export function platformScopesEqual(left: PlatformScopeV1, right: PlatformScopeV1): boolean {
  return (
    left.namespace === right.namespace &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.billingAccountId === right.billingAccountId
  );
}
