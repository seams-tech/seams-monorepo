import { base64UrlDecode, base64UrlEncode, sha256Bytes } from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams-internal/shared-ts/utils/validation';
import { ROUTER_AB_MPC_ROUTER_ORIGIN } from '@seams/wallet-server/cloud-host';
import type {
  TenantRootRestoreManifestRegistrarV1,
  TenantRootRestoreRegisteredManifestV1,
} from './restoreService';

const TENANT_ROOT_RESTORE_MANIFEST_PATH_V1 =
  '/tenant-root-control-plane/restore/v1/register-manifest';
const TENANT_ROOT_RESTORE_MANIFEST_URL_V1 = `${ROUTER_AB_MPC_ROUTER_ORIGIN}${TENANT_ROOT_RESTORE_MANIFEST_PATH_V1}`;
const TENANT_ROOT_RESTORE_MANIFEST_MAX_BYTES_V1 = 128 * 1024;
const TENANT_ROOT_RECOVERY_PACKAGE_MAX_BYTES_V1 = 16 * 1024;
const TENANT_ROOT_INTERNAL_SERVICE_AUTH_HEADER_V1 = 'x-router-ab-internal-service-auth';

type RouterFetchV1 = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export interface TenantRootRestoreManifestClientOptionsV1 {
  readonly routerFetch: RouterFetchV1;
  readonly internalServiceAuthSecret: string;
}

export class TenantRootRestoreManifestNetworkError extends Error {
  readonly code = 'tenant_root_restore_manifest_network_failure';

  constructor() {
    super('Tenant-root restore manifest request failed before a response was received');
    this.name = 'TenantRootRestoreManifestNetworkError';
  }
}

export class TenantRootRestoreManifestUnavailableError extends Error {
  readonly code = 'tenant_root_restore_manifest_unavailable';
  readonly reason: 'http_failure' | 'malformed_response' | 'manifest_mismatch';

  constructor(reason: 'http_failure' | 'malformed_response' | 'manifest_mismatch') {
    super(`Tenant-root restore manifest response is unavailable (${reason})`);
    this.name = 'TenantRootRestoreManifestUnavailableError';
    this.reason = reason;
  }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} is invalid`);
  return value;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function canonicalBase64Url(value: unknown, maxBytes: number, label: string): string {
  const text = requiredText(value, label);
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) throw new Error(`${label} is invalid`);
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(text);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (decoded.length === 0 || decoded.length > maxBytes || base64UrlEncode(decoded) !== text) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function exactBase64UrlBytes(value: unknown, expectedBytes: number, label: string): string {
  const text = canonicalBase64Url(value, expectedBytes, label);
  if (base64UrlDecode(text).length !== expectedBytes) throw new Error(`${label} is invalid`);
  return text;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const text = requiredText(value, label);
  const parsed = Date.parse(text);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(text) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== text
  ) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function parseTrustLevel(value: unknown): TenantRootRestoreRegisteredManifestV1['trustLevel'] {
  const record = requiredRecord(value, 'trust level');
  const kind = requiredText(record.kind, 'trust level kind');
  switch (kind) {
    case 'cryptographically_valid_offline':
      if (!hasExactKeys(record, ['kind'])) throw new Error('trust level is invalid');
      return { kind };
    case 'valid_at_trust_snapshot':
      if (!hasExactKeys(record, ['kind', 'snapshot_version', 'snapshot_issued_at'])) {
        throw new Error('trust level is invalid');
      }
      return {
        kind,
        snapshotVersion: requiredPositiveInteger(record.snapshot_version, 'snapshot version'),
        snapshotIssuedAt: canonicalTimestamp(record.snapshot_issued_at, 'snapshot issued at'),
      };
    case 'current_trust_confirmed':
      if (!hasExactKeys(record, ['kind', 'snapshot_version', 'snapshot_issued_at', 'checked_at'])) {
        throw new Error('trust level is invalid');
      }
      return {
        kind,
        snapshotVersion: requiredPositiveInteger(record.snapshot_version, 'snapshot version'),
        snapshotIssuedAt: canonicalTimestamp(record.snapshot_issued_at, 'snapshot issued at'),
        checkedAt: canonicalTimestamp(record.checked_at, 'trust checked at'),
      };
    default:
      throw new Error('trust level is invalid');
  }
}

function parseRole(
  value: unknown,
  label: string,
  expectedShareId: 1,
): TenantRootRestoreRegisteredManifestV1['deriverA'];
function parseRole(
  value: unknown,
  label: string,
  expectedShareId: 2,
): TenantRootRestoreRegisteredManifestV1['deriverB'];
function parseRole(
  value: unknown,
  label: string,
  expectedShareId: 1 | 2,
):
  | TenantRootRestoreRegisteredManifestV1['deriverA']
  | TenantRootRestoreRegisteredManifestV1['deriverB'] {
  const record = requiredRecord(value, label);
  if (
    !hasExactKeys(record, [
      'share_id',
      'recipient_public_key_b64u',
      'recipient_fingerprint_b64u',
      'recovery_share_commitment_b64u',
      'deriver_signing_key_id',
    ])
  ) {
    throw new Error(`${label} is invalid`);
  }
  const shareId = requiredPositiveInteger(record.share_id, `${label} share id`);
  if (shareId !== expectedShareId) throw new Error(`${label} share id is invalid`);
  const recipientPublicKeyB64u = exactBase64UrlBytes(
    record.recipient_public_key_b64u,
    32,
    `${label} recipient public key`,
  );
  const recipientFingerprintB64u = exactBase64UrlBytes(
    record.recipient_fingerprint_b64u,
    32,
    `${label} recipient fingerprint`,
  );
  const recoveryShareCommitmentB64u = exactBase64UrlBytes(
    record.recovery_share_commitment_b64u,
    34,
    `${label} recovery share commitment`,
  );
  const deriverSigningKeyId = requiredText(
    record.deriver_signing_key_id,
    `${label} signing key id`,
  );
  if (expectedShareId === 1) {
    if (shareId !== 1) throw new Error(`${label} share id is invalid`);
    return {
      shareId: 1,
      recipientPublicKeyB64u,
      recipientFingerprintB64u,
      recoveryShareCommitmentB64u,
      deriverSigningKeyId,
    };
  }
  if (shareId !== 2) throw new Error(`${label} share id is invalid`);
  return {
    shareId: 2,
    recipientPublicKeyB64u,
    recipientFingerprintB64u,
    recoveryShareCommitmentB64u,
    deriverSigningKeyId,
  };
}

export function parseTenantRootRegisteredManifestV1(
  value: unknown,
): TenantRootRestoreRegisteredManifestV1 {
  const record = requiredRecord(value, 'registered manifest');
  if (
    !hasExactKeys(record, [
      'identity_digest_b64u',
      'source_custody_lineage_b64u',
      'recovery_set_id_b64u',
      'stable_root_commitment_b64u',
      'deriver_a',
      'deriver_b',
      'deriver_a_package_length',
      'deriver_a_package_digest_b64u',
      'deriver_b_package_length',
      'deriver_b_package_digest_b64u',
      'manifest_digest_b64u',
      'artifact_created_at_iso',
      'trust_level',
    ])
  ) {
    throw new Error('registered manifest is invalid');
  }
  const deriverA = parseRole(record.deriver_a, 'Deriver A', 1);
  const deriverB = parseRole(record.deriver_b, 'Deriver B', 2);
  if (
    deriverA.recipientFingerprintB64u === deriverB.recipientFingerprintB64u ||
    deriverA.deriverSigningKeyId === deriverB.deriverSigningKeyId
  ) {
    throw new Error('registered manifest role bindings are invalid');
  }
  const deriverAPackageLength = requiredPositiveInteger(
    record.deriver_a_package_length,
    'Deriver A package length',
  );
  const deriverBPackageLength = requiredPositiveInteger(
    record.deriver_b_package_length,
    'Deriver B package length',
  );
  if (
    deriverAPackageLength > TENANT_ROOT_RECOVERY_PACKAGE_MAX_BYTES_V1 ||
    deriverBPackageLength > TENANT_ROOT_RECOVERY_PACKAGE_MAX_BYTES_V1
  ) {
    throw new Error('registered manifest package length is invalid');
  }
  return {
    identityDigestB64u: exactBase64UrlBytes(
      record.identity_digest_b64u,
      32,
      'manifest identity digest',
    ),
    sourceCustodyLineageB64u: exactBase64UrlBytes(
      record.source_custody_lineage_b64u,
      16,
      'manifest source custody lineage',
    ),
    recoverySetId: exactBase64UrlBytes(record.recovery_set_id_b64u, 16, 'manifest recovery set id'),
    stableRootCommitmentB64u: exactBase64UrlBytes(
      record.stable_root_commitment_b64u,
      32,
      'manifest stable root commitment',
    ),
    deriverA,
    deriverB,
    deriverAPackageLength,
    deriverAPackageDigestB64u: exactBase64UrlBytes(
      record.deriver_a_package_digest_b64u,
      32,
      'Deriver A package digest',
    ),
    deriverBPackageLength,
    deriverBPackageDigestB64u: exactBase64UrlBytes(
      record.deriver_b_package_digest_b64u,
      32,
      'Deriver B package digest',
    ),
    manifestDigestB64u: exactBase64UrlBytes(record.manifest_digest_b64u, 32, 'manifest digest'),
    artifactCreatedAtIso: canonicalTimestamp(
      record.artifact_created_at_iso,
      'manifest artifact creation time',
    ),
    trustLevel: parseTrustLevel(record.trust_level),
  };
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TenantRootRestoreManifestUnavailableError('malformed_response');
  }
}

class TenantRootRestoreManifestClientV1 implements TenantRootRestoreManifestRegistrarV1 {
  private readonly internalServiceAuthSecret: string;

  constructor(private readonly options: TenantRootRestoreManifestClientOptionsV1) {
    this.internalServiceAuthSecret = requiredText(
      options.internalServiceAuthSecret,
      'internalServiceAuthSecret',
    );
  }

  async registerManifest(input: {
    readonly manifestB64u: string;
  }): Promise<TenantRootRestoreRegisteredManifestV1> {
    const manifestB64u = canonicalBase64Url(
      input.manifestB64u,
      TENANT_ROOT_RESTORE_MANIFEST_MAX_BYTES_V1,
      'manifestB64u',
    );
    let response: Response;
    try {
      response = await this.options.routerFetch.fetch(
        new Request(TENANT_ROOT_RESTORE_MANIFEST_URL_V1, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            [TENANT_ROOT_INTERNAL_SERVICE_AUTH_HEADER_V1]: this.internalServiceAuthSecret,
          },
          body: JSON.stringify({ manifest_b64u: manifestB64u }),
        }),
      );
    } catch {
      throw new TenantRootRestoreManifestNetworkError();
    }
    if (!response.ok) throw new TenantRootRestoreManifestUnavailableError('http_failure');
    const body = await readResponseJson(response);
    try {
      const registered = parseTenantRootRegisteredManifestV1(body);
      const expectedManifestDigestB64u = base64UrlEncode(
        await sha256Bytes(base64UrlDecode(manifestB64u)),
      );
      if (registered.manifestDigestB64u !== expectedManifestDigestB64u) {
        throw new TenantRootRestoreManifestUnavailableError('manifest_mismatch');
      }
      return registered;
    } catch (error) {
      if (error instanceof TenantRootRestoreManifestUnavailableError) throw error;
      throw new TenantRootRestoreManifestUnavailableError('malformed_response');
    }
  }
}

export function createTenantRootRestoreManifestClientV1(
  options: TenantRootRestoreManifestClientOptionsV1,
): TenantRootRestoreManifestRegistrarV1 {
  return new TenantRootRestoreManifestClientV1(options);
}
