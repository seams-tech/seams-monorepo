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
