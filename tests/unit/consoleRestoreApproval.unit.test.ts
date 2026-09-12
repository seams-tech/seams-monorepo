import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteCliD1Database } from '../helpers/sqliteD1';
import { consoleRestoreApprovalFixture } from './helpers/consoleRestoreApproval.fixtures';
import { createRestoreAccessRoute } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreAccessRoute';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';

const base = 'https://console.example/console/tenant-root/security/restore-access';
const destination = 'https://replacement.example';
const credential = Buffer.alloc(32, 7).toString('base64url');
function request(action: string, body?: unknown) {
  return new Request(`${base}${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('console approval binds restore access to the owner session, environment and destination', async () => {
  const fixture = await consoleRestoreApprovalFixture();
  const database = new SqliteCliD1Database(
    path.join(mkdtempSync(path.join(tmpdir(), 'seams-restore-approval-')), 'approval.sqlite'),
  );
  await database.exec(
    readFileSync(
      path.resolve(
        '..',
        'packages/wallet-console-server-ts/migrations/d1-console/0044_tenant_root_cli_restore_access.sql',
      ),
      'utf8',
    ),
  );
  const identityDigest = await tenantRootIdentityDigestB64uV1(fixture.identity);
  const route = await createRestoreAccessRoute(
    { ...fixture, database, namespace: 'approval-test' },
    JSON.stringify({ identity: fixture.identity, destination, credential }),
  );
  const originalFetch = globalThis.fetch;
  let exchanges = 0;
  globalThis.fetch = async (url, init) => {
    expect(url).toBe(`${destination}/console/tenant-root/security/restore/bootstrap-session`);
    expect(new Headers(init?.headers).get('x-seams-destination-bootstrap')).toBe(credential);
    expect(init?.redirect).toBe('manual');
    exchanges += 1;
    return Response.json(
      {
        ok: true,
        sessionToken: Buffer.alloc(32, 8).toString('base64url'),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
      { headers: { 'x-seams-recovery-identity': identityDigest } },
    );
  };
  try {
    expect(
      (
        await route(
          request('/start', {
            environmentId: fixture.identity.envId,
            destination: 'https://wrong.example',
          }),
        )
      )?.status,
    ).toBe(409);
    expect(
      (await route(request('/start', { environmentId: 'another-project', destination })))?.status,
    ).toBe(409);
    const started = await (await route(
      request('/start', { environmentId: fixture.identity.envId, destination }),
    ))!.json();
    const polling = { id: started.id, pollingSecret: started.pollingSecret };
    const details = await (await route(request(`/request?id=${started.id}`)))!.json();
    expect(details.destination).toBe(destination);
    expect(JSON.stringify(details)).not.toContain(credential);
    fixture.state.stepUp = {
      actorUserId: fixture.claims.userId,
      sessionId: 'another-browser-session',
      method: 'webauthn_platform_v1',
      verifiedAtMs: Date.now(),
    };
    expect((await route(request('/approve', { id: started.id })))?.status).toBe(403);
    expect(exchanges).toBe(0);
    fixture.state.stepUp = {
      actorUserId: fixture.claims.userId,
      sessionId: 'restore-browser-session',
      method: 'webauthn_platform_v1',
      verifiedAtMs: Date.now(),
    };
    const successfulExchange = globalThis.fetch;
    globalThis.fetch = failedConnection;
    expect(await (await route(request('/approve', { id: started.id })))!.json()).toEqual({
      ok: false,
      code: 'restore_destination_connection_failed',
    });
    globalThis.fetch = redirectedDestination;
    expect(await (await route(request('/approve', { id: started.id })))!.json()).toEqual({
      ok: false,
      code: 'restore_destination_redirect_refused',
    });
    globalThis.fetch = rejectedCredential;
    expect(await (await route(request('/approve', { id: started.id })))!.json()).toEqual({
      ok: false,
      code: 'restore_destination_credential_rejected',
    });
    globalThis.fetch = unavailableDestination;
    expect(await (await route(request('/approve', { id: started.id })))!.json()).toEqual({
      ok: false,
      code: 'restore_destination_unavailable',
      destinationStatus: 503,
    });
    globalThis.fetch = invalidSession.bind(null, identityDigest);
    expect(await (await route(request('/approve', { id: started.id })))!.json()).toEqual({
      ok: false,
      code: 'restore_destination_invalid_response',
    });
    globalThis.fetch = successfulExchange;
    expect((await route(request('/approve', { id: started.id })))?.status).toBe(200);
    expect(exchanges).toBe(1);
    const approved = await (await route(request('/poll', polling)))!.json();
    expect(approved.state).toBe('approved');
    expect(approved.session.destination).toBe(destination);
    expect(approved.session.sessionToken).toBe(Buffer.alloc(32, 8).toString('base64url'));
    expect(JSON.stringify(approved)).not.toContain(credential);
    await database.prepare('UPDATE tenant_root_cli_restore_access SET next_poll_ms=0').run();
    fixture.state.ownerActive = false;
    expect((await route(request('/poll', polling)))?.status).toBe(403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function failedConnection(): Promise<Response> {
  throw new Error('TLS certificate validation failed');
}
async function rejectedCredential(): Promise<Response> {
  return Response.json({ ok: false, code: 'bootstrap_authentication_failed' }, { status: 401 });
}
async function unavailableDestination(): Promise<Response> {
  return new Response('Unavailable', { status: 503 });
}
async function invalidSession(identityDigest: string): Promise<Response> {
  return new Response('invalid JSON', { headers: { 'x-seams-recovery-identity': identityDigest } });
}

async function redirectedDestination(): Promise<Response> {
  return new Response(null, { status: 302, headers: { location: 'https://other.example' } });
}
