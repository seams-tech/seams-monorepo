import type {
  ConsoleAccountContext,
  ConsoleAccountIdentityContext,
} from '../../packages/console-server-ts/src/account/service';
import type { ConsoleAuthClaims } from '../../packages/console-server-ts/src/router/consoleAuth';

const ownerClaims: ConsoleAuthClaims = {
  userId: 'owner',
  orgId: 'organization',
  membershipId: 'membership-owner',
  authorizationVersion: 1,
  role: 'OWNER',
  adminPermissions: ['members.manage', 'projects.manage', 'billing.view', 'billing.manage'],
  projectAccess: { kind: 'all' },
  platformSupport: false,
};
void ownerClaims;

const memberClaims: ConsoleAuthClaims = {
  userId: 'member',
  orgId: 'organization',
  membershipId: 'membership-member',
  authorizationVersion: 2,
  role: 'MEMBER',
  adminPermissions: [],
  projectAccess: {
    kind: 'assigned',
    assignments: [{ projectId: 'project', accessLevel: 'viewer' }],
  },
  platformSupport: false,
};
void memberClaims;

const memberWithAdminPermission: ConsoleAuthClaims = {
  userId: 'member',
  orgId: 'organization',
  membershipId: 'membership-member',
  authorizationVersion: 2,
  role: 'MEMBER',
  // @ts-expect-error Member claims cannot carry administrator permissions.
  adminPermissions: ['members.manage'],
  projectAccess: {
    kind: 'assigned',
    assignments: [],
  },
  platformSupport: false,
};
void memberWithAdminPermission;

const ownerWithAssignedProjectAccess: ConsoleAuthClaims = {
  userId: 'owner',
  orgId: 'organization',
  membershipId: 'membership-owner',
  authorizationVersion: 2,
  role: 'OWNER',
  adminPermissions: [],
  projectAccess: {
    kind: 'assigned',
    // @ts-expect-error Owner claims cannot carry assigned-only project access.
    assignments: [],
  },
  platformSupport: false,
};
void ownerWithAssignedProjectAccess;

// @ts-expect-error Account contexts require current organization authorization.
const accountWithoutAuthorization: ConsoleAccountContext = {
  userId: 'owner',
  orgId: 'organization',
  email: 'owner@example.com',
  name: 'Owner',
  provider: 'oidc',
  projectId: null,
  environmentId: null,
  platformSupport: false,
};
void accountWithoutAuthorization;

const verifiedAccount: ConsoleAccountIdentityContext = {
  userId: 'verified-user',
  email: 'verified@example.com',
  name: null,
  provider: 'google',
  platformSupport: false,
  orgId: null,
  projectId: null,
  environmentId: null,
};
// @ts-expect-error Verified identity alone grants no organization authorization.
const unscopedAuthorization: ConsoleAccountContext = verifiedAccount;
void unscopedAuthorization;
// @ts-expect-error An identity without an organization cannot carry a project.
const invalidIdentityScope: ConsoleAccountIdentityContext = {
  ...verifiedAccount,
  projectId: 'project',
};
void invalidIdentityScope;
// @ts-expect-error Copying organization permissions cannot authorize an unscoped account.
const invalidAuthorization: ConsoleAccountContext = { ...ownerClaims, ...verifiedAccount };
void invalidAuthorization;
