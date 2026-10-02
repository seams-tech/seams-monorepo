import type {
  D1DatabaseLike,
  D1Row,
  WalletRuntimeServiceBinding,
} from '@seams/wallet-server/cloud-host';
import { NamespaceD1HomeV1, type NamespaceD1HomeStoreV1 } from './namespaceHome';
import { TenantDeploymentStoreError } from './service';

const CHALLENGE_PATH = '/internal/tenant-deployment/v1/home-challenge';
const CHALLENGE_ORIGIN = 'https://tenant-deployment.internal';
const HEX_32_BYTES = /^[a-f0-9]{64}$/u;
const VERSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

export type TenantD1HomeChallengeRequestV1 = {
  readonly deploymentLane: string;
  readonly challengeId: string;
  readonly expectedProof: string;
};

type ChallengeObservation = {
  readonly versionId: string;
  readonly home: NamespaceD1HomeV1;
  readonly challengeId: string;
  readonly proof: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
};

export interface TenantD1HomeVerifierV1 {
  verify(request: TenantD1HomeChallengeRequestV1): Promise<{
    readonly kind: 'tenant_d1_runtime_home_checkpoint_v1';
    readonly deploymentLane: string;
    readonly home: NamespaceD1HomeV1;
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

export function parseTenantD1HomeChallengeRequestV1(raw: unknown): TenantD1HomeChallengeRequestV1 {
  if (
    !record(raw) ||
    Object.keys(raw).sort().join(',') !== 'challengeId,deploymentLane,expectedProof' ||
    typeof raw.deploymentLane !== 'string' ||
    !raw.deploymentLane ||
    raw.deploymentLane.trim() !== raw.deploymentLane ||
    !hex(raw.challengeId) ||
    !hex(raw.expectedProof)
  )
    throw new TenantDeploymentStoreError('invalid_input', 'D1 home challenge request is invalid');
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
      'D1 home challenge is missing, invalid or expired',
    );
  }
  return {
    versionId: raw.versionId,
    home: NamespaceD1HomeV1.parse(raw.home),
    challengeId: raw.challengeId,
    proof: raw.proof,
    issuedAtMs: raw.issuedAtMs,
    expiresAtMs: raw.expiresAtMs,
  };
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function tenantD1HomeChallengeResponseV1(
  request: Request,
  database: D1DatabaseLike,
  rawHome: unknown,
  rawVersionMetadata: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== CHALLENGE_PATH) return null;
  if (url.origin !== CHALLENGE_ORIGIN) return json({ ok: false }, 404);
  if (request.method !== 'POST') return json({ ok: false }, 405);
  const home = NamespaceD1HomeV1.parse(rawHome);
  const raw: unknown = await request.json().catch(() => null);
  if (
    !record(raw) ||
    Object.keys(raw).sort().join(',') !== 'challengeId,namespace' ||
    !hex(raw.challengeId) ||
    raw.namespace !== home.namespace
  )
    return json({ ok: false }, 400);
  const row = await database
    .prepare(
      `SELECT account_id, database_id, proof, issued_at_ms, expires_at_ms
       FROM namespace_home_challenges WHERE namespace = ?1 AND challenge_id = ?2`,
    )
    .bind(home.namespace, raw.challengeId)
    .first<D1Row>();
  try {
    const observation = parseObservation(
      {
        versionId: record(rawVersionMetadata) ? rawVersionMetadata.id : null,
        home: {
          namespace: home.namespace,
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
    if (!observation.home.matches(home)) return json({ ok: false }, 409);
    return json(observation, 200);
  } catch {
    return json({ ok: false }, 409);
  }
}

async function inspectWriter(
  service: WalletRuntimeServiceBinding,
  home: NamespaceD1HomeV1,
  request: TenantD1HomeChallengeRequestV1,
): Promise<ChallengeObservation> {
  const response = await service.fetch(`${CHALLENGE_ORIGIN}${CHALLENGE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ namespace: home.namespace, challengeId: request.challengeId }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new TenantDeploymentStoreError(
      'readiness_invalid',
      `D1 runtime home challenge returned HTTP ${response.status}`,
    );
  const observation = parseObservation(await response.json(), Date.now());
  if (
    !observation.home.matches(home) ||
    observation.challengeId !== request.challengeId ||
    observation.proof !== request.expectedProof
  ) {
    throw new TenantDeploymentStoreError(
      'namespace_home_conflict',
      'D1 runtime home challenge does not match the reserved resource',
    );
  }
  return observation;
}

export function createTenantD1HomeVerifierV1(options: {
  readonly home: NamespaceD1HomeV1;
  readonly deploymentLane: string;
  readonly store: NamespaceD1HomeStoreV1;
  readonly gateway: WalletRuntimeServiceBinding;
  readonly walletRuntime: WalletRuntimeServiceBinding;
}): TenantD1HomeVerifierV1 {
  return {
    async verify(request) {
      if (request.deploymentLane !== options.deploymentLane)
        throw new TenantDeploymentStoreError(
          'invalid_input',
          'D1 home challenge lane disagrees with this runtime',
        );
      const assignment = await options.store.findNamespaceHome(options.home.namespace);
      if (!assignment)
        throw new TenantDeploymentStoreError(
          'namespace_home_unassigned',
          'Namespace home must be reserved before verification',
        );
      if (!assignment.home.matches(options.home))
        throw new TenantDeploymentStoreError(
          'namespace_home_conflict',
          'Configured home disagrees with the immutable reservation',
        );
      const gateway = await inspectWriter(options.gateway, assignment.home, request);
      const runtime = await inspectWriter(options.walletRuntime, assignment.home, request);
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
        kind: 'tenant_d1_runtime_home_checkpoint_v1',
        deploymentLane: request.deploymentLane,
        home: assignment.home,
        challengeId: request.challengeId,
        checkedAtMs,
        expiresAtMs,
        writerVersions: { gateway: gateway.versionId, walletRuntime: runtime.versionId },
        activationAuthorized: false,
      };
    },
  };
}
