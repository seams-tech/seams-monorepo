import {
  DelegatedPlatformAssertionV1,
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
  readonly bearerToken: string;
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
  readonly tokenDigest: Uint8Array;
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

  static async authenticate(
    request: Request,
    configurations: readonly VerifiedProducerConfiguration[],
  ): Promise<
    PlatformResult<AuthenticatedAccountServiceProducerV1, { readonly code: 'scope_forbidden' }>
  > {
    const header = request.headers.get('Authorization');
    const match = header?.match(/^Bearer ([^\s]+)$/);
    if (!match) return forbidden();
    const digest = await tokenDigest(match[1]);
    let selected: VerifiedProducerConfiguration | null = null;
    for (const configuration of configurations) {
      if (equalDigest(digest, configuration.tokenDigest)) selected = configuration;
    }
    if (!selected) return forbidden();
    return { kind: 'accepted', value: new AuthenticatedAccountServiceProducerV1(selected) };
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
    const value = request.headers.get('X-Account-User-Assertion');
    if (!value) return forbidden();
    try {
      const parts = value.split('.');
      if (parts.length !== 3) return forbidden();
      const header = object(
        JSON.parse(new TextDecoder().decode(decodeSegment(parts[0]))),
        'assertion header',
      );
      exactKeys(header, ['alg', 'typ', 'kid']);
      if (header.alg !== 'EdDSA' || header.typ !== 'JWT' || header.kid !== this.configuration.keyId)
        return forbidden();
      const signedBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const verified = await crypto.subtle.verify(
        { name: 'Ed25519' },
        this.configuration.assertionKey,
        copyBuffer(decodeSegment(parts[2])),
        signedBytes,
      );
      if (!verified) return forbidden();
      const parsed = DelegatedPlatformAssertionV1.parse(
        JSON.parse(new TextDecoder().decode(decodeSegment(parts[1]))),
      );
      if (parsed.kind === 'rejected') return forbidden();
      const assertion = parsed.value;
      const expiresAt = Date.parse(assertion.expiresAt);
      if (
        assertion.issuer !== this.configuration.issuer ||
        assertion.audience !== this.configuration.audience ||
        expiresAt <= at.getTime() ||
        expiresAt > at.getTime() + 60_000
      )
        return forbidden();
      return { kind: 'accepted', value: assertion };
    } catch {
      return forbidden();
    }
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

async function tokenDigest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function equalDigest(left: Uint8Array, right: Uint8Array): boolean {
  let difference = 0;
  for (let index = 0; index < 32; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
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
    tokenDigest: await tokenDigest(textValue(configuration.bearerToken, 'bearerToken')),
    issuer: textValue(configuration.userAssertion.issuer, 'assertion issuer'),
    audience: textValue(configuration.userAssertion.audience, 'assertion audience'),
    keyId: textValue(configuration.userAssertion.keyId, 'assertion key ID'),
    assertionKey: await crypto.subtle.importKey('jwk', publicJwk, { name: 'Ed25519' }, false, [
      'verify',
    ]),
    googleClientId: textValue(configuration.googleClientId, 'Google client ID'),
  };
}

export class AccountServiceIngressAuthenticatorV1 {
  private constructor(private readonly producers: readonly VerifiedProducerConfiguration[]) {}

  static async create(
    configurations: readonly AccountServiceProducerConfigurationV1[],
  ): Promise<AccountServiceIngressAuthenticatorV1> {
    const producers: VerifiedProducerConfiguration[] = [];
    const deploymentKeys = new Set<string>();
    const tokenDigests: Uint8Array[] = [];
    for (const configuration of configurations) {
      const producer = await prepareProducer(configuration);
      const deploymentKey = JSON.stringify([
        producer.authority.serviceId,
        producer.authority.deploymentId,
      ]);
      if (deploymentKeys.has(deploymentKey))
        throw new Error('Duplicate account service deployment');
      for (const digest of tokenDigests)
        if (equalDigest(digest, producer.tokenDigest))
          throw new Error('Account service deployments require distinct producer tokens');
      deploymentKeys.add(deploymentKey);
      tokenDigests.push(producer.tokenDigest);
      producers.push(producer);
    }
    return new AccountServiceIngressAuthenticatorV1(producers);
  }

  async authenticate(
    request: Request,
  ): Promise<
    PlatformResult<AuthenticatedAccountServiceProducerV1, { readonly code: 'scope_forbidden' }>
  > {
    return AuthenticatedAccountServiceProducerV1.authenticate(request, this.producers);
  }
}
