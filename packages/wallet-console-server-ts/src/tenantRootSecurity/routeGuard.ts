import type { ConsoleOrgProjectEnvService } from '@seams-internal/console-server/orgProjectEnv/service';
import type { ConsoleAuthAdapter } from '@seams-internal/console-server/router/consoleAuth';
import { authenticateConsoleRequest } from '@seams-internal/console-server/router/consoleAuth';
import {
  consoleRouteRequiresFreshStepUpV1,
  findConsoleRouteDefinitionForRequest,
  type ConsoleRouteDefinition,
} from '@seams-internal/console-server/router/consoleRouteDefinitions';
import { createComposedConsoleRouteDefinitions } from '../router/walletConsoleRouteDefinitions';
import { authorizeConsoleRouteRequest } from '@seams-internal/console-server/router/consoleRoutePolicy';
import { headersToRecord } from '@seams/wallet-server/cloud-host';
import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  type TenantRootIdentityV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import {
  parseTenantRootStepUpV1,
  type TenantRootStepUpParseResultV1,
  type TenantRootStepUpProofV1,
  type TenantRootStepUpSessionRecordV1,
} from './stepUp';

/**
 * The shared preamble for every derivation-root console request.
 *
 * Route policy grants coarse access; this guard independently requires
 * server-issued fresh step-up for any route the table marks as a mutation. The
 * two checks are deliberately separate: a session claim can grant access, but
 * it can never prove presence.
 *
 * Step-up is bound to the session presenting the request. When the auth
 * adapter names the session, that name is the binding; otherwise the
 * presented credential itself is fingerprinted, so a proof recorded for one
 * credential never authorizes a request made with another.
 */

/**
 * Optional header naming the environment the caller believes it is acting on.
 *
 * The server resolves the authoritative identity from the session; this header
 * cannot select or override it. It exists so a CLI invoked for one environment
 * fails rather than silently acting on whichever environment the session
 * happens to be scoped to.
 */
export const TENANT_ROOT_ENVIRONMENT_HEADER_V1 = 'x-seams-environment';

/** Reads one actor's recorded step-up for the current console session. */
export interface TenantRootStepUpReaderV1 {
  readStepUp(input: {
    readonly orgId: string;
    readonly actorUserId: string;
  }): Promise<TenantRootStepUpSessionRecordV1 | null>;
}

/** What every derivation-root route needs before it can act. */
export interface TenantRootSecurityGuardDependenciesV1 {
  readonly auth: ConsoleAuthAdapter;
  readonly orgProjectEnv: ConsoleOrgProjectEnvService;
  readonly stepUp: TenantRootStepUpReaderV1;
  readonly now?: () => number;
}

/** One authorized derivation-root request. */
export type TenantRootSecurityRequestV1 = {
  readonly route: ConsoleRouteDefinition;
  readonly identity: TenantRootIdentityV1;
  readonly orgId: string;
  readonly actorUserId: string;
  /** The console session presenting the request; step-up must belong to it. */
  readonly sessionId: string;
  readonly stepUp: TenantRootStepUpProofV1 | null;
  readonly nowMs: number;
};

/** The guard's outcome: an authorized request, or the response to return. */
export type TenantRootSecurityGuardResultV1 =
  | { readonly ok: true; readonly request: TenantRootSecurityRequestV1 }
  | { readonly ok: false; readonly response: Response };

/** Builds a no-store JSON response. */
export function tenantRootSecurityJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Derivation-root state must not sit in an intermediary cache.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** Returns the session record fields a proof was parsed from. */
export function tenantRootStepUpRecordFromProofV1(
  proof: TenantRootStepUpProofV1,
): TenantRootStepUpSessionRecordV1 {
  return {
    actorUserId: proof.actorUserId,
    sessionId: proof.sessionId,
    method: proof.method,
    verifiedAtMs: proof.verifiedAtMs,
  };
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text !== value) throw new Error(`${label} is invalid`);
  return text;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/**
 * Names the session a request was made with.
 *
 * The adapter's own session id wins. Without one, the credential the request
 * carries is fingerprinted: the bearer token for a CLI, otherwise the cookie
 * header. A step-up ceremony records the same fingerprint, so only the
 * credential that stepped up can spend it.
 */
export async function tenantRootRequestSessionIdV1(
  request: Request,
  claimedSessionId: string | undefined,
): Promise<string> {
  if (claimedSessionId !== undefined && claimedSessionId.length > 0) return claimedSessionId;
  const credential = request.headers.get('authorization') ?? request.headers.get('cookie') ?? '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
  return `credential:${base64UrlEncode(new Uint8Array(digest))}`;
}

/**
 * Verifies fresh step-up for one request, resolving its session id first.
 *
 * Both the security guard and the tenant-root refresh route call this. A second
 * copy of these checks is how a route ends up enforcing a slightly different
 * rule than the one the route table advertises.
 */
export async function verifyFreshStepUpForRequestV1(input: {
  readonly stepUp: TenantRootStepUpReaderV1;
  readonly request: Request;
  readonly claims: {
    readonly orgId: string;
    readonly userId: string;
    readonly sessionId?: string;
  };
  readonly nowMs: number;
}): Promise<TenantRootStepUpParseResultV1> {
  const sessionId = await tenantRootRequestSessionIdV1(input.request, input.claims.sessionId);
  const record = await input.stepUp.readStepUp({
    orgId: input.claims.orgId,
    actorUserId: input.claims.userId,
  });
  return parseTenantRootStepUpV1({
    record,
    expectedActorUserId: input.claims.userId,
    expectedSessionId: sessionId,
    nowMs: input.nowMs,
  });
}

async function resolveIdentity(
  dependencies: Pick<TenantRootSecurityGuardDependenciesV1, 'orgProjectEnv'>,
  claims: {
    readonly orgId: string;
    readonly userId: string;
    readonly projectId?: string;
    readonly environmentId?: string;
  },
): Promise<TenantRootIdentityV1> {
  const projectId = requiredText(claims.projectId, 'authenticated projectId');
  const environmentId = requiredText(claims.environmentId, 'authenticated environmentId');
  const environments = await dependencies.orgProjectEnv.listEnvironments(
    { orgId: claims.orgId, actorUserId: claims.userId, projectId, environmentId },
    { projectId, status: 'ACTIVE' },
  );
  const environment = environments.find(
    (candidate) => candidate.id === environmentId && candidate.projectId === projectId,
  );
  if (!environment) throw new Error('Authenticated Console environment is not active');
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: requiredText(claims.orgId, 'authenticated orgId'),
    projectId,
    envId: environment.id,
    signingRootId: `${projectId}:${environment.key}`,
    signingRootVersion: environment.runtimeVersion,
  });
  if (!identity.ok) throw new Error('Authenticated Console tenant-root identity is not canonical');
  return identity.value;
}

/**
 * Authenticates, authorizes, and resolves one derivation-root request.
 *
 * A mutation with absent or stale step-up is refused here, before any state is
 * read or any control-plane call is made.
 */
export async function guardTenantRootSecurityRequestV1(
  dependencies: TenantRootSecurityGuardDependenciesV1,
  request: Request,
  url: URL,
): Promise<TenantRootSecurityGuardResultV1> {
  const definitions = createComposedConsoleRouteDefinitions();
  const auth = await authenticateConsoleRequest(
    headersToRecord(request.headers),
    dependencies.auth,
  );
  if (!auth.ok) {
    return {
      ok: false,
      response: tenantRootSecurityJson(
        { ok: false, code: auth.code, message: auth.message },
        auth.status,
      ),
    };
  }

  const route = findConsoleRouteDefinitionForRequest(definitions, request.method, url.pathname);
  if (!route) {
    return {
      ok: false,
      response: tenantRootSecurityJson(
        { ok: false, code: 'method_not_allowed', message: 'Method not allowed' },
        405,
      ),
    };
  }
  const authorization = authorizeConsoleRouteRequest({
    claims: auth.claims,
    definitions,
    method: request.method,
    pathname: url.pathname,
    ...(auth.claims.projectId ? { projectId: auth.claims.projectId } : {}),
  });
  if (!authorization.ok) {
    return {
      ok: false,
      response: tenantRootSecurityJson(authorization.body, authorization.status),
    };
  }

  const nowMs = (dependencies.now ?? (() => Date.now()))();
  const sessionId = await tenantRootRequestSessionIdV1(request, auth.claims.sessionId);
  let stepUp: TenantRootStepUpProofV1 | null = null;
  if (consoleRouteRequiresFreshStepUpV1(route)) {
    const parsed = await verifyFreshStepUpForRequestV1({
      stepUp: dependencies.stepUp,
      request,
      claims: auth.claims,
      nowMs,
    });
    if (!parsed.ok) {
      return {
        ok: false,
        response: tenantRootSecurityJson(
          { ok: false, code: 'step_up_required', error: parsed.error },
          403,
        ),
      };
    }
    stepUp = parsed.proof;
  }

  try {
    const identity = await resolveIdentity(dependencies, auth.claims);
    const selectedEnvironment = request.headers.get(TENANT_ROOT_ENVIRONMENT_HEADER_V1);
    if (selectedEnvironment !== null && selectedEnvironment !== identity.envId) {
      // The caller named an environment this session is not scoped to. The
      // header cannot reselect; it can only stop a command aimed elsewhere.
      return {
        ok: false,
        response: tenantRootSecurityJson(
          {
            ok: false,
            code: 'environment_mismatch',
            message: 'The selected environment is not the environment this session is scoped to',
            environmentId: identity.envId,
          },
          409,
        ),
      };
    }
    return {
      ok: true,
      request: {
        route,
        identity,
        orgId: auth.claims.orgId,
        actorUserId: auth.claims.userId,
        sessionId,
        stepUp,
        nowMs,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      response: tenantRootSecurityJson(
        {
          ok: false,
          code: 'tenant_root_scope_unresolved',
          message:
            error instanceof Error ? error.message : 'Could not resolve the derivation root scope',
        },
        409,
      ),
    };
  }
}
