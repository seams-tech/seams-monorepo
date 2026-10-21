import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  ServiceProvisionCommandV1,
  type PlatformResult,
  type PlatformUsageEventV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import type { ServiceProducerAuthorityV1 } from '../../../packages/console-server-ts/src/accountPlatform/types';
import { runAccountServiceProvisioning } from '../../../packages/console-server-ts/src/accountPlatform/provisioning';
import type { D1BillingUsageService } from '../../../packages/console-server-ts/src/billing/usage';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1Row,
} from '../../../packages/console-server-ts/src/boundary/d1';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { WalletServiceProvisioningAdapter } from '../../../packages/wallet-console-server-ts/src/accountPlatform/provisioning';
import {
  WalletMonthlyUsageAdapter,
  createWalletMonthlyUsageStatement,
} from '../../../packages/wallet-console-server-ts/src/billing/usage';
import { createD1ConsoleWalletEnvironmentService } from '../../../packages/wallet-console-server-ts/src/environments/d1';
import {
  createD1ConsoleSponsoredCallRecordInsertStatement,
  createD1ConsoleSponsoredCallService,
} from '../../../packages/wallet-console-server-ts/src/sponsoredCalls/d1';
import { createD1ConsoleWalletService } from '../../../packages/wallet-console-server-ts/src/wallets/d1';
import { createRouterApiWalletRegistrationProjectionAdapter } from '../../../packages/wallet-console-server-ts/src/router/routerApiKeyAuth';
import { activateWalletProject } from '../../helpers/accountWalletProject.fixtures';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/wallet-monthly-usage');
const namespace = 'wallet-monthly-usage-acceptance';
const deploymentId = 'wallet-monthly-usage-acceptance';
const owner = { orgId: 'monthly-owner', actorUserId: 'monthly-verified-owner' };
const otherOwner = { orgId: 'monthly-other-owner', actorUserId: 'monthly-other-verified-owner' };
const resourceId = 'wallet-shared-native-resource';

class Clock {
  at = '2026-10-13T04:00:00.000Z';
  now(): Date {
    return new Date(this.at);
  }
}

class MigratedRuntimeDatabase implements D1DatabaseLike {
  schemaRequests = 0;

  constructor(private readonly database: D1DatabaseLike) {}

  prepare(query: string): D1PreparedStatementLike {
    return this.database.prepare(query);
  }

  batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    return this.database.batch<T>(statements);
  }

  async exec(): Promise<never> {
    this.schemaRequests += 1;
    throw new Error('Migrated request handling cannot run schema initialization');
  }
}

class LostUsageReply {
  private state: 'drop_next_receipt' | 'pass_through' = 'drop_next_receipt';
  constructor(private readonly usage: D1BillingUsageService) {}
  async record(authority: ServiceProducerAuthorityV1, event: PlatformUsageEventV1) {
    const result = await this.usage.record(authority, event);
    if (this.state === 'drop_next_receipt') {
      this.state = 'pass_through';
      throw new Error('Controlled lost monthly usage response');
    }
    return result;
  }
}

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script:
      'export default { fetch() { return new Response("Wallet monthly usage acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { DB: 'wallet-monthly-usage' },
    d1Persist: path.join(output, 'state'),
  });
}

async function databaseOf(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('DB');
  if (!isD1DatabaseLike(database)) throw new Error('Monthly usage D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<void> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith('.sql')) continue;
    const contents = await readFile(path.join(directory, filename), 'utf8');
    for (const statement of unstable_splitSqlQuery(contents))
      await database.prepare(statement).run();
  }
}

async function product(database: D1DatabaseLike, clock: Clock) {
  const requestDatabase = new MigratedRuntimeDatabase(database);
  const core = await createCloudflareD1AccountServiceBundle({
    database: requestDatabase,
    namespace,
    ensureSchema: false,
    externalDeletionGuard: null,
    now: clock.now.bind(clock),
  });
  const environments = await createD1ConsoleWalletEnvironmentService({
    database,
    namespace,
    ensureSchema: false,
    now: clock.now.bind(clock),
  });
  const wallets = await createD1ConsoleWalletService({
    database,
    namespace,
    ensureSchema: false,
    now: clock.now.bind(clock),
  });
  const executions = await createD1ConsoleSponsoredCallService({
    database,
    namespace,
    now: clock.now.bind(clock),
  });
  const monthly = new WalletMonthlyUsageAdapter({
    database,
    namespace,
    deploymentId,
    usage: core.billingUsage,
    planUsage: core.freePlan,
  });
  return { core, environments, wallets, executions, monthly, requestDatabase };
}

type Product = Awaited<ReturnType<typeof product>>;

async function createOwner(product: Product, context: typeof owner): Promise<void> {
  await product.core.orgProjects.upsertOrganization(context, { name: context.orgId });
  await product.core.organizationAccess.bootstrapInitialOwner({
    orgId: context.orgId,
    userId: context.actorUserId,
    email: `${context.actorUserId}@monthly.invalid`,
    displayName: context.actorUserId,
  });
}

async function createProject(
  product: Product,
  context: typeof owner,
  projectId: string,
): Promise<void> {
  await product.core.orgProjects.createProject(context, { id: projectId, name: projectId });
  await activateWalletProject({
    core: product.core,
    walletEnvironments: product.environments,
    namespace,
    deploymentId,
    context,
    projectId,
  });
}

async function createWallet(
  product: Product,
  context: typeof owner,
  projectId: string,
  walletId: string,
): Promise<void> {
  if (!product.wallets.upsertWallet) throw new Error('Acceptance Wallet index is not writable');
  await product.wallets.upsertWallet(context, {
    id: walletId,
    projectId,
    environmentId: `${projectId}:dev`,
    userId: 'wallet-user',
    externalRefId: walletId,
    address: walletId,
    chain: 'Multichain',
  });
}

async function captureReceipt(
  database: D1DatabaseLike,
  product: Product,
  clock: Clock,
  context: typeof owner,
  projectId: string,
  walletId: string,
  label: string,
): Promise<void> {
  const binding = accepted(
    await product.core.accountPlatform.resolveWalletBinding(
      { serviceId: 'wallet', deploymentId },
      { namespace, nativeOrganizationId: context.orgId, nativeProjectId: projectId },
    ),
  );
  const recordId = `source:${label}`;
  const receipt = createD1ConsoleSponsoredCallRecordInsertStatement({
    database,
    namespace,
    ctx: context,
    recordId,
    createdAtMs: clock.now().getTime(),
    request: {
      id: recordId,
      environmentId: `${projectId}:dev`,
      apiKeyId: 'fixture-credential',
      apiKeyKind: 'publishable_key',
      route: '/evm/call',
      policyId: 'fixture-policy',
      chainFamily: 'evm',
      intentKind: 'evm_call',
      executorKind: 'evm_eoa',
      accountRef: `near:${walletId}`,
      targetRef: '0x1111111111111111111111111111111111111111',
      sponsorRef: 'fixture-sponsor',
      txOrExecutionRef: `accepted:${label}`,
      receiptStatus: 'success',
      feeUnit: 'wei',
      feeAmount: '1',
      detailsJson: JSON.stringify({ walletId }),
      idempotencyKey: `request:${label}`,
    },
  });
  const fact = createWalletMonthlyUsageStatement({
    database,
    namespace,
    deploymentId,
    organizationId: context.orgId,
    instanceId: binding.instanceId,
    sourceRecordId: recordId,
    sourceDigest: createHash('sha256').update(label).digest('hex'),
    environmentId: `${projectId}:dev`,
    walletId,
    occurredAt: clock.now().toISOString(),
  });
  await database.batch([receipt, fact]);
}

async function changeState(
  product: Product,
  projectId: string,
  command: 'disable' | 'archive',
  desiredRevision: number,
): Promise<void> {
  const adapter = new WalletServiceProvisioningAdapter({
    deploymentId,
    namespace,
    environments: product.environments,
    orgProjects: product.core.orgProjects,
    billing: product.core.billing,
  });
  const binding = accepted(
    await product.core.accountPlatform.resolveWalletBinding(adapter.authority, {
      namespace,
      nativeOrganizationId: owner.orgId,
      nativeProjectId: projectId,
    }),
  );
  const provision = accepted(
    ServiceProvisionCommandV1.parse({
      version: 1,
      instanceId: binding.instanceId,
      operationId: `${command}:${projectId}`,
      desiredRevision,
      command,
      binding,
    }),
  );
  accepted(
    await product.core.accountPlatform.requestProvision(owner, {
      scope: binding.scope,
      command: provision,
    }),
  );
  const delivery = await runAccountServiceProvisioning({
    platform: product.core.accountPlatform,
    adapter,
    limit: 1,
  });
  expect(delivery.delivered).toBe(1);
}

async function rows(database: D1DatabaseLike, table: string) {
  const result = await database.prepare(`SELECT * FROM ${table}`).all<D1Row>();
  return result.results ?? [];
}

test('Wallet monthly facts survive lost replies, restart, archive and a UTC month boundary', async () => {
  await mkdir(output, { recursive: true });
  await rm(path.join(output, 'state'), { recursive: true, force: true });
  const clock = new Clock();
  let worker = runtime();
  try {
    let database = await databaseOf(worker);
    await migrate(database);
    let services = await product(database, clock);
    await createOwner(services, owner);
    await createOwner(services, otherOwner);
    await createProject(services, owner, 'wallet-a');
    await createProject(services, owner, 'wallet-b');
    await createProject(services, otherOwner, 'wallet-c');
    await createWallet(services, owner, 'wallet-a', resourceId);
    await createWallet(services, owner, 'wallet-b', resourceId);
    await createWallet(services, otherOwner, 'wallet-c', resourceId);
    await createWallet(services, owner, 'wallet-a', 'late-wallet');
    const registration = createRouterApiWalletRegistrationProjectionAdapter({
      walletEnvironments: services.environments,
      wallets: services.wallets,
    });
    await registration.recordEvent({
      orgId: owner.orgId,
      environmentId: 'wallet-a:dev',
      apiKeyId: 'fixture-key',
      endpoint: '/wallets/register',
      walletId: 'registration-only-wallet',
      action: 'wallet_created',
      succeeded: true,
      occurredAt: clock.now().toISOString(),
      sourceEventId: 'registration-only',
    });
    expect(await rows(database, 'wallet_monthly_usage_outbox')).toHaveLength(0);
    await captureReceipt(database, services, clock, owner, 'wallet-a', resourceId, 'first');
    const lostReply = new WalletMonthlyUsageAdapter({
      database,
      namespace,
      deploymentId,
      usage: new LostUsageReply(services.core.billingUsage),
      planUsage: services.core.freePlan,
    });
    await expect(lostReply.resumePending(20)).rejects.toThrow(
      'Controlled lost monthly usage response',
    );
    expect(await rows(database, 'billing_usage_events')).toHaveLength(1);
    const beforeRestart = await rows(database, 'wallet_monthly_usage_outbox');
    expect(beforeRestart[0].delivery_status).toBe('pending');
    await captureReceipt(database, services, clock, owner, 'wallet-a', 'late-wallet', 'late');
    await changeState(services, 'wallet-a', 'disable', 2);
    await changeState(services, 'wallet-a', 'archive', 3);
    await worker.dispose();
    worker = runtime();
    database = await databaseOf(worker);
    services = await product(database, clock);
    expect(await services.monthly.resumePending(20)).toEqual({ delivered: 2, pending: 0 });
    expect(await services.monthly.resumePending(20)).toEqual({ delivered: 0, pending: 0 });
    await captureReceipt(database, services, clock, owner, 'wallet-b', resourceId, 'second');
    await captureReceipt(database, services, clock, otherOwner, 'wallet-c', resourceId, 'foreign');
    await services.monthly.resumePending(20);
    clock.at = '2026-11-01T00:00:00.000Z';
    await captureReceipt(database, services, clock, owner, 'wallet-b', resourceId, 'november');
    await services.monthly.resumePending(20);
    const ledger = await rows(database, 'billing_ledger_entries');
    expect(ledger).toHaveLength(4);
    expect((await services.core.billing.getOverview(owner)).creditBalanceMinor).toBe(-900);
    expect((await services.core.billing.getOverview(otherOwner)).creditBalanceMinor).toBe(-300);
    const outbox = await rows(database, 'wallet_monthly_usage_outbox');
    expect(outbox).toHaveLength(5);
    for (const row of outbox) expect(row.delivery_status).toBe('delivered');
    await expect(
      database
        .prepare("UPDATE wallet_monthly_usage_outbox SET payload_json = '{}' WHERE event_id = ?")
        .bind(beforeRestart[0].event_id)
        .run(),
    ).rejects.toThrow('wallet_monthly_usage_fact_immutable');
    // Retained history must not be visited by an empty retry scan.
    await database
      .prepare(
        `WITH RECURSIVE history(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 10000)
      INSERT INTO wallet_monthly_usage_outbox SELECT namespace, deployment_id, 'history:' || n, native_org_id,
      'history:' || n, instance_id, payload_json, 'delivered' FROM wallet_monthly_usage_outbox, history
      WHERE event_id = ?`,
      )
      .bind(beforeRestart[0].event_id)
      .run();
    const plan = await database
      .prepare(
        `EXPLAIN QUERY PLAN SELECT payload_json FROM wallet_monthly_usage_outbox
      WHERE namespace = ? AND deployment_id = ? AND delivery_status = 'pending' ORDER BY event_id LIMIT ?`,
      )
      .bind(namespace, deploymentId, 20)
      .all();
    expect(JSON.stringify(plan.results)).toContain('wallet_monthly_usage_pending');
    expect(await services.monthly.resumePending(20)).toEqual({ delivered: 0, pending: 0 });
    await writeFile(
      path.join(output, 'evidence.json'),
      JSON.stringify(
        {
          beforeRestart,
          ledger,
          outbox,
          pendingQueryPlan: plan.results,
          retainedHistory: 10005,
          runtimeSchemaRequests: services.requestDatabase.schemaRequests,
          monthlyResources: await rows(database, 'billing_monthly_active_resources'),
          repeat:
            'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-wallet-monthly-usage.e2e.test.ts --reporter=line',
          limits:
            'Local D1 receipt transactions. Production settlement integration is exercised by shared-wallet-settlement.e2e.test.ts.',
        },
        null,
        2,
      ),
    );
  } finally {
    await worker.dispose();
  }
});
