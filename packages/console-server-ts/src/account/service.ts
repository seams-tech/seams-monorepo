import { generateConsoleOrganizationId } from '@seams-internal/console-shared/organizationIdentity';
import type {
  ConsoleOrgProjectContext,
  ConsoleOrgProjectService,
  ConsoleOrganization,
} from '../orgProjectEnv';
import type {
  ActiveOrganizationAuthorization,
  ConsoleOrganizationAccessService,
  OrganizationMembershipWithAccess,
} from '../teamRbac';
import { ConsoleAccountError } from './errors';
import type {
  ConsoleAccountOrganizationAccess,
  ConsoleAccountProfile,
  ConsoleAccountOrganization,
  CreateConsoleAccountOrganizationRequest,
  DeleteConsoleAccountOrganizationResult,
  PatchConsoleAccountProfileRequest,
  SwitchConsoleAccountOrganizationContextResult,
  UpdateConsoleAccountOrganizationRequest,
} from './types';

export interface AccountOrganizationDeletionPort {
  assertOrganizationCanBeDeleted(ctx: { orgId: string; actorUserId: string }): Promise<void>;
}

interface ConsoleAccountIdentity {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly provider: string | null;
  readonly platformSupport: boolean;
  readonly environmentId?: never;
}

export type ConsoleAccountIdentityContext = ConsoleAccountIdentity &
  (
    | { readonly orgId: null; readonly projectId: null }
    | {
        readonly orgId: string;
        readonly projectId: string | null;
      }
  );

export type ConsoleAccountContext = Extract<
  ConsoleAccountIdentityContext,
  { readonly orgId: string }
> &
  ConsoleAccountOrganizationAccess;

export interface ConsoleAccountService {
  getProfile(ctx: ConsoleAccountIdentityContext): Promise<ConsoleAccountProfile>;
  updateProfile(
    ctx: ConsoleAccountIdentityContext,
    request: PatchConsoleAccountProfileRequest,
  ): Promise<ConsoleAccountProfile>;
  listOrganizations(ctx: ConsoleAccountIdentityContext): Promise<ConsoleAccountOrganization[]>;
  createOrganization(
    ctx: ConsoleAccountIdentityContext,
    request: CreateConsoleAccountOrganizationRequest,
  ): Promise<ConsoleAccountOrganization>;
  updateOrganization(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
    request: UpdateConsoleAccountOrganizationRequest,
  ): Promise<ConsoleAccountOrganization>;
  deleteOrganization(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<DeleteConsoleAccountOrganizationResult>;
  switchOrganizationContext(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<SwitchConsoleAccountOrganizationContextResult>;
}

export interface InMemoryConsoleAccountServiceOptions {
  readonly orgProjectEnv: ConsoleOrgProjectService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly deletion: AccountOrganizationDeletionPort;
  readonly now?: () => Date;
}

interface ProfileRecord {
  readonly displayName: string | null;
  readonly primaryEmail: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface BackupEmailRecord {
  readonly email: string;
  readonly status: 'PENDING' | 'VERIFIED';
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AccountOrganizationScope {
  readonly orgId: string;
  readonly projectId: string | null;
  readonly onboardingComplete: boolean;
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function defaultNow(): Date {
  return new Date();
}

function normalizeLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function accountError(code: string, status: number, message: string): ConsoleAccountError {
  return new ConsoleAccountError(code, status, message);
}

function compareBackupEmail(left: BackupEmailRecord, right: BackupEmailRecord): number {
  return left.email.localeCompare(right.email);
}

function compareOrganizationUpdatedAt(
  left: ConsoleAccountOrganization,
  right: ConsoleAccountOrganization,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function canEditPrimaryEmail(ctx: ConsoleAccountIdentityContext): boolean {
  return normalizeLower(ctx.provider) !== 'oidc';
}

function toOrgProjectEnvContext(
  ctx: ConsoleAccountIdentityContext,
  orgId: string,
): ConsoleOrgProjectContext {
  return {
    orgId,
    actorUserId: ctx.userId,
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
  };
}

function toOrganizationAccess(
  authorization: ActiveOrganizationAuthorization,
): ConsoleAccountOrganizationAccess {
  switch (authorization.role) {
    case 'OWNER':
      return {
        membershipId: authorization.membershipId,
        authorizationVersion: authorization.authorizationVersion,
        role: 'OWNER',
        adminPermissions: [...authorization.adminPermissions],
        projectAccess: { kind: 'all' },
      };
    case 'ADMIN':
      return {
        membershipId: authorization.membershipId,
        authorizationVersion: authorization.authorizationVersion,
        role: 'ADMIN',
        adminPermissions: [...authorization.adminPermissions],
        projectAccess: { kind: 'all' },
      };
    case 'MEMBER':
      return {
        membershipId: authorization.membershipId,
        authorizationVersion: authorization.authorizationVersion,
        role: 'MEMBER',
        adminPermissions: [],
        projectAccess: {
          kind: 'assigned',
          assignments: authorization.projectAccess.assignments.map((assignment) => ({
            projectId: assignment.projectId,
            accessLevel: assignment.accessLevel,
          })),
        },
      };
  }
}

function isOtherCurrentMembership(
  row: OrganizationMembershipWithAccess,
  actorUserId: string,
): boolean {
  return row.membership.kind !== 'removed' && row.membership.userId !== actorUserId;
}

function canUpdateOrganization(authorization: ActiveOrganizationAuthorization): boolean {
  if (authorization.role === 'OWNER') return true;
  if (authorization.role === 'MEMBER') return false;
  return authorization.adminPermissions.includes('projects.manage');
}

async function requireAuthorization(input: {
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly orgId: string;
  readonly userId: string;
}): Promise<ActiveOrganizationAuthorization> {
  const authorization = await input.organizationAccess.lookupAuthorization({
    orgId: input.orgId,
    userId: input.userId,
  });
  if (!authorization || authorization.kind === 'denied') {
    throw accountError(
      'forbidden',
      403,
      'You are not an active member of the selected organization',
    );
  }
  return authorization;
}

async function resolveOrganizationScope(input: {
  readonly ctx: ConsoleAccountIdentityContext;
  readonly orgId: string;
  readonly orgProjectEnv: ConsoleOrgProjectService;
}): Promise<AccountOrganizationScope> {
  const targetCtx = toOrgProjectEnvContext(input.ctx, input.orgId);
  const projects = await input.orgProjectEnv.listProjects(targetCtx, { status: 'ACTIVE' });
  const projectId =
    projects.find((project) => project.id === input.ctx.projectId)?.id ?? projects[0]?.id ?? null;
  return {
    orgId: input.orgId,
    projectId,
    onboardingComplete: Boolean(projectId),
  };
}

async function resolveSelectedScopeLabels(input: {
  readonly ctx: ConsoleAccountIdentityContext;
  readonly orgId: string;
  readonly orgProjectEnv: ConsoleOrgProjectService;
  readonly projectId: string | null;
}): Promise<{ readonly projectName: string | null }> {
  const targetCtx = toOrgProjectEnvContext(input.ctx, input.orgId);
  let projects = [];
  try {
    projects = await input.orgProjectEnv.listProjects(targetCtx, { status: 'ACTIVE' });
  } catch {
    return { projectName: null };
  }
  const project = input.projectId
    ? (projects.find((entry) => entry.id === input.projectId) ?? null)
    : null;
  return {
    projectName: normalizeString(project?.name) || null,
  };
}

class InMemoryConsoleAccountService implements ConsoleAccountService {
  readonly #options: InMemoryConsoleAccountServiceOptions;
  readonly #now: () => Date;
  readonly #profiles = new Map<string, ProfileRecord>();
  readonly #backupEmails = new Map<string, Map<string, BackupEmailRecord>>();

  constructor(options: InMemoryConsoleAccountServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? defaultNow;
  }

  async getProfile(ctx: ConsoleAccountIdentityContext): Promise<ConsoleAccountProfile> {
    return this.#buildProfile(ctx);
  }

  async updateProfile(
    ctx: ConsoleAccountIdentityContext,
    request: PatchConsoleAccountProfileRequest,
  ): Promise<ConsoleAccountProfile> {
    const updatedAt = this.#now().toISOString();
    const current = this.#profiles.get(ctx.userId);
    if (request.primaryEmail && !canEditPrimaryEmail(ctx)) {
      throw accountError(
        'primary_email_read_only',
        403,
        'Primary email is managed by your identity provider',
      );
    }
    if (request.displayName || request.primaryEmail) {
      this.#profiles.set(ctx.userId, {
        displayName: request.displayName
          ? normalizeString(request.displayName)
          : (current?.displayName ?? null),
        primaryEmail: request.primaryEmail
          ? normalizeLower(request.primaryEmail)
          : (current?.primaryEmail ?? null),
        createdAt: current?.createdAt ?? updatedAt,
        updatedAt,
      });
    }
    const backupStore = this.#requireBackupStore(ctx.userId);
    if (request.addBackupEmail) {
      const email = normalizeLower(request.addBackupEmail);
      const existing = backupStore.get(email);
      backupStore.set(email, {
        email,
        status: existing?.status ?? 'PENDING',
        createdAt: existing?.createdAt ?? updatedAt,
        updatedAt,
      });
    }
    if (request.removeBackupEmail) {
      backupStore.delete(normalizeLower(request.removeBackupEmail));
    }
    return this.#buildProfile(ctx);
  }

  async listOrganizations(
    ctx: ConsoleAccountIdentityContext,
  ): Promise<ConsoleAccountOrganization[]> {
    const storedOrganizations = await this.#options.orgProjectEnv.searchOrganizations({
      query: '',
      limit: Number.MAX_SAFE_INTEGER,
    });
    const organizations: ConsoleAccountOrganization[] = [];
    for (const storedOrganization of storedOrganizations) {
      try {
        organizations.push(await this.#requireOrganization(ctx, storedOrganization.id));
      } catch (error: unknown) {
        if (!(error instanceof ConsoleAccountError) || error.code !== 'forbidden') throw error;
      }
    }
    return organizations.sort(compareOrganizationUpdatedAt);
  }

  async createOrganization(
    ctx: ConsoleAccountIdentityContext,
    request: CreateConsoleAccountOrganizationRequest,
  ): Promise<ConsoleAccountOrganization> {
    const orgId = normalizeString(request.id) || generateConsoleOrganizationId();
    const targetCtx = toOrgProjectEnvContext(ctx, orgId);
    try {
      await this.#options.orgProjectEnv.getOrganization(targetCtx);
      throw accountError(
        'organization_already_exists',
        409,
        `Organization ${orgId} already exists`,
      );
    } catch (error: unknown) {
      if (error instanceof ConsoleAccountError) throw error;
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'organization_not_found'
      ) {
        throw error;
      }
    }

    await this.#options.orgProjectEnv.upsertOrganization(targetCtx, {
      name: request.name,
      ...(request.slug ? { slug: request.slug } : {}),
    });
    await this.#options.organizationAccess.bootstrapInitialOwner({
      orgId,
      userId: ctx.userId,
      email: ctx.email,
      displayName: ctx.name,
    });
    return this.#requireOrganization(ctx, orgId);
  }

  async updateOrganization(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
    request: UpdateConsoleAccountOrganizationRequest,
  ): Promise<ConsoleAccountOrganization> {
    const authorization = await requireAuthorization({
      organizationAccess: this.#options.organizationAccess,
      orgId,
      userId: ctx.userId,
    });
    if (!canUpdateOrganization(authorization)) {
      throw accountError(
        'forbidden',
        403,
        'Organization settings require owner access or projects.manage permission',
      );
    }
    await this.#options.orgProjectEnv.upsertOrganization(
      toOrgProjectEnvContext(ctx, orgId),
      request,
    );
    return this.#requireOrganization(ctx, orgId);
  }

  async deleteOrganization(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<DeleteConsoleAccountOrganizationResult> {
    const current = await this.#assertOrganizationDeletionAllowed(ctx, orgId);
    await this.#options.organizationAccess.purgeOrganization(orgId);
    const deleted = await this.#options.orgProjectEnv.deleteOrganization(
      toOrgProjectEnvContext(ctx, orgId),
    );
    if (!deleted.deleted) {
      throw accountError('organization_not_found', 404, `Organization ${orgId} was not found`);
    }
    return { orgId, organizationName: current.name };
  }

  async switchOrganizationContext(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<SwitchConsoleAccountOrganizationContextResult> {
    const authorization = await requireAuthorization({
      organizationAccess: this.#options.organizationAccess,
      orgId,
      userId: ctx.userId,
    });
    const scope = await resolveOrganizationScope({
      ctx,
      orgId,
      orgProjectEnv: this.#options.orgProjectEnv,
    });
    return {
      orgId,
      projectId: scope.projectId,
      onboardingComplete: scope.onboardingComplete,
      platformSupport: ctx.platformSupport,
      ...toOrganizationAccess(authorization),
    };
  }

  #requireBackupStore(userId: string): Map<string, BackupEmailRecord> {
    const existing = this.#backupEmails.get(userId);
    if (existing) return existing;
    const created = new Map<string, BackupEmailRecord>();
    this.#backupEmails.set(userId, created);
    return created;
  }

  #buildProfile(ctx: ConsoleAccountIdentityContext): ConsoleAccountProfile {
    const fallbackTimestamp = this.#now().toISOString();
    const profile = this.#profiles.get(ctx.userId);
    const backupStore = this.#backupEmails.get(ctx.userId);
    return {
      userId: ctx.userId,
      displayName: profile?.displayName || ctx.name || ctx.userId,
      primaryEmail: profile?.primaryEmail || normalizeLower(ctx.email),
      canEditPrimaryEmail: canEditPrimaryEmail(ctx),
      backupEmails: Array.from(backupStore?.values() ?? [])
        .sort(compareBackupEmail)
        .map((entry) => ({
          email: entry.email,
          status: entry.status,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })),
      createdAt: profile?.createdAt ?? fallbackTimestamp,
      updatedAt: profile?.updatedAt ?? fallbackTimestamp,
    };
  }

  async #requireOrganization(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<ConsoleAccountOrganization> {
    const authorization = await requireAuthorization({
      organizationAccess: this.#options.organizationAccess,
      orgId,
      userId: ctx.userId,
    });
    let organization: ConsoleOrganization;
    try {
      organization = await this.#options.orgProjectEnv.getOrganization(
        toOrgProjectEnvContext(ctx, orgId),
      );
    } catch {
      throw accountError('organization_not_found', 404, `Organization ${orgId} was not found`);
    }
    const scope = await resolveOrganizationScope({
      ctx,
      orgId,
      orgProjectEnv: this.#options.orgProjectEnv,
    });
    const labels = await resolveSelectedScopeLabels({
      ctx,
      orgId,
      orgProjectEnv: this.#options.orgProjectEnv,
      projectId: scope.projectId,
    });
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      isCurrentOrg: organization.id === ctx.orgId,
      onboardingComplete: scope.onboardingComplete,
      selectedProjectId: scope.projectId,
      selectedProjectName: labels.projectName,
      ...toOrganizationAccess(authorization),
    };
  }

  async #assertOrganizationDeletionAllowed(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<ConsoleAccountOrganization> {
    const current = await this.#requireOrganization(ctx, orgId);
    if (current.role !== 'OWNER') {
      throw accountError('forbidden', 403, 'Only an owner can delete an organization');
    }
    if (orgId === ctx.orgId) {
      throw accountError(
        'organization_current_context_active',
        409,
        'Switch to a different organization before deleting this one',
      );
    }
    const memberships = await this.#options.organizationAccess.listMemberships(
      { orgId, actorUserId: ctx.userId },
      { kind: 'all' },
    );
    if (memberships.some((row) => isOtherCurrentMembership(row, ctx.userId))) {
      throw accountError(
        'organization_delete_has_other_members',
        409,
        'Remove all other organization members before deleting this organization',
      );
    }
    await this.#options.deletion.assertOrganizationCanBeDeleted({ orgId, actorUserId: ctx.userId });
    return current;
  }
}

export function createInMemoryConsoleAccountService(
  options: InMemoryConsoleAccountServiceOptions,
): ConsoleAccountService {
  return new InMemoryConsoleAccountService(options);
}
