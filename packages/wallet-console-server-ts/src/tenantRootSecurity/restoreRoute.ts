import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import type {
  TenantRootDeriverRoleV1,
  TenantRootIdentityV1,
} from '@seams-internal/shared-ts/tenant-root';
import { checkTenantRootAuditEventRedactionV1 } from './audit';
import type { TenantRootAuditWriterV1 } from './custodyRoute';
import {
  activateRestoredRootV1,
  authenticateRestoreSessionV1,
  expireRestoreSessionIfDueV1,
  importRestoreRoleShareV1,
  issueRestoreRoleImportKeyV1,
  mintRestoreBootstrapSessionV1,
  registerRestoreManifestV1,
  startRestoreSessionV1,
  type TenantRootRestoreControlPlaneV1,
  type TenantRootRestoreRoleImportOperationStoreV1,
  type TenantRootRestoreStoreV1,
  type TenantRootSourceDispositionChoiceV1,
} from './restoreService';
import { tenantRootSecurityJson } from './routeGuard';

/**
 * The destination restore console handlers.
 *
 * These deliberately do not use the console session guard. A restore
 * destination is an empty deployment: it has no tenant, no owners, and no
 * console session, and a session from the *source* deployment proves nothing
 * about it. The only admission is the destination's own one-time bootstrap
 * credential, which opens a 30-minute administration session; every other
 * request presents that session, and activation additionally requires the
 * credential to have been presented within the last five minutes.
 */

export const TENANT_ROOT_RESTORE_BOOTSTRAP_SESSION_PATH_V1 =
  '/console/tenant-root/security/restore/bootstrap-session';
export const TENANT_ROOT_RESTORE_PATH_V1 = '/console/tenant-root/security/restore';
export const TENANT_ROOT_RESTORE_MANIFEST_PATH_V1 =
  '/console/tenant-root/security/restore/manifest';
export const TENANT_ROOT_RESTORE_IMPORT_KEY_PATH_V1 =
  '/console/tenant-root/security/restore/import-key';
export const TENANT_ROOT_RESTORE_IMPORT_PATH_V1 = '/console/tenant-root/security/restore/import';
export const TENANT_ROOT_RESTORE_ACTIVATE_PATH_V1 =
  '/console/tenant-root/security/restore/activate';
export const TENANT_ROOT_RESTORE_STATUS_PATH_V1 = '/console/tenant-root/security/restore/status';

/** The header the destination bootstrap credential travels in, once. */
export const TENANT_ROOT_BOOTSTRAP_HEADER_V1 = 'x-seams-destination-bootstrap';
/** The header the restore administration session travels in. */
export const TENANT_ROOT_RESTORE_SESSION_HEADER_V1 = 'x-seams-restore-session';

const RESTORE_PATHS: ReadonlySet<string> = new Set([
  TENANT_ROOT_RESTORE_BOOTSTRAP_SESSION_PATH_V1,
  TENANT_ROOT_RESTORE_PATH_V1,
  TENANT_ROOT_RESTORE_MANIFEST_PATH_V1,
  TENANT_ROOT_RESTORE_IMPORT_KEY_PATH_V1,
  TENANT_ROOT_RESTORE_IMPORT_PATH_V1,
  TENANT_ROOT_RESTORE_ACTIVATE_PATH_V1,
  TENANT_ROOT_RESTORE_STATUS_PATH_V1,
]);

/** Authenticates the destination's one-time bootstrap credential. */
export interface TenantRootBootstrapAuthenticatorV1 {
  authenticate(input: {
    readonly token: string;
  }): Promise<{ readonly ok: true; readonly actorUserId: string } | { readonly ok: false }>;
}

/** Everything the restore handlers need. */
export interface TenantRootRestoreRouteDependenciesV1 {
  readonly bootstrap: TenantRootBootstrapAuthenticatorV1;
  readonly identity: TenantRootIdentityV1;
  readonly restore: TenantRootRestoreStoreV1 & TenantRootRestoreRoleImportOperationStoreV1;
  readonly controlPlane: TenantRootRestoreControlPlaneV1;
  readonly audit: TenantRootAuditWriterV1;
  readonly now?: () => number;
  readonly newSessionId?: () => string;
  readonly newSessionToken?: () => string;
}

function parseRole(value: unknown): TenantRootDeriverRoleV1 {
  if (value === 'deriver_a' || value === 'deriver_b') return value;
  throw new Error('role must be deriver_a or deriver_b');
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text !== value) throw new Error(`${label} is invalid`);
  return text;
}

function parseImportKeyIssueRequest(body: Record<string, unknown>): {
  readonly role: TenantRootDeriverRoleV1;
  readonly operationId: string;
} {
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes('role') || !keys.includes('operationId')) {
    throw new Error('restore import-key request fields are invalid');
  }
  return {
    role: parseRole(body.role),
    operationId: requiredText(body.operationId, 'operationId'),
  };
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object');
  }
  return body as Record<string, unknown>;
}

/**
 * Parses what the tenant chooses about the source. The actor and time are
 * never read here; a `verified_retired` claim cannot be made at activation.
 */
function parseSourceDisposition(value: unknown): TenantRootSourceDispositionChoiceV1 {
  if (value === undefined || value === null) {
    // Retained-as-backup is the default: restore never retires a source on its
    // own, and an omitted disposition must not silently become a stronger one.
    return { kind: 'retained_as_backup' };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('sourceDisposition must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'retained_as_backup') {
    return {
      kind: 'retained_as_backup',
      ...(record.incidentResponseNote === undefined
        ? {}
        : {
            incidentResponseNote: requiredText(record.incidentResponseNote, 'incidentResponseNote'),
          }),
    };
  }
  if (record.kind === 'unavailable_retirement_unverified') {
    const checks = Array.isArray(record.attemptedChecks) ? record.attemptedChecks : [];
    if (checks.length === 0) {
      throw new Error('an unverified retirement must name the checks that were attempted');
    }
    return {
      kind: 'unavailable_retirement_unverified',
      attemptedChecks: checks.map((entry) => requiredText(entry, 'attemptedCheck')),
    };
  }
  // verified_retired is not reachable here: it needs destruction, probe,
  // revocation, and canary receipts from the source, which activation cannot
  // have. It is recorded by the separate retirement action afterwards.
  throw new Error('sourceDisposition kind cannot be recorded at activation');
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/** Creates the destination restore route. */
function randomRestoreSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function createTenantRootRestoreConsoleRouteV1(
  dependencies: TenantRootRestoreRouteDependenciesV1,
): (request: Request) => Promise<Response | null> {
  const now = dependencies.now ?? (() => Date.now());
  const newSessionId = dependencies.newSessionId ?? randomRestoreSessionId;
  const newSessionToken = dependencies.newSessionToken ?? randomToken;

  async function record(event: Parameters<TenantRootAuditWriterV1['write']>[0]): Promise<void> {
    const redaction = checkTenantRootAuditEventRedactionV1(event);
    if (!redaction.ok) {
      throw new Error(
        `refusing to write an unredacted audit event: ${JSON.stringify(redaction.errors)}`,
      );
    }
    await dependencies.audit.write(event);
  }

  return async (request) => {
    const url = new URL(request.url);
    if (!RESTORE_PATHS.has(url.pathname)) return null;
    const expectedMethod = url.pathname === TENANT_ROOT_RESTORE_STATUS_PATH_V1 ? 'GET' : 'POST';
    if (request.method !== expectedMethod) {
      return tenantRootSecurityJson(
        { ok: false, code: 'method_not_allowed', message: 'Method not allowed' },
        405,
      );
    }
    const nowMs = now();
    const atIso = new Date(nowMs).toISOString();

    // The bootstrap credential travels only to this one path, only in this
    // header, and is never echoed back or included in any response body.
    if (url.pathname === TENANT_ROOT_RESTORE_BOOTSTRAP_SESSION_PATH_V1) {
      const token = request.headers.get(TENANT_ROOT_BOOTSTRAP_HEADER_V1) ?? '';
      const authenticated =
        token === ''
          ? { ok: false as const }
          : await dependencies.bootstrap.authenticate({ token });
      if (!authenticated.ok) {
        return tenantRootSecurityJson(
          {
            ok: false,
            code: 'bootstrap_authentication_failed',
            message: 'Destination bootstrap authentication failed',
          },
          401,
        );
      }
      const minted = await mintRestoreBootstrapSessionV1(dependencies.restore, {
        actorUserId: authenticated.actorUserId,
        nowMs,
        newSessionToken,
      });
      const response = tenantRootSecurityJson({
        ok: true,
        sessionToken: minted.sessionToken,
        expiresAt: new Date(minted.expiresAtMs).toISOString(),
      });
      response.headers.set('x-seams-recovery-identity', await tenantRootIdentityDigestB64uV1(dependencies.identity));
      return response;
    }

    const sessionToken = request.headers.get(TENANT_ROOT_RESTORE_SESSION_HEADER_V1) ?? '';
    const adminSession =
      sessionToken === ''
        ? null
        : await authenticateRestoreSessionV1(dependencies.restore, { sessionToken, nowMs });
    if (adminSession === null) {
      return tenantRootSecurityJson(
        {
          ok: false,
          code: 'restore_session_required',
          message: 'A live restore administration session is required',
        },
        401,
      );
    }
    const actorUserId = adminSession.actorUserId;

    try {
      switch (url.pathname) {
        case TENANT_ROOT_RESTORE_PATH_V1: {
          const outcome = await startRestoreSessionV1(
            dependencies.restore,
            dependencies.controlPlane,
            {
              sessionId: newSessionId(),
              authenticatedSession: adminSession,
              atIso,
              nowMs,
            },
          );
          await record(outcome.audit);
          return outcome.ok
            ? tenantRootSecurityJson({ ok: true, session: outcome.value })
            : tenantRootSecurityJson({ ok: false, error: outcome.error }, 409);
        }
        case TENANT_ROOT_RESTORE_STATUS_PATH_V1: {
          let context = await dependencies.restore.readContext();
          const expired = await expireRestoreSessionIfDueV1(
            dependencies.restore,
            dependencies.controlPlane,
            { context, actorUserId, atIso, nowMs },
          );
          if (expired.kind === 'finalized') {
            await record(expired.audit);
          } else if (expired.kind === 'stale') {
            context = await dependencies.restore.readContext();
          }
          return tenantRootSecurityJson({
            ok: true,
            session: expired.kind === 'finalized' ? expired.session : context.session,
          });
        }
        case TENANT_ROOT_RESTORE_MANIFEST_PATH_V1: {
          const body = await readObject(request);
          const outcome = await registerRestoreManifestV1(
            dependencies.restore,
            dependencies.controlPlane,
            {
              manifestB64u: requiredText(body.manifestB64u, 'manifestB64u'),
              actorUserId,
              atIso,
              nowMs,
            },
          );
          await record(outcome.audit);
          return outcome.ok
            ? tenantRootSecurityJson({ ok: true, session: outcome.value })
            : tenantRootSecurityJson({ ok: false, error: outcome.error }, 409);
        }
        case TENANT_ROOT_RESTORE_IMPORT_KEY_PATH_V1: {
          const body = await readObject(request);
          const issueRequest = parseImportKeyIssueRequest(body);
          const outcome = await issueRestoreRoleImportKeyV1(
            dependencies.restore,
            dependencies.controlPlane,
            {
              role: issueRequest.role,
              operationId: issueRequest.operationId,
              identity: dependencies.identity,
              authenticatedSession: adminSession,
              actorUserId,
              atIso,
              nowMs,
            },
          );
          await record(outcome.audit);
          return outcome.ok
            ? tenantRootSecurityJson({
                ok: true,
                importKeyId: outcome.value.importKeyId,
                importPublicKeyB64u: outcome.value.importPublicKeyB64u,
                destinationFingerprintB64u: outcome.value.destinationFingerprintB64u,
                destinationLineageB64u: outcome.value.destinationLineageB64u,
                restoreSessionIdB64u: outcome.value.restoreSessionId,
                operationId: outcome.value.operationId,
                operationDigestB64u: outcome.value.operationDigestB64u,
                commandDigestB64u: outcome.value.commandDigestB64u,
                role: outcome.value.role,
                generation: outcome.value.generation,
                issuedAtMs: outcome.value.issuedAtMs,
                expiresAtMs: outcome.value.expiresAtMs,
                replayed: outcome.value.replayed,
              })
            : tenantRootSecurityJson({ ok: false, error: outcome.error }, 409);
        }
        case TENANT_ROOT_RESTORE_IMPORT_PATH_V1: {
          const body = await readObject(request);
          const outcome = await importRestoreRoleShareV1(
            dependencies.restore,
            dependencies.controlPlane,
            {
              role: parseRole(body.role),
              importEnvelopeB64u: requiredText(body.importEnvelopeB64u, 'importEnvelopeB64u'),
              authenticatedSession: adminSession,
              actorUserId,
              atIso,
              nowMs,
            },
          );
          await record(outcome.audit);
          return outcome.ok
            ? tenantRootSecurityJson({
                ok: true,
                session: outcome.value.session,
                receiptDigestB64u: outcome.value.receiptDigestB64u,
                replayed: outcome.value.replayed,
              })
            : tenantRootSecurityJson({ ok: false, error: outcome.error }, 409);
        }
        case TENANT_ROOT_RESTORE_ACTIVATE_PATH_V1: {
          const body = await readObject(request);
          const outcome = await activateRestoredRootV1(
            dependencies.restore,
            dependencies.controlPlane,
            {
              offlineTrustAcknowledged: body.acknowledgeOfflineTrust === true,
              sourceDisposition: parseSourceDisposition(body.sourceDisposition),
              authenticatedSession: adminSession,
              actorUserId,
              atIso,
              nowMs,
            },
          );
          await record(outcome.audit);
          return outcome.ok
            ? tenantRootSecurityJson({ ok: true, session: outcome.value })
            : tenantRootSecurityJson({ ok: false, error: outcome.error }, 409);
        }
        default:
          return tenantRootSecurityJson(
            { ok: false, code: 'not_found', message: 'Unknown restore operation' },
            404,
          );
      }
    } catch {
      return tenantRootSecurityJson(
        {
          ok: false,
          code: 'tenant_root_restore_operation_failed',
          message: 'Restore operation failed',
        },
        400,
      );
    }
  };
}
