import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteCliD1Database } from '../helpers/sqliteD1';
import { consoleRestoreApprovalFixture } from './helpers/consoleRestoreApproval.fixtures';
import { handleBackupAccess } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/backupAccessRoute';

function request(action: string, body?: unknown) {
  return new Request(`https://console.example/console/tenant-root/security/backup-access${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function refuseStorage(): Promise<never> {
  throw new Error('Unauthorized request reached recovery storage');
}
async function audit(): Promise<void> {}
function staleTime(): number { return Date.now() + 3600000; }

test('backup download requires the matching polling secret and fresh owner approval for its environment', async () => {
  const fixture = await consoleRestoreApprovalFixture();
  const database = new SqliteCliD1Database(path.join(mkdtempSync(path.join(tmpdir(), 'seams-backup-access-')), 'test.sqlite'));
  await database.exec(readFileSync(path.resolve('..', 'packages/wallet-console-server-ts/migrations/d1-console/0045_tenant_root_backup_access.sql'), 'utf8'));
  const deps = { auth: fixture.auth, orgProjectEnv: fixture.orgProjectEnv, stepUp: fixture.stepUp, database, namespace: 'test', isOwner: fixture.isOwner, audit: { write: audit }, custody: refuseStorage, controlPlane: refuseStorage };
  const start = await (await handleBackupAccess(deps,request('/start',{ environmentId: fixture.identity.envId,recoverySetId:'exact-backup',scope:'both' }))).json();
  const poll = {id:start.id,pollingSecret:start.pollingSecret};
  expect((await handleBackupAccess(deps,request('/poll',{id:start.id,pollingSecret:Buffer.alloc(32,9).toString('base64url')}))).status).toBe(403);
  expect(await (await handleBackupAccess(deps,request('/poll',poll))).json()).toEqual({ok:true,state:'pending'});
  const details = await (await handleBackupAccess(deps,request(`/request?id=${start.id}`))).json();
  expect(details.recoverySetId).toBe('exact-backup');
  expect(details).not.toHaveProperty('pollingSecret');
  expect((await handleBackupAccess({...deps,now:staleTime},request('/approve',{id:start.id}))).status).toBe(403);
  const other = await (await handleBackupAccess(deps,request('/start',{environmentId:'other-env',recoverySetId:'exact-backup',scope:'both'}))).json();
  expect((await handleBackupAccess(deps,request(`/request?id=${other.id}`))).status).toBe(403);
  await database.prepare('UPDATE tenant_root_backup_access SET expires_at_ms=0 WHERE id=?').bind(start.id).run();
  expect(await (await handleBackupAccess(deps,request('/poll',poll))).json()).toEqual({ok:true,state:'expired'});
});
