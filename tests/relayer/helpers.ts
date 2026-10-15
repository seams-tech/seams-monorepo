import type {
  ConsoleAuthAdapter,
  ConsoleAuthClaims,
} from '../../packages/console-server-ts/src/router/consoleAuth';
import type { SessionAdapter } from '../../packages/console-server-ts/src/boundary/session';
import type { CfEnv, CfExecutionContext } from '@seams/wallet-server/cloud-host';

const SESSION_COOKIE_NAME =
  String(process.env.SESSION_COOKIE_NAME || 'seams-jwt').trim() || 'seams-jwt';

export function makeCfCtx(): {
  ctx: CfExecutionContext;
  waited: Array<Promise<unknown>>;
} {
  const waited: Array<Promise<unknown>> = [];
  const ctx: CfExecutionContext = {
    waitUntil(p: Promise<unknown>) {
      waited.push(p);
    },
    passThroughOnException() {},
  };
  return { ctx, waited };
}

export async function callCf(
  handler: (request: Request, env?: CfEnv, ctx?: CfExecutionContext) => Promise<Response>,
  input: {
    method: string;
    path: string;
    origin?: string;
    headers?: Record<string, string>;
    body?: unknown;
    env?: CfEnv;
    ctx?: CfExecutionContext;
  },
): Promise<{
  status: number;
  headers: Headers;
  json: Record<string, any> | null;
  text: string;
}> {
  const url = new URL(input.path, 'https://relay.test');
  const headers = new Headers(input.headers || {});
  if (input.origin) headers.set('Origin', input.origin);
  let body: string | undefined;
  if (input.body !== undefined) {
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
  }

  const req = new Request(url.toString(), {
    method: input.method,
    headers,
    body,
  });

  const res = await handler(req, input.env, input.ctx);
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      json = parsed as Record<string, any>;
    } else {
      json = null;
    }
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text };
}

export function getPath(json: unknown, ...path: Array<string | number>): unknown {
  let cursor: unknown = json;
  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[key];
      continue;
    }
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

export function randomNamespace(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

export function makeConsoleAuthAdapter(claims: ConsoleAuthClaims): ConsoleAuthAdapter {
  return {
    authenticate: async () => ({ ok: true, claims }),
  };
}

export function makeGoogleEmailOtpRegistrationOffer(input: {
  walletId: string;
  candidateId?: string;
  offerId?: string;
}) {
  const candidateId = input.candidateId || 'registration-candidate-1';
  return {
    offerId: input.offerId || 'registration-offer-1',
    selectedCandidateId: candidateId,
    candidates: [{ candidateId, walletId: input.walletId }] as const,
  };
}

export function makeSessionAdapter(overrides: Partial<SessionAdapter> = {}): SessionAdapter {
  const adapter: SessionAdapter = {
    signJwt: overrides.signJwt || (async (sub: string) => `jwt-for:${sub}`),
    verifyJwt: overrides.verifyJwt || (async () => ({ valid: false })),
    parse: overrides.parse || (async () => ({ ok: false, reason: 'missing' }) as const),
    buildSetCookie:
      overrides.buildSetCookie ||
      ((token: string) =>
        `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`),
    buildClearCookie:
      overrides.buildClearCookie || (() => `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`),
    refresh:
      overrides.refresh ||
      (async () => ({ ok: false, code: 'not_eligible', message: 'not eligible' })),
  };
  return adapter;
}
