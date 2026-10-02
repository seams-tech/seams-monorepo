import { TenantDeploymentD1ResourceIdentityV1 } from './deploymentResource';
import { TenantDeploymentStoreError } from './service';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const CHALLENGE = /^[a-f0-9]{64}$/u;

type WriterDeployment = {
  readonly workerName: string;
  readonly deploymentId: string;
  readonly versionId: string;
};

type VerificationAuthority =
  | { readonly kind: 'local_development'; readonly gateway?: never; readonly walletRuntime?: never }
  | {
      readonly kind: 'cloudflare';
      readonly gateway: WriterDeployment;
      readonly walletRuntime: WriterDeployment;
    };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new TenantDeploymentStoreError(
    'readiness_invalid',
    'Home verification is invalid or expired',
  );
}

function parseWriter(raw: unknown, versionId: unknown, databaseId: string): WriterDeployment {
  if (
    !record(raw) ||
    typeof raw.workerName !== 'string' ||
    !raw.workerName ||
    typeof raw.deploymentId !== 'string' ||
    !UUID.test(raw.deploymentId) ||
    typeof versionId !== 'string' ||
    !UUID.test(versionId) ||
    !Array.isArray(raw.versions) ||
    raw.versions.length !== 1
  )
    invalid();
  const version: unknown = raw.versions[0];
  if (
    !record(version) ||
    version.versionId !== versionId ||
    version.percentage !== 100 ||
    version.databaseId !== databaseId
  )
    invalid();
  return Object.freeze({ workerName: raw.workerName, deploymentId: raw.deploymentId, versionId });
}

// Only the authenticated operator boundary accepts a provider checkpoint.
export class TenantHomeVerificationV1 {
  readonly #validated = true;
  private constructor(
    readonly home: TenantDeploymentD1ResourceIdentityV1,
    readonly deploymentLane: string,
    readonly challengeId: string,
    readonly checkedAtMs: number,
    readonly expiresAtMs: number,
    readonly authority: VerificationAuthority,
  ) {
    Object.freeze(this);
  }

  static fromOperatorCheckpoint(raw: unknown, nowMs: number): TenantHomeVerificationV1 {
    if (
      !record(raw) ||
      raw.kind !== 'tenant_d1_resource_checkpoint_v1' ||
      raw.runtimeChallengeVerified !== true ||
      raw.activationAuthorized !== false ||
      typeof raw.deploymentLane !== 'string' ||
      !raw.deploymentLane ||
      typeof raw.challengeId !== 'string' ||
      !CHALLENGE.test(raw.challengeId) ||
      typeof raw.checkedAtMs !== 'number' ||
      !Number.isSafeInteger(raw.checkedAtMs) ||
      typeof raw.expiresAtMs !== 'number' ||
      !Number.isSafeInteger(raw.expiresAtMs) ||
      raw.checkedAtMs <= 0 ||
      raw.checkedAtMs > nowMs ||
      raw.expiresAtMs <= nowMs ||
      raw.expiresAtMs <= raw.checkedAtMs ||
      raw.expiresAtMs - raw.checkedAtMs > 300_000 ||
      typeof raw.providerCheckedBefore !== 'string' ||
      typeof raw.providerCheckedAfter !== 'string' ||
      !record(raw.writerVersions) ||
      !Array.isArray(raw.workers) ||
      raw.workers.length !== 2
    )
      invalid();
    const before = Date.parse(raw.providerCheckedBefore);
    const after = Date.parse(raw.providerCheckedAfter);
    if (
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      before <= 0 ||
      before > raw.checkedAtMs ||
      after < raw.checkedAtMs ||
      after > nowMs ||
      nowMs - before > 300_000
    )
      invalid();
    const home = TenantDeploymentD1ResourceIdentityV1.parse(raw.resource);
    const [gatewayRaw, runtimeRaw] = raw.workers;
    const gateway = parseWriter(gatewayRaw, raw.writerVersions.gateway, home.databaseId);
    const walletRuntime = parseWriter(
      runtimeRaw,
      raw.writerVersions.walletRuntime,
      home.databaseId,
    );
    if (
      gateway.workerName === walletRuntime.workerName ||
      gateway.versionId === walletRuntime.versionId
    )
      invalid();
    return new TenantHomeVerificationV1(
      home,
      raw.deploymentLane,
      raw.challengeId,
      raw.checkedAtMs,
      raw.expiresAtMs,
      Object.freeze({ kind: 'cloudflare', gateway, walletRuntime }),
    );
  }

  static forLocalDevelopment(
    home: TenantDeploymentD1ResourceIdentityV1,
    lane: string,
    nowMs: number,
  ): TenantHomeVerificationV1 {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let challengeId = '';
    for (const byte of bytes) challengeId += byte.toString(16).padStart(2, '0');
    return new TenantHomeVerificationV1(
      home,
      lane,
      challengeId,
      nowMs,
      nowMs + 300_000,
      Object.freeze({ kind: 'local_development' }),
    );
  }

  assertFor(home: TenantDeploymentD1ResourceIdentityV1, lane: string, nowMs: number): void {
    if (
      !this.#validated ||
      !this.home.matches(home) ||
      this.deploymentLane !== lane ||
      this.checkedAtMs > nowMs ||
      this.expiresAtMs <= nowMs
    )
      invalid();
  }
}

export type TenantRuntimeWriterV1 = {
  readonly role: 'gateway' | 'walletRuntime';
  readonly versionId: string;
};

export function parseTenantRuntimeWriterV1(
  role: unknown,
  versionId: unknown,
): TenantRuntimeWriterV1 {
  if (
    (role !== 'gateway' && role !== 'walletRuntime') ||
    typeof versionId !== 'string' ||
    !UUID.test(versionId)
  )
    invalid();
  return { role, versionId };
}

export function storedRuntimeVersionMatches(
  rawJson: unknown,
  writer: TenantRuntimeWriterV1,
): boolean {
  if (typeof rawJson !== 'string') return false;
  const raw: unknown = JSON.parse(rawJson);
  if (!record(raw) || !record(raw.authority) || raw.authority.kind !== 'cloudflare') return false;
  const deployment = raw.authority[writer.role];
  return record(deployment) && deployment.versionId === writer.versionId;
}
