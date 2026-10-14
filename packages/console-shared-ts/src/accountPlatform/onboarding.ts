import {
  contractResult,
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

/** Authenticates account setup before a native tenant or service instance exists. */
export class ServiceOnboardingAssertionV1 {
  readonly version = 1;
  readonly purpose = 'satyr_onboarding';

  private constructor(
    readonly issuer: string,
    readonly audience: string,
    readonly nativePrincipalId: string,
    readonly nativeSessionId: string,
    readonly subject: string,
    readonly requestDigest: string,
    readonly expiresAt: string,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(
    input: unknown,
  ): PlatformResult<ServiceOnboardingAssertionV1, PlatformContractError> {
    return contractResult(ServiceOnboardingAssertionV1.read, input);
  }

  private static read(input: unknown): ServiceOnboardingAssertionV1 {
    const record = object(input, 'onboarding assertion');
    exactKeys(record, [
      'version',
      'purpose',
      'issuer',
      'audience',
      'nativePrincipalId',
      'nativeSessionId',
      'subject',
      'requestDigest',
      'expiresAt',
    ]);
    versionOne(record.version);
    if (record.purpose !== 'satyr_onboarding') return invalidContract('purpose');
    return new ServiceOnboardingAssertionV1(
      textValue(record.issuer, 'issuer'),
      textValue(record.audience, 'audience'),
      textValue(record.nativePrincipalId, 'nativePrincipalId'),
      textValue(record.nativeSessionId, 'nativeSessionId'),
      textValue(record.subject, 'subject'),
      digestValue(record.requestDigest, 'requestDigest'),
      utcTimestamp(record.expiresAt, 'expiresAt'),
    );
  }
}
