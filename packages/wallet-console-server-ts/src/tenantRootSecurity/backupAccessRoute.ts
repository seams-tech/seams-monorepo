import { base64UrlEncode, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  decodeTenantRootIdentityWireV1,
  tenantRootDownloadableRecoverySetV1,
  type TenantRootIdentityV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import { enrollmentBytes, enrollmentSecretHash, enrollmentText } from './cliEnrollmentStore';
import {
  guardTenantRootSecurityRequestV1,
  tenantRootSecurityJson as json,
  type TenantRootSecurityGuardDependenciesV1,
} from './routeGuard';
import {
  serveRecoveryArtifactV1,
  type TenantRootCustodyStoreV1,
  type TenantRootCustodyControlPlaneV1,
} from './custodyService';
import type { TenantRootAuditWriterV1 } from './audit';

export const BACKUP_ACCESS_PATH = '/console/tenant-root/security/backup-access';
type Scope = 'both' | 'deriver_a' | 'deriver_b';
function parseScope(value: unknown): Scope {
  if (value === 'both' || value === 'deriver_a' || value === 'deriver_b') return value;
  throw new Error('Invalid kit scope');
}
type Binding = { environmentId: string; recoverySetId: string; scope: Scope };
type Access = Binding &
  (
    | { state: 'pending' | 'denied'; identity?: never; actorUserId?: never }
    | { state: 'approved'; identity: TenantRootIdentityV1; actorUserId: string }
  );
type Dependencies = TenantRootSecurityGuardDependenciesV1 & {
  database: D1DatabaseLike;
  namespace: string;
  audit: TenantRootAuditWriterV1;
  isOwner: (orgId: string, actorUserId: string) => Promise<boolean>;
  custody: (identity: TenantRootIdentityV1) => Promise<TenantRootCustodyStoreV1>;
  controlPlane: (identity: TenantRootIdentityV1) => Promise<TenantRootCustodyControlPlaneV1>;
};
function parseAccess(raw: unknown): Access {
  if (typeof raw !== 'string') throw new Error('Missing backup request');
  const value: unknown = JSON.parse(raw);
  if (!isPlainObject(value)) throw new Error('Invalid backup request');
  const environmentId = enrollmentText(value.environmentId);
  const recoverySetId = enrollmentText(value.recoverySetId);
  const scope = parseScope(value.scope);
  switch (value.state) {
    case 'pending':
    case 'denied':
      return { environmentId, recoverySetId, scope, state: value.state };
    case 'approved': {
      const identity = decodeTenantRootIdentityWireV1(value.identity);
      if (!identity.ok || identity.value.envId !== environmentId)
        throw new Error('Invalid backup identity');
      return {
        environmentId,
        recoverySetId,
        scope,
        state: 'approved',
        identity: identity.value,
        actorUserId: enrollmentText(value.actorUserId),
      };
    }
    default:
      throw new Error('Invalid backup state');
  }
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 4096) throw new Error('Request too large');
  const body: unknown = JSON.parse(text);
  if (!isPlainObject(body)) throw new Error('Invalid request');
  return body;
}
async function requireCurrent(
  deps: Dependencies,
  identity: TenantRootIdentityV1,
  actor: string,
  setId: string,
) {
  if (!(await deps.isOwner(identity.orgId, actor))) throw new Error('Owner access revoked');
  const environments = await deps.orgProjectEnv.listEnvironments(
    {
      orgId: identity.orgId,
      actorUserId: actor,
      projectId: identity.projectId,
      environmentId: identity.envId,
    },
    { projectId: identity.projectId, status: 'ACTIVE' },
  );
  if (!environments.some(matchesEnvironment.bind(null, identity)))
    throw new Error('Environment changed');
  const store = await deps.custody(identity);
  const state = await store.readState();
  if (tenantRootDownloadableRecoverySetV1(state.backup)?.recoverySetId !== setId)
    throw new Error('Recovery backup changed. Start again from the dashboard.');
  return store;
}
function matchesEnvironment(
  identity: TenantRootIdentityV1,
  environment: { id: string; runtimeVersion: string },
): boolean {
  return (
    environment.id === identity.envId && environment.runtimeVersion === identity.signingRootVersion
  );
}
export async function handleBackupAccess(deps: Dependencies, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.slice(BACKUP_ACCESS_PATH.length);
  const now = Date.now();
  try {
    if (action === '/start' && request.method === 'POST') {
      const body = await bodyOf(request);
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
      const value: Access = {
        state: 'pending',
        environmentId: enrollmentText(body.environmentId),
        recoverySetId: enrollmentText(body.recoverySetId),
        scope: parseScope(body.scope),
      };
      await deps.database
        .prepare('DELETE FROM tenant_root_backup_access WHERE namespace=? AND expires_at_ms<?')
        .bind(deps.namespace, now)
        .run();
      await deps.database
        .prepare(
          'INSERT INTO tenant_root_backup_access (namespace,id,secret_hash,source_hash,expires_at_ms,request_json) SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM tenant_root_backup_access WHERE namespace=? AND source_hash=?)<5',
        )
        .bind(
          deps.namespace,
          id,
          await enrollmentSecretHash(secret),
          source,
          now + 300000,
          JSON.stringify(value),
          deps.namespace,
          source,
        )
        .run();
      const exists = await deps.database
        .prepare('SELECT id FROM tenant_root_backup_access WHERE namespace=? AND id=?')
        .bind(deps.namespace, id)
        .first();
      return exists === null
        ? json({ ok: false, code: 'too_many_requests' }, 429)
        : json({
            ok: true,
            id,
            pollingSecret: secret,
            confirmationCode: id.slice(0, 8).toUpperCase(),
          });
    }
    const body =
      request.method === 'GET' ? { id: url.searchParams.get('id') } : await bodyOf(request);
    const id = enrollmentBytes(body.id, 16);
    const row = await deps.database
      .prepare('SELECT * FROM tenant_root_backup_access WHERE namespace=? AND id=?')
      .bind(deps.namespace, id)
      .first();
    if (!isPlainObject(row) || typeof row.expires_at_ms !== 'number' || row.expires_at_ms <= now)
      return json({ ok: true, state: 'expired' });
    const access = parseAccess(row.request_json);
    if (action === '/poll' && request.method === 'POST') {
      if (row.secret_hash !== (await enrollmentSecretHash(enrollmentBytes(body.pollingSecret, 32))))
        return json({ ok: false, code: 'unauthorized' }, 403);
      if (typeof row.last_poll_ms !== 'number' || now - row.last_poll_ms < 2000)
        return json({ ok: false, code: 'poll_too_soon' }, 429);
      await deps.database
        .prepare('UPDATE tenant_root_backup_access SET last_poll_ms=? WHERE namespace=? AND id=?')
        .bind(now, deps.namespace, id)
        .run();
      if (access.state !== 'approved') return json({ ok: true, state: access.state });
      const store = await requireCurrent(
        deps,
        access.identity,
        access.actorUserId,
        access.recoverySetId,
      );
      const controlPlane = await deps.controlPlane(access.identity);
      const artifacts: Record<string, string> = {};
      const selected =
        access.scope === 'both'
          ? (['manifest', 'deriver_a_package', 'deriver_b_package'] as const)
          : ([
              'manifest',
              access.scope === 'deriver_a' ? 'deriver_a_package' : 'deriver_b_package',
            ] as const);
      for (const artifact of selected) {
        const result = await serveRecoveryArtifactV1(store, controlPlane, {
          artifact,
          actorUserId: access.actorUserId,
          atIso: new Date(now).toISOString(),
        });
        await deps.audit.write(result.audit);
        if (!result.ok || result.value.recoverySetId !== access.recoverySetId)
          return json({ ok: false, code: 'backup_access_refused' }, 403);
        artifacts[artifact] = result.value.artifactB64u;
      }
      await requireCurrent(deps, access.identity, access.actorUserId, access.recoverySetId);
      return json({
        ok: true,
        state: 'approved',
        recoverySetId: access.recoverySetId,
        scope: access.scope,
        artifacts,
      });
    }
    if (!['/request', '/approve', '/deny'].includes(action)) return json({ ok: false }, 405);
    const guarded = await guardTenantRootSecurityRequestV1(deps, request, url);
    if (!guarded.ok) return guarded.response;
    const actor = guarded.request;
    if (
      actor.identity.envId !== access.environmentId ||
      !(await deps.isOwner(actor.orgId, actor.actorUserId))
    )
      return json({ ok: false, code: 'environment_or_owner_mismatch' }, 403);
    if (action === '/request')
      return json({
        ok: true,
        id,
        state: access.state,
        environmentId: access.environmentId,
        organizationId: actor.orgId,
        recoverySetId: access.recoverySetId,
        scope: access.scope,
        confirmationCode: id.slice(0, 8).toUpperCase(),
      });
    if (actor.stepUp === null) return json({ ok: false, code: 'step_up_required' }, 403);
    if (access.state !== 'pending') return json({ ok: true, state: access.state });
    await requireCurrent(deps, actor.identity, actor.actorUserId, access.recoverySetId);
    const updated: Access =
      action === '/deny'
        ? {
            state: 'denied',
            environmentId: access.environmentId,
            recoverySetId: access.recoverySetId,
            scope: access.scope,
          }
        : {
            state: 'approved',
            environmentId: access.environmentId,
            recoverySetId: access.recoverySetId,
            scope: access.scope,
            identity: actor.identity,
            actorUserId: actor.actorUserId,
          };
    await deps.database
      .prepare(
        'UPDATE tenant_root_backup_access SET request_json=? WHERE namespace=? AND id=? AND request_json=?',
      )
      .bind(JSON.stringify(updated), deps.namespace, id, row.request_json)
      .run();
    return json({ ok: true, state: updated.state });
  } catch (error) {
    return json(
      {
        ok: false,
        code: 'backup_access_failed',
        message: error instanceof Error ? error.message : 'Backup access failed',
      },
      400,
    );
  }
}
