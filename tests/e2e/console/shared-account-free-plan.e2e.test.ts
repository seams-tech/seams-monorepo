import { expect, test } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { PlatformPlanUsageEventV1 } from '../../../packages/console-shared-ts/src/accountPlatform';
import { createSimulatedBillingProviderAdapters } from '../../../packages/console-server-ts/src/billing/providers';
import { parseStripeCardSetupWebhookEvent } from '../../../packages/console-server-ts/src/billing/stripeWebhook';
import { ConsoleBillingError } from '../../../packages/console-server-ts/src/billing/errors';
import {
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
} from '../../../packages/console-server-ts/src/boundary/d1';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { WalletMonthlyUsageAdapter } from '../../../packages/wallet-console-server-ts/src/billing/usage';
import { createD1ConsoleWalletEnvironmentService } from '../../../packages/wallet-console-server-ts/src/environments/d1';
import { WalletHome } from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { activateWalletProject } from '../../helpers/accountWalletProject.fixtures';
import {
  activateConsoleDeploymentFixture,
  fourRegionBinding,
  fourRegionProductionBinding,
} from '../../helpers/tenantDeploymentFixtures';
import {
  registrationLifecycleFromGateway,
  reserveFromGateway,
  unlockFromGateway,
  type RegistrationTenantFixture,
} from '../../fixtures/tenant-deployment/registrationHomeAdmission';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/free-plan');
const namespace = 'free-plan-acceptance';
const consoleBaseUrl = 'https://console.free-plan.test';
const DAY_MS = 86_400_000;
const accountId = '0123456789abcdef0123456789abcdef';
const catalogJson = JSON.stringify([
  WalletHome.parse({ region: 'US', accountId, databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  WalletHome.parse({ region: 'WEUR', accountId, databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
  WalletHome.parse({ region: 'APAC', accountId, databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
  WalletHome.parse({ region: 'OC', accountId, databaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
]);

/** Free plan time; registration and session time stay on the wall clock. */
class Clock {
  constructor(public ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
}

interface Organization {
  readonly orgId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly productionLane: string;
  readonly developmentLane: string;
}

function organization(label: string): Organization {
  return {
    orgId: `free-${label}`,
    projectId: `free-${label}-project`,
    ownerUserId: `free-${label}-owner`,
    productionLane: `free-${label}-prod`,
    developmentLane: `free-${label}-dev`,
  };
}

function tenant(org: Organization, environment: 'prod' | 'dev'): RegistrationTenantFixture {
  return {
    scope: {
      namespace,
      organizationId: org.orgId,
      projectId: org.projectId,
      environmentId: `${org.projectId}:${environment}`,
    },
    environmentKey: environment,
    deploymentLane: environment === 'prod' ? org.productionLane : org.developmentLane,
  };
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Free plan acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { DB: 'free-plan' },
    d1Persist: path.join(output, 'state'),
  });
}

async function migratedDatabase(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('DB');
  if (!isD1DatabaseLike(database)) throw new Error('Free plan D1 binding is unavailable');
  const directory = path.join(repository, 'packages/wallet-console-server-ts/migrations/d1-console');
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith('.sql')) continue;
    const contents = await readFile(path.join(directory, filename), 'utf8');
    for (const statement of unstable_splitSqlQuery(contents))
      await database.prepare(statement).run();
  }
  return database;
}

async function product(database: D1DatabaseLike, clock: Clock, setupCardExpiry: Date) {
  const now = clock.now.bind(clock);
  const core = await createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    ensureSchema: false,
    externalDeletionGuard: null,
    now,
    billingProviders: createSimulatedBillingProviderAdapters({
      setupCard: {
        brand: 'visa',
        last4: '4242',
        expMonth: setupCardExpiry.getUTCMonth() + 1,
        expYear: setupCardExpiry.getUTCFullYear(),
      },
    }),
    billingEmailConsoleBaseUrl: consoleBaseUrl,
  });
  const environments = await createD1ConsoleWalletEnvironmentService({
    database,
    namespace,
    ensureSchema: false,
    now,
  });
  return { core, environments };
}

type Product = Awaited<ReturnType<typeof product>>;

async function createOrganization(
  database: D1DatabaseLike,
  services: Product,
  org: Organization,
): Promise<void> {
  const context = { orgId: org.orgId, actorUserId: org.ownerUserId };
  await services.core.orgProjects.upsertOrganization(context, { name: org.orgId });
  await services.core.organizationAccess.bootstrapInitialOwner({
    orgId: org.orgId,
    userId: org.ownerUserId,
    email: `${org.ownerUserId}@free-plan.invalid`,
    displayName: org.ownerUserId,
  });
  await services.core.orgProjects.createProject(context, {
    id: org.projectId,
    name: org.projectId,
  });
  await activateWalletProject({
    core: services.core,
    walletEnvironments: services.environments,
    namespace,
    deploymentId: org.productionLane,
    context,
    projectId: org.projectId,
  });
  const tenantScope = { namespace, organizationId: org.orgId, projectId: org.projectId };
  await activateConsoleDeploymentFixture(
    database,
    await fourRegionProductionBinding(Date.now(), org.productionLane, tenantScope),
    `tco_${org.productionLane}`,
  );
  await activateConsoleDeploymentFixture(
    database,
    await fourRegionBinding(Date.now(), org.developmentLane, {
      ...tenantScope,
      environmentId: `${org.projectId}:dev`,
    }),
    `tco_${org.developmentLane}`,
  );
}

async function register(
  database: D1DatabaseLike,
  org: Organization,
  environment: 'prod' | 'dev',
  label: string,
) {
  const gateway = {
    database,
    catalogJson,
    region: 'US' as const,
    localRegion: 'US' as const,
    tenant: tenant(org, environment),
  };
  const reserved = await reserveFromGateway({
    ...gateway,
    operationId: `free-plan-${org.orgId}-${label}`,
    origin: 'https://wallet.free-plan.test',
  });
  if (!reserved.ok) return reserved;
  const completed = await registrationLifecycleFromGateway({
    ...gateway,
    ceremonyId: reserved.reservation.ceremonyId,
    walletId: reserved.reservation.walletId,
    operation: { kind: 'complete', outcome: 'established' },
  });
  if (!completed.ok) throw new Error(`Registration completion failed: ${completed.code}`);
  return { ok: true as const, walletId: reserved.reservation.walletId, gateway };
}

/** The facts a Wallet runtime would deliver; they enter through the same Console contract. */
async function deliverProductionUsers(
  services: Product,
  org: Organization,
  from: number,
  to: number,
  occurredAt: Date,
): Promise<void> {
  for (let index = from; index < to; index += 1) {
    const event = PlatformPlanUsageEventV1.parse({
      version: 1,
      kind: 'plan_usage',
      eventId: `bulk-user-${org.orgId}-${index}`,
      instanceId: `wallet:${org.projectId}`,
      occurredAt: occurredAt.toISOString(),
      measure: {
        kind: 'production_active_user',
        environmentId: `${org.projectId}:prod`,
        userKey: `bulk-user-${index}`,
      },
    });
    if (event.kind === 'rejected') throw new Error('Fixture plan usage event is invalid');
    const recorded = await services.core.freePlan.recordProductionUsage(
      { serviceId: 'wallet', deploymentId: org.productionLane },
      event.value,
    );
    if (recorded.kind === 'rejected') throw new Error(recorded.error.code);
  }
}

async function deliverOutbox(database: D1DatabaseLike, services: Product, org: Organization) {
  const outbox = new WalletMonthlyUsageAdapter({
    database,
    namespace,
    deploymentId: org.productionLane,
    usage: services.core.billingUsage,
    planUsage: services.core.freePlan,
  });
  return await outbox.resumePending(100);
}

async function pass(services: Product) {
  const result = await services.core.freePlan.runScheduledPass({ limit: 200 });
  expect(result.failures).toEqual([]);
  return result;
}

/** Sorted notice names, one per queued email; a repeated notice would appear twice. */
async function noticeEmails(database: D1DatabaseLike, org: Organization) {
  const rows = await queryD1All(
    database,
    `SELECT template_payload_json FROM console_email_outbox
     WHERE namespace = ? AND org_id = ? AND template_family = 'FREE_PLAN_NOTICE'
     ORDER BY created_at_ms, id`,
    [namespace, org.orgId],
  );
  return rows.map((row) => {
    const payload = JSON.parse(String(row.template_payload_json)) as {
      notice: { kind: string; day?: number; cardOnFile?: boolean };
    };
    return payload.notice.kind === 'card_reminder'
      ? `card_reminder:${payload.notice.day}`
      : payload.notice.kind === 'free_limit_warning'
        ? `free_limit_warning:${payload.notice.cardOnFile ? 'card' : 'no_card'}`
        : payload.notice.kind;
  }).sort();
}

async function addCard(services: Product, org: Organization) {
  const ctx = { orgId: org.orgId, actorUserId: org.ownerUserId };
  const setup = await services.core.freePlan.startCardSetup(ctx);
  // The simulated success redirect carries the session id; verification is server side.
  const returned = new URL(setup.url).searchParams.get('checkout_session_id');
  expect(returned).toBe(setup.checkoutSessionId);
  return await services.core.freePlan.reconcileCardSetup(ctx, setup.checkoutSessionId);
}

test('Free plan: card clock, production-only counts, notices, hard stop, and the move to Growth', async () => {
  test.setTimeout(240_000);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const startMs = Date.now();
  const clock = new Clock(startMs);
  // The setup card expires in the month after day 90, so day 60 still sees a usable card.
  const cardExpiry = new Date(startMs + 100 * DAY_MS);
  const worker = runtime();
  const evidence: Record<string, unknown> = {};
  try {
    const database = await migratedDatabase(worker);
    const services = await product(database, clock, cardExpiry);
    const clockOrg = organization('clock');
    const stopOrg = organization('stop');
    const carded = organization('carded');
    for (const org of [clockOrg, stopOrg, carded])
      await createOrganization(database, services, org);
    await pass(services);
    for (const org of [clockOrg, stopOrg, carded]) {
      const plan = await services.core.freePlan.getPlan({ orgId: org.orgId });
      expect(plan).toMatchObject({ plan: 'free', productionState: 'active', banners: [] });
    }

    // Production counts: two prod users (one unlocks again), one dev user that never counts.
    const first = await register(database, stopOrg, 'prod', 'first');
    const second = await register(database, stopOrg, 'prod', 'second');
    const sandbox = await register(database, stopOrg, 'dev', 'sandbox');
    if (!first.ok || !second.ok || !sandbox.ok) throw new Error('Fixture registration failed');
    await unlockFromGateway({ ...first.gateway, walletId: first.walletId, sessionLabel: 'unlock' });
    expect(await deliverOutbox(database, services, stopOrg)).toEqual({ delivered: 2, pending: 0 });
    expect(await deliverOutbox(database, services, stopOrg)).toEqual({ delivered: 0, pending: 0 });
    let stopPlan = await services.core.freePlan.getPlan({ orgId: stopOrg.orgId });
    expect(stopPlan.usage).toMatchObject({ productionActiveUsers: 2, productionSignatures: 0 });

    // 80% of the user limit without a card: one warning, sent once.
    await deliverProductionUsers(services, stopOrg, 0, 238, clock.now());
    await deliverProductionUsers(services, stopOrg, 0, 238, clock.now());
    await pass(services);
    await pass(services);
    stopPlan = await services.core.freePlan.getPlan({ orgId: stopOrg.orgId });
    expect(stopPlan.usage.productionActiveUsers).toBe(240);
    expect(stopPlan.productionState).toBe('active');
    expect(await noticeEmails(database, stopOrg)).toEqual(['free_limit_warning:no_card']);

    // 100% without a card: hard stop in production only.
    await deliverProductionUsers(services, stopOrg, 238, 298, clock.now());
    await pass(services);
    stopPlan = await services.core.freePlan.getPlan({ orgId: stopOrg.orgId });
    expect(stopPlan).toMatchObject({ plan: 'free', productionState: 'free_limit_reached' });
    expect(stopPlan.banners).toEqual([{ kind: 'free_limit_reached', limit: 'active_users' }]);
    const refused = await register(database, stopOrg, 'prod', 'refused');
    expect(refused).toMatchObject({ ok: false, code: 'production_paused' });
    const development = await register(database, stopOrg, 'dev', 'still-open');
    expect(development.ok).toBe(true);
    // Existing production wallets keep their sessions, so recovery and export stay reachable.
    await unlockFromGateway({ ...second.gateway, walletId: second.walletId, sessionLabel: 'stop' });
    expect(await noticeEmails(database, stopOrg)).toEqual([
      'free_limit_stop',
      'free_limit_warning:no_card',
    ]);

    // A verified card after the stop moves the account to Growth at once.
    const verified = await addCard(services, stopOrg);
    expect(verified.verified).toBe(true);
    expect(verified.plan).toMatchObject({ plan: 'growth', productionState: 'active' });
    const pinned = await queryD1One(
      database,
      `SELECT price_version, plan_started_at_ms, price_locked_until_ms FROM billing_account_plans
       WHERE namespace = ? AND org_id = ?`,
      [namespace, stopOrg.orgId],
    );
    expect(pinned?.price_version).toBe('wallet-growth-v1');
    const lockedUntil = new Date(Number(pinned?.price_locked_until_ms));
    const startedAt = new Date(Number(pinned?.plan_started_at_ms));
    expect(
      (lockedUntil.getUTCFullYear() - startedAt.getUTCFullYear()) * 12 +
        lockedUntil.getUTCMonth() -
        startedAt.getUTCMonth(),
    ).toBe(12);
    expect((await register(database, stopOrg, 'prod', 'after-growth')).ok).toBe(true);
    await pass(services);
    expect(await noticeEmails(database, stopOrg)).toEqual([
      'free_limit_stop',
      'free_limit_warning:no_card',
      'growth_move',
    ]);
    evidence.stop = { plan: await services.core.freePlan.getPlan({ orgId: stopOrg.orgId }) };

    // With a card on file, the limit moves the account to Growth with no stop.
    await addCard(services, carded);
    await deliverProductionUsers(services, carded, 0, 240, clock.now());
    await pass(services);
    expect(await noticeEmails(database, carded)).toEqual(['free_limit_warning:card']);
    await deliverProductionUsers(services, carded, 240, 300, clock.now());
    await pass(services);
    const cardedPlan = await services.core.freePlan.getPlan({ orgId: carded.orgId });
    expect(cardedPlan).toMatchObject({ plan: 'growth', productionState: 'active' });
    expect(await noticeEmails(database, carded)).toEqual(['free_limit_warning:card', 'growth_move']);
    const replayed = PlatformPlanUsageEventV1.parse({
      version: 1,
      kind: 'plan_usage',
      eventId: `bulk-user-${carded.orgId}-0`,
      instanceId: `wallet:${carded.projectId}`,
      occurredAt: clock.now().toISOString(),
      measure: {
        kind: 'production_active_user',
        environmentId: `${carded.projectId}:prod`,
        userKey: 'bulk-user-0',
      },
    });
    if (replayed.kind === 'rejected') throw new Error('Fixture replay is invalid');
    expect(
      await services.core.freePlan.recordProductionUsage(
        { serviceId: 'wallet', deploymentId: carded.productionLane },
        replayed.value,
      ),
    ).toEqual({ kind: 'accepted', value: { kind: 'already_counted' } });
    expect(
      await services.core.freePlan.recordProductionUsage(
        { serviceId: 'wallet', deploymentId: clockOrg.productionLane },
        replayed.value,
      ),
    ).toEqual({ kind: 'rejected', error: { code: 'scope_forbidden' } });
    evidence.carded = { plan: cardedPlan };

    // The 60-day card clock: reminders, then the production stop.
    clock.ms = startMs + 29 * DAY_MS + 3_600_000;
    await pass(services);
    expect(await noticeEmails(database, clockOrg)).toEqual([]);
    clock.ms = startMs + 30 * DAY_MS + 3_600_000;
    await pass(services);
    await pass(services);
    expect(await noticeEmails(database, clockOrg)).toEqual(['card_reminder:30']);
    let clockPlan = await services.core.freePlan.getPlan({ orgId: clockOrg.orgId });
    expect(clockPlan.banners).toEqual([{ kind: 'card_due', deadlineAt: clockPlan.cardDeadlineAt }]);
    for (const day of [46, 53, 59]) {
      clock.ms = startMs + day * DAY_MS + 3_600_000;
      await pass(services);
    }
    clock.ms = startMs + 60 * DAY_MS + 3_600_000;
    await pass(services);
    expect(await noticeEmails(database, clockOrg)).toEqual([
      'card_reminder:30',
      'card_reminder:46',
      'card_reminder:53',
      'card_reminder:59',
      'card_required',
    ]);
    clockPlan = await services.core.freePlan.getPlan({ orgId: clockOrg.orgId });
    expect(clockPlan).toMatchObject({ plan: 'free', productionState: 'card_required' });
    expect(await register(database, clockOrg, 'prod', 'day-60')).toMatchObject({
      ok: false,
      code: 'production_paused',
    });
    expect((await register(database, clockOrg, 'dev', 'day-60')).ok).toBe(true);

    // Another organization cannot verify this organization's setup session.
    const foreign = await services.core.freePlan.startCardSetup({
      orgId: clockOrg.orgId,
      actorUserId: clockOrg.ownerUserId,
    });
    await expect(
      services.core.freePlan.reconcileCardSetup({ orgId: carded.orgId }, foreign.checkoutSessionId),
    ).rejects.toMatchObject({ code: 'card_setup_not_found' } satisfies Partial<ConsoleBillingError>);

    // A card ends the restriction at once; it stays on Free inside the limits.
    clockPlan = (await services.core.freePlan.reconcileCardSetup(
      { orgId: clockOrg.orgId },
      foreign.checkoutSessionId,
    )).plan;
    expect(clockPlan).toMatchObject({ plan: 'free', productionState: 'active' });
    expect((await register(database, clockOrg, 'prod', 'with-card')).ok).toBe(true);

    // A detached card has the same effect as no card.
    const method = await queryD1One(
      database,
      'SELECT provider_method_ref FROM billing_payment_methods WHERE namespace = ? AND org_id = ?',
      [namespace, clockOrg.orgId],
    );
    const detached = parseStripeCardSetupWebhookEvent({
      id: 'evt_free_plan_detached',
      type: 'payment_method.detached',
      data: { object: { id: String(method?.provider_method_ref) } },
    });
    if (!detached) throw new Error('Detached card event was not parsed');
    expect(await services.core.freePlan.handleWebhookEvent(detached)).toEqual({ accepted: true });
    clockPlan = await services.core.freePlan.getPlan({ orgId: clockOrg.orgId });
    expect(clockPlan).toMatchObject({ productionState: 'card_required', card: { kind: 'removed' } });

    // A replacement card that later expires restricts production again.
    const replacement = await addCard(services, clockOrg);
    expect(replacement.plan.productionState).toBe('active');
    clock.ms = Date.UTC(cardExpiry.getUTCFullYear(), cardExpiry.getUTCMonth() + 1, 1, 1);
    await pass(services);
    clockPlan = await services.core.freePlan.getPlan({ orgId: clockOrg.orgId });
    expect(clockPlan).toMatchObject({ productionState: 'card_required', card: { kind: 'expired' } });
    expect(await noticeEmails(database, clockOrg)).toEqual([
      'card_reminder:30',
      'card_reminder:46',
      'card_reminder:53',
      'card_reminder:59',
      'card_required',
    ]);
    evidence.clock = { plan: clockPlan };
    await writeFile(path.join(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await worker.dispose();
  }
});
