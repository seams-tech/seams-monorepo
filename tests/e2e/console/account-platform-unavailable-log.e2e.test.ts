import { expect, test } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { ConsoleAccountIdentityContext } from '../../../packages/console-server-ts/src/account/service';
import { createAccountPlatformServiceIngressFromEnvironment } from '../../../packages/console-server-ts/src/accountPlatform/serviceIngressEnvironment';
import {
  queryD1One,
  type D1DatabaseLike,
} from '../../../packages/console-server-ts/src/boundary/d1';
import { createSimulatedBillingProviderAdapters } from '../../../packages/console-server-ts/src/billing/providers';
import {
  createCloudflareD1AccountServiceBundle,
  type CloudflareD1AccountServiceBundle,
} from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { enableBillingService } from '../../helpers/billingService.fixtures';

// The 2026-11-07 outage: an active Satyr instance lost its provision receipt, and every
// Account Platform read of that instance answered 503 with no log line. This journey makes
// the same stored instance unreadable and proves that the ingress names the failure once,
// without the request body or the account it names.

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/unavailable-log');
const namespace = 'account-platform-unavailable-log';
const orgId = 'unreadable-instance-organisation';
const ownerUser = 'verified-unavailable-owner';
const satyr = { serviceId: 'satyr', deploymentId: 'unavailable-log-satyr' } as const;
const feePolicyRoute = '/account-platform/v1/fee-policy';

function now(): Date {
  return new Date('2026-11-09T02:00:00.000Z');
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Account Platform log"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: namespace },
    d1Persist: path.join(output, 'state'),
  });
}

async function databaseOf(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('CONSOLE_DB');
  if (!isD1DatabaseLike(database)) throw new Error('Acceptance D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<void> {
  const directory = path.join(repository, 'packages/console-server-ts/migrations/d1-console-core');
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith('.sql')) continue;
    const prepared = [];
    for (const statement of unstable_splitSqlQuery(
      await readFile(path.join(directory, filename), 'utf8'),
    ))
      prepared.push(database.prepare(statement));
    await database.batch(prepared);
  }
}

function identity(): ConsoleAccountIdentityContext {
  return {
    userId: ownerUser,
    email: `${ownerUser}@unavailable.invalid`,
    name: ownerUser,
    provider: 'oidc',
    platformSupport: false,
    orgId: null,
    projectId: null,
  };
}

function compose(database: D1DatabaseLike): Promise<CloudflareD1AccountServiceBundle> {
  return createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    externalDeletionGuard: null,
    ensureSchema: true,
    now,
    satyrTestPricing: { kind: 'disabled' },
    billingProviders: createSimulatedBillingProviderAdapters(),
    billingEmailConsoleBaseUrl: 'https://unavailable-log.acceptance.invalid',
  });
}

/** The Satyr service binding, as the deployed Account Platform reads it from its environment. */
async function satyrEnvironment() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    SATYR_DEPLOYMENT_ID: satyr.deploymentId,
    SATYR_ACCOUNT_ASSERTION_ISSUER: 'https://satyr.unavailable.invalid',
    SATYR_ACCOUNT_ASSERTION_AUDIENCE: 'https://account.unavailable.invalid',
    SATYR_ACCOUNT_USER_ASSERTION_KEY_ID: 'satyr-unavailable-log',
    SATYR_ACCOUNT_USER_ASSERTION_PUBLIC_JWK_JSON: JSON.stringify({
      kty: publicJwk.kty,
      crv: publicJwk.crv,
      x: publicJwk.x,
    }),
    SATYR_GOOGLE_OIDC_CLIENT_ID: 'unavailable-log.apps.googleusercontent.com',
  };
}

interface LoggedLine {
  readonly level: 'debug' | 'info' | 'warn' | 'error' | 'log';
  readonly args: readonly unknown[];
}

/** The host's log sink. It only records what the ingress writes. */
function recordingLogger(lines: LoggedLine[]) {
  const record =
    (level: LoggedLine['level']) =>
    (...args: unknown[]) =>
      lines.push({ level, args });
  return {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    log: record('log'),
  };
}

function feePolicyRequest(instanceId: string): Request {
  return new Request(`https://account.unavailable.invalid${feePolicyRoute}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, instanceId }),
  });
}

test.beforeAll(async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
});

test('an unreadable stored instance answers 503 and writes one log line that names the failure', async () => {
  const worker = runtime();
  try {
    const database = await databaseOf(worker);
    await migrate(database);
    const core = await compose(database);
    await core.account.createOrganization(identity(), { id: orgId, name: orgId });
    const context = { orgId, actorUserId: ownerUser };
    const projectId = `${orgId}-project`;
    await core.orgProjects.createProject(context, { id: projectId, name: 'Satyr shop' });
    const instanceId = await enableBillingService(core, context, projectId, satyr, namespace);

    const lines: LoggedLine[] = [];
    const ingress = await createAccountPlatformServiceIngressFromEnvironment(
      await satyrEnvironment(),
      {
        serviceAccess: core.serviceAccess,
        serviceMemberships: core.serviceMemberships,
        funds: core.funds,
        billingUsage: core.billingUsage,
        logger: recordingLogger(lines),
      },
    );
    if (!ingress) throw new Error('The Satyr service binding is not configured');

    // Healthy: Satyr reads the fee policy of its active instance, and nothing is logged.
    const healthy = await ingress(feePolicyRequest(instanceId));
    expect(healthy?.status).toBe(200);
    expect(((await healthy?.json()) as { kind: string }).kind).toBe('accepted');
    expect(lines).toEqual([]);

    // The outage: the instance's provision receipt is gone, so its stored state is unreadable.
    const receipt = await queryD1One(
      database,
      `SELECT r.operation_id FROM platform_provision_receipts r
        JOIN platform_service_instances i ON i.namespace = r.namespace AND i.operation_id = r.operation_id
        WHERE i.namespace = ? AND i.id = ?`,
      [namespace, instanceId],
    );
    expect(receipt).not.toBeNull();
    await database
      .prepare('DELETE FROM platform_provision_receipts WHERE namespace = ? AND operation_id = ?')
      .bind(namespace, receipt?.operation_id)
      .run();

    const failed = await ingress(feePolicyRequest(instanceId));
    expect(failed?.status).toBe(503);
    expect(await failed?.json()).toEqual({
      kind: 'rejected',
      error: { code: 'authority_unavailable', retryable: true },
    });

    // One error line names the route and the error, and nothing from the request.
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line.level).toBe('error');
    const fields = line.args[1] as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(['errorClass', 'event', 'message', 'route']);
    expect(fields.event).toBe('account_platform.request_failed');
    expect(fields.route).toBe(feePolicyRoute);
    expect(typeof fields.errorClass).toBe('string');
    expect(fields.errorClass).not.toBe('');
    expect(typeof fields.message).toBe('string');
    expect(fields.message).not.toBe('');
    const written = JSON.stringify(line.args);
    for (const secret of [instanceId, orgId, projectId, namespace, ownerUser])
      expect(written).not.toContain(secret);

    await writeFile(
      path.join(output, 'evidence.json'),
      `${JSON.stringify(
        {
          journey: 'unreadable stored instance',
          healthyStatus: healthy?.status,
          failedStatus: failed?.status,
          loggedLines: lines,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await worker.dispose();
  }
});
