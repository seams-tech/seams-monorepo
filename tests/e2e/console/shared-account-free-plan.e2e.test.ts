import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { PlatformPlanUsageEventV1 } from '../../../packages/console-shared-ts/src/accountPlatform';
import { createSimulatedBillingProviderAdapters } from '../../../packages/console-server-ts/src/billing/providers';
import { parseStripeCardSetupWebhookEvent } from '../../../packages/console-server-ts/src/billing/stripeWebhook';
import { ConsoleBillingError } from '../../../packages/console-server-ts/src/billing/errors';
import { runD1ConsoleBillingMonthlyFinalization } from '../../../packages/console-server-ts/src/billing/d1';
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
  activateRegionalGatewayFixture,
  fourRegionBinding,
  fourRegionProductionBinding,
} from '../../helpers/tenantDeploymentFixtures';
import type { TenantDeploymentBindingV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/types';
import { TenantDeploymentD1ResourceIdentityV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/deploymentResource';
import { parseTenantRuntimeWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import {
  handleRegionalProductionAdmission,
  syncRegionalProductionAdmission,
} from '../../../packages/wallet-console-server-ts/src/tenantDeployment/productionAdmission';
import { resumeGatewaySignatureCompletions } from '../../../packages/wallet-console-server-ts/src/walletPlacement/signatureCompletions';
import {
  publishSignaturesFromGateway,
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
  WalletHome.parse({
    region: 'WEUR',
    accountId,
    databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }),
  WalletHome.parse({
    region: 'APAC',
    accountId,
    databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  }),
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

function runtime(state = 'state'): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Free plan acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { DB: 'free-plan', SIGNER_DB: 'free-plan-signer' },
    d1Persist: path.join(output, state),
  });
}

/** SIGNER_DB migrations of the candidate package when given, else of the installed one. */
const signerMigrations = path.join(
  process.env.SEAMS_WALLET_SERVER_CANDIDATE ??
    path.dirname(
      createRequire(
        path.join(repository, 'packages/wallet-console-server-ts/package.json'),
      ).resolve('@seams/wallet-server/package.json'),
    ),
  'migrations/d1-signer',
);

async function migratedDatabase(
  worker: Miniflare,
  binding: 'DB' | 'SIGNER_DB' = 'DB',
): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database(binding);
  if (!isD1DatabaseLike(database)) throw new Error('Free plan D1 binding is unavailable');
  const directory =
    binding === 'DB'
      ? path.join(repository, 'packages/wallet-console-server-ts/migrations/d1-console')
      : signerMigrations;
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
): Promise<{ readonly production: TenantDeploymentBindingV1 }> {
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
  const production = await fourRegionProductionBinding(Date.now(), org.productionLane, tenantScope);
  await activateConsoleDeploymentFixture(database, production, `tco_${org.productionLane}`);
  await activateConsoleDeploymentFixture(
    database,
    await fourRegionBinding(Date.now(), org.developmentLane, {
      ...tenantScope,
      environmentId: `${org.projectId}:dev`,
    }),
    `tco_${org.developmentLane}`,
  );
  return { production };
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
  return rows
    .map((row) => {
      const payload = JSON.parse(String(row.template_payload_json)) as {
        notice: { kind: string; day?: number; cardOnFile?: boolean };
      };
      return payload.notice.kind === 'card_reminder'
        ? `card_reminder:${payload.notice.day}`
        : payload.notice.kind === 'free_limit_warning'
          ? `free_limit_warning:${payload.notice.cardOnFile ? 'card' : 'no_card'}`
          : payload.notice.kind;
    })
    .sort();
}

async function addCard(services: Product, org: Organization) {
  const ctx = { orgId: org.orgId, actorUserId: org.ownerUserId };
  const setup = await services.core.freePlan.startCardSetup(ctx);
  // The simulated success redirect carries the session id; verification is server side.
  const returned = new URL(setup.url).searchParams.get('checkout_session_id');
  expect(returned).toBe(setup.checkoutSessionId);
  return await services.core.freePlan.reconcileCardSetup(ctx, setup.checkoutSessionId);
}

async function planBaseCharges(database: D1DatabaseLike, orgId: string) {
  return await queryD1All(
    database,
    `SELECT month_utc, plan, price_version, period_start_ms, period_end_ms, amount_minor
       FROM billing_plan_base_charges
      WHERE namespace = ? AND org_id = ?
      ORDER BY month_utc`,
    [namespace, orgId],
  );
}

test('Free plan: card clock, production-only counts, notices, hard stop, and the move to Growth', async () => {
  test.setTimeout(240_000);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const startMs = Date.now();
  const clock = new Clock(startMs);
  // The setup card expires in the month after day 100, so day 30 still sees a usable card.
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
      `SELECT price_version, plan_started_at_ms FROM billing_account_plans
       WHERE namespace = ? AND org_id = ?`,
      [namespace, stopOrg.orgId],
    );
    expect(pinned?.price_version).toBe('wallet-growth-v1');
    expect(Number(pinned?.plan_started_at_ms)).toBe(clock.ms);
    expect(await planBaseCharges(database, stopOrg.orgId)).toMatchObject([
      { plan: 'growth', price_version: 'wallet-growth-v1', period_start_ms: clock.ms },
    ]);
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
    expect(await planBaseCharges(database, carded.orgId)).toMatchObject([
      { plan: 'growth', price_version: 'wallet-growth-v1', period_start_ms: clock.ms },
    ]);
    expect(await noticeEmails(database, carded)).toEqual([
      'free_limit_warning:card',
      'growth_move',
    ]);
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

    // The 30-day card clock: reminders, then the production stop.
    clock.ms = startMs + 15 * DAY_MS + 3_600_000;
    await pass(services);
    expect(await noticeEmails(database, clockOrg)).toEqual([]);
    clock.ms = startMs + 16 * DAY_MS + 3_600_000;
    await pass(services);
    await pass(services);
    expect(await noticeEmails(database, clockOrg)).toEqual(['card_reminder:16']);
    let clockPlan = await services.core.freePlan.getPlan({ orgId: clockOrg.orgId });
    expect(clockPlan.banners).toEqual([{ kind: 'card_due', deadlineAt: clockPlan.cardDeadlineAt }]);
    for (const day of [23, 29]) {
      clock.ms = startMs + day * DAY_MS + 3_600_000;
      await pass(services);
    }
    clock.ms = startMs + 30 * DAY_MS + 3_600_000;
    await pass(services);
    expect(await noticeEmails(database, clockOrg)).toEqual([
      'card_reminder:16',
      'card_reminder:23',
      'card_reminder:29',
      'card_required',
    ]);
    clockPlan = await services.core.freePlan.getPlan({ orgId: clockOrg.orgId });
    expect(clockPlan).toMatchObject({ plan: 'free', productionState: 'card_required' });
    expect(await register(database, clockOrg, 'prod', 'day-30')).toMatchObject({
      ok: false,
      code: 'production_paused',
    });
    expect((await register(database, clockOrg, 'dev', 'day-30')).ok).toBe(true);

    // Another organization cannot verify this organization's setup session.
    const foreign = await services.core.freePlan.startCardSetup({
      orgId: clockOrg.orgId,
      actorUserId: clockOrg.ownerUserId,
    });
    await expect(
      services.core.freePlan.reconcileCardSetup({ orgId: carded.orgId }, foreign.checkoutSessionId),
    ).rejects.toMatchObject({
      code: 'card_setup_not_found',
    } satisfies Partial<ConsoleBillingError>);

    // A card ends the restriction at once; it stays on Free inside the limits.
    clockPlan = (
      await services.core.freePlan.reconcileCardSetup(
        { orgId: clockOrg.orgId },
        foreign.checkoutSessionId,
      )
    ).plan;
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
    expect(clockPlan).toMatchObject({
      productionState: 'card_required',
      card: { kind: 'removed' },
    });

    // A replacement card that later expires restricts production again.
    const replacement = await addCard(services, clockOrg);
    expect(replacement.plan.productionState).toBe('active');
    clock.ms = Date.UTC(cardExpiry.getUTCFullYear(), cardExpiry.getUTCMonth() + 1, 1, 1);
    await pass(services);
    clockPlan = await services.core.freePlan.getPlan({ orgId: clockOrg.orgId });
    expect(clockPlan).toMatchObject({
      productionState: 'card_required',
      card: { kind: 'expired' },
    });
    expect(await noticeEmails(database, clockOrg)).toEqual([
      'card_reminder:16',
      'card_reminder:23',
      'card_reminder:29',
      'card_required',
    ]);
    evidence.clock = { plan: clockPlan };
    await writeFile(path.join(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await worker.dispose();
  }
});

test('Plan start: a verified card starts Growth or Pro once, and only from Free', async () => {
  test.setTimeout(240_000);
  await rm(path.join(output, 'plan-start'), { recursive: true, force: true });
  const clock = new Clock(Date.parse('2026-10-22T12:00:00.000Z'));
  const worker = runtime('plan-start');
  try {
    const database = await migratedDatabase(worker);
    const services = await product(database, clock, new Date(clock.ms + 400 * DAY_MS));
    const pro = organization('start-pro');
    const growth = organization('start-growth');
    const enterprise = organization('start-enterprise');
    for (const org of [pro, growth, enterprise]) await createOrganization(database, services, org);
    const context = (org: Organization) => ({ orgId: org.orgId, actorUserId: org.ownerUserId });

    // A card setup that starts Pro returns to the plan page, and the verified card starts Pro.
    const setup = await services.core.freePlan.startCardSetup(context(pro), 'pro');
    const returned = new URL(setup.url);
    expect(returned.pathname).toBe('/dashboard/billing/plan');
    expect(returned.searchParams.get('plan')).toBe('pro');
    expect(returned.searchParams.get('card_setup')).toBe('success');
    const verified = await services.core.freePlan.reconcileCardSetup(
      { orgId: pro.orgId },
      setup.checkoutSessionId,
    );
    expect(verified).toMatchObject({
      verified: true,
      plan: { plan: 'pro', priceVersion: 'wallet-pro-v1', productionState: 'active' },
    });
    const startedAt = verified.plan.planStartedAt;
    if (!startedAt) throw new Error('Pro plan start time was missing');
    const proStartCharges = await planBaseCharges(database, pro.orgId);
    expect(proStartCharges).toHaveLength(1);
    expect(proStartCharges[0]).toMatchObject({
      month_utc: '2026-10',
      plan: 'pro',
      price_version: 'wallet-pro-v1',
      period_start_ms: Date.parse(startedAt),
    });
    expect(Number(proStartCharges[0]?.amount_minor)).toBe(12_228);

    // A replayed return or webhook does not start the plan again or move its start date.
    clock.ms += DAY_MS;
    const replayed = await services.core.freePlan.reconcileCardSetup(
      { orgId: pro.orgId },
      setup.checkoutSessionId,
    );
    expect(replayed.plan).toMatchObject({ plan: 'pro', planStartedAt: startedAt });
    const webhook = parseStripeCardSetupWebhookEvent({
      id: 'evt_plan_start_replay',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: setup.checkoutSessionId,
          mode: 'setup',
          client_reference_id: pro.orgId,
          metadata: { org_id: pro.orgId },
        },
      },
    });
    if (!webhook) throw new Error('Setup completion event was not parsed');
    await services.core.freePlan.handleWebhookEvent(webhook);
    expect(await services.core.freePlan.getPlan({ orgId: pro.orgId })).toMatchObject({
      plan: 'pro',
      planStartedAt: startedAt,
    });
    expect(await planBaseCharges(database, pro.orgId)).toEqual(proStartCharges);

    // Only a Free organization starts a plan.
    await expect(services.core.freePlan.startCardSetup(context(pro), 'pro')).rejects.toMatchObject({
      code: 'plan_already_active',
    } satisfies Partial<ConsoleBillingError>);
    await expect(services.core.freePlan.startPlan(context(pro), 'growth')).rejects.toMatchObject({
      code: 'plan_change_unsupported',
    } satisfies Partial<ConsoleBillingError>);

    // Without a card the start is refused; with the card on file it starts at once, once.
    await expect(services.core.freePlan.startPlan(context(growth), 'growth')).rejects.toMatchObject(
      { code: 'card_required' } satisfies Partial<ConsoleBillingError>,
    );
    expect((await addCard(services, growth)).plan).toMatchObject({ plan: 'free' });
    expect(await services.core.freePlan.startPlan(context(growth), 'growth')).toMatchObject({
      plan: 'growth',
      priceVersion: 'wallet-growth-v1',
      productionState: 'active',
    });
    const growthStartCharges = await planBaseCharges(database, growth.orgId);
    expect(growthStartCharges).toHaveLength(1);
    expect(growthStartCharges[0]).toMatchObject({
      month_utc: '2026-10',
      plan: 'growth',
      price_version: 'wallet-growth-v1',
    });
    expect(Number(growthStartCharges[0]?.amount_minor)).toBe(2_715);
    await expect(services.core.freePlan.startPlan(context(growth), 'growth')).rejects.toMatchObject(
      { code: 'plan_already_active' } satisfies Partial<ConsoleBillingError>,
    );

    // An Enterprise contract never changes from the Console.
    await addCard(services, enterprise);
    await database
      .prepare(
        `UPDATE billing_account_plans SET plan = 'enterprise', plan_started_at_ms = ?,
           price_version = 'enterprise-contract-v1' WHERE namespace = ? AND org_id = ?`,
      )
      .bind(clock.ms, namespace, enterprise.orgId)
      .run();
    await expect(
      services.core.freePlan.startPlan(context(enterprise), 'pro'),
    ).rejects.toMatchObject({
      code: 'plan_change_unsupported',
    } satisfies Partial<ConsoleBillingError>);

    const unbilled = organization('start-without-base-charge');
    await createOrganization(database, services, unbilled);
    await expect(
      database
        .prepare(
          `UPDATE billing_account_plans SET plan = 'growth', plan_started_at_ms = ?,
             price_version = 'wallet-growth-v1', production_state = 'active'
           WHERE namespace = ? AND org_id = ?`,
        )
        .bind(clock.ms, namespace, unbilled.orgId)
        .run(),
    ).rejects.toThrow('paid_plan_base_charge_required');
    expect((await services.core.freePlan.getPlan({ orgId: unbilled.orgId })).plan).toBe('free');
    expect(await planBaseCharges(database, unbilled.orgId)).toHaveLength(0);

    clock.ms = Date.parse('2026-11-02T12:00:00.000Z');
    await services.core.freePlan.runScheduledPass({ limit: 50 });
    const proCharges = await planBaseCharges(database, pro.orgId);
    const growthCharges = await planBaseCharges(database, growth.orgId);
    expect(proCharges).toHaveLength(2);
    expect(growthCharges).toHaveLength(2);
    expect(proCharges[1]).toMatchObject({ month_utc: '2026-11', amount_minor: 39_900 });
    expect(growthCharges[1]).toMatchObject({ month_utc: '2026-11', amount_minor: 9_900 });
    await services.core.freePlan.runScheduledPass({ limit: 50 });
    expect(await planBaseCharges(database, pro.orgId)).toEqual(proCharges);
    expect(await planBaseCharges(database, growth.orgId)).toEqual(growthCharges);

    clock.ms = Date.parse('2027-01-02T12:00:00.000Z');
    const monthlyClose = await runD1ConsoleBillingMonthlyFinalization({
      database,
      namespace,
      orgIds: [pro.orgId, growth.orgId],
      periodMonthUtc: '2026-12',
      now: clock.now.bind(clock),
    });
    expect(monthlyClose.failures).toEqual([]);
    const finalProCharges = await planBaseCharges(database, pro.orgId);
    const finalGrowthCharges = await planBaseCharges(database, growth.orgId);
    expect(finalProCharges).toHaveLength(3);
    expect(finalGrowthCharges).toHaveLength(3);
    expect(finalProCharges[2]).toMatchObject({ month_utc: '2026-12', amount_minor: 39_900 });
    expect(finalGrowthCharges[2]).toMatchObject({ month_utc: '2026-12', amount_minor: 9_900 });

    const evidencePath = path.join(output, 'plan-base-charges.json');
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          proCharges: finalProCharges,
          growthCharges: finalGrowthCharges,
          unbilledPlanRejected: true,
          replayKeptOneFirstMonthCharge: true,
          monthlyAccrualIdempotent: true,
        },
        null,
        2,
      )}\n`,
    );
    await test.info().attach('plan-base-charges', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await worker.dispose();
  }
});

function regionalRuntimes(
  signer: D1DatabaseLike,
  binding: TenantDeploymentBindingV1,
  writer: ReturnType<typeof parseTenantRuntimeWriterV1>,
) {
  const resource = TenantDeploymentD1ResourceIdentityV1.parse({
    namespace,
    accountId: writer.resource.accountId,
    databaseId: writer.resource.databaseId,
  });
  // Every region of this fixture shares one SIGNER_DB; production has one per region.
  const runtime = {
    async fetch(request: Request): Promise<Response> {
      const response = await handleRegionalProductionAdmission(request, {
        database: signer,
        resource,
        versionId: writer.versionId,
        deploymentLane: binding.deploymentLane,
      });
      if (!response) throw new Error('Unexpected runtime route');
      return response;
    },
  };
  return { US: runtime, WEUR: runtime, APAC: runtime, OC: runtime };
}

async function productionSigningPolicy(signer: D1DatabaseLike, org: Organization) {
  return await queryD1One(
    signer,
    `SELECT decision, retry_after_ms, env_id FROM router_ab_normal_signing_admission_records
     WHERE namespace = ? AND org_id = ? AND project_id = ? AND record_kind = 'project_policy'`,
    [namespace, org.orgId, org.projectId],
  );
}

test('Free plan stops production signing through the regional signing policy', async () => {
  test.setTimeout(240_000);
  await rm(path.join(output, 'signing-state'), { recursive: true, force: true });
  const clock = new Clock(Date.now());
  const worker = runtime('signing-state');
  try {
    const database = await migratedDatabase(worker);
    const signer = await migratedDatabase(worker, 'SIGNER_DB');
    const services = await product(database, clock, new Date(clock.ms + 400 * DAY_MS));
    const org = organization('signing');
    const { production } = await createOrganization(database, services, org);
    const writer = parseTenantRuntimeWriterV1(
      'walletRuntime',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      {
        accountId,
        databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    );
    await activateRegionalGatewayFixture(signer, production, writer);
    const runtimes = regionalRuntimes(signer, production, writer);
    const sync = () =>
      syncRegionalProductionAdmission({
        database,
        deploymentLane: org.productionLane,
        runtimes,
        nowMs: clock.ms,
      });

    // An active account opens production signing once; an unchanged decision is not resent.
    await pass(services);
    expect(await sync()).toBe('pushed');
    expect(await sync()).toBe('unchanged');
    expect(await productionSigningPolicy(signer, org)).toMatchObject({
      decision: 'allowed',
      env_id: 'prod',
    });

    // The Free limit without a card pauses new production signatures.
    await deliverProductionUsers(services, org, 0, 300, clock.now());
    await pass(services);
    expect((await services.core.freePlan.getPlan({ orgId: org.orgId })).productionState).toBe(
      'free_limit_reached',
    );
    expect(await sync()).toBe('pushed');
    expect(await productionSigningPolicy(signer, org)).toEqual({
      decision: 'rejected',
      retry_after_ms: 3_600_000,
      env_id: 'prod',
    });

    // A verified card moves the account to Growth and opens signing again.
    await addCard(services, org);
    expect(await sync()).toBe('pushed');
    expect(await productionSigningPolicy(signer, org)).toMatchObject({ decision: 'allowed' });

    // The Console repeats its decision after an hour, so a lost or stale push heals.
    clock.ms += 3_600_001;
    expect(await sync()).toBe('pushed');
  } finally {
    await worker.dispose();
  }
});

test('Gateway delivers completed production signatures to the Free plan count once', async () => {
  test.skip(
    !existsSync(path.join(signerMigrations, '0082_wallet_signature_completions.sql')),
    'Requires @seams/wallet-server with SIGNER_DB migration 0082; set SEAMS_WALLET_SERVER_CANDIDATE',
  );
  test.setTimeout(240_000);
  await rm(path.join(output, 'delivery-state'), { recursive: true, force: true });
  const clock = new Clock(Date.now());
  const worker = runtime('delivery-state');
  try {
    const database = await migratedDatabase(worker);
    const signer = await migratedDatabase(worker, 'SIGNER_DB');
    const services = await product(database, clock, new Date(clock.ms + 400 * DAY_MS));
    const org = organization('delivery');
    const { production } = await createOrganization(database, services, org);
    // The completion trigger in seams-wallet writes these rows; its own journey covers it.
    const completed = async (operationId: string, envId: string | null) =>
      await signer
        .prepare(
          `INSERT INTO wallet_signature_completions
            (namespace, tenant_id, authorized_operation_id, operation_kind, org_id, project_id,
              env_id, completed_at_ms)
           VALUES (?, ?, ?, 'evm.sign_transaction', ?, ?, ?, ?)`,
        )
        .bind(
          namespace,
          org.orgId,
          operationId,
          envId === null ? null : org.orgId,
          envId === null ? null : org.projectId,
          envId,
          clock.ms,
        )
        .run();
    await completed('signature-step-up', null);
    await completed('signature-session', production.tenant.environmentId);
    await completed('signature-other-environment', `${org.projectId}:dev`);
    const authority = {
      publishSignatures: (signatures: readonly { signatureId: string; completedAtMs: number }[]) =>
        publishSignaturesFromGateway({
          database,
          catalogJson,
          region: 'US',
          localRegion: 'US',
          tenant: tenant(org, 'prod'),
          signatures,
        }),
    };
    expect(
      await resumeGatewaySignatureCompletions({ database: signer, binding: production, authority }),
    ).toEqual({ delivered: 2, discarded: 0 });
    // A lost acknowledgement replays the same signatures; the count does not move.
    await completed('signature-session', production.tenant.environmentId);
    expect(
      await resumeGatewaySignatureCompletions({ database: signer, binding: production, authority }),
    ).toEqual({ delivered: 1, discarded: 0 });
    expect(await deliverOutbox(database, services, org)).toEqual({ delivered: 2, pending: 0 });
    expect(
      (await services.core.freePlan.getPlan({ orgId: org.orgId })).usage.productionSignatures,
    ).toBe(2);
    expect(
      (
        await queryD1All(
          signer,
          'SELECT authorized_operation_id FROM wallet_signature_completions',
          [],
        )
      ).map((row) => row.authorized_operation_id),
    ).toEqual(['signature-other-environment']);
  } finally {
    await worker.dispose();
  }
});
