import {
  DelegatedPlatformAssertionV1,
  ServiceOnboardingAssertionV1,
  type PlatformResult,
} from '@seams-internal/console-shared/accountPlatform';
import {
  exactKeys,
  object,
  textValue,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import { base64UrlDecode } from '../boundary/encoding';
import type { ServiceProducerAuthorityV1 } from './types';

export interface AccountServiceProducerConfigurationV1 {
  readonly authority: ServiceProducerAuthorityV1;
  readonly userAssertion: {
    readonly issuer: string;
    readonly audience: string;
    readonly keyId: string;
    readonly publicJwk: JsonWebKey;
  };
  readonly googleClientId: string;
}

interface VerifiedProducerConfiguration {
  readonly authority: ServiceProducerAuthorityV1;
  readonly issuer: string;
  readonly audience: string;
  readonly keyId: string;
  readonly assertionKey: CryptoKey;
  readonly googleClientId: string;
}

export class AuthenticatedAccountServiceProducerV1 {
  private constructor(private readonly configuration: VerifiedProducerConfiguration) {}

  get authority(): ServiceProducerAuthorityV1 {
    return this.configuration.authority;
  }

  get googleClientId(): string {
    return this.configuration.googleClientId;
  }

  /** Only construct at a private service-binding entrypoint with deployment-owned configuration. */
  static async fromServiceBinding(
    configuration: AccountServiceProducerConfigurationV1,
  ): Promise<AuthenticatedAccountServiceProducerV1> {
    return new AuthenticatedAccountServiceProducerV1(await prepareProducer(configuration));
  }

  async verifyUserAssertion(
    request: Request,
    at: Date,
  ): Promise<PlatformResult<VerifiedAccountUserAssertionV1, { readonly code: 'scope_forbidden' }>> {
    return VerifiedAccountUserAssertionV1.verify(this, request, at);
  }

  async verifyCandidateAssertion(
    request: Request,
    at: Date,
  ): Promise<PlatformResult<DelegatedPlatformAssertionV1, { readonly code: 'scope_forbidden' }>> {
    try {
      const parsed = DelegatedPlatformAssertionV1.parse(await this.readSignedAssertion(request));
      if (parsed.kind === 'rejected' || !this.isCurrentAssertion(parsed.value, at))
        return forbidden();
      return parsed;
    } catch {
      return forbidden();
    }
  }

  async verifyOnboardingAssertion(
    request: Request,
    at: Date,
  ): Promise<PlatformResult<ServiceOnboardingAssertionV1, { readonly code: 'scope_forbidden' }>> {
    if (this.authority.serviceId !== 'satyr') return forbidden();
    try {
      const parsed = ServiceOnboardingAssertionV1.parse(await this.readSignedAssertion(request));
      if (parsed.kind === 'rejected' || !this.isCurrentAssertion(parsed.value, at))
        return forbidden();
      return parsed;
    } catch {
      return forbidden();
    }
  }

  private isCurrentAssertion(
    assertion: { readonly issuer: string; readonly audience: string; readonly expiresAt: string },
    at: Date,
  ): boolean {
    const expiresAt = Date.parse(assertion.expiresAt);
    return (
      assertion.issuer === this.configuration.issuer &&
      assertion.audience === this.configuration.audience &&
      expiresAt > at.getTime() &&
      expiresAt <= at.getTime() + 60_000
    );
  }

  private async readSignedAssertion(request: Request): Promise<unknown> {
    const value = request.headers.get('X-Account-User-Assertion');
    if (!value) throw new Error('Missing user assertion');
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error('Invalid user assertion');
    const header = object(
      JSON.parse(new TextDecoder().decode(decodeSegment(parts[0]))),
      'assertion header',
    );
    exactKeys(header, ['alg', 'typ', 'kid']);
    if (header.alg !== 'EdDSA' || header.typ !== 'JWT' || header.kid !== this.configuration.keyId)
      throw new Error('Invalid assertion header');
    const signedBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const verified = await crypto.subtle.verify(
      { name: 'Ed25519' },
      this.configuration.assertionKey,
      copyBuffer(decodeSegment(parts[2])),
      signedBytes,
    );
    if (!verified) throw new Error('Invalid assertion signature');
    return JSON.parse(new TextDecoder().decode(decodeSegment(parts[1])));
  }
}

export class VerifiedAccountUserAssertionV1 {
  private constructor(private readonly assertion: DelegatedPlatformAssertionV1) {
    Object.freeze(this);
  }

  get version(): 1 {
    return this.assertion.version;
  }
  get issuer(): string {
    return this.assertion.issuer;
  }
  get audience(): string {
    return this.assertion.audience;
  }
  get principal(): DelegatedPlatformAssertionV1['principal'] {
    return this.assertion.principal;
  }
  get nativePrincipalId(): string {
    return this.assertion.nativePrincipalId;
  }
  get scope(): DelegatedPlatformAssertionV1['scope'] {
    return this.assertion.scope;
  }
  get instanceId(): string {
    return this.assertion.instanceId;
  }
  get action(): DelegatedPlatformAssertionV1['action'] {
    return this.assertion.action;
  }
  get expiresAt(): string {
    return this.assertion.expiresAt;
  }
  get authorityRevision(): number {
    return this.assertion.authorityRevision;
  }

  toJSON(): Record<string, unknown> {
    return this.assertion.toJSON();
  }

  static async verify(
    producer: AuthenticatedAccountServiceProducerV1,
    request: Request,
    at: Date,
  ): Promise<PlatformResult<VerifiedAccountUserAssertionV1, { readonly code: 'scope_forbidden' }>> {
    const candidate = await producer.verifyCandidateAssertion(request, at);
    if (candidate.kind === 'rejected') return candidate;
    return { kind: 'accepted', value: new VerifiedAccountUserAssertionV1(candidate.value) };
  }
}

function forbidden(): {
  readonly kind: 'rejected';
  readonly error: { readonly code: 'scope_forbidden' };
} {
  return { kind: 'rejected', error: { code: 'scope_forbidden' } };
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function decodeSegment(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid assertion encoding');
  return base64UrlDecode(value);
}

async function prepareProducer(
  configuration: AccountServiceProducerConfigurationV1,
): Promise<VerifiedProducerConfiguration> {
  const publicJwk = configuration.userAssertion.publicJwk;
  if (
    publicJwk.kty !== 'OKP' ||
    publicJwk.crv !== 'Ed25519' ||
    typeof publicJwk.x !== 'string' ||
    publicJwk.d !== undefined
  )
    throw new Error('Account assertions require an Ed25519 public JWK');
  return {
    authority: {
      serviceId: configuration.authority.serviceId,
      deploymentId: textValue(configuration.authority.deploymentId, 'deploymentId'),
    },
    issuer: textValue(configuration.userAssertion.issuer, 'assertion issuer'),
    audience: textValue(configuration.userAssertion.audience, 'assertion audience'),
    keyId: textValue(configuration.userAssertion.keyId, 'assertion key ID'),
    assertionKey: await crypto.subtle.importKey('jwk', publicJwk, { name: 'Ed25519' }, false, [
      'verify',
    ]),
    googleClientId: textValue(configuration.googleClientId, 'Google client ID'),
  };
}
