import { expect, type Route } from '@playwright/test';
import { createHmac, generateKeyPairSync, sign, timingSafeEqual } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import type { ConsoleSessionJwtHooks } from '../../packages/console-server-ts/src/boundary/session';
import { HostedConsoleAuthHandler } from '../../packages/wallet-console-server-ts/src/router/hostedConsoleAuth';

export const clientId = 'google-console-acceptance-client';
export const cookieName = 'google-console-acceptance-session';
const sessionSecret = 'isolated-google-console-acceptance';
export const appDirectory = fileURLToPath(new URL('../../apps/wallet-console/', import.meta.url));
export const fixtures = new URL('../fixtures/google-console/', import.meta.url);

export async function applyMigrations(
  database: Awaited<ReturnType<Miniflare['getD1Database']>>,
): Promise<void> {
  const directory = new URL(
    '../../packages/console-server-ts/migrations/d1-console-core/',
    import.meta.url,
  );
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    for (const statement of unstable_splitSqlQuery(
      await readFile(new URL(name, directory), 'utf8'),
    )) {
      await database.prepare(statement).run();
    }
  }
}

export function signSession(input: Parameters<ConsoleSessionJwtHooks['signToken']>[0]): string {
  const payload = Buffer.from(
    JSON.stringify({ ...input.payload, exp: Math.floor(Date.now() / 1_000) + 3_600 }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', sessionSecret).update(payload).digest('base64url')}`;
}

export function verifySession(token: string): { valid: boolean; payload?: unknown } {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return { valid: false };
  const supplied = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', sessionSecret).update(payload).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return { valid: false };
  return { valid: true, payload: JSON.parse(Buffer.from(payload, 'base64url').toString()) };
}

export function setSessionCookie(token: string): string {
  return `${cookieName}=${token}; HttpOnly; Path=/; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${cookieName}=; HttpOnly; Path=/; Max-Age=0`;
}

export function isConsoleSessionCookie(cookie: { readonly name: string }): boolean {
  return cookie.name === cookieName;
}

export async function consoleSessionStatusWithBearer(token: string): Promise<number> {
  const response = await fetch('/console/session', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.status;
}

export function ready(): void {}
export async function recordVerifiedIdentity(): Promise<void> {}

export class ProviderAuthority {
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

  token(): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid: 'console-acceptance' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: clientId,
        sub: 'getsignal-acceptance',
        email: 'getsignal@example.test',
        email_verified: true,
        name: 'GetSignal acceptance',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const input = `${header}.${payload}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), this.keys.privateKey).toString('base64url')}`;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    switch (String(input)) {
      case 'https://github.com/login/oauth/access_token':
        expect(JSON.parse(String(init?.body))).toMatchObject({ code: 'github-acceptance-code' });
        return Response.json({ access_token: 'github-acceptance-token' });
      case 'https://api.github.com/user':
        return Response.json({ id: 12345, login: 'octocat', name: 'GitHub acceptance' });
      case 'https://api.github.com/user/emails':
        return Response.json([{ email: 'octocat@gmail.com', primary: true, verified: true }]);
      case 'https://www.googleapis.com/oauth2/v3/certs':
        return this.googleKeys();
      default:
        throw new Error(`Unexpected provider request: ${String(input)}`);
    }
  }

  private googleKeys(): Response {
    const key = this.keys.publicKey.export({ format: 'jwk' });
    return Response.json({
      keys: [
        { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', kid: 'console-acceptance', use: 'sig' },
      ],
    });
  }
}

export class ConsoleTransport {
  readonly exchanges: number[] = [];
  readonly githubExchanges: number[] = [];
  readonly identitySessions: number[] = [];

  constructor(private readonly handler: HostedConsoleAuthHandler) {}

  async handle(route: Route): Promise<void> {
    const incoming = route.request();
    const response = await this.handler.fetch(
      new Request(incoming.url(), {
        method: incoming.method(),
        headers: await incoming.allHeaders(),
        body: incoming.postData(),
      }),
    );
    if (new URL(incoming.url()).pathname === '/console/auth/google')
      this.exchanges.push(response.status);
    if (new URL(incoming.url()).pathname === '/console/auth/github')
      this.githubExchanges.push(response.status);
    if (new URL(incoming.url()).pathname === '/console/auth/session')
      this.identitySessions.push(response.status);
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  }
}
