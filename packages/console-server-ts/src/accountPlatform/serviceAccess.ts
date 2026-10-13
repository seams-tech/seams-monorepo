import type { VerifiedAccountUserAssertionV1 } from './serviceIngressAuth';
import {
  ServiceIdentityResolutionV1,
  SatyrServiceFeePolicyV1,
  type PlatformPrincipalV1,
  type PlatformResult,
  ServiceEligibilityRequestV1,
  type ServiceEligibilityResultV1,
} from '@seams-internal/console-shared/accountPlatform';
import {
  assertNever,
  integer,
  textValue,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import type { ConsoleGoogleLoginResult } from '../boundary/providerIdentity';
import { queryD1One, type D1DatabaseLike } from '../boundary/d1';
import { SATYR_COMPLETED_TURN_TEST_PRICE_V1 } from '../billing/pricing';
import type { ConsoleOrganizationAccessService } from '../teamRbac/service';
import type { D1AccountPlatformService } from './d1';
import { ensureAccountServiceAccessD1Schema } from './accessSchema';
import {
  platformScopesEqual,
  readPlatformScopeColumns,
  type AccountServiceInstanceV1,
  type ServiceProducerAuthorityV1,
  type ServiceProvisionDeliveryV1,
} from './types';

export type { ServiceIdentityResolutionV1 as AccountIdentityResolutionV1 } from '@seams-internal/console-shared/accountPlatform';

type IdentityResult = PlatformResult<
  ServiceIdentityResolutionV1,
  { readonly code: 'scope_forbidden' | 'authority_unavailable' }
>;

export interface D1AccountServiceAccessOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly platform: D1AccountPlatformService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly now?: () => Date;
}

export interface VerifiedAccountProvisionOwner {
  readonly userId: string;
  readonly issuer: 'https://accounts.google.com';
  readonly subject: string;
  readonly verificationReceiptId: string;
  readonly email: string;
  readonly displayName: string | null;
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

function now(): Date {
  return new Date();
}

function identityForbidden(): IdentityResult {
  return { kind: 'rejected', error: { code: 'scope_forbidden' } };
}

function eligibilityDenied(
  code: 'scope_forbidden' | 'membership_ineligible' | 'instance_ineligible',
): ServiceEligibilityResultV1 {
  return { kind: 'rejected', error: { code, retryable: false } };
}

function authenticatedUser(
  assertion: VerifiedAccountUserAssertionV1,
): Extract<PlatformPrincipalV1, { readonly kind: 'user' }> | null {
  return assertion.principal.kind === 'user' ? assertion.principal : null;
}

function principalsEqual(left: PlatformPrincipalV1, right: PlatformPrincipalV1): boolean {
  if (left.kind === 'automation') {
    return (
      right.kind === 'automation' &&
      left.automationId === right.automationId &&
      left.grantId === right.grantId
    );
  }
  if (right.kind !== 'user') return false;
  const identity = left.identity;
  const other = right.identity;
  if (identity.userId !== other.userId || identity.kind !== other.kind) return false;
  if (identity.kind === 'verified_provider_subject') {
    if (
      other.kind !== 'verified_provider_subject' ||
      identity.issuer !== other.issuer ||
      identity.subject !== other.subject ||
      identity.verificationReceiptId !== other.verificationReceiptId
    )
      return false;
  } else if (
    other.kind !== 'authenticated_account_link' ||
    identity.accountLinkReceiptId !== other.accountLinkReceiptId
  )
    return false;
  const authority = left.authority;
  const target = right.authority;
  switch (authority.kind) {
    case 'authenticated_session':
      return target.kind === authority.kind && authority.nativeSessionId === target.nativeSessionId;
    case 'accepted_execution':
      return (
        target.kind === authority.kind &&
        authority.acceptedExecutionId === target.acceptedExecutionId
      );
    case 'disclosure_recipient':
      return (
        target.kind === authority.kind &&
        authority.disclosureEvidenceId === target.disclosureEvidenceId
      );
    case 'authenticated_provider_event':
      return (
        target.kind === authority.kind &&
        authority.provider === target.provider &&
        authority.nativeEventId === target.nativeEventId &&
        authority.nativeIntegrationAccountId === target.nativeIntegrationAccountId &&
        authority.nativeWorkspaceId === target.nativeWorkspaceId &&
        authority.nativeExternalUserId === target.nativeExternalUserId
      );
    default:
      return assertNever(authority);
  }
}

export class D1AccountServiceAccess {
  private readonly database: D1DatabaseLike;
  private readonly namespace: string;
  private readonly platform: D1AccountPlatformService;
  private readonly organizationAccess: ConsoleOrganizationAccessService;
  private readonly clock: () => Date;

  constructor(options: D1AccountServiceAccessOptions) {
    this.database = options.database;
    this.namespace = options.namespace;
    this.platform = options.platform;
    this.organizationAccess = options.organizationAccess;
    this.clock = options.now ?? now;
  }

  async ensureSchema(): Promise<void> {
    await ensureAccountServiceAccessD1Schema(this.database);
  }

  async recordVerifiedGoogleIdentity(
    verified: Extract<ConsoleGoogleLoginResult, { readonly ok: true }>,
    verificationReceiptId: string,
  ): Promise<void> {
    if (verified.userId !== `google:${verified.sub}`) {
      throw new Error('Verified Google identity does not match its provider subject');
    }
    const email =
      verified.emailVerified === true && verified.email ? verified.email.toLowerCase() : null;
    await this.database
      .prepare(
        `INSERT INTO platform_provider_identities
      (namespace, user_id, provider_issuer, provider_subject, verification_receipt_id, verified_email, display_name, created_at_ms)
      VALUES (?, ?, 'https://accounts.google.com', ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, user_id) DO UPDATE SET
        verified_email = excluded.verified_email,
        display_name = excluded.display_name`,
      )
      .bind(
        this.namespace,
        verified.userId,
        verified.sub,
        verificationReceiptId,
        email,
        verified.name ?? null,
        this.clock().getTime(),
      )
      .run();
  }

  async getVerifiedProvisionOwner(userId: string): Promise<VerifiedAccountProvisionOwner | null> {
    const row = await queryD1One(
      this.database,
      `SELECT user_id, provider_issuer, provider_subject, verification_receipt_id, verified_email, display_name
      FROM platform_provider_identities WHERE namespace = ? AND user_id = ?`,
      [this.namespace, userId],
    );
    if (!row || row.verified_email === null) return null;
    if (row.provider_issuer !== 'https://accounts.google.com')
      throw new Error('Invalid persisted provision owner provider');
    return {
      userId: textValue(row.user_id, 'user_id'),
      issuer: row.provider_issuer,
      subject: textValue(row.provider_subject, 'provider_subject'),
      verificationReceiptId: textValue(row.verification_receipt_id, 'verification_receipt_id'),
      email: textValue(row.verified_email, 'verified_email'),
      displayName: row.display_name === null ? null : textValue(row.display_name, 'display_name'),
    };
  }

  async recordProvisionedOwner(
    authority: ServiceProducerAuthorityV1,
    delivery: ServiceProvisionDeliveryV1,
    owner: AccountProvisionedServiceOwnerV1,
  ): Promise<
    PlatformResult<
      AccountProvisionedServiceOwnerV1,
      { readonly code: 'scope_forbidden' | 'operation_conflict' }
    >
  > {
    if (
      authority.serviceId !== 'satyr' ||
      delivery.authority.serviceId !== authority.serviceId ||
      delivery.authority.deploymentId !== authority.deploymentId ||
      owner.platformUserId !== delivery.requestedByUserId
    ) {
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    }
    const instance = await this.platform.resolveServiceProducerInstance(
      authority,
      delivery.command.instanceId,
    );
    if (instance.kind === 'rejected' || !platformScopesEqual(instance.value.scope, delivery.scope))
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    const verified = await this.getVerifiedProvisionOwner(owner.platformUserId);
    if (
      !verified ||
      verified.issuer !== owner.issuer ||
      verified.subject !== owner.subject ||
      verified.verificationReceiptId !== owner.verificationReceiptId
    )
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    const operation = await queryD1One(
      this.database,
      `SELECT actor_user_id, payload_digest FROM platform_provision_operations
      WHERE namespace = ? AND id = ? AND instance_id = ? AND service_id = ? AND deployment_id = ?`,
      [
        this.namespace,
        delivery.command.operationId,
        instance.value.instanceId,
        authority.serviceId,
        authority.deploymentId,
      ],
    );
    if (
      !operation ||
      operation.actor_user_id !== delivery.requestedByUserId ||
      operation.payload_digest !== delivery.payloadDigest
    )
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    try {
      await this.database
        .prepare(
          `INSERT INTO platform_service_principals
        (namespace, instance_id, native_principal_id, user_id, provider_issuer, provider_subject, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .bind(
          this.namespace,
          instance.value.instanceId,
          textValue(owner.nativePrincipalId, 'nativePrincipalId'),
          owner.platformUserId,
          owner.issuer,
          owner.subject,
          this.clock().getTime(),
        )
        .run();
    } catch (error) {
      if (String(error).includes('platform_identity_conflict'))
        return { kind: 'rejected', error: { code: 'operation_conflict' } };
      throw error;
    }
    return { kind: 'accepted', value: owner };
  }

  async getProvisionOwnerGrant(
    delivery: ServiceProvisionDeliveryV1,
  ): Promise<AccountProvisionOwnerGrantV1 | null> {
    const row = await queryD1One(
      this.database,
      `SELECT m.id AS membership_id, o.id AS operation_id, a.access_revision
      FROM platform_provision_operations o
      JOIN organization_memberships m ON m.namespace = o.namespace AND m.org_id = o.org_id AND m.user_id = o.actor_user_id
      LEFT JOIN platform_instance_access a ON a.namespace = o.namespace AND a.instance_id = o.instance_id AND a.membership_id = m.id
      WHERE o.namespace = ? AND o.id = ? AND o.instance_id = ? AND o.actor_user_id = ? AND o.payload_digest = ?
        AND o.org_id = ? AND o.project_id = ? AND o.billing_account_id = ?`,
      [
        this.namespace,
        delivery.command.operationId,
        delivery.command.instanceId,
        delivery.requestedByUserId,
        delivery.payloadDigest,
        delivery.scope.organizationId,
        delivery.scope.projectId,
        delivery.scope.billingAccountId,
      ],
    );
    if (!row) return null;
    const platformMembershipId = textValue(row.membership_id, 'membership_id');
    const accountAcceptanceReceiptId = textValue(row.operation_id, 'operation_id');
    if (row.access_revision === null) {
      return {
        platformMembershipId,
        accountAcceptanceReceiptId,
        serviceGrant: { kind: 'account_management' },
      };
    }
    return {
      platformMembershipId,
      accountAcceptanceReceiptId,
      serviceGrant: {
        kind: 'instance_access',
        accessRevision: integer(row.access_revision, 'access_revision', 1),
      },
    };
  }

  private async assertedInstance(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
  ): Promise<AccountServiceInstanceV1 | null> {
    const instance = await this.platform.resolveServiceProducerInstance(
      authority,
      assertion.instanceId,
    );
    if (instance.kind === 'rejected' || !platformScopesEqual(instance.value.scope, assertion.scope))
      return null;
    return instance.value;
  }

  async linkGoogleIdentity(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    verified: Extract<ConsoleGoogleLoginResult, { readonly ok: true }>,
    verificationReceiptId: string,
  ): Promise<IdentityResult> {
    const user = authenticatedUser(assertion);
    if (
      !user ||
      user.authority.kind !== 'authenticated_session' ||
      assertion.authorityRevision !== 0 ||
      user.identity.kind !== 'verified_provider_subject'
    )
      return identityForbidden();
    if (
      verified.userId !== user.identity.userId ||
      verified.sub !== user.identity.subject ||
      user.identity.issuer !== 'https://accounts.google.com'
    )
      return identityForbidden();
    const instance = await this.assertedInstance(authority, assertion);
    if (!instance) return identityForbidden();
    try {
      await this.recordVerifiedGoogleIdentity(verified, verificationReceiptId);
      await this.database
        .prepare(
          `INSERT INTO platform_service_principals
          (namespace, instance_id, native_principal_id, user_id, provider_issuer, provider_subject, created_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .bind(
          this.namespace,
          instance.instanceId,
          assertion.nativePrincipalId,
          verified.userId,
          user.identity.issuer,
          verified.sub,
          this.clock().getTime(),
        )
        .run();
    } catch (error) {
      if (String(error).includes('platform_identity_conflict')) return identityForbidden();
      throw error;
    }
    return this.resolveIdentity(authority, assertion);
  }

  async resolveIdentity(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
  ): Promise<IdentityResult> {
    if (assertion.principal.kind === 'automation')
      return this.resolveAutomationIdentity(authority, assertion);
    const user = authenticatedUser(assertion);
    if (!user || user.identity.kind !== 'verified_provider_subject') return identityForbidden();
    const instance = await this.assertedInstance(authority, assertion);
    if (!instance) return identityForbidden();
    const identity = await queryD1One(
      this.database,
      `SELECT p.user_id, p.provider_issuer, p.provider_subject, v.verification_receipt_id
      FROM platform_service_principals p
      JOIN platform_provider_identities v ON v.namespace = p.namespace AND v.user_id = p.user_id
        AND v.provider_issuer = p.provider_issuer AND v.provider_subject = p.provider_subject
      WHERE p.namespace = ? AND p.instance_id = ? AND p.native_principal_id = ?`,
      [this.namespace, instance.instanceId, assertion.nativePrincipalId],
    );
    if (
      !identity ||
      identity.user_id !== user.identity.userId ||
      identity.provider_issuer !== user.identity.issuer ||
      identity.provider_subject !== user.identity.subject
    )
      return identityForbidden();
    const revision = await this.organizationAccess.getAuthorizationVersion(
      instance.scope.organizationId,
    );
    if (revision === null) return identityForbidden();
    const parsed = ServiceIdentityResolutionV1.parse({
      version: 1,
      scope: instance.scope,
      instanceId: instance.instanceId,
      nativePrincipalId: assertion.nativePrincipalId,
      principal: {
        kind: 'user',
        identity: {
          kind: 'verified_provider_subject',
          userId: textValue(identity.user_id, 'user_id'),
          issuer: textValue(identity.provider_issuer, 'provider_issuer'),
          subject: textValue(identity.provider_subject, 'provider_subject'),
          verificationReceiptId: textValue(
            identity.verification_receipt_id,
            'verification_receipt_id',
          ),
        },
        authority: user.authority,
      },
      authorityRevision: revision,
    });
    if (parsed.kind === 'rejected')
      throw new Error('Invalid persisted account identity resolution');
    return { kind: 'accepted', value: parsed.value };
  }

  private async resolveAutomationIdentity(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
  ): Promise<IdentityResult> {
    if (assertion.principal.kind !== 'automation') return identityForbidden();
    const instance = await this.assertedInstance(authority, assertion);
    if (!instance || instance.state.kind !== 'active') return identityForbidden();
    const grant = await queryD1One(
      this.database,
      `SELECT o.authorization_version
      FROM platform_automation_grants g
      JOIN platform_service_instances i ON i.namespace = g.namespace AND i.org_id = g.org_id AND i.id = g.instance_id
      JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
      JOIN projects p ON p.namespace = i.namespace AND p.org_id = i.org_id AND p.id = i.project_id
      WHERE g.namespace = ? AND g.instance_id = ? AND g.automation_id = ? AND g.grant_id = ? AND g.native_principal_id = ? AND g.access = 'allowed'
        AND i.service_id = ? AND i.deployment_id = ? AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'
        AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active' AND i.observed_revision = i.desired_revision
        AND ((i.service_id = 'wallet' AND EXISTS (SELECT 1 FROM wallet_service_bindings b WHERE b.namespace = i.namespace AND b.instance_id = i.id AND b.deployment_id = i.deployment_id))
          OR (i.service_id = 'satyr' AND EXISTS (SELECT 1 FROM satyr_service_bindings b WHERE b.namespace = i.namespace AND b.instance_id = i.id AND b.deployment_id = i.deployment_id)))`,
      [
        this.namespace,
        instance.instanceId,
        assertion.principal.automationId,
        assertion.principal.grantId,
        assertion.nativePrincipalId,
        authority.serviceId,
        authority.deploymentId,
      ],
    );
    if (!grant) return identityForbidden();
    const parsed = ServiceIdentityResolutionV1.parse({
      version: 1,
      scope: instance.scope,
      instanceId: instance.instanceId,
      nativePrincipalId: assertion.nativePrincipalId,
      principal: assertion.principal,
      authorityRevision: integer(grant.authorization_version, 'authorization_version', 1),
    });
    if (parsed.kind === 'rejected') throw new Error('Invalid persisted account automation grant');
    return { kind: 'accepted', value: parsed.value };
  }

  async setAutomationGrant(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    request: AccountAutomationGrantChangeV1,
  ): Promise<
    PlatformResult<
      AccountAutomationGrantV1,
      {
        readonly code:
          | 'scope_forbidden'
          | 'membership_ineligible'
          | 'instance_ineligible'
          | 'operation_conflict';
      }
    >
  > {
    const user = authenticatedUser(assertion);
    if (
      !user ||
      user.authority.kind !== 'authenticated_session' ||
      assertion.action !== 'execute' ||
      request.instanceId !== assertion.instanceId
    )
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    const parsed = ServiceEligibilityRequestV1.parse({
      version: 1,
      instanceId: request.instanceId,
      principal: user,
      action: 'execute',
    });
    if (parsed.kind === 'rejected') throw new Error('Invalid resolved automation grant actor');
    const eligible = await this.checkEligibility(authority, assertion, parsed.value);
    if (eligible.kind === 'rejected') {
      if (eligible.error.code === 'authority_unavailable')
        throw new Error('Automation grant authority is unavailable');
      return { kind: 'rejected', error: { code: eligible.error.code } };
    }
    const authorization = await this.organizationAccess.lookupAuthorization({
      orgId: eligible.value.scope.organizationId,
      userId: user.identity.userId,
    });
    if (
      !authorization ||
      authorization.kind !== 'authorized' ||
      (authorization.role !== 'OWNER' &&
        (authorization.role !== 'ADMIN' ||
          !authorization.adminPermissions.includes('projects.manage')))
    )
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    const existing = await queryD1One(
      this.database,
      `SELECT native_principal_id, access, access_revision FROM platform_automation_grants
      WHERE namespace = ? AND instance_id = ? AND automation_id = ? AND grant_id = ?`,
      [this.namespace, request.instanceId, request.automationId, request.grantId],
    );
    if (existing && existing.native_principal_id !== request.nativePrincipalId)
      return { kind: 'rejected', error: { code: 'operation_conflict' } };
    const initialReplay =
      existing !== null &&
      request.expectedAccessRevision === 0 &&
      request.access === 'allowed' &&
      existing.access === 'allowed' &&
      existing.access_revision === 1;
    if (existing === null) {
      if (request.expectedAccessRevision !== 0 || request.access !== 'allowed')
        return { kind: 'rejected', error: { code: 'operation_conflict' } };
    } else if (!initialReplay && request.expectedAccessRevision !== existing.access_revision) {
      return { kind: 'rejected', error: { code: 'operation_conflict' } };
    }
    const written = await queryD1One(
      this.database,
      `INSERT INTO platform_automation_grants
      (namespace, org_id, instance_id, automation_id, grant_id, native_principal_id, access, granted_by_user_id, updated_at_ms)
      SELECT i.namespace, i.org_id, i.id, ?, ?, ?, ?, ?, ? FROM platform_service_instances i
      JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
      JOIN projects p ON p.namespace = i.namespace AND p.org_id = i.org_id AND p.id = i.project_id
      WHERE i.namespace = ? AND i.id = ? AND i.service_id = ? AND i.deployment_id = ?
        AND o.authorization_version = ? AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'
        AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active' AND i.observed_revision = i.desired_revision
        AND (? = 0 OR EXISTS (SELECT 1 FROM platform_automation_grants current
          WHERE current.namespace = i.namespace AND current.instance_id = i.id
            AND current.automation_id = ? AND current.grant_id = ? AND current.access_revision = ?))
      ON CONFLICT(namespace, instance_id, automation_id, grant_id) DO UPDATE SET access = excluded.access, updated_at_ms = excluded.updated_at_ms
        WHERE platform_automation_grants.native_principal_id = excluded.native_principal_id
          AND ((? > 0 AND platform_automation_grants.access_revision = ?)
            OR (? = 0 AND excluded.access = 'allowed' AND platform_automation_grants.access = 'allowed'
              AND platform_automation_grants.access_revision = 1))
      RETURNING native_principal_id`,
      [
        request.automationId,
        request.grantId,
        request.nativePrincipalId,
        request.access,
        user.identity.userId,
        this.clock().getTime(),
        this.namespace,
        request.instanceId,
        authority.serviceId,
        authority.deploymentId,
        assertion.authorityRevision,
        request.expectedAccessRevision,
        request.automationId,
        request.grantId,
        request.expectedAccessRevision,
        request.expectedAccessRevision,
        request.expectedAccessRevision,
        request.expectedAccessRevision,
      ],
    );
    if (!written) return { kind: 'rejected', error: { code: 'operation_conflict' } };
    const revision = await this.organizationAccess.getAuthorizationVersion(
      eligible.value.scope.organizationId,
    );
    if (revision === null) throw new Error('Automation grant organization is unavailable');
    const grant = await queryD1One(
      this.database,
      `SELECT access_revision FROM platform_automation_grants
      WHERE namespace = ? AND instance_id = ? AND automation_id = ? AND grant_id = ? AND native_principal_id = ?`,
      [
        this.namespace,
        request.instanceId,
        request.automationId,
        request.grantId,
        request.nativePrincipalId,
      ],
    );
    if (!grant) throw new Error('Written automation grant is unavailable');
    return {
      kind: 'accepted',
      value: {
        version: 1,
        scope: eligible.value.scope,
        instanceId: request.instanceId,
        automationId: request.automationId,
        grantId: request.grantId,
        nativePrincipalId: request.nativePrincipalId,
        access: request.access,
        authorityRevision: revision,
        accessRevision: integer(grant.access_revision, 'access_revision', 1),
      },
    };
  }

  async checkEligibility(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    request: ServiceEligibilityRequestV1,
  ): Promise<ServiceEligibilityResultV1> {
    if (
      request.instanceId !== assertion.instanceId ||
      request.action !== assertion.action ||
      !principalsEqual(request.principal, assertion.principal)
    )
      return eligibilityDenied('scope_forbidden');
    const principal = assertion.principal;
    if (principal.kind === 'user' && principal.identity.kind !== 'verified_provider_subject')
      return eligibilityDenied('scope_forbidden');
    const identityJoin =
      principal.kind === 'automation'
        ? `JOIN platform_automation_grants a ON a.namespace = i.namespace AND a.org_id = i.org_id AND a.instance_id = i.id
          AND a.automation_id = ? AND a.grant_id = ? AND a.native_principal_id = ? AND a.access = 'allowed'`
        : `JOIN platform_service_principals sp ON sp.namespace = i.namespace AND sp.instance_id = i.id AND sp.native_principal_id = ?
         JOIN platform_provider_identities v ON v.namespace = sp.namespace AND v.user_id = sp.user_id
           AND v.provider_issuer = sp.provider_issuer AND v.provider_subject = sp.provider_subject
           AND v.user_id = ? AND v.provider_issuer = ? AND v.provider_subject = ? AND v.verification_receipt_id = ?
         JOIN organization_memberships m ON m.namespace = i.namespace AND m.org_id = i.org_id AND m.user_id = v.user_id AND m.kind = 'ACTIVE'
         JOIN platform_instance_access a ON a.namespace = i.namespace AND a.instance_id = i.id AND a.membership_id = m.id AND a.access = 'allowed'`;
    const identityValues =
      principal.kind === 'automation'
        ? [principal.automationId, principal.grantId, assertion.nativePrincipalId]
        : [
            assertion.nativePrincipalId,
            principal.identity.userId,
            principal.identity.issuer,
            principal.identity.subject,
            principal.identity.verificationReceiptId,
          ];
    const permission =
      principal.kind === 'automation'
        ? ''
        : `AND (m.role IN ('OWNER', 'ADMIN') OR EXISTS (
      SELECT 1 FROM project_member_access x WHERE x.namespace = m.namespace AND x.org_id = m.org_id
        AND x.membership_id = m.id AND x.project_id = i.project_id
        AND (? IN ('disclose', 'replay') OR x.access_level = 'editor')))`;
    const row = await queryD1One(
      this.database,
      `SELECT i.namespace, i.org_id, i.project_id, i.billing_account_id, o.authorization_version, a.access_revision
       FROM platform_service_instances i
       JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
       JOIN projects p ON p.namespace = i.namespace AND p.org_id = i.org_id AND p.id = i.project_id
       ${identityJoin}
       WHERE i.namespace = ? AND i.id = ? AND i.service_id = ? AND i.deployment_id = ?
         AND o.status = 'ACTIVE' AND p.status = 'ACTIVE' AND o.authorization_version = ?
         AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active' AND i.observed_revision = i.desired_revision
         ${permission}
         AND ((i.service_id = 'wallet' AND EXISTS (SELECT 1 FROM wallet_service_bindings b WHERE b.namespace = i.namespace AND b.instance_id = i.id AND b.deployment_id = i.deployment_id))
           OR (i.service_id = 'satyr' AND EXISTS (SELECT 1 FROM satyr_service_bindings b WHERE b.namespace = i.namespace AND b.instance_id = i.id AND b.deployment_id = i.deployment_id)))`,
      [
        ...identityValues,
        this.namespace,
        assertion.instanceId,
        authority.serviceId,
        authority.deploymentId,
        assertion.authorityRevision,
        ...(principal.kind === 'user' ? [request.action] : []),
      ],
    );
    if (!row) return eligibilityDenied('membership_ineligible');
    const scope = readPlatformScopeColumns(row);
    if (!platformScopesEqual(scope, assertion.scope)) return eligibilityDenied('scope_forbidden');
    return {
      kind: 'accepted',
      value: {
        authorityRevision: integer(row.authorization_version, 'authorization_version', 1),
        accessRevision: integer(row.access_revision, 'access_revision', 1),
        scope,
        instanceId: assertion.instanceId,
        principal,
        action: request.action,
      },
    };
  }

  async feePolicy(
    authority: ServiceProducerAuthorityV1,
    instanceId: string,
  ): Promise<PlatformResult<SatyrServiceFeePolicyV1, { readonly code: 'scope_forbidden' }>> {
    if (authority.serviceId !== 'satyr')
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    const instance = await this.platform.resolveServiceProducerInstance(authority, instanceId);
    if (instance.kind === 'rejected')
      return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    const isolated = await queryD1One(
      this.database,
      'SELECT 1 AS isolated FROM billing_isolated_test_accounts WHERE namespace = ? AND org_id = ?',
      [this.namespace, instance.value.scope.organizationId],
    );
    if (!isolated) {
      const parsed = SatyrServiceFeePolicyV1.parse({
        version: 1,
        instanceId,
        scope: instance.value.scope,
        policy: { kind: 'customer_unpriced' },
      });
      if (parsed.kind === 'rejected')
        throw new Error('Invalid persisted Satyr customer fee policy');
      return { kind: 'accepted', value: parsed.value };
    }
    const price = await queryD1One(
      this.database,
      `SELECT unit_minor FROM billing_price_definitions WHERE meter_id = 'satyr.completed_turn.test' AND version = ? AND unit_minor = 1 AND availability = 'isolated_test_accounts'`,
      [SATYR_COMPLETED_TURN_TEST_PRICE_V1.version],
    );
    if (!price) throw new Error('Isolated Satyr price is unavailable');
    const parsed = SatyrServiceFeePolicyV1.parse({
      version: 1,
      instanceId,
      scope: instance.value.scope,
      policy: {
        kind: 'isolated_e2e_completed_turn',
        meterId: SATYR_COMPLETED_TURN_TEST_PRICE_V1.meterId,
        priceVersion: SATYR_COMPLETED_TURN_TEST_PRICE_V1.version,
        currency: SATYR_COMPLETED_TURN_TEST_PRICE_V1.currency,
        unitMinor: SATYR_COMPLETED_TURN_TEST_PRICE_V1.unitMinor,
      },
    });
    if (parsed.kind === 'rejected') throw new Error('Invalid persisted isolated Satyr fee policy');
    return { kind: 'accepted', value: parsed.value };
  }

  async verifiedInvitationEmail(userId: string): Promise<string | null> {
    const row = await queryD1One(
      this.database,
      'SELECT verified_email FROM platform_provider_identities WHERE namespace = ? AND user_id = ?',
      [this.namespace, userId],
    );
    return row?.verified_email === null || !row
      ? null
      : textValue(row.verified_email, 'verified_email');
  }
}
