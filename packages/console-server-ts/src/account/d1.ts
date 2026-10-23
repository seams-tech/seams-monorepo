import { generateConsoleOrganizationId } from '@seams-internal/console-shared/organizationIdentity';
import {
  d1Number as toNumber,
  formatD1ExecStatement,
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
  type D1Row,
  type D1ResultLike,
} from '../boundary';
import type { ConsoleOrgProjectContext, ConsoleOrgProjectService } from '../orgProjectEnv';
import type {
  ActiveOrganizationAuthorization,
  ConsoleOrganizationAccessService,
  OrganizationMembershipWithAccess,
} from '../teamRbac';
import { ConsoleAccountError } from './errors';
import type {
  AccountOrganizationDeletionPort,
  ConsoleAccountIdentityContext,
  ConsoleAccountService,
} from './service';
import type {
  ConsoleAccountBackupEmail,
  ConsoleAccountOrganization,
  ConsoleAccountOrganizationAccess,
  ConsoleAccountProfile,
  CreateConsoleAccountOrganizationRequest,
  DeleteConsoleAccountOrganizationResult,
  PatchConsoleAccountProfileRequest,
  SwitchConsoleAccountOrganizationContextResult,
  UpdateConsoleAccountOrganizationRequest,
} from './types';

export const CONSOLE_ACCOUNT_D1_RUNTIME = Symbol('consoleAccountD1Runtime');

export interface ConsoleAccountD1Runtime {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly now: () => Date;
}

export type ConsoleAccountD1Service = ConsoleAccountService & {
  readonly [CONSOLE_ACCOUNT_D1_RUNTIME]: ConsoleAccountD1Runtime;
};

export interface D1ConsoleAccountSchemaOptions {
  readonly database: D1DatabaseLike;
}

export interface D1ConsoleAccountServiceOptions {
  readonly database: D1DatabaseLike;
  readonly namespace?: string;
  readonly ensureSchema?: boolean;
  readonly now?: () => Date;
  readonly orgProjectEnv: ConsoleOrgProjectService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly deletion: AccountOrganizationDeletionPort;
}

interface AccountOrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AccountOrganizationScope {
  readonly projectId: string | null;
  readonly onboardingComplete: boolean;
}

const OWNER_DELETE_SCOPE_SQL = `EXISTS (
  SELECT 1 FROM organizations AS deletion_organization
  JOIN organization_memberships AS deletion_owner
    ON deletion_owner.namespace = deletion_organization.namespace
   AND deletion_owner.org_id = deletion_organization.id
  WHERE deletion_organization.namespace = ?1
    AND deletion_organization.id = ?2
    AND deletion_organization.authorization_version = ?3
    AND deletion_owner.user_id = ?4
    AND deletion_owner.kind = 'ACTIVE'
    AND deletion_owner.role = 'OWNER'
)`;

// Pin service eligibility across the asynchronous product checks. Compare this
// snapshot inside the batch before removing any provisioning records.
const ORGANIZATION_SERVICE_SNAPSHOT_SQL = `SELECT json_array(
  (SELECT json_group_array(json_array(id, project_id, service_id, deployment_id,
    desired_revision, observed_revision, phase, desired_state, observed_state))
   FROM (SELECT * FROM platform_service_instances WHERE namespace = ?1 AND org_id = ?2 ORDER BY id)),
  (SELECT json_group_array(json_array(id, instance_id, status, desired_revision))
   FROM (SELECT * FROM platform_provision_operations WHERE namespace = ?1 AND org_id = ?2 ORDER BY id)),
  (SELECT json_group_array(json_array(instance_id, deployment_id, native_namespace,
    native_org_id, native_project_id, binding_json))
   FROM (SELECT b.* FROM wallet_service_bindings b
     JOIN platform_service_instances i ON i.namespace = b.namespace AND i.id = b.instance_id
     WHERE i.namespace = ?1 AND i.org_id = ?2 ORDER BY b.instance_id))
) AS snapshot`;

export const CONSOLE_ACCOUNT_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS user_profiles (
      namespace TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      primary_email TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, user_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS user_backup_emails (
      namespace TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      email_normalized TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, user_id, email_normalized),
      CHECK (status IN ('PENDING', 'VERIFIED'))
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS org_created_by_user_idx
      ON organizations (namespace, created_by_user_id, updated_at_ms DESC, created_at_ms DESC)
  `,
] as const);

export async function ensureConsoleAccountD1Schema(
  options: D1ConsoleAccountSchemaOptions,
): Promise<void> {
  for (const statement of CONSOLE_ACCOUNT_D1_SCHEMA_SQL) {
    await options.database.exec(formatD1ExecStatement(statement));
  }
}

export function getConsoleAccountD1Runtime(
  service: ConsoleAccountService | null | undefined,
): ConsoleAccountD1Runtime | null {
  if (!service || typeof service !== 'object') return null;
  return (service as Partial<ConsoleAccountD1Service>)[CONSOLE_ACCOUNT_D1_RUNTIME] ?? null;
}

function defaultNow(): Date {
  return new Date();
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function normalizeNamespace(value: string | undefined): string {
  return normalizeString(value) || 'default';
}

function accountError(code: string, status: number, message: string): ConsoleAccountError {
  return new ConsoleAccountError(code, status, message);
}

function rethrowOrganizationDeletionError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.includes('malformed JSON')) {
      throw accountError(
        'organization_delete_scope_changed',
        409,
        'Organization services changed before deletion; reload the account and retry',
      );
    }
    if (error.message.includes('platform_access_retained')) {
      throw accountError(
        'organization_delete_has_service_instances',
        409,
        'Service access history retains this organization',
      );
    }
    for (const code of [
      'organization_delete_has_other_members',
      'organization_delete_has_billing_history',
      'organization_delete_has_wallet_obligations',
      'organization_delete_has_service_instances',
    ]) {
      if (error.message.includes(code)) {
        throw accountError(
          code,
          409,
          'Organization records changed before deletion; reload the account and retry',
        );
      }
    }
  }
  throw error;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function canEditPrimaryEmail(ctx: ConsoleAccountIdentityContext): boolean {
  return normalizeLower(ctx.provider) !== 'oidc';
}

function compareOrganizationUpdatedAt(
  left: ConsoleAccountOrganization,
  right: ConsoleAccountOrganization,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function parseBackupEmailStatus(value: unknown): ConsoleAccountBackupEmail['status'] {
  const normalized = normalizeString(value);
  if (normalized === 'PENDING' || normalized === 'VERIFIED') return normalized;
  throw accountError('internal', 500, 'Stored backup email status is invalid');
}

function parseOrganizationRow(row: D1Row): AccountOrganizationRow {
  return {
    id: normalizeString(row.id),
    name: normalizeString(row.name) || normalizeString(row.id),
    slug: normalizeString(row.slug),
    status: normalizeString(row.status) || 'ACTIVE',
    createdAt: toIso(toNumber(row.created_at_ms)),
    updatedAt: toIso(toNumber(row.updated_at_ms)),
  };
}

function parseBackupEmailRow(row: D1Row): ConsoleAccountBackupEmail {
  return {
    email: normalizeLower(row.email),
    status: parseBackupEmailStatus(row.status),
    createdAt: toIso(toNumber(row.created_at_ms)),
    updatedAt: toIso(toNumber(row.updated_at_ms)),
  };
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

function canUpdateOrganization(authorization: ActiveOrganizationAuthorization): boolean {
  if (authorization.role === 'OWNER') return true;
  if (authorization.role === 'MEMBER') return false;
  return authorization.adminPermissions.includes('projects.manage');
}

function isOtherCurrentMembership(
  row: OrganizationMembershipWithAccess,
  actorUserId: string,
): boolean {
  return row.membership.kind !== 'removed' && row.membership.userId !== actorUserId;
}

async function getOrganizationById(
  service: D1ConsoleAccountServiceImpl,
  orgId: string,
): Promise<AccountOrganizationRow | null> {
  const row = await queryD1One(
    service.database,
    `SELECT id, name, slug, status, created_at_ms, updated_at_ms
       FROM organizations
      WHERE namespace = ?
        AND id = ?
      LIMIT 1`,
    [service.namespace, orgId],
  );
  return row ? parseOrganizationRow(row) : null;
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
  readonly service: D1ConsoleAccountServiceImpl;
  readonly ctx: ConsoleAccountIdentityContext;
  readonly orgId: string;
}): Promise<AccountOrganizationScope> {
  const targetCtx = toOrgProjectEnvContext(input.ctx, input.orgId);
  const projects = await input.service.orgProjectEnv.listProjects(targetCtx, {
    status: 'ACTIVE',
  });
  const projectId =
    projects.find((project) => project.id === input.ctx.projectId)?.id ?? projects[0]?.id ?? null;
  return {
    projectId,
    onboardingComplete: Boolean(projectId),
  };
}

async function resolveSelectedScopeLabels(input: {
  readonly service: D1ConsoleAccountServiceImpl;
  readonly ctx: ConsoleAccountIdentityContext;
  readonly orgId: string;
  readonly projectId: string | null;
}): Promise<{ readonly projectName: string | null }> {
  const targetCtx = toOrgProjectEnvContext(input.ctx, input.orgId);
  let projects = [];
  try {
    projects = await input.service.orgProjectEnv.listProjects(targetCtx, { status: 'ACTIVE' });
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

class D1ConsoleAccountServiceImpl implements ConsoleAccountD1Service {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly now: () => Date;
  readonly orgProjectEnv: ConsoleOrgProjectService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly deletion: AccountOrganizationDeletionPort;
  readonly [CONSOLE_ACCOUNT_D1_RUNTIME]: ConsoleAccountD1Runtime;

  constructor(options: D1ConsoleAccountServiceOptions) {
    this.database = options.database;
    this.namespace = normalizeNamespace(options.namespace);
    this.now = options.now ?? defaultNow;
    this.orgProjectEnv = options.orgProjectEnv;
    this.organizationAccess = options.organizationAccess;
    this.deletion = options.deletion;
    this[CONSOLE_ACCOUNT_D1_RUNTIME] = {
      database: this.database,
      namespace: this.namespace,
      now: this.now,
    };
  }

  async getProfile(ctx: ConsoleAccountIdentityContext): Promise<ConsoleAccountProfile> {
    const profileRow = await queryD1One(
      this.database,
      `SELECT *
         FROM user_profiles
        WHERE namespace = ?
          AND user_id = ?
        LIMIT 1`,
      [this.namespace, ctx.userId],
    );
    const emailRows = await queryD1All(
      this.database,
      `SELECT *
         FROM user_backup_emails
        WHERE namespace = ?
          AND user_id = ?
        ORDER BY email_normalized ASC`,
      [this.namespace, ctx.userId],
    );
    const fallbackTimestamp = this.now().toISOString();
    return {
      userId: ctx.userId,
      displayName: normalizeString(profileRow?.display_name) || ctx.name || ctx.userId,
      primaryEmail: normalizeLower(profileRow?.primary_email) || normalizeLower(ctx.email),
      canEditPrimaryEmail: canEditPrimaryEmail(ctx),
      backupEmails: emailRows.map(parseBackupEmailRow),
      createdAt: profileRow ? toIso(toNumber(profileRow.created_at_ms)) : fallbackTimestamp,
      updatedAt: profileRow ? toIso(toNumber(profileRow.updated_at_ms)) : fallbackTimestamp,
    };
  }

  async updateProfile(
    ctx: ConsoleAccountIdentityContext,
    request: PatchConsoleAccountProfileRequest,
  ): Promise<ConsoleAccountProfile> {
    const timestamp = this.now().getTime();
    if (request.primaryEmail && !canEditPrimaryEmail(ctx)) {
      throw accountError(
        'primary_email_read_only',
        403,
        'Primary email is managed by your identity provider',
      );
    }
    if (request.displayName || request.primaryEmail) {
      await this.database
        .prepare(
          `INSERT INTO user_profiles
            (namespace, user_id, display_name, primary_email, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(namespace, user_id)
           DO UPDATE SET
             display_name = COALESCE(excluded.display_name, user_profiles.display_name),
             primary_email = COALESCE(excluded.primary_email, user_profiles.primary_email),
             updated_at_ms = excluded.updated_at_ms`,
        )
        .bind(
          this.namespace,
          ctx.userId,
          request.displayName ? normalizeString(request.displayName) : null,
          request.primaryEmail ? normalizeLower(request.primaryEmail) : null,
          timestamp,
          timestamp,
        )
        .run();
    }
    if (request.addBackupEmail) {
      const email = normalizeLower(request.addBackupEmail);
      await this.database
        .prepare(
          `INSERT INTO user_backup_emails
            (namespace, user_id, email, email_normalized, status, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
           ON CONFLICT(namespace, user_id, email_normalized)
           DO UPDATE SET email = excluded.email, updated_at_ms = excluded.updated_at_ms`,
        )
        .bind(this.namespace, ctx.userId, email, email, timestamp, timestamp)
        .run();
    }
    if (request.removeBackupEmail) {
      await this.database
        .prepare(
          `DELETE FROM user_backup_emails
            WHERE namespace = ?
              AND user_id = ?
              AND email_normalized = ?`,
        )
        .bind(this.namespace, ctx.userId, normalizeLower(request.removeBackupEmail))
        .run();
    }
    return this.getProfile(ctx);
  }

  async listOrganizations(
    ctx: ConsoleAccountIdentityContext,
  ): Promise<ConsoleAccountOrganization[]> {
    const rows = await queryD1All(
      this.database,
      `SELECT DISTINCT
          organization.id,
          organization.name,
          organization.slug,
          organization.status,
          organization.created_at_ms,
          organization.updated_at_ms
         FROM organizations AS organization
         JOIN organization_memberships AS membership
           ON membership.namespace = organization.namespace
          AND membership.org_id = organization.id
        WHERE organization.namespace = ?
          AND membership.user_id = ?
          AND membership.kind = 'ACTIVE'
        ORDER BY organization.updated_at_ms DESC, organization.created_at_ms DESC`,
      [this.namespace, ctx.userId],
    );
    const organizations: ConsoleAccountOrganization[] = [];
    for (const row of rows) {
      const organization = parseOrganizationRow(row);
      organizations.push(await this.#loadOrganization(ctx, organization));
    }
    return organizations.sort(compareOrganizationUpdatedAt);
  }

  async createOrganization(
    ctx: ConsoleAccountIdentityContext,
    request: CreateConsoleAccountOrganizationRequest,
  ): Promise<ConsoleAccountOrganization> {
    const orgId = normalizeString(request.id) || generateConsoleOrganizationId();
    if (await getOrganizationById(this, orgId)) {
      throw accountError(
        'organization_already_exists',
        409,
        `Organization ${orgId} already exists`,
      );
    }
    await this.orgProjectEnv.upsertOrganization(toOrgProjectEnvContext(ctx, orgId), {
      name: request.name,
      ...(request.slug ? { slug: request.slug } : {}),
    });
    await this.organizationAccess.bootstrapInitialOwner({
      orgId,
      userId: ctx.userId,
      email: ctx.email,
      displayName: ctx.name,
    });
    const created = await getOrganizationById(this, orgId);
    if (!created) throw accountError('internal', 500, 'Failed to read created organization');
    return this.#loadOrganization(ctx, created);
  }

  async updateOrganization(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
    request: UpdateConsoleAccountOrganizationRequest,
  ): Promise<ConsoleAccountOrganization> {
    const authorization = await requireAuthorization({
      organizationAccess: this.organizationAccess,
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
    await this.orgProjectEnv.upsertOrganization(toOrgProjectEnvContext(ctx, orgId), request);
    const updated = await getOrganizationById(this, orgId);
    if (!updated) {
      throw accountError('organization_not_found', 404, `Organization ${orgId} was not found`);
    }
    return this.#loadOrganization(ctx, updated);
  }

  async deleteOrganization(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<DeleteConsoleAccountOrganizationResult> {
    const snapshot = await this.database
      .prepare(ORGANIZATION_SERVICE_SNAPSHOT_SQL)
      .bind(this.namespace, orgId)
      .first<string>('snapshot');
    if (typeof snapshot !== 'string')
      throw new Error('Organization service snapshot is unavailable');
    const current = await this.#assertOrganizationDeletionAllowed(ctx, orgId);
    const values = [this.namespace, orgId, current.authorizationVersion, ctx.userId];
    const results = await this.database
      .batch<D1ResultLike<{ id: string }>>([
        this.database
          .prepare(
            `SELECT CASE WHEN (${ORGANIZATION_SERVICE_SNAPSHOT_SQL}) = ?3
             THEN 1 ELSE json('organization_delete_scope_changed') END`,
          )
          .bind(this.namespace, orgId, snapshot),
        this.database
          .prepare(
            `DELETE FROM platform_provision_receipts
             WHERE namespace = ?1 AND operation_id IN (
               SELECT id FROM platform_provision_operations
               WHERE namespace = ?1 AND org_id = ?2 AND service_id = 'wallet'
             ) AND ${OWNER_DELETE_SCOPE_SQL}`,
          )
          .bind(...values),
        this.database
          .prepare(
            `DELETE FROM platform_provision_operations
             WHERE namespace = ?1 AND org_id = ?2 AND service_id = 'wallet'
               AND ${OWNER_DELETE_SCOPE_SQL}`,
          )
          .bind(...values),
        this.database
          .prepare(
            `DELETE FROM wallet_service_bindings
             WHERE namespace = ?1 AND instance_id IN (
               SELECT id FROM platform_service_instances
               WHERE namespace = ?1 AND org_id = ?2 AND service_id = 'wallet'
             ) AND ${OWNER_DELETE_SCOPE_SQL}`,
          )
          .bind(...values),
        this.database
          .prepare(
            `DELETE FROM platform_instance_access
             WHERE namespace = ?1 AND org_id = ?2 AND instance_id IN (
               SELECT id FROM platform_service_instances
               WHERE namespace = ?1 AND org_id = ?2 AND service_id = 'wallet'
             ) AND ${OWNER_DELETE_SCOPE_SQL}`,
          )
          .bind(...values),
        this.database
          .prepare(
            `DELETE FROM platform_service_instances
             WHERE namespace = ?1 AND org_id = ?2 AND service_id = 'wallet'
               AND ${OWNER_DELETE_SCOPE_SQL}`,
          )
          .bind(...values),
        this.database
          .prepare(
            `DELETE FROM project_billing_bindings
          WHERE namespace = ?1 AND org_id = ?2 AND ${OWNER_DELETE_SCOPE_SQL}`,
          )
          .bind(...values),
        // An organization without billing history has only its Free plan state to remove.
        ...['billing_plan_notices', 'billing_plan_usage_months', 'billing_account_plans'].map(
          (table) =>
            this.database
              .prepare(
                `DELETE FROM ${table}
              WHERE namespace = ?1 AND org_id = ?2 AND ${OWNER_DELETE_SCOPE_SQL}`,
              )
              .bind(...values),
        ),
        this.database
          .prepare(
            `DELETE FROM organization_billing_accounts
          WHERE namespace = ?1 AND org_id = ?2 AND ${OWNER_DELETE_SCOPE_SQL}`,
          )
          .bind(...values),
        this.database
          .prepare(
            `DELETE FROM billing_accounts
          WHERE namespace = ?1 AND org_id = ?2 AND ${OWNER_DELETE_SCOPE_SQL}`,
          )
          .bind(...values),
        this.database
          .prepare(
            `DELETE FROM organizations
          WHERE namespace = ?1 AND id = ?2 AND ${OWNER_DELETE_SCOPE_SQL}
          RETURNING id`,
          )
          .bind(...values),
      ])
      .catch(rethrowOrganizationDeletionError);
    const organizationDeletion = results.at(-1);
    const [deletedOrganization] = organizationDeletion?.results ?? [];
    if (!deletedOrganization || deletedOrganization.id !== orgId) {
      throw accountError(
        'organization_delete_scope_changed',
        409,
        'Organization access changed before deletion; reload the account and retry',
      );
    }
    return { orgId, organizationName: current.name };
  }

  async switchOrganizationContext(
    ctx: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<SwitchConsoleAccountOrganizationContextResult> {
    const authorization = await requireAuthorization({
      organizationAccess: this.organizationAccess,
      orgId,
      userId: ctx.userId,
    });
    const scope = await resolveOrganizationScope({ service: this, ctx, orgId });
    return {
      orgId,
      projectId: scope.projectId,
      onboardingComplete: scope.onboardingComplete,
      platformSupport: ctx.platformSupport,
      ...toOrganizationAccess(authorization),
    };
  }

  async #loadOrganization(
    ctx: ConsoleAccountIdentityContext,
    organization: AccountOrganizationRow,
  ): Promise<ConsoleAccountOrganization> {
    const authorization = await requireAuthorization({
      organizationAccess: this.organizationAccess,
      orgId: organization.id,
      userId: ctx.userId,
    });
    const scope = await resolveOrganizationScope({
      service: this,
      ctx,
      orgId: organization.id,
    });
    const labels = await resolveSelectedScopeLabels({
      service: this,
      ctx,
      orgId: organization.id,
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
    const organization = await getOrganizationById(this, orgId);
    if (!organization) {
      throw accountError('organization_not_found', 404, `Organization ${orgId} was not found`);
    }
    const current = await this.#loadOrganization(ctx, organization);
    if (current.role !== 'OWNER') {
      throw accountError('forbidden', 403, 'Only an owner can delete an organization');
    }
    const memberships = await this.organizationAccess.listMemberships(
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
    await this.deletion.assertOrganizationCanBeDeleted({ orgId, actorUserId: ctx.userId });
    return current;
  }
}

export async function createD1ConsoleAccountService(
  options: D1ConsoleAccountServiceOptions,
): Promise<ConsoleAccountD1Service> {
  if (options.ensureSchema) {
    await ensureConsoleAccountD1Schema({ database: options.database });
  }
  return new D1ConsoleAccountServiceImpl(options);
}
