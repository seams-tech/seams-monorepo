import type {
  D1DatabaseLike,
  D1Row,
  WalletRuntimeServiceBinding,
} from '@seams/wallet-server/cloud-host';
import { TenantDeploymentD1ResourceIdentityV1 } from './deploymentResource';
import { TenantDeploymentStoreError } from './service';

const CHALLENGE_PATH = '/internal/tenant-deployment/v1/resource-challenge';
const CHALLENGE_ORIGIN = 'https://tenant-deployment.internal';
const HEX_32_BYTES = /^[a-f0-9]{64}$/u;
const VERSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

export type TenantD1ResourceChallengeRequestV1 = {
  readonly deploymentLane: string;
  readonly challengeId: string;
  readonly expectedProof: string;
};

type ChallengeObservation = {
  readonly versionId: string;
  readonly resource: TenantDeploymentD1ResourceIdentityV1;
  readonly challengeId: string;
  readonly proof: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
};

export interface TenantD1ResourceVerifierV1 {
  verify(request: TenantD1ResourceChallengeRequestV1): Promise<{
    readonly kind: 'tenant_d1_runtime_resource_checkpoint_v1';
    readonly deploymentLane: string;
    readonly resource: TenantDeploymentD1ResourceIdentityV1;
    readonly challengeId: string;
    readonly checkedAtMs: number;
    readonly expiresAtMs: number;
    readonly writerVersions: { readonly gateway: string; readonly walletRuntime: string };
    readonly activationAuthorized: false;
  }>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hex(value: unknown): value is string {
  return typeof value === 'string' && HEX_32_BYTES.test(value);
}

export function parseTenantD1ResourceChallengeRequestV1(
  raw: unknown,
): TenantD1ResourceChallengeRequestV1 {
  if (
    !record(raw) ||
    Object.keys(raw).sort().join(',') !== 'challengeId,deploymentLane,expectedProof' ||
    typeof raw.deploymentLane !== 'string' ||
    !raw.deploymentLane ||
    raw.deploymentLane.trim() !== raw.deploymentLane ||
    !hex(raw.challengeId) ||
    !hex(raw.expectedProof)
  )
    throw new TenantDeploymentStoreError(
      'invalid_input',
      'D1 resource challenge request is invalid',
    );
  return {
    deploymentLane: raw.deploymentLane,
    challengeId: raw.challengeId,
    expectedProof: raw.expectedProof,
  };
}

function parseObservation(raw: unknown, nowMs: number): ChallengeObservation {
  if (
    !record(raw) ||
    typeof raw.versionId !== 'string' ||
    !VERSION_ID.test(raw.versionId) ||
    !hex(raw.challengeId) ||
    !hex(raw.proof) ||
    typeof raw.issuedAtMs !== 'number' ||
    !Number.isSafeInteger(raw.issuedAtMs) ||
    raw.issuedAtMs <= 0 ||
    typeof raw.expiresAtMs !== 'number' ||
    !Number.isSafeInteger(raw.expiresAtMs) ||
    raw.issuedAtMs > nowMs ||
    raw.expiresAtMs <= nowMs ||
    raw.expiresAtMs <= raw.issuedAtMs ||
    raw.expiresAtMs - raw.issuedAtMs > 300_000
  ) {
    throw new TenantDeploymentStoreError(
      'readiness_invalid',
      'D1 resource challenge is missing, invalid or expired',
    );
  }
  return {
    versionId: raw.versionId,
    resource: TenantDeploymentD1ResourceIdentityV1.parse(raw.resource),
    challengeId: raw.challengeId,
    proof: raw.proof,
    issuedAtMs: raw.issuedAtMs,
    expiresAtMs: raw.expiresAtMs,
  };
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function tenantD1ResourceChallengeResponseV1(
  request: Request,
  database: D1DatabaseLike,
  rawResource: unknown,
  rawVersionMetadata: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== CHALLENGE_PATH) return null;
  if (url.origin !== CHALLENGE_ORIGIN) return json({ ok: false }, 404);
  if (request.method !== 'POST') return json({ ok: false }, 405);
  const resource = TenantDeploymentD1ResourceIdentityV1.parse(rawResource);
  const raw: unknown = await request.json().catch(() => null);
  if (
    !record(raw) ||
    Object.keys(raw).sort().join(',') !== 'challengeId,namespace' ||
    !hex(raw.challengeId) ||
    raw.namespace !== resource.namespace
  )
    return json({ ok: false }, 400);
  const row = await database
    .prepare(
      `SELECT account_id, database_id, proof, issued_at_ms, expires_at_ms
       FROM deployment_resource_challenges WHERE namespace = ?1 AND challenge_id = ?2`,
    )
    .bind(resource.namespace, raw.challengeId)
    .first<D1Row>();
  try {
    const observation = parseObservation(
      {
        versionId: record(rawVersionMetadata) ? rawVersionMetadata.id : null,
        resource: {
          namespace: resource.namespace,
          accountId: row?.account_id,
          databaseId: row?.database_id,
        },
        challengeId: raw.challengeId,
        proof: row?.proof,
        issuedAtMs: row?.issued_at_ms,
        expiresAtMs: row?.expires_at_ms,
      },
      Date.now(),
    );
    if (!observation.resource.matches(resource)) return json({ ok: false }, 409);
    return json(observation, 200);
  } catch {
    return json({ ok: false }, 409);
  }
}

async function inspectWriter(
  service: WalletRuntimeServiceBinding,
  resource: TenantDeploymentD1ResourceIdentityV1,
  request: TenantD1ResourceChallengeRequestV1,
): Promise<ChallengeObservation> {
  const response = await service.fetch(`${CHALLENGE_ORIGIN}${CHALLENGE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ namespace: resource.namespace, challengeId: request.challengeId }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new TenantDeploymentStoreError(
      'readiness_invalid',
      `D1 runtime resource challenge returned HTTP ${response.status}`,
    );
  const observation = parseObservation(await response.json(), Date.now());
  if (
    !observation.resource.matches(resource) ||
    observation.challengeId !== request.challengeId ||
    observation.proof !== request.expectedProof
  ) {
    throw new TenantDeploymentStoreError(
      'deployment_resource_conflict',
      'D1 runtime resource challenge does not match the reserved resource',
    );
  }
  return observation;
}

export function createTenantD1ResourceVerifierV1(options: {
  readonly resource: TenantDeploymentD1ResourceIdentityV1;
  readonly deploymentLane: string;
  readonly gateway: WalletRuntimeServiceBinding;
  readonly walletRuntime: WalletRuntimeServiceBinding;
}): TenantD1ResourceVerifierV1 {
  return {
    async verify(request) {
      if (request.deploymentLane !== options.deploymentLane)
        throw new TenantDeploymentStoreError(
          'invalid_input',
          'D1 resource challenge lane disagrees with this runtime',
        );
      const gateway = await inspectWriter(options.gateway, options.resource, request);
      const runtime = await inspectWriter(options.walletRuntime, options.resource, request);
      const checkedAtMs = Date.now();
      const expiresAtMs = Math.min(gateway.expiresAtMs, runtime.expiresAtMs);
      if (
        expiresAtMs <= checkedAtMs ||
        gateway.issuedAtMs !== runtime.issuedAtMs ||
        gateway.expiresAtMs !== runtime.expiresAtMs
      )
        throw new TenantDeploymentStoreError(
          'readiness_invalid',
          'Writers observed different or expired challenges',
        );
      return {
        kind: 'tenant_d1_runtime_resource_checkpoint_v1',
        deploymentLane: request.deploymentLane,
        resource: options.resource,
        challengeId: request.challengeId,
        checkedAtMs,
        expiresAtMs,
        writerVersions: { gateway: gateway.versionId, walletRuntime: runtime.versionId },
        activationAuthorized: false,
      };
    },
  };
}
