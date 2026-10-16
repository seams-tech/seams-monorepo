import {
  contractResult,
  exactObject,
  digestValue,
  exactKeys,
  integer,
  invalidContract,
  object,
  textValue,
  versionOne,
  type PlatformContractError,
  type PlatformResult,
} from './boundary';
import {
  ServiceTenantBindingV1,
  PlatformScopeV1,
  readNativeTenantScope,
  type NativeTenantScopeV1,
  type PlatformServiceIdV1,
} from './scope';

export type ServiceBindingRequestV1 =
  | {
      readonly kind: 'create_native_scope';
      readonly serviceId: 'wallet';
      readonly parent: PlatformScopeV1;
      readonly configuration: {
        readonly deploymentId: string;
        readonly namespace: string;
        readonly signingRootVersion: string;
      };
      readonly nativeScope?: never;
      readonly authorityEvidence?: never;
    }
  | {
      readonly kind: 'create_native_scope';
      readonly serviceId: 'satyr';
      readonly parent: PlatformScopeV1;
      readonly configuration: {
        readonly deploymentId: string;
        readonly placementCellId: string;
        readonly environment: 'development' | 'production';
      };
      readonly nativeScope?: never;
      readonly authorityEvidence?: never;
    }
  | {
      readonly kind: 'attach_existing_scope';
      readonly nativeScope: NativeTenantScopeV1;
      readonly authorityEvidence: DurableSourceEvidenceV1;
      readonly parent?: never;
      readonly configuration?: never;
    };

export interface DurableSourceEvidenceV1 {
  readonly sourceRecordId: string;
  readonly sourceDigest: string;
}

export function readServiceBindingRequest(input: unknown): ServiceBindingRequestV1 {
  const record = object(input, 'binding');
  switch (record.kind) {
    case 'attach_existing_scope': {
      exactKeys(record, ['kind', 'nativeScope', 'authorityEvidence']);
      const evidence = object(record.authorityEvidence, 'authorityEvidence');
      exactKeys(evidence, ['sourceRecordId', 'sourceDigest']);
      return Object.freeze({
        kind: record.kind,
        nativeScope: readNativeTenantScope(record.nativeScope),
        authorityEvidence: Object.freeze({
          sourceRecordId: textValue(evidence.sourceRecordId, 'sourceRecordId'),
          sourceDigest: digestValue(evidence.sourceDigest, 'sourceDigest'),
        }),
      });
    }
    case 'create_native_scope': {
      exactKeys(record, ['kind', 'serviceId', 'parent', 'configuration']);
      const parent = PlatformScopeV1.parse(record.parent);
      if (parent.kind === 'rejected') return invalidContract(`parent.${parent.error.field}`);
      const configuration = object(record.configuration, 'configuration');
      switch (record.serviceId) {
        case 'wallet':
          exactKeys(configuration, ['deploymentId', 'namespace', 'signingRootVersion']);
          return Object.freeze({
            kind: record.kind,
            serviceId: record.serviceId,
            parent: parent.value,
            configuration: Object.freeze({
              deploymentId: textValue(configuration.deploymentId, 'deploymentId'),
              namespace: textValue(configuration.namespace, 'namespace'),
              signingRootVersion: textValue(configuration.signingRootVersion, 'signingRootVersion'),
            }),
          });
        case 'satyr':
          exactKeys(configuration, ['deploymentId', 'placementCellId', 'environment']);
          if (
            configuration.environment !== 'development' &&
            configuration.environment !== 'production'
          ) {
            return invalidContract('environment');
          }
          return Object.freeze({
            kind: record.kind,
            serviceId: record.serviceId,
            parent: parent.value,
            configuration: Object.freeze({
              deploymentId: textValue(configuration.deploymentId, 'deploymentId'),
              placementCellId: textValue(configuration.placementCellId, 'placementCellId'),
              environment: configuration.environment,
            }),
          });
        default:
          return invalidContract('serviceId');
      }
    }
    default:
      return invalidContract('binding.kind');
  }
}

export class ServiceProvisionCommandV1 {
  readonly version = 1;

  private constructor(
    readonly operationId: string,
    readonly instanceId: string,
    readonly desiredRevision: number,
    readonly command: 'enable' | 'disable' | 'archive',
    readonly binding: ServiceBindingRequestV1 | ServiceTenantBindingV1,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<ServiceProvisionCommandV1, PlatformContractError> {
    return contractResult(ServiceProvisionCommandV1.read, input);
  }

  private static read(input: unknown): ServiceProvisionCommandV1 {
    const record = object(input, 'command');
    exactKeys(record, [
      'version',
      'operationId',
      'instanceId',
      'desiredRevision',
      'command',
      'binding',
    ]);
    versionOne(record.version);
    if (
      record.command !== 'enable' &&
      record.command !== 'disable' &&
      record.command !== 'archive'
    ) {
      return invalidContract('command');
    }
    const rawBinding = object(record.binding, 'binding');
    let binding: ServiceBindingRequestV1 | ServiceTenantBindingV1;
    if (Object.hasOwn(rawBinding, 'kind')) {
      binding = readServiceBindingRequest(rawBinding);
    } else {
      const parsed = ServiceTenantBindingV1.parse(rawBinding);
      if (parsed.kind === 'rejected') return invalidContract(`binding.${parsed.error.field}`);
      binding = parsed.value;
    }
    const instanceId = textValue(record.instanceId, 'instanceId');
    if (binding instanceof ServiceTenantBindingV1 && binding.instanceId !== instanceId) {
      return invalidContract('binding.instanceId');
    }
    return new ServiceProvisionCommandV1(
      textValue(record.operationId, 'operationId'),
      instanceId,
      integer(record.desiredRevision, 'desiredRevision', 1),
      record.command,
      binding,
    );
  }
}

export type ServiceObservedStateV1 =
  | { readonly kind: 'unknown'; readonly revision?: never; readonly status?: never }
  | {
      readonly kind: 'confirmed';
      readonly revision: number;
      readonly status: 'active' | 'disabled' | 'archived';
    };

export interface AcceptedServiceReceiptV1 {
  readonly version: 1;
  readonly operationId: string;
  readonly instanceId: string;
  readonly desiredRevision: number;
  readonly result: 'active' | 'disabled' | 'archived';
  readonly binding: ServiceTenantBindingV1;
}

export type ProvisioningServiceStateV1 = {
  readonly kind: 'provisioning';
  readonly desiredRevision: number;
  readonly operationId: string;
  readonly target: ServiceBindingRequestV1 | ServiceTenantBindingV1;
  readonly observed: ServiceObservedStateV1;
  readonly binding?: never;
  readonly receipt?: never;
};

export type ActiveServiceStateV1 = {
  readonly kind: 'active';
  readonly desiredRevision: number;
  readonly observedRevision: number;
  readonly binding: ServiceTenantBindingV1;
  readonly receipt: AcceptedServiceReceiptV1 & { readonly result: 'active' };
  readonly target?: never;
  readonly observed?: never;
};

export type DisabledServiceStateV1 = {
  readonly kind: 'disabled';
  readonly desiredRevision: number;
  readonly operationId: string;
  // A disable can interrupt initial provisioning before a tenant exists.
  readonly target: ServiceBindingRequestV1 | ServiceTenantBindingV1;
  readonly shutdown:
    | {
        readonly kind: 'pending';
        readonly observed: ServiceObservedStateV1;
        readonly receipt?: never;
      }
    | {
        readonly kind: 'confirmed';
        readonly receipt: AcceptedServiceReceiptV1 & { readonly result: 'disabled' };
        readonly observed?: never;
      };
  readonly binding?: never;
  readonly receipt?: never;
};

export type FailedServiceStateV1 = {
  readonly kind: 'failed';
  readonly desiredRevision: number;
  readonly operationId: string;
  readonly target: ServiceBindingRequestV1 | ServiceTenantBindingV1;
  readonly command: 'enable' | 'disable' | 'archive';
  readonly failureCode: string;
  readonly observed: ServiceObservedStateV1;
  readonly binding?: never;
  readonly receipt?: never;
};

export type ArchivedServiceStateV1 = {
  readonly kind: 'archived';
  readonly desiredRevision: number;
  readonly observedRevision: number;
  readonly binding: ServiceTenantBindingV1;
  readonly receipt: AcceptedServiceReceiptV1 & { readonly result: 'archived' };
  readonly target?: never;
  readonly observed?: never;
};

export type ServiceInstanceStateV1 =
  | ProvisioningServiceStateV1
  | ActiveServiceStateV1
  | DisabledServiceStateV1
  | FailedServiceStateV1
  | ArchivedServiceStateV1;

/** Read the latest desired record and its receipt together from authoritative storage. */
export class BoundServiceInstanceV1<State extends ActiveServiceStateV1 | ArchivedServiceStateV1> {
  private constructor(
    readonly instanceId: string,
    readonly serviceId: PlatformServiceIdV1,
    readonly state: State,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static active(
    input: unknown,
  ): PlatformResult<BoundServiceInstanceV1<ActiveServiceStateV1>, PlatformContractError> {
    return contractResult(BoundServiceInstanceV1.readActive, input);
  }

  static archived(
    input: unknown,
  ): PlatformResult<BoundServiceInstanceV1<ArchivedServiceStateV1>, PlatformContractError> {
    return contractResult(BoundServiceInstanceV1.readArchived, input);
  }

  private static readActive(input: unknown): BoundServiceInstanceV1<ActiveServiceStateV1> {
    const receipt = readMatchingReceipt(input, 'enabled');
    if (receipt.result !== 'active') return invalidContract('result');
    const activeReceipt = Object.freeze({
      version: receipt.version,
      operationId: receipt.operationId,
      instanceId: receipt.instanceId,
      desiredRevision: receipt.desiredRevision,
      result: receipt.result,
      binding: receipt.binding,
    });
    return new BoundServiceInstanceV1(
      receipt.instanceId,
      receipt.binding.nativeScope.serviceId,
      Object.freeze({
        kind: 'active',
        desiredRevision: receipt.desiredRevision,
        observedRevision: receipt.desiredRevision,
        binding: receipt.binding,
        receipt: activeReceipt,
      }),
    );
  }

  private static readArchived(input: unknown): BoundServiceInstanceV1<ArchivedServiceStateV1> {
    const receipt = readMatchingReceipt(input, 'archived');
    if (receipt.result !== 'archived') return invalidContract('result');
    const archivedReceipt = Object.freeze({
      version: receipt.version,
      operationId: receipt.operationId,
      instanceId: receipt.instanceId,
      desiredRevision: receipt.desiredRevision,
      result: receipt.result,
      binding: receipt.binding,
    });
    return new BoundServiceInstanceV1(
      receipt.instanceId,
      receipt.binding.nativeScope.serviceId,
      Object.freeze({
        kind: 'archived',
        desiredRevision: receipt.desiredRevision,
        observedRevision: receipt.desiredRevision,
        binding: receipt.binding,
        receipt: archivedReceipt,
      }),
    );
  }
}

function readMatchingReceipt(
  input: unknown,
  desiredState: 'enabled' | 'archived',
): AcceptedServiceReceiptV1 {
  const record = object(input, 'instance');
  exactKeys(record, ['instanceId', 'operationId', 'desiredState', 'desiredRevision', 'receipt']);
  if (record.desiredState !== desiredState) return invalidContract('desiredState');
  const instanceId = textValue(record.instanceId, 'instanceId');
  const operationId = textValue(record.operationId, 'operationId');
  const revision = integer(record.desiredRevision, 'desiredRevision', 1);
  const receipt = readBoundReceipt(record.receipt);
  if (receipt.instanceId !== instanceId) return invalidContract('receipt.instanceId');
  if (receipt.operationId !== operationId) return invalidContract('receipt.operationId');
  if (receipt.desiredRevision !== revision) return invalidContract('receipt.desiredRevision');
  return receipt;
}

export function parseServiceProvisionReceiptV1(
  input: unknown,
): PlatformResult<AcceptedServiceReceiptV1, PlatformContractError> {
  return contractResult(readBoundReceipt, input);
}

function readBoundReceipt(input: unknown): AcceptedServiceReceiptV1 {
  const record = object(input, 'receipt');
  exactKeys(record, [
    'version',
    'operationId',
    'instanceId',
    'desiredRevision',
    'result',
    'binding',
  ]);
  const version = versionOne(record.version);
  const operationId = textValue(record.operationId, 'operationId');
  const instanceId = textValue(record.instanceId, 'instanceId');
  const desiredRevision = integer(record.desiredRevision, 'desiredRevision', 1);
  if (record.result !== 'active' && record.result !== 'disabled' && record.result !== 'archived') {
    return invalidContract('result');
  }
  const binding = ServiceTenantBindingV1.parse(record.binding);
  if (binding.kind === 'rejected') return invalidContract(`binding.${binding.error.field}`);
  if (binding.value.instanceId !== instanceId) return invalidContract('binding.instanceId');
  return Object.freeze({
    version,
    operationId,
    instanceId,
    desiredRevision,
    result: record.result,
    binding: binding.value,
  });
}

export function readDurableSourceEvidenceV1(
  input: unknown,
  field = 'evidence',
): DurableSourceEvidenceV1 {
  const record = exactObject(input, ['sourceRecordId', 'sourceDigest'], field);
  return {
    sourceRecordId: textValue(record.sourceRecordId, `${field}.sourceRecordId`),
    sourceDigest: digestValue(record.sourceDigest, `${field}.sourceDigest`),
  };
}
