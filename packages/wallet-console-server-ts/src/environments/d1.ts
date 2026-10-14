import {
  secureRandomBase36,
  d1Number as toNumber,
  d1ChangedRows,
  formatD1ExecStatement,
  queryD1All,
  queryD1One,
  type D1Row,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
} from '@seams-internal/console-server/boundary/index';
import type { ConsoleOrganization } from '@seams-internal/console-server/orgProjectEnv/types';
import { ConsoleWalletEnvironmentError } from './errors';
import { DEFAULT_WALLET_SIGNING_ROOT_VERSION } from './types';
import type {
  ConsoleWalletEnvironment,
  ConsoleWalletEnvironmentStatus,
  CreateConsoleWalletEnvironmentRequest,
  ListConsoleWalletEnvironmentsRequest,
  UpdateConsoleWalletEnvironmentRequest,
  ProvisionConsoleWalletEnvironmentsRequest,
  SetConsoleWalletProjectAvailabilityRequest,
} from './types';
import type { ConsoleWalletEnvironmentContext, ConsoleWalletEnvironmentService } from './service';

type ConsoleWalletEnvironmentKey = ConsoleWalletEnvironment['key'];
const DEFAULT_ENVIRONMENT_KEYS: readonly ConsoleWalletEnvironmentKey[] = ['dev', 'staging', 'prod'];
export interface D1ConsoleWalletEnvironmentServiceOptions {
  database: D1DatabaseLike;
  namespace?: string;
  ensureSchema?: boolean;
  now?: () => Date;
}
export const CONSOLE_WALLET_ENVIRONMENT_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS environments (
      namespace TEXT NOT NULL,
      id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_key TEXT NOT NULL,
      runtime_version TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, id),
      CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
      CHECK (env_key IN ('dev', 'staging', 'prod')),
      UNIQUE (namespace, project_id, env_key),
      FOREIGN KEY (namespace, project_id, org_id)
        REFERENCES projects(namespace, id, org_id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS environments_org_project_updated_idx
      ON environments (namespace, org_id, project_id, updated_at_ms DESC, created_at_ms DESC)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS environments_namespace_id_project_org_unique_idx
      ON environments (namespace, id, project_id, org_id)
  `,
] as const);
export async function ensureConsoleWalletEnvironmentD1Schema(options: {
  database: D1DatabaseLike;
}): Promise<void> {
  for (const statement of CONSOLE_WALLET_ENVIRONMENT_D1_SCHEMA_SQL)
    await options.database.exec(formatD1ExecStatement(statement));
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

function environmentNameFromKey(key: ConsoleWalletEnvironmentKey): string {
  if (key === 'dev') return 'Development';
  if (key === 'staging') return 'Staging';
  return 'Production';
}

function defaultEnvironmentId(projectId: string, key: ConsoleWalletEnvironmentKey): string {
  return `${projectId}:${key}`;
}

function normalizeSigningRootVersion(input: unknown, fallback?: string): string {
  const normalized = String(input || '').trim();
  if (normalized) return normalized;
  if (fallback) return fallback;
  throw new ConsoleWalletEnvironmentError(
    'invalid_runtime_version',
    400,
    'signingRootVersion is required',
  );
}

function makeResourceId(prefix: string, now: Date): string {
  return `${prefix}_${now.getTime().toString(36)}_${secureRandomBase36(6, 'console IDs')}`;
}

function parseEnvironmentStatus(value: unknown): ConsoleWalletEnvironmentStatus {
  const normalized = String(value || '').trim();
  switch (normalized) {
    case 'ACTIVE':
    case 'DISABLED':
    case 'ARCHIVED':
      return normalized;
    default:
      throw new Error(`Invalid console environment status row: ${normalized || 'empty'}`);
  }
}

function parseEnvironmentKey(value: unknown): ConsoleWalletEnvironmentKey {
  const normalized = String(value || '').trim();
  switch (normalized) {
    case 'dev':
    case 'staging':
    case 'prod':
      return normalized;
    default:
      throw new Error(`Invalid console environment key row: ${normalized || 'empty'}`);
  }
}

export function parseEnvironmentRow(row: D1Row): ConsoleWalletEnvironment {
  return {
    id: String(row.id || ''),
    orgId: String(row.org_id || ''),
    projectId: String(row.project_id || ''),
    key: parseEnvironmentKey(row.env_key),
    signingRootVersion: normalizeSigningRootVersion(
      row.runtime_version,
      DEFAULT_WALLET_SIGNING_ROOT_VERSION,
    ),
    name: String(row.name || ''),
    status: parseEnvironmentStatus(row.status),
    createdAt: toIso(toNumber(row.created_at_ms)),
    updatedAt: toIso(toNumber(row.updated_at_ms)),
  };
}

function environmentRank(key: ConsoleWalletEnvironmentKey): number {
  if (key === 'prod') return 0;
  if (key === 'staging') return 1;
  return 2;
}

function sortEnvironments(items: readonly ConsoleWalletEnvironment[]): ConsoleWalletEnvironment[] {
  return [...items].sort((left, right) => {
    const keyRankDiff = environmentRank(left.key) - environmentRank(right.key);
    if (keyRankDiff !== 0) return keyRankDiff;
    const updatedAtDiff = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedAtDiff !== 0) return updatedAtDiff;
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function isD1ConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('UNIQUE constraint failed') || message.includes('constraint failed');
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

async function loadEnvironmentRow(input: {
  database: D1DatabaseLike;
  namespace: string;
  orgId: string;
  environmentId: string;
}): Promise<D1Row | null> {
  return await queryD1One(
    input.database,
    `SELECT *
       FROM environments
      WHERE namespace = ?
        AND org_id = ?
        AND id = ?
      LIMIT 1`,
    [input.namespace, input.orgId, input.environmentId],
  );
}

async function loadEnvironment(input: {
  database: D1DatabaseLike;
  namespace: string;
  orgId: string;
  environmentId: string;
}): Promise<ConsoleWalletEnvironment | null> {
  const row = await loadEnvironmentRow(input);
  return row ? parseEnvironmentRow(row) : null;
}

async function findEnvironmentId(input: {
  database: D1DatabaseLike;
  namespace: string;
  environmentId: string;
}): Promise<string | null> {
  const row = await queryD1One(
    input.database,
    `SELECT id
       FROM environments
      WHERE namespace = ?
        AND id = ?
      LIMIT 1`,
    [input.namespace, input.environmentId],
  );
  return normalizeOptionalString(row?.id);
}

async function requireActiveProject(input: {
  database: D1DatabaseLike;
  namespace: string;
  orgId: string;
  projectId: string;
}): Promise<void> {
  const project = await loadProjectRow(input);
  if (!project)
    throw new ConsoleWalletEnvironmentError(
      'project_not_found',
      404,
      `Project ${input.projectId} was not found`,
    );
  if (project.status !== 'ACTIVE')
    throw new ConsoleWalletEnvironmentError(
      'project_archived',
      409,
      `Project ${input.projectId} is archived`,
    );
}
function defaultEnvironmentStatus(
  key: ConsoleWalletEnvironmentKey,
  liveAccess: 'enabled' | 'disabled',
): Exclude<ConsoleWalletEnvironmentStatus, 'ARCHIVED'> {
  if (key === 'dev') return 'ACTIVE';
  return liveAccess === 'enabled' ? 'ACTIVE' : 'DISABLED';
}
function buildDefaultEnvironmentInserts(input: {
  database: D1DatabaseLike;
  namespace: string;
  orgId: string;
  projectId: string;
  liveAccess: 'enabled' | 'disabled';
  createdAtMs: number;
}): D1PreparedStatementLike[] {
  const statements: D1PreparedStatementLike[] = [];
  for (const key of DEFAULT_ENVIRONMENT_KEYS) {
    statements.push(
      input.database
        .prepare(
          `INSERT INTO environments (namespace, id, org_id, project_id, env_key, runtime_version, name, status, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, project_id, env_key) DO NOTHING`,
        )
        .bind(
          input.namespace,
          defaultEnvironmentId(input.projectId, key),
          input.orgId,
          input.projectId,
          key,
          DEFAULT_WALLET_SIGNING_ROOT_VERSION,
          environmentNameFromKey(key),
          defaultEnvironmentStatus(key, input.liveAccess),
          input.createdAtMs,
          input.createdAtMs,
        ),
    );
  }
  return statements;
}

const CURRENT_PLATFORM_COMMAND = `EXISTS (
  SELECT 1 FROM platform_service_instances i
  WHERE i.namespace = ? AND i.id = ? AND i.service_id = 'wallet'
    AND i.desired_revision = ? AND i.desired_state = ? AND i.org_id = ? AND i.project_id = ?
    AND i.billing_account_id = ?
    AND (
      EXISTS (
        SELECT 1 FROM wallet_service_bindings b
        WHERE b.namespace = i.namespace AND b.instance_id = i.id
          AND b.native_namespace = ? AND b.native_org_id = ? AND b.native_project_id = ?
      ) OR (
        NOT EXISTS (SELECT 1 FROM wallet_service_bindings b WHERE b.namespace = i.namespace AND b.instance_id = i.id)
        AND i.org_id = ? AND i.project_id = ?
      )
    )
)`;

function platformCommandValues(
  nativeNamespace: string,
  orgId: string,
  request: SetConsoleWalletProjectAvailabilityRequest,
): readonly unknown[] {
  return [
    request.authority.scope.namespace,
    request.authority.instanceId,
    request.authority.desiredRevision,
    request.availability,
    request.authority.scope.organizationId,
    request.authority.scope.projectId,
    request.authority.scope.billingAccountId,
    nativeNamespace,
    orgId,
    request.projectId,
    orgId,
    request.projectId,
  ];
}

function buildAvailabilityStatements(input: {
  database: D1DatabaseLike;
  namespace: string;
  orgId: string;
  request: SetConsoleWalletProjectAvailabilityRequest;
  currentTimeMs: number;
}): D1PreparedStatementLike[] {
  const statements: D1PreparedStatementLike[] = [];
  const { request } = input;
  if (request.availability === 'enabled') {
    for (const key of DEFAULT_ENVIRONMENT_KEYS) {
      statements.push(
        input.database
          .prepare(
            `INSERT INTO environments (namespace, id, org_id, project_id, env_key, runtime_version, name, status, created_at_ms, updated_at_ms)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${CURRENT_PLATFORM_COMMAND}
         ON CONFLICT(namespace, project_id, env_key) DO NOTHING`,
          )
          .bind(
            input.namespace,
            defaultEnvironmentId(request.projectId, key),
            input.orgId,
            request.projectId,
            key,
            DEFAULT_WALLET_SIGNING_ROOT_VERSION,
            environmentNameFromKey(key),
            defaultEnvironmentStatus(key, request.liveAccess),
            input.currentTimeMs,
            input.currentTimeMs,
            ...platformCommandValues(input.namespace, input.orgId, request),
          ),
      );
    }
  }
  const status = request.availability === 'archived' ? 'ARCHIVED' : 'DISABLED';
  const nextStatus =
    request.availability === 'enabled'
      ? "CASE WHEN env_key = 'dev' OR ? = 'enabled' THEN 'ACTIVE' ELSE 'DISABLED' END"
      : '?';
  const statusValue = request.availability === 'enabled' ? request.liveAccess : status;
  statements.push(
    input.database
      .prepare(
        `UPDATE environments SET status = ${nextStatus}, updated_at_ms = ?
     WHERE namespace = ? AND org_id = ? AND project_id = ? AND status <> 'ARCHIVED'
       AND ${CURRENT_PLATFORM_COMMAND}`,
      )
      .bind(
        statusValue,
        input.currentTimeMs,
        input.namespace,
        input.orgId,
        request.projectId,
        ...platformCommandValues(input.namespace, input.orgId, request),
      ),
  );
  return statements;
}
export async function createD1ConsoleWalletEnvironmentService(
  options: D1ConsoleWalletEnvironmentServiceOptions,
): Promise<ConsoleWalletEnvironmentService> {
  if (options.ensureSchema)
    await ensureConsoleWalletEnvironmentD1Schema({ database: options.database });
  const database = options.database;
  const namespace = ensureNamespace(options.namespace);
  const now = options.now || defaultNow;
  const service: ConsoleWalletEnvironmentService = {
    async setProjectAvailability(ctx, request) {
      if (request.availability === 'enabled') {
        await requireActiveProject({
          database,
          namespace,
          orgId: ctx.orgId,
          projectId: request.projectId,
        });
      }
      await database.batch(
        buildAvailabilityStatements({
          database,
          namespace,
          orgId: ctx.orgId,
          request,
          currentTimeMs: nowMs(now()),
        }),
      );
      const current = await queryD1One(
        database,
        `SELECT 1 AS current WHERE ${CURRENT_PLATFORM_COMMAND}`,
        platformCommandValues(namespace, ctx.orgId, request),
      );
      if (!current) return { kind: 'stale' };
      return {
        kind: 'applied',
        environments: await service.listEnvironments(ctx, { projectId: request.projectId }),
      };
    },
    async findOrganizationForEnvironment(request): Promise<ConsoleOrganization | null> {
      const values: unknown[] = [namespace, request.environmentId];
      let projectFilter = '';
      if (request.projectId) {
        values.push(request.projectId);
        projectFilter = ' AND e.project_id = ?';
      }
      const row = await queryD1One(
        database,
        `SELECT o.* FROM environments e JOIN organizations o ON o.namespace = e.namespace AND o.id = e.org_id
         WHERE e.namespace = ? AND e.id = ?${projectFilter} LIMIT 1`,
        values,
      );
      if (!row) return null;
      if (row.status !== 'ACTIVE') throw new Error('Invalid organization status');
      return {
        id: String(row.id),
        name: String(row.name),
        slug: String(row.slug),
        status: 'ACTIVE',
        createdAt: toIso(toNumber(row.created_at_ms)),
        updatedAt: toIso(toNumber(row.updated_at_ms)),
      };
    },
    async provisionProjectEnvironments(
      ctx,
      request: ProvisionConsoleWalletEnvironmentsRequest,
    ): Promise<ConsoleWalletEnvironment[]> {
      await requireActiveProject({
        database,
        namespace,
        orgId: ctx.orgId,
        projectId: request.projectId,
      });
      await database.batch(
        buildDefaultEnvironmentInserts({
          database,
          namespace,
          orgId: ctx.orgId,
          projectId: request.projectId,
          liveAccess: request.liveAccess,
          createdAtMs: nowMs(now()),
        }),
      );
      return service.listEnvironments(ctx, { projectId: request.projectId });
    },
    async archiveProjectEnvironments(ctx, projectId): Promise<ConsoleWalletEnvironment[]> {
      await database
        .prepare(
          `UPDATE environments SET status = 'ARCHIVED', updated_at_ms = ? WHERE namespace = ? AND org_id = ? AND project_id = ?`,
        )
        .bind(nowMs(now()), namespace, ctx.orgId, projectId)
        .run();
      return service.listEnvironments(ctx, { projectId });
    },
    async listEnvironments(
      ctx,
      request?: ListConsoleWalletEnvironmentsRequest,
    ): Promise<ConsoleWalletEnvironment[]> {
      const values: unknown[] = [namespace, ctx.orgId];
      let projectFilter = '';
      let statusFilter = '';
      if (request?.projectId) {
        values.push(request.projectId);
        projectFilter = ' AND project_id = ?';
      }
      if (request?.status) {
        values.push(request.status);
        statusFilter = ' AND status = ?';
      }
      const rows = await queryD1All(
        database,
        `SELECT *
           FROM environments
          WHERE namespace = ?
            AND org_id = ?${projectFilter}${statusFilter}
          ORDER BY updated_at_ms DESC, created_at_ms DESC`,
        values,
      );
      const environments = rows.map(parseEnvironmentRow);
      return sortEnvironments(environments);
    },

    async createEnvironment(
      ctx,
      request: CreateConsoleWalletEnvironmentRequest,
    ): Promise<ConsoleWalletEnvironment> {
      const project = await loadProjectRow({
        database,
        namespace,
        orgId: ctx.orgId,
        projectId: request.projectId,
      });
      if (!project) {
        throw new ConsoleWalletEnvironmentError(
          'project_not_found',
          404,
          `Project ${request.projectId} was not found`,
        );
      }
      if (project.status === 'ARCHIVED') {
        throw new ConsoleWalletEnvironmentError(
          'project_archived',
          409,
          `Project ${request.projectId} is archived`,
        );
      }

      const duplicateKey = await queryD1One(
        database,
        `SELECT id
           FROM environments
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_key = ?
          LIMIT 1`,
        [namespace, ctx.orgId, request.projectId, request.key],
      );
      if (duplicateKey) {
        throw new ConsoleWalletEnvironmentError(
          'environment_key_conflict',
          409,
          `Environment key ${request.key} already exists for project ${request.projectId}`,
        );
      }

      const currentNow = now();
      const currentNowMs = nowMs(currentNow);
      const environmentId = String(request.id || makeResourceId('env', currentNow)).trim();
      const existingEnvironmentId = await findEnvironmentId({
        database,
        namespace,
        environmentId,
      });
      if (existingEnvironmentId) {
        throw new ConsoleWalletEnvironmentError(
          'environment_already_exists',
          409,
          `Environment ${environmentId} already exists`,
        );
      }

      try {
        await database
          .prepare(
            `INSERT INTO environments
              (namespace, id, org_id, project_id, env_key, runtime_version, name, status, created_at_ms, updated_at_ms)
             VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            namespace,
            environmentId,
            ctx.orgId,
            request.projectId,
            request.key,
            normalizeSigningRootVersion(request.signingRootVersion),
            request.name || environmentNameFromKey(request.key),
            request.status,
            currentNowMs,
            currentNowMs,
          )
          .run();
      } catch (error: unknown) {
        if (!isD1ConstraintError(error)) throw error;
        throw new ConsoleWalletEnvironmentError(
          'environment_already_exists',
          409,
          `Environment ${environmentId} already exists`,
        );
      }

      const environment = await loadEnvironment({
        database,
        namespace,
        orgId: ctx.orgId,
        environmentId,
      });
      if (!environment) {
        throw new ConsoleWalletEnvironmentError(
          'environment_not_found',
          404,
          `Environment ${environmentId} was not found`,
        );
      }
      return environment;
    },

    async updateEnvironment(
      ctx,
      environmentId: string,
      request: UpdateConsoleWalletEnvironmentRequest,
    ): Promise<ConsoleWalletEnvironment | null> {
      const current = await loadEnvironmentRow({
        database,
        namespace,
        orgId: ctx.orgId,
        environmentId,
      });
      if (!current) return null;
      if (parseEnvironmentStatus(current.status) === 'ARCHIVED') {
        throw new ConsoleWalletEnvironmentError(
          'environment_archived',
          409,
          `Environment ${environmentId} is archived and cannot be updated`,
        );
      }
      const nextName = request.name || String(current.name || '');
      const nextRuntimeVersion =
        request.signingRootVersion !== undefined
          ? normalizeSigningRootVersion(request.signingRootVersion)
          : normalizeSigningRootVersion(
              current.runtime_version,
              DEFAULT_WALLET_SIGNING_ROOT_VERSION,
            );
      await database
        .prepare(
          `UPDATE environments
              SET name = ?,
                  runtime_version = ?,
                  updated_at_ms = ?
            WHERE namespace = ?
              AND org_id = ?
              AND id = ?`,
        )
        .bind(nextName, nextRuntimeVersion, nowMs(now()), namespace, ctx.orgId, environmentId)
        .run();
      return await loadEnvironment({ database, namespace, orgId: ctx.orgId, environmentId });
    },

    async archiveEnvironment(ctx, environmentId: string): Promise<ConsoleWalletEnvironment | null> {
      const result = await database
        .prepare(
          `UPDATE environments
              SET status = 'ARCHIVED',
                  updated_at_ms = ?
            WHERE namespace = ?
              AND org_id = ?
              AND id = ?`,
        )
        .bind(nowMs(now()), namespace, ctx.orgId, environmentId)
        .run();
      if (d1ChangedRows(result) !== 1) return null;
      return await loadEnvironment({ database, namespace, orgId: ctx.orgId, environmentId });
    },
  };
  return service;
}
