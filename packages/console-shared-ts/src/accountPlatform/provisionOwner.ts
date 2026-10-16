import {
  ServiceTenantBindingV1,
  readPlatformScopeV1,
  readNativeTenantScope,
  type PlatformScopeFieldsV1,
  type SatyrTenantScopeV1,
} from './scope';
import {
  ServiceProvisionCommandV1,
  parseServiceProvisionReceiptV1,
  type ServiceBindingRequestV1,
  type AcceptedServiceReceiptV1,
} from './instances';
import type { ServiceProvisionDeliveryV1, ServiceProducerAuthorityV1 } from './protocol';
import {
  contractResult,
  exactObject,
  integer,
  assertNever,
  requirePlatformContract,
  digestValue,
  exactKeys,
  invalidContract,
  object,
  textValue,
  utcTimestamp,
  versionOne,
  type PlatformContractError,
  type PlatformResult,
} from './boundary';

/** A fresh account signature binds the verified owner to one durable command. */
export class ServiceProvisionOwnerAssertionV1 {
  readonly version = 1;
  readonly purpose = 'satyr_provision_owner';
  readonly providerIssuer = 'https://accounts.google.com';

  private constructor(
    readonly issuer: string,
    readonly audience: string,
    readonly operationId: string,
    readonly instanceId: string,
    readonly requestedByUserId: string,
    readonly providerSubject: string,
    readonly bodyDigest: string,
    readonly expiresAt: string,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(
    input: unknown,
  ): PlatformResult<ServiceProvisionOwnerAssertionV1, PlatformContractError> {
    return contractResult(ServiceProvisionOwnerAssertionV1.read, input);
  }

  private static read(input: unknown): ServiceProvisionOwnerAssertionV1 {
    const record = object(input, 'provisionOwnerAssertion');
    exactKeys(record, [
      'version',
      'purpose',
      'issuer',
      'audience',
      'operationId',
      'instanceId',
      'requestedByUserId',
      'providerIssuer',
      'providerSubject',
      'bodyDigest',
      'expiresAt',
    ]);
    versionOne(record.version);
    if (record.purpose !== 'satyr_provision_owner') return invalidContract('purpose');
    if (record.providerIssuer !== 'https://accounts.google.com')
      return invalidContract('providerIssuer');
    return new ServiceProvisionOwnerAssertionV1(
      textValue(record.issuer, 'issuer'),
      textValue(record.audience, 'audience'),
      textValue(record.operationId, 'operationId'),
      textValue(record.instanceId, 'instanceId'),
      textValue(record.requestedByUserId, 'requestedByUserId'),
      textValue(record.providerSubject, 'providerSubject'),
      digestValue(record.bodyDigest, 'bodyDigest'),
      utcTimestamp(record.expiresAt, 'expiresAt'),
    );
  }
}

export interface AccountProvisionedServiceOwnerV1 {
  readonly nativePrincipalId: string;
  readonly platformUserId: string;
  readonly issuer: 'https://accounts.google.com';
  readonly subject: string;
  readonly verificationReceiptId: string;
}

export interface AccountProvisionOwnerGrantV1 {
  readonly platformMembershipId: string;
  readonly accountAcceptanceReceiptId: string;
  readonly serviceGrant:
    | { readonly kind: 'instance_access'; readonly accessRevision: number }
    | { readonly kind: 'account_management'; readonly accessRevision?: never };
}

export type SatyrServiceTenantBindingV1 = Readonly<{
  instanceId: ServiceTenantBindingV1['instanceId'];
  scope: PlatformScopeFieldsV1;
  nativeScope: SatyrTenantScopeV1;
  kind?: never;
  parent?: never;
  configuration?: never;
  authorityEvidence?: never;
  serviceId?: never;
}>;
export type SatyrProvisionBindingV1 =
  | (Omit<
      Extract<ServiceBindingRequestV1, { kind: 'create_native_scope'; serviceId: 'satyr' }>,
      'parent'
    > & {
      readonly parent: PlatformScopeFieldsV1;
      readonly instanceId?: never;
      readonly scope?: never;
    })
  | (Extract<ServiceBindingRequestV1, { kind: 'attach_existing_scope' }> & {
      readonly nativeScope: SatyrTenantScopeV1;
      readonly instanceId?: never;
      readonly scope?: never;
      readonly serviceId?: never;
    })
  | SatyrServiceTenantBindingV1;
export type SatyrProvisionCommandV1 = Pick<
  ServiceProvisionCommandV1,
  'version' | 'operationId' | 'instanceId' | 'desiredRevision' | 'command'
> & { readonly binding: SatyrProvisionBindingV1 };
export type SatyrProvisionDeliveryV1 = Omit<
  ServiceProvisionDeliveryV1,
  'scope' | 'command' | 'authority'
> &
  Readonly<{
    scope: PlatformScopeFieldsV1;
    command: SatyrProvisionCommandV1;
    authority: ServiceProducerAuthorityV1 & { readonly serviceId: 'satyr' };
  }>;
export type SatyrProvisionOwnerV1 = Omit<AccountProvisionedServiceOwnerV1, 'nativePrincipalId'> &
  AccountProvisionOwnerGrantV1 &
  Readonly<{ email: string | null; emailVerified: boolean; displayName: string | null }>;
export type SatyrProvisionEnvelopeV1 = Readonly<{
  version: 1;
  delivery: SatyrProvisionDeliveryV1;
  owner: SatyrProvisionOwnerV1;
  ownerAssertion: string;
}>;
export type SatyrProvisionReceiptV1 = Omit<AcceptedServiceReceiptV1, 'binding'> & {
  readonly binding: SatyrServiceTenantBindingV1;
};
export type SatyrProvisionAppliedV1 = Readonly<{
  kind: 'applied';
  receipt: SatyrProvisionReceiptV1;
  owner: AccountProvisionedServiceOwnerV1;
}>;
export function readSatyrProvisionOwnerV1(input: unknown): SatyrProvisionOwnerV1 {
  const r = exactObject(input, [
    'platformUserId',
    'issuer',
    'subject',
    'email',
    'emailVerified',
    'displayName',
    'verificationReceiptId',
    'platformMembershipId',
    'accountAcceptanceReceiptId',
    'serviceGrant',
  ]);
  if (r.issuer !== 'https://accounts.google.com' || typeof r.emailVerified !== 'boolean')
    throw new Error('Invalid provision owner');
  return {
    platformUserId: textValue(r.platformUserId),
    issuer: r.issuer,
    subject: textValue(r.subject),
    email: r.email === null ? null : textValue(r.email),
    emailVerified: r.emailVerified,
    displayName: r.displayName === null ? null : textValue(r.displayName),
    verificationReceiptId: textValue(r.verificationReceiptId),
    platformMembershipId: textValue(r.platformMembershipId),
    accountAcceptanceReceiptId: textValue(r.accountAcceptanceReceiptId),
    serviceGrant: readOwnerServiceGrant(r.serviceGrant),
  };
}
function readOwnerServiceGrant(input: unknown): SatyrProvisionOwnerV1['serviceGrant'] {
  const record = object(input, 'service grant');
  switch (record.kind) {
    case 'instance_access':
      exactObject(record, ['kind', 'accessRevision']);
      return {
        kind: 'instance_access',
        accessRevision: integer(record.accessRevision, 'accessRevision', 1),
      };
    case 'account_management':
      exactObject(record, ['kind']);
      return { kind: 'account_management' };
    default:
      throw new Error('Unknown owner service grant');
  }
}

type ParsedSatyrBinding = ServiceTenantBindingV1 & { readonly nativeScope: SatyrTenantScopeV1 };
function assertSatyrBinding(
  binding: ServiceTenantBindingV1,
): asserts binding is ParsedSatyrBinding {
  if (binding.nativeScope.serviceId !== 'satyr') return invalidContract('nativeScope.serviceId');
}
export function readSatyrNativeScopeV1(input: unknown): SatyrTenantScopeV1 {
  const scope = readNativeTenantScope(input);
  if (scope.serviceId !== 'satyr') return invalidContract('nativeScope.serviceId');
  return scope;
}
export function readSatyrServiceTenantBindingV1(input: unknown): ParsedSatyrBinding {
  const binding = requirePlatformContract(ServiceTenantBindingV1.parse(input));
  assertSatyrBinding(binding);
  return binding;
}
function satyrProvisionBinding(
  binding: ServiceProvisionCommandV1['binding'],
): SatyrProvisionBindingV1 {
  if (binding instanceof ServiceTenantBindingV1) {
    assertSatyrBinding(binding);
    return {
      instanceId: binding.instanceId,
      scope: binding.scope,
      nativeScope: binding.nativeScope,
    };
  }
  switch (binding.kind) {
    case 'create_native_scope':
      if (binding.serviceId !== 'satyr') return invalidContract('binding.serviceId');
      return binding;
    case 'attach_existing_scope':
      if (binding.nativeScope.serviceId !== 'satyr')
        return invalidContract('binding.nativeScope.serviceId');
      return {
        kind: binding.kind,
        nativeScope: binding.nativeScope,
        authorityEvidence: binding.authorityEvidence,
      };
    default:
      return assertNever(binding);
  }
}
export function readSatyrProvisionDeliveryV1(input: unknown): SatyrProvisionDeliveryV1 {
  const record = exactObject(input, [
    'scope',
    'command',
    'authority',
    'payloadDigest',
    'requestedByUserId',
  ]);
  const command = requirePlatformContract(ServiceProvisionCommandV1.parse(record.command));
  const authority = exactObject(record.authority, ['serviceId', 'deploymentId']);
  if (authority.serviceId !== 'satyr') return invalidContract('authority.serviceId');
  return {
    scope: readPlatformScopeV1(record.scope),
    command: {
      version: 1,
      operationId: command.operationId,
      instanceId: command.instanceId,
      desiredRevision: command.desiredRevision,
      command: command.command,
      binding: satyrProvisionBinding(command.binding),
    },
    authority: { serviceId: 'satyr', deploymentId: textValue(authority.deploymentId) },
    payloadDigest: digestValue(record.payloadDigest, 'payloadDigest'),
    requestedByUserId: textValue(record.requestedByUserId),
  };
}
export function readSatyrProvisionEnvelopeV1(input: unknown): SatyrProvisionEnvelopeV1 {
  const record = exactObject(input, ['version', 'delivery', 'owner', 'ownerAssertion']);
  versionOne(record.version);
  return {
    version: 1,
    delivery: readSatyrProvisionDeliveryV1(record.delivery),
    owner: readSatyrProvisionOwnerV1(record.owner),
    ownerAssertion: textValue(record.ownerAssertion),
  };
}
export function readSatyrProvisionAppliedV1(
  input: unknown,
): SatyrProvisionAppliedV1 & { readonly receipt: AcceptedServiceReceiptV1 } {
  const record = exactObject(input, ['kind', 'receipt', 'owner']);
  if (record.kind !== 'applied') return invalidContract('kind');
  const receipt = requirePlatformContract(parseServiceProvisionReceiptV1(record.receipt));
  assertSatyrBinding(receipt.binding);
  return {
    kind: 'applied',
    receipt: {
      version: 1,
      operationId: receipt.operationId,
      instanceId: receipt.instanceId,
      desiredRevision: receipt.desiredRevision,
      result: receipt.result,
      binding: receipt.binding,
    },
    owner: readProvisionedServiceOwnerV1(record.owner),
  };
}
export function readProvisionedServiceOwnerV1(input: unknown): AccountProvisionedServiceOwnerV1 {
  const record = exactObject(input, [
    'nativePrincipalId',
    'platformUserId',
    'issuer',
    'subject',
    'verificationReceiptId',
  ]);
  if (record.issuer !== 'https://accounts.google.com') return invalidContract('issuer');
  return {
    nativePrincipalId: textValue(record.nativePrincipalId),
    platformUserId: textValue(record.platformUserId),
    issuer: record.issuer,
    subject: textValue(record.subject),
    verificationReceiptId: textValue(record.verificationReceiptId),
  };
}
