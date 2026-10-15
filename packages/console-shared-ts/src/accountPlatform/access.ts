import {
  contractResult,
  exactKeys,
  integer,
  invalidContract,
  object,
  textValue,
  utcTimestamp,
  versionOne,
  type PlatformContractError,
  type PlatformResult,
} from './boundary';
import type {
  PlatformIdentityLinkV1,
  PlatformPrincipalV1,
  PlatformUserAuthorityV1,
  ServiceAdmissionActionV1,
} from './protocol';
import { PlatformScopeV1 } from './scope';

export class ServiceEligibilityRequestV1 {
  readonly version = 1;

  private constructor(
    readonly instanceId: string,
    readonly principal: PlatformPrincipalV1,
    readonly action: ServiceAdmissionActionV1,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<ServiceEligibilityRequestV1, PlatformContractError> {
    return contractResult(ServiceEligibilityRequestV1.read, input);
  }

  private static read(input: unknown): ServiceEligibilityRequestV1 {
    const record = object(input, 'eligibility');
    exactKeys(record, ['version', 'instanceId', 'principal', 'action']);
    versionOne(record.version);
    const principal = readPlatformPrincipalV1(record.principal);
    const action = readPrincipalAction(principal, record.action);
    return new ServiceEligibilityRequestV1(
      textValue(record.instanceId, 'instanceId'),
      principal,
      action,
    );
  }
}

/** A signature verifies this envelope separately from producer authentication. */
export class DelegatedPlatformAssertionV1 {
  readonly version = 1;

  private constructor(
    readonly issuer: string,
    readonly audience: string,
    readonly principal: PlatformPrincipalV1,
    readonly nativePrincipalId: string,
    readonly scope: PlatformScopeV1,
    readonly instanceId: string,
    readonly action: ServiceAdmissionActionV1,
    readonly expiresAt: string,
    readonly authorityRevision: number,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(
    input: unknown,
  ): PlatformResult<DelegatedPlatformAssertionV1, PlatformContractError> {
    return contractResult(DelegatedPlatformAssertionV1.read, input);
  }

  private static read(input: unknown): DelegatedPlatformAssertionV1 {
    const record = object(input, 'assertion');
    exactKeys(record, [
      'version',
      'issuer',
      'audience',
      'principal',
      'nativePrincipalId',
      'scope',
      'instanceId',
      'action',
      'expiresAt',
      'authorityRevision',
    ]);
    versionOne(record.version);
    const scope = PlatformScopeV1.parse(record.scope);
    if (scope.kind === 'rejected') return invalidContract(`scope.${scope.error.field}`);
    const principal = readPlatformPrincipalV1(record.principal);
    const action = readPrincipalAction(principal, record.action);
    return new DelegatedPlatformAssertionV1(
      textValue(record.issuer, 'issuer'),
      textValue(record.audience, 'audience'),
      principal,
      textValue(record.nativePrincipalId, 'nativePrincipalId'),
      scope.value,
      textValue(record.instanceId, 'instanceId'),
      action,
      utcTimestamp(record.expiresAt, 'expiresAt'),
      integer(record.authorityRevision, 'authorityRevision', 0),
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      version: this.version,
      issuer: this.issuer,
      audience: this.audience,
      principal: this.principal,
      nativePrincipalId: this.nativePrincipalId,
      scope: this.scope,
      instanceId: this.instanceId,
      action: this.action,
      expiresAt: this.expiresAt,
      authorityRevision: this.authorityRevision,
    };
  }
}

/** Google proof is transient input. It must never enter persisted link records. */
export class ServiceIdentityLinkRequestV1 {
  readonly version = 1;

  private constructor(
    readonly instanceId: string,
    readonly googleIdToken: string,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(
    input: unknown,
  ): PlatformResult<ServiceIdentityLinkRequestV1, PlatformContractError> {
    return contractResult(ServiceIdentityLinkRequestV1.read, input);
  }

  private static read(input: unknown): ServiceIdentityLinkRequestV1 {
    const record = object(input, 'identityLink');
    exactKeys(record, ['version', 'instanceId', 'googleIdToken']);
    versionOne(record.version);
    return new ServiceIdentityLinkRequestV1(
      textValue(record.instanceId, 'instanceId'),
      textValue(record.googleIdToken, 'googleIdToken'),
    );
  }
}

/** Resolution supplies a current revision. It does not grant protected access. */
export class ServiceIdentityResolutionV1 {
  readonly version = 1;

  private constructor(
    readonly scope: PlatformScopeV1,
    readonly instanceId: string,
    readonly nativePrincipalId: string,
    readonly principal: PlatformPrincipalV1,
    readonly authorityRevision: number,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<ServiceIdentityResolutionV1, PlatformContractError> {
    return contractResult(ServiceIdentityResolutionV1.read, input);
  }

  private static read(input: unknown): ServiceIdentityResolutionV1 {
    const record = object(input, 'identityResolution');
    exactKeys(record, [
      'version',
      'scope',
      'instanceId',
      'nativePrincipalId',
      'principal',
      'authorityRevision',
    ]);
    versionOne(record.version);
    const scope = PlatformScopeV1.parse(record.scope);
    if (scope.kind === 'rejected') return invalidContract(`scope.${scope.error.field}`);
    return new ServiceIdentityResolutionV1(
      scope.value,
      textValue(record.instanceId, 'instanceId'),
      textValue(record.nativePrincipalId, 'nativePrincipalId'),
      readPlatformPrincipalV1(record.principal),
      integer(record.authorityRevision, 'authorityRevision', 1),
    );
  }
}

export type SatyrFeePolicyV1 =
  | {
      readonly kind: 'customer_unpriced';
      readonly meterId?: never;
      readonly priceVersion?: never;
      readonly currency?: never;
      readonly unitMinor?: never;
    }
  | {
      readonly kind: 'isolated_e2e_completed_turn';
      readonly meterId: 'satyr.completed_turn.test';
      readonly priceVersion: 'satyr-completed-turn-test-v1';
      readonly currency: 'USD';
      readonly unitMinor: 1;
    };

/** Customer execution retains native funding until a customer service price exists. */
export class SatyrServiceFeePolicyV1 {
  readonly version = 1;

  private constructor(
    readonly instanceId: string,
    readonly scope: PlatformScopeV1,
    readonly policy: SatyrFeePolicyV1,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<SatyrServiceFeePolicyV1, PlatformContractError> {
    return contractResult(SatyrServiceFeePolicyV1.read, input);
  }

  private static read(input: unknown): SatyrServiceFeePolicyV1 {
    const record = object(input, 'feePolicy');
    exactKeys(record, ['version', 'instanceId', 'scope', 'policy']);
    versionOne(record.version);
    const scope = PlatformScopeV1.parse(record.scope);
    if (scope.kind === 'rejected') return invalidContract(`scope.${scope.error.field}`);
    return new SatyrServiceFeePolicyV1(
      textValue(record.instanceId, 'instanceId'),
      scope.value,
      readSatyrFeePolicyV1(record.policy),
    );
  }
}

export function readSatyrFeePolicyV1(input: unknown): SatyrFeePolicyV1 {
  const record = object(input, 'policy');
  switch (record.kind) {
    case 'customer_unpriced':
      exactKeys(record, ['kind']);
      return Object.freeze({ kind: record.kind });
    case 'isolated_e2e_completed_turn':
      exactKeys(record, ['kind', 'meterId', 'priceVersion', 'currency', 'unitMinor']);
      if (record.meterId !== 'satyr.completed_turn.test') return invalidContract('meterId');
      if (record.priceVersion !== 'satyr-completed-turn-test-v1')
        return invalidContract('priceVersion');
      if (record.currency !== 'USD') return invalidContract('currency');
      if (record.unitMinor !== 1) return invalidContract('unitMinor');
      return Object.freeze({
        kind: record.kind,
        meterId: record.meterId,
        priceVersion: record.priceVersion,
        currency: record.currency,
        unitMinor: record.unitMinor,
      });
    default:
      return invalidContract('policy.kind');
  }
}

export function readPlatformPrincipalV1(input: unknown): PlatformPrincipalV1 {
  const record = object(input, 'principal');
  switch (record.kind) {
    case 'user':
      exactKeys(record, ['kind', 'identity', 'authority']);
      return Object.freeze({
        kind: record.kind,
        identity: readIdentityLink(record.identity),
        authority: readPlatformUserAuthorityV1(record.authority),
      });
    case 'automation':
      exactKeys(record, ['kind', 'automationId', 'grantId']);
      return Object.freeze({
        kind: record.kind,
        automationId: textValue(record.automationId, 'automationId'),
        grantId: textValue(record.grantId, 'grantId'),
      });
    default:
      return invalidContract('principal.kind');
  }
}

export function readPlatformUserAuthorityV1(input: unknown): PlatformUserAuthorityV1 {
  const record = object(input, 'authority');
  switch (record.kind) {
    case 'authenticated_session':
      exactKeys(record, ['kind', 'nativeSessionId']);
      return Object.freeze({
        kind: record.kind,
        nativeSessionId: textValue(record.nativeSessionId, 'nativeSessionId'),
      });
    case 'accepted_execution':
      exactKeys(record, ['kind', 'acceptedExecutionId']);
      return Object.freeze({
        kind: record.kind,
        acceptedExecutionId: textValue(record.acceptedExecutionId, 'acceptedExecutionId'),
      });
    case 'disclosure_recipient':
      exactKeys(record, ['kind', 'disclosureEvidenceId']);
      return Object.freeze({
        kind: record.kind,
        disclosureEvidenceId: textValue(record.disclosureEvidenceId, 'disclosureEvidenceId'),
      });
    case 'authenticated_provider_event':
      exactKeys(record, [
        'kind',
        'provider',
        'nativeEventId',
        'nativeIntegrationAccountId',
        'nativeWorkspaceId',
        'nativeExternalUserId',
      ]);
      if (record.provider !== 'slack') return invalidContract('authority.provider');
      return Object.freeze({
        kind: record.kind,
        provider: record.provider,
        nativeEventId: textValue(record.nativeEventId, 'nativeEventId'),
        nativeIntegrationAccountId: textValue(
          record.nativeIntegrationAccountId,
          'nativeIntegrationAccountId',
        ),
        nativeWorkspaceId: textValue(record.nativeWorkspaceId, 'nativeWorkspaceId'),
        nativeExternalUserId: textValue(record.nativeExternalUserId, 'nativeExternalUserId'),
      });
    default:
      return invalidContract('authority.kind');
  }
}

function readPrincipalAction(
  principal: PlatformPrincipalV1,
  input: unknown,
): ServiceAdmissionActionV1 {
  const action = readServiceAdmissionActionV1(input);
  if (
    principal.kind === 'user' &&
    principal.authority.kind === 'disclosure_recipient' &&
    action !== 'disclose'
  ) {
    return invalidContract('action');
  }
  if (
    principal.kind === 'user' &&
    principal.authority.kind === 'authenticated_provider_event' &&
    action !== 'execute'
  ) {
    return invalidContract('action');
  }
  return action;
}

function readIdentityLink(input: unknown): PlatformIdentityLinkV1 {
  const record = object(input, 'identity');
  switch (record.kind) {
    case 'verified_provider_subject':
      exactKeys(record, ['kind', 'userId', 'issuer', 'subject', 'verificationReceiptId']);
      return Object.freeze({
        kind: record.kind,
        userId: textValue(record.userId, 'userId'),
        issuer: textValue(record.issuer, 'issuer'),
        subject: textValue(record.subject, 'subject'),
        verificationReceiptId: textValue(record.verificationReceiptId, 'verificationReceiptId'),
      });
    case 'authenticated_account_link':
      exactKeys(record, ['kind', 'userId', 'accountLinkReceiptId']);
      return Object.freeze({
        kind: record.kind,
        userId: textValue(record.userId, 'userId'),
        accountLinkReceiptId: textValue(record.accountLinkReceiptId, 'accountLinkReceiptId'),
      });
    default:
      return invalidContract('identity.kind');
  }
}

export function readServiceAdmissionActionV1(input: unknown): ServiceAdmissionActionV1 {
  switch (input) {
    case 'execute':
    case 'disclose':
    case 'restore':
    case 'replay':
      return input;
    default:
      return invalidContract('action');
  }
}
