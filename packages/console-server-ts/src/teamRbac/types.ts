export {
  ORGANIZATION_MEMBERSHIP_ROLES,
  ORGANIZATION_ADMIN_PERMISSIONS,
  PROJECT_ACCESS_LEVELS,
  ORGANIZATION_MEMBERSHIP_KINDS,
  ORGANIZATION_INVITATION_KINDS,
  type OrganizationMembershipRole,
  type OrganizationAdminPermission,
  type ProjectAccessLevel,
  type OrganizationMembershipKind,
  type OrganizationInvitationKind,
  type ProjectAccessAssignment,
  type ActiveOwnerMembership,
  type ActiveAdministratorMembership,
  type ActiveMemberMembership,
  type SuspendedAdministratorMembership,
  type SuspendedMemberMembership,
  type RemovedAdministratorMembership,
  type RemovedMemberMembership,
  type ActiveOrganizationMembership,
  type OrganizationMembership,
  type OrganizationInvitationGrant,
  type PendingOrganizationInvitation,
  type AcceptedOrganizationInvitation,
  type DeclinedOrganizationInvitation,
  type RevokedOrganizationInvitation,
  type ExpiredOrganizationInvitation,
  type OrganizationInvitation,
  type IssuedOrganizationInvitation,
  type OrganizationMembershipWithAccess,
  type InviteOrganizationMemberRequest,
  type ChangeOrganizationMembershipRoleRequest,
} from '@seams-internal/console-shared/accountPlatform';
import type {
  OrganizationAdminPermission,
  ProjectAccessLevel,
  OrganizationMembershipKind,
  OrganizationInvitationKind,
  ProjectAccessAssignment,
} from '@seams-internal/console-shared/accountPlatform';

export interface OrganizationOwnerEvent {
  readonly id: string;
  readonly orgId: string;
  readonly membershipId: string;
  readonly ownerUserId: string;
  readonly actorUserId: string;
  readonly kind: 'OWNER_ADDED' | 'OWNER_REMOVED';
  readonly createdAt: string;
}

export type OrganizationAuthorization =
  | {
      readonly kind: 'authorized';
      readonly orgId: string;
      readonly userId: string;
      readonly membershipId: string;
      readonly role: 'OWNER';
      readonly authorizationVersion: number;
      readonly adminPermissions: readonly OrganizationAdminPermission[];
      readonly projectAccess: { readonly kind: 'all' };
    }
  | {
      readonly kind: 'authorized';
      readonly orgId: string;
      readonly userId: string;
      readonly membershipId: string;
      readonly role: 'ADMIN';
      readonly authorizationVersion: number;
      readonly adminPermissions: readonly OrganizationAdminPermission[];
      readonly projectAccess: { readonly kind: 'all' };
    }
  | {
      readonly kind: 'authorized';
      readonly orgId: string;
      readonly userId: string;
      readonly membershipId: string;
      readonly role: 'MEMBER';
      readonly authorizationVersion: number;
      readonly adminPermissions: readonly [];
      readonly projectAccess: {
        readonly kind: 'assigned';
        readonly assignments: readonly ProjectAccessAssignment[];
      };
    }
  | {
      readonly kind: 'denied';
      readonly orgId: string;
      readonly userId: string;
      readonly authorizationVersion: number;
      readonly reason: 'membership_not_found' | 'membership_suspended' | 'membership_removed';
      readonly membershipId: string | null;
      readonly role?: never;
      readonly adminPermissions?: never;
      readonly projectAccess?: never;
    };

export type ActiveOrganizationAuthorization = Extract<
  OrganizationAuthorization,
  { readonly kind: 'authorized' }
>;

export interface ListOrganizationMembershipsRequest {
  readonly kind: OrganizationMembershipKind | 'all';
}

export interface ListOrganizationInvitationsRequest {
  readonly kind: OrganizationInvitationKind | 'all';
}

export interface SetOrganizationAdminPermissionsRequest {
  readonly permissions: readonly OrganizationAdminPermission[];
}

export interface SetProjectMemberAccessRequest {
  readonly accessLevel: ProjectAccessLevel;
}

export interface RedeemOrganizationInvitationRequest {
  readonly token: string;
}
