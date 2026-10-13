import { secureRandomBase36 } from '../boundary';
import {
  d1Number as toNumber,
  formatD1ExecStatement,
  queryD1All,
  queryD1One,
  type D1Row,
} from '../boundary';
import type { D1DatabaseLike } from '../boundary';
import { ConsoleOrgProjectError } from './errors';
import type {
  ConsoleOrganization,
  ConsoleOrganizationStatus,
  ConsoleProject,
  ConsoleProjectStatus,
  CreateConsoleProjectRequest,
  ListConsoleProjectsRequest,
  SearchConsoleOrganizationsRequest,
  UpsertConsoleOrganizationRequest,
  UpdateConsoleProjectRequest,
} from './types';
import type { ConsoleOrgProjectContext, ConsoleOrgProjectService } from './service';

export interface D1ConsoleOrgProjectServiceOptions {
  database: D1DatabaseLike;
  namespace?: string;
  ensureSchema?: boolean;
  now?: () => Date;
}

export interface D1ConsoleOrgProjectSchemaOptions {
  database: D1DatabaseLike;
}

export const CONSOLE_ORG_PROJECT_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS organizations (
      namespace TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_by_user_id TEXT,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, id),
      CHECK (status IN ('ACTIVE'))
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS projects (
      namespace TEXT NOT NULL,
      id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, id),
      CHECK (status IN ('ACTIVE', 'ARCHIVED')),
      FOREIGN KEY (namespace, org_id)
        REFERENCES organizations(namespace, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS projects_org_updated_idx
      ON projects (namespace, org_id, updated_at_ms DESC, created_at_ms DESC)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS projects_namespace_id_org_unique_idx
      ON projects (namespace, id, org_id)
  `,
] as const);

export async function ensureConsoleOrgProjectD1Schema(
  options: D1ConsoleOrgProjectSchemaOptions,
): Promise<void> {
  for (const statement of CONSOLE_ORG_PROJECT_D1_SCHEMA_SQL) {
    await options.database.exec(formatD1ExecStatement(statement));
  }
}

function defaultNow(): Date {
  return new Date();
}

function ensureNamespace(namespace: string | undefined): string {
  const normalized = String(namespace || 'default').trim();
  return normalized || 'default';
}

function nowMs(now: Date): number {
  return now.getTime();
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function slugify(value: string): string {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
  );
}

function humanizeId(value: string, fallback: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return fallback;
  return trimmed
    .replace(/[_:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeResourceId(prefix: string, now: Date): string {
  return `${prefix}_${now.getTime().toString(36)}_${secureRandomBase36(6, 'console IDs')}`;
}

function parseOrganizationStatus(value: unknown): ConsoleOrganizationStatus {
  const normalized = String(value || '').trim();
  switch (normalized) {
    case 'ACTIVE':
      return normalized;
    default:
      throw new Error(`Invalid console organization status row: ${normalized || 'empty'}`);
  }
}

function parseProjectStatus(value: unknown): ConsoleProjectStatus {
  const normalized = String(value || '').trim();
  switch (normalized) {
    case 'ACTIVE':
    case 'ARCHIVED':
      return normalized;
    default:
      throw new Error(`Invalid console project status row: ${normalized || 'empty'}`);
  }
}

function parseOrgRow(row: D1Row): ConsoleOrganization {
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    slug: String(row.slug || ''),
    status: parseOrganizationStatus(row.status),
    createdAt: toIso(toNumber(row.created_at_ms)),
    updatedAt: toIso(toNumber(row.updated_at_ms)),
  };
}

function parseProjectRow(row: D1Row): ConsoleProject {
  return {
    id: String(row.id || ''),
    orgId: String(row.org_id || ''),
    name: String(row.name || ''),
    slug: String(row.slug || ''),
    status: parseProjectStatus(row.status),
    createdAt: toIso(toNumber(row.created_at_ms)),
    updatedAt: toIso(toNumber(row.updated_at_ms)),
  };
}

function normalizeOrganizationSearchValue(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function scoreOrganizationSearchCandidate(query: string, value: string, offset: number): number {
  const normalized = normalizeOrganizationSearchValue(value);
  if (!normalized) return Number.POSITIVE_INFINITY;
  if (normalized === query) return offset;
  if (normalized.startsWith(query)) {
    return offset + 10 + Math.max(0, normalized.length - query.length);
  }
  const tokens = normalized.split(/[\s_-]+/).filter(Boolean);
  const tokenIndex = tokens.findIndex((token) => token.startsWith(query));
  if (tokenIndex >= 0) return offset + 30 + tokenIndex;
  const containsIndex = normalized.indexOf(query);
  if (containsIndex >= 0) return offset + 60 + containsIndex;
  return Number.POSITIVE_INFINITY;
}

function scoreOrganizationSearchResult(query: string, organization: ConsoleOrganization): number {
  return Math.min(
    scoreOrganizationSearchCandidate(query, organization.name, 0),
    scoreOrganizationSearchCandidate(query, organization.id, 20),
  );
}

function sortOrganizationSearchResults(
  items: ConsoleOrganization[],
  query: string,
): ConsoleOrganization[] {
  return [...items].sort((left, right) => {
    const scoreDiff =
      scoreOrganizationSearchResult(query, left) - scoreOrganizationSearchResult(query, right);
    if (scoreDiff !== 0) return scoreDiff;
    const primaryDiff = left.name.localeCompare(right.name);
    if (primaryDiff !== 0) return primaryDiff;
    return left.id.localeCompare(right.id);
  });
}

function isD1ConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('UNIQUE constraint failed') || message.includes('constraint failed');
}

async function loadOrganization(input: {
  database: D1DatabaseLike;
  namespace: string;
  orgId: string;
}): Promise<ConsoleOrganization | null> {
  const row = await queryD1One(
    input.database,
    `SELECT *
       FROM organizations
      WHERE namespace = ?
        AND id = ?
      LIMIT 1`,
    [input.namespace, input.orgId],
  );
  return row ? parseOrgRow(row) : null;
}

async function loadProjectRow(input: {
  database: D1DatabaseLike;
  namespace: string;
  orgId: string;
  projectId: string;
}): Promise<D1Row | null> {
  return await queryD1One(
    input.database,
    `SELECT *
       FROM projects
      WHERE namespace = ?
        AND org_id = ?
        AND id = ?
      LIMIT 1`,
    [input.namespace, input.orgId, input.projectId],
  );
}

async function loadProject(input: {
  database: D1DatabaseLike;
  namespace: string;
  orgId: string;
  projectId: string;
}): Promise<ConsoleProject | null> {
  const row = await queryD1One(
    input.database,
    `SELECT p.*
       FROM projects p
      WHERE p.namespace = ?
        AND p.org_id = ?
        AND p.id = ?
      LIMIT 1`,
    [input.namespace, input.orgId, input.projectId],
  );
  return row ? parseProjectRow(row) : null;
}

async function findExistingProjectId(input: {
  database: D1DatabaseLike;
  namespace: string;
  projectId: string;
}): Promise<string | null> {
  const row = await queryD1One(
    input.database,
    `SELECT id
       FROM projects
      WHERE namespace = ?
        AND id = ?
      LIMIT 1`,
    [input.namespace, input.projectId],
  );
  return normalizeOptionalString(row?.id);
}

async function insertProject(input: {
  database: D1DatabaseLike;
  namespace: string;
  orgId: string;
  projectId: string;
  name: string;
  createdAtMs: number;
}): Promise<void> {
  await input.database
    .prepare(
      `INSERT INTO projects (namespace, id, org_id, name, slug, status, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
    )
    .bind(
      input.namespace,
      input.projectId,
      input.orgId,
      input.name,
      slugify(input.name),
      input.createdAtMs,
      input.createdAtMs,
    )
    .run();
}

async function createProjectInD1(input: {
  database: D1DatabaseLike;
  namespace: string;
  ctx: ConsoleOrgProjectContext;
  now: () => Date;
  request: CreateConsoleProjectRequest;
}): Promise<ConsoleProject> {
  const organization = await loadOrganization({
    database: input.database,
    namespace: input.namespace,
    orgId: input.ctx.orgId,
  });
  if (!organization) {
    throw new ConsoleOrgProjectError(
      'organization_not_found',
      404,
      `Organization ${input.ctx.orgId} was not found`,
    );
  }

  const currentNow = input.now();
  const currentNowMs = nowMs(currentNow);
  const projectId = String(input.request.id || makeResourceId('proj', currentNow)).trim();
  const existingProjectId = await findExistingProjectId({
    database: input.database,
    namespace: input.namespace,
    projectId,
  });
  if (existingProjectId) {
    throw new ConsoleOrgProjectError(
      'project_already_exists',
      409,
      `Project ${projectId} already exists`,
    );
  }

  try {
    await insertProject({
      database: input.database,
      namespace: input.namespace,
      orgId: input.ctx.orgId,
      projectId,
      name: input.request.name,
      createdAtMs: currentNowMs,
    });
  } catch (error: unknown) {
    if (!isD1ConstraintError(error)) throw error;
    throw new ConsoleOrgProjectError(
      'project_already_exists',
      409,
      `Project ${projectId} already exists`,
    );
  }

  const project = await loadProject({
    database: input.database,
    namespace: input.namespace,
    orgId: input.ctx.orgId,
    projectId,
  });
  if (!project) {
    throw new ConsoleOrgProjectError(
      'project_not_found',
      404,
      `Project ${projectId} was not found`,
    );
  }
  return project;
}

export async function createD1ConsoleOrgProjectService(
  options: D1ConsoleOrgProjectServiceOptions,
): Promise<ConsoleOrgProjectService> {
  if (options.ensureSchema) {
    await ensureConsoleOrgProjectD1Schema({ database: options.database });
  }
  const database = options.database;
  const namespace = ensureNamespace(options.namespace);
  const now = options.now || defaultNow;

  const service: ConsoleOrgProjectService = {
    async getOrganization(ctx): Promise<ConsoleOrganization> {
      const organization = await loadOrganization({
        database,
        namespace,
        orgId: ctx.orgId,
      });
      if (!organization) {
        throw new ConsoleOrgProjectError(
          'organization_not_found',
          404,
          `Organization ${ctx.orgId} was not found`,
        );
      }
      return organization;
    },

    async findDefaultOrganization(): Promise<ConsoleOrganization | null> {
      const rows = await queryD1All(
        database,
        `SELECT *
           FROM organizations
          WHERE namespace = ?
            AND status = 'ACTIVE'
          ORDER BY created_at_ms ASC, id ASC
          LIMIT 2`,
        [namespace],
      );
      if (rows.length !== 1) return null;
      return parseOrgRow(rows[0]!);
    },

    async searchOrganizations(
      request: SearchConsoleOrganizationsRequest,
    ): Promise<ConsoleOrganization[]> {
      const query = normalizeOrganizationSearchValue(request.query);
      const rawLimit = Number(request.limit || 0);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.max(1, Math.floor(rawLimit)) : 10;
      if (!query) {
        const rows = await queryD1All(
          database,
          `SELECT *
             FROM organizations
            WHERE namespace = ?
            ORDER BY created_at_ms DESC, id ASC
            LIMIT ?`,
          [namespace, limit],
        );
        return rows.map(parseOrgRow);
      }
      const candidateLimit = Math.max(limit * 5, 25);
      const rows = await queryD1All(
        database,
        `SELECT *
           FROM organizations
          WHERE namespace = ?
            AND (
              LOWER(name) LIKE ?
              OR LOWER(id) LIKE ?
            )
          LIMIT ?`,
        [namespace, `%${query}%`, `%${query}%`, candidateLimit],
      );
      return sortOrganizationSearchResults(rows.map(parseOrgRow), query).slice(0, limit);
    },

    async findOrganizationForProject(request): Promise<ConsoleOrganization | null> {
      const projectRow = await queryD1One(
        database,
        `SELECT o.* FROM projects p JOIN organizations o
          ON o.namespace = p.namespace AND o.id = p.org_id
          WHERE p.namespace = ? AND p.id = ? LIMIT 1`,
        [namespace, request.projectId],
      );
      return projectRow ? parseOrgRow(projectRow) : null;
    },

    async upsertOrganization(
      ctx,
      request: UpsertConsoleOrganizationRequest,
    ): Promise<ConsoleOrganization> {
      const currentNow = now();
      const currentNowMs = nowMs(currentNow);
      const defaultName = humanizeId(ctx.orgId, 'Organization');
      const createdName = String(request.name || '').trim() || defaultName;
      const createdSlug = slugify(String(request.slug || '').trim() || createdName);

      await database
        .prepare(
          `INSERT INTO organizations
            (namespace, id, name, slug, created_by_user_id, status, created_at_ms, updated_at_ms)
           VALUES
            (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
           ON CONFLICT(namespace, id) DO NOTHING`,
        )
        .bind(
          namespace,
          ctx.orgId,
          createdName,
          createdSlug,
          normalizeOptionalString(ctx.actorUserId),
          currentNowMs,
          currentNowMs,
        )
        .run();

      const base = await loadOrganization({
        database,
        namespace,
        orgId: ctx.orgId,
      });
      if (!base) {
        throw new ConsoleOrgProjectError(
          'organization_not_found',
          404,
          `Organization ${ctx.orgId} was not found`,
        );
      }

      const nextName = String(request.name || '').trim() || base.name || defaultName;
      const nextSlug = slugify(String(request.slug || '').trim() || base.slug || nextName);
      await database
        .prepare(
          `UPDATE organizations
              SET name = ?,
                  slug = ?,
                  updated_at_ms = ?
            WHERE namespace = ?
              AND id = ?`,
        )
        .bind(nextName, nextSlug, currentNowMs, namespace, ctx.orgId)
        .run();

      const organization = await loadOrganization({
        database,
        namespace,
        orgId: ctx.orgId,
      });
      if (!organization) {
        throw new ConsoleOrgProjectError(
          'organization_not_found',
          404,
          `Organization ${ctx.orgId} was not found`,
        );
      }
      return organization;
    },

    async deleteOrganization(
      ctx,
    ): Promise<{ deleted: boolean; organization: ConsoleOrganization | null }> {
      const organization = await loadOrganization({
        database,
        namespace,
        orgId: ctx.orgId,
      });
      if (!organization) return { deleted: false, organization: null };
      await database.batch([
        database
          .prepare(
            `DELETE FROM projects
              WHERE namespace = ?
                AND org_id = ?`,
          )
          .bind(namespace, ctx.orgId),
        database
          .prepare(
            `DELETE FROM organizations
              WHERE namespace = ?
                AND id = ?`,
          )
          .bind(namespace, ctx.orgId),
      ]);
      return { deleted: true, organization };
    },

    async listProjects(ctx, request?: ListConsoleProjectsRequest): Promise<ConsoleProject[]> {
      const values: unknown[] = [namespace, ctx.orgId];
      let statusFilter = '';
      if (request?.status) {
        values.push(request.status);
        statusFilter = ' AND p.status = ?';
      }
      const rows = await queryD1All(
        database,
        `SELECT p.*
           FROM projects p
          WHERE p.namespace = ?
            AND p.org_id = ?${statusFilter}
          ORDER BY p.updated_at_ms DESC, p.created_at_ms DESC`,
        values,
      );
      return rows.map(parseProjectRow);
    },

    async createProject(ctx, request: CreateConsoleProjectRequest): Promise<ConsoleProject> {
      return await createProjectInD1({ database, namespace, ctx, now, request });
    },

    async updateProject(
      ctx,
      projectId: string,
      request: UpdateConsoleProjectRequest,
    ): Promise<ConsoleProject | null> {
      const current = await loadProjectRow({ database, namespace, orgId: ctx.orgId, projectId });
      if (!current) return null;
      if (parseProjectStatus(current.status) === 'ARCHIVED') {
        throw new ConsoleOrgProjectError(
          'project_archived',
          409,
          `Project ${projectId} is archived and cannot be updated`,
        );
      }
      const nextName = request.name || String(current.name || '');
      await database
        .prepare(
          `UPDATE projects
              SET name = ?,
                  slug = ?,
                  updated_at_ms = ?
            WHERE namespace = ?
              AND org_id = ?
              AND id = ?`,
        )
        .bind(nextName, slugify(nextName), nowMs(now()), namespace, ctx.orgId, projectId)
        .run();
      return await loadProject({
        database,
        namespace,
        orgId: ctx.orgId,
        projectId,
      });
    },

    async archiveProject(ctx, projectId: string): Promise<ConsoleProject | null> {
      const current = await loadProjectRow({ database, namespace, orgId: ctx.orgId, projectId });
      if (!current) return null;
      const currentNowMs = nowMs(now());
      await database.batch([
        database
          .prepare(
            `UPDATE projects
                SET status = 'ARCHIVED',
                    updated_at_ms = ?
              WHERE namespace = ?
                AND org_id = ?
                AND id = ?`,
          )
          .bind(currentNowMs, namespace, ctx.orgId, projectId),
      ]);
      return await loadProject({
        database,
        namespace,
        orgId: ctx.orgId,
        projectId,
      });
    },

  };

  return service;
}
