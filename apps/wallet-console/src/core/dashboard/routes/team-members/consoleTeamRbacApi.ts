import {
  buildConsoleAcceptHeaders,
  buildConsoleJsonHeaders,
  consoleErrorMessage,
  normalizeConsoleFetchError,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '../../consoleHttp';

export const DASHBOARD_ORGANIZATION_ADMIN_PERMISSIONS = [
  'members.manage',
  'projects.manage',
  'billing.view',
  'billing.manage',
] as const;

export type DashboardOrganizationRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type DashboardOrganizationMembershipKind = 'active' | 'suspended' | 'removed';
export type DashboardOrganizationInvitationKind =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'expired';
export type DashboardOrganizationAdminPermission =
  (typeof DASHBOARD_ORGANIZATION_ADMIN_PERMISSIONS)[number];
export type DashboardProjectAccessLevel = 'viewer' | 'editor';

export interface DashboardProjectAccessAssignment {
  projectId: string;
  accessLevel: DashboardProjectAccessLevel;
}

export interface DashboardOrganizationMembership {
  id: string;
  orgId: string;
  userId: string;
  email: string;
  displayName: string | null;
  kind: DashboardOrganizationMembershipKind;
  role: DashboardOrganizationRole;
  adminPermissions: DashboardOrganizationAdminPermission[];
  projectAccess: DashboardProjectAccessAssignment[];
  createdAt: string;
  updatedAt: string;
  suspendedAt: string | null;
  removedAt: string | null;
}

export interface DashboardOrganizationInvitation {
  id: string;
  orgId: string;
  email: string;
  invitedByUserId: string;
  kind: DashboardOrganizationInvitationKind;
  role: DashboardOrganizationRole;
  adminPermissions: DashboardOrganizationAdminPermission[];
  projectAccess: DashboardProjectAccessAssignment[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export type DashboardOrganizationGrant =
  | {
      role: 'OWNER';
    }
  | {
      role: 'ADMIN';
      adminPermissions: DashboardOrganizationAdminPermission[];
    }
  | {
      role: 'MEMBER';
      projectAccess: DashboardProjectAccessAssignment[];
    };

const TEAM_MEMBERSHIP_IDENTITY_FIELDS = [
  'id',
  'orgId',
  'userId',
  'email',
  'displayName',
  'createdAt',
  'updatedAt',
] as const;
const TEAM_MEMBERSHIP_RESPONSE_FIELDS = [
  'membership',
  'adminPermissions',
  'projectAccess',
] as const;
const TEAM_INVITATION_IDENTITY_FIELDS = [
  'id',
  'orgId',
  'email',
  'invitedByUserId',
  'createdAt',
  'updatedAt',
] as const;

function teamPlainObject(raw: unknown): object | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function teamOwnValue(raw: object, key: string): unknown {
  return Reflect.get(raw, key);
}

function teamExactObject(raw: unknown, expectedKeys: readonly string[]): object | null {
  const object = teamPlainObject(raw);
  if (!object) return null;
  const actualKeys = Object.keys(object);
  if (actualKeys.length !== expectedKeys.length) return null;
  return actualKeys.every((key) => expectedKeys.includes(key)) ? object : null;
}

function teamReadString(raw: unknown): string | null {
  return typeof raw === 'string' ? raw.trim() : null;
}

function teamReadNullableString(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  const value = teamReadString(raw);
  return value === null ? undefined : value || null;
}

function readRole(raw: unknown): DashboardOrganizationRole | null {
  const role = teamReadString(raw);
  if (role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER') return role;
  return null;
}

function readMembershipKind(raw: unknown): DashboardOrganizationMembershipKind | null {
  const kind = teamReadString(raw);
  if (kind === 'active' || kind === 'suspended' || kind === 'removed') return kind;
  return null;
}

function readInvitationKind(raw: unknown): DashboardOrganizationInvitationKind | null {
  const kind = teamReadString(raw);
  switch (kind) {
    case 'pending':
    case 'accepted':
    case 'declined':
    case 'revoked':
    case 'expired':
      return kind;
    default:
      return null;
  }
}

function readAdminPermission(raw: unknown): DashboardOrganizationAdminPermission | null {
  const permission = teamReadString(raw);
  for (const supported of DASHBOARD_ORGANIZATION_ADMIN_PERMISSIONS) {
    if (permission === supported) return supported;
  }
  return null;
}

function decodeAdminPermissions(raw: unknown): DashboardOrganizationAdminPermission[] | null {
  if (!Array.isArray(raw)) return null;
  const permissions = new Set<DashboardOrganizationAdminPermission>();
  for (const entry of raw) {
    const permission = readAdminPermission(entry);
    if (!permission || permissions.has(permission)) return null;
    permissions.add(permission);
  }
  if (permissions.has('billing.manage')) permissions.add('billing.view');
  return DASHBOARD_ORGANIZATION_ADMIN_PERMISSIONS.filter((permission) =>
    permissions.has(permission),
  );
}

function normalizeAdminPermissions(
  permissions: readonly DashboardOrganizationAdminPermission[],
): DashboardOrganizationAdminPermission[] {
  const normalized = new Set(permissions);
  if (normalized.has('billing.manage')) normalized.add('billing.view');
  return DASHBOARD_ORGANIZATION_ADMIN_PERMISSIONS.filter((permission) =>
    normalized.has(permission),
  );
}

function normalizeProjectAccess(
  assignments: readonly DashboardProjectAccessAssignment[],
): DashboardProjectAccessAssignment[] {
  const normalized = new Map<string, DashboardProjectAccessAssignment>();
  for (const assignment of assignments) {
    const projectId = assignment.projectId.trim();
    normalized.set(projectId, {
      projectId,
      accessLevel: assignment.accessLevel,
    });
  }
  return Array.from(normalized.values()).sort((left, right) =>
    left.projectId.localeCompare(right.projectId),
  );
}

function readProjectAccessLevel(raw: unknown): DashboardProjectAccessLevel | null {
  const accessLevel = teamReadString(raw);
  if (accessLevel === 'viewer' || accessLevel === 'editor') return accessLevel;
  return null;
}

const TEAM_PROJECT_ACCESS_ASSIGNMENT_FIELDS = ['projectId', 'accessLevel'] as const;

function decodeProjectAccess(raw: unknown): DashboardProjectAccessAssignment[] | null {
  if (!Array.isArray(raw)) return null;
  const assignments = new Map<string, DashboardProjectAccessAssignment>();
  for (const entry of raw) {
    const assignment = teamExactObject(entry, TEAM_PROJECT_ACCESS_ASSIGNMENT_FIELDS);
    if (!assignment) return null;
    const projectId = teamReadString(teamOwnValue(assignment, 'projectId'));
    const accessLevel = readProjectAccessLevel(teamOwnValue(assignment, 'accessLevel'));
    if (!projectId || !accessLevel || assignments.has(projectId)) return null;
    assignments.set(projectId, { projectId, accessLevel });
  }
  return Array.from(assignments.values()).sort((left, right) =>
    left.projectId.localeCompare(right.projectId),
  );
}

function membershipFields(kind: DashboardOrganizationMembershipKind): readonly string[] {
  return kind === 'active'
    ? [...TEAM_MEMBERSHIP_IDENTITY_FIELDS, 'kind', 'role']
    : [
        ...TEAM_MEMBERSHIP_IDENTITY_FIELDS,
        'kind',
        'role',
        kind === 'suspended' ? 'suspendedAt' : 'removedAt',
      ];
}

function decodeMembership(raw: unknown): DashboardOrganizationMembership | null {
  const response = teamExactObject(raw, TEAM_MEMBERSHIP_RESPONSE_FIELDS);
  if (!response) return null;
  const source = teamPlainObject(teamOwnValue(response, 'membership'));
  if (!source) return null;
  const kind = readMembershipKind(teamOwnValue(source, 'kind'));
  const role = readRole(teamOwnValue(source, 'role'));
  if (!kind || !role || !teamExactObject(source, membershipFields(kind))) return null;
  if (kind !== 'active' && role === 'OWNER') return null;

  const id = teamReadString(teamOwnValue(source, 'id'));
  const orgId = teamReadString(teamOwnValue(source, 'orgId'));
  const userId = teamReadString(teamOwnValue(source, 'userId'));
  const email = teamReadString(teamOwnValue(source, 'email'));
  const displayName = teamReadNullableString(teamOwnValue(source, 'displayName'));
  const createdAt = teamReadString(teamOwnValue(source, 'createdAt'));
  const updatedAt = teamReadString(teamOwnValue(source, 'updatedAt'));
  const adminPermissions = decodeAdminPermissions(teamOwnValue(response, 'adminPermissions'));
  const projectAccess = decodeProjectAccess(teamOwnValue(response, 'projectAccess'));
  if (
    !id ||
    !orgId ||
    !userId ||
    !email ||
    displayName === undefined ||
    createdAt === null ||
    updatedAt === null ||
    !adminPermissions ||
    !projectAccess ||
    (role !== 'ADMIN' && adminPermissions.length !== 0) ||
    (role !== 'MEMBER' && projectAccess.length !== 0)
  ) {
    return null;
  }
  if (kind === 'active') {
    return {
      id,
      orgId,
      userId,
      email,
      displayName,
      kind,
      role,
      adminPermissions,
      projectAccess,
      createdAt,
      updatedAt,
      suspendedAt: null,
      removedAt: null,
    };
  }
  if (kind === 'suspended') {
    const suspendedAt = teamReadString(teamOwnValue(source, 'suspendedAt'));
    if (!suspendedAt) return null;
    return {
      id,
      orgId,
      userId,
      email,
      displayName,
      kind,
      role,
      adminPermissions,
      projectAccess,
      createdAt,
      updatedAt,
      suspendedAt,
      removedAt: null,
    };
  }
  const removedAt = teamReadString(teamOwnValue(source, 'removedAt'));
  if (!removedAt) return null;
  return {
    id,
    orgId,
    userId,
    email,
    displayName,
    kind,
    role,
    adminPermissions,
    projectAccess,
    createdAt,
    updatedAt,
    suspendedAt: null,
    removedAt,
  };
}

function invitationFields(
  kind: DashboardOrganizationInvitationKind,
  role: DashboardOrganizationRole,
): readonly string[] {
  const grantFields =
    role === 'OWNER' ? [] : [role === 'ADMIN' ? 'adminPermissions' : 'projectAccess'];
  const stateField =
    kind === 'pending'
      ? 'expiresAt'
      : kind === 'accepted'
        ? 'membershipId'
        : kind === 'declined'
          ? 'declinedAt'
          : kind === 'revoked'
            ? 'revokedAt'
            : 'expiredAt';
  const acceptedFields = kind === 'accepted' ? ['acceptedAt'] : [];
  return [
    ...TEAM_INVITATION_IDENTITY_FIELDS,
    'kind',
    'role',
    ...grantFields,
    stateField,
    ...acceptedFields,
  ];
}

function decodeInvitation(raw: unknown): DashboardOrganizationInvitation | null {
  const source = teamPlainObject(raw);
  if (!source) return null;
  const kind = readInvitationKind(teamOwnValue(source, 'kind'));
  const role = readRole(teamOwnValue(source, 'role'));
  if (!kind || !role || !teamExactObject(source, invitationFields(kind, role))) return null;
  const id = teamReadString(teamOwnValue(source, 'id'));
  const orgId = teamReadString(teamOwnValue(source, 'orgId'));
  const email = teamReadString(teamOwnValue(source, 'email'));
  const invitedByUserId = teamReadString(teamOwnValue(source, 'invitedByUserId'));
  const createdAt = teamReadString(teamOwnValue(source, 'createdAt'));
  const updatedAt = teamReadString(teamOwnValue(source, 'updatedAt'));
  if (!id || !orgId || !email || !invitedByUserId || createdAt === null || updatedAt === null) {
    return null;
  }
  let adminPermissions: DashboardOrganizationAdminPermission[] = [];
  let projectAccess: DashboardProjectAccessAssignment[] = [];
  if (role === 'ADMIN') {
    const decodedPermissions = decodeAdminPermissions(teamOwnValue(source, 'adminPermissions'));
    if (!decodedPermissions) return null;
    adminPermissions = decodedPermissions;
  } else if (role === 'MEMBER') {
    const decodedProjectAccess = decodeProjectAccess(teamOwnValue(source, 'projectAccess'));
    if (!decodedProjectAccess) return null;
    projectAccess = decodedProjectAccess;
  }
  let expiresAt: string | null = null;
  if (kind === 'pending') {
    expiresAt = teamReadString(teamOwnValue(source, 'expiresAt'));
    if (!expiresAt) return null;
  } else if (kind === 'accepted') {
    if (
      !teamReadString(teamOwnValue(source, 'membershipId')) ||
      !teamReadString(teamOwnValue(source, 'acceptedAt'))
    ) {
      return null;
    }
  } else {
    const stateField =
      kind === 'declined' ? 'declinedAt' : kind === 'revoked' ? 'revokedAt' : 'expiredAt';
    if (!teamReadString(teamOwnValue(source, stateField))) return null;
  }
  return {
    id,
    orgId,
    email,
    invitedByUserId,
    kind,
    role,
    adminPermissions,
    projectAccess,
    createdAt,
    updatedAt,
    expiresAt,
  };
}

function normalizeGrant(grant: DashboardOrganizationGrant): DashboardOrganizationGrant {
  switch (grant.role) {
    case 'OWNER':
      return { role: grant.role };
    case 'ADMIN':
      return {
        role: grant.role,
        adminPermissions: normalizeAdminPermissions(grant.adminPermissions),
      };
    case 'MEMBER':
      return {
        role: grant.role,
        projectAccess: normalizeProjectAccess(grant.projectAccess),
      };
  }
}

interface ConsoleErrorResponse {
  readonly ok?: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly details?: unknown;
}

function parseConsoleErrorResponse(raw: unknown): ConsoleErrorResponse | null {
  const body = teamPlainObject(raw);
  if (!body) return null;
  const actualKeys = Object.keys(body);
  if (
    actualKeys.some(
      (key) => key !== 'ok' && key !== 'code' && key !== 'message' && key !== 'details',
    )
  ) {
    return null;
  }
  const ok = teamOwnValue(body, 'ok');
  const code = teamOwnValue(body, 'code');
  const message = teamOwnValue(body, 'message');
  if (
    (ok !== undefined && typeof ok !== 'boolean') ||
    (code !== undefined && typeof code !== 'string') ||
    (message !== undefined && typeof message !== 'string')
  ) {
    return null;
  }
  return {
    ...(ok === undefined ? {} : { ok }),
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
    ...(actualKeys.includes('details') ? { details: teamOwnValue(body, 'details') } : {}),
  };
}

function consoleSuccessPayload(raw: unknown, key: string): unknown | null {
  const body = teamExactObject(raw, ['ok', key]);
  return body && teamOwnValue(body, 'ok') === true ? teamOwnValue(body, key) : null;
}

async function consoleRequest(input: {
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  operation: string;
}): Promise<unknown> {
  const base = requireConsoleBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${input.path}`, {
      method: input.method,
      headers: input.body === undefined ? buildConsoleAcceptHeaders() : buildConsoleJsonHeaders(),
      credentials: 'include',
      cache: 'no-store',
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
  } catch (error: unknown) {
    throw normalizeConsoleFetchError({
      error,
      baseUrl: base,
      path: input.path,
      operation: input.operation,
    });
  }

  const rawBody: unknown = await parseConsoleJson(response);
  const body = parseConsoleErrorResponse(rawBody);
  const rawObject = teamPlainObject(rawBody);
  if (!response.ok || !rawObject || teamOwnValue(rawObject, 'ok') !== true) {
    throw new Error(consoleErrorMessage(response, body, `${input.operation} failed`));
  }
  return rawBody;
}

export async function listDashboardOrganizationMemberships(
  kind: DashboardOrganizationMembershipKind | 'all' = 'all',
): Promise<DashboardOrganizationMembership[]> {
  const query = kind === 'all' ? '' : `?kind=${encodeURIComponent(kind)}`;
  const body = await consoleRequest({
    path: `/console/organization/memberships${query}`,
    method: 'GET',
    operation: 'List organization memberships',
  });
  const memberships = consoleSuccessPayload(body, 'memberships');
  if (!Array.isArray(memberships)) {
    throw new Error('List organization memberships response was invalid');
  }
  const membershipRows: unknown[] = memberships;
  const parsedMemberships: DashboardOrganizationMembership[] = [];
  for (const row of membershipRows) {
    const membership = decodeMembership(row);
    if (!membership) throw new Error('List organization memberships response was invalid');
    parsedMemberships.push(membership);
  }
  return parsedMemberships;
}

export async function listDashboardOrganizationInvitations(
  kind: DashboardOrganizationInvitationKind | 'all' = 'all',
): Promise<DashboardOrganizationInvitation[]> {
  const query = kind === 'all' ? '' : `?kind=${encodeURIComponent(kind)}`;
  const body = await consoleRequest({
    path: `/console/organization/invitations${query}`,
    method: 'GET',
    operation: 'List organization invitations',
  });
  const invitations = consoleSuccessPayload(body, 'invitations');
  if (!Array.isArray(invitations)) {
    throw new Error('List organization invitations response was invalid');
  }
  const invitationRows: unknown[] = invitations;
  const parsedInvitations: DashboardOrganizationInvitation[] = [];
  for (const row of invitationRows) {
    const invitation = decodeInvitation(row);
    if (!invitation) throw new Error('List organization invitations response was invalid');
    parsedInvitations.push(invitation);
  }
  return parsedInvitations;
}

export async function inviteDashboardOrganizationMember(
  input: { email: string } & DashboardOrganizationGrant,
): Promise<DashboardOrganizationInvitation> {
  const body = await consoleRequest({
    path: '/console/organization/invitations',
    method: 'POST',
    body: {
      email: input.email.trim().toLowerCase(),
      ...normalizeGrant(input),
    },
    operation: 'Invite organization member',
  });
  const invitation = decodeInvitation(consoleSuccessPayload(body, 'invitation'));
  if (!invitation) throw new Error('Invitation response was invalid');
  return invitation;
}

export async function resendDashboardOrganizationInvitation(
  invitationId: string,
): Promise<DashboardOrganizationInvitation> {
  const body = await consoleRequest({
    path: `/console/organization/invitations/${encodeURIComponent(invitationId)}/resend`,
    method: 'POST',
    body: {},
    operation: 'Resend organization invitation',
  });
  const invitation = decodeInvitation(consoleSuccessPayload(body, 'invitation'));
  if (!invitation) throw new Error('Resend invitation response was invalid');
  return invitation;
}

export async function revokeDashboardOrganizationInvitation(
  invitationId: string,
): Promise<DashboardOrganizationInvitation> {
  const body = await consoleRequest({
    path: `/console/organization/invitations/${encodeURIComponent(invitationId)}`,
    method: 'DELETE',
    operation: 'Revoke organization invitation',
  });
  const invitation = decodeInvitation(consoleSuccessPayload(body, 'invitation'));
  if (!invitation) throw new Error('Revoke invitation response was invalid');
  return invitation;
}

export async function changeDashboardOrganizationMembershipRole(
  membershipId: string,
  grant: DashboardOrganizationGrant,
): Promise<DashboardOrganizationMembership> {
  const body = await consoleRequest({
    path: `/console/organization/memberships/${encodeURIComponent(membershipId)}/change-role`,
    method: 'POST',
    body: normalizeGrant(grant),
    operation: 'Change organization membership role',
  });
  const membership = decodeMembership(consoleSuccessPayload(body, 'membership'));
  if (!membership) throw new Error('Change role response was invalid');
  return membership;
}

export async function setDashboardOrganizationAdminPermissions(
  membershipId: string,
  permissions: DashboardOrganizationAdminPermission[],
): Promise<DashboardOrganizationMembership> {
  const body = await consoleRequest({
    path: `/console/organization/memberships/${encodeURIComponent(membershipId)}/admin-permissions`,
    method: 'PATCH',
    body: { permissions: normalizeAdminPermissions(permissions) },
    operation: 'Update administrator permissions',
  });
  const membership = decodeMembership(consoleSuccessPayload(body, 'membership'));
  if (!membership) throw new Error('Administrator permission response was invalid');
  return membership;
}

export async function suspendDashboardOrganizationMembership(
  membershipId: string,
): Promise<DashboardOrganizationMembership> {
  const body = await consoleRequest({
    path: `/console/organization/memberships/${encodeURIComponent(membershipId)}/suspend`,
    method: 'POST',
    body: {},
    operation: 'Suspend organization membership',
  });
  const membership = decodeMembership(consoleSuccessPayload(body, 'membership'));
  if (!membership) throw new Error('Suspend membership response was invalid');
  return membership;
}

export async function reactivateDashboardOrganizationMembership(
  membershipId: string,
): Promise<DashboardOrganizationMembership> {
  const body = await consoleRequest({
    path: `/console/organization/memberships/${encodeURIComponent(membershipId)}/reactivate`,
    method: 'POST',
    body: {},
    operation: 'Reactivate organization membership',
  });
  const membership = decodeMembership(consoleSuccessPayload(body, 'membership'));
  if (!membership) throw new Error('Reactivate membership response was invalid');
  return membership;
}

export async function removeDashboardOrganizationMembership(
  membershipId: string,
): Promise<DashboardOrganizationMembership> {
  const body = await consoleRequest({
    path: `/console/organization/memberships/${encodeURIComponent(membershipId)}`,
    method: 'DELETE',
    operation: 'Remove organization membership',
  });
  const membership = decodeMembership(consoleSuccessPayload(body, 'membership'));
  if (!membership) throw new Error('Remove membership response was invalid');
  return membership;
}

export async function setDashboardProjectMemberAccess(input: {
  projectId: string;
  membershipId: string;
  accessLevel: DashboardProjectAccessLevel;
}): Promise<DashboardOrganizationMembership> {
  const body = await consoleRequest({
    path:
      `/console/organization/projects/${encodeURIComponent(input.projectId)}` +
      `/members/${encodeURIComponent(input.membershipId)}`,
    method: 'PUT',
    body: { accessLevel: input.accessLevel },
    operation: 'Set project member access',
  });
  const membership = decodeMembership(consoleSuccessPayload(body, 'membership'));
  if (!membership) throw new Error('Project access response was invalid');
  return membership;
}

export async function removeDashboardProjectMemberAccess(input: {
  projectId: string;
  membershipId: string;
}): Promise<DashboardOrganizationMembership> {
  const body = await consoleRequest({
    path:
      `/console/organization/projects/${encodeURIComponent(input.projectId)}` +
      `/members/${encodeURIComponent(input.membershipId)}`,
    method: 'DELETE',
    operation: 'Remove project member access',
  });
  const membership = decodeMembership(consoleSuccessPayload(body, 'membership'));
  if (!membership) throw new Error('Project access removal response was invalid');
  return membership;
}

export async function leaveDashboardOrganization(): Promise<void> {
  const body = await consoleRequest({
    path: '/console/organization/leave',
    method: 'POST',
    body: {},
    operation: 'Leave organization',
  });
  if (!decodeMembership(consoleSuccessPayload(body, 'membership'))) {
    throw new Error('Leave organization response was invalid');
  }
}
