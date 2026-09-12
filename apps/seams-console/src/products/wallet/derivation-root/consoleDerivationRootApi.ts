import { recoveryBackupConflictMessage } from './derivationRootPresentation';
import {
  buildConsoleAcceptHeaders,
  buildConsoleJsonHeaders,
  consoleErrorMessage,
  fetchConsoleEndpoint,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '@core/dashboard/consoleHttp';
import type {
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootSecurityStatusV1,
} from '@seams-internal/shared-ts/tenant-root';

/**
 * Console client for the Derivation root security page.
 *
 * The page renders the server's exact state branches; it never derives its own
 * booleans from them, so nothing here flattens the response. A custody
 * mutation is an idempotent operation: the caller chooses the key, repeats it
 * to retry, and may be told to wait for a second owner rather than given a
 * result.
 */

const STATUS_PATH = '/console/tenant-root/security/status';
const ROTATION_PATH = '/console/tenant-root/refresh';
const ROTATION_STATUS_PATH = '/console/tenant-root/security/rotation';
const GOVERNANCE_PATH = '/console/tenant-root/security/governance';
const BACKUP_PATH = '/console/tenant-root/security/backup';
const ROLE_PACKAGE_PATH = '/console/tenant-root/security/backup/package';
const MANIFEST_PATH = '/console/tenant-root/security/manifest';

type StatusResponse = {
  readonly ok?: boolean;
  readonly status?: TenantRootSecurityStatusV1;
};

export type DashboardRotationOutcome =
  | {
      readonly kind: 'complete';
      readonly operationId: string;
      readonly receiptDigest: string;
      readonly message?: never;
    }
  | {
      readonly kind: 'retryable';
      readonly operationId: string;
      readonly message: string;
      readonly receiptDigest?: never;
    }
  | {
      readonly kind: 'refused';
      readonly operationId: string;
      readonly message: string;
      readonly receiptDigest?: never;
    };

function responseObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function rotationPost(path: string, body: unknown): Promise<Response> {
  const base = requireConsoleBaseUrl();
  return fetchConsoleEndpoint(
    `${base}${path}`,
    {
      method: 'POST',
      headers: buildConsoleJsonHeaders(),
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify(body),
    },
    { baseUrl: base, path, operation: 'Operational share rotation' },
  );
}

async function stepUpOptions(ceremony: 'registration' | 'assertion'): Promise<Response> {
  return rotationPost(`/console/step-up/webauthn/${ceremony}/options`, {});
}

async function verifyStepUpCredential(
  ceremony: 'registration' | 'assertion',
  credential: Credential | null,
): Promise<void> {
  if (credential === null)
    throw new DOMException('Passkey verification was cancelled.', 'AbortError');
  if (!(credential instanceof PublicKeyCredential))
    throw new Error('The browser returned an invalid passkey credential.');
  const result = await rotationPost(`/console/step-up/webauthn/${ceremony}/verify`, {
    response: JSON.stringify(credential.toJSON()),
    credentialIdB64u: credential.id,
  });
  if (!result.ok) throw new Error('Passkey verification failed. Try again.');
}

async function ceremonyOptions(response: Response): Promise<string> {
  const body: unknown = await parseConsoleJson(response);
  if (
    !response.ok ||
    !responseObject(body) ||
    body.ok !== true ||
    typeof body.options !== 'string'
  ) {
    throw new Error('Could not start passkey verification. Try again.');
  }
  return body.options;
}

export async function verifyCustodyStepUp(): Promise<void> {
  if (
    typeof PublicKeyCredential === 'undefined' ||
    typeof PublicKeyCredential.parseRequestOptionsFromJSON !== 'function'
  ) {
    throw new Error('Use a browser that supports passkey verification.');
  }
  let assertion = await stepUpOptions('assertion');
  if (assertion.status === 409) {
    const refusal: unknown = await parseConsoleJson(assertion);
    if (!responseObject(refusal) || refusal.code !== 'no_credential_registered') {
      throw new Error('Could not start passkey verification. Try again.');
    }
    const options = PublicKeyCredential.parseCreationOptionsFromJSON(
      JSON.parse(await ceremonyOptions(await stepUpOptions('registration'))),
    );
    await verifyStepUpCredential(
      'registration',
      await navigator.credentials.create({ publicKey: options }),
    );
    assertion = await stepUpOptions('assertion');
  }
  const options = PublicKeyCredential.parseRequestOptionsFromJSON(
    JSON.parse(await ceremonyOptions(assertion)),
  );
  await verifyStepUpCredential(
    'assertion',
    await navigator.credentials.get({ publicKey: options }),
  );
}

function rotationOutcome(body: unknown, operationId: string): DashboardRotationOutcome {
  if (!responseObject(body))
    throw new Error('The rotation outcome is unknown. Retry the same operation.');
  if (
    body.ok === true &&
    body.status === 'ACTIVE' &&
    typeof body.activationReceiptDigestB64u === 'string'
  ) {
    return { kind: 'complete', operationId, receiptDigest: body.activationReceiptDigestB64u };
  }
  if (body.code === 'dispatch_uncertain' || body.code === 'tenant_root_refresh_in_progress') {
    return {
      kind: 'retryable',
      operationId,
      message:
        body.code === 'dispatch_uncertain'
          ? 'The rotation outcome is unknown. Retry to resume this operation.'
          : 'Another rotation holds the lock. Retry this operation after it finishes.',
    };
  }
  if (body.code === 'tenant_root_refresh_throttled' && typeof body.retryAtMs === 'number') {
    return {
      kind: 'refused',
      operationId,
      message: `You can rotate shares again after ${new Date(body.retryAtMs).toLocaleString()}.`,
    };
  }
  return {
    kind: 'refused',
    operationId,
    message:
      typeof body.message === 'string'
        ? body.message
        : 'Rotation was refused. Start a new request.',
  };
}

export async function readOperationalShareRotation(
  operationId: string,
): Promise<DashboardRotationOutcome> {
  const base = requireConsoleBaseUrl();
  const response = await fetchConsoleEndpoint(
    `${base}${ROTATION_STATUS_PATH}?operationId=${encodeURIComponent(operationId)}`,
    {
      method: 'GET',
      headers: buildConsoleAcceptHeaders(),
      credentials: 'include',
      cache: 'no-store',
    },
    { baseUrl: base, path: ROTATION_STATUS_PATH, operation: 'Rotation status' },
  );
  const body: unknown = await parseConsoleJson(response);
  if (!response.ok || !responseObject(body) || body.ok !== true)
    throw new Error('Could not read rotation progress. Retry to resume.');
  if (body.operation === null)
    return {
      kind: 'retryable',
      operationId,
      message: 'This rotation has not been recorded. Retry to submit it.',
    };
  const operation = body.operation;
  if (!responseObject(operation)) throw new Error('Could not read rotation progress.');
  if (operation.status === 'accepted')
    return rotationOutcome(operation.acceptedResult, operationId);
  if (operation.status === 'failed' || operation.status === 'authorization_expired') {
    return {
      kind: 'refused',
      operationId,
      message: `Rotation ended: ${String(operation.failureCode ?? operation.status)}. Start a new request.`,
    };
  }
  if (operation.status === 'pending')
    return {
      kind: 'retryable',
      operationId,
      message: 'Rotation is pending. Retry to resume this operation.',
    };
  throw new Error('The server returned an unknown rotation state.');
}

/** Reads the derivation-root security state for the selected environment. */
export type DashboardDerivationRootStatus =
  | {
      readonly kind: 'active';
      readonly status: TenantRootSecurityStatusV1;
      readonly recoveryDownloadAccess: { readonly deriverA: boolean; readonly deriverB: boolean };
      readonly recoveryEnrollment: 'pending' | 'ready_to_commit' | 'committed';
    }
  | { readonly kind: 'not_provisioned'; readonly status?: never };

export async function readDerivationRootSecurityStatus(): Promise<DashboardDerivationRootStatus> {
  const base = requireConsoleBaseUrl();
  const response = await fetchConsoleEndpoint(
    `${base}${STATUS_PATH}`,
    {
      method: 'GET',
      headers: buildConsoleAcceptHeaders(),
      credentials: 'include',
      cache: 'no-store',
    },
    { baseUrl: base, path: STATUS_PATH, operation: 'Derivation root status request' },
  );
  const raw: unknown = await parseConsoleJson(response);
  if (response.status === 404 && responseObject(raw) && raw.code === 'tenant_root_not_active') {
    return { kind: 'not_provisioned' };
  }
  const body = raw as StatusResponse | null;
  if (!response.ok || body?.ok !== true || !body.status) {
    throw new Error(consoleErrorMessage(response, body, 'Derivation root status request failed'));
  }
  if (
    !responseObject(raw) ||
    (raw.recoveryEnrollment !== 'pending' &&
      raw.recoveryEnrollment !== 'ready_to_commit' &&
      raw.recoveryEnrollment !== 'committed')
  )
    throw new Error(
      'Recovery enrollment status is unavailable. Refresh after deployment completes.',
    );
  const access = raw.recoveryDownloadAccess;
  if (
    !responseObject(access) ||
    typeof access.deriverA !== 'boolean' ||
    typeof access.deriverB !== 'boolean'
  ) {
    throw new Error('Recovery download access is unavailable. Refresh and try again.');
  }
  return {
    kind: 'active',
    status: body.status,
    recoveryEnrollment: raw.recoveryEnrollment,
    recoveryDownloadAccess: { deriverA: access.deriverA, deriverB: access.deriverB },
  };
}

/** Submits or resumes one operation, verifying the console passkey when required. */
export async function startOperationalShareRotation(input: {
  readonly operationId: string;
}): Promise<DashboardRotationOutcome> {
  let response = await rotationPost(ROTATION_PATH, { operationId: input.operationId });
  let body: unknown = await parseConsoleJson(response);
  if (response.status === 403 && responseObject(body) && body.code === 'step_up_required') {
    await verifyCustodyStepUp();
    response = await rotationPost(ROTATION_PATH, { operationId: input.operationId });
    body = await parseConsoleJson(response);
  }
  if (response.status >= 500 && !(responseObject(body) && body.code === 'dispatch_uncertain')) {
    throw new Error('The rotation outcome is unknown. Retry to resume this operation.');
  }
  return rotationOutcome(body, input.operationId);
}

/**
 * What the tenant chooses for recovery governance.
 *
 * Who chose it and when are the server's to record from the authenticated
 * session and its own clock; the browser never asserts an owner identity.
 */
export type DashboardRecoveryGovernanceChoice =
  | { readonly kind: 'single_owner_v1'; readonly acknowledgeWarning: true }
  | { readonly kind: 'two_person_v1' };

/**
 * How one custody mutation ended.
 *
 * Under two-person governance the first owner's request does not take
 * effect: it is recorded, and the same idempotency key must be presented
 * again after a second owner approves the named operation digest.
 */
export type DashboardCustodyOutcome<T> =
  | {
      readonly kind: 'accepted';
      readonly value: T;
      readonly operationId: string;
      readonly replayed: boolean;
    }
  | {
      readonly kind: 'approval_pending';
      readonly operationDigestB64u: string;
      readonly expiresAt: string;
    };

type CustodyResponse = {
  readonly ok?: boolean;
  readonly code?: string;
  readonly replayed?: boolean;
  readonly operationId?: string;
  readonly result?: unknown;
  readonly operationDigestB64u?: string;
  readonly expiresAt?: string;
};

async function custodyMutation<T>(input: {
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly operation: string;
  readonly parseResult: (value: unknown) => T | null;
}): Promise<DashboardCustodyOutcome<T>> {
  let response = await rotationPost(input.path, input.body);
  let raw: unknown = await parseConsoleJson(response);
  if (response.status === 403 && responseObject(raw) && raw.code === 'step_up_required') {
    await verifyCustodyStepUp();
    response = await rotationPost(input.path, input.body);
    raw = await parseConsoleJson(response);
  }
  const body = raw as CustodyResponse | null;
  if (
    response.status === 202 &&
    body?.code === 'approval_required' &&
    typeof body.operationDigestB64u === 'string' &&
    typeof body.expiresAt === 'string'
  ) {
    return {
      kind: 'approval_pending',
      operationDigestB64u: body.operationDigestB64u,
      expiresAt: body.expiresAt,
    };
  }
  if (!response.ok || body?.ok !== true || typeof body.operationId !== 'string') {
    if (input.path === BACKUP_PATH && response.status === 409 && responseObject(raw)) {
      const code = typeof raw.failureCode === 'string' ? raw.failureCode : raw.code;
      if (typeof code === 'string') {
        throw new Error(`${recoveryBackupConflictMessage(code)} (409: ${code})`);
      }
    }
    throw new Error(consoleErrorMessage(response, body, `${input.operation} failed`));
  }
  const value = input.parseResult(body.result);
  if (value === null) {
    throw new Error(`${input.operation} returned an unexpected result`);
  }
  return {
    kind: 'accepted',
    value,
    operationId: body.operationId,
    replayed: body.replayed === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Installs one recovery governance branch, or records the request for approval. */
export async function setRecoveryGovernance(input: {
  readonly choice: DashboardRecoveryGovernanceChoice;
  readonly idempotencyKey: string;
}): Promise<DashboardCustodyOutcome<TenantRootRecoveryGovernanceV1>> {
  return await custodyMutation({
    path: GOVERNANCE_PATH,
    body: { governance: input.choice, idempotencyKey: input.idempotencyKey },
    operation: 'Recovery governance request',
    parseResult: (value) =>
      isRecord(value) && (value.kind === 'single_owner_v1' || value.kind === 'two_person_v1')
        ? (value as unknown as TenantRootRecoveryGovernanceV1)
        : null,
  });
}

/** Creates or replaces the recovery backup, or records the request for approval. */
export async function createRecoveryBackup(input: {
  readonly idempotencyKey: string;
}): Promise<DashboardCustodyOutcome<TenantRootRecoveryBackupV1>> {
  return await custodyMutation({
    path: BACKUP_PATH,
    body: { idempotencyKey: input.idempotencyKey },
    operation: 'Recovery backup request',
    parseResult: (value) =>
      isRecord(value) && typeof value.status === 'string'
        ? (value as unknown as TenantRootRecoveryBackupV1)
        : null,
  });
}

/** One downloaded artifact, still ciphertext to the browser. */
export interface DashboardRecoveryArtifact {
  readonly bytes: Uint8Array;
  readonly contentDigestB64u: string;
  readonly filename: string;
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Downloads one role package or the manifest.
 *
 * Each call handles one artifact. The browser never receives both role
 * packages in one response, and this deployment records the result as issued
 * rather than durable: only the CLI can say a file reached disk.
 */
async function requestRecoveryArtifact(
  artifact: 'deriver_a_package' | 'deriver_b_package' | 'manifest',
): Promise<Response> {
  const base = requireConsoleBaseUrl();
  const isManifest = artifact === 'manifest';
  const path = isManifest ? MANIFEST_PATH : ROLE_PACKAGE_PATH;
  return fetchConsoleEndpoint(
    `${base}${path}`,
    {
      method: isManifest ? 'GET' : 'POST',
      headers: isManifest ? buildConsoleAcceptHeaders() : buildConsoleJsonHeaders(),
      credentials: 'include',
      cache: 'no-store',
      ...(isManifest
        ? {}
        : {
            body: JSON.stringify({
              role: artifact === 'deriver_a_package' ? 'deriver_a' : 'deriver_b',
            }),
          }),
    },
    { baseUrl: base, path, operation: 'Recovery artifact download' },
  );
}

export async function downloadRecoveryArtifact(input: {
  readonly artifact: 'deriver_a_package' | 'deriver_b_package' | 'manifest';
  readonly environmentKey: string;
  readonly recoverySetId: string;
}): Promise<DashboardRecoveryArtifact> {
  const isManifest = input.artifact === 'manifest';
  let response = await requestRecoveryArtifact(input.artifact);
  let raw: unknown = await parseConsoleJson(response);
  if (response.status === 403 && responseObject(raw) && raw.code === 'step_up_required') {
    await verifyCustodyStepUp();
    response = await requestRecoveryArtifact(input.artifact);
    raw = await parseConsoleJson(response);
  }
  const body = raw;
  if (
    !response.ok ||
    !responseObject(body) ||
    body.ok !== true ||
    typeof body.artifactB64u !== 'string' ||
    typeof body.contentDigestB64u !== 'string'
  ) {
    throw new Error(consoleErrorMessage(response, body, 'Recovery artifact download failed'));
  }
  if (body.recoverySetId !== input.recoverySetId) {
    throw new Error(
      'The recovery backup changed during download. Refresh backup status and download the ZIP again.',
    );
  }
  const suffix = isManifest
    ? 'manifest.json'
    : `${input.artifact === 'deriver_a_package' ? 'deriver-a' : 'deriver-b'}.backup`;
  return {
    bytes: decodeBase64Url(body.artifactB64u),
    contentDigestB64u: body.contentDigestB64u,
    filename: `seams-${input.environmentKey}-${input.recoverySetId}-${suffix}`,
  };
}

export async function createDerivationRoot(operationId: string): Promise<void> {
  const base = requireConsoleBaseUrl();
  const path = '/console/tenant-root/creation';
  const response = await fetchConsoleEndpoint(
    `${base}${path}`,
    {
      method: 'POST',
      headers: buildConsoleJsonHeaders(),
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify({ operationId }),
    },
    { baseUrl: base, path, operation: 'Create derivation root' },
  );
  const body: unknown = await parseConsoleJson(response);
  if (!response.ok || !responseObject(body) || body.ok !== true || body.status !== 'ACTIVE') {
    throw new Error(
      consoleErrorMessage(
        response,
        body,
        'Could not confirm creation. Retry to resume the same operation.',
      ),
    );
  }
}

function parseCommittedPair(value: unknown): true | null {
  return isRecord(value) &&
    typeof value.deriverAFingerprintB64u === 'string' &&
    typeof value.deriverBFingerprintB64u === 'string'
    ? true
    : null;
}
export async function commitRecoveryKeys(input: {
  readonly idempotencyKey: string;
}): Promise<DashboardCustodyOutcome<true>> {
  return custodyMutation({
    path: '/console/tenant-root/security/recipients/commit',
    body: input,
    operation: 'Recovery key commitment',
    parseResult: parseCommittedPair,
  });
}
