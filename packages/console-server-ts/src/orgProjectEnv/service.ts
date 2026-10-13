import { secureRandomBase36 } from '../boundary';
import { ConsoleOrgProjectError } from './errors';
import type {
  CreateConsoleProjectRequest,
  ConsoleOrganization,
  ConsoleProject,
  ListConsoleProjectsRequest,
  SearchConsoleOrganizationsRequest,
  UpsertConsoleOrganizationRequest,
  UpdateConsoleProjectRequest,
} from './types';

export interface ConsoleOrgProjectContext {
  orgId: string;
  actorUserId: string;
  projectId?: string;
}

export interface ConsoleOrgProjectService {
  getOrganization(ctx: ConsoleOrgProjectContext): Promise<ConsoleOrganization>;
  findDefaultOrganization(): Promise<ConsoleOrganization | null>;
  searchOrganizations(request: SearchConsoleOrganizationsRequest): Promise<ConsoleOrganization[]>;
  findOrganizationForProject(request: { projectId: string }): Promise<ConsoleOrganization | null>;
  upsertOrganization(
    ctx: ConsoleOrgProjectContext,
    request: UpsertConsoleOrganizationRequest,
  ): Promise<ConsoleOrganization>;
  deleteOrganization(
    ctx: ConsoleOrgProjectContext,
  ): Promise<{ deleted: boolean; organization: ConsoleOrganization | null }>;
  listProjects(
    ctx: ConsoleOrgProjectContext,
    request?: ListConsoleProjectsRequest,
  ): Promise<ConsoleProject[]>;
  createProject(
    ctx: ConsoleOrgProjectContext,
    request: CreateConsoleProjectRequest,
  ): Promise<ConsoleProject>;
  updateProject(
    ctx: ConsoleOrgProjectContext,
    projectId: string,
    request: UpdateConsoleProjectRequest,
  ): Promise<ConsoleProject | null>;
  archiveProject(ctx: ConsoleOrgProjectContext, projectId: string): Promise<ConsoleProject | null>;
}

export interface InMemoryConsoleOrgProjectServiceOptions {
  now?: () => Date;
}

interface OrgStore {
  org: ConsoleOrganization;
  projects: Map<string, ConsoleProject>;
}

function toIso(date: Date): string {
  return date.toISOString();
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

function sortProjects(items: ConsoleProject[]): ConsoleProject[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sortOrganizations(items: ConsoleOrganization[]): ConsoleOrganization[] {
  return [...items].sort((a, b) => {
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
    return a.id.localeCompare(b.id);
  });
}

function sortOrganizationsByCreatedAtDesc(items: ConsoleOrganization[]): ConsoleOrganization[] {
  return [...items].sort((a, b) => {
    const createdAtDiff = b.createdAt.localeCompare(a.createdAt);
    if (createdAtDiff !== 0) return createdAtDiff;
    return a.id.localeCompare(b.id);
  });
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

function cloneOrg(org: ConsoleOrganization): ConsoleOrganization {
  return { ...org };
}

function cloneProject(project: ConsoleProject): ConsoleProject {
  return { ...project };
}

export function createInMemoryConsoleOrgProjectService(
  opts: InMemoryConsoleOrgProjectServiceOptions = {},
): ConsoleOrgProjectService {
  const now = opts.now || (() => new Date());
  const stores = new Map<string, OrgStore>();

  function createOrgStore(ctx: ConsoleOrgProjectContext): OrgStore {
    const currentNow = now();
    const createdAt = toIso(currentNow);
    const defaultName = humanizeId(ctx.orgId, 'Organization');
    const store: OrgStore = {
      org: {
        id: ctx.orgId,
        name: defaultName,
        slug: slugify(defaultName),
        status: 'ACTIVE',
        createdAt,
        updatedAt: createdAt,
      },
      projects: new Map<string, ConsoleProject>(),
    };
    stores.set(ctx.orgId, store);
    return store;
  }

  function getOrgStore(ctx: ConsoleOrgProjectContext): OrgStore | undefined {
    return stores.get(ctx.orgId);
  }

  function ensureOrgStoreForWrite(ctx: ConsoleOrgProjectContext): OrgStore {
    const store = stores.get(ctx.orgId);
    if (!store) return createOrgStore(ctx);
    return store;
  }

  return {
    async getOrganization(ctx): Promise<ConsoleOrganization> {
      const store = getOrgStore(ctx);
      if (!store) {
        throw new ConsoleOrgProjectError(
          'organization_not_found',
          404,
          `Organization ${ctx.orgId} was not found`,
        );
      }
      return cloneOrg(store.org);
    },

    async findDefaultOrganization(): Promise<ConsoleOrganization | null> {
      const organizations = sortOrganizations(
        Array.from(stores.values()).map((store) => cloneOrg(store.org)),
      );
      if (organizations.length !== 1) return null;
      return cloneOrg(organizations[0]!);
    },

    async searchOrganizations(request): Promise<ConsoleOrganization[]> {
      const query = normalizeOrganizationSearchValue(request.query);
      const rawLimit = Number(request.limit || 0);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.max(1, Math.floor(rawLimit)) : 10;
      if (!query) {
        return sortOrganizationsByCreatedAtDesc(
          Array.from(stores.values()).map((store) => cloneOrg(store.org)),
        )
          .slice(0, limit)
          .map((organization) => cloneOrg(organization));
      }
      const organizations: ConsoleOrganization[] = [];
      for (const store of stores.values()) {
        const organization = cloneOrg(store.org);
        const score = scoreOrganizationSearchResult(query, organization);
        if (!Number.isFinite(score)) continue;
        organizations.push(organization);
      }
      return sortOrganizationSearchResults(organizations, query)
        .slice(0, limit)
        .map((organization) => cloneOrg(organization));
    },

    async findOrganizationForProject(request): Promise<ConsoleOrganization | null> {
      for (const store of stores.values()) {
        if (store.projects.has(request.projectId)) return cloneOrg(store.org);
      }
      return null;
    },

    async upsertOrganization(
      ctx,
      request: UpsertConsoleOrganizationRequest,
    ): Promise<ConsoleOrganization> {
      const store = ensureOrgStoreForWrite(ctx);
      const currentNow = now();
      const defaultName = humanizeId(ctx.orgId, 'Organization');
      const nextName = String(request.name || '').trim() || store.org.name || defaultName;
      const nextSlug =
        String(request.slug || '').trim() || store.org.slug || slugify(nextName || defaultName);
      store.org.name = nextName;
      store.org.slug = slugify(nextSlug);
      store.org.updatedAt = toIso(currentNow);
      return cloneOrg(store.org);
    },

    async deleteOrganization(
      ctx,
    ): Promise<{ deleted: boolean; organization: ConsoleOrganization | null }> {
      const store = stores.get(ctx.orgId);
      if (!store) return { deleted: false, organization: null };
      const organization = cloneOrg(store.org);
      stores.delete(ctx.orgId);
      return { deleted: true, organization };
    },

    async listProjects(ctx, request?: ListConsoleProjectsRequest): Promise<ConsoleProject[]> {
      const store = getOrgStore(ctx);
      if (!store) return [];
      const rows = Array.from(store.projects.values()).filter(
        (project) => !request?.status || project.status === request.status,
      );
      return sortProjects(rows).map(cloneProject);
    },

    async createProject(ctx, request: CreateConsoleProjectRequest): Promise<ConsoleProject> {
      const store = getOrgStore(ctx);
      if (!store) {
        throw new ConsoleOrgProjectError(
          'organization_not_found',
          404,
          `Organization ${ctx.orgId} was not found`,
        );
      }
      const currentNow = now();
      const projectId = String(request.id || makeResourceId('proj', currentNow)).trim();
      if (store.projects.has(projectId)) {
        throw new ConsoleOrgProjectError(
          'project_already_exists',
          409,
          `Project ${projectId} already exists`,
        );
      }
      const ts = toIso(currentNow);
      const project: ConsoleProject = {
        id: projectId,
        orgId: ctx.orgId,
        name: request.name,
        slug: slugify(request.name),
        status: 'ACTIVE',
        createdAt: ts,
        updatedAt: ts,
      };
      store.projects.set(projectId, project);
      return cloneProject(project);
    },

    async updateProject(
      ctx,
      projectId: string,
      request: UpdateConsoleProjectRequest,
    ): Promise<ConsoleProject | null> {
      const store = getOrgStore(ctx);
      if (!store) return null;
      const current = store.projects.get(projectId);
      if (!current) return null;
      if (current.status === 'ARCHIVED') {
        throw new ConsoleOrgProjectError(
          'project_archived',
          409,
          `Project ${projectId} is archived and cannot be updated`,
        );
      }
      const currentNow = now();
      if (request.name) {
        current.name = request.name;
        current.slug = slugify(request.name);
      }
      current.updatedAt = toIso(currentNow);
      return cloneProject(current);
    },

    async archiveProject(ctx, projectId: string): Promise<ConsoleProject | null> {
      const store = getOrgStore(ctx);
      if (!store) return null;
      const current = store.projects.get(projectId);
      if (!current) return null;
      const currentNow = now();
      const ts = toIso(currentNow);
      current.status = 'ARCHIVED';
      current.updatedAt = ts;
      return cloneProject(current);
    },
  };
}
