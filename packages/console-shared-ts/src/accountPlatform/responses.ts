import {
  exactObject,
  object,
  textValue,
  integer,
  versionOne,
  requirePlatformContract,
} from './boundary';
import { readPlatformScopeV1 } from './scope';
import {
  readPlatformPrincipalV1,
  readServiceAdmissionActionV1,
  ServiceIdentityResolutionV1,
  SatyrServiceFeePolicyV1,
} from './access';
import { readFundsReservationV1 } from './funds';
import type { FundsReservationV1, ServiceEligibilityResultV1 } from './protocol';
import type { PlatformUsageReceiptV1 } from './usage';

export type ServiceEligibilityV1 = Extract<
  ServiceEligibilityResultV1,
  { readonly kind: 'accepted' }
>['value'];
export interface ReserveFundsResponseV1 {
  readonly reservation: FundsReservationV1;
  readonly disposition: 'reserved' | 'replayed';
}

export function readReserveFundsResponseV1(input: unknown): ReserveFundsResponseV1 {
  const r = exactObject(input, ['reservation', 'disposition']);
  if (r.disposition !== 'reserved' && r.disposition !== 'replayed')
    throw new Error('Invalid reserve disposition');
  return { reservation: readFundsReservationV1(r.reservation), disposition: r.disposition };
}
export function readServiceIdentityResolutionV1(input: unknown): ServiceIdentityResolutionV1 {
  return requirePlatformContract(ServiceIdentityResolutionV1.parse(input));
}
export function readSatyrServiceFeePolicyV1(input: unknown): SatyrServiceFeePolicyV1 {
  return requirePlatformContract(SatyrServiceFeePolicyV1.parse(input));
}
export function readServiceEligibilityV1(input: unknown): ServiceEligibilityV1 {
  const r = exactObject(input, [
    'authorityRevision',
    'accessRevision',
    'scope',
    'instanceId',
    'principal',
    'action',
  ]);
  return {
    authorityRevision: integer(r.authorityRevision, 'authorityRevision', 1),
    accessRevision: integer(r.accessRevision, 'accessRevision', 1),
    scope: readPlatformScopeV1(r.scope),
    instanceId: textValue(r.instanceId),
    principal: readPlatformPrincipalV1(r.principal),
    action: readServiceAdmissionActionV1(r.action),
  };
}
export type AccountServiceErrorV1 = Readonly<{
  code:
    | 'authority_unavailable'
    | 'scope_forbidden'
    | 'membership_ineligible'
    | 'instance_ineligible'
    | 'insufficient_funds'
    | 'price_unavailable'
    | 'operation_conflict'
    | 'provisioning_failed'
    | 'execution_unreconciled'
    | 'meter_unknown'
    | 'event_conflict';
}>;
export type LinkedServiceUserV1 = Readonly<{
  nativeUserId: string;
  platformUserId: string;
  issuer: 'https://accounts.google.com';
  subject: string;
  verificationReceiptId: string;
}>;

export function readPlatformUsageReceiptV1(input: unknown): PlatformUsageReceiptV1 {
  const record = object(input, 'usage receipt');
  switch (record.kind) {
    case 'charged':
      exactObject(record, ['kind', 'chargeId', 'amountMinor', 'priceVersion']);
      return {
        kind: record.kind,
        chargeId: textValue(record.chargeId),
        amountMinor: integer(record.amountMinor, 'integer', 0),
        priceVersion: textValue(record.priceVersion),
      };
    case 'recorded_without_charge':
      exactObject(record, ['kind', 'reason']);
      if (record.reason !== 'meter_already_counted' && record.reason !== 'nonbillable_outcome')
        throw new Error('Invalid no-charge reason');
      return { kind: record.kind, reason: record.reason };
    default:
      throw new Error('Invalid receipt kind');
  }
}

export function readLinkedServiceUserV1(input: unknown): LinkedServiceUserV1 {
  const r = exactObject(input, [
    'nativeUserId',
    'platformUserId',
    'issuer',
    'subject',
    'verificationReceiptId',
  ]);
  if (r.issuer !== 'https://accounts.google.com') throw new Error('Unsupported linked provider');
  return {
    nativeUserId: textValue(r.nativeUserId),
    platformUserId: textValue(r.platformUserId),
    issuer: r.issuer,
    subject: textValue(r.subject),
    verificationReceiptId: textValue(r.verificationReceiptId),
  };
}

export function readAccountServiceErrorV1(input: unknown): AccountServiceErrorV1 {
  const record = object(input, 'account error');
  if (Object.keys(record).some(unexpectedErrorKey)) throw new Error('Invalid account error');
  if (record.retryable !== undefined && typeof record.retryable !== 'boolean')
    throw new Error('Invalid retry state');
  switch (record.code) {
    case 'authority_unavailable':
    case 'scope_forbidden':
    case 'membership_ineligible':
    case 'instance_ineligible':
    case 'insufficient_funds':
    case 'price_unavailable':
    case 'operation_conflict':
    case 'provisioning_failed':
    case 'execution_unreconciled':
    case 'meter_unknown':
    case 'event_conflict':
      return { code: record.code };
    default:
      throw new Error('Unknown account error');
  }
}
function unexpectedErrorKey(key: string): boolean {
  return key !== 'code' && key !== 'retryable';
}

export interface AccountAutomationGrantChangeV1 {
  readonly instanceId: string;
  readonly automationId: string;
  readonly grantId: string;
  readonly nativePrincipalId: string;
  readonly access: 'allowed' | 'revoked';
  readonly expectedAccessRevision: number;
}

export interface AccountAutomationGrantV1 extends Omit<
  AccountAutomationGrantChangeV1,
  'expectedAccessRevision'
> {
  readonly version: 1;
  readonly scope: ServiceIdentityResolutionV1['scope'];
  readonly authorityRevision: number;
  readonly accessRevision: number;
}

export function readAccountAutomationGrantV1(input: unknown): AccountAutomationGrantV1 {
  const r = exactObject(input, [
    'version',
    'scope',
    'instanceId',
    'automationId',
    'grantId',
    'nativePrincipalId',
    'access',
    'authorityRevision',
    'accessRevision',
  ]);
  versionOne(r.version);
  if (r.access !== 'allowed' && r.access !== 'revoked')
    throw new Error('Invalid automation grant access');
  return {
    version: 1,
    scope: readPlatformScopeV1(r.scope),
    instanceId: textValue(r.instanceId),
    automationId: textValue(r.automationId),
    grantId: textValue(r.grantId),
    nativePrincipalId: textValue(r.nativePrincipalId),
    access: r.access,
    authorityRevision: integer(r.authorityRevision, 'authorityRevision', 1),
    accessRevision: integer(r.accessRevision, 'accessRevision', 1),
  };
}
