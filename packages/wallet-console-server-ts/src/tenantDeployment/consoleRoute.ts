import type { ConsoleAuthAdapter } from '@seams-internal/console-server/router/consoleAuth';
import type { ConsoleOrgProjectEnvService } from '@seams-internal/console-server/orgProjectEnv/service';
import type {
  TenantDeploymentCutoverId,
  TenantDeploymentCutoverV1,
} from '@seams-internal/wallet-console-shared/tenant-deployment';
import type { TenantRootSecurityStateReaderV1 } from '../tenantRootSecurity/consoleRoute';
import type { TenantRootIdentityV1 } from '../tenantRootCreation/types';
import {
  guardTenantRootSecurityRequestV1,
  tenantRootSecurityJson,
  type TenantRootStepUpReaderV1,
} from '../tenantRootSecurity/routeGuard';
import type {
  TenantDeploymentCandidateResolverV1,
  TenantDeploymentCandidateSurfacesV1,
} from './productionReadiness';
import type { TenantDeploymentReadinessServiceV1 } from './readiness';
import { isTenantDeploymentStoreError, type TenantDeploymentServiceV1 } from './service';
import type { TenantDeploymentCutoverRecordV1 } from './types';

export const TENANT_DEPLOYMENT_CUTOVERS_PATH_V1 = '/console/tenant-deployment/cutovers';
export const TENANT_DEPLOYMENT_SETUP_DRAIN_MS_V1 = 30_000;

export type TenantDeploymentConsoleRouteDependenciesV1 = {
  readonly auth: ConsoleAuthAdapter;
  readonly orgProjectEnv: ConsoleOrgProjectEnvService;
  readonly stepUp: TenantRootStepUpReaderV1;
  readonly tenantRootState: TenantRootSecurityStateReaderV1;
  readonly candidates: TenantDeploymentCandidateResolverV1;
  readonly readiness: TenantDeploymentReadinessServiceV1;
  readonly store: TenantDeploymentServiceV1;
  readonly deploymentLane: string;
};

type CutoverAction = 'status' | 'tenant-root' | 'readiness' | 'activate';

type CutoverRouteMatch = {
  readonly operationId: TenantDeploymentCutoverId;
  readonly action: CutoverAction;
};

type ReadinessRequest = {
  readonly credentialId: string;
  readonly publishableKey: string;
  readonly surfaces: TenantDeploymentCandidateSurfacesV1;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((entry, index) => entry === sortedExpected[index])
  );
}

function requiredText(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    new TextEncoder().encode(value).length > 512
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function parseOperationId(value: unknown): TenantDeploymentCutoverId {
  const operationId = requiredText(value, 'operationId');
  if (!/^tco_[A-Za-z0-9_-]{8,128}$/u.test(operationId)) {
    throw new Error('operationId is invalid');
  }
  return `tco_${operationId.slice(4)}`;
}

function canonicalOrigin(value: unknown, label: string): string {
  const text = requiredText(value, label);
  const url = new URL(text);
  if (
    url.origin !== text ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')))
  ) {
    throw new Error(`${label} must be an exact browser origin`);
  }
  return url.origin;
}

async function readPlanningRequest(request: Request): Promise<TenantDeploymentCutoverId> {
  const body = record(await request.json().catch(() => null));
  if (!body || !exactKeys(body, ['operationId'])) throw new Error('invalid planning request');
  return parseOperationId(body.operationId);
}

async function readReadinessRequest(request: Request): Promise<ReadinessRequest> {
  const body = record(await request.json().catch(() => null));
  const surfaces = record(body?.surfaces);
  if (
    !body ||
    !exactKeys(body, ['credentialId', 'publishableKey', 'surfaces']) ||
    !surfaces ||
    !exactKeys(surfaces, [
      'applicationOrigin',
      'hostedWalletOrigin',
      'gatewayOrigin',
      'relyingPartyId',
    ])
  ) {
    throw new Error('invalid readiness request');
  }
  return {
    credentialId: requiredText(body.credentialId, 'credentialId'),
    publishableKey: requiredText(body.publishableKey, 'publishableKey'),
    surfaces: {
      applicationOrigin: canonicalOrigin(surfaces.applicationOrigin, 'applicationOrigin'),
      hostedWalletOrigin: canonicalOrigin(surfaces.hostedWalletOrigin, 'hostedWalletOrigin'),
      gatewayOrigin: canonicalOrigin(surfaces.gatewayOrigin, 'gatewayOrigin'),
      relyingPartyId: requiredText(surfaces.relyingPartyId, 'relyingPartyId'),
    },
  };
}

function matchCutoverRoute(pathname: string): CutoverRouteMatch | null {
  if (!pathname.startsWith(`${TENANT_DEPLOYMENT_CUTOVERS_PATH_V1}/`)) return null;
  const suffix = pathname.slice(TENANT_DEPLOYMENT_CUTOVERS_PATH_V1.length + 1);
  const segments = suffix.split('/');
  if (segments.length < 1 || segments.length > 2) return null;
  let operationId: TenantDeploymentCutoverId;
  try {
    operationId = parseOperationId(segments[0]);
  } catch {
    return null;
  }
  if (segments.length === 1) return { operationId, action: 'status' };
  switch (segments[1]) {
    case 'tenant-root':
    case 'readiness':
    case 'activate':
      return { operationId, action: segments[1] };
    default:
      return null;
  }
}

function targetIdentity(identity: TenantRootIdentityV1): {
  readonly organizationId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly signingRootId: string;
  readonly signingRootVersion: string;
} {
  return {
    organizationId: identity.orgId,
    projectId: identity.projectId,
    environmentId: identity.envId,
    signingRootId: identity.signingRootId,
    signingRootVersion: identity.signingRootVersion,
  };
}

function sameTargetIdentityValues(
  left: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly environmentId: string;
    readonly signingRootId: string;
    readonly signingRootVersion: string;
  },
  right: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly environmentId: string;
    readonly signingRootId: string;
    readonly signingRootVersion: string;
  },
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.environmentId === right.environmentId &&
    left.signingRootId === right.signingRootId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

function sameTargetIdentity(
  state: TenantDeploymentCutoverV1,
  identity: TenantRootIdentityV1,
): boolean {
  const expected = targetIdentity(identity);
  switch (state.kind) {
    case 'planning':
    case 'awaiting_tenant_root':
    case 'awaiting_browser_credential':
      return sameTargetIdentityValues(state.targetIdentity, expected);
    case 'ready':
    case 'active':
      return (
        state.binding.tenant.organizationId === identity.orgId &&
        state.binding.tenant.projectId === identity.projectId &&
        state.binding.tenant.environmentId === identity.envId &&
        state.binding.tenantRoot.signingRootId === identity.signingRootId &&
        state.binding.tenantRoot.signingRootVersion === identity.signingRootVersion
      );
    case 'failed':
      return false;
  }
}

function awaitingRootMatchesIdentity(
  state: Extract<TenantDeploymentCutoverV1, { readonly kind: 'awaiting_tenant_root' }>,
  identity: TenantRootIdentityV1,
): boolean {
  return sameTargetIdentityValues(state.targetIdentity, targetIdentity(identity));
}

function response(record: TenantDeploymentCutoverRecordV1, replayed: boolean): Response {
  return tenantRootSecurityJson({ ok: true, replayed, cutover: record });
}

async function requireCutover(
  dependencies: TenantDeploymentConsoleRouteDependenciesV1,
  operationId: TenantDeploymentCutoverId,
): Promise<TenantDeploymentCutoverRecordV1> {
  const cutover = await dependencies.store.findCutover(operationId);
  if (!cutover) throw new Error('tenant deployment cutover was not found');
  return cutover;
}

async function planCutover(
  dependencies: TenantDeploymentConsoleRouteDependenciesV1,
  request: Request,
  identity: TenantRootIdentityV1,
): Promise<Response> {
  const operationId = await readPlanningRequest(request);
  const existing = await dependencies.store.findCutover(operationId);
  if (existing) {
    if (
      existing.state.deploymentLane !== dependencies.deploymentLane ||
      !sameTargetIdentity(existing.state, identity)
    ) {
      return tenantRootSecurityJson({ ok: false, code: 'cutover_conflict' }, 409);
    }
    if (existing.state.kind !== 'planning') return response(existing, true);
    const resumed = await dependencies.store.transitionCutover(existing, {
      kind: 'awaiting_tenant_root',
      operationId,
      deploymentLane: dependencies.deploymentLane,
      targetIdentity: existing.state.targetIdentity,
      expectedActiveRevision: existing.state.expectedActiveRevision,
    });
    return response(resumed, true);
  }
  const active = await dependencies.store.findActiveBinding(dependencies.deploymentLane);
  const plannedTargetIdentity = targetIdentity(identity);
  const planning = await dependencies.store.createCutover({
    kind: 'planning',
    operationId,
    deploymentLane: dependencies.deploymentLane,
    targetIdentity: plannedTargetIdentity,
    expectedActiveRevision: active?.revision ?? null,
  });
  const awaitingRoot = await dependencies.store.transitionCutover(planning, {
    kind: 'awaiting_tenant_root',
    operationId,
    deploymentLane: dependencies.deploymentLane,
    targetIdentity: plannedTargetIdentity,
    expectedActiveRevision: active?.revision ?? null,
  });
  return response(awaitingRoot, false);
}

async function prepareTenantRoot(
  dependencies: TenantDeploymentConsoleRouteDependenciesV1,
  operationId: TenantDeploymentCutoverId,
  identity: TenantRootIdentityV1,
): Promise<Response> {
  const cutover = await requireCutover(dependencies, operationId);
  if (
    cutover.state.kind === 'awaiting_browser_credential' ||
    cutover.state.kind === 'ready' ||
    cutover.state.kind === 'active'
  ) {
    return sameTargetIdentity(cutover.state, identity)
      ? response(cutover, true)
      : tenantRootSecurityJson({ ok: false, code: 'cutover_conflict' }, 409);
  }
  if (
    cutover.state.kind !== 'awaiting_tenant_root' ||
    cutover.state.deploymentLane !== dependencies.deploymentLane ||
    !awaitingRootMatchesIdentity(cutover.state, identity)
  ) {
    return tenantRootSecurityJson({ ok: false, code: 'cutover_conflict' }, 409);
  }
  const root = await dependencies.tenantRootState.readStatus({ identity });
  const prepared = await dependencies.store.transitionCutover(cutover, {
    kind: 'awaiting_browser_credential',
    operationId,
    deploymentLane: dependencies.deploymentLane,
    targetIdentity: cutover.state.targetIdentity,
    activeTenantRoot: {
      identityDigestB64u: root.identityDigestB64u,
      custodyLineageId: root.custodyLineageB64u,
      signingRootId: identity.signingRootId,
      signingRootVersion: identity.signingRootVersion,
    },
    expectedActiveRevision: cutover.state.expectedActiveRevision,
  });
  return response(prepared, false);
}

async function prepareReadiness(
  dependencies: TenantDeploymentConsoleRouteDependenciesV1,
  request: Request,
  operationId: TenantDeploymentCutoverId,
  identity: TenantRootIdentityV1,
  nowMs: number,
): Promise<Response> {
  const cutover = await requireCutover(dependencies, operationId);
  if (cutover.state.kind === 'active') {
    return sameTargetIdentity(cutover.state, identity)
      ? response(cutover, true)
      : tenantRootSecurityJson({ ok: false, code: 'cutover_conflict' }, 409);
  }
  if (cutover.state.kind === 'ready') {
    if (!sameTargetIdentity(cutover.state, identity)) {
      return tenantRootSecurityJson({ ok: false, code: 'cutover_conflict' }, 409);
    }
    const readinessReceipt = await dependencies.readiness.issue({
      binding: cutover.state.binding,
      expectedActiveRevision: cutover.state.expectedActiveRevision,
    });
    const refreshed = await dependencies.store.transitionCutover(cutover, {
      kind: 'ready',
      operationId,
      deploymentLane: dependencies.deploymentLane,
      binding: cutover.state.binding,
      readinessReceipt,
      expectedActiveRevision: cutover.state.expectedActiveRevision,
    });
    return response(refreshed, true);
  }
  if (
    cutover.state.kind !== 'awaiting_browser_credential' ||
    cutover.state.deploymentLane !== dependencies.deploymentLane ||
    !sameTargetIdentity(cutover.state, identity)
  ) {
    return tenantRootSecurityJson({ ok: false, code: 'cutover_conflict' }, 409);
  }
  const drainRemainingMs = TENANT_DEPLOYMENT_SETUP_DRAIN_MS_V1 - (nowMs - cutover.updatedAtMs);
  if (drainRemainingMs > 0) {
    return tenantRootSecurityJson(
      {
        ok: false,
        code: 'setup_admission_draining',
        retryAfterMs: drainRemainingMs,
      },
      409,
    );
  }
  const input = await readReadinessRequest(request);
  const binding = await dependencies.candidates.buildCandidate({
    identity,
    activeTenantRoot: cutover.state.activeTenantRoot,
    credentialId: input.credentialId,
    publishableKey: input.publishableKey,
    surfaces: input.surfaces,
  });
  await dependencies.store.putBinding(binding);
  const readinessReceipt = await dependencies.readiness.issue({
    binding,
    expectedActiveRevision: cutover.state.expectedActiveRevision,
  });
  const ready = await dependencies.store.transitionCutover(cutover, {
    kind: 'ready',
    operationId,
    deploymentLane: dependencies.deploymentLane,
    binding,
    readinessReceipt,
    expectedActiveRevision: cutover.state.expectedActiveRevision,
  });
  return response(ready, false);
}

async function activate(
  dependencies: TenantDeploymentConsoleRouteDependenciesV1,
  operationId: TenantDeploymentCutoverId,
  identity: TenantRootIdentityV1,
): Promise<Response> {
  const cutover = await requireCutover(dependencies, operationId);
  if (cutover.state.kind === 'active') {
    return sameTargetIdentity(cutover.state, identity)
      ? response(cutover, true)
      : tenantRootSecurityJson({ ok: false, code: 'cutover_conflict' }, 409);
  }
  if (
    cutover.state.kind !== 'ready' ||
    cutover.state.deploymentLane !== dependencies.deploymentLane ||
    !sameTargetIdentity(cutover.state, identity)
  ) {
    return tenantRootSecurityJson({ ok: false, code: 'cutover_conflict' }, 409);
  }
  const active = await dependencies.store.findActiveBinding(dependencies.deploymentLane);
  if ((active?.revision ?? null) !== cutover.state.expectedActiveRevision) {
    return tenantRootSecurityJson({ ok: false, code: 'activation_conflict' }, 409);
  }
  await dependencies.store.activateBinding({
    operationId,
    expectedCutoverRecordRevision: cutover.recordRevision,
    deploymentLane: dependencies.deploymentLane,
    bindingRevision: cutover.state.binding.revision,
    expectedActive: active
      ? { revision: active.revision, activationSequence: active.activationSequence }
      : null,
    readinessReceipt: cutover.state.readinessReceipt,
  });
  const activated = await requireCutover(dependencies, operationId);
  return response(activated, false);
}

function errorResponse(error: unknown): Response {
  if (isTenantDeploymentStoreError(error)) {
    return tenantRootSecurityJson(
      { ok: false, code: error.code, message: error.message },
      error.statusCode,
    );
  }
  return tenantRootSecurityJson(
    {
      ok: false,
      code: 'tenant_deployment_operation_failed',
      message: error instanceof Error ? error.message : 'tenant deployment operation failed',
    },
    error instanceof Error && error.message.includes('not found') ? 404 : 409,
  );
}

export function createTenantDeploymentConsoleRouteV1(
  dependencies: TenantDeploymentConsoleRouteDependenciesV1,
): (request: Request) => Promise<Response | null> {
  return async function handleTenantDeploymentConsoleRoute(
    request: Request,
  ): Promise<Response | null> {
    const url = new URL(request.url);
    const isPlan = url.pathname === TENANT_DEPLOYMENT_CUTOVERS_PATH_V1;
    const match = matchCutoverRoute(url.pathname);
    if (!isPlan && !match) return null;
    const guarded = await guardTenantRootSecurityRequestV1(dependencies, request, url);
    if (!guarded.ok) return guarded.response;
    const identity = guarded.request.identity;
    try {
      if (isPlan) return await planCutover(dependencies, request, identity);
      if (!match) return tenantRootSecurityJson({ ok: false, code: 'not_found' }, 404);
      if (match.action === 'status') {
        const cutover = await requireCutover(dependencies, match.operationId);
        return cutover.state.deploymentLane === dependencies.deploymentLane &&
          sameTargetIdentity(cutover.state, identity)
          ? response(cutover, true)
          : tenantRootSecurityJson({ ok: false, code: 'cutover_not_found' }, 404);
      }
      if (match.action === 'tenant-root') {
        return await prepareTenantRoot(dependencies, match.operationId, identity);
      }
      if (match.action === 'readiness') {
        return await prepareReadiness(
          dependencies,
          request,
          match.operationId,
          identity,
          guarded.request.nowMs,
        );
      }
      return await activate(dependencies, match.operationId, identity);
    } catch (error: unknown) {
      return errorResponse(error);
    }
  };
}
