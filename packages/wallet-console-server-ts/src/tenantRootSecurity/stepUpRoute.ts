import {
  authenticateConsoleRequest,
  type ConsoleAuthAdapter,
} from '@seams-internal/console-server/router/consoleAuth';
import {
  finishConsoleStepUpAssertionV1,
  finishConsoleStepUpRegistrationV1,
  startConsoleStepUpAssertionV1,
  startConsoleStepUpRegistrationV1,
  type ConsoleStepUpActorV1,
  type ConsoleStepUpCeremonyDependenciesV1,
  type ConsoleStepUpCeremonyErrorV1,
  type ConsoleStepUpRegistrationAuthorizationV1,
} from './stepUpCeremony';
import { tenantRootRequestSessionIdV1 } from './routeGuard';
import type { SessionAdapter } from '@seams-internal/console-server/boundary/session';
import {
  issueConsoleStepUpPasskeyEnrollmentProofV1,
  verifyConsoleStepUpPasskeyEnrollmentProofV1,
  verifyConsoleStepUpProviderEnrollmentProofV1,
} from './stepUpEnrollmentProof';

/**
 * The console step-up ceremony route.
 *
 * Assertion starts from an authenticated Console session. First credential
 * registration additionally requires proof of a recent provider sign-in.
 * Later registration requires proof returned after an existing credential's
 * assertion. This proof is separate from the bearer Console session.
 * Every operation acts on the user named by the verified Console session.
 */

/** Path prefix every ceremony endpoint shares. */
export const CONSOLE_STEP_UP_PATH_PREFIX_V1 = '/console/step-up/webauthn';

const REGISTRATION_OPTIONS_PATH_V1 = `${CONSOLE_STEP_UP_PATH_PREFIX_V1}/registration/options`;
const REGISTRATION_VERIFY_PATH_V1 = `${CONSOLE_STEP_UP_PATH_PREFIX_V1}/registration/verify`;
const ASSERTION_OPTIONS_PATH_V1 = `${CONSOLE_STEP_UP_PATH_PREFIX_V1}/assertion/options`;
const ASSERTION_VERIFY_PATH_V1 = `${CONSOLE_STEP_UP_PATH_PREFIX_V1}/assertion/verify`;

const CEREMONY_PATHS_V1: ReadonlySet<string> = new Set([
  REGISTRATION_OPTIONS_PATH_V1,
  REGISTRATION_VERIFY_PATH_V1,
  ASSERTION_OPTIONS_PATH_V1,
  ASSERTION_VERIFY_PATH_V1,
]);

/** Everything the ceremony route needs. */
export interface ConsoleStepUpRouteDependenciesV1 extends ConsoleStepUpCeremonyDependenciesV1 {
  readonly auth: ConsoleAuthAdapter;
  readonly session: Pick<SessionAdapter, 'signJwt' | 'verifyJwt'>;
  readonly now?: () => number;
}

/** HTTP status for one ceremony refusal. */
function statusFor(error: ConsoleStepUpCeremonyErrorV1): number {
  switch (error.kind) {
    case 'no_credential_registered':
      return 409;
    case 'unsupported_runtime':
      return 503;
    case 'challenge_missing':
    case 'challenge_expired':
    case 'challenge_session_mismatch':
    case 'unknown_credential':
    case 'registration_rejected':
    case 'assertion_rejected':
    case 'counter_regressed':
      return 400;
    case 'enrollment_authorization_required':
      return 403;
  }
}

async function authorizeRegistration(
  dependencies: ConsoleStepUpRouteDependenciesV1,
  actor: ConsoleStepUpActorV1,
  body: Record<string, unknown>,
  nowMs: number,
): Promise<ConsoleStepUpRegistrationAuthorizationV1 | null> {
  const existing = await dependencies.credentials.listCredentials({
    orgId: actor.orgId,
    userId: actor.userId,
  });
  if (existing.length > 0) {
    const verified = await verifyConsoleStepUpPasskeyEnrollmentProofV1({
      session: dependencies.session,
      proof: body.enrollmentProof,
      userId: actor.userId,
      orgId: actor.orgId,
      nowMs,
    });
    return verified.ok ? { kind: 'existing_passkey', passkeyProof: verified.proof } : null;
  }
  const verified = await verifyConsoleStepUpProviderEnrollmentProofV1({
    session: dependencies.session,
    proof: body.enrollmentProof,
    userId: actor.userId,
    nowMs,
  });
  return verified.ok ? { kind: 'fresh_sign_in', providerProof: verified.proof } : null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // A ceremony response carries a live challenge; it is never cacheable.
      'cache-control': 'no-store',
    },
  });
}

function refusal(error: ConsoleStepUpCeremonyErrorV1): Response {
  return json({ ok: false, code: error.kind }, statusFor(error));
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required`);
  return text;
}

/** Creates the console step-up ceremony route. */
export function createConsoleStepUpRouteV1(
  dependencies: ConsoleStepUpRouteDependenciesV1,
): (request: Request) => Promise<Response | null> {
  const now = dependencies.now ?? (() => Date.now());

  return async function handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!CEREMONY_PATHS_V1.has(url.pathname)) return null;
    if (request.method !== 'POST') {
      return json({ ok: false, code: 'method_not_allowed' }, 405);
    }

    const auth = await authenticateConsoleRequest(
      Object.fromEntries(request.headers.entries()),
      dependencies.auth,
    );
    if (!auth.ok) {
      return json({ ok: false, code: auth.code, message: auth.message }, 401);
    }

    // The actor is the verified session's, so a body cannot enrol or assert a
    // credential for somebody else.
    const actor: ConsoleStepUpActorV1 = {
      orgId: auth.claims.orgId,
      userId: auth.claims.userId,
      userName: auth.claims.email ?? auth.claims.userId,
      sessionId: await tenantRootRequestSessionIdV1(request, auth.claims.sessionId),
    };
    const nowMs = now();

    try {
      switch (url.pathname) {
        case REGISTRATION_OPTIONS_PATH_V1: {
          const body = await readObject(request);
          const authorization = await authorizeRegistration(dependencies, actor, body, nowMs);
          if (authorization === null) {
            return json({ ok: false, code: 'enrollment_authorization_required' }, 403);
          }
          const started = await startConsoleStepUpRegistrationV1(
            dependencies,
            actor,
            authorization,
            nowMs,
          );
          return started.ok
            ? json({ ok: true, options: started.value.optionsJson }, 200)
            : refusal(started.error);
        }
        case REGISTRATION_VERIFY_PATH_V1: {
          const body = await readObject(request);
          const authorization = await authorizeRegistration(dependencies, actor, body, nowMs);
          if (authorization === null) {
            return json({ ok: false, code: 'enrollment_authorization_required' }, 403);
          }
          const finished = await finishConsoleStepUpRegistrationV1(
            dependencies,
            actor,
            authorization,
            requiredText(body.response, 'response'),
            nowMs,
          );
          return finished.ok
            ? json(
                {
                  ok: true,
                  credentialIdB64u: finished.value.credentialIdB64u,
                  method: finished.value.method,
                },
                200,
              )
            : refusal(finished.error);
        }
        case ASSERTION_OPTIONS_PATH_V1: {
          const started = await startConsoleStepUpAssertionV1(dependencies, actor, nowMs);
          return started.ok
            ? json({ ok: true, options: started.value.optionsJson }, 200)
            : refusal(started.error);
        }
        case ASSERTION_VERIFY_PATH_V1: {
          const body = await readObject(request);
          const finished = await finishConsoleStepUpAssertionV1(
            dependencies,
            actor,
            {
              responseJson: requiredText(body.response, 'response'),
              credentialIdB64u: requiredText(body.credentialIdB64u, 'credentialIdB64u'),
            },
            nowMs,
          );
          if (!finished.ok) return refusal(finished.error);
          const enrollmentProof = await issueConsoleStepUpPasskeyEnrollmentProofV1(
            dependencies.session,
            actor.userId,
            actor.orgId,
          );
          // The proof authorizes credential addition. Operations still read
          // the server-held step-up record for this Console session.
          return json(
            { ok: true, method: finished.value.method, verifiedAtMs: nowMs, enrollmentProof },
            200,
          );
        }
        default:
          return null;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'request body is invalid';
      return json({ ok: false, code: 'invalid_request', message }, 400);
    }
  };
}
