import type { VerifiedAccountUserAssertionV1 } from './serviceIngressAuth';
import {
  ServiceEligibilityRequestV1,
  type PlatformResult,
  type PlatformScopeV1,
} from '@seams-internal/console-shared/accountPlatform';
import { integer, textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import { billingCanonicalDigest } from '../billing/pricing';
import { queryD1All, queryD1One, type D1DatabaseLike, type D1Row } from '../boundary/d1';
import { ConsoleOrganizationAccessError } from '../teamRbac/errors';
import type {
  ConsoleOrganizationAccessService,
  OrganizationAccessContext,
} from '../teamRbac/service';
import type {
  ActiveOrganizationMembership,
  InviteOrganizationMemberRequest,
  IssuedOrganizationInvitation,
  OrganizationInvitation,
  OrganizationMembershipWithAccess,
} from '../teamRbac/types';
import type { D1AccountServiceAccess } from './serviceAccess';
import type { ServiceProducerAuthorityV1 } from './types';

export type AccountMembershipErrorV1 = {
  readonly code:
    | 'scope_forbidden'
    | 'membership_ineligible'
    | 'instance_ineligible'
    | 'authority_unavailable';
};

export type AccountMembershipResultV1<T> = PlatformResult<T, AccountMembershipErrorV1>;

export interface AccountMembershipListV1 {
  readonly memberships: readonly OrganizationMembershipWithAccess[];
  readonly invitations: readonly OrganizationInvitation[];
}

export interface AccountInstanceAccessV1 {
  readonly instanceId: string;
  readonly membershipId: string;
  readonly access: 'allowed' | 'revoked';
  readonly authorityRevision: number;
}

export interface D1AccountMembershipFacadeOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly access: D1AccountServiceAccess;
  readonly now?: () => Date;
}

interface ResolvedMembershipActor {
  readonly scope: PlatformScopeV1;
  readonly instanceId: string;
  readonly userId: string;
  readonly context: OrganizationAccessContext;
}

function now(): Date {
  return new Date();
}

function rejected<T>(code: AccountMembershipErrorV1['code']): AccountMembershipResultV1<T> {
  return { kind: 'rejected', error: { code } };
}

function accepted<T>(value: T): AccountMembershipResultV1<T> {
  return { kind: 'accepted', value };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled membership grant: ${JSON.stringify(value)}`);
}

async function invitationGrantMatches(
  invitation: OrganizationInvitation,
  request: InviteOrganizationMemberRequest,
): Promise<boolean> {
  if (invitation.role !== request.role) return false;
  switch (request.role) {
    case 'OWNER':
      return true;
    case 'ADMIN':
      return (
        invitation.role === 'ADMIN' &&
        (await billingCanonicalDigest(invitation.adminPermissions)) ===
          (await billingCanonicalDigest(request.adminPermissions))
      );
    case 'MEMBER':
      return (
        invitation.role === 'MEMBER' &&
        (await billingCanonicalDigest(invitation.projectAccess)) ===
          (await billingCanonicalDigest(request.projectAccess))
      );
    default:
      return assertNever(request);
  }
}

function acceptedMembership(row: D1Row): ActiveOrganizationMembership {
  const id = textValue(row.id, 'membership.id');
  const orgId = textValue(row.org_id, 'membership.org_id');
  const userId = textValue(row.user_id, 'membership.user_id');
  const email = textValue(row.email, 'membership.email');
  const displayName =
    row.display_name === null ? null : textValue(row.display_name, 'membership.display_name');
  const createdAt = new Date(
    integer(row.created_at_ms, 'membership.created_at_ms', 0),
  ).toISOString();
  const updatedAt = new Date(
    integer(row.updated_at_ms, 'membership.updated_at_ms', 0),
  ).toISOString();
  switch (row.role) {
    case 'OWNER':
      return {
        id,
        orgId,
        userId,
        email,
        displayName,
        createdAt,
        updatedAt,
        kind: 'active',
        role: 'OWNER',
      };
    case 'ADMIN':
      return {
        id,
        orgId,
        userId,
        email,
        displayName,
        createdAt,
        updatedAt,
        kind: 'active',
        role: 'ADMIN',
      };
    case 'MEMBER':
      return {
        id,
        orgId,
        userId,
        email,
        displayName,
        createdAt,
        updatedAt,
        kind: 'active',
        role: 'MEMBER',
      };
    default:
      throw new Error('Accepted service invitation has an invalid membership role');
  }
}

export class D1AccountMembershipFacade {
  private readonly database: D1DatabaseLike;
  private readonly namespace: string;
  private readonly organizationAccess: ConsoleOrganizationAccessService;
  private readonly access: D1AccountServiceAccess;
  private readonly clock: () => Date;

  constructor(options: D1AccountMembershipFacadeOptions) {
    this.database = options.database;
    this.namespace = options.namespace;
    this.organizationAccess = options.organizationAccess;
    this.access = options.access;
    this.clock = options.now ?? now;
  }

  private async resolveActor(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    instanceId: string,
    action: 'execute' | 'disclose',
  ): Promise<AccountMembershipResultV1<ResolvedMembershipActor>> {
    if (
      instanceId !== assertion.instanceId ||
      assertion.action !== action ||
      assertion.principal.kind !== 'user' ||
      assertion.principal.authority.kind !== 'authenticated_session'
    ) {
      return rejected('scope_forbidden');
    }
    const identity = await this.access.resolveIdentity(authority, assertion);
    if (identity.kind === 'rejected') return identity;
    if (identity.value.authorityRevision !== assertion.authorityRevision) {
      return rejected('membership_ineligible');
    }
    return accepted({
      scope: identity.value.scope,
      instanceId: identity.value.instanceId,
      userId: assertion.principal.identity.userId,
      context: {
        orgId: identity.value.scope.organizationId,
        actorUserId: assertion.principal.identity.userId,
      },
    });
  }

  private async eligibleActor(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    instanceId: string,
    action: 'execute' | 'disclose',
  ): Promise<AccountMembershipResultV1<ResolvedMembershipActor>> {
    if (
      instanceId !== assertion.instanceId ||
      assertion.action !== action ||
      assertion.principal.kind !== 'user' ||
      assertion.principal.authority.kind !== 'authenticated_session'
    ) {
      return rejected('scope_forbidden');
    }
    const request = ServiceEligibilityRequestV1.parse({
      version: 1,
      instanceId,
      principal: assertion.principal,
      action,
    });
    if (request.kind === 'rejected') throw new Error('Resolved membership assertion is invalid');
    const eligibility = await this.access.checkEligibility(authority, assertion, request.value);
    if (eligibility.kind === 'rejected') return rejected(eligibility.error.code);
    return accepted({
      scope: eligibility.value.scope,
      instanceId: eligibility.value.instanceId,
      userId: assertion.principal.identity.userId,
      context: {
        orgId: eligibility.value.scope.organizationId,
        actorUserId: assertion.principal.identity.userId,
      },
    });
  }

  async list(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    instanceId: string,
  ): Promise<AccountMembershipResultV1<AccountMembershipListV1>> {
    const actor = await this.eligibleActor(authority, assertion, instanceId, 'disclose');
    if (actor.kind === 'rejected') return actor;
    const memberships = await this.organizationAccess.listMemberships(actor.value.context, {
      kind: 'all',
    });
    const invitations = await this.organizationAccess.listInvitations(actor.value.context, {
      kind: 'all',
    });
    const grantRows = await queryD1All(
      this.database,
      `SELECT invitation_id FROM platform_service_invitation_grants
        WHERE namespace = ? AND org_id = ? AND instance_id = ?`,
      [this.namespace, actor.value.scope.organizationId, instanceId],
    );
    const invitationIds = new Set<string>();
    for (const row of grantRows) {
      invitationIds.add(textValue(row.invitation_id, 'invitation_id'));
    }
    const serviceInvitations: OrganizationInvitation[] = [];
    for (const invitation of invitations) {
      if (invitationIds.has(invitation.id)) serviceInvitations.push(invitation);
    }
    return accepted({ memberships, invitations: serviceInvitations });
  }

  private async issueInvitation(
    actor: ResolvedMembershipActor,
    request: InviteOrganizationMemberRequest,
  ): Promise<IssuedOrganizationInvitation> {
    try {
      return await this.organizationAccess.invite(actor.context, request);
    } catch (error) {
      if (
        !(error instanceof ConsoleOrganizationAccessError) ||
        error.code !== 'invitation_already_exists'
      ) {
        throw error;
      }
      const pending = await this.organizationAccess.listInvitations(actor.context, {
        kind: 'pending',
      });
      for (const invitation of pending) {
        if (
          invitation.email === request.email &&
          invitation.invitedByUserId === actor.userId &&
          (await invitationGrantMatches(invitation, request))
        ) {
          return this.organizationAccess.resendInvitation(actor.context, invitation.id);
        }
      }
      throw error;
    }
  }

  async invite(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    instanceId: string,
    request: InviteOrganizationMemberRequest,
  ): Promise<AccountMembershipResultV1<IssuedOrganizationInvitation>> {
    const actor = await this.eligibleActor(authority, assertion, instanceId, 'execute');
    if (actor.kind === 'rejected') return actor;
    const issued = await this.issueInvitation(actor.value, request);
    await this.database
      .prepare(
        `INSERT INTO platform_service_invitation_grants
        (namespace, org_id, invitation_id, instance_id, granted_by_user_id, issued_authority_revision, created_at_ms)
       SELECT v.namespace, v.org_id, v.id, i.id, ?, ?, ? FROM organization_invitations v
       JOIN platform_service_instances i ON i.namespace = v.namespace AND i.org_id = v.org_id AND i.id = ?
       JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
       JOIN projects p ON p.namespace = i.namespace AND p.org_id = i.org_id AND p.id = i.project_id
       WHERE v.namespace = ? AND v.org_id = ? AND v.id = ? AND v.kind = 'PENDING'
         AND o.authorization_version = ? AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'
         AND i.service_id = ? AND i.deployment_id = ?
         AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active'
         AND i.observed_revision = i.desired_revision
       ON CONFLICT(namespace, invitation_id, instance_id) DO UPDATE SET issued_authority_revision = excluded.issued_authority_revision`,
      )
      .bind(
        actor.value.userId,
        assertion.authorityRevision,
        this.clock().getTime(),
        instanceId,
        this.namespace,
        actor.value.scope.organizationId,
        issued.invitation.id,
        assertion.authorityRevision,
        authority.serviceId,
        authority.deploymentId,
      )
      .run();
    const saved = await queryD1One(
      this.database,
      `SELECT invitation_id FROM platform_service_invitation_grants
       WHERE namespace = ? AND org_id = ? AND instance_id = ? AND invitation_id = ?`,
      [this.namespace, actor.value.scope.organizationId, instanceId, issued.invitation.id],
    );
    if (!saved) return rejected('membership_ineligible');
    return accepted(issued);
  }

  async revoke(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    instanceId: string,
    membershipId: string,
  ): Promise<AccountMembershipResultV1<OrganizationMembershipWithAccess>> {
    const actor = await this.eligibleActor(authority, assertion, instanceId, 'execute');
    if (actor.kind === 'rejected') return actor;
    const membership = await this.organizationAccess.removeMembership(
      actor.value.context,
      membershipId,
    );
    return accepted(membership);
  }

  async revokeInvitation(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    instanceId: string,
    invitationId: string,
  ): Promise<AccountMembershipResultV1<OrganizationInvitation>> {
    const actor = await this.eligibleActor(authority, assertion, instanceId, 'execute');
    if (actor.kind === 'rejected') return actor;
    const grant = await queryD1One(
      this.database,
      `SELECT invitation_id FROM platform_service_invitation_grants
        WHERE namespace = ? AND org_id = ? AND instance_id = ? AND invitation_id = ?`,
      [this.namespace, actor.value.scope.organizationId, instanceId, invitationId],
    );
    if (!grant) return rejected('scope_forbidden');
    return accepted(
      await this.organizationAccess.revokeInvitation(actor.value.context, invitationId),
    );
  }

  private async activeInvitationGrant(
    authority: ServiceProducerAuthorityV1,
    actor: ResolvedMembershipActor,
    invitationId: string,
  ): Promise<D1Row | null> {
    return queryD1One(
      this.database,
      `SELECT g.granted_by_user_id FROM platform_service_invitation_grants g
       JOIN platform_service_instances i ON i.namespace = g.namespace AND i.id = g.instance_id AND i.org_id = g.org_id
       JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
       JOIN projects p ON p.namespace = i.namespace AND p.id = i.project_id AND p.org_id = i.org_id
       WHERE g.namespace = ? AND g.org_id = ? AND g.invitation_id = ? AND g.instance_id = ?
         AND i.service_id = ? AND i.deployment_id = ? AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'
         AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active'
         AND i.observed_revision = i.desired_revision
         AND ((i.service_id = 'wallet' AND EXISTS (SELECT 1 FROM wallet_service_bindings b
           WHERE b.namespace = i.namespace AND b.instance_id = i.id AND b.deployment_id = i.deployment_id))
           OR (i.service_id = 'satyr' AND EXISTS (SELECT 1 FROM satyr_service_bindings b
           WHERE b.namespace = i.namespace AND b.instance_id = i.id AND b.deployment_id = i.deployment_id)))`,
      [
        this.namespace,
        actor.scope.organizationId,
        invitationId,
        actor.instanceId,
        authority.serviceId,
        authority.deploymentId,
      ],
    );
  }

  private async previouslyAcceptedMembership(
    actor: ResolvedMembershipActor,
    invitationId: string,
  ): Promise<AccountMembershipResultV1<ActiveOrganizationMembership | null>> {
    const row = await queryD1One(
      this.database,
      `SELECT m.* FROM organization_invitations v JOIN organization_memberships m
         ON m.namespace = v.namespace AND m.org_id = v.org_id AND m.id = v.membership_id
       WHERE v.namespace = ? AND v.org_id = ? AND v.id = ? AND v.kind = 'ACCEPTED'
         AND m.user_id = ?`,
      [this.namespace, actor.scope.organizationId, invitationId, actor.userId],
    );
    if (row === null) return accepted(null);
    if (row.kind !== 'ACTIVE') return rejected('membership_ineligible');
    return accepted(acceptedMembership(row));
  }

  async acceptInvitation(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    instanceId: string,
    invitationId: string,
    token: string,
  ): Promise<AccountMembershipResultV1<ActiveOrganizationMembership>> {
    const actor = await this.resolveActor(authority, assertion, instanceId, 'execute');
    if (actor.kind === 'rejected') return actor;
    const grant = await this.activeInvitationGrant(authority, actor.value, invitationId);
    if (!grant) return rejected('instance_ineligible');
    const previous = await this.previouslyAcceptedMembership(actor.value, invitationId);
    if (previous.kind === 'rejected') return previous;
    let membership = previous.value;
    if (!membership) {
      const verifiedEmail = await this.access.verifiedInvitationEmail(actor.value.userId);
      if (verifiedEmail === null) return rejected('scope_forbidden');
      membership = await this.organizationAccess.acceptInvitation(
        { userId: actor.value.userId, verifiedEmail },
        invitationId,
        { token },
      );
    }
    await this.database
      .prepare(
        `INSERT INTO platform_instance_access
        (namespace, org_id, instance_id, membership_id, access, source_invitation_id, granted_by_user_id, updated_at_ms)
       SELECT g.namespace, g.org_id, g.instance_id, m.id, 'allowed', g.invitation_id, g.granted_by_user_id, ?
       FROM platform_service_invitation_grants g
       JOIN organization_invitations v ON v.namespace = g.namespace AND v.org_id = g.org_id AND v.id = g.invitation_id
       JOIN organization_memberships m ON m.namespace = v.namespace AND m.org_id = v.org_id AND m.id = v.membership_id
       JOIN platform_service_instances i ON i.namespace = g.namespace AND i.org_id = g.org_id AND i.id = g.instance_id
       JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
       JOIN projects p ON p.namespace = i.namespace AND p.org_id = i.org_id AND p.id = i.project_id
       WHERE g.namespace = ? AND g.org_id = ? AND g.instance_id = ? AND g.invitation_id = ?
         AND v.kind = 'ACCEPTED' AND m.kind = 'ACTIVE' AND m.user_id = ? AND m.id = ?
         AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'
         AND i.service_id = ? AND i.deployment_id = ?
         AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active'
         AND i.observed_revision = i.desired_revision
         AND g.issued_authority_revision >= COALESCE((
           SELECT MAX(previous.revoked_authority_revision) FROM platform_instance_access previous
           JOIN organization_memberships previous_membership ON previous_membership.namespace = previous.namespace
             AND previous_membership.org_id = previous.org_id AND previous_membership.id = previous.membership_id
           WHERE previous.namespace = g.namespace AND previous.instance_id = g.instance_id AND previous_membership.user_id = m.user_id
         ), 0)
       ON CONFLICT(namespace, instance_id, membership_id) DO UPDATE SET access = 'allowed',
         source_invitation_id = excluded.source_invitation_id, updated_at_ms = excluded.updated_at_ms
         WHERE platform_instance_access.source_invitation_id IS NOT excluded.source_invitation_id`,
      )
      .bind(
        this.clock().getTime(),
        this.namespace,
        actor.value.scope.organizationId,
        instanceId,
        invitationId,
        actor.value.userId,
        membership.id,
        authority.serviceId,
        authority.deploymentId,
      )
      .run();
    const access = await queryD1One(
      this.database,
      `SELECT access FROM platform_instance_access
       WHERE namespace = ? AND org_id = ? AND instance_id = ? AND membership_id = ?`,
      [this.namespace, actor.value.scope.organizationId, instanceId, membership.id],
    );
    return access?.access === 'allowed' ? accepted(membership) : rejected('membership_ineligible');
  }

  async setInstanceAccess(
    authority: ServiceProducerAuthorityV1,
    assertion: VerifiedAccountUserAssertionV1,
    instanceId: string,
    membershipId: string,
    access: 'allowed' | 'revoked',
  ): Promise<AccountMembershipResultV1<AccountInstanceAccessV1>> {
    const actor = await this.eligibleActor(authority, assertion, instanceId, 'execute');
    if (actor.kind === 'rejected') return actor;
    const authorization = await this.organizationAccess.lookupAuthorization({
      orgId: actor.value.scope.organizationId,
      userId: actor.value.userId,
    });
    if (
      !authorization ||
      authorization.kind !== 'authorized' ||
      authorization.authorizationVersion !== assertion.authorityRevision ||
      (authorization.role !== 'OWNER' &&
        (authorization.role !== 'ADMIN' ||
          !authorization.adminPermissions.includes('members.manage')))
    ) {
      return rejected('membership_ineligible');
    }
    const saved = await this.database
      .prepare(
        `INSERT INTO platform_instance_access
        (namespace, org_id, instance_id, membership_id, access, granted_by_user_id, updated_at_ms)
       SELECT ?, m.org_id, ?, m.id, ?, ?, ? FROM organization_memberships m
       JOIN organizations o ON o.namespace = m.namespace AND o.id = m.org_id
       JOIN platform_service_instances i ON i.namespace = m.namespace AND i.org_id = m.org_id AND i.id = ?
       JOIN projects p ON p.namespace = i.namespace AND p.org_id = i.org_id AND p.id = i.project_id
       WHERE m.namespace = ? AND m.org_id = ? AND m.id = ? AND m.kind = 'ACTIVE'
         AND o.authorization_version = ? AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'
         AND i.service_id = ? AND i.deployment_id = ?
         AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active'
         AND i.observed_revision = i.desired_revision
       ON CONFLICT(namespace, instance_id, membership_id) DO UPDATE SET
         access = excluded.access, granted_by_user_id = excluded.granted_by_user_id,
         updated_at_ms = excluded.updated_at_ms
       RETURNING membership_id`,
      )
      .bind(
        this.namespace,
        instanceId,
        access,
        actor.value.userId,
        this.clock().getTime(),
        instanceId,
        this.namespace,
        actor.value.scope.organizationId,
        membershipId,
        assertion.authorityRevision,
        authority.serviceId,
        authority.deploymentId,
      )
      .first<D1Row>();
    if (!saved) return rejected('membership_ineligible');
    const revision = await this.organizationAccess.getAuthorizationVersion(
      actor.value.scope.organizationId,
    );
    if (revision === null) return rejected('membership_ineligible');
    return accepted({ instanceId, membershipId, access, authorityRevision: revision });
  }
}
