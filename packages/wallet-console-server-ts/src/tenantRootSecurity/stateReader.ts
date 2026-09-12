import {
  tenantRootRecoveryGovernanceDigestB64uV1,
  type TenantRootDeriverHealthV1,
  type TenantRootRotationJobV1,
  type TenantRootSecurityStatusV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import type { D1TenantRootActiveLineageResolverV1 } from './activeLineageD1';
import type { TenantRootIdentityV1 } from '../tenantRootCreation/types';
import { ROUTER_AB_MPC_ROUTER_ORIGIN } from '@seams/wallet-server/cloud-host';
import type { TenantRootSecurityStateReaderV1 } from './consoleRoute';

export interface TenantRootSecurityStateReaderOptionsV1 {
  readonly activeRoots: Pick<D1TenantRootActiveLineageResolverV1, 'resolveActiveLineage'>;
  readonly router: { fetch(request: Request): Promise<Response> };
  readonly internalServiceAuthSecret: string;
}

export class TenantRootSecurityStateUnavailableError extends Error {
  readonly code = 'tenant_root_not_active';
  constructor() {
    super('Authenticated Console environment has no active tenant root');
    this.name = 'TenantRootSecurityStateUnavailableError';
  }
}

interface RouterTenantRootStatusV1 {
  readonly lifecycleRevision: number;
  readonly activeEpoch: number;
  readonly lastCompletedRotationAt: string | null;
  readonly nextScheduledRotationAt: string | null;
  readonly deriverAStatus: TenantRootDeriverHealthV1;
  readonly deriverBStatus: TenantRootDeriverHealthV1;
  readonly job: TenantRootRotationJobV1 | null;
}

function parseDeriverHealth(value: unknown, fieldName: string): TenantRootDeriverHealthV1 {
  if (
    value === 'healthy' ||
    value === 'degraded' ||
    value === 'unavailable' ||
    value === 'unknown'
  ) {
    return value;
  }
  throw new Error(`Router returned invalid ${fieldName}`);
}

/** requestedAt is the signed ceremony issue time. */
function parseRouterRotationJob(value: unknown): TenantRootRotationJobV1 | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new Error('Router returned an invalid tenant-root rotation job');
  }
  const job = value;
  const status = job.status;
  const jobId = job.job_id;
  const requestedAtMs = job.requested_at_ms;
  if (
    (status !== 'preparing' && status !== 'installing' && status !== 'verifying') ||
    typeof jobId !== 'string' ||
    jobId.length === 0 ||
    jobId.length > 256 ||
    jobId.trim() !== jobId ||
    typeof requestedAtMs !== 'number' ||
    !Number.isSafeInteger(requestedAtMs) ||
    requestedAtMs <= 0 ||
    requestedAtMs > 8_640_000_000_000_000
  ) {
    throw new Error('Router returned an invalid tenant-root rotation job');
  }
  const requestedAt = new Date(requestedAtMs);
  switch (status) {
    case 'preparing':
    case 'installing':
      return { status, jobId, requestedAt: requestedAt.toISOString() };
    case 'verifying':
      return { status, jobId, requestedAt: requestedAt.toISOString() };
    default: {
      const exhaustive: never = status;
      throw new Error(`Router returned unsupported tenant-root rotation job ${exhaustive}`);
    }
  }
}

function parseRouterStatus(
  raw: unknown,
  identityDigestB64u: string,
  custodyLineageB64u: string,
  rootCommitmentB64u: string,
): RouterTenantRootStatusV1 {
  if (!isPlainObject(raw)) {
    throw new Error('Router returned an invalid tenant-root status');
  }
  const value = raw;
  if (
    value.identity_digest_b64u !== identityDigestB64u ||
    value.custody_lineage_b64u !== custodyLineageB64u ||
    value.root_commitment_b64u !== rootCommitmentB64u
  ) {
    throw new Error('Router tenant-root status does not match the active tenant root');
  }
  const revision = value.lifecycle_revision;
  const epoch = value.active_epoch;
  const completedAtMs = value.last_refresh_completed_at_ms;
  const nextScheduledAtMs = value.next_scheduled_rotation_at_ms;
  const activationReceiptDigestB64u = value.activation_receipt_digest_b64u;
  const deriverAStatus = parseDeriverHealth(value.deriver_a_status, 'Deriver A health');
  const deriverBStatus = parseDeriverHealth(value.deriver_b_status, 'Deriver B health');
  const job = parseRouterRotationJob(value.job);
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision <= 0 ||
    typeof epoch !== 'number' ||
    !Number.isSafeInteger(epoch) ||
    epoch <= 0 ||
    typeof activationReceiptDigestB64u !== 'string' ||
    activationReceiptDigestB64u.length === 0 ||
    !(
      completedAtMs === null ||
      (typeof completedAtMs === 'number' &&
        Number.isSafeInteger(completedAtMs) &&
        completedAtMs >= 0 &&
        completedAtMs <= 8_640_000_000_000_000)
    ) ||
    !(
      nextScheduledAtMs === undefined ||
      nextScheduledAtMs === null ||
      (typeof nextScheduledAtMs === 'number' &&
        Number.isSafeInteger(nextScheduledAtMs) &&
        nextScheduledAtMs > 0 &&
        nextScheduledAtMs <= 8_640_000_000_000_000)
    )
  ) {
    throw new Error('Router returned invalid tenant-root lifecycle metadata');
  }
  return {
    lifecycleRevision: revision,
    activeEpoch: epoch,
    lastCompletedRotationAt: completedAtMs === null ? null : new Date(completedAtMs).toISOString(),
    nextScheduledRotationAt:
      typeof nextScheduledAtMs === 'number' ? new Date(nextScheduledAtMs).toISOString() : null,
    deriverAStatus,
    deriverBStatus,
    job,
  };
}

class RouterTenantRootSecurityStateReaderV1 implements TenantRootSecurityStateReaderV1 {
  constructor(private readonly options: TenantRootSecurityStateReaderOptionsV1) {}

  async readStatus(input: { readonly identity: TenantRootIdentityV1 }) {
    const identityDigestB64u = await tenantRootIdentityDigestB64uV1(input.identity);
    const active = await this.options.activeRoots.resolveActiveLineage(input.identity);
    if (!active) {
      throw new TenantRootSecurityStateUnavailableError();
    }
    const response = await this.options.router.fetch(
      new Request(`${ROUTER_AB_MPC_ROUTER_ORIGIN}/router-ab/internal/tenant-root/status/v1/read`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-router-ab-internal-service-auth': this.options.internalServiceAuthSecret,
        },
        body: JSON.stringify({
          identity_digest_b64u: identityDigestB64u,
          custody_lineage_b64u: active.custodyLineageB64u,
        }),
      }),
    );
    if (!response.ok) throw new Error(`Router tenant-root status returned HTTP ${response.status}`);
    const current = parseRouterStatus(
      await response.json(),
      identityDigestB64u,
      active.custodyLineageB64u,
      active.rootCommitmentB64u,
    );
    const status: TenantRootSecurityStatusV1 = {
      identity: input.identity,
      custodyLineageId: active.custodyLineageB64u,
      lifecycleRevision: current.lifecycleRevision,
      operationalShares: {
        activeEpoch: current.activeEpoch,
        rootCommitmentFingerprintB64u: active.rootCommitmentB64u,
        deriverAStatus: current.deriverAStatus,
        deriverBStatus: current.deriverBStatus,
        lastCompletedRotationAt: current.lastCompletedRotationAt,
        nextScheduledRotationAt: current.nextScheduledRotationAt,
        securityProfile: 'operational_rotation_v1',
        job: current.job,
      },
      recoveryBackup: { status: 'not_configured' },
      restore: active.restore,
      trustLevel: { kind: 'cryptographically_valid_offline' },
    };
    return {
      status,
      recoveryEnrollment: 'pending' as const,
      recoveryDownloadHolders: { kind: 'unavailable' as const },
      identityDigestB64u,
      custodyLineageB64u: active.custodyLineageB64u,
      governance: null,
      governanceDigestB64u: await tenantRootRecoveryGovernanceDigestB64uV1(null),
      rootCommitmentB64u: active.rootCommitmentB64u,
    };
  }
}

export function createTenantRootSecurityStateReaderV1(
  options: TenantRootSecurityStateReaderOptionsV1,
): TenantRootSecurityStateReaderV1 {
  return new RouterTenantRootSecurityStateReaderV1(options);
}
