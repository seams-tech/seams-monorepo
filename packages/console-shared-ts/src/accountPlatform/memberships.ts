import { object, exactObject, textValue, utcTimestamp } from './boundary';

export const ORGANIZATION_MEMBERSHIP_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

export const ORGANIZATION_ADMIN_PERMISSIONS = [
  'members.manage',
  'projects.manage',
  'billing.view',
  'billing.manage',
] as const;

export const PROJECT_ACCESS_LEVELS = ['viewer', 'editor'] as const;

export const ORGANIZATION_MEMBERSHIP_KINDS = ['active', 'suspended', 'removed'] as const;

export const ORGANIZATION_INVITATION_KINDS = [
  'pending',
  'accepted',
  'declined',
  'revoked',
  'expired',
] as const;

export type OrganizationMembershipRole = (typeof ORGANIZATION_MEMBERSHIP_ROLES)[number];
export type OrganizationAdminPermission = (typeof ORGANIZATION_ADMIN_PERMISSIONS)[number];
export type ProjectAccessLevel = (typeof PROJECT_ACCESS_LEVELS)[number];
export type OrganizationMembershipKind = (typeof ORGANIZATION_MEMBERSHIP_KINDS)[number];
export type OrganizationInvitationKind = (typeof ORGANIZATION_INVITATION_KINDS)[number];

export interface ProjectAccessAssignment {
  readonly projectId: string;
  readonly accessLevel: ProjectAccessLevel;
}

interface OrganizationMembershipIdentity {
  readonly id: string;
  readonly orgId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ActiveOwnerMembership = OrganizationMembershipIdentity & {
  readonly kind: 'active';
  readonly role: 'OWNER';
  readonly suspendedAt?: never;
  readonly removedAt?: never;
};

export type ActiveAdministratorMembership = OrganizationMembershipIdentity & {
  readonly kind: 'active';
  readonly role: 'ADMIN';
  readonly suspendedAt?: never;
  readonly removedAt?: never;
};

export type ActiveMemberMembership = OrganizationMembershipIdentity & {
  readonly kind: 'active';
  readonly role: 'MEMBER';
  readonly suspendedAt?: never;
  readonly removedAt?: never;
};

export type SuspendedAdministratorMembership = OrganizationMembershipIdentity & {
  readonly kind: 'suspended';
  readonly role: 'ADMIN';
  readonly suspendedAt: string;
  readonly removedAt?: never;
};

export type SuspendedMemberMembership = OrganizationMembershipIdentity & {
  readonly kind: 'suspended';
  readonly role: 'MEMBER';
  readonly suspendedAt: string;
  readonly removedAt?: never;
};

export type RemovedAdministratorMembership = OrganizationMembershipIdentity & {
  readonly kind: 'removed';
  readonly role: 'ADMIN';
  readonly removedAt: string;
  readonly suspendedAt?: never;
};

export type RemovedMemberMembership = OrganizationMembershipIdentity & {
  readonly kind: 'removed';
  readonly role: 'MEMBER';
  readonly removedAt: string;
  readonly suspendedAt?: never;
};

export type ActiveOrganizationMembership =
  | ActiveOwnerMembership
  | ActiveAdministratorMembership
  | ActiveMemberMembership;

export type OrganizationMembership =
  | ActiveOrganizationMembership
  | SuspendedAdministratorMembership
  | SuspendedMemberMembership
  | RemovedAdministratorMembership
  | RemovedMemberMembership;

export type OrganizationInvitationGrant =
  | {
      readonly role: 'OWNER';
      readonly adminPermissions?: never;
      readonly projectAccess?: never;
    }
  | {
      readonly role: 'ADMIN';
      readonly adminPermissions: readonly OrganizationAdminPermission[];
      readonly projectAccess?: never;
    }
  | {
      readonly role: 'MEMBER';
      readonly projectAccess: readonly ProjectAccessAssignment[];
      readonly adminPermissions?: never;
    };

interface OrganizationInvitationIdentity {
  readonly id: string;
  readonly orgId: string;
  readonly email: string;
  readonly invitedByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PendingOrganizationInvitation = OrganizationInvitationIdentity &
  OrganizationInvitationGrant & {
    readonly kind: 'pending';
    readonly expiresAt: string;
    readonly membershipId?: never;
    readonly acceptedAt?: never;
    readonly declinedAt?: never;
    readonly revokedAt?: never;
    readonly expiredAt?: never;
  };

export type AcceptedOrganizationInvitation = OrganizationInvitationIdentity &
  OrganizationInvitationGrant & {
    readonly kind: 'accepted';
    readonly membershipId: string;
    readonly acceptedAt: string;
    readonly expiresAt?: never;
    readonly declinedAt?: never;
    readonly revokedAt?: never;
    readonly expiredAt?: never;
  };

export type DeclinedOrganizationInvitation = OrganizationInvitationIdentity &
  OrganizationInvitationGrant & {
    readonly kind: 'declined';
    readonly declinedAt: string;
    readonly expiresAt?: never;
    readonly membershipId?: never;
    readonly acceptedAt?: never;
    readonly revokedAt?: never;
    readonly expiredAt?: never;
  };

export type RevokedOrganizationInvitation = OrganizationInvitationIdentity &
  OrganizationInvitationGrant & {
    readonly kind: 'revoked';
    readonly revokedAt: string;
    readonly expiresAt?: never;
    readonly membershipId?: never;
    readonly acceptedAt?: never;
    readonly declinedAt?: never;
    readonly expiredAt?: never;
  };

export type ExpiredOrganizationInvitation = OrganizationInvitationIdentity &
  OrganizationInvitationGrant & {
    readonly kind: 'expired';
    readonly expiredAt: string;
    readonly expiresAt?: never;
    readonly membershipId?: never;
    readonly acceptedAt?: never;
    readonly declinedAt?: never;
    readonly revokedAt?: never;
  };

export type OrganizationInvitation =
  | PendingOrganizationInvitation
  | AcceptedOrganizationInvitation
  | DeclinedOrganizationInvitation
  | RevokedOrganizationInvitation
  | ExpiredOrganizationInvitation;

export interface IssuedOrganizationInvitation {
  readonly invitation: PendingOrganizationInvitation;
  readonly token: string;
}

export interface OrganizationMembershipWithAccess {
  readonly membership: OrganizationMembership;
  readonly adminPermissions: readonly OrganizationAdminPermission[];
  readonly projectAccess: readonly ProjectAccessAssignment[];
}

export type InviteOrganizationMemberRequest = {
  readonly email: string;
} & OrganizationInvitationGrant;

export type ChangeOrganizationMembershipRoleRequest = OrganizationInvitationGrant;

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

export function readOrganizationMembershipV1(input: unknown): OrganizationMembership {
  const record = object(input, 'membership');
  const keys = [
    'id',
    'orgId',
    'userId',
    'email',
    'displayName',
    'createdAt',
    'updatedAt',
    'kind',
    'role',
  ];
  const identity: OrganizationMembershipIdentity = {
    id: textValue(record.id),
    orgId: textValue(record.orgId),
    userId: textValue(record.userId),
    email: textValue(record.email),
    displayName: record.displayName === null ? null : textValue(record.displayName),
    createdAt: utcTimestamp(record.createdAt),
    updatedAt: utcTimestamp(record.updatedAt),
  };
  switch (record.kind) {
    case 'active':
      exactObject(record, keys);
      if (record.role !== 'OWNER' && record.role !== 'ADMIN' && record.role !== 'MEMBER')
        throw new Error('Invalid active role');
      return { ...identity, kind: 'active', role: record.role };
    case 'suspended':
      exactObject(record, [...keys, 'suspendedAt']);
      if (record.role !== 'ADMIN' && record.role !== 'MEMBER')
        throw new Error('Invalid suspended role');
      return {
        ...identity,
        kind: 'suspended',
        role: record.role,
        suspendedAt: utcTimestamp(record.suspendedAt),
      };
    case 'removed':
      exactObject(record, [...keys, 'removedAt']);
      if (record.role !== 'ADMIN' && record.role !== 'MEMBER')
        throw new Error('Invalid removed role');
      return {
        ...identity,
        kind: 'removed',
        role: record.role,
        removedAt: utcTimestamp(record.removedAt),
      };
    default:
      throw new Error('Invalid membership state');
  }
}
export function readActiveOrganizationMembershipV1(
  input: unknown,
): Extract<OrganizationMembership, { kind: 'active' }> {
  const membership = readOrganizationMembershipV1(input);
  if (membership.kind !== 'active') throw new Error('Expected active membership');
  return membership;
}
export function readOrganizationMembershipWithAccessV1(
  input: unknown,
): OrganizationMembershipWithAccess {
  const r = exactObject(input, ['membership', 'adminPermissions', 'projectAccess']);
  return {
    membership: readOrganizationMembershipV1(r.membership),
    adminPermissions: readAdminPermissions(r.adminPermissions),
    projectAccess: readProjectAssignments(r.projectAccess),
  };
}
export function readOrganizationInvitationV1(input: unknown): OrganizationInvitation {
  const record = object(input, 'invitation');
  const identity: OrganizationInvitationIdentity = {
    id: textValue(record.id),
    orgId: textValue(record.orgId),
    email: textValue(record.email),
    invitedByUserId: textValue(record.invitedByUserId),
    createdAt: utcTimestamp(record.createdAt),
    updatedAt: utcTimestamp(record.updatedAt),
  };
  const grant = readInvitationGrant(record);
  const keys = [
    'id',
    'orgId',
    'email',
    'invitedByUserId',
    'createdAt',
    'updatedAt',
    'kind',
    ...invitationGrantKeys(grant),
  ];
  switch (record.kind) {
    case 'pending':
      exactObject(record, [...keys, 'expiresAt']);
      return {
        ...identity,
        ...grant,
        kind: 'pending',
        expiresAt: utcTimestamp(record.expiresAt),
      };
    case 'accepted':
      exactObject(record, [...keys, 'membershipId', 'acceptedAt']);
      return {
        ...identity,
        ...grant,
        kind: 'accepted',
        membershipId: textValue(record.membershipId),
        acceptedAt: utcTimestamp(record.acceptedAt),
      };
    case 'declined':
      exactObject(record, [...keys, 'declinedAt']);
      return {
        ...identity,
        ...grant,
        kind: 'declined',
        declinedAt: utcTimestamp(record.declinedAt),
      };
    case 'revoked':
      exactObject(record, [...keys, 'revokedAt']);
      return {
        ...identity,
        ...grant,
        kind: 'revoked',
        revokedAt: utcTimestamp(record.revokedAt),
      };
    case 'expired':
      exactObject(record, [...keys, 'expiredAt']);
      return {
        ...identity,
        ...grant,
        kind: 'expired',
        expiredAt: utcTimestamp(record.expiredAt),
      };
    default:
      throw new Error('Invalid invitation state');
  }
}
export function readAccountMembershipListV1(input: unknown): AccountMembershipListV1 {
  const r = exactObject(input, ['memberships', 'invitations']);
  if (!Array.isArray(r.memberships) || !Array.isArray(r.invitations))
    throw new Error('Invalid membership lists');
  return {
    memberships: r.memberships.map(readOrganizationMembershipWithAccessV1),
    invitations: r.invitations.map(readOrganizationInvitationV1),
  };
}
export function readIssuedOrganizationInvitationV1(input: unknown): IssuedOrganizationInvitation {
  const r = exactObject(input, ['invitation', 'token']);
  const invitation = readOrganizationInvitationV1(r.invitation);
  if (invitation.kind !== 'pending') throw new Error('Expected pending invitation');
  return { invitation, token: textValue(r.token) };
}
function readInvitationGrant(input: Record<string, unknown>): OrganizationInvitationGrant {
  switch (input.role) {
    case 'OWNER':
      return { role: 'OWNER' };
    case 'ADMIN':
      return {
        role: 'ADMIN',
        adminPermissions: readAdminPermissions(input.adminPermissions),
      };
    case 'MEMBER':
      return {
        role: 'MEMBER',
        projectAccess: readProjectAssignments(input.projectAccess),
      };
    default:
      throw new Error('Invalid invitation role');
  }
}
function invitationGrantKeys(grant: OrganizationInvitationGrant): readonly string[] {
  switch (grant.role) {
    case 'OWNER':
      return ['role'];
    case 'ADMIN':
      return ['role', 'adminPermissions'];
    case 'MEMBER':
      return ['role', 'projectAccess'];
  }
}
function readAdminPermissions(input: unknown): readonly OrganizationAdminPermission[] {
  if (!Array.isArray(input)) throw new Error('Invalid admin permissions');
  return input.map(readAdminPermission);
}
function readAdminPermission(input: unknown): OrganizationAdminPermission {
  switch (input) {
    case 'members.manage':
    case 'projects.manage':
    case 'billing.view':
    case 'billing.manage':
      return input;
    default:
      throw new Error('Invalid admin permission');
  }
}
function readProjectAssignments(input: unknown): readonly ProjectAccessAssignment[] {
  if (!Array.isArray(input)) throw new Error('Invalid project assignments');
  return input.map(readProjectAssignment);
}
function readProjectAssignment(input: unknown): ProjectAccessAssignment {
  const r = exactObject(input, ['projectId', 'accessLevel']);
  if (r.accessLevel !== 'viewer' && r.accessLevel !== 'editor')
    throw new Error('Invalid project access');
  return { projectId: textValue(r.projectId), accessLevel: r.accessLevel };
}
