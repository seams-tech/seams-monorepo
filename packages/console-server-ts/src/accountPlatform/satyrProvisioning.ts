import {
  ServiceProvisionOwnerAssertionV1,
  ServiceTenantBindingV1,
  nativeTenantScopeKey,
  parseServiceProvisionReceiptV1,
  type AcceptedServiceReceiptV1,
  type PlatformResult,
  type PlatformScopeV1,
  type ServiceBindingRequestV1,
} from '@seams-internal/console-shared/accountPlatform';
import {
  exactKeys,
  assertNever,
  object,
  textValue,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import { base64UrlEncode } from '../boundary/encoding';
import { billingCanonicalDigest } from '../billing/pricing';
import type { AccountServiceProvisioningAdapterV1 } from './provisioning';
import type {
  AccountProvisionedServiceOwnerV1,
  AccountProvisionOwnerGrantV1,
  D1AccountServiceAccess,
} from './serviceAccess';
import {
  platformScopesEqual,
  type ServiceProducerAuthorityV1,
  type ServiceProvisionDeliveryV1,
} from './types';

export interface SatyrProvisioningConfigurationV1 {
  readonly deploymentId: string;
  readonly origin: string;
  readonly placementCellId: string;
  readonly environment: 'development' | 'production';
  readonly bearerToken: string;
  readonly ownerAssertion: {
    readonly issuer: string;
    readonly audience: string;
    readonly keyId: string;
    readonly privateJwk: JsonWebKey;
  };
}

export interface SatyrProvisioningAdapterOptionsV1 {
  readonly configuration: SatyrProvisioningConfigurationV1;
  readonly access: D1AccountServiceAccess;
  readonly transport: typeof fetch;
  readonly now?: () => Date;
}

type ProvisionResult = PlatformResult<
  AcceptedServiceReceiptV1,
  { readonly code: 'unavailable' | 'provisioning_failed' }
>;

interface AppliedSatyrProvision {
  readonly receipt: AcceptedServiceReceiptV1;
  readonly owner: AccountProvisionedServiceOwnerV1;
}

export interface SatyrSignedProvisionDeliveryV1 {
  readonly version: 1;
  readonly delivery: ServiceProvisionDeliveryV1;
  readonly owner: {
    readonly platformUserId: string;
    readonly issuer: 'https://accounts.google.com';
    readonly subject: string;
    readonly email: string;
    readonly emailVerified: true;
    readonly displayName: string | null;
    readonly verificationReceiptId: string;
    readonly platformMembershipId: string;
    readonly accountAcceptanceReceiptId: string;
    readonly serviceGrant: AccountProvisionOwnerGrantV1['serviceGrant'];
  };
  readonly ownerAssertion: string;
}

function now(): Date {
  return new Date();
}

function rejected(code: 'unavailable' | 'provisioning_failed'): ProvisionResult {
  return { kind: 'rejected', error: { code } };
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function readAppliedResponse(input: unknown): AppliedSatyrProvision {
  const result = object(input, 'provision response');
  exactKeys(result, ['kind', 'value']);
  if (result.kind !== 'accepted') throw new Error('Satyr did not accept provisioning');
  const value = object(result.value, 'applied provision');
  exactKeys(value, ['kind', 'receipt', 'owner']);
  if (value.kind !== 'applied') throw new Error('Satyr provision is not applied');
  const receipt = parseServiceProvisionReceiptV1(value.receipt);
  if (receipt.kind === 'rejected') throw new Error('Satyr returned an invalid provision receipt');
  const owner = object(value.owner, 'provision owner');
  exactKeys(owner, [
    'nativePrincipalId',
    'platformUserId',
    'issuer',
    'subject',
    'verificationReceiptId',
  ]);
  if (owner.issuer !== 'https://accounts.google.com')
    throw new Error('Satyr returned an invalid owner issuer');
  return {
    receipt: receipt.value,
    owner: {
      nativePrincipalId: textValue(owner.nativePrincipalId, 'nativePrincipalId'),
      platformUserId: textValue(owner.platformUserId, 'platformUserId'),
      issuer: owner.issuer,
      subject: textValue(owner.subject, 'subject'),
      verificationReceiptId: textValue(owner.verificationReceiptId, 'verificationReceiptId'),
    },
  };
}

function receiptMatchesDelivery(
  receipt: AcceptedServiceReceiptV1,
  delivery: ServiceProvisionDeliveryV1,
): boolean {
  const command = delivery.command;
  const result = provisionResultState(command.command);
  const target = command.binding;
  if (target instanceof ServiceTenantBindingV1) {
    if (
      nativeTenantScopeKey(target.nativeScope) !== nativeTenantScopeKey(receipt.binding.nativeScope)
    )
      return false;
  } else if (target.kind === 'attach_existing_scope') {
    if (
      nativeTenantScopeKey(target.nativeScope) !== nativeTenantScopeKey(receipt.binding.nativeScope)
    )
      return false;
  }
  return (
    receipt.operationId === command.operationId &&
    receipt.instanceId === command.instanceId &&
    receipt.desiredRevision === command.desiredRevision &&
    receipt.result === result &&
    platformScopesEqual(receipt.binding.scope, delivery.scope) &&
    receipt.binding.nativeScope.serviceId === 'satyr' &&
    receipt.binding.nativeScope.deploymentId === delivery.authority.deploymentId
  );
}

function provisionResultState(
  command: ServiceProvisionDeliveryV1['command']['command'],
): AcceptedServiceReceiptV1['result'] {
  switch (command) {
    case 'enable':
      return 'active';
    case 'disable':
      return 'disabled';
    case 'archive':
      return 'archived';
    default:
      return assertNever(command);
  }
}

export function createSatyrProvisioningBinding(
  scope: PlatformScopeV1,
  configuration: Pick<
    SatyrProvisioningConfigurationV1,
    'deploymentId' | 'placementCellId' | 'environment'
  >,
): ServiceBindingRequestV1 {
  return {
    kind: 'create_native_scope',
    serviceId: 'satyr',
    parent: scope,
    configuration: {
      deploymentId: configuration.deploymentId,
      placementCellId: configuration.placementCellId,
      environment: configuration.environment,
    },
  };
}

/** Retries sign fresh owner proof around the original durable command. */
export class SatyrServiceProvisioningAdapterV1 implements AccountServiceProvisioningAdapterV1 {
  readonly authority: ServiceProducerAuthorityV1;
  private readonly clock: () => Date;

  get consoleHref(): string {
    return `${this.origin}/portal`;
  }

  private constructor(
    private readonly options: SatyrProvisioningAdapterOptionsV1,
    private readonly origin: string,
    private readonly signingKey: CryptoKey,
  ) {
    this.authority = { serviceId: 'satyr', deploymentId: options.configuration.deploymentId };
    this.clock = options.now ?? now;
  }

  static async create(
    options: SatyrProvisioningAdapterOptionsV1,
  ): Promise<SatyrServiceProvisioningAdapterV1> {
    const configuration = options.configuration;
    const url = new URL(configuration.origin);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if (
      (!local && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error('Satyr provisioning requires an origin URL');
    }
    textValue(configuration.deploymentId, 'deploymentId');
    textValue(configuration.placementCellId, 'placementCellId');
    textValue(configuration.bearerToken, 'bearerToken');
    const assertion = configuration.ownerAssertion;
    textValue(assertion.issuer, 'owner assertion issuer');
    textValue(assertion.audience, 'owner assertion audience');
    textValue(assertion.keyId, 'owner assertion key ID');
    const jwk = assertion.privateJwk;
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.d || !jwk.x) {
      throw new Error('Satyr provisioning requires an Ed25519 private JWK');
    }
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
    return new SatyrServiceProvisioningAdapterV1(options, url.origin, key);
  }

  createBinding(scope: PlatformScopeV1): ServiceBindingRequestV1 {
    return createSatyrProvisioningBinding(scope, this.options.configuration);
  }

  async prepareDelivery(
    delivery: ServiceProvisionDeliveryV1,
  ): Promise<
    PlatformResult<
      SatyrSignedProvisionDeliveryV1,
      { readonly code: 'unavailable' | 'provisioning_failed' }
    >
  > {
    if (
      delivery.authority.serviceId !== 'satyr' ||
      delivery.authority.deploymentId !== this.authority.deploymentId
    ) {
      return { kind: 'rejected', error: { code: 'provisioning_failed' } };
    }
    try {
      const verified = await this.options.access.getVerifiedProvisionOwner(
        delivery.requestedByUserId,
      );
      if (!verified) return { kind: 'rejected', error: { code: 'provisioning_failed' } };
      const grant = await this.options.access.getProvisionOwnerGrant(delivery);
      if (!grant) return { kind: 'rejected', error: { code: 'provisioning_failed' } };
      const owner: SatyrSignedProvisionDeliveryV1['owner'] = {
        platformUserId: verified.userId,
        issuer: verified.issuer,
        subject: verified.subject,
        email: verified.email,
        emailVerified: true,
        displayName: verified.displayName,
        verificationReceiptId: verified.verificationReceiptId,
        platformMembershipId: grant.platformMembershipId,
        accountAcceptanceReceiptId: grant.accountAcceptanceReceiptId,
        serviceGrant: grant.serviceGrant,
      };
      const body = { version: 1, delivery, owner };
      const configuration = this.options.configuration.ownerAssertion;
      const assertion = ServiceProvisionOwnerAssertionV1.parse({
        version: 1,
        purpose: 'satyr_provision_owner',
        issuer: configuration.issuer,
        audience: configuration.audience,
        operationId: delivery.command.operationId,
        instanceId: delivery.command.instanceId,
        requestedByUserId: delivery.requestedByUserId,
        providerIssuer: verified.issuer,
        providerSubject: verified.subject,
        bodyDigest: await billingCanonicalDigest(body),
        expiresAt: new Date(this.clock().getTime() + 30_000).toISOString(),
      });
      if (assertion.kind === 'rejected') throw new Error('Invalid provision owner assertion');
      const message = `${encodeJson({ alg: 'EdDSA', typ: 'JWT', kid: configuration.keyId })}.${encodeJson(assertion.value)}`;
      const signature = await crypto.subtle.sign(
        { name: 'Ed25519' },
        this.signingKey,
        new TextEncoder().encode(message),
      );
      const ownerAssertion = `${message}.${base64UrlEncode(new Uint8Array(signature))}`;
      return { kind: 'accepted', value: { version: 1, delivery, owner, ownerAssertion } };
    } catch {
      return { kind: 'rejected', error: { code: 'unavailable' } };
    }
  }

  async provision(delivery: ServiceProvisionDeliveryV1): Promise<ProvisionResult> {
    try {
      const prepared = await this.prepareDelivery(delivery);
      if (prepared.kind === 'rejected') return prepared;
      const response = await this.options.transport(
        new Request(new URL('/account-platform/v1/provision', this.origin), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.configuration.bearerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(prepared.value),
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        }),
      );
      if (!response.ok)
        return rejected(response.status >= 500 ? 'unavailable' : 'provisioning_failed');
      const applied = readAppliedResponse(await response.json());
      if (!receiptMatchesDelivery(applied.receipt, delivery))
        return rejected('provisioning_failed');
      const recorded = await this.options.access.recordProvisionedOwner(
        this.authority,
        delivery,
        applied.owner,
      );
      if (recorded.kind === 'rejected') return rejected('provisioning_failed');
      return { kind: 'accepted', value: applied.receipt };
    } catch {
      return rejected('unavailable');
    }
  }
}
