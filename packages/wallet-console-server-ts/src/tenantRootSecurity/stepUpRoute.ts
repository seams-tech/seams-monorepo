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
} from './stepUpCeremony';
import { tenantRootRequestSessionIdV1 } from './routeGuard';

/**
 * The console step-up ceremony route.
 *
 * This is the one console surface that must NOT require step-up: it is how an
 * actor obtains it. It requires a signed-in console user and nothing more, and
 * it acts only on that user's own credentials — the actor is taken from the
 * verified session, never from the request body.
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
  }
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
          const started = await startConsoleStepUpRegistrationV1(dependencies, actor, nowMs);
          return started.ok
            ? json({ ok: true, options: started.value.optionsJson }, 200)
            : refusal(started.error);
        }
        case REGISTRATION_VERIFY_PATH_V1: {
          const body = await readObject(request);
          const finished = await finishConsoleStepUpRegistrationV1(
            dependencies,
            actor,
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
          // The response says step-up was recorded and for how long it counts.
          // It never returns the record itself: an operation reads that from
          // the store, so a client cannot present one.
          return finished.ok
            ? json({ ok: true, method: finished.value.method, verifiedAtMs: nowMs }, 200)
            : refusal(finished.error);
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
