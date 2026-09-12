import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import {
  base64UrlDecode,
  base64UrlEncode,
  type D1DatabaseLike,
} from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import type { TenantRootIdentityV1 } from '@seams-internal/wallet-console-shared/tenant-root';
import {
  CliEnrollmentStore,
  enrollmentBytes,
  enrollmentRole,
  enrollmentText,
  type CliEnrollment,
} from './cliEnrollmentStore';
import {
  guardTenantRootSecurityRequestV1,
  tenantRootSecurityJson as json,
  type TenantRootSecurityGuardDependenciesV1,
} from './routeGuard';
import {
  startRecipientChallengeV1,
  confirmRecipientV1,
  type TenantRootCustodyStoreV1,
  type TenantRootCustodyControlPlaneV1,
} from './custodyService';
import { buildTenantRootAuditEventV1, type TenantRootAuditWriterV1 } from './audit';

export const CLI_ENROLLMENT_PATH = '/console/tenant-root/security/cli-enrollment';
export type CliEnrollmentDependencies = TenantRootSecurityGuardDependenciesV1 & {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly audit: TenantRootAuditWriterV1;
  readonly controlPlane: Pick<
    TenantRootCustodyControlPlaneV1,
    'sealRecipientChallenge' | 'verifyRecipientConfirmation'
  >;
  readonly custody: (identity: TenantRootIdentityV1) => Promise<TenantRootCustodyStoreV1>;
  readonly isOwner: (orgId: string, actorUserId: string) => Promise<boolean>;
};
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 4096) throw new Error('Request too large');
  const body: unknown = JSON.parse(text);
  if (!isPlainObject(body)) throw new Error('Invalid request');
  return body;
}
async function publicRequest(record: CliEnrollment) {
  return {
    id: record.id,
    state: record.kind,
    environmentId: record.environmentId,
    role: record.role,
    publicKeyB64u: record.publicKeyB64u,
    fingerprintB64u: base64UrlEncode(
      new Uint8Array(await crypto.subtle.digest('SHA-256', base64UrlDecode(record.publicKeyB64u))),
    ),
    confirmationCode: record.id.slice(0, 8).toUpperCase(),
    expiresAtMs: record.expiresAtMs,
  };
}
async function ownerStillActive(
  deps: CliEnrollmentDependencies,
  identity: TenantRootIdentityV1,
  actorUserId: string,
): Promise<boolean> {
  if (!(await deps.isOwner(identity.orgId, actorUserId))) return false;
  const environments = await deps.orgProjectEnv.listEnvironments(
    {
      orgId: identity.orgId,
      actorUserId,
      projectId: identity.projectId,
      environmentId: identity.envId,
    },
    { projectId: identity.projectId, status: 'ACTIVE' },
  );
  return environments.some(
    (environment) =>
      environment.id === identity.envId &&
      environment.runtimeVersion === identity.signingRootVersion,
  );
}

export async function handleCliEnrollment(
  deps: CliEnrollmentDependencies,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.slice(CLI_ENROLLMENT_PATH.length);
  const nowMs = Date.now();
  const store = new CliEnrollmentStore(deps.database, deps.namespace);
  try {
    if (action === '/start' && request.method === 'POST') {
      const body = await readBody(request);
      const id = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
      const secret = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
      const sourceHash = base64UrlEncode(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(request.headers.get('cf-connecting-ip') ?? 'local'),
          ),
        ),
      );
      await store.start(
        {
          id,
          environmentId: enrollmentText(body.environmentId),
          role: enrollmentRole(body.role),
          publicKeyB64u: enrollmentBytes(body.publicKeyB64u, 32),
          expiresAtMs: nowMs + 300000,
        },
        secret,
        sourceHash,
        nowMs,
      );
      const created = await store.read(id, nowMs);
      return created === null
        ? json({ ok: false, code: 'too_many_requests' }, 429)
        : json({
            ok: true,
            ...(await publicRequest(created)),
            pollingSecret: secret,
            pollIntervalMs: 3000,
          });
    }
    if ((action === '/poll' || action === '/confirm') && request.method === 'POST') {
      const body = await readBody(request);
      const record = await store.poll(
        enrollmentBytes(body.id, 16),
        enrollmentBytes(body.pollingSecret, 32),
        nowMs,
      );
      if (record === null) return json({ ok: false, code: 'invalid_or_throttled_request' }, 429);
      if (record.kind !== 'approved' && record.kind !== 'completed')
        return json({ ok: true, ...(await publicRequest(record)) });
      const approval = record.approval;
      if (!(await ownerStillActive(deps, approval.identity, approval.actorUserId)))
        return json({ ok: false, code: 'approval_revoked' }, 403);
      const custody = await deps.custody(approval.identity);
      const current = await custody.readState();
      if (current.custodyLineageB64u !== approval.custodyLineageB64u)
        return json({ ok: false, code: 'lineage_changed' }, 409);
      if (record.kind === 'completed') {
        if (action === '/confirm') {
          const challenge = await custody.takeChallenge(approval.challengeIdB64u);
          if (
            challenge === null ||
            !(await deps.controlPlane.verifyRecipientConfirmation({
              expectedConfirmationB64u: challenge.expectedConfirmationB64u,
              confirmationB64u: enrollmentBytes(body.confirmationB64u, 32),
            }))
          )
            return json({ ok: false, code: 'confirmation_failed' }, 409);
        }
        return json({
          ok: true,
          state: 'completed',
          identityDigestB64u: await tenantRootIdentityDigestB64uV1(approval.identity),
          recipient: JSON.parse(record.result),
        });
      }
      if (action === '/poll')
        return json({
          ok: true,
          ...(await publicRequest(record)),
          challengeIdB64u: approval.challengeIdB64u,
          envelopeB64u: approval.envelopeB64u,
        });
      const confirmation = enrollmentBytes(body.confirmationB64u, 32);
      const previous = await custody.takeChallenge(approval.challengeIdB64u);
      if (
        previous !== null &&
        previous.consumedAtMs !== null &&
        previous.actorUserId === approval.actorUserId &&
        previous.recipientPublicKeyB64u === record.publicKeyB64u &&
        previous.role === record.role
      ) {
        const staged = current.stagedRecipients.find(
          (recipient) =>
            recipient.role === record.role &&
            recipient.recipientPublicKeyB64u === record.publicKeyB64u,
        );
        if (
          staged !== undefined &&
          (await deps.controlPlane.verifyRecipientConfirmation({
            expectedConfirmationB64u: previous.expectedConfirmationB64u,
            confirmationB64u: confirmation,
          }))
        ) {
          await store.complete(record, JSON.stringify(staged), nowMs);
          return json({
            ok: true,
            state: 'completed',
            identityDigestB64u: await tenantRootIdentityDigestB64uV1(approval.identity),
            recipient: staged,
          });
        }
      }
      const result = await confirmRecipientV1(custody, deps.controlPlane, {
        challengeIdB64u: approval.challengeIdB64u,
        confirmationB64u: confirmation,
        role: record.role,
        actorUserId: approval.actorUserId,
        atIso: new Date(nowMs).toISOString(),
        nowMs,
      });
      await deps.audit.write(result.audit);
      if (!result.ok) return json({ ok: false, code: 'confirmation_failed' }, 409);
      if (result.value.recipientPublicKeyB64u !== record.publicKeyB64u)
        throw new Error('Recipient mismatch');
      await store.complete(record, JSON.stringify(result.value), nowMs);
      return json({
        ok: true,
        state: 'completed',
        identityDigestB64u: await tenantRootIdentityDigestB64uV1(approval.identity),
        recipient: result.value,
      });
    }
    if (action !== '/request' && action !== '/approve' && action !== '/deny')
      return json({ ok: false, code: 'method_not_allowed' }, 405);
    const guarded = await guardTenantRootSecurityRequestV1(deps, request, url);
    if (!guarded.ok) return guarded.response;
    const body =
      request.method === 'GET' ? { id: url.searchParams.get('id') } : await readBody(request);
    const record = await store.read(enrollmentBytes(body.id, 16), nowMs);
    if (record === null) return json({ ok: false, code: 'request_not_found' }, 404);
    const actor = guarded.request;
    if (
      actor.identity.envId !== record.environmentId ||
      !(await deps.isOwner(actor.orgId, actor.actorUserId))
    )
      return json({ ok: false, code: 'environment_or_owner_mismatch' }, 403);
    if (action === '/request')
      return json({ ok: true, organizationId: actor.orgId, ...(await publicRequest(record)) });
    if (record.kind !== 'pending') return json({ ok: true, ...(await publicRequest(record)) });
    if (actor.stepUp === null) return json({ ok: false, code: 'step_up_required' }, 403);
    const custody = await deps.custody(actor.identity);
    const current = await custody.readState();
    await deps.audit.write(
      buildTenantRootAuditEventV1({
        action: action === '/deny' ? 'cli_enrollment_denied' : 'cli_enrollment_approved',
        outcome: 'success',
        atIso: new Date(nowMs).toISOString(),
        orgId: actor.orgId,
        actorUserId: actor.actorUserId,
        identityDigestB64u: current.identityDigestB64u,
        custodyLineageB64u: current.custodyLineageB64u,
        lifecycleRevision: current.lifecycleRevision,
        role: record.role,
      }),
    );
    if (action === '/deny') {
      await store.deny(record, nowMs);
      return json({ ok: true, state: 'denied' });
    }
    const challenge = await startRecipientChallengeV1(custody, deps.controlPlane, {
      role: record.role,
      recipientPublicKeyB64u: record.publicKeyB64u,
      actorUserId: actor.actorUserId,
      atIso: new Date(nowMs).toISOString(),
      nowMs,
    });
    await deps.audit.write(challenge.audit);
    if (!challenge.ok) return json({ ok: false, code: 'enrollment_refused' }, 409);
    await store.approve(
      record,
      {
        identity: actor.identity,
        actorUserId: actor.actorUserId,
        custodyLineageB64u: current.custodyLineageB64u,
        challengeIdB64u: challenge.value.challengeIdB64u,
        envelopeB64u: challenge.value.envelopeB64u,
      },
      nowMs,
    );
    const saved = await store.read(record.id, Date.now());
    return saved === null
      ? json({ ok: false, code: 'request_expired' }, 410)
      : json({ ok: true, ...(await publicRequest(saved)) });
  } catch {
    return json({ ok: false, code: 'cli_enrollment_request_failed' }, 400);
  }
}
