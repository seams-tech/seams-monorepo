import { signTenantRootRestoreCleanupGrantV1 } from './restoreCleanupGrantSigner';
import { base64UrlDecode, base64UrlEncode } from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import {
  tenantRootOperationDigestB64uV1,
  type TenantRootDeriverRoleV1,
  type TenantRootOutstandingCleanupV1,
  type TenantRootRestoreActivationEvidenceV1,
  type TenantRootRestoreBootstrapCleanupV1,
  type TenantRootRestoreCleanupEvidenceV1,
  type TenantRootRestoreRoleCleanupV1,
  type TenantRootRestoreRoleImportKeyIssueOperationRecordV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import { ROUTER_AB_MPC_ROUTER_ORIGIN } from '@seams/wallet-server/cloud-host';
import {
  signTenantRootRestoreRoleImportGrantV1,
  type SignedTenantRootRestoreRoleImportGrantV1,
} from './restoreGrantSigner';
import {
  signTenantRootRestoreRefreshGrantV1,
  TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_LIFETIME_MS_V1,
  type SignedTenantRootRestoreRefreshGrantV1,
  type TenantRootRestoreRefreshGrantSigningInputV1,
} from './restoreRefreshGrantSigner';
import { TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_MS_V1 } from './restoreService';
import type {
  TenantRootRestoreControlPlaneV1,
  TenantRootRestoreActivationResultV1,
  TenantRootRestoreRoleImportKeyIssueResponseV1,
} from './restoreService';

const TENANT_ROOT_RESTORE_ROLE_IMPORT_PATH_V1 =
  '/tenant-root-control-plane/restore/v1/issue-import-key';
const TENANT_ROOT_RESTORE_ROLE_IMPORT_URL_V1 = `${ROUTER_AB_MPC_ROUTER_ORIGIN}${TENANT_ROOT_RESTORE_ROLE_IMPORT_PATH_V1}`;
const TENANT_ROOT_RESTORE_ACTIVATION_PATH_V1 =
  '/router-ab/internal/tenant-root/restore/v1/activate';
const TENANT_ROOT_RESTORE_ACTIVATION_URL_V1 = `${ROUTER_AB_MPC_ROUTER_ORIGIN}${TENANT_ROOT_RESTORE_ACTIVATION_PATH_V1}`;
const TENANT_ROOT_RESTORE_CLEANUP_PATH_V1 = '/router-ab/internal/tenant-root/restore/v1/cleanup';
const TENANT_ROOT_RESTORE_CLEANUP_URL_V1 = `${ROUTER_AB_MPC_ROUTER_ORIGIN}${TENANT_ROOT_RESTORE_CLEANUP_PATH_V1}`;
const TENANT_ROOT_INTERNAL_SERVICE_AUTH_HEADER_V1 = 'x-router-ab-internal-service-auth';
const TENANT_ROOT_RESTORE_MANIFEST_MAX_BYTES_V1 = 128 * 1024;
const TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1 = 16 * 1024;

type RouterFetchV1 = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export interface TenantRootRestoreControlPlaneClientOptionsV1 {
  readonly routerFetch: RouterFetchV1;
  readonly internalServiceAuthSecret: string;
  readonly grantKeyId: string;
  readonly grantSigningSeedB64u: string;
}

export class TenantRootRestoreRoleImportNetworkError extends Error {
  readonly code = 'tenant_root_restore_role_import_network_failure';

  constructor() {
    super('Tenant-root restore role-import request failed before a response was received');
    this.name = 'TenantRootRestoreRoleImportNetworkError';
  }
}

export class TenantRootRestoreRoleImportUnavailableError extends Error {
  readonly code = 'tenant_root_restore_role_import_unavailable';
  readonly reason: 'http_failure' | 'malformed_response' | 'result_mismatch';

  constructor(reason: 'http_failure' | 'malformed_response' | 'result_mismatch') {
    super(`Tenant-root restore role-import response is unavailable (${reason})`);
    this.name = 'TenantRootRestoreRoleImportUnavailableError';
    this.reason = reason;
  }
}

export class TenantRootRestoreActivationNetworkError extends Error {
  readonly code = 'tenant_root_restore_activation_network_failure';

  constructor() {
    super('Tenant-root restore activation request failed before a response was received');
    this.name = 'TenantRootRestoreActivationNetworkError';
  }
}

export class TenantRootRestoreActivationUnavailableError extends Error {
  readonly code = 'tenant_root_restore_activation_unavailable';
  readonly reason: 'http_failure' | 'malformed_response' | 'scope_mismatch';

  constructor(reason: 'http_failure' | 'malformed_response' | 'scope_mismatch') {
    super(`Tenant-root restore activation response is unavailable (${reason})`);
    this.name = 'TenantRootRestoreActivationUnavailableError';
    this.reason = reason;
  }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function canonicalBase64Url(value: unknown, expectedBytes: number, label: string): string {
  const text = requiredText(value, label);
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) throw new Error(`${label} is invalid`);
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(text);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (
    bytes.length !== expectedBytes ||
    bytes.every((byte) => byte === 0) ||
    base64UrlEncode(bytes) !== text
  ) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function canonicalManifest(value: unknown): string {
  const text = requiredText(value, 'manifestB64u');
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) throw new Error('manifestB64u is invalid');
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(text);
  } catch {
    throw new Error('manifestB64u is invalid');
  }
  if (bytes.length === 0 || bytes.length > TENANT_ROOT_RESTORE_MANIFEST_MAX_BYTES_V1) {
    throw new Error('manifestB64u is invalid');
  }
  if (base64UrlEncode(bytes) !== text) throw new Error('manifestB64u is invalid');
  return text;
}

function canonicalIdentifier(value: unknown, label: string, maximumBytes: number): string {
  const text = requiredText(value, label);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > maximumBytes) throw new Error(`${label} is invalid`);
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      throw new Error(`${label} is invalid`);
    }
  }
  return text;
}

function canonicalMilliseconds(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function canonicalBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid`);
  return value;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function parseRole(value: unknown): TenantRootDeriverRoleV1 {
  if (value === 'deriver_a' || value === 'deriver_b') return value;
  throw new Error('role is invalid');
}

function parseCleanupOutstanding(value: unknown, label: string): TenantRootOutstandingCleanupV1 {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, ['roles', 'description']) ||
    !Array.isArray(value.roles) ||
    value.roles.length === 0
  ) {
    throw new Error(`${label} is invalid`);
  }
  const roles = value.roles.map((role) => parseRole(role));
  if (new Set(roles).size !== roles.length) throw new Error(`${label} is invalid`);
  return {
    roles,
    description: requiredText(value.description, `${label}.description`),
  };
}

function parseCleanupBootstrap(value: unknown): TenantRootRestoreBootstrapCleanupV1 {
  if (!isPlainObject(value)) throw new Error('bootstrap cleanup is invalid');
  const kind = requiredText(value.kind, 'bootstrap cleanup kind');
  switch (kind) {
    case 'destroyed':
      if (!exactKeys(value, ['kind', 'receipt_digest_b64u'])) {
        throw new Error('bootstrap cleanup is invalid');
      }
      return {
        kind,
        receiptDigestB64u: canonicalBase64Url(
          value.receipt_digest_b64u,
          32,
          'bootstrap cleanup receipt_digest_b64u',
        ),
      };
    case 'outstanding':
      if (!exactKeys(value, ['kind', 'outstanding'])) {
        throw new Error('bootstrap cleanup is invalid');
      }
      return {
        kind,
        outstanding: parseCleanupOutstanding(value.outstanding, 'bootstrap cleanup outstanding'),
      };
    default:
      throw new Error('bootstrap cleanup kind is invalid');
  }
}

function parseCleanupRoles(value: unknown): TenantRootRestoreRoleCleanupV1 {
  if (!isPlainObject(value)) throw new Error('role cleanup is invalid');
  const kind = requiredText(value.kind, 'role cleanup kind');
  switch (kind) {
    case 'both_roles_incomplete':
      if (!exactKeys(value, ['kind', 'outstanding'])) throw new Error('role cleanup is invalid');
      return {
        kind,
        outstanding: parseCleanupOutstanding(value.outstanding, 'role cleanup outstanding'),
      };
    case 'deriver_a_incomplete':
      if (!exactKeys(value, ['kind', 'deriver_b_receipt_digest_b64u', 'outstanding'])) {
        throw new Error('role cleanup is invalid');
      }
      return {
        kind,
        deriverBReceiptDigestB64u: canonicalBase64Url(
          value.deriver_b_receipt_digest_b64u,
          32,
          'role cleanup deriver_b_receipt_digest_b64u',
        ),
        outstanding: parseCleanupOutstanding(value.outstanding, 'role cleanup outstanding'),
      };
    case 'deriver_b_incomplete':
      if (!exactKeys(value, ['kind', 'deriver_a_receipt_digest_b64u', 'outstanding'])) {
        throw new Error('role cleanup is invalid');
      }
      return {
        kind,
        deriverAReceiptDigestB64u: canonicalBase64Url(
          value.deriver_a_receipt_digest_b64u,
          32,
          'role cleanup deriver_a_receipt_digest_b64u',
        ),
        outstanding: parseCleanupOutstanding(value.outstanding, 'role cleanup outstanding'),
      };
    case 'complete':
      if (!exactKeys(value, ['kind', 'receipts']) || !isPlainObject(value.receipts)) {
        throw new Error('role cleanup is invalid');
      }
      if (!exactKeys(value.receipts, ['deriver_a', 'deriver_b'])) {
        throw new Error('role cleanup receipts are invalid');
      }
      return {
        kind,
        receipts: {
          deriverA: canonicalBase64Url(
            value.receipts.deriver_a,
            32,
            'role cleanup deriver_a receipt',
          ),
          deriverB: canonicalBase64Url(
            value.receipts.deriver_b,
            32,
            'role cleanup deriver_b receipt',
          ),
        },
      };
    default:
      throw new Error('role cleanup kind is invalid');
  }
}

function parseCleanupEvidence(value: unknown): TenantRootRestoreCleanupEvidenceV1 {
  if (!isPlainObject(value) || !exactKeys(value, ['bootstrap', 'roles'])) {
    throw new Error('cleanup is invalid');
  }
  return {
    bootstrap: parseCleanupBootstrap(value.bootstrap),
    roles: parseCleanupRoles(value.roles),
  };
}

function cleanupOutstandingWire(value: TenantRootOutstandingCleanupV1): {
  readonly roles: readonly TenantRootDeriverRoleV1[];
  readonly description: string;
} {
  return { roles: value.roles, description: value.description };
}

function cleanupBootstrapWire(value: TenantRootRestoreBootstrapCleanupV1): unknown {
  switch (value.kind) {
    case 'destroyed':
      return { kind: value.kind, receipt_digest_b64u: value.receiptDigestB64u };
    case 'outstanding':
      return { kind: value.kind, outstanding: cleanupOutstandingWire(value.outstanding) };
  }
}

function cleanupRolesWire(value: TenantRootRestoreRoleCleanupV1): unknown {
  switch (value.kind) {
    case 'both_roles_incomplete':
      return { kind: value.kind, outstanding: cleanupOutstandingWire(value.outstanding) };
    case 'deriver_a_incomplete':
      return {
        kind: value.kind,
        deriver_b_receipt_digest_b64u: value.deriverBReceiptDigestB64u,
        outstanding: cleanupOutstandingWire(value.outstanding),
      };
    case 'deriver_b_incomplete':
      return {
        kind: value.kind,
        deriver_a_receipt_digest_b64u: value.deriverAReceiptDigestB64u,
        outstanding: cleanupOutstandingWire(value.outstanding),
      };
    case 'complete':
      return {
        kind: value.kind,
        receipts: {
          deriver_a: value.receipts.deriverA,
          deriver_b: value.receipts.deriverB,
        },
      };
  }
}

function cleanupEvidenceWire(value: TenantRootRestoreCleanupEvidenceV1): unknown {
  return {
    bootstrap: cleanupBootstrapWire(value.bootstrap),
    roles: cleanupRolesWire(value.roles),
  };
}

function parseRoleImportResult(value: unknown): TenantRootRestoreRoleImportKeyIssueResponseV1 {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, [
      'role',
      'import_key_id',
      'import_public_key_b64u',
      'generation',
      'issued_at_ms',
      'expires_at_ms',
      'operation_digest_b64u',
      'command_digest_b64u',
    ])
  ) {
    throw new TenantRootRestoreRoleImportUnavailableError('malformed_response');
  }
  const role = parseRole(value.role);
  const importKeyId = canonicalIdentifier(value.import_key_id, 'import_key_id', 128);
  const importPublicKeyB64u = canonicalBase64Url(
    value.import_public_key_b64u,
    32,
    'import_public_key_b64u',
  );
  const generation = canonicalMilliseconds(value.generation, 'generation');
  const issuedAtMs = canonicalMilliseconds(value.issued_at_ms, 'issued_at_ms');
  const expiresAtMs = canonicalMilliseconds(value.expires_at_ms, 'expires_at_ms');
  if (expiresAtMs <= issuedAtMs) {
    throw new TenantRootRestoreRoleImportUnavailableError('malformed_response');
  }
  const operationDigestB64u = canonicalBase64Url(
    value.operation_digest_b64u,
    32,
    'operation_digest_b64u',
  );
  const commandDigestB64u = canonicalBase64Url(
    value.command_digest_b64u,
    32,
    'command_digest_b64u',
  );
  return {
    role,
    importKeyId,
    importPublicKeyB64u,
    generation,
    issuedAtMs,
    expiresAtMs,
    operationDigestB64u,
    commandDigestB64u,
  };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TenantRootRestoreRoleImportUnavailableError('malformed_response');
  }
}

async function activationResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TenantRootRestoreActivationUnavailableError('malformed_response');
  }
}

function parseActivationResult(value: unknown): TenantRootRestoreActivationResultV1 {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, [
      'destination_lineage_id',
      'activated_epoch',
      'activation_receipt_b64u',
      'activation_receipt_digest_b64u',
      'forward_refresh_receipt_digest_b64u',
      'continuity_canary_receipt_digest_b64u',
      'root_commitment_matches',
      'cleanup',
    ])
  ) {
    throw new TenantRootRestoreActivationUnavailableError('malformed_response');
  }
  return {
    destinationLineageId: canonicalBase64Url(
      value.destination_lineage_id,
      16,
      'destination_lineage_id',
    ),
    activatedEpoch: canonicalMilliseconds(value.activated_epoch, 'activated_epoch'),
    activationReceiptB64u: canonicalManifest(value.activation_receipt_b64u),
    activationReceiptDigestB64u: canonicalBase64Url(
      value.activation_receipt_digest_b64u,
      32,
      'activation_receipt_digest_b64u',
    ),
    forwardRefreshReceiptDigestB64u: canonicalBase64Url(
      value.forward_refresh_receipt_digest_b64u,
      32,
      'forward_refresh_receipt_digest_b64u',
    ),
    continuityCanaryReceiptDigestB64u: canonicalBase64Url(
      value.continuity_canary_receipt_digest_b64u,
      32,
      'continuity_canary_receipt_digest_b64u',
    ),
    rootCommitmentMatches: canonicalBoolean(
      value.root_commitment_matches,
      'root_commitment_matches',
    ),
    cleanup: parseCleanupEvidence(value.cleanup),
  };
}

function canonicalGrantBytes(value: unknown): string {
  const text = requiredText(value, 'grantB64u');
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) throw new Error('grantB64u is invalid');
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(text);
  } catch {
    throw new Error('grantB64u is invalid');
  }
  if (
    bytes.length === 0 ||
    bytes.length > TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1 ||
    base64UrlEncode(bytes) !== text
  ) {
    throw new Error('grantB64u is invalid');
  }
  return text;
}

function activationGrantKeys(): readonly string[] {
  return [
    'operationDigestB64u',
    'destinationIdentityDigestB64u',
    'destinationFingerprintB64u',
    'destinationLineageB64u',
    'restoreSessionIdB64u',
    'manifestDigestB64u',
    'deriverAAcceptanceReceiptDigestB64u',
    'deriverBAcceptanceReceiptDigestB64u',
    'nonceB64u',
    'grantKeyId',
    'grantB64u',
    'grantDigestB64u',
    'issuedAtMs',
    'expiresAtMs',
  ];
}

async function validateActivationGrant(
  value: SignedTenantRootRestoreRefreshGrantV1,
  manifestB64u: string,
): Promise<SignedTenantRootRestoreRefreshGrantV1> {
  if (!isPlainObject(value) || !exactKeys(value, activationGrantKeys())) {
    throw new Error('restore refresh grant is invalid');
  }
  canonicalBase64Url(value.operationDigestB64u, 32, 'operationDigestB64u');
  canonicalBase64Url(value.destinationIdentityDigestB64u, 32, 'destinationIdentityDigestB64u');
  canonicalBase64Url(value.destinationFingerprintB64u, 32, 'destinationFingerprintB64u');
  canonicalBase64Url(value.destinationLineageB64u, 16, 'destinationLineageB64u');
  canonicalBase64Url(value.restoreSessionIdB64u, 16, 'restoreSessionIdB64u');
  canonicalBase64Url(value.manifestDigestB64u, 32, 'manifestDigestB64u');
  const deriverAAcceptanceReceiptDigestB64u = canonicalBase64Url(
    value.deriverAAcceptanceReceiptDigestB64u,
    32,
    'deriverAAcceptanceReceiptDigestB64u',
  );
  const deriverBAcceptanceReceiptDigestB64u = canonicalBase64Url(
    value.deriverBAcceptanceReceiptDigestB64u,
    32,
    'deriverBAcceptanceReceiptDigestB64u',
  );
  if (deriverAAcceptanceReceiptDigestB64u === deriverBAcceptanceReceiptDigestB64u) {
    throw new Error('restore refresh grant receipt digests must differ');
  }
  canonicalBase64Url(value.nonceB64u, 32, 'nonceB64u');
  canonicalIdentifier(value.grantKeyId, 'grantKeyId', 256);
  const grantB64u = canonicalGrantBytes(value.grantB64u);
  const grantDigestB64u = canonicalBase64Url(value.grantDigestB64u, 32, 'grantDigestB64u');
  const issuedAtMs = canonicalMilliseconds(value.issuedAtMs, 'issuedAtMs');
  const expiresAtMs = canonicalMilliseconds(value.expiresAtMs, 'expiresAtMs');
  if (
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_LIFETIME_MS_V1
  ) {
    throw new Error('restore refresh grant time window is invalid');
  }
  const manifestDigestB64u = base64UrlEncode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', base64UrlDecode(manifestB64u))),
  );
  if (value.manifestDigestB64u !== manifestDigestB64u) {
    throw new TenantRootRestoreActivationUnavailableError('scope_mismatch');
  }
  const actualGrantDigestB64u = base64UrlEncode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', base64UrlDecode(grantB64u))),
  );
  if (grantDigestB64u !== actualGrantDigestB64u) {
    throw new Error('restore refresh grant digest is invalid');
  }
  return value;
}

function grantInput(
  record: TenantRootRestoreRoleImportKeyIssueOperationRecordV1,
  operationDigestB64u: string,
  options: TenantRootRestoreControlPlaneClientOptionsV1,
): Parameters<typeof signTenantRootRestoreRoleImportGrantV1>[0] {
  const issuedAtMs = Date.parse(record.issuedAt);
  const expiresAtMs = Date.parse(record.expiresAt);
  return {
    operationDigestB64u,
    destinationIdentityDigestB64u: record.tenantRootIdentityDigest,
    destinationFingerprintB64u: record.destinationFingerprintB64u,
    destinationLineageB64u: record.custodyLineageId,
    restoreSessionIdB64u: record.restoreSessionIdB64u,
    manifestDigestB64u: record.manifestDigestB64u,
    role: record.role,
    importKeyId: record.importKeyId,
    generation: record.generation,
    nonceB64u: record.nonceB64u,
    issuedAtMs,
    expiresAtMs,
    grantKeyId: options.grantKeyId,
    signingSeedB64u: options.grantSigningSeedB64u,
  };
}

function responseMatchesRecord(
  response: TenantRootRestoreRoleImportKeyIssueResponseV1,
  record: TenantRootRestoreRoleImportKeyIssueOperationRecordV1,
  operationDigestB64u: string,
): boolean {
  return (
    response.role === record.role &&
    response.importKeyId === record.importKeyId &&
    response.generation === record.generation &&
    response.issuedAtMs === Date.parse(record.issuedAt) &&
    response.expiresAtMs ===
      Date.parse(record.issuedAt) + TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_MS_V1 &&
    response.operationDigestB64u === operationDigestB64u
  );
}

class TenantRootRestoreControlPlaneClientV1 implements Pick<
  TenantRootRestoreControlPlaneV1,
  | 'issueRoleImportKey'
  | 'acceptRoleImport'
  | 'issueRestoreRefreshGrant'
  | 'activate'
  | 'cleanupActivatedRoot'
  | 'cleanupSession'
> {
  private readonly internalServiceAuthSecret: string;
  private readonly grantKeyId: string;
  private readonly grantSigningSeedB64u: string;

  constructor(private readonly options: TenantRootRestoreControlPlaneClientOptionsV1) {
    this.internalServiceAuthSecret = requiredText(
      options.internalServiceAuthSecret,
      'internalServiceAuthSecret',
    );
    this.grantKeyId = canonicalIdentifier(options.grantKeyId, 'grantKeyId', 256);
    this.grantSigningSeedB64u = canonicalBase64Url(
      options.grantSigningSeedB64u,
      32,
      'grantSigningSeedB64u',
    );
  }

  async issueRestoreRefreshGrant(
    input: Omit<TenantRootRestoreRefreshGrantSigningInputV1, 'grantKeyId' | 'signingSeedB64u'>,
  ): Promise<SignedTenantRootRestoreRefreshGrantV1> {
    return await signTenantRootRestoreRefreshGrantV1({
      ...input,
      grantKeyId: this.grantKeyId,
      signingSeedB64u: this.grantSigningSeedB64u,
    });
  }

  async issueRoleImportKey(input: {
    readonly operationRecord: TenantRootRestoreRoleImportKeyIssueOperationRecordV1;
    readonly manifestB64u: string;
  }): Promise<TenantRootRestoreRoleImportKeyIssueResponseV1> {
    const manifestB64u = canonicalManifest(input.manifestB64u);
    const operationDigestB64u = await tenantRootOperationDigestB64uV1(input.operationRecord);
    const grant: SignedTenantRootRestoreRoleImportGrantV1 =
      await signTenantRootRestoreRoleImportGrantV1(
        grantInput(input.operationRecord, operationDigestB64u, {
          ...this.options,
          grantKeyId: this.grantKeyId,
          grantSigningSeedB64u: this.grantSigningSeedB64u,
        }),
      );
    let response: Response;
    try {
      response = await this.options.routerFetch.fetch(
        new Request(TENANT_ROOT_RESTORE_ROLE_IMPORT_URL_V1, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            [TENANT_ROOT_INTERNAL_SERVICE_AUTH_HEADER_V1]: this.internalServiceAuthSecret,
          },
          body: JSON.stringify({
            restore_grant_b64u: grant.grantB64u,
            manifest_b64u: manifestB64u,
          }),
        }),
      );
    } catch {
      throw new TenantRootRestoreRoleImportNetworkError();
    }
    if (!response.ok) {
      // This endpoint emits protocol errors as text. The console cannot
      // distinguish a definite refusal from a lost downstream result by HTTP
      // status alone, so every non-success response remains retryable.
      throw new TenantRootRestoreRoleImportUnavailableError('http_failure');
    }
    const parsed = parseRoleImportResult(await responseJson(response));
    if (!responseMatchesRecord(parsed, input.operationRecord, operationDigestB64u)) {
      throw new TenantRootRestoreRoleImportUnavailableError('result_mismatch');
    }
    return parsed;
  }

  async acceptRoleImport(input: {
    readonly operationRecord: TenantRootRestoreRoleImportKeyIssueOperationRecordV1;
    readonly manifestB64u: string;
    readonly importEnvelopeB64u: string;
  }): Promise<{ readonly receiptDigestB64u: string }> {
    const manifestB64u = canonicalManifest(input.manifestB64u);
    const envelopeBytes = base64UrlDecode(input.importEnvelopeB64u);
    if (
      envelopeBytes.length === 0 ||
      envelopeBytes.length > 16 * 1024 ||
      base64UrlEncode(envelopeBytes) !== input.importEnvelopeB64u
    ) {
      throw new Error('importEnvelopeB64u is invalid');
    }
    const envelopeDigestB64u = base64UrlEncode(
      new Uint8Array(await crypto.subtle.digest('SHA-256', envelopeBytes)),
    );
    const operationDigestB64u = await tenantRootOperationDigestB64uV1(input.operationRecord);
    const grant = await signTenantRootRestoreRoleImportGrantV1(
      grantInput(input.operationRecord, operationDigestB64u, {
        ...this.options,
        grantKeyId: this.grantKeyId,
        grantSigningSeedB64u: this.grantSigningSeedB64u,
      }),
    );
    let response: Response;
    try {
      response = await this.options.routerFetch.fetch(
        new Request(
          `${ROUTER_AB_MPC_ROUTER_ORIGIN}/tenant-root-control-plane/restore/v1/accept-import`,
          {
            method: 'POST',
            redirect: 'manual',
            headers: {
              'content-type': 'application/json',
              [TENANT_ROOT_INTERNAL_SERVICE_AUTH_HEADER_V1]: this.internalServiceAuthSecret,
            },
            body: JSON.stringify({
              restore_grant_b64u: grant.grantB64u,
              manifest_b64u: manifestB64u,
              import_envelope_b64u: input.importEnvelopeB64u,
            }),
          },
        ),
      );
    } catch {
      throw new TenantRootRestoreRoleImportNetworkError();
    }
    if (!response.ok) throw new TenantRootRestoreRoleImportUnavailableError('http_failure');
    const value = await responseJson(response);
    if (
      !isPlainObject(value) ||
      !exactKeys(value, ['role', 'import_key_id', 'envelope_digest_b64u', 'receipt_digest_b64u'])
    ) {
      throw new TenantRootRestoreRoleImportUnavailableError('malformed_response');
    }
    if (
      value.role !== input.operationRecord.role ||
      value.import_key_id !== input.operationRecord.importKeyId ||
      value.envelope_digest_b64u !== envelopeDigestB64u
    ) {
      throw new TenantRootRestoreRoleImportUnavailableError('result_mismatch');
    }
    return {
      receiptDigestB64u: canonicalBase64Url(value.receipt_digest_b64u, 32, 'receipt_digest_b64u'),
    };
  }

  async activate(input: {
    readonly grant: SignedTenantRootRestoreRefreshGrantV1;
    readonly manifestB64u: string;
  }): Promise<TenantRootRestoreActivationResultV1> {
    const manifestB64u = canonicalManifest(input.manifestB64u);
    const grant = await validateActivationGrant(input.grant, manifestB64u);
    let response: Response;
    try {
      response = await this.options.routerFetch.fetch(
        new Request(TENANT_ROOT_RESTORE_ACTIVATION_URL_V1, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            [TENANT_ROOT_INTERNAL_SERVICE_AUTH_HEADER_V1]: this.internalServiceAuthSecret,
          },
          body: JSON.stringify({
            restore_refresh_grant_b64u: grant.grantB64u,
            manifest_b64u: manifestB64u,
          }),
        }),
      );
    } catch {
      throw new TenantRootRestoreActivationNetworkError();
    }
    if (!response.ok) {
      throw new TenantRootRestoreActivationUnavailableError('http_failure');
    }
    let parsed: TenantRootRestoreActivationResultV1;
    try {
      parsed = parseActivationResult(await activationResponseJson(response));
    } catch (error) {
      if (error instanceof TenantRootRestoreActivationUnavailableError) throw error;
      throw new TenantRootRestoreActivationUnavailableError('malformed_response');
    }
    if (parsed.destinationLineageId !== grant.destinationLineageB64u) {
      throw new TenantRootRestoreActivationUnavailableError('scope_mismatch');
    }
    return parsed;
  }

  async cleanupSession(
    input: Parameters<TenantRootRestoreControlPlaneV1['cleanupSession']>[0],
  ): Promise<TenantRootRestoreRoleCleanupV1> {
    const grant = await signTenantRootRestoreCleanupGrantV1({
      destinationIdentityDigestB64u: input.destinationIdentityDigestB64u,
      destinationFingerprintB64u: input.destinationFingerprintB64u,
      destinationLineageB64u: input.destinationLineageB64u,
      restoreSessionIdB64u: input.restoreSessionId,
      nonceB64u: base64UrlEncode(crypto.getRandomValues(new Uint8Array(32))),
      issuedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + 300_000,
      grantKeyId: this.options.grantKeyId,
      signingSeedB64u: this.options.grantSigningSeedB64u,
    });
    let response: Response;
    try {
      response = await this.options.routerFetch.fetch(
        new Request(TENANT_ROOT_RESTORE_CLEANUP_URL_V1, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            [TENANT_ROOT_INTERNAL_SERVICE_AUTH_HEADER_V1]: this.internalServiceAuthSecret,
          },
          body: JSON.stringify({ kind: 'pre_activation', cleanup_grant_b64u: grant.grantB64u }),
        }),
      );
    } catch {
      throw new TenantRootRestoreActivationNetworkError();
    }
    if (!response.ok) throw new TenantRootRestoreActivationUnavailableError('http_failure');
    return parseCleanupRoles(await activationResponseJson(response));
  }

  async cleanupActivatedRoot(input: {
    readonly restoreSessionId: string;
    readonly activationEvidence: TenantRootRestoreActivationEvidenceV1;
    readonly bootstrapCleanup: TenantRootRestoreBootstrapCleanupV1;
    readonly roleCleanup: TenantRootRestoreRoleCleanupV1;
  }): Promise<TenantRootRestoreCleanupEvidenceV1> {
    let response: Response;
    try {
      response = await this.options.routerFetch.fetch(
        new Request(TENANT_ROOT_RESTORE_CLEANUP_URL_V1, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            [TENANT_ROOT_INTERNAL_SERVICE_AUTH_HEADER_V1]: this.internalServiceAuthSecret,
          },
          body: JSON.stringify({
            kind: 'post_activation',
            activation_receipt_b64u: input.activationEvidence.activationReceiptB64u,
            cleanup: cleanupEvidenceWire({
              bootstrap: input.bootstrapCleanup,
              roles: input.roleCleanup,
            }),
          }),
        }),
      );
    } catch {
      throw new TenantRootRestoreActivationNetworkError();
    }
    if (!response.ok) throw new TenantRootRestoreActivationUnavailableError('http_failure');
    try {
      return parseCleanupEvidence(await activationResponseJson(response));
    } catch (error) {
      if (error instanceof TenantRootRestoreActivationUnavailableError) throw error;
      throw new TenantRootRestoreActivationUnavailableError('malformed_response');
    }
  }
}

export function createTenantRootRestoreControlPlaneClientV1(
  options: TenantRootRestoreControlPlaneClientOptionsV1,
): Pick<
  TenantRootRestoreControlPlaneV1,
  | 'issueRoleImportKey'
  | 'acceptRoleImport'
  | 'issueRestoreRefreshGrant'
  | 'activate'
  | 'cleanupActivatedRoot'
  | 'cleanupSession'
> {
  return new TenantRootRestoreControlPlaneClientV1(options);
}
