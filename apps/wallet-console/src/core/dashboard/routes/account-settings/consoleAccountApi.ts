import {
  buildConsoleAcceptHeaders,
  buildConsoleJsonHeaders,
  consoleErrorMessage,
  fetchConsoleEndpoint,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '../../consoleHttp';

export interface DashboardAccountBackupEmail {
  email: string;
  status: 'PENDING' | 'VERIFIED';
  createdAt: string;
  updatedAt: string;
}

export interface DashboardAccountProfile {
  userId: string;
  displayName: string;
  primaryEmail: string;
  canEditPrimaryEmail: boolean;
  backupEmails: DashboardAccountBackupEmail[];
  createdAt: string;
  updatedAt: string;
}

export type DashboardAccountAdminPermission =
  | 'members.manage'
  | 'projects.manage'
  | 'billing.view'
  | 'billing.manage';

export interface DashboardAccountProjectAccessAssignment {
  projectId: string;
  accessLevel: 'viewer' | 'editor';
}

type DashboardAccountOrganizationAccess =
  | {
      membershipId: string;
      authorizationVersion: number;
      role: 'OWNER';
      adminPermissions: DashboardAccountAdminPermission[];
      projectAccess: { kind: 'all' };
    }
  | {
      membershipId: string;
      authorizationVersion: number;
      role: 'ADMIN';
      adminPermissions: DashboardAccountAdminPermission[];
      projectAccess: { kind: 'all' };
    }
  | {
      membershipId: string;
      authorizationVersion: number;
      role: 'MEMBER';
      adminPermissions: [];
      projectAccess: {
        kind: 'assigned';
        assignments: DashboardAccountProjectAccessAssignment[];
      };
    };

interface DashboardAccountOrganizationIdentity {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  isCurrentOrg: boolean;
  onboardingComplete: boolean;
  selectedProjectId: string | null;
  selectedProjectName: string | null;
  selectedEnvironmentId: string | null;
  selectedEnvironmentName: string | null;
}

export type DashboardAccountOrganization = DashboardAccountOrganizationIdentity &
  DashboardAccountOrganizationAccess;

interface DashboardSwitchOrganizationContextIdentity {
  orgId: string;
  projectId: string | null;
  environmentId: string | null;
  onboardingComplete: boolean;
  platformSupport: boolean;
}

export type DashboardSwitchOrganizationContextResult = DashboardSwitchOrganizationContextIdentity &
  DashboardAccountOrganizationAccess;

export interface DashboardAccountApiErrorBody {
  ok?: boolean;
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

export class DashboardAccountApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(input: { status: number; code?: unknown; message: string; details?: unknown }) {
    super(input.message);
    this.name = 'DashboardAccountApiError';
    this.status = input.status;
    this.code = String(input.code || '').trim();
    this.details = input.details;
  }
}

const ACCOUNT_BACKUP_EMAIL_FIELDS = ['email', 'status', 'createdAt', 'updatedAt'] as const;
const ACCOUNT_PROFILE_FIELDS = [
  'userId',
  'displayName',
  'primaryEmail',
  'canEditPrimaryEmail',
  'backupEmails',
  'createdAt',
  'updatedAt',
] as const;
const ACCOUNT_PROJECT_ASSIGNMENT_FIELDS = ['projectId', 'accessLevel'] as const;
const ACCOUNT_PROJECT_ACCESS_ALL_FIELDS = ['kind'] as const;
const ACCOUNT_PROJECT_ACCESS_ASSIGNED_FIELDS = ['kind', 'assignments'] as const;
const ACCOUNT_ACCESS_FIELDS = [
  'membershipId',
  'authorizationVersion',
  'role',
  'adminPermissions',
  'projectAccess',
] as const;
const ACCOUNT_ORGANIZATION_FIELDS = [
  'id',
  'name',
  'slug',
  'status',
  'createdAt',
  'updatedAt',
  'isCurrentOrg',
  'onboardingComplete',
  'selectedProjectId',
  'selectedProjectName',
  'selectedEnvironmentId',
  'selectedEnvironmentName',
  ...ACCOUNT_ACCESS_FIELDS,
] as const;
const ACCOUNT_SWITCH_CONTEXT_FIELDS = [
  'orgId',
  'projectId',
  'environmentId',
  'onboardingComplete',
  'platformSupport',
  ...ACCOUNT_ACCESS_FIELDS,
] as const;

function accountPlainObject(raw: unknown): object | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function accountOwnValue(raw: object, key: string): unknown {
  return Reflect.get(raw, key);
}

function accountExactObject(raw: unknown, expectedKeys: readonly string[]): object | null {
  const object = accountPlainObject(raw);
  if (!object) return null;
  const actualKeys = Object.keys(object);
  if (actualKeys.length !== expectedKeys.length) return null;
  return actualKeys.every((key) => expectedKeys.includes(key)) ? object : null;
}

function accountReadString(raw: unknown): string | null {
  return typeof raw === 'string' ? raw.trim() : null;
}

function accountReadNullableString(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  const value = accountReadString(raw);
  return value === null ? undefined : value || null;
}

function accountReadBoolean(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null;
}

function parseBackupEmail(raw: unknown): DashboardAccountBackupEmail | null {
  const entry = accountExactObject(raw, ACCOUNT_BACKUP_EMAIL_FIELDS);
  if (!entry) return null;
  const email = accountReadString(accountOwnValue(entry, 'email'))?.toLowerCase();
  const status = accountReadString(accountOwnValue(entry, 'status'))?.toUpperCase();
  const createdAt = accountReadString(accountOwnValue(entry, 'createdAt'));
  const updatedAt = accountReadString(accountOwnValue(entry, 'updatedAt'));
  if (
    !email ||
    (status !== 'PENDING' && status !== 'VERIFIED') ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }
  return { email, status, createdAt, updatedAt };
}

function parseProfile(raw: unknown): DashboardAccountProfile | null {
  const profile = accountExactObject(raw, ACCOUNT_PROFILE_FIELDS);
  if (!profile) return null;
  const userId = accountReadString(accountOwnValue(profile, 'userId'));
  const displayName = accountReadString(accountOwnValue(profile, 'displayName'));
  const primaryEmail = accountReadString(accountOwnValue(profile, 'primaryEmail'));
  const canEditPrimaryEmail = accountReadBoolean(accountOwnValue(profile, 'canEditPrimaryEmail'));
  const backupEmailsRaw = accountOwnValue(profile, 'backupEmails');
  const createdAt = accountReadString(accountOwnValue(profile, 'createdAt'));
  const updatedAt = accountReadString(accountOwnValue(profile, 'updatedAt'));
  if (
    !userId ||
    displayName === null ||
    primaryEmail === null ||
    canEditPrimaryEmail === null ||
    !Array.isArray(backupEmailsRaw) ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }
  const backupEmails: DashboardAccountBackupEmail[] = [];
  for (const entry of backupEmailsRaw) {
    const parsed = parseBackupEmail(entry);
    if (!parsed) return null;
    backupEmails.push(parsed);
  }
  return {
    userId,
    displayName,
    primaryEmail: primaryEmail.toLowerCase(),
    canEditPrimaryEmail,
    backupEmails,
    createdAt,
    updatedAt,
  };
}

function parseAdminPermissions(raw: unknown): DashboardAccountAdminPermission[] | null {
  if (!Array.isArray(raw)) return null;
  const permissions = new Set<DashboardAccountAdminPermission>();
  for (const entry of raw) {
    const permission = accountReadString(entry);
    if (permission === null) return null;
    let recognized: DashboardAccountAdminPermission;
    switch (permission) {
      case 'members.manage':
      case 'projects.manage':
      case 'billing.view':
      case 'billing.manage':
        recognized = permission;
        break;
      default:
        return null;
    }
    if (permissions.has(recognized)) return null;
    permissions.add(recognized);
  }
  if (permissions.has('billing.manage')) permissions.add('billing.view');
  const orderedPermissions: DashboardAccountAdminPermission[] = [
    'members.manage',
    'projects.manage',
    'billing.view',
    'billing.manage',
  ];
  return orderedPermissions.filter((permission) => permissions.has(permission));
}

function parseProjectAssignments(raw: unknown): DashboardAccountProjectAccessAssignment[] | null {
  if (!Array.isArray(raw)) return null;
  const assignments: DashboardAccountProjectAccessAssignment[] = [];
  const projectIds = new Set<string>();
  for (const entry of raw) {
    const assignment = accountExactObject(entry, ACCOUNT_PROJECT_ASSIGNMENT_FIELDS);
    if (!assignment) return null;
    const projectId = accountReadString(accountOwnValue(assignment, 'projectId'));
    const accessLevel = accountReadString(
      accountOwnValue(assignment, 'accessLevel'),
    )?.toLowerCase();
    if (
      !projectId ||
      projectIds.has(projectId) ||
      (accessLevel !== 'viewer' && accessLevel !== 'editor')
    ) {
      return null;
    }
    projectIds.add(projectId);
    assignments.push({ projectId, accessLevel });
  }
  return assignments;
}

function parseOrganizationAccess(raw: object): DashboardAccountOrganizationAccess | null {
  const membershipId = accountReadString(accountOwnValue(raw, 'membershipId'));
  const authorizationVersion = accountOwnValue(raw, 'authorizationVersion');
  const role = accountReadString(accountOwnValue(raw, 'role'));
  const adminPermissions = parseAdminPermissions(accountOwnValue(raw, 'adminPermissions'));
  const projectAccess = accountPlainObject(accountOwnValue(raw, 'projectAccess'));
  if (
    !membershipId ||
    typeof authorizationVersion !== 'number' ||
    !Number.isSafeInteger(authorizationVersion) ||
    authorizationVersion < 1 ||
    !role ||
    !adminPermissions ||
    !projectAccess
  ) {
    return null;
  }
  if (role === 'OWNER' || role === 'ADMIN') {
    const allAccess = accountExactObject(projectAccess, ACCOUNT_PROJECT_ACCESS_ALL_FIELDS);
    if (!allAccess || accountOwnValue(allAccess, 'kind') !== 'all') return null;
    if (role === 'OWNER') {
      return {
        membershipId,
        authorizationVersion,
        role: 'OWNER',
        adminPermissions,
        projectAccess: { kind: 'all' },
      };
    }
    return {
      membershipId,
      authorizationVersion,
      role: 'ADMIN',
      adminPermissions,
      projectAccess: { kind: 'all' },
    };
  }
  if (role !== 'MEMBER' || adminPermissions.length !== 0) return null;
  const assignedAccess = accountExactObject(projectAccess, ACCOUNT_PROJECT_ACCESS_ASSIGNED_FIELDS);
  if (!assignedAccess || accountOwnValue(assignedAccess, 'kind') !== 'assigned') return null;
  const assignments = parseProjectAssignments(accountOwnValue(assignedAccess, 'assignments'));
  if (!assignments) return null;
  return {
    membershipId,
    authorizationVersion,
    role: 'MEMBER',
    adminPermissions: [],
    projectAccess: { kind: 'assigned', assignments },
  };
}

function parseOrganization(raw: unknown): DashboardAccountOrganization | null {
  const organization = accountExactObject(raw, ACCOUNT_ORGANIZATION_FIELDS);
  if (!organization) return null;
  const id = accountReadString(accountOwnValue(organization, 'id'));
  const name = accountReadString(accountOwnValue(organization, 'name'));
  const slug = accountReadString(accountOwnValue(organization, 'slug'));
  const status = accountReadString(accountOwnValue(organization, 'status'));
  const createdAt = accountReadString(accountOwnValue(organization, 'createdAt'));
  const updatedAt = accountReadString(accountOwnValue(organization, 'updatedAt'));
  const isCurrentOrg = accountReadBoolean(accountOwnValue(organization, 'isCurrentOrg'));
  const onboardingComplete = accountReadBoolean(
    accountOwnValue(organization, 'onboardingComplete'),
  );
  const selectedProjectId = accountReadNullableString(
    accountOwnValue(organization, 'selectedProjectId'),
  );
  const selectedProjectName = accountReadNullableString(
    accountOwnValue(organization, 'selectedProjectName'),
  );
  const selectedEnvironmentId = accountReadNullableString(
    accountOwnValue(organization, 'selectedEnvironmentId'),
  );
  const selectedEnvironmentName = accountReadNullableString(
    accountOwnValue(organization, 'selectedEnvironmentName'),
  );
  const access = parseOrganizationAccess(organization);
  if (
    !id ||
    name === null ||
    slug === null ||
    status === null ||
    createdAt === null ||
    updatedAt === null ||
    isCurrentOrg === null ||
    onboardingComplete === null ||
    selectedProjectId === undefined ||
    selectedProjectName === undefined ||
    selectedEnvironmentId === undefined ||
    selectedEnvironmentName === undefined ||
    !access
  ) {
    return null;
  }
  return {
    id,
    name: name || id,
    slug,
    status: status || 'ACTIVE',
    createdAt,
    updatedAt,
    isCurrentOrg,
    onboardingComplete,
    selectedProjectId,
    selectedProjectName,
    selectedEnvironmentId,
    selectedEnvironmentName,
    ...access,
  };
}

function parseSwitchContext(raw: unknown): DashboardSwitchOrganizationContextResult | null {
  const context = accountExactObject(raw, ACCOUNT_SWITCH_CONTEXT_FIELDS);
  if (!context) return null;
  const orgId = accountReadString(accountOwnValue(context, 'orgId'));
  const projectId = accountReadNullableString(accountOwnValue(context, 'projectId'));
  const environmentId = accountReadNullableString(accountOwnValue(context, 'environmentId'));
  const onboardingComplete = accountReadBoolean(accountOwnValue(context, 'onboardingComplete'));
  const platformSupport = accountReadBoolean(accountOwnValue(context, 'platformSupport'));
  const access = parseOrganizationAccess(context);
  if (
    !orgId ||
    projectId === undefined ||
    environmentId === undefined ||
    onboardingComplete === null ||
    platformSupport === null ||
    !access
  ) {
    return null;
  }
  return {
    orgId,
    projectId,
    environmentId,
    onboardingComplete,
    platformSupport,
    ...access,
  };
}

function buildAccountApiError(
  response: Response,
  body: DashboardAccountApiErrorBody | null | undefined,
  fallbackPrefix: string,
): DashboardAccountApiError {
  return new DashboardAccountApiError({
    status: response.status,
    code: body?.code,
    message: consoleErrorMessage(response, body, fallbackPrefix),
    details: body?.details,
  });
}

function parseAccountApiErrorBody(raw: unknown): DashboardAccountApiErrorBody | null {
  const body = accountPlainObject(raw);
  if (!body) return null;
  const actualKeys = Object.keys(body);
  if (
    actualKeys.some(
      (key) => key !== 'ok' && key !== 'code' && key !== 'message' && key !== 'details',
    )
  ) {
    return null;
  }
  const ok = accountOwnValue(body, 'ok');
  const code = accountOwnValue(body, 'code');
  const message = accountOwnValue(body, 'message');
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
    ...(actualKeys.includes('details') ? { details: accountOwnValue(body, 'details') } : {}),
  };
}

function accountSuccessPayload(raw: unknown, key: string): unknown | null {
  const body = accountExactObject(raw, ['ok', key]);
  return body && accountOwnValue(body, 'ok') === true ? accountOwnValue(body, key) : null;
}

function parseDeletedOrganizationResponse(raw: unknown): boolean {
  const deleted = accountExactObject(accountSuccessPayload(raw, 'deleted'), [
    'orgId',
    'organizationName',
  ]);
  if (!deleted) return false;
  const orgId = accountReadString(accountOwnValue(deleted, 'orgId'));
  const organizationName = accountReadString(accountOwnValue(deleted, 'organizationName'));
  return Boolean(orgId && organizationName !== null);
}

function parseAccountLeaveResponse(raw: unknown): boolean {
  const response = accountExactObject(accountSuccessPayload(raw, 'membership'), [
    'membership',
    'adminPermissions',
    'projectAccess',
  ]);
  if (!response) return false;
  const membership = accountPlainObject(accountOwnValue(response, 'membership'));
  if (!membership) return false;
  const kind = accountReadString(accountOwnValue(membership, 'kind'));
  const role = accountReadString(accountOwnValue(membership, 'role'));
  if (kind !== 'removed' || (role !== 'ADMIN' && role !== 'MEMBER')) return false;
  if (
    !accountExactObject(membership, [
      'id',
      'orgId',
      'userId',
      'email',
      'displayName',
      'createdAt',
      'updatedAt',
      'kind',
      'role',
      'removedAt',
    ])
  ) {
    return false;
  }
  if (
    !accountReadString(accountOwnValue(membership, 'id')) ||
    !accountReadString(accountOwnValue(membership, 'orgId')) ||
    !accountReadString(accountOwnValue(membership, 'userId')) ||
    !accountReadString(accountOwnValue(membership, 'email')) ||
    accountReadNullableString(accountOwnValue(membership, 'displayName')) === undefined ||
    !accountReadString(accountOwnValue(membership, 'createdAt')) ||
    !accountReadString(accountOwnValue(membership, 'updatedAt')) ||
    !accountReadString(accountOwnValue(membership, 'removedAt'))
  ) {
    return false;
  }
  const adminPermissions = parseAdminPermissions(accountOwnValue(response, 'adminPermissions'));
  const projectAccess = parseProjectAssignments(accountOwnValue(response, 'projectAccess'));
  if (!adminPermissions || !projectAccess) return false;
  return role === 'ADMIN' ? projectAccess.length === 0 : adminPermissions.length === 0;
}

async function requestJson(
  path: string,
  init: RequestInit,
  fallbackPrefix: string,
): Promise<unknown> {
  const base = requireConsoleBaseUrl();
  const response = await fetchConsoleEndpoint(
    `${base}${path}`,
    {
      credentials: 'include',
      cache: 'no-store',
      ...init,
    },
    {
      baseUrl: base,
      path,
      operation: fallbackPrefix,
    },
  );
  const rawBody: unknown = await parseConsoleJson(response);
  const body = parseAccountApiErrorBody(rawBody);
  const rawObject = accountPlainObject(rawBody);
  if (!response.ok || !rawObject || accountOwnValue(rawObject, 'ok') !== true) {
    throw buildAccountApiError(response, body, fallbackPrefix);
  }
  return rawBody;
}

export function isDashboardAccountApiErrorCode(error: unknown, code: string): boolean {
  return error instanceof DashboardAccountApiError && error.code === code;
}

export async function getDashboardAccountProfile(): Promise<DashboardAccountProfile> {
  const body = await requestJson(
    '/console/account/profile',
    {
      method: 'GET',
      headers: buildConsoleAcceptHeaders(),
    },
    'Account profile request failed',
  );
  const profile = parseProfile(accountSuccessPayload(body, 'profile'));
  if (!profile) throw new Error('Account profile response was invalid');
  return profile;
}

export async function updateDashboardAccountProfile(input: {
  displayName?: string;
  primaryEmail?: string;
  addBackupEmail?: string;
  removeBackupEmail?: string;
}): Promise<DashboardAccountProfile> {
  const body = await requestJson(
    '/console/account/profile',
    {
      method: 'PATCH',
      headers: buildConsoleJsonHeaders(),
      body: JSON.stringify(input),
    },
    'Account profile update failed',
  );
  const profile = parseProfile(accountSuccessPayload(body, 'profile'));
  if (!profile) throw new Error('Account profile update response was invalid');
  return profile;
}

export async function listDashboardAccountOrganizations(): Promise<DashboardAccountOrganization[]> {
  const body = await requestJson(
    '/console/account/organizations',
    {
      method: 'GET',
      headers: buildConsoleAcceptHeaders(),
    },
    'Account organizations request failed',
  );
  const organizations = accountSuccessPayload(body, 'organizations');
  if (!Array.isArray(organizations)) {
    throw new Error('Account organizations response was invalid');
  }
  const parsedOrganizations: DashboardAccountOrganization[] = [];
  for (const entry of organizations) {
    const organization = parseOrganization(entry);
    if (!organization) throw new Error('Account organizations response was invalid');
    parsedOrganizations.push(organization);
  }
  return parsedOrganizations;
}

export async function createDashboardAccountOrganization(input: {
  id?: string;
  name: string;
  slug?: string;
}): Promise<DashboardAccountOrganization> {
  const body = await requestJson(
    '/console/account/organizations',
    {
      method: 'POST',
      headers: buildConsoleJsonHeaders(),
      body: JSON.stringify(input),
    },
    'Account organization create failed',
  );
  const organization = parseOrganization(accountSuccessPayload(body, 'organization'));
  if (!organization) throw new Error('Account organization create response was invalid');
  return organization;
}

export async function updateDashboardAccountOrganization(
  orgId: string,
  input: { name?: string; slug?: string },
): Promise<DashboardAccountOrganization> {
  const normalizedOrgId = accountReadString(orgId);
  if (!normalizedOrgId) throw new Error('Organization id is required');
  const body = await requestJson(
    `/console/account/organizations/${encodeURIComponent(normalizedOrgId)}`,
    {
      method: 'PATCH',
      headers: buildConsoleJsonHeaders(),
      body: JSON.stringify(input),
    },
    'Account organization update failed',
  );
  const organization = parseOrganization(accountSuccessPayload(body, 'organization'));
  if (!organization) throw new Error('Account organization update response was invalid');
  return organization;
}

export async function deleteDashboardAccountOrganization(orgId: string): Promise<void> {
  const normalizedOrgId = accountReadString(orgId);
  if (!normalizedOrgId) throw new Error('Organization id is required');
  const body = await requestJson(
    `/console/account/organizations/${encodeURIComponent(normalizedOrgId)}`,
    {
      method: 'DELETE',
      headers: buildConsoleAcceptHeaders(),
    },
    'Account organization delete failed',
  );
  if (!parseDeletedOrganizationResponse(body)) {
    throw new Error('Account organization delete response was invalid');
  }
}

export async function leaveDashboardAccountOrganization(): Promise<void> {
  const body = await requestJson(
    '/console/organization/leave',
    {
      method: 'POST',
      headers: buildConsoleJsonHeaders(),
      body: JSON.stringify({}),
    },
    'Leave organization failed',
  );
  if (!parseAccountLeaveResponse(body)) {
    throw new Error('Leave organization response was invalid');
  }
}

export async function switchDashboardAccountOrganizationContext(
  orgId: string,
): Promise<DashboardSwitchOrganizationContextResult> {
  const normalizedOrgId = accountReadString(orgId);
  if (!normalizedOrgId) throw new Error('Organization id is required');
  const body = await requestJson(
    `/console/account/organizations/${encodeURIComponent(normalizedOrgId)}/switch-context`,
    {
      method: 'POST',
      headers: buildConsoleJsonHeaders(),
      body: JSON.stringify({}),
    },
    'Account organization context switch failed',
  );
  const context = parseSwitchContext(accountSuccessPayload(body, 'context'));
  if (!context) throw new Error('Account organization context switch response was invalid');
  return context;
}
