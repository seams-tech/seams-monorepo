import { base64UrlDecode, base64UrlEncode } from '@seams/wallet-server/cloud-host';
import type { TenantRootDeriverRoleV1 } from '@seams-internal/wallet-console-shared/tenant-root';

const GRANT_DOMAIN = new TextEncoder().encode('seams/tenant-root-restore-role-import-grant/v1');
const GRANT_OPERATION = new TextEncoder().encode('tenant_root_restore_role_import_key_issue_v1');
const GRANT_AUTHENTICATION_DOMAIN = new TextEncoder().encode(
  'seams/tenant-root-restore-role-import-grant/authentication/v1',
);
const ED25519_PKCS8_SEED_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const RESTORE_ROLE_IMPORT_NONCE_BYTES = 32;
const RESTORE_ROLE_IMPORT_KEY_ID_MAX_BYTES = 128;
const RESTORE_ROLE_IMPORT_AUTHORITY_KEY_ID_MAX_BYTES = 256;
export const TENANT_ROOT_RESTORE_ROLE_IMPORT_MAX_LIFETIME_MS_V1 = 300_000;

/** The exact public fields authenticated by one role import-key grant. */
export interface TenantRootRestoreRoleImportGrantSigningInputV1 {
  readonly operationDigestB64u: string;
  readonly destinationIdentityDigestB64u: string;
  readonly destinationFingerprintB64u: string;
  readonly destinationLineageB64u: string;
  readonly restoreSessionIdB64u: string;
  readonly manifestDigestB64u: string;
  readonly role: TenantRootDeriverRoleV1;
  readonly importKeyId: string;
  readonly generation: number;
  readonly nonceB64u: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly grantKeyId: string;
  readonly signingSeedB64u: string;
}

/** A signed grant and its public digest for the control-plane command. */
export interface SignedTenantRootRestoreRoleImportGrantV1 {
  readonly operationDigestB64u: string;
  readonly destinationIdentityDigestB64u: string;
  readonly destinationFingerprintB64u: string;
  readonly destinationLineageB64u: string;
  readonly restoreSessionIdB64u: string;
  readonly manifestDigestB64u: string;
  readonly role: TenantRootDeriverRoleV1;
  readonly importKeyId: string;
  readonly generation: number;
  readonly nonceB64u: string;
  readonly grantKeyId: string;
  readonly grantB64u: string;
  readonly grantDigestB64u: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function lengthPrefix(value: Uint8Array): Uint8Array {
  if (value.length === 0 || value.length > 0xffff_ffff) {
    throw new Error('Tenant-root restore grant canonical field length is invalid');
  }
  const output = new Uint8Array(4 + value.length);
  new DataView(output.buffer).setUint32(0, value.length, false);
  output.set(value, 4);
  return output;
}

function u64(value: number, label: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, BigInt(value), false);
  return output;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function textBytes(value: string, label: string, maximumBytes: number): Uint8Array {
  if (!value || value.trim() !== value || hasControlCharacters(value)) {
    throw new Error(`${label} is invalid`);
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > maximumBytes) {
    throw new Error(`${label} exceeds its maximum length`);
  }
  return bytes;
}

function importKeyIdBytes(value: string): Uint8Array {
  const bytes = textBytes(value, 'importKeyId', RESTORE_ROLE_IMPORT_KEY_ID_MAX_BYTES);
  if (bytes.includes(0x20)) throw new Error('importKeyId is invalid');
  return bytes;
}

function canonicalBase64UrlBytes(
  value: string,
  expectedLength: number,
  label: string,
  requireNonzero: boolean,
): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`${label} is invalid`);
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (
    bytes.length !== expectedLength ||
    base64UrlEncode(bytes) !== value ||
    (requireNonzero && bytes.every((byte) => byte === 0))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return new Uint8Array(bytes);
}

function canonicalRole(value: TenantRootDeriverRoleV1): Uint8Array {
  if (value !== 'deriver_a' && value !== 'deriver_b') {
    throw new Error('role is invalid');
  }
  return new TextEncoder().encode(value);
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.length);
  new Uint8Array(output).set(bytes);
  return output;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto is required for tenant-root restore grant issuance');
  return new Uint8Array(await subtle.digest('SHA-256', copyToArrayBuffer(bytes)));
}

async function signEd25519(seed: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto is required for tenant-root restore grant issuance');
  const pkcs8 = concatBytes([ED25519_PKCS8_SEED_PREFIX, seed]);
  try {
    const key = await subtle.importKey('pkcs8', copyToArrayBuffer(pkcs8), 'Ed25519', false, [
      'sign',
    ]);
    return new Uint8Array(await subtle.sign('Ed25519', key, copyToArrayBuffer(message)));
  } finally {
    pkcs8.fill(0);
  }
}

function validateTimeWindow(issuedAtMs: number, expiresAtMs: number): void {
  if (
    !Number.isSafeInteger(issuedAtMs) ||
    issuedAtMs <= 0 ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > TENANT_ROOT_RESTORE_ROLE_IMPORT_MAX_LIFETIME_MS_V1
  ) {
    throw new Error('Tenant-root restore grant time window is invalid');
  }
}

function unsignedGrantBytes(input: {
  readonly operationDigest: Uint8Array;
  readonly destinationIdentityDigest: Uint8Array;
  readonly destinationFingerprint: Uint8Array;
  readonly destinationLineage: Uint8Array;
  readonly restoreSessionId: Uint8Array;
  readonly manifestDigest: Uint8Array;
  readonly role: Uint8Array;
  readonly importKeyId: Uint8Array;
  readonly generation: Uint8Array;
  readonly nonce: Uint8Array;
  readonly issuedAtMs: Uint8Array;
  readonly expiresAtMs: Uint8Array;
  readonly grantKeyId: Uint8Array;
}): Uint8Array {
  return concatBytes([
    lengthPrefix(GRANT_DOMAIN),
    lengthPrefix(GRANT_OPERATION),
    lengthPrefix(input.operationDigest),
    lengthPrefix(input.destinationIdentityDigest),
    lengthPrefix(input.destinationFingerprint),
    lengthPrefix(input.destinationLineage),
    lengthPrefix(input.restoreSessionId),
    lengthPrefix(input.manifestDigest),
    lengthPrefix(input.role),
    lengthPrefix(input.importKeyId),
    lengthPrefix(input.generation),
    lengthPrefix(input.nonce),
    lengthPrefix(input.issuedAtMs),
    lengthPrefix(input.expiresAtMs),
    lengthPrefix(input.grantKeyId),
  ]);
}

function grantAuthenticationInput(grantKeyId: Uint8Array, unsigned: Uint8Array): Uint8Array {
  return concatBytes([
    lengthPrefix(GRANT_AUTHENTICATION_DOMAIN),
    lengthPrefix(grantKeyId),
    lengthPrefix(unsigned),
  ]);
}

/** Signs the native `TenantRootRestoreRoleImportGrantV1` wire exactly. */
export async function signTenantRootRestoreRoleImportGrantV1(
  input: TenantRootRestoreRoleImportGrantSigningInputV1,
): Promise<SignedTenantRootRestoreRoleImportGrantV1> {
  validateTimeWindow(input.issuedAtMs, input.expiresAtMs);
  if (!Number.isSafeInteger(input.generation) || input.generation <= 0) {
    throw new Error('generation must be a positive safe integer');
  }
  const operationDigest = canonicalBase64UrlBytes(
    input.operationDigestB64u,
    32,
    'operationDigestB64u',
    true,
  );
  const destinationIdentityDigest = canonicalBase64UrlBytes(
    input.destinationIdentityDigestB64u,
    32,
    'destinationIdentityDigestB64u',
    true,
  );
  const destinationFingerprint = canonicalBase64UrlBytes(
    input.destinationFingerprintB64u,
    32,
    'destinationFingerprintB64u',
    true,
  );
  const destinationLineage = canonicalBase64UrlBytes(
    input.destinationLineageB64u,
    16,
    'destinationLineageB64u',
    true,
  );
  const restoreSessionId = canonicalBase64UrlBytes(
    input.restoreSessionIdB64u,
    16,
    'restoreSessionIdB64u',
    true,
  );
  const manifestDigest = canonicalBase64UrlBytes(
    input.manifestDigestB64u,
    32,
    'manifestDigestB64u',
    true,
  );
  const nonce = canonicalBase64UrlBytes(
    input.nonceB64u,
    RESTORE_ROLE_IMPORT_NONCE_BYTES,
    'nonceB64u',
    true,
  );
  const role = canonicalRole(input.role);
  const importKeyId = importKeyIdBytes(input.importKeyId);
  const grantKeyId = textBytes(
    input.grantKeyId,
    'grantKeyId',
    RESTORE_ROLE_IMPORT_AUTHORITY_KEY_ID_MAX_BYTES,
  );
  const generation = u64(input.generation, 'generation');
  const issuedAtMs = u64(input.issuedAtMs, 'issuedAtMs');
  const expiresAtMs = u64(input.expiresAtMs, 'expiresAtMs');
  const seed = canonicalBase64UrlBytes(input.signingSeedB64u, 32, 'signingSeedB64u', false);
  const unsigned = unsignedGrantBytes({
    operationDigest,
    destinationIdentityDigest,
    destinationFingerprint,
    destinationLineage,
    restoreSessionId,
    manifestDigest,
    role,
    importKeyId,
    generation,
    nonce,
    issuedAtMs,
    expiresAtMs,
    grantKeyId,
  });
  try {
    const signature = await signEd25519(seed, grantAuthenticationInput(grantKeyId, unsigned));
    if (signature.length !== 64) {
      throw new Error('Tenant-root restore grant authority produced an invalid signature');
    }
    const grant = concatBytes([unsigned, lengthPrefix(signature)]);
    const grantDigest = await sha256(grant);
    return {
      operationDigestB64u: input.operationDigestB64u,
      destinationIdentityDigestB64u: input.destinationIdentityDigestB64u,
      destinationFingerprintB64u: input.destinationFingerprintB64u,
      destinationLineageB64u: input.destinationLineageB64u,
      restoreSessionIdB64u: input.restoreSessionIdB64u,
      manifestDigestB64u: input.manifestDigestB64u,
      role: input.role,
      importKeyId: input.importKeyId,
      generation: input.generation,
      nonceB64u: input.nonceB64u,
      grantKeyId: input.grantKeyId,
      grantB64u: base64UrlEncode(grant),
      grantDigestB64u: base64UrlEncode(grantDigest),
      issuedAtMs: input.issuedAtMs,
      expiresAtMs: input.expiresAtMs,
    };
  } finally {
    seed.fill(0);
  }
}
