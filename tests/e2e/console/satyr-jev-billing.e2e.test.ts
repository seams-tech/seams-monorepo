import { expect, test } from '@playwright/test';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  PlatformUsageEventV1,
  ReserveFundsRequestV1,
  satyrJevExecutionIdV1,
  type FundsReservationV1,
  type SatyrJevFeatureV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import type { ConsoleAccountIdentityContext } from '../../../packages/console-server-ts/src/account/service';
import type { ServiceProducerAuthorityV1 } from '../../../packages/console-server-ts/src/accountPlatform/types';
import {
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
} from '../../../packages/console-server-ts/src/boundary/d1';
import { ConsoleSessionService } from '../../../packages/console-server-ts/src/boundary/session';
import { listD1BillingUsageCharges } from '../../../packages/console-server-ts/src/billing/attribution';
import { getConsoleBillingD1Runtime } from '../../../packages/console-server-ts/src/billing/d1';
import {
  approveCreditLimit,
  CreditLimitApproval,
  getPostpaidAccount,
  readBillingPaymentPolicy,
} from '../../../packages/console-server-ts/src/billing/postpaid';
import { createSimulatedBillingProviderAdapters } from '../../../packages/console-server-ts/src/billing/providers';
import type { SatyrTestPricingPolicyV1 } from '../../../packages/console-server-ts/src/billing/usage';
import { createAppSessionConsoleAuthAdapter } from '../../../packages/console-server-ts/src/router/consoleAppSessionAuth';
import {
  createAccountConsoleRouter,
  type AccountConsoleFetchHandler,
} from '../../../packages/console-server-ts/src/router/cloudflare/createAccountConsoleRouter';
import {
  createCloudflareD1AccountServiceBundle,
  type CloudflareD1AccountServiceBundle,
} from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { createInMemoryConsoleSessionRevocationStore } from '../../helpers/consoleSessionRevocationStore';
import {
  acceptedBillingResult as accepted,
  enableBillingService,
} from '../../helpers/billingService.fixtures';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/satyr-jev');
const origin = 'https://satyr-jev.acceptance.invalid';
const secret = 'isolated-satyr-jev-acceptance-session-secret';
const satyr = { serviceId: 'satyr', deploymentId: 'jev-satyr' } as const;
const jevPrice = 'satyr-jev-input-tokens-v1';
const jevCustomerPrice = 'satyr-jev-input-tokens-customer-v1';
const includedTokens = 23_809_523;
const ownerUser = 'verified-jev-owner';

function now(): Date {
  return new Date('2026-10-13T02:00:00.000Z');
}

/** The month's charge: one rounding up of the tokens above the included use. */
function expectedMonthMinor(monthTokens: number): number {
  const above = BigInt(Math.max(0, monthTokens - includedTokens));
  return Number((above * 84n + 9_999_999n) / 10_000_000n);
}

function runtime(name: string): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Satyr Jev acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: name },
    d1Persist: path.join(output, name),
  });
}

async function databaseOf(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('CONSOLE_DB');
  if (!isD1DatabaseLike(database)) throw new Error('Jev D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<readonly string[]> {
  const directory = path.join(repository, 'packages/console-server-ts/migrations/d1-console-core');
  const applied: string[] = [];
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith('.sql')) continue;
    const prepared = [];
    for (const statement of unstable_splitSqlQuery(
      await readFile(path.join(directory, filename), 'utf8'),
    ))
      prepared.push(database.prepare(statement));
    await database.batch(prepared);
    applied.push(filename);
  }
  return applied;
}

function identity(userId: string, orgId: string | null): ConsoleAccountIdentityContext {
  return {
    userId,
    email: `${userId}@jev.invalid`,
    name: userId,
    provider: 'oidc',
    platformSupport: false,
    orgId,
    projectId: null,
  };
}

function signToken(input: { header: { typ: 'JWT' }; payload: Record<string, unknown> }): string {
  const payload = Buffer.from(JSON.stringify(input.payload)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

function verifyToken(token: string): { valid: boolean; payload?: unknown } {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return { valid: false };
  const supplied = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return { valid: false };
  return { valid: true, payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) };
}

function ready(): void {}

async function compose(
  database: D1DatabaseLike,
  namespace: string,
  satyrTestPricing: SatyrTestPricingPolicyV1,
) {
  const core = await createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    externalDeletionGuard: null,
    ensureSchema: true,
    now,
    satyrTestPricing,
    billingProviders: createSimulatedBillingProviderAdapters(),
    billingEmailConsoleBaseUrl: origin,
  });
  const session = new ConsoleSessionService({
    jwt: { signToken, verifyToken },
    revocations: createInMemoryConsoleSessionRevocationStore(),
    cookie: {
      name: 'jev-session',
      buildSetHeader: (token: string) => `jev-session=${token}; HttpOnly; Path=/`,
      buildClearHeader: () => 'jev-session=; Max-Age=0; Path=/',
    },
  });
  const router = createAccountConsoleRouter({
    services: core,
    auth: createAppSessionConsoleAuthAdapter({
      session,
      organizationAccess: core.organizationAccess,
    }),
    session,
    readyCheck: ready,
    walletProvisioning: null,
    satyrProvisioning: null,
    billingStripeWebhookSigningSecret: null,
  });
  return { core, session, router };
}

/** Organisations exist before the isolated test pricing names them. */
async function openAccounts(
  database: D1DatabaseLike,
  namespace: string,
  orgIds: readonly string[],
  isolated: readonly string[],
) {
  const first = await compose(database, namespace, { kind: 'disabled' });
  for (const orgId of orgIds)
    await first.core.account.createOrganization(identity(ownerUser, null), {
      id: orgId,
      name: orgId,
    });
  return compose(database, namespace, { kind: 'isolated_e2e', organizationIds: isolated });
}

async function enableSatyr(
  core: CloudflareD1AccountServiceBundle,
  namespace: string,
  orgId: string,
): Promise<string> {
  const context = { orgId, actorUserId: ownerUser };
  const projectId = `${orgId}-project`;
  await core.orgProjects.createProject(context, { id: projectId, name: `${orgId} project` });
  return enableBillingService(core, context, projectId, satyr, namespace);
}

function jevHour(input: {
  readonly instanceId: string;
  readonly eventId: string;
  readonly feature: SatyrJevFeatureV1;
  readonly hourStart: string;
  readonly tokens: number;
  readonly reservation: FundsReservationV1 | null;
}): PlatformUsageEventV1 {
  return accepted(
    PlatformUsageEventV1.parse({
      version: 1,
      eventId: input.eventId,
      instanceId: input.instanceId,
      occurredAt: input.hourStart,
      meterId: 'satyr.jev_input_tokens',
      quantity: input.tokens,
      unit: 'input_token',
      evidence: {
        kind: 'satyr_jev_hour',
        sourceRecordId: `jev-hour:${input.eventId}`,
        sourceDigest: 'f'.repeat(64),
        hourStart: input.hourStart,
        feature: input.feature,
        reservationId: input.reservation?.reservationId ?? null,
      },
    }),
  );
}

/** Satyr holds 5 cents for one feature-hour before it calls Jev above the free use. */
async function reserveHour(
  core: CloudflareD1AccountServiceBundle,
  authority: ServiceProducerAuthorityV1,
  instanceId: string,
  feature: SatyrJevFeatureV1,
  hourStart: string,
  priceVersion: string = jevPrice,
) {
  const executionId = satyrJevExecutionIdV1(feature, hourStart);
  return core.funds.reserve(
    authority,
    accepted(
      ReserveFundsRequestV1.parse({
        version: 1,
        operationId: `reserve:${instanceId}:${executionId}:${priceVersion}`,
        instanceId,
        executionId,
        requestedMinor: 5,
        priceVersion,
      }),
    ),
  );
}

/** The price version that each stored Jev record and its receipt name. */
async function recordedVersions(database: D1DatabaseLike, namespace: string, orgId: string) {
  return queryD1All(
    database,
    `SELECT e.event_id, e.price_version AS event_version, r.price_version AS receipt_version, r.outcome
    FROM billing_usage_events e JOIN billing_usage_receipts r
      USING (namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
    WHERE e.namespace = ? AND e.org_id = ? AND e.meter_id = 'satyr.jev_input_tokens' ORDER BY e.occurred_at_ms`,
    [namespace, orgId],
  );
}

async function jevCharges(database: D1DatabaseLike, namespace: string, orgId: string) {
  const charges = await listD1BillingUsageCharges({
    database,
    namespace,
    organizationId: orgId,
    periodMonthUtc: '2026-10',
  });
  return charges.filter((charge) => charge.meterId === 'satyr.jev_input_tokens');
}

async function saveJson(name: string, value: unknown): Promise<void> {
  await writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
}

test.beforeAll(async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
});

test('Satyr Jev hours are priced once per UTC month above the free use', async () => {
  const namespace = 'satyr-jev-usage';
  const testOrg = 'jev-test-organisation';
  const customerOrg = 'jev-customer-organisation';
  const worker = runtime(namespace);
  try {
    const database = await databaseOf(worker);
    const migrations = await migrate(database);
    const { core } = await openAccounts(database, namespace, [testOrg, customerOrg], [testOrg]);
    const instanceId = await enableSatyr(core, namespace, testOrg);
    const customerInstance = await enableSatyr(core, namespace, customerOrg);
    await core.billing.grantManualSupportCredit(
      { orgId: testOrg, actorUserId: ownerUser },
      {
        amountMinor: 2000,
        reasonCode: 'acceptance',
        note: 'Isolated Jev acceptance',
        idempotencyKey: 'jev-funds',
      },
    );

    // Inside the free use: the month's charge stays zero and no hold is needed.
    for (const [eventId, feature, hourStart, tokens] of [
      ['free-mail', 'mail_classification', '2026-10-01T00:00:00.000Z', 20_000_000],
      ['free-cases', 'related_cases', '2026-10-01T01:00:00.000Z', 3_809_523],
    ] as const)
      expect(
        await core.billingUsage.record(
          satyr,
          jevHour({ instanceId, eventId, feature, hourStart, tokens, reservation: null }),
        ),
      ).toEqual({
        kind: 'accepted',
        value: { kind: 'recorded_without_charge', reason: 'nonbillable_outcome' },
      });
    expect(await jevCharges(database, namespace, testOrg)).toEqual([]);

    // One token above the free use raises the charge, so it needs an admitted hold.
    const unheld = jevHour({
      instanceId,
      eventId: 'paid-screen',
      feature: 'screen_relevance',
      hourStart: '2026-10-01T02:00:00.000Z',
      tokens: 1,
      reservation: null,
    });
    expect(await core.billingUsage.record(satyr, unheld)).toEqual({
      kind: 'rejected',
      error: { code: 'insufficient_funds' },
    });
    expect(
      await queryD1One(
        database,
        'SELECT COUNT(*) AS count FROM billing_usage_events WHERE event_id = ?',
        ['paid-screen'],
      ),
    ).toEqual({ count: 0 });

    const paid: { hourStart: string; feature: SatyrJevFeatureV1; tokens: number; id: string }[] = [
      {
        id: 'paid-screen',
        feature: 'screen_relevance',
        hourStart: '2026-10-01T02:00:00.000Z',
        tokens: 1,
      },
      {
        id: 'paid-mail',
        feature: 'mail_classification',
        hourStart: '2026-10-01T03:00:00.000Z',
        tokens: 1,
      },
      {
        id: 'paid-cases',
        feature: 'related_cases',
        hourStart: '2026-10-01T04:00:00.000Z',
        tokens: 500_000,
      },
    ];
    const receipts = [];
    const events = [];
    for (const hour of paid) {
      const reservation = accepted(
        await reserveHour(core, satyr, instanceId, hour.feature, hour.hourStart),
      ).reservation;
      const event = jevHour({
        instanceId,
        eventId: hour.id,
        feature: hour.feature,
        hourStart: hour.hourStart,
        tokens: hour.tokens,
        reservation,
      });
      events.push(event);
      receipts.push(accepted(await core.billingUsage.record(satyr, event)));
    }
    // A per-record rounding would charge 1 + 1 + 5 cents. The month is rounded once.
    expect(receipts.map((receipt) => receipt.amountMinor ?? 0)).toEqual([1, 0, 4]);
    expect(receipts[1]).toEqual({ kind: 'recorded_without_charge', reason: 'nonbillable_outcome' });
    const monthTokens = 20_000_000 + 3_809_523 + 1 + 1 + 500_000;
    const charges = await jevCharges(database, namespace, testOrg);
    const charged = charges.reduce((total, charge) => total + charge.amountMinor, 0);
    expect(expectedMonthMinor(monthTokens)).toBe(5);
    expect(charged).toBe(expectedMonthMinor(monthTokens));
    expect(charges.map((charge) => [charge.quantity, charge.unit, charge.priceVersion])).toEqual([
      [1, 'input_token', jevPrice],
      [500_000, 'input_token', jevPrice],
    ]);

    // The same record twice adds nothing; another payload for the same identity is a conflict.
    const ledgerBefore = await queryD1All(
      database,
      'SELECT id, amount_minor FROM billing_ledger_entries WHERE namespace = ? ORDER BY id',
      [namespace],
    );
    expect(await core.billingUsage.record(satyr, events[2])).toEqual({
      kind: 'accepted',
      value: receipts[2],
    });
    const changed = jevHour({
      instanceId,
      eventId: 'paid-cases',
      feature: 'related_cases',
      hourStart: '2026-10-01T04:00:00.000Z',
      tokens: 400_000,
      reservation: null,
    });
    expect(await core.billingUsage.record(satyr, changed)).toEqual({
      kind: 'rejected',
      error: { code: 'event_conflict' },
    });
    const secondIdentity = jevHour({
      instanceId,
      eventId: 'paid-cases-again',
      feature: 'related_cases',
      hourStart: '2026-10-01T04:00:00.000Z',
      tokens: 500_000,
      reservation: null,
    });
    expect(await core.billingUsage.record(satyr, secondIdentity)).toEqual({
      kind: 'rejected',
      error: { code: 'event_conflict' },
    });
    expect(
      await queryD1All(
        database,
        'SELECT id, amount_minor FROM billing_ledger_entries WHERE namespace = ? ORDER BY id',
        [namespace],
      ),
    ).toEqual(ledgerBefore);

    // Each UTC month has its own free use.
    expect(
      await core.billingUsage.record(
        satyr,
        jevHour({
          instanceId,
          eventId: 'september-mail',
          feature: 'mail_classification',
          hourStart: '2026-09-30T23:00:00.000Z',
          tokens: includedTokens,
          reservation: null,
        }),
      ),
    ).toEqual({
      kind: 'accepted',
      value: { kind: 'recorded_without_charge', reason: 'nonbillable_outcome' },
    });

    const overview = await core.billing.getOverview({ orgId: testOrg, actorUserId: ownerUser });
    expect(overview).toMatchObject({
      creditBalanceMinor: 1995,
      reservedMinor: 0,
      activeReservationCount: 0,
    });

    // The isolated test account still uses the test version for every record.
    const testVersions = await recordedVersions(database, namespace, testOrg);
    expect(testVersions).toHaveLength(6);
    for (const row of testVersions)
      expect(row).toMatchObject({ event_version: jevPrice, receipt_version: jevPrice });

    // A customer account uses the customer version, with the same terms.
    await core.billing.grantManualSupportCredit(
      { orgId: customerOrg, actorUserId: ownerUser },
      {
        amountMinor: 1000,
        reasonCode: 'acceptance',
        note: 'Customer Jev acceptance',
        idempotencyKey: 'jev-customer-funds',
      },
    );
    const customerFree = [];
    for (const [eventId, feature, hourStart, tokens] of [
      ['customer-mail', 'mail_classification', '2026-10-01T00:00:00.000Z', 20_000_000],
      ['customer-cases', 'related_cases', '2026-10-01T01:00:00.000Z', 3_809_523],
    ] as const)
      customerFree.push(
        await core.billingUsage.record(
          satyr,
          jevHour({
            instanceId: customerInstance,
            eventId,
            feature,
            hourStart,
            tokens,
            reservation: null,
          }),
        ),
      );
    for (const receipt of customerFree)
      expect(receipt).toEqual({
        kind: 'accepted',
        value: { kind: 'recorded_without_charge', reason: 'nonbillable_outcome' },
      });

    // A customer account cannot hold funds at the test version.
    const customerHour = {
      feature: 'screen_relevance',
      hourStart: '2026-10-01T02:00:00.000Z',
    } as const;
    const refusedTestHold = await reserveHour(
      core,
      satyr,
      customerInstance,
      customerHour.feature,
      customerHour.hourStart,
      jevPrice,
    );
    expect(refusedTestHold).toEqual({ kind: 'rejected', error: { code: 'price_unavailable' } });

    // Above the free use, the customer record settles a customer-version hold at the rounded price.
    const customerHold = accepted(
      await reserveHour(
        core,
        satyr,
        customerInstance,
        customerHour.feature,
        customerHour.hourStart,
        jevCustomerPrice,
      ),
    ).reservation;
    expect(customerHold.priceVersion).toBe(jevCustomerPrice);
    const customerPaidTokens = 500_001;
    const customerPaid = accepted(
      await core.billingUsage.record(
        satyr,
        jevHour({
          instanceId: customerInstance,
          eventId: 'customer-screen',
          ...customerHour,
          tokens: customerPaidTokens,
          reservation: customerHold,
        }),
      ),
    );
    const customerMonthTokens = includedTokens + customerPaidTokens;
    expect(expectedMonthMinor(customerMonthTokens)).toBe(5);
    expect(customerPaid).toMatchObject({
      kind: 'charged',
      amountMinor: expectedMonthMinor(customerMonthTokens),
    });
    const customerCharges = await jevCharges(database, namespace, customerOrg);
    expect(
      customerCharges.map((charge) => [
        charge.quantity,
        charge.unit,
        charge.priceVersion,
        charge.amountMinor,
      ]),
    ).toEqual([[customerPaidTokens, 'input_token', jevCustomerPrice, 5]]);
    const customerVersions = await recordedVersions(database, namespace, customerOrg);
    expect(customerVersions).toEqual([
      {
        event_id: 'customer-mail',
        event_version: jevCustomerPrice,
        receipt_version: jevCustomerPrice,
        outcome: 'nonbillable_outcome',
      },
      {
        event_id: 'customer-cases',
        event_version: jevCustomerPrice,
        receipt_version: jevCustomerPrice,
        outcome: 'nonbillable_outcome',
      },
      {
        event_id: 'customer-screen',
        event_version: jevCustomerPrice,
        receipt_version: jevCustomerPrice,
        outcome: 'charged',
      },
    ]);
    expect(
      await core.billing.getOverview({ orgId: customerOrg, actorUserId: ownerUser }),
    ).toMatchObject({ creditBalanceMinor: 995, reservedMinor: 0, activeReservationCount: 0 });

    // A test account cannot hold funds at the customer version.
    expect(
      await reserveHour(
        core,
        satyr,
        instanceId,
        'screen_relevance',
        '2026-10-01T05:00:00.000Z',
        jevCustomerPrice,
      ),
    ).toEqual({ kind: 'rejected', error: { code: 'price_unavailable' } });

    await saveJson('usage.json', {
      migrations,
      monthTokens,
      expectedMonthMinor: expectedMonthMinor(monthTokens),
      receipts,
      charges,
      testVersions,
      customer: {
        monthTokens: customerMonthTokens,
        expectedMonthMinor: expectedMonthMinor(customerMonthTokens),
        free: customerFree,
        refusedTestHold,
        paid: customerPaid,
        charges: customerCharges,
        versions: customerVersions,
      },
      hours: await queryD1All(
        database,
        'SELECT * FROM billing_jev_hours ORDER BY hour_start_ms',
        [],
      ),
    });
  } finally {
    await worker.dispose();
  }
});

async function post(
  router: AccountConsoleFetchHandler,
  token: string,
  pathname: string,
  body: unknown,
): Promise<Response> {
  return router(
    new Request(`${origin}${pathname}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function tokenFor(
  session: ConsoleSessionService,
  userId: string,
  orgId: string,
): Promise<string> {
  return session.signJwt(userId, {
    kind: 'app_session_v1',
    appSessionVersion: 'jev-acceptance',
    orgId,
    email: `${userId}@jev.invalid`,
    provider: 'oidc',
    oidcProvider: 'google',
    oidcEmailVerified: true,
  });
}

async function verifyCard(core: CloudflareD1AccountServiceBundle, orgId: string): Promise<void> {
  const context = { orgId, actorUserId: ownerUser };
  const card = await core.freePlan.startCardSetup(context);
  await core.freePlan.reconcileCardSetup(context, card.checkoutSessionId);
}

async function creditChanges(database: D1DatabaseLike, namespace: string, orgId: string) {
  return queryD1All(
    database,
    'SELECT operation_id, credit_limit_minor, actor_user_id, reason FROM billing_credit_limit_changes WHERE namespace = ? AND org_id = ? ORDER BY created_at_ms, operation_id',
    [namespace, orgId],
  );
}

test('A billing manager turns on Satyr paid use with a $10 postpaid credit limit', async () => {
  const namespace = 'satyr-jev-credit';
  const selfServe = 'jev-self-serve-organisation';
  const prepaid = 'jev-prepaid-organisation';
  const supported = 'jev-supported-organisation';
  const paidUse = '/console/billing/satyr-paid-use/postpaid';
  const worker = runtime(namespace);
  try {
    const database = await databaseOf(worker);
    await migrate(database);
    const { core, session, router } = await openAccounts(
      database,
      namespace,
      [selfServe, prepaid, supported],
      [selfServe],
    );
    const billingRuntime = getConsoleBillingD1Runtime(core.billing);
    if (!billingRuntime) throw new Error('Billing runtime is unavailable');
    const instanceId = await enableSatyr(core, namespace, selfServe);
    await enableSatyr(core, namespace, prepaid);
    await enableSatyr(core, namespace, supported);
    for (const orgId of [selfServe, prepaid, supported]) await verifyCard(core, orgId);

    // A member who may not manage billing is refused, and nothing changes.
    const invitation = await core.organizationAccess.invite(
      { orgId: selfServe, actorUserId: ownerUser },
      {
        email: 'operator@jev.invalid',
        role: 'MEMBER',
        projectAccess: [{ projectId: `${selfServe}-project`, accessLevel: 'viewer' }],
      },
    );
    await core.organizationAccess.acceptInvitation(
      { userId: 'operator', verifiedEmail: 'operator@jev.invalid' },
      invitation.invitation.id,
      { token: invitation.token },
    );
    await core.account.getProfile(identity('operator', selfServe));
    const operator = await tokenFor(session, 'operator', selfServe);
    expect(
      (await post(router, operator, paidUse, { operationId: 'operator-paid-use' })).status,
    ).toBe(403);
    expect(await readBillingPaymentPolicy(database, namespace, selfServe)).toEqual({
      kind: 'prepaid',
    });
    expect(await creditChanges(database, namespace, selfServe)).toEqual([]);

    // A billing manager with a verified card and no prepaid balance gets postpaid at $10.
    const owner = await tokenFor(session, ownerUser, selfServe);
    const first = await post(router, owner, paidUse, { operationId: 'satyr-paid-use-1' });
    expect(first.status).toBe(200);
    const converted: { readonly policy: unknown } = await first.json();
    expect(converted).toMatchObject({
      ok: true,
      outcome: 'converted',
      policy: {
        kind: 'postpaid',
        creditLimitMinor: 1000,
        approvedBy: 'system:satyr-self-serve-paid-use',
      },
    });
    const audited = [
      {
        operation_id: 'satyr-paid-use-1',
        credit_limit_minor: 1000,
        actor_user_id: 'system:satyr-self-serve-paid-use',
        reason: 'satyr_self_serve_paid_use',
      },
    ];
    expect(await creditChanges(database, namespace, selfServe)).toEqual(audited);

    // A second call changes nothing, with the same operation or a new one.
    const replay = await (
      await post(router, owner, paidUse, { operationId: 'satyr-paid-use-1' })
    ).json();
    expect(replay).toMatchObject({ outcome: 'already_converted', policy: converted.policy });
    const again = await (
      await post(router, owner, paidUse, { operationId: 'satyr-paid-use-2' })
    ).json();
    expect(again).toMatchObject({ outcome: 'existing_postpaid_kept', policy: converted.policy });
    expect(await creditChanges(database, namespace, selfServe)).toEqual(audited);

    // Postpaid admission holds Jev use against the credit limit and puts it on the invoice.
    expect(
      accepted(
        await core.billingUsage.record(
          satyr,
          jevHour({
            instanceId,
            eventId: 'postpaid-free',
            feature: 'mail_classification',
            hourStart: '2026-10-01T00:00:00.000Z',
            tokens: includedTokens,
            reservation: null,
          }),
        ),
      ),
    ).toEqual({ kind: 'recorded_without_charge', reason: 'nonbillable_outcome' });
    const hold = accepted(
      await reserveHour(core, satyr, instanceId, 'screen_relevance', '2026-10-01T01:00:00.000Z'),
    ).reservation;
    expect((await getPostpaidAccount(billingRuntime, selfServe)).exposure).toMatchObject({
      reservedMinor: 5,
      availableCreditMinor: 995,
    });
    expect(
      accepted(
        await core.billingUsage.record(
          satyr,
          jevHour({
            instanceId,
            eventId: 'postpaid-paid',
            feature: 'screen_relevance',
            hourStart: '2026-10-01T01:00:00.000Z',
            tokens: 120_000,
            reservation: hold,
          }),
        ),
      ),
    ).toMatchObject({ kind: 'charged', amountMinor: expectedMonthMinor(includedTokens + 120_000) });
    expect((await getPostpaidAccount(billingRuntime, selfServe)).exposure).toMatchObject({
      unpaidMinor: 2,
      reservedMinor: 0,
      availableCreditMinor: 998,
    });

    // An account with prepaid credit left stays prepaid. Its credit packs keep working.
    await core.billing.grantManualSupportCredit(
      { orgId: prepaid, actorUserId: ownerUser },
      {
        amountMinor: 1000,
        reasonCode: 'acceptance',
        note: 'Prepaid credit pack stand-in',
        idempotencyKey: 'prepaid-pack',
      },
    );
    const kept = await (
      await post(router, await tokenFor(session, ownerUser, prepaid), paidUse, {
        operationId: 'prepaid-paid-use',
      })
    ).json();
    expect(kept).toEqual({ ok: true, outcome: 'prepaid_credit_kept', policy: { kind: 'prepaid' } });
    expect(await creditChanges(database, namespace, prepaid)).toEqual([]);

    // A limit that Platform support set is never lowered.
    await approveCreditLimit(
      billingRuntime,
      { userId: 'platform-support', platformSupport: true },
      CreditLimitApproval.parse({
        orgId: supported,
        creditLimitMinor: 5000,
        reason: 'Support-approved contract limit',
        operationId: 'support-limit',
      }),
    );
    const supportKept = await (
      await post(router, await tokenFor(session, ownerUser, supported), paidUse, {
        operationId: 'supported-paid-use',
      })
    ).json();
    expect(supportKept).toMatchObject({
      outcome: 'existing_postpaid_kept',
      policy: { kind: 'postpaid', creditLimitMinor: 5000, approvedBy: 'platform-support' },
    });
    expect(await creditChanges(database, namespace, supported)).toEqual([
      {
        operation_id: 'support-limit',
        credit_limit_minor: 5000,
        actor_user_id: 'platform-support',
        reason: 'Support-approved contract limit',
      },
    ]);

    await saveJson('self-serve-credit.json', {
      converted,
      replay,
      again,
      kept,
      supportKept,
      changes: await queryD1All(
        database,
        'SELECT * FROM billing_credit_limit_changes ORDER BY created_at_ms, operation_id',
        [],
      ),
    });
  } finally {
    await worker.dispose();
  }
});
