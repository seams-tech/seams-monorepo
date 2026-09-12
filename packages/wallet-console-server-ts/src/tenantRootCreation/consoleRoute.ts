import { TenantRootSecurityStateUnavailableError } from '../tenantRootSecurity/stateReader';
import type { TenantRootSecurityStateReaderV1 } from '../tenantRootSecurity/consoleRoute';
import type { ConsoleOrgProjectEnvService } from '@seams-internal/console-server/orgProjectEnv/service';
import type { ConsoleAuthAdapter } from '@seams-internal/console-server/router/consoleAuth';
import { authenticateConsoleRequest } from '@seams-internal/console-server/router/consoleAuth';
import {
  verifyFreshStepUpForRequestV1,
  type TenantRootStepUpReaderV1,
} from '../tenantRootSecurity/routeGuard';
import {
  buildTenantRootAuditEventV1,
  type TenantRootAuditEventV1,
  type TenantRootAuditWriterV1,
} from '../tenantRootSecurity/audit';
import { tenantRootStepUpRecordFromProofV1 } from '../tenantRootSecurity/routeGuard';
import {
  resolveTenantRootOperationRecordV1,
  startTenantRootOperationV1,
  type TenantRootOperationEntryV1,
  type TenantRootOperationStoreV1,
} from '../tenantRootSecurity/service';
import {
  buildTenantRootOperationRecordV1,
  parseTenantRootOperationRecordV1,
  tenantRootOperationDigestB64uV1,
  tenantRootOperationMaxLifetimeMsV1,
  tenantRootRecoveryGovernanceDigestB64uV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import { createComposedConsoleRouteDefinitions } from '../router/walletConsoleRouteDefinitions';
import { authorizeConsoleRouteRequest } from '@seams-internal/console-server/router/consoleRoutePolicy';
import { headersToRecord } from '@seams/wallet-server/cloud-host';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '@seams-internal/wallet-console-shared/tenant-root';
import { ROUTER_AB_MPC_ROUTER_ORIGIN } from '@seams/wallet-server/cloud-host';
import {
  randomTenantRootCreationGrantBytesV1,
  signTenantRootCreationGrantV1,
  tenantRootIdentityDigestB64uV1,
} from '@seams/wallet-server/cloud-host';
import { isTenantRootCreationGrantStoreError } from './service';
import type { TenantRootCreationGrantServiceV1 } from './service';
import type { TenantRootCreationGrantRecordV1, TenantRootIdentityV1 } from './types';

export const TENANT_ROOT_CREATION_CONSOLE_PATH_V1 = '/console/tenant-root/creation';
export const TENANT_ROOT_REFRESH_CONSOLE_PATH_V1 = '/console/tenant-root/refresh';
const TENANT_ROOT_CREATION_ROUTER_PATH_V1 = '/router-ab/internal/tenant-root/creation/v1/create';
const TENANT_ROOT_REFRESH_ROUTER_PATH_V1 = '/router-ab/internal/tenant-root/refresh/v1/execute';
const INTERNAL_SERVICE_AUTH_HEADER = 'x-router-ab-internal-service-auth';

export interface TenantRootCreationConsoleRouteDependenciesV1 {
  readonly auth: ConsoleAuthAdapter;
  readonly orgProjectEnv: ConsoleOrgProjectEnvService;
  readonly grants: TenantRootCreationGrantServiceV1;
  readonly router: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  readonly internalServiceAuthSecret: string;
  readonly grantAuthorityKeyId: string;
  readonly grantAuthoritySigningSeedB64u: string;
  readonly now?: () => Date;
}

export interface TenantRootRefreshConsoleRouteDependenciesV1 {
  readonly auth: ConsoleAuthAdapter;
  readonly orgProjectEnv: ConsoleOrgProjectEnvService;
  readonly state: TenantRootSecurityStateReaderV1;
  readonly router: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  readonly internalServiceAuthSecret: string;
  // Required, not optional: a rotation that cannot read step-up must refuse,
  // not proceed. An optional reader would let a mount omit it and silently
  // drop the requirement the route table advertises.
  readonly stepUp: TenantRootStepUpReaderV1;
  readonly audit: TenantRootAuditWriterV1;
  /**
   * Durable rotation tracking, scoped to the resolved tenant root.
   *
   * The request's operationId is its idempotency key. Recorded completions
   * replay locally; unresolved delivery reconciles against the Router.
   */
  readonly operations: (scope: {
    readonly orgId: string;
    readonly identityDigestB64u: string;
    readonly custodyLineageB64u: string;
  }) => TenantRootOperationStoreV1;
  readonly newOperationId?: () => string;
  readonly newNonceB64u?: () => string;
  readonly now?: () => number;
}

/** Recorded when the console could not confirm what the control plane did. */
export const TENANT_ROOT_ROTATION_DISPATCH_UNCERTAIN_V1 = 'dispatch_uncertain';

const ROTATION_OPERATION_KIND = 'tenant_root_operational_share_rotation_v1';

type RouterCreationReadyResponseV1 = {
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly revision: number;
  readonly journalDigestB64u: string;
  readonly capabilityDigestB64u: string;
  readonly rootCommitmentB64u: string;
  readonly replayed: boolean;
};

export type TenantRootRefreshRouterResponseV1 = {
  readonly activationReceiptDigestB64u: string;
  readonly lifecycleRevision: number;
  readonly retirement: TenantRootRefreshRetirementEvidenceV1;
};

export type TenantRootRefreshRetirementEvidenceV1 =
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'unverified' };

export type TenantRootRefreshRouterResultV1 =
  | { readonly kind: 'completed'; readonly value: TenantRootRefreshRouterResponseV1 }
  | { readonly kind: 'throttled'; readonly retryAtMs: number }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'not_due'; readonly nextRunAtMs: number }
  | {
      readonly kind: 'refused';
      readonly code: 'lifecycle_revision_moved' | 'authorization_expired';
    };

export type TenantRootRefreshRouterRequestV1 = {
  readonly operation_id: string;
  readonly identity_digest_b64u: string;
  readonly custody_lineage_b64u: string;
  readonly expected_lifecycle_revision: number;
  readonly expires_at_ms: number;
  readonly trigger: 'manual' | 'scheduled';
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value : '';
  if (
    !text ||
    text.trim() !== text ||
    new TextEncoder().encode(text).length > 256 ||
    hasControlCharacters(text)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

async function parseOperationId(request: Request): Promise<string> {
  const value: unknown = await request.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSON body is required');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'operationId')) {
    throw new Error('Request must contain only operationId');
  }
  return requiredText(record.operationId, 'operationId');
}

function sameIdentity(left: TenantRootIdentityV1, right: TenantRootIdentityV1): boolean {
  return (
    left.orgId === right.orgId &&
    left.projectId === right.projectId &&
    left.envId === right.envId &&
    left.signingRootId === right.signingRootId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

function parseRouterCreationReadyResponse(value: unknown): RouterCreationReadyResponseV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Router returned an invalid tenant-root creation response');
  }
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    throw new Error('Router tenant-root creation did not return a status');
  }
  const statusRecord = status as Record<string, unknown>;
  if (statusRecord.kind !== 'ready') {
    throw new Error('Router tenant-root creation did not reach ready state');
  }
  const revision = Number(record.revision);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error('Router tenant-root creation returned an invalid revision');
  }
  return {
    identityDigestB64u: requiredText(record.identity_digest_b64u, 'identity_digest_b64u'),
    custodyLineageB64u: requiredText(record.custody_lineage_b64u, 'custody_lineage_b64u'),
    revision,
    journalDigestB64u: requiredText(record.journal_digest_b64u, 'journal_digest_b64u'),
    capabilityDigestB64u: requiredText(record.capability_digest_b64u, 'capability_digest_b64u'),
    rootCommitmentB64u: requiredText(statusRecord.root_commitment_b64u, 'root_commitment_b64u'),
    replayed: record.replayed === true,
  };
}

async function resolveIdentity(
  dependencies: Pick<TenantRootCreationConsoleRouteDependenciesV1, 'orgProjectEnv'>,
  claims: Extract<
    Awaited<ReturnType<typeof authenticateConsoleRequest>>,
    { readonly ok: true }
  >['claims'],
): Promise<TenantRootIdentityV1> {
  const orgId = requiredText(claims.orgId, 'authenticated orgId');
  const projectId = requiredText(claims.projectId, 'authenticated projectId');
  const environmentId = requiredText(claims.environmentId, 'authenticated environmentId');
  const environments = await dependencies.orgProjectEnv.listEnvironments(
    {
      orgId: claims.orgId,
      actorUserId: claims.userId,
      projectId,
      environmentId,
    },
    { projectId, status: 'ACTIVE' },
  );
  const environment = environments.find(
    (candidate) => candidate.id === environmentId && candidate.projectId === projectId,
  );
  if (!environment) {
    throw new Error('Authenticated Console environment is not active');
  }
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId,
    projectId,
    envId: environment.id,
    signingRootId: `${projectId}:${environment.key}`,
    signingRootVersion: environment.runtimeVersion,
  });
  if (!identity.ok) {
    throw new Error('Authenticated Console tenant-root identity is not canonical');
  }
  return identity.value;
}

function parseRouterTenantRootRefreshResponse(value: unknown): TenantRootRefreshRouterResponseV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Router returned an invalid tenant-root refresh response');
  }
  const record = value as Record<string, unknown>;
  const lifecycleRevision = Number(record.lifecycle_revision);
  if (!Number.isSafeInteger(lifecycleRevision) || lifecycleRevision <= 0) {
    throw new Error('Router tenant-root refresh returned an invalid lifecycle revision');
  }
  const retirement = record.retirement;
  if (!retirement || typeof retirement !== 'object' || Array.isArray(retirement)) {
    throw new Error('Router tenant-root refresh returned invalid retirement evidence');
  }
  const retirementKind = (retirement as Record<string, unknown>).kind;
  if (retirementKind !== 'confirmed' && retirementKind !== 'unverified') {
    throw new Error('Router tenant-root refresh returned invalid retirement evidence');
  }
  return {
    activationReceiptDigestB64u: requiredText(
      record.activation_receipt_digest_b64u,
      'activation_receipt_digest_b64u',
    ),
    lifecycleRevision,
    retirement: { kind: retirementKind },
  };
}

async function issueGrant(
  dependencies: TenantRootCreationConsoleRouteDependenciesV1,
  operationId: string,
  identity: TenantRootIdentityV1,
): Promise<{ readonly record: TenantRootCreationGrantRecordV1; readonly replayed: boolean }> {
  const existing = await dependencies.grants.findGrantByOperationId(operationId);
  if (existing) {
    if (!sameIdentity(existing.identity, identity)) {
      throw new Error('Tenant-root creation operation belongs to a different authenticated scope');
    }
    return { record: existing, replayed: true };
  }
  const nowMs = (dependencies.now ?? (() => new Date()))().getTime();
  const issuedAtMs = Math.max(1, nowMs - 1);
  const signed = await signTenantRootCreationGrantV1({
    identity,
    custodyLineage: randomTenantRootCreationGrantBytesV1(16),
    grantNonce: randomTenantRootCreationGrantBytesV1(32),
    issuedAtMs,
    expiresAtMs: issuedAtMs + 300_000,
    grantKeyId: requiredText(dependencies.grantAuthorityKeyId, 'grantAuthorityKeyId'),
    signingSeedB64u: requiredText(
      dependencies.grantAuthoritySigningSeedB64u,
      'grantAuthoritySigningSeedB64u',
    ),
  });
  const record = await dependencies.grants.putOrGetGrant({
    operationId,
    identity,
    ...signed,
  });
  if (!sameIdentity(record.identity, identity)) {
    throw new Error('Tenant-root creation operation resolved to a different authenticated scope');
  }
  return { record, replayed: false };
}

async function createAtRouter(
  dependencies: TenantRootCreationConsoleRouteDependenciesV1,
  record: TenantRootCreationGrantRecordV1,
): Promise<RouterCreationReadyResponseV1> {
  const response = await dependencies.router.fetch(
    `${ROUTER_AB_MPC_ROUTER_ORIGIN}${TENANT_ROOT_CREATION_ROUTER_PATH_V1}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [INTERNAL_SERVICE_AUTH_HEADER]: requiredText(
          dependencies.internalServiceAuthSecret,
          'internalServiceAuthSecret',
        ),
      },
      body: JSON.stringify({ creation_grant_b64u: record.grantB64u }),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && !Array.isArray(body)
        ? String((body as Record<string, unknown>).message ?? response.statusText)
        : response.statusText;
    throw new Error(`Router tenant-root creation failed (HTTP ${response.status}): ${message}`);
  }
  return parseRouterCreationReadyResponse(body);
}

async function refreshAtRouter(
  dependencies: Pick<
    TenantRootRefreshConsoleRouteDependenciesV1,
    'router' | 'internalServiceAuthSecret'
  >,
  routerRequest: TenantRootRefreshRouterRequestV1,
): Promise<TenantRootRefreshRouterResultV1> {
  const response = await dependencies.router.fetch(
    `${ROUTER_AB_MPC_ROUTER_ORIGIN}${TENANT_ROOT_REFRESH_ROUTER_PATH_V1}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [INTERNAL_SERVICE_AUTH_HEADER]: requiredText(
          dependencies.internalServiceAuthSecret,
          'internalServiceAuthSecret',
        ),
      },
      body: JSON.stringify(routerRequest),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (
      response.status === 409 &&
      'code' in body &&
      (body.code === 'lifecycle_revision_moved' || body.code === 'authorization_expired')
    ) {
      return { kind: 'refused', code: body.code };
    }

    if (
      response.status === 429 &&
      'code' in body &&
      body.code === 'tenant_root_refresh_throttled'
    ) {
      if (
        !('retry_at_ms' in body) ||
        typeof body.retry_at_ms !== 'number' ||
        !Number.isSafeInteger(body.retry_at_ms) ||
        body.retry_at_ms <= 0
      ) {
        throw new Error('Router returned an invalid refresh retry time');
      }
      return { kind: 'throttled', retryAtMs: body.retry_at_ms };
    }
    if (
      response.status === 409 &&
      'code' in body &&
      body.code === 'tenant_root_refresh_in_progress'
    ) {
      return { kind: 'in_progress' };
    }
    if (response.status === 409 && 'code' in body && body.code === 'tenant_root_refresh_not_due') {
      if (
        !('next_run_at_ms' in body) ||
        typeof body.next_run_at_ms !== 'number' ||
        !Number.isSafeInteger(body.next_run_at_ms) ||
        body.next_run_at_ms <= 0
      ) {
        throw new Error('Router returned an invalid refresh next-run time');
      }
      return { kind: 'not_due', nextRunAtMs: body.next_run_at_ms };
    }
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && !Array.isArray(body)
        ? String((body as Record<string, unknown>).message ?? response.statusText)
        : response.statusText;
    throw new Error(`Router tenant-root refresh failed (HTTP ${response.status}): ${message}`);
  }
  return { kind: 'completed', value: parseRouterTenantRootRefreshResponse(body) };
}

export interface TenantRootRefreshOperationDispatchDependenciesV1 {
  readonly router: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  readonly internalServiceAuthSecret: string;
  readonly audit: TenantRootAuditWriterV1;
  readonly operations: Pick<
    TenantRootOperationStoreV1,
    'markAccepted' | 'markFailed' | 'markDispatchUncertain' | 'markAuthorizationExpired'
  >;
}

export interface TenantRootRefreshOperationDispatchInputV1 {
  readonly dependencies: TenantRootRefreshOperationDispatchDependenciesV1;
  readonly entry: TenantRootOperationEntryV1;
  readonly orgId: string;
  /** The identity scope selected at the request or D1 listing boundary. */
  readonly identityDigestB64u: string;
  /** Must match the canonical record's custody lineage before dispatch. */
  readonly custodyLineageB64u: string;
  /** Null for server-owned scheduler dispatches without a user step-up. */
  readonly stepUpMethod: string | null;
  readonly nowMs: number;
}

export type TenantRootRefreshOperationDispatchResultV1 =
  | TenantRootRefreshRouterResultV1
  | { readonly kind: 'invalid'; readonly code: 'invalid_operation_record' }
  | { readonly kind: 'unknown'; readonly error: unknown };

export type TenantRootRefreshRouterRequestBuildResultV1 =
  | { readonly ok: true; readonly request: TenantRootRefreshRouterRequestV1 }
  | { readonly ok: false; readonly code: 'invalid_operation_record'; readonly message: string };

/**
 * Reconstructs the Router request from the exact durable operation record.
 * The current state snapshot is intentionally absent: the Router must perform
 * operation replay before deciding whether revision or expiry still permits it.
 */
export async function buildTenantRootRefreshRouterRequestV1(input: {
  readonly entry: TenantRootOperationEntryV1;
  readonly orgId: string;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
}): Promise<TenantRootRefreshRouterRequestBuildResultV1> {
  if (input.entry.status !== 'pending') {
    return {
      ok: false,
      code: 'invalid_operation_record',
      message: 'Only pending tenant-root refresh operations can be dispatched',
    };
  }
  if (
    input.entry.operationKind !== ROTATION_OPERATION_KIND ||
    input.entry.operationId.length === 0 ||
    input.entry.idempotencyKey.length === 0
  ) {
    return {
      ok: false,
      code: 'invalid_operation_record',
      message: 'Stored tenant-root refresh operation identity is invalid',
    };
  }
  if (input.identityDigestB64u.length === 0 || input.custodyLineageB64u.length === 0) {
    return {
      ok: false,
      code: 'invalid_operation_record',
      message: 'Tenant-root refresh identity or custody lineage is missing',
    };
  }

  const record = parseTenantRootOperationRecordV1(input.entry.canonicalRecordJson);
  if (record === null || record.operationKind !== ROTATION_OPERATION_KIND) {
    return {
      ok: false,
      code: 'invalid_operation_record',
      message: 'Stored tenant-root refresh operation record is unreadable',
    };
  }
  if (
    record.idempotencyKey !== input.entry.idempotencyKey ||
    record.orgId !== input.orgId ||
    record.requesterActorId !== input.entry.requesterUserId ||
    record.tenantRootIdentityDigest !== input.identityDigestB64u ||
    record.custodyLineageId !== input.custodyLineageB64u
  ) {
    return {
      ok: false,
      code: 'invalid_operation_record',
      message: 'Stored tenant-root refresh operation is bound to a different identity or key',
    };
  }

  const issuedAtMs = Date.parse(record.issuedAt);
  const expiresAtMs = Date.parse(record.expiresAt);
  if (
    !Number.isSafeInteger(issuedAtMs) ||
    issuedAtMs <= 0 ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs !== input.entry.authorizationExpiresAtMs
  ) {
    return {
      ok: false,
      code: 'invalid_operation_record',
      message: 'Stored tenant-root refresh operation expiry is invalid',
    };
  }
  if (issuedAtMs !== input.entry.createdAtMs) {
    return {
      ok: false,
      code: 'invalid_operation_record',
      message: 'Stored tenant-root refresh issue time is invalid',
    };
  }
  if ((await tenantRootOperationDigestB64uV1(record)) !== input.entry.operationDigestB64u) {
    return {
      ok: false,
      code: 'invalid_operation_record',
      message: 'Stored tenant-root refresh operation digest is invalid',
    };
  }

  return {
    ok: true,
    request: {
      // The caller's idempotency key is the Router operation id. The D1
      // operation id remains an internal row identifier for status updates.
      operation_id: record.idempotencyKey,
      identity_digest_b64u: record.tenantRootIdentityDigest,
      custody_lineage_b64u: record.custodyLineageId,
      expected_lifecycle_revision: record.expectedLifecycleRevision,
      expires_at_ms: expiresAtMs,
      trigger: input.entry.triggerKind,
    },
  };
}

function buildTenantRootRefreshAuditEventV1(
  input: TenantRootRefreshOperationDispatchInputV1,
  event: {
    readonly action: TenantRootAuditEventV1['action'];
    readonly outcome: TenantRootAuditEventV1['outcome'];
    readonly failureCode: string | null;
    readonly receiptDigestB64u: string | null;
    readonly lifecycleRevision: number;
    readonly role?: TenantRootAuditEventV1['role'];
  },
): TenantRootAuditEventV1 {
  return buildTenantRootAuditEventV1({
    action: event.action,
    outcome: event.outcome,
    atIso: new Date(input.nowMs).toISOString(),
    orgId: input.orgId,
    actorUserId: input.entry.requesterUserId,
    identityDigestB64u: input.identityDigestB64u,
    custodyLineageB64u: input.custodyLineageB64u,
    lifecycleRevision: event.lifecycleRevision,
    ...(event.role === undefined ? {} : { role: event.role ?? undefined }),
    receiptDigestB64u: event.receiptDigestB64u ?? undefined,
    failureCode: event.failureCode ?? undefined,
    operationKind: input.entry.operationKind,
    operationDigestB64u: input.entry.operationDigestB64u,
    ...(input.stepUpMethod === null ? {} : { stepUpMethod: input.stepUpMethod }),
  });
}

async function writeTenantRootRefreshAuditEventV1(
  input: TenantRootRefreshOperationDispatchInputV1,
  event: {
    readonly action: TenantRootAuditEventV1['action'];
    readonly outcome: TenantRootAuditEventV1['outcome'];
    readonly failureCode: string | null;
    readonly receiptDigestB64u: string | null;
    readonly lifecycleRevision: number;
    readonly role?: TenantRootAuditEventV1['role'];
  },
): Promise<void> {
  await input.dependencies.audit.write(buildTenantRootRefreshAuditEventV1(input, event));
}

/** Dispatches one pending refresh for both the POST route and background replay. */
export async function dispatchTenantRootRefreshOperationV1(
  input: TenantRootRefreshOperationDispatchInputV1,
): Promise<TenantRootRefreshOperationDispatchResultV1> {
  const built = await buildTenantRootRefreshRouterRequestV1(input);
  if (!built.ok) {
    const terminalize = input.entry.dispatchUncertainAtMs === null;
    try {
      if (terminalize) {
        await writeTenantRootRefreshAuditEventV1(input, {
          action: 'rotation_failed',
          outcome: 'failure',
          failureCode: 'invalid_operation_record',
          receiptDigestB64u: null,
          lifecycleRevision: 0,
        });
        await input.dependencies.operations.markFailed(
          input.entry.operationId,
          'invalid_operation_record',
        );
      } else {
        await writeTenantRootRefreshAuditEventV1(input, {
          action: 'rotation_requested',
          outcome: 'pending',
          failureCode: 'dispatch_uncertain',
          receiptDigestB64u: null,
          lifecycleRevision: 0,
        });
        // Keep an uncertain malformed row behind other pending operations while
        // preserving the possibility that its earlier delivery succeeded.
        await input.dependencies.operations.markDispatchUncertain(
          input.entry.operationId,
          input.nowMs,
        );
      }
    } catch (error: unknown) {
      return { kind: 'unknown', error };
    }
    if (terminalize) return { kind: 'invalid', code: 'invalid_operation_record' };
    return { kind: 'unknown', error: new Error(built.message) };
  }

  await input.dependencies.operations.markDispatchUncertain(input.entry.operationId, input.nowMs);
  let refreshed: TenantRootRefreshRouterResultV1;
  try {
    refreshed = await refreshAtRouter(input.dependencies, built.request);
  } catch (error: unknown) {
    // A transport or malformed-response failure leaves the operation pending.
    // A later replay of this exact request lets the Router reconcile admission.
    try {
      await writeTenantRootRefreshAuditEventV1(input, {
        action: 'rotation_requested',
        outcome: 'pending',
        failureCode: 'dispatch_uncertain',
        receiptDigestB64u: null,
        lifecycleRevision: built.request.expected_lifecycle_revision,
      });
    } catch (auditError: unknown) {
      return { kind: 'unknown', error: auditError };
    }
    return { kind: 'unknown', error };
  }

  if (refreshed.kind === 'completed') {
    try {
      await writeTenantRootRefreshAuditEventV1(input, {
        action: 'rotation_activated',
        outcome: 'success',
        failureCode: null,
        receiptDigestB64u: refreshed.value.activationReceiptDigestB64u,
        lifecycleRevision: refreshed.value.lifecycleRevision,
      });
      if (refreshed.value.retirement.kind === 'confirmed') {
        for (const role of ['deriver_a', 'deriver_b'] as const) {
          await writeTenantRootRefreshAuditEventV1(input, {
            action: 'rotation_retired',
            outcome: 'success',
            failureCode: null,
            receiptDigestB64u: null,
            lifecycleRevision: refreshed.value.lifecycleRevision,
            role,
          });
        }
      }
    } catch (error: unknown) {
      // The Router may already have activated the rotation. Keep the operation
      // pending until a retry can replay it and complete the audit evidence.
      return { kind: 'unknown', error };
    }
    await input.dependencies.operations.markAccepted(
      input.entry.operationId,
      JSON.stringify({
        ok: true,
        status: 'ACTIVE',
        activationReceiptDigestB64u: refreshed.value.activationReceiptDigestB64u,
        lifecycleRevision: refreshed.value.lifecycleRevision,
        retirement: refreshed.value.retirement,
      }),
    );
  } else if (refreshed.kind === 'refused') {
    try {
      await writeTenantRootRefreshAuditEventV1(input, {
        action: 'rotation_failed',
        outcome: 'failure',
        failureCode: refreshed.code,
        receiptDigestB64u: null,
        lifecycleRevision: built.request.expected_lifecycle_revision,
      });
    } catch (error: unknown) {
      return { kind: 'unknown', error };
    }
    if (refreshed.code === 'authorization_expired') {
      await input.dependencies.operations.markAuthorizationExpired(input.entry.operationId);
    } else {
      await input.dependencies.operations.markFailed(input.entry.operationId, refreshed.code);
    }
  } else if (refreshed.kind === 'throttled') {
    try {
      await writeTenantRootRefreshAuditEventV1(input, {
        action: 'rotation_failed',
        outcome: 'failure',
        failureCode: 'tenant_root_refresh_throttled',
        receiptDigestB64u: null,
        lifecycleRevision: built.request.expected_lifecycle_revision,
      });
    } catch (error: unknown) {
      return { kind: 'unknown', error };
    }
    await input.dependencies.operations.markFailed(
      input.entry.operationId,
      'tenant_root_refresh_throttled',
    );
  } else if (refreshed.kind === 'not_due') {
    try {
      await writeTenantRootRefreshAuditEventV1(input, {
        action: 'rotation_failed',
        outcome: 'failure',
        failureCode: 'tenant_root_refresh_not_due',
        receiptDigestB64u: null,
        lifecycleRevision: built.request.expected_lifecycle_revision,
      });
    } catch (error: unknown) {
      return { kind: 'unknown', error };
    }
    await input.dependencies.operations.markFailed(
      input.entry.operationId,
      'tenant_root_refresh_not_due',
    );
  } else {
    try {
      await writeTenantRootRefreshAuditEventV1(input, {
        action: 'rotation_requested',
        outcome: 'pending',
        failureCode: 'tenant_root_refresh_in_progress',
        receiptDigestB64u: null,
        lifecycleRevision: built.request.expected_lifecycle_revision,
      });
    } catch (error: unknown) {
      return { kind: 'unknown', error };
    }
  }
  if (refreshed.kind === 'in_progress') {
    await input.dependencies.operations.markFailed(
      input.entry.operationId,
      'tenant_root_refresh_in_progress',
    );
  }
  return refreshed;
}

function refreshConsoleResponse(
  result: TenantRootRefreshRouterResultV1 | { readonly kind: 'invalid'; readonly code: string },
): Response {
  switch (result.kind) {
    case 'invalid':
      return json({ ok: false, code: result.code }, 409);
    case 'refused':
      return json({ ok: false, code: result.code }, 409);
    case 'completed':
      return json({
        ok: true,
        status: 'ACTIVE',
        activationReceiptDigestB64u: result.value.activationReceiptDigestB64u,
        lifecycleRevision: result.value.lifecycleRevision,
      });
    case 'throttled': {
      const response = json(
        {
          ok: false,
          code: 'tenant_root_refresh_throttled',
          message: 'Wait for the rotation cooldown to finish.',
          retryAtMs: result.retryAtMs,
        },
        429,
      );
      response.headers.set('Retry-After', new Date(result.retryAtMs).toUTCString());
      return response;
    }
    case 'not_due':
      return json(
        {
          ok: false,
          code: 'tenant_root_refresh_not_due',
          nextRunAtMs: result.nextRunAtMs,
          next_scheduled_rotation_at_ms: result.nextRunAtMs,
        },
        409,
      );
    case 'in_progress':
      return json(
        {
          ok: false,
          code: 'tenant_root_refresh_in_progress',
          // The control plane replays or resumes an operation that presents its
          // own id, so this answer always means a different operation holds the
          // lock — never that the caller's own rotation is running.
          conflict: 'another_operation_in_progress',
          message: 'A different tenant secret refresh is already in progress.',
        },
        409,
      );
    default:
      return assertNeverRefreshResult(result);
  }
}

function assertNeverRefreshResult(value: never): never {
  throw new Error(`Unexpected refresh result: ${String(value)}`);
}

export function createTenantRootCreationConsoleRouteV1(
  dependencies: TenantRootCreationConsoleRouteDependenciesV1,
): (request: Request) => Promise<Response | null> {
  const definitions = createComposedConsoleRouteDefinitions();
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== TENANT_ROOT_CREATION_CONSOLE_PATH_V1) return null;
    if (request.method !== 'POST') {
      return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
    }
    const auth = await authenticateConsoleRequest(
      headersToRecord(request.headers),
      dependencies.auth,
    );
    if (!auth.ok) return json({ ok: false, code: auth.code, message: auth.message }, auth.status);
    const authorization = authorizeConsoleRouteRequest({
      claims: auth.claims,
      definitions,
      method: request.method,
      pathname: url.pathname,
      ...(auth.claims.projectId ? { projectId: auth.claims.projectId } : {}),
    });
    if (!authorization.ok) return json(authorization.body, authorization.status);

    try {
      const operationId = await parseOperationId(request);
      const identity = await resolveIdentity(dependencies, auth.claims);
      const issued = await issueGrant(dependencies, operationId, identity);
      if (issued.record.status === 'ACTIVE') {
        return json({ ok: true, status: 'ACTIVE', replayed: true });
      }
      const ready = await createAtRouter(dependencies, issued.record);
      if (
        ready.identityDigestB64u !== issued.record.identityDigestB64u ||
        ready.custodyLineageB64u !== issued.record.custodyLineageB64u
      ) {
        throw new Error('Router tenant-root creation response changed the issued identity');
      }
      await dependencies.grants.markActiveFromReady({
        operationId,
        identity,
        identityDigestB64u: issued.record.identityDigestB64u,
        custodyLineageB64u: issued.record.custodyLineageB64u,
        ready: {
          revision: ready.revision,
          rootCommitmentB64u: ready.rootCommitmentB64u,
          journalDigestB64u: ready.journalDigestB64u,
          capabilityDigestB64u: ready.capabilityDigestB64u,
        },
      });
      return json({ ok: true, status: 'ACTIVE', replayed: issued.replayed || ready.replayed });
    } catch (error: unknown) {
      if (isTenantRootCreationGrantStoreError(error)) {
        return json({ ok: false, code: error.code, message: error.message }, error.statusCode);
      }
      return json(
        {
          ok: false,
          code: 'tenant_root_creation_failed',
          message: error instanceof Error ? error.message : 'Tenant-root creation failed',
        },
        502,
      );
    }
  };
}

export function createTenantRootRefreshConsoleRouteV1(
  dependencies: TenantRootRefreshConsoleRouteDependenciesV1,
): (request: Request) => Promise<Response | null> {
  const definitions = createComposedConsoleRouteDefinitions();
  const newOperationId = dependencies.newOperationId ?? (() => crypto.randomUUID());
  const newNonceB64u =
    dependencies.newNonceB64u ??
    (() => {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      return btoa(String.fromCharCode(...bytes))
        .replace(/\+/gu, '-')
        .replace(/\//gu, '_')
        .replace(/=+$/u, '');
    });
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== TENANT_ROOT_REFRESH_CONSOLE_PATH_V1) return null;
    if (request.method !== 'POST') {
      return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
    }
    const auth = await authenticateConsoleRequest(
      headersToRecord(request.headers),
      dependencies.auth,
    );
    if (!auth.ok) return json({ ok: false, code: auth.code, message: auth.message }, auth.status);
    const authorization = authorizeConsoleRouteRequest({
      claims: auth.claims,
      definitions,
      method: request.method,
      pathname: url.pathname,
      ...(auth.claims.projectId ? { projectId: auth.claims.projectId } : {}),
    });
    if (!authorization.ok) return json(authorization.body, authorization.status);

    // The route table marks this route as requiring fresh step-up. Verifying it
    // here is what makes that requirement real rather than advertised.
    const nowMs = (dependencies.now ?? (() => Date.now()))();
    const stepUp = await verifyFreshStepUpForRequestV1({
      stepUp: dependencies.stepUp,
      request,
      claims: auth.claims,
      nowMs,
    });
    if (!stepUp.ok) {
      return json({ ok: false, code: 'step_up_required', error: stepUp.error }, 403);
    }

    let operationId: string;
    try {
      operationId = await parseOperationId(request);
    } catch (error: unknown) {
      return json(
        {
          ok: false,
          code: 'invalid_request',
          message: error instanceof Error ? error.message : 'Refresh operationId is invalid',
        },
        400,
      );
    }

    try {
      const identity = await resolveIdentity(dependencies, auth.claims);
      const identityDigestB64u = await tenantRootIdentityDigestB64uV1(identity);
      const active = await dependencies.state.readStatus({ identity });

      // The submitted operationId is
      // the idempotency key, so submit, poll, and retry all name one operation.
      const operations = dependencies.operations({
        orgId: identity.orgId,
        identityDigestB64u,
        custodyLineageB64u: active.custodyLineageB64u,
      });

      // No custody store is mounted, so governance is not configured. The
      // digest is still bound into the record, so a record built under one
      // governance cannot be replayed under another.
      const governanceDigestB64u = await tenantRootRecoveryGovernanceDigestB64uV1(null);
      const resolvedRecord = await resolveTenantRootOperationRecordV1(operations, {
        idempotencyKey: operationId,
        operationKind: ROTATION_OPERATION_KIND,
        requesterUserId: auth.claims.userId,
        nowMs,
        build: () =>
          buildTenantRootOperationRecordV1({
            operationKind: ROTATION_OPERATION_KIND,
            identity,
            tenantRootIdentityDigest: identityDigestB64u,
            custodyLineageId: active.custodyLineageB64u,
            expectedLifecycleRevision: active.status.lifecycleRevision,
            recoveryGovernanceDigest: governanceDigestB64u,
            subject: { kind: 'tenant_root' },
            requesterActorId: auth.claims.userId,
            idempotencyKey: operationId,
            issuedAt: new Date(nowMs).toISOString(),
            expiresAt: new Date(
              nowMs + tenantRootOperationMaxLifetimeMsV1(ROTATION_OPERATION_KIND),
            ).toISOString(),
            expectedRootCommitment: active.rootCommitmentB64u,
          }),
      });
      if (!resolvedRecord.ok) {
        return json(
          { ok: false, code: resolvedRecord.error.kind, error: resolvedRecord.error },
          resolvedRecord.error.kind === 'invalid_operation_record' ? 400 : 409,
        );
      }

      const started = await startTenantRootOperationV1(operations, {
        record: resolvedRecord.record,
        triggerKind: 'manual',
        operationDigestB64u: resolvedRecord.operationDigestB64u,
        governance: null,
        governanceDigestB64u,
        requesterStepUp: tenantRootStepUpRecordFromProofV1(stepUp.proof),
        requesterSessionId: stepUp.proof.sessionId,
        // Rotation never follows recovery governance, so no approver exists.
        approverIsOwner: async () => false,
        operationId: newOperationId(),
        nonceB64u: newNonceB64u(),
        nowMs,
      });
      if (!started.ok) {
        return json(
          { ok: false, code: started.error.kind, error: started.error },
          started.error.kind === 'authorization_failed' ? 403 : 409,
        );
      }

      // A rotation this operation id already completed is returned as it was
      // recorded. A reload does not rotate a second time.
      if (started.entry.acceptedResultJson !== null) {
        return json({
          ...(JSON.parse(started.entry.acceptedResultJson) as Record<string, unknown>),
          replayed: true,
          operationId,
        });
      }
      if (started.entry.status === 'failed') {
        return json(
          {
            ok: false,
            code: started.entry.failureCode ?? 'failed',
            replayed: true,
            operationId,
          },
          409,
        );
      }

      if (started.entry.status === 'authorization_expired') {
        return json({ ok: false, code: 'authorization_expired', operationId, replayed: true }, 409);
      }

      const dispatched = await dispatchTenantRootRefreshOperationV1({
        dependencies: {
          router: dependencies.router,
          internalServiceAuthSecret: dependencies.internalServiceAuthSecret,
          audit: dependencies.audit,
          operations,
        },
        entry: started.entry,
        orgId: identity.orgId,
        identityDigestB64u,
        custodyLineageB64u: active.custodyLineageB64u,
        stepUpMethod: stepUp.proof.method,
        nowMs,
      });
      if (dispatched.kind === 'unknown') {
        // The console does not know what the control plane did: the request may
        // have been accepted and the answer lost. Recording a definite failure
        // here would make a rotation that did happen unrepeatable and a
        // rotation that did not happen unresumable. The operation stays
        // pending, and the same operationId can complete it.
        return json(
          {
            ok: false,
            code: TENANT_ROOT_ROTATION_DISPATCH_UNCERTAIN_V1,
            operationId,
            resumable: true,
            message:
              dispatched.error instanceof Error
                ? `The rotation outcome is unknown; retry or poll the same operationId: ${dispatched.error.message}`
                : 'The rotation outcome is unknown; retry or poll the same operationId',
          },
          502,
        );
      }

      return refreshConsoleResponse(dispatched);
    } catch (error: unknown) {
      if (error instanceof TenantRootSecurityStateUnavailableError) {
        return json({ ok: false, code: error.code, message: error.message }, 409);
      }
      if (isTenantRootCreationGrantStoreError(error)) {
        return json({ ok: false, code: error.code, message: error.message }, error.statusCode);
      }
      return json(
        {
          ok: false,
          code: 'tenant_root_refresh_failed',
          message: error instanceof Error ? error.message : 'Tenant-root refresh failed',
        },
        502,
      );
    }
  };
}
