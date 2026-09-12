import type { ConsoleAuditService } from '@seams-internal/console-server/audit/service';
import { base64UrlEncode, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  decodeTenantRootIdentityWireV1,
  type TenantRootIdentityV1,
} from '@seams-internal/shared-ts/tenant-root';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams-internal/shared-ts/utils/validation';
import { enrollmentBytes, enrollmentSecretHash, enrollmentText } from './cliEnrollmentStore';
import {
  guardTenantRootSecurityRequestV1,
  tenantRootSecurityJson as json,
  type TenantRootSecurityGuardDependenciesV1,
} from './routeGuard';

export const RESTORE_ACCESS_PATH = '/console/tenant-root/security/restore-access';
type Access =
  | { kind: 'unavailable' }
  | {
      kind: 'configured';
      identity: TenantRootIdentityV1;
      identityDigest: string;
      destination: string;
      credential: string;
    };
type Dependencies = TenantRootSecurityGuardDependenciesV1 & {
  audit: Pick<ConsoleAuditService, 'appendEvent'>;
  database: D1DatabaseLike;
  namespace: string;
  isOwner: (input: { readonly orgId: string; readonly userId: string }) => Promise<boolean>;
};
type RequestBinding = {
  id: string;
  identityDigest: string;
  destination: string;
  expiresAtMs: number;
};
type ApprovalRequest = RequestBinding &
  (
    | { state: 'pending' | 'denied'; actorUserId?: never; session?: never }
    | {
        state: 'approved';
        actorUserId: string;
        session: { destination: string; sessionToken: string; expiresAt: string };
      }
  );

async function parseAccess(configuration: string | undefined): Promise<Access> {
  if (!configuration) return { kind: 'unavailable' };
  const value: unknown = JSON.parse(configuration);
  if (!isPlainObject(value)) throw new Error('Invalid restore access configuration');
  const identity = decodeTenantRootIdentityWireV1(value.identity);
  const destination = new URL(enrollmentText(value.destination));
  if (!identity.ok || destination.protocol !== 'https:' || destination.origin !== value.destination)
    throw new Error('Invalid restore access destination');
  return {
    kind: 'configured',
    identity: identity.value,
    identityDigest: await tenantRootIdentityDigestB64uV1(identity.value),
    destination: destination.origin,
    credential: enrollmentBytes(value.credential, 32),
  };
}
function parseSession(raw: unknown, destination: string) {
  if (
    !isPlainObject(raw) ||
    raw.destination !== destination ||
    typeof raw.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.expiresAt))
  )
    throw new Error('Invalid restore session');
  return {
    destination,
    sessionToken: enrollmentBytes(raw.sessionToken, 32),
    expiresAt: raw.expiresAt,
  };
}
function parseRequest(raw: unknown): ApprovalRequest | null {
  if (raw === null) return null;
  if (!isPlainObject(raw) || typeof raw.expires_at_ms !== 'number')
    throw new Error('Invalid restore approval');
  const binding: RequestBinding = {
    id: enrollmentBytes(raw.id, 16),
    identityDigest: enrollmentBytes(raw.identity_digest, 32),
    destination: enrollmentText(raw.destination),
    expiresAtMs: raw.expires_at_ms,
  };
  switch (raw.state) {
    case 'pending':
      return {
        id: binding.id,
        identityDigest: binding.identityDigest,
        destination: binding.destination,
        expiresAtMs: binding.expiresAtMs,
        state: 'pending',
      };
    case 'denied':
      return {
        id: binding.id,
        identityDigest: binding.identityDigest,
        destination: binding.destination,
        expiresAtMs: binding.expiresAtMs,
        state: 'denied',
      };
    case 'approved':
      return {
        id: binding.id,
        identityDigest: binding.identityDigest,
        destination: binding.destination,
        expiresAtMs: binding.expiresAtMs,
        state: 'approved',
        actorUserId: enrollmentText(raw.actor_user_id),
        session: parseSession(JSON.parse(enrollmentText(raw.session_json)), binding.destination),
      };
    default:
      throw new Error('Invalid restore approval state');
  }
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 4096) throw new Error('Request too large');
  const body: unknown = JSON.parse(text);
  if (!isPlainObject(body)) throw new Error('Invalid request');
  return body;
}
function describe(record: ApprovalRequest, access: Extract<Access, { kind: 'configured' }>) {
  return {
    ok: true,
    id: record.id,
    state: record.state,
    confirmationCode: record.id.slice(0, 8).toUpperCase(),
    organizationId: access.identity.orgId,
    environmentId: access.identity.envId,
    destination: record.destination,
    expiresAtMs: record.expiresAtMs,
  };
}
class RestoreAccessRoute {
  constructor(
    private readonly deps: Dependencies,
    private readonly access: Access,
  ) {}
  async ownerStillActive(identity: TenantRootIdentityV1, actorUserId: string): Promise<boolean> {
    if (!(await this.deps.isOwner({ orgId: identity.orgId, userId: actorUserId }))) return false;
    const environments = await this.deps.orgProjectEnv.listEnvironments(
      {
        orgId: identity.orgId,
        actorUserId,
        projectId: identity.projectId,
        environmentId: identity.envId,
      },
      { projectId: identity.projectId, status: 'ACTIVE' },
    );
    for (const environment of environments) {
      if (
        environment.id === identity.envId &&
        environment.runtimeVersion === identity.signingRootVersion
      )
        return true;
    }
    return false;
  }
  async read(id: string): Promise<ApprovalRequest | null> {
    return parseRequest(
      await this.deps.database
        .prepare('SELECT * FROM tenant_root_cli_restore_access WHERE namespace=?1 AND id=?2')
        .bind(this.deps.namespace, id)
        .first(),
    );
  }
  async fetch(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname !== RESTORE_ACCESS_PATH && !url.pathname.startsWith(`${RESTORE_ACCESS_PATH}/`))
      return null;
    const action = url.pathname.slice(RESTORE_ACCESS_PATH.length);
    const publicAction = action === '/start' || action === '/poll';
    if (request.method !== (action === '/request' || action === '' ? 'GET' : 'POST'))
      return json({ ok: false, code: 'method_not_allowed' }, 405);
    if (!['', '/start', '/poll', '/request', '/approve', '/deny'].includes(action))
      return json({ ok: false }, 404);
    const guarded = publicAction
      ? null
      : await guardTenantRootSecurityRequestV1(this.deps, request, url);
    if (guarded !== null && !guarded.ok) return guarded.response;
    const access = this.access;
    if (access.kind === 'unavailable')
      return json(
        {
          ok: false,
          code: 'restore_access_unavailable',
          message: 'A recovery destination has not been prepared for this project yet.',
        },
        409,
      );
    if (
      guarded?.ok &&
      ((await tenantRootIdentityDigestB64uV1(guarded.request.identity)) !== access.identityDigest ||
        !(await this.deps.isOwner({
          orgId: guarded.request.orgId,
          userId: guarded.request.actorUserId,
        })))
    )
      return json({ ok: false, code: 'environment_or_owner_mismatch' }, 403);
    if (action === '') {
      const recent = parseRequest(
        await this.deps.database
          .prepare(
            "SELECT * FROM tenant_root_cli_restore_access WHERE namespace=?1 AND identity_digest=?2 AND destination=?3 AND state='approved' ORDER BY expires_at_ms DESC LIMIT 1",
          )
          .bind(this.deps.namespace, access.identityDigest, access.destination)
          .first(),
      );
      const restoration =
        recent?.state === 'approved'
          ? await readDestinationRestoration(recent.session)
          : 'unavailable';
      return json({ ok: true, destination: access.destination, restoration });
    }
    const now = Date.now();
    try {
      const body =
        request.method === 'GET' ? { id: url.searchParams.get('id') } : await bodyOf(request);
      if (action === '/start') {
        if (body.environmentId !== access.identity.envId || body.destination !== access.destination)
          return json({ ok: false, code: 'restore_destination_mismatch' }, 409);
        const id = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
        const secret = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
        const source = base64UrlEncode(
          new Uint8Array(
            await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(request.headers.get('cf-connecting-ip') ?? 'local'),
            ),
          ),
        );
        await this.deps.database
          .prepare(
            'DELETE FROM tenant_root_cli_restore_access WHERE namespace=?1 AND expires_at_ms<=?2',
          )
          .bind(this.deps.namespace, now)
          .run();
        await this.deps.database
          .prepare(
            `INSERT INTO tenant_root_cli_restore_access (namespace,id,secret_hash,source_hash,identity_digest,destination,expires_at_ms,state)
          SELECT ?1,?2,?3,?4,?5,?6,?7,'pending' WHERE (SELECT COUNT(*) FROM tenant_root_cli_restore_access WHERE namespace=?1 AND source_hash=?4 AND expires_at_ms>?8)<5`,
          )
          .bind(
            this.deps.namespace,
            id,
            await enrollmentSecretHash(secret),
            source,
            access.identityDigest,
            access.destination,
            now + 300000,
            now,
          )
          .run();
        const created = await this.read(id);
        return created === null
          ? json({ ok: false }, 429)
          : json({ ...describe(created, access), pollingSecret: secret });
      }
      const id = enrollmentBytes(body.id, 16);
      const record =
        action === '/poll'
          ? parseRequest(
              await this.deps.database
                .prepare(
                  'UPDATE tenant_root_cli_restore_access SET next_poll_ms=?4+2000 WHERE namespace=?1 AND id=?2 AND secret_hash=?3 AND next_poll_ms<=?4 RETURNING *',
                )
                .bind(
                  this.deps.namespace,
                  id,
                  await enrollmentSecretHash(enrollmentBytes(body.pollingSecret, 32)),
                  now,
                )
                .first(),
            )
          : await this.read(id);
      if (record === null) return json({ ok: false, code: 'invalid_or_throttled_request' }, 429);
      if (
        record.identityDigest !== access.identityDigest ||
        record.destination !== access.destination
      )
        return json({ ok: false, code: 'restore_destination_changed' }, 409);
      if (action === '/request' && record.state === 'approved')
        return json({
          ...describe(record, access),
          restoration: await readDestinationRestoration(record.session),
        });
      if (record.expiresAtMs <= now) return json({ ok: true, state: 'expired' });
      if (action === '/poll') {
        if (record.state !== 'approved') return json(describe(record, access));
        if (!(await this.ownerStillActive(access.identity, record.actorUserId)))
          return json({ ok: false, code: 'approval_revoked' }, 403);
        return json({ ...describe(record, access), session: record.session });
      }
      if (action === '/request' || record.state !== 'pending')
        return json(describe(record, access));
      if (!guarded?.ok || guarded.request.stepUp === null)
        return json({ ok: false, code: 'step_up_required' }, 403);
      if (action === '/deny') {
        await this.deps.database
          .prepare(
            "UPDATE tenant_root_cli_restore_access SET state='denied' WHERE namespace=?1 AND id=?2 AND state='pending'",
          )
          .bind(this.deps.namespace, id)
          .run();
        await this.deps.audit.appendEvent(
          {
            orgId: access.identity.orgId,
            actorUserId: guarded.request.actorUserId,
            projectId: access.identity.projectId,
            environmentId: access.identity.envId,
          },
          {
            id: `restore-denied-${id}`,
            category: 'APPROVAL',
            action: 'cli_restore_denied',
            outcome: 'SUCCESS',
            summary: 'Denied CLI restore access',
            metadata: { requestId: id, destination: access.destination },
          },
        );
        return json({ ok: true, state: 'denied' });
      }
      // The configured destination is operator-owned. Never forward a credential to a CLI-supplied URL.
      let response: Response;
      try {
        response = await fetch(
          `${access.destination}/console/tenant-root/security/restore/bootstrap-session`,
          {
            method: 'POST',
            redirect: 'manual',
            headers: {
              'content-type': 'application/json',
              'x-seams-destination-bootstrap': access.credential,
            },
            body: '{}',
          },
        );
      } catch (error) {
        console.error(
          'restore_destination_connection_failed',
          error instanceof Error ? error.message : 'Unknown connection error',
        );
        return json({ ok: false, code: 'restore_destination_connection_failed' }, 502);
      }
      if (response.status >= 300 && response.status < 400)
        return json({ ok: false, code: 'restore_destination_redirect_refused' }, 502);
      if (response.status === 401 || response.status === 403)
        return json({ ok: false, code: 'restore_destination_credential_rejected' }, 502);
      if (!response.ok)
        return json(
          {
            ok: false,
            code: 'restore_destination_unavailable',
            destinationStatus: response.status,
          },
          502,
        );
      if (response.headers.get('x-seams-recovery-identity') !== access.identityDigest)
        return json({ ok: false, code: 'restore_destination_identity_mismatch' }, 409);
      let session: ReturnType<typeof parseSession>;
      try {
        const responseBody: unknown = await response.json();
        if (!isPlainObject(responseBody) || responseBody.ok !== true)
          throw new Error('Invalid restore session response');
        session = parseSession(
          {
            destination: access.destination,
            sessionToken: responseBody.sessionToken,
            expiresAt: responseBody.expiresAt,
          },
          access.destination,
        );
      } catch {
        return json({ ok: false, code: 'restore_destination_invalid_response' }, 502);
      }
      await this.deps.database
        .prepare(
          "UPDATE tenant_root_cli_restore_access SET state='approved',actor_user_id=?3,session_json=?4 WHERE namespace=?1 AND id=?2 AND state='pending' AND expires_at_ms>?5",
        )
        .bind(this.deps.namespace, id, guarded.request.actorUserId, JSON.stringify(session), now)
        .run();
      await this.deps.audit.appendEvent(
        {
          orgId: access.identity.orgId,
          actorUserId: guarded.request.actorUserId,
          projectId: access.identity.projectId,
          environmentId: access.identity.envId,
        },
        {
          id: `restore-approved-${id}`,
          category: 'APPROVAL',
          action: 'cli_restore_approved',
          outcome: 'SUCCESS',
          summary: 'Approved temporary CLI restore access',
          metadata: {
            requestId: id,
            destination: access.destination,
            identityDigest: access.identityDigest,
          },
        },
      );
      const approved = await this.read(id);
      return approved === null ? json({ ok: false }, 410) : json(describe(approved, access));
    } catch {
      return json({ ok: false, code: 'restore_access_request_failed' }, 400);
    }
  }
}

/** Console owners approve short-lived access to the configured replacement destination. */
export async function createRestoreAccessRoute(
  dependencies: Dependencies,
  configuration: string | undefined,
): Promise<(request: Request) => Promise<Response | null>> {
  const route = new RestoreAccessRoute(dependencies, await parseAccess(configuration));
  return route.fetch.bind(route);
}

async function readDestinationRestoration(session: {
  destination: string;
  sessionToken: string;
  expiresAt: string;
}): Promise<'active' | 'pending' | 'unavailable'> {
  if (Date.parse(session.expiresAt) <= Date.now()) return 'unavailable';
  try {
    const response = await fetch(
      `${session.destination}/console/tenant-root/security/restore/status`,
      {
        headers: { 'x-seams-restore-session': session.sessionToken },
        redirect: 'manual',
      },
    );
    if (!response.ok) return 'unavailable';
    const body: unknown = await response.json();
    if (!isPlainObject(body) || body.ok !== true) return 'unavailable';
    if (isPlainObject(body.session) && body.session.status === 'active') return 'active';
    return 'pending';
  } catch {
    return 'unavailable';
  }
}
