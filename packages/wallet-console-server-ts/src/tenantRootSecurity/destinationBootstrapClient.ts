import { base64UrlDecode, base64UrlEncode } from '@seams/wallet-server/cloud-host';
import {
  encodeTenantRootIdentityV1,
  type TenantRootIdentityV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import { ROUTER_AB_MPC_ROUTER_ORIGIN } from '@seams/wallet-server/cloud-host';
import type { TenantRootBootstrapAuthenticatorV1 } from './restoreRoute';
import type { TenantRootDestinationStateV1 } from './restoreService';

const DESTINATION_BOOTSTRAP_PATH_V1 =
  '/router-ab/internal/tenant-root/destination-bootstrap/v1/read-auth';
const DESTINATION_BOOTSTRAP_URL_V1 = `${ROUTER_AB_MPC_ROUTER_ORIGIN}${DESTINATION_BOOTSTRAP_PATH_V1}`;
const DESTINATION_BOOTSTRAP_TOKEN_HEADER_V1 = 'x-seams-destination-bootstrap-token-v1';
const DESTINATION_BOOTSTRAP_LINEAGE_BYTES_V1 = 16;
const DESTINATION_BOOTSTRAP_FINGERPRINT_BYTES_V1 = 32;

type DestinationBootstrapReadRequestV1 = {
  readonly kind: 'read';
  readonly identity_b64u: string;
  readonly custody_lineage_b64u: string;
};

type DestinationBootstrapAuthenticateRequestV1 = {
  readonly kind: 'authenticate';
  readonly identity_b64u: string;
  readonly deployment_fingerprint_b64u: string;
  readonly custody_lineage_b64u: string;
};

type DestinationBootstrapRequestV1 =
  | DestinationBootstrapReadRequestV1
  | DestinationBootstrapAuthenticateRequestV1;

type DestinationBootstrapTransportInputV1 =
  | { readonly request: DestinationBootstrapReadRequestV1; readonly token?: never }
  | { readonly request: DestinationBootstrapAuthenticateRequestV1; readonly token: string };

type DestinationBootstrapRefusalV1 =
  | 'uninitialized'
  | 'creation_in_progress'
  | 'active_root_present'
  | 'destroyed'
  | 'scope_mismatch'
  | 'authentication_failed';

type DestinationBootstrapScopeV1 = {
  readonly identity_b64u: string;
  readonly identity_digest_b64u: string;
  readonly deployment_fingerprint_b64u: string;
  readonly custody_lineage_b64u: string;
};

type DestinationBootstrapResponseV1 =
  | {
      readonly kind: 'read_ready';
      readonly scope: DestinationBootstrapScopeV1;
    }
  | {
      readonly kind: 'read_refused';
      readonly reason: DestinationBootstrapRefusalV1;
    }
  | {
      readonly kind: 'authenticated';
      readonly scope: DestinationBootstrapScopeV1;
      readonly authenticated_at_ms: number;
    }
  | {
      readonly kind: 'authentication_refused';
      readonly reason: DestinationBootstrapRefusalV1;
    };

type RouterFetchV1 = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export interface TenantRootDestinationBootstrapClientOptionsV1 {
  readonly routerFetch: RouterFetchV1;
  readonly internalServiceAuthSecret: string;
  readonly identity: TenantRootIdentityV1;
  readonly custodyLineageB64u: string;
}

export class TenantRootDestinationBootstrapNetworkError extends Error {
  readonly code = 'tenant_root_destination_bootstrap_network_failure';

  constructor() {
    super('Destination bootstrap Router request failed before a response was received');
    this.name = 'TenantRootDestinationBootstrapNetworkError';
  }
}

export class TenantRootDestinationBootstrapUnavailableError extends Error {
  readonly code = 'tenant_root_destination_bootstrap_unavailable';
  readonly reason: 'http_failure' | 'malformed_response' | 'scope_mismatch' | 'state_refused';

  constructor(reason: 'http_failure' | 'malformed_response' | 'scope_mismatch' | 'state_refused') {
    super(`Destination bootstrap Router response is unavailable (${reason})`);
    this.name = 'TenantRootDestinationBootstrapUnavailableError';
    this.reason = reason;
  }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function canonicalBase64Url(value: string, maxBytes: number, label: string): string {
  requiredText(value, label);
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`${label} is invalid`);
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (decoded.length === 0 || decoded.length > maxBytes || base64UrlEncode(decoded) !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function exactBase64UrlBytes(value: string, expectedLength: number, label: string): string {
  const canonical = canonicalBase64Url(value, expectedLength, label);
  const decoded = base64UrlDecode(canonical);
  if (decoded.length !== expectedLength || decoded.every((byte) => byte === 0)) {
    throw new Error(`${label} is invalid`);
  }
  return canonical;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function parseRefusal(value: unknown): DestinationBootstrapRefusalV1 | null {
  switch (value) {
    case 'uninitialized':
    case 'creation_in_progress':
    case 'active_root_present':
    case 'destroyed':
    case 'scope_mismatch':
    case 'authentication_failed':
      return value;
    default:
      return null;
  }
}

function parseScope(value: unknown): DestinationBootstrapScopeV1 | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'identity_b64u',
      'identity_digest_b64u',
      'deployment_fingerprint_b64u',
      'custody_lineage_b64u',
    ])
  ) {
    return null;
  }
  if (
    typeof value.identity_b64u !== 'string' ||
    typeof value.identity_digest_b64u !== 'string' ||
    typeof value.deployment_fingerprint_b64u !== 'string' ||
    typeof value.custody_lineage_b64u !== 'string'
  ) {
    return null;
  }
  try {
    return {
      identity_b64u: canonicalBase64Url(
        value.identity_b64u,
        8 * 1024,
        'destination bootstrap identity',
      ),
      identity_digest_b64u: exactBase64UrlBytes(
        value.identity_digest_b64u,
        32,
        'destination bootstrap identity digest',
      ),
      deployment_fingerprint_b64u: exactBase64UrlBytes(
        value.deployment_fingerprint_b64u,
        DESTINATION_BOOTSTRAP_FINGERPRINT_BYTES_V1,
        'destination bootstrap deployment fingerprint',
      ),
      custody_lineage_b64u: exactBase64UrlBytes(
        value.custody_lineage_b64u,
        DESTINATION_BOOTSTRAP_LINEAGE_BYTES_V1,
        'destination bootstrap custody lineage',
      ),
    };
  } catch {
    return null;
  }
}

function parseDestinationBootstrapResponse(value: unknown): DestinationBootstrapResponseV1 | null {
  if (!isPlainObject(value) || typeof value.kind !== 'string') return null;
  switch (value.kind) {
    case 'read_ready': {
      if (!hasExactKeys(value, ['kind', 'scope'])) return null;
      const scope = parseScope(value.scope);
      return scope === null ? null : { kind: value.kind, scope };
    }
    case 'read_refused': {
      if (!hasExactKeys(value, ['kind', 'reason'])) return null;
      const reason = parseRefusal(value.reason);
      return reason === null ? null : { kind: value.kind, reason };
    }
    case 'authenticated': {
      if (!hasExactKeys(value, ['kind', 'scope', 'authenticated_at_ms'])) return null;
      const scope = parseScope(value.scope);
      const authenticatedAtMs = value.authenticated_at_ms;
      if (
        scope === null ||
        typeof authenticatedAtMs !== 'number' ||
        !Number.isSafeInteger(authenticatedAtMs) ||
        authenticatedAtMs <= 0
      ) {
        return null;
      }
      return { kind: value.kind, scope, authenticated_at_ms: authenticatedAtMs };
    }
    case 'authentication_refused': {
      if (!hasExactKeys(value, ['kind', 'reason'])) return null;
      const reason = parseRefusal(value.reason);
      return reason === null ? null : { kind: value.kind, reason };
    }
    default:
      return null;
  }
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TenantRootDestinationBootstrapUnavailableError('malformed_response');
  }
}

function actorUserIdForFingerprint(deploymentFingerprintB64u: string): string {
  return `destination-bootstrap:${deploymentFingerprintB64u}`;
}

class DestinationBootstrapClientV1 implements TenantRootBootstrapAuthenticatorV1 {
  private readonly identityB64u: string;
  private readonly internalServiceAuthSecret: string;
  private readonly custodyLineageB64u: string;

  constructor(private readonly options: TenantRootDestinationBootstrapClientOptionsV1) {
    this.identityB64u = base64UrlEncode(encodeTenantRootIdentityV1(options.identity));
    this.internalServiceAuthSecret = requiredText(
      options.internalServiceAuthSecret,
      'internalServiceAuthSecret',
    );
    this.custodyLineageB64u = exactBase64UrlBytes(
      options.custodyLineageB64u,
      DESTINATION_BOOTSTRAP_LINEAGE_BYTES_V1,
      'custodyLineageB64u',
    );
  }

  async readDestination(): Promise<TenantRootDestinationStateV1> {
    const response = await this.post({
      request: {
        kind: 'read',
        identity_b64u: this.identityB64u,
        custody_lineage_b64u: this.custodyLineageB64u,
      },
    });
    switch (response.kind) {
      case 'read_ready': {
        const scope = await this.requireScope(response.scope);
        return { kind: 'empty', deploymentFingerprintB64u: scope.deployment_fingerprint_b64u };
      }
      case 'read_refused':
        if (response.reason === 'active_root_present' || response.reason === 'destroyed')
          return { kind: 'active_root_present' };
        throw new TenantRootDestinationBootstrapUnavailableError('state_refused');
      case 'authenticated':
      case 'authentication_refused':
        throw new TenantRootDestinationBootstrapUnavailableError('malformed_response');
      default: {
        const exhaustive: never = response;
        void exhaustive;
        throw new TenantRootDestinationBootstrapUnavailableError('malformed_response');
      }
    }
  }

  async authenticate(input: {
    readonly token: string;
  }): Promise<{ readonly ok: true; readonly actorUserId: string } | { readonly ok: false }> {
    if (
      typeof input.token !== 'string' ||
      input.token.length === 0 ||
      input.token.trim() !== input.token
    ) {
      return { ok: false };
    }
    const destination = await this.readDestination();
    if (destination.kind !== 'empty') return { ok: false };
    const response = await this.post({
      request: {
        kind: 'authenticate',
        identity_b64u: this.identityB64u,
        deployment_fingerprint_b64u: destination.deploymentFingerprintB64u,
        custody_lineage_b64u: this.custodyLineageB64u,
      },
      token: input.token,
    });
    switch (response.kind) {
      case 'authentication_refused':
        return { ok: false };
      case 'authenticated': {
        const scope = await this.requireScope(response.scope);
        if (scope.deployment_fingerprint_b64u !== destination.deploymentFingerprintB64u) {
          throw new TenantRootDestinationBootstrapUnavailableError('scope_mismatch');
        }
        return {
          ok: true,
          actorUserId: actorUserIdForFingerprint(scope.deployment_fingerprint_b64u),
        };
      }
      case 'read_ready':
      case 'read_refused':
        throw new TenantRootDestinationBootstrapUnavailableError('malformed_response');
      default: {
        const exhaustive: never = response;
        void exhaustive;
        throw new TenantRootDestinationBootstrapUnavailableError('malformed_response');
      }
    }
  }

  private async requireScope(
    scope: DestinationBootstrapScopeV1,
  ): Promise<DestinationBootstrapScopeV1> {
    const identityDigestB64u = await tenantRootIdentityDigestB64uV1(this.options.identity);
    if (
      scope.identity_b64u !== this.identityB64u ||
      scope.identity_digest_b64u !== identityDigestB64u ||
      scope.custody_lineage_b64u !== this.custodyLineageB64u
    ) {
      throw new TenantRootDestinationBootstrapUnavailableError('scope_mismatch');
    }
    return scope;
  }

  private async post(
    input: DestinationBootstrapTransportInputV1,
  ): Promise<DestinationBootstrapResponseV1> {
    const request: DestinationBootstrapRequestV1 = input.request;
    const token = request.kind === 'authenticate' ? input.token : undefined;
    const headers = new Headers({
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': this.internalServiceAuthSecret,
    });
    if (token !== undefined) headers.set(DESTINATION_BOOTSTRAP_TOKEN_HEADER_V1, token);
    let response: Response;
    try {
      response = await this.options.routerFetch.fetch(DESTINATION_BOOTSTRAP_URL_V1, {
        method: 'POST',
        redirect: 'manual',
        headers,
        body: JSON.stringify(request),
      });
    } catch {
      throw new TenantRootDestinationBootstrapNetworkError();
    }
    if (!response.ok) {
      throw new TenantRootDestinationBootstrapUnavailableError('http_failure');
    }
    const body = await readResponseJson(response);
    const parsed = parseDestinationBootstrapResponse(body);
    if (parsed === null) {
      throw new TenantRootDestinationBootstrapUnavailableError('malformed_response');
    }
    return parsed;
  }
}

export function createTenantRootDestinationBootstrapClientV1(
  options: TenantRootDestinationBootstrapClientOptionsV1,
): TenantRootDestinationBootstrapClientV1 {
  return new DestinationBootstrapClientV1(options);
}

export type TenantRootDestinationBootstrapClientV1 = TenantRootBootstrapAuthenticatorV1 & {
  readDestination(): Promise<TenantRootDestinationStateV1>;
};
