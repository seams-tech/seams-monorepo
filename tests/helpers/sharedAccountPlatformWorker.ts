import {
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  PlatformUsageEventV1,
  parseServiceProvisionReceiptV1,
  type PlatformResult,
  type PlatformScopeV1,
} from '../../packages/console-shared-ts/src/accountPlatform';
import {
  exactKeys,
  object,
  textValue,
  versionOne,
} from '../../packages/console-shared-ts/src/accountPlatform/boundary';
import {
  AuthenticatedAccountServiceProducerV1,
  createAccountPlatformServiceIngress,
  SatyrServiceProvisioningAdapterV1,
  type SatyrSignedProvisionDeliveryV1,
  type AccountPlatformServiceIngressHandler,
} from '../../packages/console-server-ts/src/accountPlatform';
import type {
  ServiceProducerAuthorityV1,
  ServiceProvisionDeliveryV1,
} from '../../packages/console-server-ts/src/accountPlatform/types';
import {
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
} from '../../packages/console-server-ts/src/boundary/d1';
import { base64UrlEncode } from '../../packages/console-server-ts/src/boundary/encoding';
import {
  createConsoleProviderIdentity,
  type ConsoleProviderIdentity,
  type ConsoleGoogleLoginResult,
} from '../../packages/console-server-ts/src/boundary/providerIdentity';
import { billingCanonicalDigest } from '../../packages/console-server-ts/src/billing/pricing';
import { buildConsoleBillingInvoicePdf } from '../../packages/console-server-ts/src/billing/pdf';
import { listD1BillingUsageCharges } from '../../packages/console-server-ts/src/billing/attribution';
import {
  createCloudflareD1AccountServiceBundle,
  type CloudflareD1AccountServiceBundle,
} from '../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import type { OrganizationAccessContext } from '../../packages/console-server-ts/src/teamRbac';
import { SatyrAccountOnboarding } from '../../packages/console-server-ts/src/accountPlatform/onboarding';
import { SatyrInstanceRelease } from '../../packages/console-server-ts/src/accountPlatform/satyrRelease';

const namespace = 'shared-account-satyr-e2e';
const prefix = '/__fixture/account-platform/v1/';
const primaryOrgId = 'org_shared_account_primary';
const foreignOrgId = 'org_shared_account_foreign';
const satyr: ServiceProducerAuthorityV1 = {
  serviceId: 'satyr',
  deploymentId: 'shared-account-satyr-e2e',
};
const wallet: ServiceProducerAuthorityV1 = {
  serviceId: 'wallet',
  deploymentId: 'shared-account-wallet-e2e',
};

declare const ACCOUNT_CORE_MIGRATIONS: readonly {
  readonly name: string;
  readonly statements: readonly string[];
}[];

interface FixtureBindings {
  readonly ACCOUNT_DB: D1DatabaseLike;
  readonly FIXTURE_ASSERTION_PUBLIC_JWK: string;
  readonly FIXTURE_PROVISION_PRIVATE_JWK: string;
  readonly FIXTURE_GOOGLE_PRIVATE_JWK: string;
  readonly FIXTURE_GOOGLE_PUBLIC_JWK: string;
  readonly FIXTURE_GOOGLE_CLIENT_ID: string;
}

interface NativeMember {
  readonly nativeUserId: string;
  readonly nativePersonId: string;
  readonly nativeSessionId: string;
  readonly google: { readonly issuer: 'https://accounts.google.com'; readonly subject: string };
}

interface NativeOrganisation {
  readonly nativeOrganisationId: string;
  readonly owner: NativeMember;
}

interface FixtureSetup {
  readonly primary: NativeOrganisation;
  readonly foreign: NativeOrganisation;
  readonly finance: NativeMember;
  readonly operator: NativeMember;
  readonly privateMember: NativeMember;
  /** More members with the access of `privateMember`, for journeys that need more people. */
  readonly extra: readonly NativeMember[];
}

interface VerifiedMember {
  readonly native: NativeMember;
  readonly verified: Extract<ConsoleGoogleLoginResult, { readonly ok: true }>;
  readonly token: string;
  readonly verificationReceiptId: string;
}

type FixtureFault =
  | 'eligibility_outage'
  | 'primary_eligibility_outage'
  | 'primary_malformed_eligibility_reply'
  | 'primary_foreign_scope_reply'
  | 'lose_onboarding_reply'
  | 'onboarding_outage'
  | 'fee_policy_outage'
  | 'usage_outage'
  | 'lose_usage_reply'
  | 'lose_reserve_reply';

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

function readNativeMember(input: unknown): NativeMember {
  const record = object(input, 'member');
  exactKeys(record, ['nativeUserId', 'nativePersonId', 'nativeSessionId', 'google']);
  const google = object(record.google, 'google');
  exactKeys(google, ['issuer', 'subject']);
  if (google.issuer !== 'https://accounts.google.com') throw new Error('Invalid provider issuer');
  return {
    nativeUserId: textValue(record.nativeUserId, 'nativeUserId'),
    nativePersonId: textValue(record.nativePersonId, 'nativePersonId'),
    nativeSessionId: textValue(record.nativeSessionId, 'nativeSessionId'),
    google: { issuer: google.issuer, subject: textValue(google.subject, 'subject') },
  };
}

function readNativeOrganisation(input: unknown): NativeOrganisation {
  const record = object(input, 'organisation');
  exactKeys(record, ['nativeOrganisationId', 'owner']);
  return {
    nativeOrganisationId: textValue(record.nativeOrganisationId, 'nativeOrganisationId'),
    owner: readNativeMember(record.owner),
  };
}

function readSetup(input: unknown): FixtureSetup {
  const record = object(input, 'setup');
  exactKeys(record, ['version', 'organisations', 'members']);
  versionOne(record.version);
  const organisations = object(record.organisations, 'organisations');
  exactKeys(organisations, ['primary', 'foreign']);
  const members = object(record.members, 'members');
  const hasExtra = Object.hasOwn(members, 'extra');
  exactKeys(
    members,
    hasExtra
      ? ['finance', 'operator', 'privateMember', 'extra']
      : ['finance', 'operator', 'privateMember'],
  );
  if (hasExtra && (!Array.isArray(members.extra) || members.extra.length === 0))
    throw new Error('Invalid extra members');
  return {
    primary: readNativeOrganisation(organisations.primary),
    foreign: readNativeOrganisation(organisations.foreign),
    finance: readNativeMember(members.finance),
    operator: readNativeMember(members.operator),
    privateMember: readNativeMember(members.privateMember),
    extra: hasExtra ? (members.extra as readonly unknown[]).map(readNativeMember) : [],
  };
}

function publicEd25519(value: string): JsonWebKey {
  const record = object(JSON.parse(value), 'public JWK');
  if (record.kty !== 'OKP' || record.crv !== 'Ed25519' || record.d !== undefined) {
    throw new Error('Invalid public assertion key');
  }
  return { kty: 'OKP', crv: 'Ed25519', x: textValue(record.x, 'x') };
}

function privateEd25519(value: string): JsonWebKey {
  const record = object(JSON.parse(value), 'private JWK');
  if (record.kty !== 'OKP' || record.crv !== 'Ed25519')
    throw new Error('Invalid provision signing key');
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: textValue(record.x, 'x'),
    d: textValue(record.d, 'd'),
  };
}

function rsaPublic(value: string): JsonWebKey {
  const record = object(JSON.parse(value), 'Google public JWK');
  if (record.kty !== 'RSA' || record.d !== undefined) throw new Error('Invalid Google public key');
  return {
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    n: textValue(record.n, 'n'),
    e: textValue(record.e, 'e'),
  };
}

function rsaPrivate(value: string): JsonWebKey {
  const record = object(JSON.parse(value), 'Google private JWK');
  if (record.kty !== 'RSA') throw new Error('Invalid Google signing key');
  return {
    kty: 'RSA',
    alg: 'RS256',
    n: textValue(record.n, 'n'),
    e: textValue(record.e, 'e'),
    d: textValue(record.d, 'd'),
    p: textValue(record.p, 'p'),
    q: textValue(record.q, 'q'),
    dp: textValue(record.dp, 'dp'),
    dq: textValue(record.dq, 'dq'),
    qi: textValue(record.qi, 'qi'),
  };
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

async function signedJwt(
  key: CryptoKey,
  algorithm: 'EdDSA' | 'RS256',
  keyId: string,
  claims: unknown,
): Promise<string> {
  const message = `${encodeJson({ alg: algorithm, typ: 'JWT', kid: keyId })}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign(
    algorithm === 'EdDSA' ? { name: 'Ed25519' } : { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(message),
  );
  return `${message}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function outage(): Response {
  return json({ kind: 'rejected', error: { code: 'authority_unavailable', retryable: true } }, 503);
}

async function compose(
  database: D1DatabaseLike,
  isolated: boolean,
): Promise<CloudflareD1AccountServiceBundle> {
  return createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    externalDeletionGuard: null,
    ensureSchema: true,
    satyrTestPricing: isolated
      ? { kind: 'isolated_e2e', organizationIds: [primaryOrgId] }
      : { kind: 'disabled' },
  });
}

class AccountWorkerFixture {
  private readonly faults = new Set<FixtureFault>();

  private constructor(
    private readonly bindings: FixtureBindings,
    private core: CloudflareD1AccountServiceBundle,
    private ingress: AccountPlatformServiceIngressHandler,
    private readonly producer: AuthenticatedAccountServiceProducerV1,
    private readonly google: ConsoleProviderIdentity,
    private readonly googleSigningKey: CryptoKey,
    private readonly googlePublicKey: JsonWebKey,
    private readonly provisioning: SatyrServiceProvisioningAdapterV1,
  ) {}

  static async create(bindings: FixtureBindings): Promise<AccountWorkerFixture> {
    await migrate(bindings.ACCOUNT_DB);
    let core = await compose(bindings.ACCOUNT_DB, false);
    const existing = await queryD1One(
      bindings.ACCOUNT_DB,
      'SELECT id FROM organizations WHERE namespace = ? AND id = ?',
      [namespace, primaryOrgId],
    );
    if (existing) core = await compose(bindings.ACCOUNT_DB, true);
    const producer = await AuthenticatedAccountServiceProducerV1.fromServiceBinding({
      authority: satyr,
      userAssertion: {
        issuer: 'https://satyr.shared-account.invalid',
        audience: 'https://account.shared-account.invalid',
        keyId: 'satyr-shared-account-e2e',
        publicJwk: publicEd25519(bindings.FIXTURE_ASSERTION_PUBLIC_JWK),
      },
      googleClientId: bindings.FIXTURE_GOOGLE_CLIENT_ID,
    });
    const publicKey = rsaPublic(bindings.FIXTURE_GOOGLE_PUBLIC_JWK);
    const fetchGoogle = googleJwks.bind(null, publicKey);
    const google = createConsoleProviderIdentity({
      googleOidcClientId: bindings.FIXTURE_GOOGLE_CLIENT_ID,
      fetchImpl: fetchGoogle,
    });
    const signingKey = await crypto.subtle.importKey(
      'jwk',
      rsaPrivate(bindings.FIXTURE_GOOGLE_PRIVATE_JWK),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const provisioning = await SatyrServiceProvisioningAdapterV1.create({
      configuration: {
        deploymentId: satyr.deploymentId,
        origin: 'https://satyr.shared-account.invalid',
        placementCellId: 'e2e',
        environment: 'development',
        bearerToken: 'shared-account-e2e-satyr-provision',
        ownerAssertion: {
          issuer: 'https://account.shared-account.invalid',
          audience: 'https://satyr.shared-account.invalid',
          keyId: 'account-shared-account-e2e',
          privateJwk: privateEd25519(bindings.FIXTURE_PROVISION_PRIVATE_JWK),
        },
      },
      access: core.serviceAccess,
      transport: unavailableProvisionTransport,
    });
    return new AccountWorkerFixture(
      bindings,
      core,
      ingressFor(core, producer, fetchGoogle),
      producer,
      google,
      signingKey,
      publicKey,
      provisioning,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith(prefix)) return this.serviceRequest(request, pathname);
    if (request.headers.get('Authorization') !== 'Bearer shared-account-e2e-admin')
      return json({ code: 'forbidden' }, 403);
    const body: unknown = request.method === 'POST' ? await request.json() : { version: 1 };
    switch (pathname.slice(prefix.length)) {
      case 'google-login': {
        const record = object(body, 'Google login');
        exactKeys(record, ['version', 'native', 'nonce']);
        versionOne(record.version);
        const native = readNativeMember(record.native);
        return json({
          token: await this.googleToken(native, textValue(record.nonce, 'nonce')),
          publicJwk: this.googlePublicKey,
        });
      }
      case 'setup':
        return json(await this.setup(readSetup(body)));
      case 'acknowledge':
        return json(await this.acknowledge(body));
      case 'onboarding-delivery': {
        const record = object(body, 'onboarding delivery');
        exactKeys(record, ['version', 'operationId']);
        versionOne(record.version);
        const delivery = await this.core.accountPlatform.pendingProvisionOperation(
          satyr,
          textValue(record.operationId, 'operationId'),
        );
        if (!delivery) return json({ code: 'operation_not_pending' }, 409);
        return json(await this.signedProvision(delivery));
      }
      case 'mutate':
        return json(await this.mutate(body));
      case 'fault':
        return json(this.fault(body));
      case 'snapshot':
        return json(await this.snapshot());
      case 'statement':
        return this.statement(body);
      default:
        return json({ code: 'not_found' }, 404);
    }
  }

  private async serviceRequest(request: Request, pathname: string): Promise<Response> {
    if (pathname === '/account-platform/v1/satyr/instance-release') {
      const lifetime = new OnboardingTestLifetime();
      const response = await new SatyrInstanceRelease(
        this.core,
        this.provisioning,
        lifetime.waitUntil.bind(lifetime),
      ).fetch(request);
      await lifetime.finish();
      return response;
    }
    if (pathname.startsWith('/account-platform/v1/onboarding/')) {
      if (this.faults.has('onboarding_outage')) return outage();
      const lifetime = new OnboardingTestLifetime();
      const response = await new SatyrAccountOnboarding(
        this.core,
        this.producer,
        this.provisioning,
        lifetime.waitUntil.bind(lifetime),
        googleJwks.bind(null, this.googlePublicKey),
      ).fetch(request);
      await lifetime.finish();
      if (response.ok && pathname.endsWith('/start') && this.faults.delete('lose_onboarding_reply'))
        return outage();
      return response;
    }
    if (isEligibilityRequest(pathname)) {
      if (this.faults.has('eligibility_outage')) return outage();
      if (this.faults.has('primary_eligibility_outage')) {
        const body = object(await request.clone().json(), 'eligibility');
        if (body.instanceId === 'satyr:project_shared_account_primary') return outage();
      }
    }
    if (pathname === '/account-platform/v1/fee-policy' && this.faults.has('fee_policy_outage'))
      return outage();
    if (pathname === '/account-platform/v1/usage' && this.faults.has('usage_outage'))
      return outage();
    let corruptedEligibilityInstanceId: string | null = null;
    if (
      isEligibilityRequest(pathname) &&
      (this.faults.has('primary_malformed_eligibility_reply') ||
        this.faults.has('primary_foreign_scope_reply'))
    ) {
      const body = object(await request.clone().json(), 'eligibility');
      corruptedEligibilityInstanceId = textValue(body.instanceId, 'instanceId');
    }
    const result = await this.ingress(request);
    if (!result) return json({ code: 'not_found' }, 404);
    if (
      result.ok &&
      isEligibilityRequest(pathname) &&
      (this.faults.has('primary_malformed_eligibility_reply') ||
        this.faults.has('primary_foreign_scope_reply'))
    ) {
      if (corruptedEligibilityInstanceId === 'satyr:project_shared_account_primary') {
        const envelope = object(await result.json(), 'eligibility response');
        const value = object(envelope.value, 'eligibility value');
        if (this.faults.has('primary_malformed_eligibility_reply'))
          return json({
            kind: 'accepted',
            value: { ...value, accessRevision: 'invalid-revision' },
          });
        const foreign = accepted(
          await this.core.accountPlatform.resolveServiceProducerInstance(
            satyr,
            'satyr:project_shared_account_foreign',
          ),
        );
        return json({ kind: 'accepted', value: { ...value, scope: foreign.scope } });
      }
    }

    if (
      result.ok &&
      pathname === '/account-platform/v1/usage' &&
      this.faults.delete('lose_usage_reply')
    )
      return outage();
    if (
      result.ok &&
      pathname === '/account-platform/v1/funds/reserve' &&
      this.faults.delete('lose_reserve_reply')
    )
      return outage();
    return result;
  }

  private googleToken(native: NativeMember, nonce: string | null): Promise<string> {
    return signedJwt(this.googleSigningKey, 'RS256', 'shared-account-google-e2e', {
      iss: native.google.issuer,
      sub: native.google.subject,
      aud: this.bindings.FIXTURE_GOOGLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 600,
      iat: Math.floor(Date.now() / 1000),
      email: `${native.google.subject}@example.test`,
      email_verified: true,
      name: native.google.subject,
      ...(nonce === null ? {} : { nonce }),
    });
  }

  private async verifyMember(native: NativeMember): Promise<VerifiedMember> {
    const token = await this.googleToken(native, null);
    const verified = await this.google.verifyGoogleLogin({ idToken: token });
    if (!verified.ok || !verified.email || verified.emailVerified !== true)
      throw new Error('Fixture Google proof failed');
    const verificationReceiptId = `google:${await billingCanonicalDigest(token)}`;
    await this.core.serviceAccess.recordVerifiedGoogleIdentity(verified, verificationReceiptId);
    const recorded = await this.core.serviceAccess.getVerifiedProvisionOwner(verified.userId);
    if (!recorded) throw new Error('Verified fixture owner was not recorded');
    return { native, verified, token, verificationReceiptId: recorded.verificationReceiptId };
  }

  private async createOrganisation(
    organisationId: string,
    owner: VerifiedMember,
  ): Promise<OrganizationAccessContext> {
    await this.core.account.createOrganization(
      {
        userId: owner.verified.userId,
        email: textValue(owner.verified.email, 'verified email'),
        name: owner.verified.name ?? null,
        provider: 'oidc',
        platformSupport: false,
        orgId: null,
        projectId: null,
      },
      { id: organisationId, name: organisationId },
    );
    return { orgId: organisationId, actorUserId: owner.verified.userId };
  }

  private async prepareInstance(
    context: OrganizationAccessContext,
    projectId: string,
    nativeOrganisationId: string,
    producer: ServiceProducerAuthorityV1,
  ): Promise<{ scope: PlatformScopeV1; instanceId: string }> {
    const scope = accepted(await this.core.accountPlatform.bindProjectBilling(context, projectId));
    const instanceId = `${producer.serviceId}:${projectId}`;
    const nativeScope =
      producer.serviceId === 'satyr'
        ? {
            serviceId: 'satyr',
            deploymentId: producer.deploymentId,
            nativeOrganizationId: nativeOrganisationId,
          }
        : {
            serviceId: 'wallet',
            deploymentId: producer.deploymentId,
            namespace,
            nativeOrganizationId: context.orgId,
            nativeProjectId: projectId,
          };
    const owner = await this.core.serviceAccess.getVerifiedProvisionOwner(context.actorUserId);
    if (!owner) throw new Error('Native attachment has no verified owner');
    const authorityEvidence =
      producer.serviceId === 'satyr'
        ? {
            sourceRecordId: `satyr-organisation:${nativeOrganisationId}`,
            sourceDigest: await billingCanonicalDigest({
              serviceId: 'satyr',
              deploymentId: producer.deploymentId,
              nativeOrganizationId: nativeOrganisationId,
              owner: { issuer: owner.issuer, subject: owner.subject },
            }),
          }
        : {
            sourceRecordId: nativeOrganisationId,
            sourceDigest: await billingCanonicalDigest({
              nativeOrganisationId,
              owner: context.actorUserId,
            }),
          };
    const command = accepted(
      ServiceProvisionCommandV1.parse({
        version: 1,
        operationId: `enable:${instanceId}`,
        instanceId,
        desiredRevision: 1,
        command: 'enable',
        binding: { kind: 'attach_existing_scope', nativeScope, authorityEvidence },
      }),
    );
    accepted(await this.core.accountPlatform.requestProvision(context, { scope, command }));
    if (producer.serviceId === 'wallet') {
      const binding = accepted(ServiceTenantBindingV1.parse({ instanceId, scope, nativeScope }));
      accepted(
        await this.core.accountPlatform.acknowledgeProvision(
          producer,
          accepted(
            parseServiceProvisionReceiptV1({
              version: 1,
              operationId: command.operationId,
              instanceId,
              desiredRevision: 1,
              result: 'active',
              binding,
            }),
          ),
        ),
      );
    }
    return { scope, instanceId };
  }

  private async addMember(
    context: OrganizationAccessContext,
    member: VerifiedMember,
    role: 'finance' | 'operator',
    projectId: string,
  ): Promise<string> {
    const issued = await this.core.organizationAccess.invite(
      context,
      role === 'finance'
        ? {
            email: textValue(member.verified.email, 'verified email'),
            role: 'ADMIN',
            adminPermissions: ['billing.view'],
          }
        : {
            email: textValue(member.verified.email, 'verified email'),
            role: 'MEMBER',
            projectAccess: [{ projectId, accessLevel: 'editor' }],
          },
    );
    const membership = await this.core.organizationAccess.acceptInvitation(
      {
        userId: member.verified.userId,
        verifiedEmail: textValue(member.verified.email, 'verified email'),
      },
      issued.invitation.id,
      { token: issued.token },
    );
    if (role === 'operator') {
      await this.bindings.ACCOUNT_DB.prepare(
        `INSERT INTO platform_instance_access
        (namespace, org_id, instance_id, membership_id, access, granted_by_user_id, updated_at_ms)
        VALUES (?, ?, ?, ?, 'allowed', ?, ?)`,
      )
        .bind(
          namespace,
          context.orgId,
          `satyr:${projectId}`,
          membership.id,
          context.actorUserId,
          Date.now(),
        )
        .run();
    }
    return membership.id;
  }

  private async signedProvision(
    delivery: ServiceProvisionDeliveryV1,
  ): Promise<SatyrSignedProvisionDeliveryV1> {
    return accepted(await this.provisioning.prepareDelivery(delivery));
  }

  private async setup(input: FixtureSetup): Promise<Record<string, unknown>> {
    // A test host keeps this runtime across tests. It empties the database before some tests
    // and keeps it before others, so each setup starts from an empty database itself.
    await empty(this.bindings.ACCOUNT_DB);
    await migrate(this.bindings.ACCOUNT_DB);
    this.faults.clear();
    const owner = await this.verifyMember(input.primary.owner);
    const foreignOwner = await this.verifyMember(input.foreign.owner);
    const finance = await this.verifyMember(input.finance);
    const operator = await this.verifyMember(input.operator);
    const privateMember = await this.verifyMember(input.privateMember);
    const extra: VerifiedMember[] = [];
    for (const member of input.extra) extra.push(await this.verifyMember(member));
    const primary = await this.createOrganisation(primaryOrgId, owner);
    const foreign = await this.createOrganisation(foreignOrgId, foreignOwner);
    this.core = await compose(this.bindings.ACCOUNT_DB, true);
    this.ingress = ingressFor(
      this.core,
      this.producer,
      googleJwks.bind(null, this.googlePublicKey),
    );
    const primaryProjectId = 'project_shared_account_primary';
    const walletProjectId = 'project_shared_account_wallet';
    const foreignProjectId = 'project_shared_account_foreign';
    await this.core.orgProjects.createProject(primary, {
      id: primaryProjectId,
      name: 'Primary platform project',
    });
    await this.core.orgProjects.createProject(primary, {
      id: walletProjectId,
      name: 'Wallet platform project',
    });
    await this.core.orgProjects.createProject(foreign, {
      id: foreignProjectId,
      name: 'Foreign platform project',
    });
    const primaryInstance = await this.prepareInstance(
      primary,
      primaryProjectId,
      input.primary.nativeOrganisationId,
      satyr,
    );
    const foreignInstance = await this.prepareInstance(
      foreign,
      foreignProjectId,
      input.foreign.nativeOrganisationId,
      satyr,
    );
    const walletInstance = await this.prepareInstance(
      primary,
      walletProjectId,
      input.primary.nativeOrganisationId,
      wallet,
    );
    const financeMembershipId = await this.addMember(primary, finance, 'finance', primaryProjectId);
    const operatorMembershipId = await this.addMember(
      primary,
      operator,
      'operator',
      primaryProjectId,
    );
    const privateMembershipId = await this.addMember(
      primary,
      privateMember,
      'operator',
      primaryProjectId,
    );
    const extraMembers: Record<string, string>[] = [];
    for (const member of extra)
      extraMembers.push({
        platformUserId: member.verified.userId,
        membershipId: await this.addMember(primary, member, 'operator', primaryProjectId),
      });
    await this.core.billing.grantManualSupportCredit(primary, {
      amountMinor: 2000,
      reasonCode: 'e2e_acceptance',
      note: 'Isolated composed Satyr and account acceptance',
      idempotencyKey: 'shared-account-e2e-funding',
    });
    const deliveries = await this.core.accountPlatform.pendingProvision(satyr, 100);
    const envelopes: Record<string, unknown> = {};
    for (const delivery of deliveries) {
      const key = delivery.scope.organizationId === primaryOrgId ? 'primary' : 'foreign';
      envelopes[key] = await this.signedProvision(delivery);
    }
    const tokens: Record<string, string> = {};
    for (const member of [owner, foreignOwner, finance, operator, privateMember, ...extra])
      tokens[member.native.nativeUserId] = member.token;
    return {
      version: 1,
      organisations: {
        primary: {
          scope: primaryInstance.scope,
          instanceId: primaryInstance.instanceId,
          walletInstanceId: walletInstance.instanceId,
        },
        foreign: foreignInstance,
      },
      members: {
        owner: { platformUserId: owner.verified.userId },
        foreignOwner: { platformUserId: foreignOwner.verified.userId },
        finance: { platformUserId: finance.verified.userId, membershipId: financeMembershipId },
        operator: { platformUserId: operator.verified.userId, membershipId: operatorMembershipId },
        privateMember: {
          platformUserId: privateMember.verified.userId,
          membershipId: privateMembershipId,
        },
        ...(extraMembers.length === 0 ? {} : { extra: extraMembers }),
      },
      googleIdTokens: tokens,
      deliveries,
      provisionEnvelopes: envelopes,
    };
  }

  private async acknowledge(input: unknown): Promise<unknown> {
    const record = object(input, 'acknowledgement');
    exactKeys(record, ['version', 'receipt', 'owner']);
    versionOne(record.version);
    const receipt = accepted(parseServiceProvisionReceiptV1(record.receipt));
    const delivery = await this.core.accountPlatform.pendingProvisionOperation(
      satyr,
      receipt.operationId,
    );
    if (!delivery)
      return accepted(await this.core.accountPlatform.acknowledgeProvision(satyr, receipt));
    const owner = object(record.owner, 'owner');
    exactKeys(owner, [
      'nativePrincipalId',
      'platformUserId',
      'issuer',
      'subject',
      'verificationReceiptId',
    ]);
    if (owner.issuer !== 'https://accounts.google.com')
      throw new Error('Invalid provision owner issuer');
    accepted(
      await this.core.serviceAccess.recordProvisionedOwner(satyr, delivery, {
        nativePrincipalId: textValue(owner.nativePrincipalId, 'nativePrincipalId'),
        platformUserId: textValue(owner.platformUserId, 'platformUserId'),
        issuer: owner.issuer,
        subject: textValue(owner.subject, 'subject'),
        verificationReceiptId: textValue(owner.verificationReceiptId, 'verificationReceiptId'),
      }),
    );
    return accepted(await this.core.accountPlatform.acknowledgeProvision(satyr, receipt));
  }

  private async context(organisation: unknown): Promise<OrganizationAccessContext> {
    const orgId =
      organisation === 'primary' ? primaryOrgId : organisation === 'foreign' ? foreignOrgId : null;
    if (!orgId) throw new Error('Invalid fixture organisation');
    const owner = await queryD1One(
      this.bindings.ACCOUNT_DB,
      `SELECT user_id FROM organization_memberships
      WHERE namespace = ? AND org_id = ? AND role = 'OWNER' AND kind = 'ACTIVE'`,
      [namespace, orgId],
    );
    if (!owner) throw new Error('Fixture organisation has no active owner');
    return { orgId, actorUserId: textValue(owner.user_id, 'owner user id') };
  }

  private async mutate(input: unknown): Promise<unknown> {
    const record = object(input, 'mutation');
    versionOne(record.version);
    const context = await this.context(record.organisation);
    switch (record.kind) {
      case 'fail_service_provision': {
        exactKeys(record, ['version', 'kind', 'organisation', 'instanceId']);
        const instance = accepted(
          await this.core.accountPlatform.getInstance(
            context,
            textValue(record.instanceId, 'instanceId'),
          ),
        );
        return this.core.accountPlatform.failProvision(satyr, {
          operationId: instance.command.operationId,
          failureCode: 'provisioning_failed',
        });
      }
      case 'remove_member':
      case 'suspend_member':
      case 'reactivate_member': {
        exactKeys(record, ['version', 'kind', 'organisation', 'membershipId']);
        const membershipId = textValue(record.membershipId, 'membershipId');
        if (record.kind === 'remove_member')
          return this.core.organizationAccess.removeMembership(context, membershipId);
        if (record.kind === 'suspend_member')
          return this.core.organizationAccess.suspendMembership(context, membershipId);
        return this.core.organizationAccess.reactivateMembership(context, membershipId);
      }
      case 'grant_service':
      case 'revoke_service': {
        exactKeys(record, ['version', 'kind', 'organisation', 'membershipId', 'instanceId']);
        const membershipId = textValue(record.membershipId, 'membershipId');
        const instanceId = textValue(record.instanceId, 'instanceId');
        const instance = accepted(
          await this.core.accountPlatform.resolveServiceProducerInstance(satyr, instanceId),
        );
        if (instance.scope.organizationId !== context.orgId) throw new Error('Foreign instance');
        await this.bindings.ACCOUNT_DB.prepare(
          `INSERT INTO platform_instance_access
          (namespace, org_id, instance_id, membership_id, access, granted_by_user_id, updated_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(namespace, instance_id, membership_id)
          DO UPDATE SET access = excluded.access, updated_at_ms = excluded.updated_at_ms`,
        )
          .bind(
            namespace,
            context.orgId,
            instanceId,
            membershipId,
            record.kind === 'grant_service' ? 'allowed' : 'revoked',
            context.actorUserId,
            Date.now(),
          )
          .run();
        return { changed: true };
      }
      case 'rejoin_member': {
        exactKeys(record, ['version', 'kind', 'organisation', 'membershipId', 'instanceId']);
        const previous = await queryD1One(
          this.bindings.ACCOUNT_DB,
          `SELECT m.user_id, p.verified_email FROM organization_memberships m
          JOIN platform_provider_identities p ON p.namespace = m.namespace AND p.user_id = m.user_id
          WHERE m.namespace = ? AND m.org_id = ? AND m.id = ? AND m.kind = 'REMOVED'`,
          [namespace, context.orgId, textValue(record.membershipId, 'membershipId')],
        );
        if (!previous) throw new Error('Rejoin requires an actually removed verified member');
        const userId = textValue(previous.user_id, 'user_id');
        const email = textValue(previous.verified_email, 'verified_email');
        const instanceId = textValue(record.instanceId, 'instanceId');
        const instance = accepted(
          await this.core.accountPlatform.resolveServiceProducerInstance(satyr, instanceId),
        );
        if (instance.scope.organizationId !== context.orgId)
          throw new Error('Foreign rejoin instance');
        const invitation = await this.core.organizationAccess.invite(context, {
          email,
          role: 'MEMBER',
          projectAccess: [{ projectId: instance.scope.projectId, accessLevel: 'editor' }],
        });
        const membership = await this.core.organizationAccess.acceptInvitation(
          { userId, verifiedEmail: email },
          invitation.invitation.id,
          { token: invitation.token },
        );
        await this.bindings.ACCOUNT_DB.prepare(
          `INSERT INTO platform_instance_access
          (namespace, org_id, instance_id, membership_id, access, granted_by_user_id, updated_at_ms)
          VALUES (?, ?, ?, ?, 'allowed', ?, ?) ON CONFLICT(namespace, instance_id, membership_id)
          DO UPDATE SET access = 'allowed', updated_at_ms = excluded.updated_at_ms`,
        )
          .bind(
            namespace,
            context.orgId,
            instanceId,
            membership.id,
            context.actorUserId,
            Date.now(),
          )
          .run();
        return { membershipId: membership.id };
      }
      case 'request_service_disable': {
        exactKeys(record, ['version', 'kind', 'organisation', 'instanceId']);
        const instanceId = textValue(record.instanceId, 'instanceId');
        const instance = accepted(
          await this.core.accountPlatform.resolveServiceProducerInstance(satyr, instanceId),
        );
        if (instance.scope.organizationId !== context.orgId) throw new Error('Foreign instance');
        const command = accepted(
          ServiceProvisionCommandV1.parse({
            version: 1,
            operationId: `disable:${instanceId}:${instance.command.desiredRevision + 1}`,
            instanceId,
            desiredRevision: instance.command.desiredRevision + 1,
            command: 'disable',
            binding: instance.command.binding,
          }),
        );
        const updated = accepted(
          await this.core.accountPlatform.requestProvision(context, {
            scope: instance.scope,
            command,
          }),
        );
        const deliveries = await this.core.accountPlatform.pendingProvision(satyr, 100);
        const delivery = deliveries.find(matchesOperation.bind(null, command.operationId));
        if (!delivery) throw new Error('Disable command was not retained');
        return { instance: updated, provisionEnvelope: await this.signedProvision(delivery) };
      }
      case 'wallet_usage': {
        exactKeys(record, ['version', 'kind', 'organisation', 'occurredAt']);
        const projectId =
          context.orgId === primaryOrgId
            ? 'project_shared_account_wallet'
            : 'project_shared_account_foreign';
        const event = accepted(
          PlatformUsageEventV1.parse({
            version: 1,
            eventId: `wallet-monthly:${context.orgId}`,
            instanceId: `wallet:${projectId}`,
            occurredAt: record.occurredAt,
            meterId: 'wallet.monthly_active_resource',
            quantity: 1,
            unit: 'resource_month',
            evidence: {
              kind: 'wallet_resource',
              sourceRecordId: `wallet-source:${context.orgId}`,
              sourceDigest: await billingCanonicalDigest({
                orgId: context.orgId,
                resourceId: 'wallet-e2e-resource',
              }),
              environmentId: 'wallet-e2e-dev',
              resourceId: 'wallet-e2e-resource',
            },
          }),
        );
        return accepted(await this.core.billingUsage.record(wallet, event));
      }
      default:
        throw new Error('Unknown fixture mutation');
    }
  }

  private fault(input: unknown): unknown {
    const record = object(input, 'fault');
    exactKeys(record, ['version', 'kind']);
    versionOne(record.version);
    switch (record.kind) {
      case 'clear':
        this.faults.clear();
        break;
      case 'eligibility_outage':
      case 'primary_eligibility_outage':
      case 'primary_malformed_eligibility_reply':
      case 'primary_foreign_scope_reply':
      case 'fee_policy_outage':
      case 'usage_outage':
      case 'lose_usage_reply':
      case 'lose_reserve_reply':
      case 'lose_onboarding_reply':
      case 'onboarding_outage':
        this.faults.add(record.kind);
        break;
      default:
        throw new Error('Unknown fixture fault');
    }
    return { version: 1, faults: [...this.faults] };
  }

  private async snapshot(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = { version: 1 };
    for (const table of [
      'organizations',
      'projects',
      'organization_memberships',
      'platform_service_instances',
      'platform_provision_operations',
      'platform_provision_receipts',
      'platform_provider_identities',
      'platform_service_principals',
      'platform_instance_access',
      'platform_automation_grants',
      'billing_usage_events',
      'billing_usage_receipts',
      'billing_funds_reservations',
      'billing_funds_terminal_receipts',
      'billing_execution_charges',
      'billing_ledger_entries',
      'billing_ledger_postings',
    ]) {
      result[table] = await queryD1All(
        this.bindings.ACCOUNT_DB,
        `SELECT * FROM ${table} ORDER BY rowid`,
        [],
      );
    }
    result.billing_charge_attributions = await queryD1All(
      this.bindings.ACCOUNT_DB,
      'SELECT * FROM billing_charge_attributions ORDER BY ledger_entry_id',
      [],
    );
    const context = await this.context('primary');
    result.overview = await this.core.billing.getOverview(context);
    result.charges = await listD1BillingUsageCharges({
      database: this.bindings.ACCOUNT_DB,
      namespace,
      organizationId: primaryOrgId,
      periodMonthUtc: new Date().toISOString().slice(0, 7),
    });
    return result;
  }

  private async statement(input: unknown): Promise<Response> {
    const record = object(input, 'statement');
    exactKeys(record, ['version', 'organisation', 'periodMonthUtc', 'format']);
    versionOne(record.version);
    const context = await this.context(record.organisation);
    const document = await this.core.billing.generateMonthlyInvoice(context, {
      periodMonthUtc: textValue(record.periodMonthUtc, 'periodMonthUtc'),
    });
    const lineItems = await this.core.billing.listInvoiceLineItems(context, document.invoice.id);
    if (record.format === 'json') return json({ document, lineItems });
    if (record.format !== 'pdf') throw new Error('Invalid statement format');
    const pdf = buildConsoleBillingInvoicePdf({
      orgId: context.orgId,
      invoice: document.invoice,
      lineItems,
      exportedAt: new Date(),
    });
    return new Response(pdf, {
      headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
    });
  }
}

function matchesOperation(operationId: string, delivery: ServiceProvisionDeliveryV1): boolean {
  return delivery.command.operationId === operationId;
}

async function migrate(database: D1DatabaseLike): Promise<void> {
  const existing = await queryD1One(
    database,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'platform_service_principals'",
    [],
  );
  if (existing) return;
  for (const migration of ACCOUNT_CORE_MIGRATIONS) {
    const statements = [];
    for (const statement of migration.statements) statements.push(database.prepare(statement));
    await database.batch(statements);
  }
}

async function empty(database: D1DatabaseLike): Promise<void> {
  // D1 refuses each query that reads its internal tables, so both queries leave them out.
  const objects = await queryD1All(
    database,
    `SELECT type, name FROM sqlite_master
    WHERE type IN ('view', 'table') AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'`,
    [],
  );
  if (objects.length === 0) return;
  const references = await queryD1All(
    database,
    `SELECT child.name AS child, reference."table" AS parent
    FROM sqlite_master AS child JOIN pragma_foreign_key_list(child.name) AS reference
    WHERE child.type = 'table' AND child.name NOT GLOB 'sqlite_*' AND child.name NOT GLOB '_cf_*'
      AND reference."table" <> child.name AND reference.on_delete NOT IN ('NO ACTION', 'RESTRICT')`,
    [],
  );
  const statements = [database.prepare('PRAGMA defer_foreign_keys = ON')];
  const tables = new Set<string>();
  for (const object of objects) {
    const name = textValue(object.name, 'name');
    if (object.type === 'table') tables.add(name);
    else statements.push(database.prepare(`DROP VIEW "${name}"`));
  }
  // A dropped table deletes its rows, and SQLite compiles each delete action that this starts
  // in a child table. The compile fails when a parent of that child is gone, so a table goes
  // after each table that it acts on. The other references wait for the end of the batch.
  while (tables.size > 0) {
    const referenced = new Set<unknown>();
    for (const reference of references)
      if (tables.has(textValue(reference.child, 'child'))) referenced.add(reference.parent);
    const before = tables.size;
    for (const name of [...tables]) {
      if (referenced.has(name)) continue;
      tables.delete(name);
      statements.push(database.prepare(`DROP TABLE "${name}"`));
    }
    if (tables.size === before) throw new Error('Account schema has a cycle of delete actions');
  }
  await database.batch(statements);
}

async function googleJwks(publicKey: JsonWebKey, input: RequestInfo | URL): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== 'https://www.googleapis.com/oauth2/v3/certs')
    throw new Error('Unexpected Google request');
  return Response.json(
    {
      keys: [
        {
          kty: publicKey.kty,
          n: publicKey.n,
          e: publicKey.e,
          use: 'sig',
          alg: 'RS256',
          kid: 'shared-account-google-e2e',
        },
      ],
    },
    { headers: { 'Cache-Control': 'max-age=3600' } },
  );
}

function ingressFor(
  core: CloudflareD1AccountServiceBundle,
  producer: AuthenticatedAccountServiceProducerV1,
  fetchGoogle: typeof fetch,
): AccountPlatformServiceIngressHandler {
  return createAccountPlatformServiceIngress({
    producer,
    access: core.serviceAccess,
    memberships: core.serviceMemberships,
    funds: core.funds,
    billingUsage: core.billingUsage,
    googleIdentityFetch: fetchGoogle,
  });
}

let runtime: Promise<AccountWorkerFixture> | null = null;

// The journey controls delivery between the two real runtimes and can lose its reply.
async function unavailableProvisionTransport(): Promise<Response> {
  return new Response('Provision delivery is controlled by the acceptance journey', {
    status: 503,
  });
}

class OnboardingTestLifetime {
  private readonly pending: Promise<unknown>[] = [];
  waitUntil(work: Promise<unknown>): void {
    this.pending.push(work);
  }
  async finish(): Promise<void> {
    await Promise.all(this.pending);
  }
}

async function fetchFixture(request: Request, bindings: FixtureBindings): Promise<Response> {
  runtime ??= AccountWorkerFixture.create(bindings);
  try {
    return await (await runtime).fetch(request);
  } catch (error) {
    return json(
      { code: 'fixture_failure', message: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

export default { fetch: fetchFixture };

function isEligibilityRequest(pathname: string): boolean {
  return (
    pathname === '/account-platform/v1/eligibility' ||
    pathname === '/account-platform/v1/eligibility/current'
  );
}
