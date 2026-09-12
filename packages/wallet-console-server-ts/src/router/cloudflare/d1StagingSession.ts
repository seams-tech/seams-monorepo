import {
  base64UrlDecode,
  base64UrlEncode,
  CrossSiteSessionCookieAdapter,
  encodeSessionJsonSegment,
  normalizeSessionString,
  normalizeSessionTtlSeconds,
  parseSessionJwt,
  sessionJwtTimeClaims,
  toSessionArrayBufferCopy,
} from '@seams/wallet-server/cloud-host';
import { ConsoleSessionService } from '@seams-internal/console-server/boundary/session';
import type {
  ActiveOrganizationAuthorization,
  ConsoleOrganizationAccessService,
} from '@seams-internal/console-server/teamRbac/index';
import type {
  ConsoleAuthAdapter,
  ConsoleAuthAdapterResult,
  HeaderRecord,
} from '@seams-internal/console-server/router/consoleAuth';
import type { SessionAdapter } from '@seams/wallet-server/cloud-host';
import { readEnvironmentCsv, requireEnvironmentString } from '@seams/wallet-server/cloud-host';

export type CloudflareD1StagingSessionEnv = Readonly<Record<string, unknown>>;

export interface HmacSessionAdapterOptions {
  readonly secret: string;
  readonly cookieName?: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly ttlSeconds?: number;
}

export interface HmacSessionEnvOptions {
  readonly env: CloudflareD1StagingSessionEnv;
  readonly secretName: string;
  readonly cookieName?: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly ttlSeconds?: number;
}

export interface ConsoleSessionAuthAdapterOptions {
  readonly session: SessionAdapter;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly platformSupportEmails?: string;
}

type HmacVerificationResult =
  | { readonly valid: true; readonly payload: Record<string, unknown> }
  | { readonly valid: false };

class HmacSessionJwtAdapter {
  private readonly secretBytes: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly ttlSeconds: number;

  constructor(options: HmacSessionAdapterOptions) {
    this.secretBytes = encodeRequiredSecret(options.secret);
    this.issuer = normalizeSessionString(options.issuer);
    this.audience = normalizeSessionString(options.audience);
    this.ttlSeconds = normalizeSessionTtlSeconds(options.ttlSeconds);
  }

  async signToken(input: {
    readonly header: Record<string, unknown>;
    readonly payload: Record<string, unknown>;
  }): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const timeClaims = sessionJwtTimeClaims(input.payload, nowSeconds, this.ttlSeconds);
    const headerB64u = encodeSessionJsonSegment({
      ...input.header,
      typ: 'JWT',
      alg: 'HS256',
    });
    const payloadB64u = encodeSessionJsonSegment({
      ...input.payload,
      ...timeClaims,
      ...(this.issuer ? { iss: this.issuer } : {}),
      ...(this.audience ? { aud: this.audience } : {}),
    });
    const signingInput = `${headerB64u}.${payloadB64u}`;
    const signature = await this.signUtf8(signingInput);
    return `${signingInput}.${base64UrlEncode(signature)}`;
  }

  async verifyToken(
    token: string,
  ): Promise<{ readonly valid: boolean; readonly payload?: unknown }> {
    const verified = await this.verify(token);
    if (!verified.valid) return { valid: false };
    return { valid: true, payload: verified.payload };
  }

  private async verify(token: string): Promise<HmacVerificationResult> {
    const parsed = parseSessionJwt(token);
    if (!parsed.ok) return { valid: false };
    if (normalizeSessionString(parsed.header.alg) !== 'HS256') return { valid: false };
    if (!this.payloadMatchesConfiguredAudience(parsed.payload)) return { valid: false };
    if (!this.payloadMatchesConfiguredIssuer(parsed.payload)) return { valid: false };
    let signature: Uint8Array;
    try {
      signature = base64UrlDecode(parsed.signatureB64u);
    } catch {
      return { valid: false };
    }
    const signingInput = `${parsed.headerB64u}.${parsed.payloadB64u}`;
    const expected = await this.signUtf8(signingInput);
    if (!constantTimeEqual(signature, expected)) return { valid: false };
    return { valid: true, payload: parsed.payload };
  }

  private payloadMatchesConfiguredIssuer(payload: Record<string, unknown>): boolean {
    if (!this.issuer) return true;
    return normalizeSessionString(payload.iss) === this.issuer;
  }

  private payloadMatchesConfiguredAudience(payload: Record<string, unknown>): boolean {
    if (!this.audience) return true;
    const aud = payload.aud;
    if (typeof aud === 'string') return aud === this.audience;
    if (!Array.isArray(aud)) return false;
    for (const item of aud) {
      if (item === this.audience) return true;
    }
    return false;
  }

  private async signUtf8(value: string): Promise<Uint8Array> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('WebCrypto crypto.subtle is required for staging sessions');
    const key = await subtle.importKey(
      'raw',
      toSessionArrayBufferCopy(this.secretBytes),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await subtle.sign('HMAC', key, new TextEncoder().encode(value));
    return new Uint8Array(signature);
  }
}

class ConsoleSessionAuthAdapter implements ConsoleAuthAdapter {
  private readonly session: SessionAdapter;
  private readonly organizationAccess: ConsoleOrganizationAccessService;
  private readonly platformSupportEmails: readonly string[];

  constructor(options: ConsoleSessionAuthAdapterOptions) {
    this.session = options.session;
    this.organizationAccess = options.organizationAccess;
    this.platformSupportEmails = normalizeEmailList(options.platformSupportEmails);
  }

  async authenticate(headers: HeaderRecord): Promise<ConsoleAuthAdapterResult> {
    const parsed = await this.session.parse(headers);
    if (!parsed.ok) {
      return {
        ok: false,
        code: 'unauthorized',
        message: 'Missing or invalid console session',
        status: 401,
      };
    }

    const claims = parsed.claims;
    if (normalizeSessionString(claims.kind) !== 'console_session_v1') {
      return {
        ok: false,
        code: 'unauthorized',
        message: 'Invalid console session kind',
        status: 401,
      };
    }

    const userId = normalizeSessionString(claims.sub);
    const orgId = normalizeSessionString(claims.orgId);
    if (!userId || !orgId) {
      return {
        ok: false,
        code: 'unauthorized',
        message: 'Console session requires sub and orgId',
        status: 401,
      };
    }

    const authorization = await this.organizationAccess.lookupAuthorization({ orgId, userId });
    if (!authorization || authorization.kind === 'denied') {
      return {
        ok: false,
        code: 'forbidden',
        message: 'No active organization membership',
        status: 403,
      };
    }

    const claimedProjectId = normalizeSessionString(claims.projectId);
    const projectId =
      authorization.role === 'MEMBER'
        ? resolveMemberProjectId(authorization, claimedProjectId)
        : claimedProjectId;
    const claimedEnvironmentId = normalizeSessionString(claims.environmentId);
    const environmentId =
      authorization.role === 'MEMBER' && projectId !== claimedProjectId ? '' : claimedEnvironmentId;
    const email = normalizeSessionString(claims.email).toLowerCase();
    const identity = {
      userId,
      orgId,
      platformSupport: this.platformSupportEmails.includes(email),
      ...(projectId ? { projectId } : {}),
      ...(environmentId ? { environmentId } : {}),
      ...(email ? { email } : {}),
      ...(normalizeSessionString(claims.name) ? { name: normalizeSessionString(claims.name) } : {}),
      ...(normalizeSessionString(claims.provider)
        ? { provider: normalizeSessionString(claims.provider) }
        : {}),
    };
    switch (authorization.role) {
      case 'OWNER':
        return {
          ok: true,
          claims: {
            ...identity,
            membershipId: authorization.membershipId,
            authorizationVersion: authorization.authorizationVersion,
            role: 'OWNER',
            adminPermissions: [...authorization.adminPermissions],
            projectAccess: { kind: 'all' },
          },
        };
      case 'ADMIN':
        return {
          ok: true,
          claims: {
            ...identity,
            membershipId: authorization.membershipId,
            authorizationVersion: authorization.authorizationVersion,
            role: 'ADMIN',
            adminPermissions: [...authorization.adminPermissions],
            projectAccess: { kind: 'all' },
          },
        };
      case 'MEMBER':
        return {
          ok: true,
          claims: {
            ...identity,
            membershipId: authorization.membershipId,
            authorizationVersion: authorization.authorizationVersion,
            role: 'MEMBER',
            adminPermissions: [],
            projectAccess: {
              kind: 'assigned',
              assignments: authorization.projectAccess.assignments.map((assignment) => ({
                projectId: assignment.projectId,
                accessLevel: assignment.accessLevel,
              })),
            },
          },
        };
    }
  }
}

export function createHmacSessionAdapter(options: HmacSessionAdapterOptions): SessionAdapter {
  const jwt = new HmacSessionJwtAdapter(options);
  const cookieName = normalizeSessionString(options.cookieName) || 'seams-jwt';
  const cookie = new CrossSiteSessionCookieAdapter(
    cookieName,
    normalizeSessionTtlSeconds(options.ttlSeconds),
  );
  return new ConsoleSessionService({
    jwt: {
      signToken: jwt.signToken.bind(jwt),
      verifyToken: jwt.verifyToken.bind(jwt),
    },
    cookie: {
      name: cookieName,
      buildSetHeader: cookie.buildSetHeader.bind(cookie),
      buildClearHeader: cookie.buildClearHeader.bind(cookie),
    },
  });
}

export function createHmacSessionAdapterFromEnv(options: HmacSessionEnvOptions): SessionAdapter {
  return createHmacSessionAdapter({
    secret: requireEnvironmentString(options.env, options.secretName),
    cookieName: options.cookieName,
    issuer: options.issuer,
    audience: options.audience,
    ttlSeconds: options.ttlSeconds,
  });
}

export function createConsoleSessionAuthAdapter(
  options: ConsoleSessionAuthAdapterOptions,
): ConsoleAuthAdapter {
  return new ConsoleSessionAuthAdapter(options);
}

function encodeRequiredSecret(secret: string): Uint8Array {
  const value = normalizeSessionString(secret);
  if (value.length < 32) {
    throw new Error('staging session HMAC secret must be at least 32 characters');
  }
  return new TextEncoder().encode(value);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }
  return diff === 0;
}

function resolveMemberProjectId(
  authorization: Extract<ActiveOrganizationAuthorization, { readonly role: 'MEMBER' }>,
  requestedProjectId: string,
): string {
  if (
    requestedProjectId &&
    authorization.projectAccess.assignments.some(
      (assignment) => assignment.projectId === requestedProjectId,
    )
  ) {
    return requestedProjectId;
  }
  return authorization.projectAccess.assignments[0]?.projectId ?? '';
}

function normalizeEmailList(input: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of readEnvironmentCsv(input)) {
    const email = raw.toLowerCase();
    if (!email.includes('@') || seen.has(email)) continue;
    out.push(email);
    seen.add(email);
  }
  return out;
}
