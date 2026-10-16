import {
  assertNever,
  contractResult,
  exactKeys,
  invalidContract,
  object,
  textValue,
  type PlatformContractError,
  type PlatformResult,
} from './boundary';

export type PlatformServiceIdV1 = 'wallet' | 'satyr';

export interface PlatformScopeFieldsV1 {
  readonly namespace: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly billingAccountId: string;
}

/** Parsed identity is not authorization. Resolve this record from account storage. */
export class PlatformScopeV1 implements PlatformScopeFieldsV1 {
  private constructor(
    readonly namespace: string,
    readonly organizationId: string,
    readonly projectId: string,
    readonly billingAccountId: string,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<PlatformScopeV1, PlatformContractError> {
    return contractResult(PlatformScopeV1.read, input);
  }

  private static read(input: unknown): PlatformScopeV1 {
    const record = object(input, 'scope');
    exactKeys(record, ['namespace', 'organizationId', 'projectId', 'billingAccountId']);
    return new PlatformScopeV1(
      textValue(record.namespace, 'namespace'),
      textValue(record.organizationId, 'organizationId'),
      textValue(record.projectId, 'projectId'),
      textValue(record.billingAccountId, 'billingAccountId'),
    );
  }
}

export interface WalletTenantScopeV1 {
  readonly serviceId: 'wallet';
  readonly deploymentId: string;
  readonly namespace: string;
  readonly nativeOrganizationId: string;
  readonly nativeProjectId: string;
}

export interface SatyrTenantScopeV1 {
  readonly serviceId: 'satyr';
  readonly deploymentId: string;
  readonly nativeOrganizationId: string;
  readonly namespace?: never;
  readonly nativeProjectId?: never;
}

export type NativeTenantScopeV1 = WalletTenantScopeV1 | SatyrTenantScopeV1;

export function readNativeTenantScope(input: unknown): NativeTenantScopeV1 {
  const record = object(input, 'nativeScope');
  switch (record.serviceId) {
    case 'wallet':
      exactKeys(record, [
        'serviceId',
        'deploymentId',
        'namespace',
        'nativeOrganizationId',
        'nativeProjectId',
      ]);
      return Object.freeze({
        serviceId: 'wallet',
        deploymentId: textValue(record.deploymentId, 'deploymentId'),
        namespace: textValue(record.namespace, 'namespace'),
        nativeOrganizationId: textValue(record.nativeOrganizationId, 'nativeOrganizationId'),
        nativeProjectId: textValue(record.nativeProjectId, 'nativeProjectId'),
      });
    case 'satyr':
      exactKeys(record, ['serviceId', 'deploymentId', 'nativeOrganizationId']);
      return Object.freeze({
        serviceId: 'satyr',
        deploymentId: textValue(record.deploymentId, 'deploymentId'),
        nativeOrganizationId: textValue(record.nativeOrganizationId, 'nativeOrganizationId'),
      });
    default:
      return invalidContract('serviceId');
  }
}

/** JSON tuples preserve component boundaries, including separators inside native IDs. */
export function nativeTenantScopeKey(scope: NativeTenantScopeV1): string {
  switch (scope.serviceId) {
    case 'wallet':
      return JSON.stringify([
        scope.serviceId,
        scope.deploymentId,
        scope.namespace,
        scope.nativeOrganizationId,
        scope.nativeProjectId,
      ]);
    case 'satyr':
      return JSON.stringify([scope.serviceId, scope.deploymentId, scope.nativeOrganizationId]);
    default:
      return assertNever(scope);
  }
}

export class ServiceTenantBindingV1 {
  private constructor(
    readonly instanceId: string,
    readonly scope: PlatformScopeV1,
    readonly nativeScope: NativeTenantScopeV1,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<ServiceTenantBindingV1, PlatformContractError> {
    return contractResult(ServiceTenantBindingV1.read, input);
  }

  private static read(input: unknown): ServiceTenantBindingV1 {
    const record = object(input, 'binding');
    exactKeys(record, ['instanceId', 'scope', 'nativeScope']);
    const scope = PlatformScopeV1.parse(record.scope);
    if (scope.kind === 'rejected') return invalidContract(`scope.${scope.error.field}`);
    return new ServiceTenantBindingV1(
      textValue(record.instanceId, 'instanceId'),
      scope.value,
      readNativeTenantScope(record.nativeScope),
    );
  }
}

export function readPlatformScopeV1(input: unknown): PlatformScopeV1 {
  const parsed = PlatformScopeV1.parse(input);
  if (parsed.kind === 'rejected') return invalidContract(parsed.error.field);
  return parsed.value;
}

export function platformScopeFieldsEqual(
  left: PlatformScopeFieldsV1,
  right: PlatformScopeFieldsV1,
): boolean {
  return (
    left.namespace === right.namespace &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.billingAccountId === right.billingAccountId
  );
}
