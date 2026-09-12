import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import { expect, test } from '@playwright/test';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import {
  createTenantRootSecurityStateReaderV1,
  TenantRootSecurityStateUnavailableError,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stateReader';
import type {
  TenantRootCreationGrantRecordV1,
  TenantRootIdentityV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootCreation/types';

const ROOT_COMMITMENT_B64U = '6IKxMQFrUsHTM3CAGHz3aEI-_Mu1F7tJWrgSxBYP9E4';
const CUSTODY_LINEAGE_B64U = 'custody-lineage-state-reader-test';

function identity(): TenantRootIdentityV1 {
  const built = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: 'org-state-reader',
    projectId: 'project-state-reader',
    envId: 'project-state-reader:dev',
    signingRootId: 'root-main',
    signingRootVersion: 'v1',
  });
  if (!built.ok) throw new Error('identity fixture is invalid');
  return built.value;
}

function activeGrant(
  value: TenantRootIdentityV1,
  identityDigestB64u: string,
): TenantRootCreationGrantRecordV1 {
  return {
    status: 'ACTIVE',
    operationId: 'operation-state-reader',
    identity: value,
    identityDigestB64u,
    custodyLineageB64u: CUSTODY_LINEAGE_B64U,
    grantNonceB64u: 'nonce',
    grantKeyId: 'key',
    grantB64u: 'grant',
    grantDigestB64u: 'digest',
    issuedAtMs: 1,
    expiresAtMs: 2,
    namespace: 'namespace',
    createdAtMs: 1,
    updatedAtMs: 1,
    ready: {
      revision: 7,
      rootCommitmentB64u: ROOT_COMMITMENT_B64U,
      journalDigestB64u: 'journal',
      capabilityDigestB64u: 'capability',
    },
  };
}

class StatusRouter {
  constructor(
    private readonly responseKind:
      | 'ready'
      | 'degraded'
      | 'wrong_identity'
      | 'malformed'
      | 'unavailable',
    private readonly jobKind: 'none' | 'preparing' | 'installing' | 'verifying' = 'none',
  ) {}
  async fetch(request: Request): Promise<Response> {
    expect(new URL(request.url).pathname).toBe('/router-ab/internal/tenant-root/status/v1/read');
    expect(request.headers.get('x-router-ab-internal-service-auth')).toBe('test-service-auth');
    if (this.responseKind === 'unavailable') return new Response(null, { status: 503 });
    const binding = await request.json();
    if (this.responseKind === 'malformed') {
      return Response.json({
        identity_digest_b64u: binding.identity_digest_b64u,
        custody_lineage_b64u: binding.custody_lineage_b64u,
        root_commitment_b64u: ROOT_COMMITMENT_B64U,
        lifecycle_revision: 11,
        active_epoch: 3,
        last_refresh_completed_at_ms: null,
        job: null,
      });
    }
    return Response.json({
      identity_digest_b64u:
        this.responseKind === 'wrong_identity' ? 'another-root' : binding.identity_digest_b64u,
      custody_lineage_b64u: binding.custody_lineage_b64u,
      root_commitment_b64u: ROOT_COMMITMENT_B64U,
      lifecycle_revision: 11,
      active_epoch: 3,
      last_refresh_completed_at_ms: Date.parse('2026-09-06T12:00:00.000Z'),
      activation_receipt_digest_b64u: 'activation-receipt-digest',
      deriver_a_status: this.responseKind === 'degraded' ? 'degraded' : 'healthy',
      deriver_b_status: 'healthy',
      job:
        this.jobKind === 'none'
          ? null
          : {
              status: this.jobKind,
              job_id: 'operation-state-reader',
              requested_at_ms: Date.parse('2026-09-06T11:59:00.000Z'),
            },
    });
  }
}

function reader(
  record: TenantRootCreationGrantRecordV1 | null,
  responseKind: 'ready' | 'degraded' | 'wrong_identity' | 'malformed' | 'unavailable' = 'ready',
  jobKind: 'none' | 'preparing' | 'installing' | 'verifying' = 'none',
) {
  return createTenantRootSecurityStateReaderV1({
    router: new StatusRouter(responseKind, jobKind),
    internalServiceAuthSecret: 'test-service-auth',
    activeRoots: {
      async resolveActiveLineage(identity) {
        return record?.status === 'ACTIVE'
          ? {
              identityDigestB64u: await tenantRootIdentityDigestB64uV1(identity),
              custodyLineageB64u: record.custodyLineageB64u,
              rootCommitmentB64u: record.ready.rootCommitmentB64u,
              restore: null,
            }
          : null;
      },
    },
  });
}

test('status reads the current Router epoch and revision while preserving the grant identity', async () => {
  const value = identity();
  const built = await reader(activeGrant(value, 'placeholder')).readStatus({ identity: value });

  expect(built.custodyLineageB64u).toBe(CUSTODY_LINEAGE_B64U);
  expect(built.rootCommitmentB64u).toBe(ROOT_COMMITMENT_B64U);
  expect(built.status.lifecycleRevision).toBe(11);
  expect(built.status.operationalShares.rootCommitmentFingerprintB64u).toBe(ROOT_COMMITMENT_B64U);
  // Never configured is the true answer here, not a stand-in for one.
  expect(built.status.recoveryBackup.status).toBe('not_configured');
  expect(built.governance).toBeNull();
  expect(built.status.restore).toBeNull();
});

test('status reports the Router readback health for each Deriver', async () => {
  const value = identity();
  const built = await reader(activeGrant(value, 'placeholder')).readStatus({ identity: value });

  expect(built.status.operationalShares.deriverAStatus).toBe('healthy');
  expect(built.status.operationalShares.deriverBStatus).toBe('healthy');
  expect(built.status.operationalShares.activeEpoch).toBe(3);
  expect(built.status.operationalShares.lastCompletedRotationAt).toBe('2026-09-06T12:00:00.000Z');
  expect(built.status.operationalShares.nextScheduledRotationAt).toBeNull();
  // A deployment with no verified erasure evidence makes the weaker claim.
  expect(built.status.operationalShares.securityProfile).toBe('operational_rotation_v1');
});

test('status preserves a degraded role readback without changing lifecycle facts', async () => {
  const value = identity();
  const built = await reader(activeGrant(value, 'placeholder'), 'degraded').readStatus({
    identity: value,
  });

  expect(built.status.operationalShares.deriverAStatus).toBe('degraded');
  expect(built.status.operationalShares.deriverBStatus).toBe('healthy');
  expect(built.status.operationalShares.activeEpoch).toBe(3);
  expect(built.status.operationalShares.job).toBeNull();
});

test('status reports only Router checkpoint phases with the durable caller operation', async () => {
  const value = identity();
  const preparing = await reader(
    activeGrant(value, 'placeholder'),
    'ready',
    'preparing',
  ).readStatus({ identity: value });
  expect(preparing.status.operationalShares.job).toEqual({
    status: 'preparing',
    jobId: 'operation-state-reader',
    requestedAt: '2026-09-06T11:59:00.000Z',
  });

  const installing = await reader(
    activeGrant(value, 'placeholder'),
    'ready',
    'installing',
  ).readStatus({ identity: value });
  expect(installing.status.operationalShares.job).toEqual({
    status: 'installing',
    jobId: 'operation-state-reader',
    requestedAt: '2026-09-06T11:59:00.000Z',
  });

  const verifying = await reader(
    activeGrant(value, 'placeholder'),
    'ready',
    'verifying',
  ).readStatus({ identity: value });
  expect(verifying.status.operationalShares.job).toEqual({
    status: 'verifying',
    jobId: 'operation-state-reader',
    requestedAt: '2026-09-06T11:59:00.000Z',
  });
});

test('a tenant root that is not active has no status to report', async () => {
  const value = identity();
  await expect(reader(null).readStatus({ identity: value })).rejects.toThrow(
    TenantRootSecurityStateUnavailableError,
  );
});

test('status refuses an unavailable Router or a response bound to another root', async () => {
  const value = identity();
  await expect(
    reader(activeGrant(value, 'placeholder'), 'wrong_identity').readStatus({ identity: value }),
  ).rejects.toThrow('does not match the active tenant root');
  await expect(
    reader(activeGrant(value, 'placeholder'), 'unavailable').readStatus({ identity: value }),
  ).rejects.toThrow('HTTP 503');
  await expect(
    reader(activeGrant(value, 'placeholder'), 'malformed').readStatus({ identity: value }),
  ).rejects.toThrow('invalid Deriver A health');
});
