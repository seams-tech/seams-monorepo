import { normalizeLogger, type Logger } from '../boundary';
import type { ConsoleOrganization, ConsoleProject } from '../orgProjectEnv/types';
import type { ConsoleOrgProjectService } from '../orgProjectEnv/service';
import type { ConsoleOrganizationAccessService } from '../teamRbac/service';
import { isConsoleOrganizationAccessError } from '../teamRbac/errors';
import { ConsoleOnboardingError } from './errors';
import type { ConsoleTeamSignupAlertPort } from './signupAlert';
import type { ConsoleOnboardingWelcomeEmailPort } from './welcomeEmail';
import type {
  ConsoleOnboardingState,
  ConsoleOnboardingTelemetryAlert,
  ConsoleOnboardingTelemetryOperation,
  ConsoleOnboardingTelemetrySnapshot,
  ConsoleOnboardingOperationTelemetrySnapshot,
  CreateConsoleOnboardingOrganizationRequest,
  CreateConsoleOnboardingOrganizationResult,
  CreateConsoleOnboardingProjectRequest,
  CreateConsoleOnboardingProjectResult,
  GetConsoleOnboardingStateRequest,
  GetConsoleOnboardingTelemetryRequest,
} from './types';

export interface ConsoleOnboardingContext {
  readonly orgId: string;
  readonly actorUserId: string;
  readonly actorEmail: string;
  readonly actorDisplayName: string | null;
  readonly projectId: string | null;
  readonly environmentId?: never;
}

export interface ConsoleOnboardingService {
  getOnboardingState(
    ctx: ConsoleOnboardingContext,
    request?: GetConsoleOnboardingStateRequest,
  ): Promise<ConsoleOnboardingState>;
  getOnboardingTelemetry(
    ctx: ConsoleOnboardingContext,
    request?: GetConsoleOnboardingTelemetryRequest,
  ): Promise<ConsoleOnboardingTelemetrySnapshot>;
  createOnboardingOrganization(
    ctx: ConsoleOnboardingContext,
    request: CreateConsoleOnboardingOrganizationRequest,
  ): Promise<CreateConsoleOnboardingOrganizationResult>;
  createOnboardingProject(
    ctx: ConsoleOnboardingContext,
    request: CreateConsoleOnboardingProjectRequest,
  ): Promise<CreateConsoleOnboardingProjectResult>;
}

export interface InMemoryConsoleOnboardingServiceOptions {
  orgProjectEnv: ConsoleOrgProjectService;
  organizationAccess: ConsoleOrganizationAccessService;
  welcomeEmail?: ConsoleOnboardingWelcomeEmailPort | null;
  teamSignupAlert?: ConsoleTeamSignupAlertPort | null;
  logger?: Logger | null;
  telemetry?: {
    windowMinutes?: number;
    retentionMinutes?: number;
    p95LatencyMs?: Partial<Record<ConsoleOnboardingTelemetryOperation, number>>;
    errorRatePercentThreshold?: number;
  };
}

interface ResolveProjectInput {
  id?: string;
  name: string;
}

function normalizeString(raw: unknown): string {
  return String(raw || '').trim();
}

function toOrgProjectEnvContext(ctx: ConsoleOnboardingContext): {
  orgId: string;
  actorUserId: string;
  projectId?: string;
} {
  return {
    orgId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
  };
}

function isActiveStatus(value: unknown): boolean {
  return normalizeString(value).toUpperCase() === 'ACTIVE';
}

function isActiveProject(project: ConsoleProject): boolean {
  return isActiveStatus(project.status);
}

function findProject(
  projects: readonly ConsoleProject[],
  projectId: string | null,
): ConsoleProject | undefined {
  for (const project of projects) {
    if (project.id === projectId) return project;
  }
  return undefined;
}

function buildOrganizationOnboardingState(orgId: string): ConsoleOnboardingState {
  return {
    orgId,
    organization: null,
    activeProjectCount: 0,
    hasOrganization: false,
    hasProject: false,
    accountReady: true,
    organizationReady: false,
    projectReady: false,
    onboardingComplete: false,
    currentStep: 'organization',
    complete: false,
    selectedProjectId: null,
  };
}

function buildProjectOnboardingState(organization: ConsoleOrganization): ConsoleOnboardingState {
  return {
    orgId: organization.id,
    organization,
    activeProjectCount: 0,
    hasOrganization: true,
    hasProject: false,
    accountReady: true,
    organizationReady: true,
    projectReady: false,
    onboardingComplete: false,
    currentStep: 'project',
    complete: false,
    selectedProjectId: null,
  };
}

function buildCompleteOnboardingState(
  organization: ConsoleOrganization,
  project: ConsoleProject,
  activeProjectCount: number,
): ConsoleOnboardingState {
  return {
    orgId: organization.id,
    organization,
    activeProjectCount,
    hasOrganization: true,
    hasProject: true,
    accountReady: true,
    organizationReady: true,
    projectReady: true,
    onboardingComplete: true,
    currentStep: 'complete',
    complete: true,
    selectedProjectId: project.id,
  };
}

function buildOnboardingState(
  orgId: string,
  organization: ConsoleOrganization | null,
  activeProjects: readonly ConsoleProject[],
  requestedProjectId: string | null,
): ConsoleOnboardingState {
  if (!organization) return buildOrganizationOnboardingState(orgId);
  const project = findProject(activeProjects, requestedProjectId) ?? activeProjects[0];
  if (!project) return buildProjectOnboardingState(organization);
  return buildCompleteOnboardingState(organization, project, activeProjects.length);
}

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  if (!('code' in error)) return '';
  return normalizeString((error as { code?: unknown }).code);
}

function requireActiveProject(
  project: ConsoleProject | undefined,
  projectId: string,
): ConsoleProject {
  if (!project) {
    throw new ConsoleOnboardingError(
      'project_not_found',
      404,
      `Project ${projectId} was not found for onboarding`,
    );
  }
  if (!isActiveStatus(project.status)) {
    throw new ConsoleOnboardingError(
      'project_archived',
      409,
      `Project ${projectId} is archived and cannot be used for onboarding`,
    );
  }
  return project;
}

const DEFAULT_TELEMETRY_WINDOW_MINUTES = 15;
const DEFAULT_TELEMETRY_RETENTION_MINUTES = 24 * 60;
const MIN_TELEMETRY_WINDOW_MINUTES = 1;
const MAX_TELEMETRY_WINDOW_MINUTES = 24 * 60;
const DEFAULT_TELEMETRY_ERROR_RATE_THRESHOLD_PERCENT = 5;
const CRITICAL_BREACH_MULTIPLIER = 2;
const ONBOARDING_TELEMETRY_OPERATIONS: ConsoleOnboardingTelemetryOperation[] = [
  'state',
  'organization',
  'project',
];

const DEFAULT_TELEMETRY_P95_TARGETS: Record<ConsoleOnboardingTelemetryOperation, number> = {
  state: 400,
  organization: 1200,
  project: 1800,
};

interface OnboardingTelemetrySample {
  atMs: number;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
}

interface OrgOnboardingTelemetryStore {
  samples: Record<ConsoleOnboardingTelemetryOperation, OnboardingTelemetrySample[]>;
  lastAlertSignature: string;
}

function coerceIntegerInRange(input: {
  value: number | undefined;
  fallback: number;
  min: number;
  max: number;
}): number {
  const numeric = Number(input.value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return input.fallback;
  if (numeric < input.min || numeric > input.max) return input.fallback;
  return numeric;
}

function coercePositiveNumber(value: number | undefined, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function percentileFromSorted(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const p = Math.max(0, Math.min(1, percentile));
  const index = Math.ceil(sorted.length * p) - 1;
  const bounded = Math.max(0, Math.min(sorted.length - 1, index));
  return sorted[bounded];
}

function createEmptyTelemetrySamples(): Record<
  ConsoleOnboardingTelemetryOperation,
  OnboardingTelemetrySample[]
> {
  return {
    state: [],
    organization: [],
    project: [],
  };
}

function telemetryDurationMs(startMs: number, endMs: number): number {
  const duration = endMs - startMs;
  if (!Number.isFinite(duration) || duration < 0) return 0;
  return duration;
}

function buildOperationTelemetrySnapshot(input: {
  operation: ConsoleOnboardingTelemetryOperation;
  samples: OnboardingTelemetrySample[];
  nowMs: number;
  windowMinutes: number;
  p95LatencyMsThreshold: number;
  errorRatePercentThreshold: number;
}): ConsoleOnboardingOperationTelemetrySnapshot {
  const windowMs = input.windowMinutes * 60_000;
  const floorMs = input.nowMs - windowMs;
  const latencies: number[] = [];
  let successCount = 0;
  let totalLatencyMs = 0;
  for (const sample of input.samples) {
    if (sample.atMs < floorMs) continue;
    latencies.push(sample.durationMs);
    totalLatencyMs += sample.durationMs;
    if (sample.ok) successCount += 1;
  }
  const requestCount = latencies.length;
  const errorCount = requestCount - successCount;
  const errorRatePercent = requestCount > 0 ? round2((errorCount / requestCount) * 100) : 0;
  latencies.sort(compareNumbers);
  const latencyMaxMs = latencies.length > 0 ? latencies[latencies.length - 1] : 0;
  const latencyAvgMs = latencies.length > 0 ? round2(totalLatencyMs / latencies.length) : 0;
  const latencyP50Ms = round2(percentileFromSorted(latencies, 0.5));
  const latencyP95Ms = round2(percentileFromSorted(latencies, 0.95));
  const p95LatencyOk = latencyP95Ms <= input.p95LatencyMsThreshold;
  const errorRateOk = errorRatePercent <= input.errorRatePercentThreshold;
  return {
    operation: input.operation,
    requestCount,
    successCount,
    errorCount,
    errorRatePercent,
    latencyAvgMs,
    latencyP50Ms,
    latencyP95Ms,
    latencyMaxMs,
    slo: {
      p95LatencyMsThreshold: input.p95LatencyMsThreshold,
      errorRatePercentThreshold: input.errorRatePercentThreshold,
      p95LatencyOk,
      errorRateOk,
    },
  };
}

function buildSloAlerts(input: {
  operation: ConsoleOnboardingTelemetryOperation;
  snapshot: ConsoleOnboardingOperationTelemetrySnapshot;
}): ConsoleOnboardingTelemetryAlert[] {
  if (input.snapshot.requestCount <= 0) return [];
  const alerts: ConsoleOnboardingTelemetryAlert[] = [];
  const latencyThreshold = input.snapshot.slo.p95LatencyMsThreshold;
  const errorRateThreshold = input.snapshot.slo.errorRatePercentThreshold;

  if (!input.snapshot.slo.p95LatencyOk) {
    const severity: 'WARN' | 'CRITICAL' =
      input.snapshot.latencyP95Ms > latencyThreshold * CRITICAL_BREACH_MULTIPLIER
        ? 'CRITICAL'
        : 'WARN';
    alerts.push({
      code: 'onboarding_latency_slo_breached',
      operation: input.operation,
      severity,
      message: `p95 latency ${input.snapshot.latencyP95Ms}ms exceeds SLO target ${latencyThreshold}ms`,
    });
  }
  if (!input.snapshot.slo.errorRateOk) {
    const severity: 'WARN' | 'CRITICAL' =
      input.snapshot.errorRatePercent > errorRateThreshold * CRITICAL_BREACH_MULTIPLIER
        ? 'CRITICAL'
        : 'WARN';
    alerts.push({
      code: 'onboarding_error_rate_slo_breached',
      operation: input.operation,
      severity,
      message: `Error rate ${input.snapshot.errorRatePercent}% exceeds SLO target ${errorRateThreshold}%`,
    });
  }
  return alerts;
}

function alertSignature(alerts: ConsoleOnboardingTelemetryAlert[]): string {
  const entries: string[] = [];
  for (const alert of alerts) entries.push(`${alert.code}:${alert.operation}:${alert.severity}`);
  return entries.sort().join('|');
}

class InMemoryConsoleOnboardingService implements ConsoleOnboardingService {
  readonly #orgProjectEnv: ConsoleOrgProjectService;
  readonly #organizationAccess: ConsoleOrganizationAccessService;
  readonly #welcomeEmail: ConsoleOnboardingWelcomeEmailPort | null;
  readonly #teamSignupAlert: ConsoleTeamSignupAlertPort | null;
  readonly #logger: ReturnType<typeof normalizeLogger>;
  readonly #telemetryWindowMinutes: number;
  readonly #telemetryRetentionMinutes: number;
  readonly #telemetryErrorRatePercentThreshold: number;
  readonly #telemetryP95LatencyMsThresholds: Record<ConsoleOnboardingTelemetryOperation, number>;
  readonly #telemetryByOrg = new Map<string, OrgOnboardingTelemetryStore>();

  constructor(options: InMemoryConsoleOnboardingServiceOptions) {
    this.#orgProjectEnv = options.orgProjectEnv;
    this.#organizationAccess = options.organizationAccess;
    this.#welcomeEmail = options.welcomeEmail ?? null;
    this.#teamSignupAlert = options.teamSignupAlert ?? null;
    this.#logger = normalizeLogger(options.logger);
    this.#telemetryWindowMinutes = coerceIntegerInRange({
      value: options.telemetry?.windowMinutes,
      fallback: DEFAULT_TELEMETRY_WINDOW_MINUTES,
      min: MIN_TELEMETRY_WINDOW_MINUTES,
      max: MAX_TELEMETRY_WINDOW_MINUTES,
    });
    this.#telemetryRetentionMinutes = coerceIntegerInRange({
      value: options.telemetry?.retentionMinutes,
      fallback: DEFAULT_TELEMETRY_RETENTION_MINUTES,
      min: this.#telemetryWindowMinutes,
      max: MAX_TELEMETRY_WINDOW_MINUTES,
    });
    this.#telemetryErrorRatePercentThreshold = coercePositiveNumber(
      options.telemetry?.errorRatePercentThreshold,
      DEFAULT_TELEMETRY_ERROR_RATE_THRESHOLD_PERCENT,
    );
    this.#telemetryP95LatencyMsThresholds = {
      state: coercePositiveNumber(
        options.telemetry?.p95LatencyMs?.state,
        DEFAULT_TELEMETRY_P95_TARGETS.state,
      ),
      organization: coercePositiveNumber(
        options.telemetry?.p95LatencyMs?.organization,
        DEFAULT_TELEMETRY_P95_TARGETS.organization,
      ),
      project: coercePositiveNumber(
        options.telemetry?.p95LatencyMs?.project,
        DEFAULT_TELEMETRY_P95_TARGETS.project,
      ),
    };
  }

  #resolveTelemetryWindowMinutes(
    request: GetConsoleOnboardingTelemetryRequest | undefined,
  ): number {
    const requestedWindow = request?.windowMinutes;
    return coerceIntegerInRange({
      value: requestedWindow,
      fallback: this.#telemetryWindowMinutes,
      min: MIN_TELEMETRY_WINDOW_MINUTES,
      max: MAX_TELEMETRY_WINDOW_MINUTES,
    });
  }

  #resolveOrgTelemetryStore(orgId: string): OrgOnboardingTelemetryStore {
    const existing = this.#telemetryByOrg.get(orgId);
    if (existing) return existing;
    const created: OrgOnboardingTelemetryStore = {
      samples: createEmptyTelemetrySamples(),
      lastAlertSignature: '',
    };
    this.#telemetryByOrg.set(orgId, created);
    return created;
  }

  #pruneTelemetrySamples(store: OrgOnboardingTelemetryStore, nowMs: number): void {
    const retentionFloorMs = nowMs - this.#telemetryRetentionMinutes * 60_000;
    for (const operation of ONBOARDING_TELEMETRY_OPERATIONS) {
      const retained: OnboardingTelemetrySample[] = [];
      for (const sample of store.samples[operation]) {
        if (sample.atMs >= retentionFloorMs) retained.push(sample);
      }
      store.samples[operation] = retained;
    }
  }

  #buildTelemetrySnapshot(input: {
    orgId: string;
    nowMs: number;
    windowMinutes: number;
  }): ConsoleOnboardingTelemetrySnapshot {
    const store = this.#resolveOrgTelemetryStore(input.orgId);
    this.#pruneTelemetrySamples(store, input.nowMs);
    const operations: ConsoleOnboardingOperationTelemetrySnapshot[] = [];
    const alerts: ConsoleOnboardingTelemetryAlert[] = [];
    for (const operation of ONBOARDING_TELEMETRY_OPERATIONS) {
      const snapshot = buildOperationTelemetrySnapshot({
        operation,
        samples: store.samples[operation],
        nowMs: input.nowMs,
        windowMinutes: input.windowMinutes,
        p95LatencyMsThreshold: this.#telemetryP95LatencyMsThresholds[operation],
        errorRatePercentThreshold: this.#telemetryErrorRatePercentThreshold,
      });
      operations.push(snapshot);
      alerts.push(...buildSloAlerts({ operation, snapshot }));
    }
    return {
      orgId: input.orgId,
      generatedAt: new Date(input.nowMs).toISOString(),
      windowMinutes: input.windowMinutes,
      operations,
      alerts,
    };
  }

  #logTelemetryAlerts(input: {
    orgId: string;
    snapshot: ConsoleOnboardingTelemetrySnapshot;
    store: OrgOnboardingTelemetryStore;
  }): void {
    const nextSignature = alertSignature(input.snapshot.alerts);
    if (nextSignature === input.store.lastAlertSignature) return;

    if (!nextSignature && input.store.lastAlertSignature) {
      this.#logger.info('[console-onboarding][telemetry] onboarding SLO alerts resolved', {
        orgId: input.orgId,
      });
      input.store.lastAlertSignature = '';
      return;
    }

    for (const alert of input.snapshot.alerts) {
      this.#logger.warn('[console-onboarding][telemetry] onboarding SLO alert', {
        orgId: input.orgId,
        code: alert.code,
        operation: alert.operation,
        severity: alert.severity,
        message: alert.message,
      });
    }
    input.store.lastAlertSignature = nextSignature;
  }

  #recordTelemetrySample(input: {
    ctx: ConsoleOnboardingContext;
    operation: ConsoleOnboardingTelemetryOperation;
    startedAtMs: number;
    endedAtMs: number;
    ok: boolean;
    errorCode?: string;
  }): void {
    const store = this.#resolveOrgTelemetryStore(input.ctx.orgId);
    this.#pruneTelemetrySamples(store, input.endedAtMs);
    store.samples[input.operation].push({
      atMs: input.endedAtMs,
      durationMs: telemetryDurationMs(input.startedAtMs, input.endedAtMs),
      ok: input.ok,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    });
    const snapshot = this.#buildTelemetrySnapshot({
      orgId: input.ctx.orgId,
      nowMs: input.endedAtMs,
      windowMinutes: this.#telemetryWindowMinutes,
    });
    this.#logTelemetryAlerts({
      orgId: input.ctx.orgId,
      snapshot,
      store,
    });
  }

  async #withTelemetry<T>(input: {
    ctx: ConsoleOnboardingContext;
    operation: ConsoleOnboardingTelemetryOperation;
    run: () => Promise<T>;
  }): Promise<T> {
    const startedAtMs = Date.now();
    try {
      const result = await input.run();
      this.#recordTelemetrySample({
        ctx: input.ctx,
        operation: input.operation,
        startedAtMs,
        endedAtMs: Date.now(),
        ok: true,
      });
      return result;
    } catch (error: unknown) {
      this.#recordTelemetrySample({
        ctx: input.ctx,
        operation: input.operation,
        startedAtMs,
        endedAtMs: Date.now(),
        ok: false,
        errorCode: readErrorCode(error) || 'unknown_error',
      });
      throw error;
    }
  }

  async #ensureOwner(ctx: ConsoleOnboardingContext): Promise<{ created: boolean }> {
    try {
      const authorization = await this.#organizationAccess.lookupAuthorization({
        orgId: ctx.orgId,
        userId: ctx.actorUserId,
      });
      if (authorization?.kind === 'authorized' && authorization.role === 'OWNER') {
        return { created: false };
      }
      await this.#organizationAccess.bootstrapInitialOwner({
        orgId: ctx.orgId,
        userId: ctx.actorUserId,
        email: ctx.actorEmail,
        displayName: ctx.actorDisplayName,
      });
      return { created: true };
    } catch (error: unknown) {
      if (isConsoleOrganizationAccessError(error)) {
        throw new ConsoleOnboardingError(
          error.code,
          error.status,
          error.message,
          error.details ? { ...error.details } : undefined,
        );
      }
      throw error;
    }
  }

  async #upsertOrganizationProfile(
    ctx: ConsoleOnboardingContext,
    request: {
      name?: string;
      slug?: string;
    },
  ): Promise<{ organization: ConsoleOrganization; created: boolean }> {
    const orgCtx = toOrgProjectEnvContext(ctx);
    let existing: ConsoleOrganization | null = null;
    try {
      existing = await this.#orgProjectEnv.getOrganization(orgCtx);
    } catch (error: unknown) {
      if (readErrorCode(error) !== 'organization_not_found') {
        throw error;
      }
    }
    const organization = await this.#orgProjectEnv.upsertOrganization(orgCtx, request);
    return {
      organization,
      created: existing == null,
    };
  }

  async #resolveState(ctx: ConsoleOnboardingContext): Promise<{
    organization: ConsoleOrganization | null;
    state: ConsoleOnboardingState;
  }> {
    const orgCtx = toOrgProjectEnvContext(ctx);
    let organization: ConsoleOrganization | null = null;
    try {
      organization = await this.#orgProjectEnv.getOrganization(orgCtx);
    } catch (error: unknown) {
      if (readErrorCode(error) !== 'organization_not_found') {
        throw error;
      }
    }
    const projects = await this.#orgProjectEnv.listProjects(orgCtx);
    const activeProjects = projects.filter(isActiveProject);
    return {
      organization,
      state: buildOnboardingState(ctx.orgId, organization, activeProjects, ctx.projectId),
    };
  }

  async #ensureProject(
    ctx: ConsoleOnboardingContext,
    request: ResolveProjectInput,
  ): Promise<{ project: ConsoleProject; created: boolean }> {
    const orgCtx = toOrgProjectEnvContext(ctx);
    const requestedProjectId = normalizeString(request.id);
    const existingProjects = await this.#orgProjectEnv.listProjects(orgCtx);
    if (requestedProjectId) {
      const existing = findProject(existingProjects, requestedProjectId);
      if (existing) {
        return {
          project: requireActiveProject(existing, requestedProjectId),
          created: false,
        };
      }
    }

    try {
      const createdProject = await this.#orgProjectEnv.createProject(orgCtx, {
        ...(requestedProjectId ? { id: requestedProjectId } : {}),
        name: request.name,
      });
      return {
        project: createdProject,
        created: true,
      };
    } catch (error: unknown) {
      const code = readErrorCode(error);
      if (code === 'project_already_exists' && requestedProjectId) {
        const projects = await this.#orgProjectEnv.listProjects(orgCtx);
        const existing = findProject(projects, requestedProjectId);
        return {
          project: requireActiveProject(existing, requestedProjectId),
          created: false,
        };
      }
      throw error;
    }
  }

  async #readState(ctx: ConsoleOnboardingContext): Promise<ConsoleOnboardingState> {
    return (await this.#resolveState(ctx)).state;
  }

  async #createOrganization(
    ctx: ConsoleOnboardingContext,
    request: CreateConsoleOnboardingOrganizationRequest,
  ): Promise<CreateConsoleOnboardingOrganizationResult> {
    const { organization, created } = await this.#upsertOrganizationProfile(ctx, request.org);
    const owner = await this.#ensureOwner(ctx);
    if (created && this.#teamSignupAlert) await this.#alertTeam(ctx, organization);
    return {
      organization,
      created: { organization: created, owner: owner.created },
      state: (await this.#resolveState(ctx)).state,
    };
  }

  /** A new account's first organization; an alert failure never fails the sign-up. */
  async #alertTeam(
    ctx: ConsoleOnboardingContext,
    organization: ConsoleOrganization,
  ): Promise<void> {
    try {
      await this.#teamSignupAlert?.enqueue({
        orgId: ctx.orgId,
        userId: ctx.actorUserId,
        accountEmail: ctx.actorEmail,
        accountDisplayName: ctx.actorDisplayName || ctx.actorEmail,
        organizationName: organization.name || organization.id,
      });
    } catch (error: unknown) {
      this.#logger.warn('[console-onboarding] team sign-up alert was not queued', {
        orgId: ctx.orgId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #createProject(
    ctx: ConsoleOnboardingContext,
    request: CreateConsoleOnboardingProjectRequest,
  ): Promise<CreateConsoleOnboardingProjectResult> {
    const current = await this.#resolveState(ctx);
    if (!current.organization) {
      throw new ConsoleOnboardingError(
        'organization_required',
        409,
        'Organization step must be completed before creating a project',
      );
    }
    await this.#ensureOwner(ctx);
    const { project, created } = await this.#ensureProject(ctx, request.project);
    const state = (await this.#resolveState(ctx)).state;
    if (state.onboardingComplete && this.#welcomeEmail) {
      await this.#welcomeEmail.enqueue({
        orgId: ctx.orgId,
        userId: ctx.actorUserId,
        recipientEmail: ctx.actorEmail,
        recipientDisplayName: ctx.actorDisplayName || ctx.actorEmail,
        organizationName: current.organization.name,
        projectName: project.name,
      });
    }
    return { project, created: { project: created }, state };
  }

  async getOnboardingState(
    ctx: ConsoleOnboardingContext,
    _request: GetConsoleOnboardingStateRequest = {},
  ): Promise<ConsoleOnboardingState> {
    return this.#withTelemetry({ ctx, operation: 'state', run: this.#readState.bind(this, ctx) });
  }

  async getOnboardingTelemetry(
    ctx: ConsoleOnboardingContext,
    request: GetConsoleOnboardingTelemetryRequest = {},
  ): Promise<ConsoleOnboardingTelemetrySnapshot> {
    return this.#buildTelemetrySnapshot({
      orgId: ctx.orgId,
      nowMs: Date.now(),
      windowMinutes: this.#resolveTelemetryWindowMinutes(request),
    });
  }

  async createOnboardingOrganization(
    ctx: ConsoleOnboardingContext,
    request: CreateConsoleOnboardingOrganizationRequest,
  ): Promise<CreateConsoleOnboardingOrganizationResult> {
    return this.#withTelemetry({
      ctx,
      operation: 'organization',
      run: this.#createOrganization.bind(this, ctx, request),
    });
  }

  async createOnboardingProject(
    ctx: ConsoleOnboardingContext,
    request: CreateConsoleOnboardingProjectRequest,
  ): Promise<CreateConsoleOnboardingProjectResult> {
    return this.#withTelemetry({
      ctx,
      operation: 'project',
      run: this.#createProject.bind(this, ctx, request),
    });
  }
}

export function createInMemoryConsoleOnboardingService(
  options: InMemoryConsoleOnboardingServiceOptions,
): ConsoleOnboardingService {
  return new InMemoryConsoleOnboardingService(options);
}
