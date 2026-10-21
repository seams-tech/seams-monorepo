import { expect, test } from '@playwright/test';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  PlatformUsageEventV1,
  MarkFundsIndeterminateRequestV1,
  ReserveFundsRequestV1,
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  SettleFundsRequestV1,
  parseServiceProvisionReceiptV1,
  type FundsReservationV1,
  type PlatformResult,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import type { ConsoleAccountIdentityContext } from '../../../packages/console-server-ts/src/account/service';
import type { ServiceProducerAuthorityV1 } from '../../../packages/console-server-ts/src/accountPlatform/types';
import type { D1DatabaseLike } from '../../../packages/console-server-ts/src/boundary/d1';
import { ConsoleSessionService } from '../../../packages/console-server-ts/src/boundary/session';
import { fundsChargeId } from '../../../packages/console-server-ts/src/billingPrepaidReservations/d1';
import { buildConsoleBillingInvoicePdf } from '../../../packages/console-server-ts/src/billing/pdf';
import { listD1BillingUsageCharges } from '../../../packages/console-server-ts/src/billing/attribution';
import { TrustedWalletExecutionQuoteV1 } from '../../../packages/console-server-ts/src/billing/pricing';
import type {
  D1BillingUsageService,
  SatyrTestPricingPolicyV1,
} from '../../../packages/console-server-ts/src/billing/usage';
import { createAppSessionConsoleAuthAdapter } from '../../../packages/console-server-ts/src/router/consoleAppSessionAuth';
import {
  createAccountConsoleRouter,
  type AccountConsoleFetchHandler,
} from '../../../packages/console-server-ts/src/router/cloudflare/createAccountConsoleRouter';
import {
  createCloudflareD1AccountServiceBundle,
  type CloudflareD1AccountServiceBundle,
} from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/usage');
const namespace = 'shared-account-usage';
const origin = 'https://account-usage.acceptance.invalid';
const owner = { orgId: 'usage-organisation-a', actorUserId: 'verified-usage-owner' };
const otherOwner = { orgId: 'usage-organisation-b', actorUserId: owner.actorUserId };
const wallet = { serviceId: 'wallet', deploymentId: 'usage-wallet' } as const;
const satyr = { serviceId: 'satyr', deploymentId: 'usage-satyr' } as const;
const quoteVersion = 'wallet-accepted-quote-v1';
const satyrPrice = 'satyr-completed-turn-test-v1';
const secret = 'isolated-usage-acceptance-session-secret';
const occurredAt = '2026-10-04T01:00:00.000Z';

function now(): Date {
  return new Date('2026-10-13T02:00:00.000Z');
}

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Shared usage acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'shared-account-usage' },
    d1Persist: path.join(output, 'state'),
  });
}

async function databaseOf(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('CONSOLE_DB');
  if (!isD1DatabaseLike(database)) throw new Error('Usage D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<readonly string[]> {
  const directory = path.join(repository, 'packages/console-server-ts/migrations/d1-console-core');
  const applied: string[] = [];
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith('.sql')) continue;
    const sql = await readFile(path.join(directory, filename), 'utf8');
    const statements = unstable_splitSqlQuery(sql);
    const prepared = [];
    for (const statement of statements) prepared.push(database.prepare(statement));
    await database.batch(prepared);
    applied.push(filename);
  }
  return applied;
}

function identity(userId: string, orgId: string | null): ConsoleAccountIdentityContext {
  return {
    userId,
    email: `${userId}@usage.invalid`,
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

function setCookie(token: string): string {
  return `usage-session=${token}; HttpOnly; Path=/`;
}

function clearCookie(): string {
  return 'usage-session=; Max-Age=0; Path=/';
}

function ready(): void {}

async function compose(database: D1DatabaseLike, satyrTestPricing: SatyrTestPricingPolicyV1) {
  const core = await createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    externalDeletionGuard: null,
    ensureSchema: true,
    now,
    satyrTestPricing,
    billingEmailConsoleBaseUrl: origin,
  });
  const session = new ConsoleSessionService({
    jwt: { signToken, verifyToken },
    cookie: { name: 'usage-session', buildSetHeader: setCookie, buildClearHeader: clearCookie },
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

async function enable(
  core: CloudflareD1AccountServiceBundle,
  context: typeof owner,
  projectId: string,
  authority: ServiceProducerAuthorityV1,
): Promise<string> {
  const scope = accepted(await core.accountPlatform.bindProjectBilling(context, projectId));
  const instanceId = `${authority.serviceId}:${projectId}`;
  const nativeScope =
    authority.serviceId === 'wallet'
      ? {
          serviceId: 'wallet',
          deploymentId: authority.deploymentId,
          namespace,
          nativeOrganizationId: context.orgId,
          nativeProjectId: projectId,
        }
      : {
          serviceId: 'satyr',
          deploymentId: authority.deploymentId,
          nativeOrganizationId: `native:${projectId}`,
        };
  const binding = accepted(ServiceTenantBindingV1.parse({ instanceId, scope, nativeScope }));
  const command = accepted(
    ServiceProvisionCommandV1.parse({
      version: 1,
      operationId: `enable:${instanceId}`,
      instanceId,
      desiredRevision: 1,
      command: 'enable',
      binding: {
        kind: 'attach_existing_scope',
        nativeScope,
        authorityEvidence: { sourceRecordId: `native:${instanceId}`, sourceDigest: 'a'.repeat(64) },
      },
    }),
  );
  accepted(await core.accountPlatform.requestProvision(context, { scope, command }));
  accepted(
    await core.accountPlatform.acknowledgeProvision(
      authority,
      accepted(
        parseServiceProvisionReceiptV1({
          version: 1,
          operationId: command.operationId,
          instanceId,
          desiredRevision: 1,
          result: 'active',
          binding,
        }),
      ),
    ),
  );
  return instanceId;
}

function monthlyEvent(
  instanceId: string,
  eventId: string,
  resourceId: string,
  time: string,
): PlatformUsageEventV1 {
  return accepted(
    PlatformUsageEventV1.parse({
      version: 1,
      eventId,
      instanceId,
      occurredAt: time,
      meterId: 'wallet.monthly_active_resource',
      quantity: 1,
      unit: 'resource_month',
      evidence: {
        kind: 'wallet_resource',
        sourceRecordId: eventId,
        sourceDigest: 'b'.repeat(64),
        environmentId: `${instanceId}:dev`,
        resourceId,
      },
    }),
  );
}

async function loseAcknowledgement(
  usage: D1BillingUsageService,
  authority: ServiceProducerAuthorityV1,
  event: PlatformUsageEventV1,
): Promise<never> {
  accepted(await usage.record(authority, event));
  throw new Error('Injected transport loss after committed usage');
}

async function reserve(
  core: CloudflareD1AccountServiceBundle,
  authority: ServiceProducerAuthorityV1,
  instanceId: string,
  executionId: string,
  requestedMinor: number,
): Promise<FundsReservationV1> {
  return accepted(
    await core.funds.reserve(
      authority,
      accepted(
        ReserveFundsRequestV1.parse({
          version: 1,
          operationId: `reserve:${instanceId}:${executionId}`,
          instanceId,
          executionId,
          requestedMinor,
          priceVersion: authority.serviceId === 'satyr' ? satyrPrice : quoteVersion,
        }),
      ),
    ),
  ).reservation;
}

function walletQuote(
  instanceId: string,
  executionId: string,
  amountMinor: number,
): TrustedWalletExecutionQuoteV1 {
  return accepted(
    TrustedWalletExecutionQuoteV1.parse({
      version: 1,
      currency: 'USD',
      instanceId,
      executionId,
      quoteVersion,
      quotedAt: occurredAt,
      amountMinor,
      sourceRecordId: `receipt:${executionId}`,
      sourceDigest: 'c'.repeat(64),
      ledgerSourceEventId: `sponsored_evm_call_debit:${executionId}`,
      resourceId: 'wallet-resource',
      txOrExecutionRef: `tx:${executionId}`,
    }),
  );
}

function executionEvent(
  quote: TrustedWalletExecutionQuoteV1,
  reservation: FundsReservationV1,
): PlatformUsageEventV1 {
  return accepted(
    PlatformUsageEventV1.parse({
      version: 1,
      eventId: `usage:${quote.executionId}`,
      instanceId: quote.instanceId,
      occurredAt,
      meterId: 'wallet.execution',
      quantity: 1,
      unit: 'execution',
      evidence: {
        kind: 'wallet_execution',
        sourceRecordId: quote.sourceRecordId,
        sourceDigest: quote.sourceDigest,
        environmentId: `${quote.instanceId}:dev`,
        executionId: quote.executionId,
        quoteVersion: quote.quoteVersion,
        quotedAt: quote.quotedAt,
        reservationId: reservation.reservationId,
      },
    }),
  );
}

async function settleWallet(
  core: CloudflareD1AccountServiceBundle,
  quote: TrustedWalletExecutionQuoteV1,
  reservation: FundsReservationV1,
) {
  return core.funds.settle(
    wallet,
    accepted(
      SettleFundsRequestV1.parse({
        version: 1,
        operationId: `settle:${quote.executionId}`,
        reservationId: reservation.reservationId,
        executionId: quote.executionId,
        settledMinor: quote.amountMinor,
        priceVersion: quote.quoteVersion,
        evidence: { sourceRecordId: quote.sourceRecordId, sourceDigest: quote.sourceDigest },
      }),
    ),
    {
      chargeId: fundsChargeId(reservation.reservationId),
      ledgerSourceEventId: quote.ledgerSourceEventId,
      resourceId: quote.resourceId,
      occurredAt,
      txOrExecutionRef: quote.txOrExecutionRef,
      statements: [],
    },
  );
}

async function turn(
  core: CloudflareD1AccountServiceBundle,
  instanceId: string,
  turnId: string,
  terminalOutcome: 'completed' | 'failed' | 'cancelled',
  funding: 'customer' | 'platform',
): Promise<PlatformUsageEventV1> {
  const sessionId = 'accepted-session';
  const executionId = JSON.stringify([sessionId, turnId]);
  const reservation = await reserve(core, satyr, instanceId, executionId, 1);
  const event = accepted(
    PlatformUsageEventV1.parse({
      version: 1,
      eventId: `turn:${turnId}`,
      instanceId,
      occurredAt,
      meterId: 'satyr.completed_turn.test',
      quantity: terminalOutcome === 'completed' ? 1 : 0,
      unit: 'turn',
      evidence: {
        kind: 'satyr_turn',
        sourceRecordId: `accepted:${turnId}`,
        sourceDigest: 'd'.repeat(64),
        sessionId,
        turnId,
        terminalOutcome,
        reservationId: reservation.reservationId,
        funding: {
          kind: funding,
          selection: funding === 'customer' ? 'codex_subscription' : 'satyr_platform',
          modelRouteDigest: 'e'.repeat(64),
        },
      },
    }),
  );
  accepted(await core.billingUsage.record(satyr, event));
  return event;
}

async function request(
  router: AccountConsoleFetchHandler,
  token: string,
  pathname: string,
): Promise<Response> {
  return router(
    new Request(`${origin}${pathname}`, { headers: { Authorization: `Bearer ${token}` } }),
  );
}

async function tokenFor(session: ConsoleSessionService, userId: string): Promise<string> {
  return session.signJwt(userId, {
    kind: 'app_session_v1',
    appSessionVersion: 'usage-acceptance',
    orgId: owner.orgId,
    email: `${userId}@usage.invalid`,
    provider: 'oidc',
    oidcProvider: 'google',
    oidcEmailVerified: true,
  });
}

async function addReaders(core: CloudflareD1AccountServiceBundle): Promise<void> {
  const finance = await core.organizationAccess.invite(owner, {
    email: 'finance@usage.invalid',
    role: 'ADMIN',
    adminPermissions: ['billing.view'],
  });
  await core.organizationAccess.acceptInvitation(
    { userId: 'finance', verifiedEmail: 'finance@usage.invalid' },
    finance.invitation.id,
    { token: finance.token },
  );
  const operator = await core.organizationAccess.invite(owner, {
    email: 'operator@usage.invalid',
    role: 'MEMBER',
    projectAccess: [{ projectId: 'project-a', accessLevel: 'viewer' }],
  });
  await core.organizationAccess.acceptInvitation(
    { userId: 'operator', verifiedEmail: 'operator@usage.invalid' },
    operator.invitation.id,
    { token: operator.token },
  );
  await core.account.getProfile(identity('finance', owner.orgId));
  await core.account.getProfile(identity('operator', owner.orgId));
}

async function saveJson(name: string, value: unknown): Promise<void> {
  await writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function snapshot(database: D1DatabaseLike): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of [
    'billing_usage_events',
    'billing_usage_receipts',
    'billing_execution_charges',
    'billing_funds_reservations',
    'billing_ledger_entries',
    'billing_ledger_postings',
    'billing_price_definitions',
    'console_email_outbox',
    'billing_accounts',
  ]) {
    result[table] = (await database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
  }
  return result;
}

async function journey(): Promise<void> {
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'ui-fixture'), { recursive: true });
  let worker = runtime();
  try {
    let database = await databaseOf(worker);
    const migrations = await migrate(database);
    let product = await compose(database, { kind: 'disabled' });
    for (const context of [owner, otherOwner]) {
      await product.core.account.createOrganization(identity(context.actorUserId, null), {
        id: context.orgId,
        name: context.orgId,
      });
    }
    product = await compose(database, {
      kind: 'isolated_e2e',
      organizationIds: [owner.orgId],
    });
    const core = product.core;
    await core.orgProjects.createProject(owner, { id: 'project-a', name: 'Platform project A' });
    await core.orgProjects.createProject(owner, { id: 'project-b', name: 'Platform project B' });
    await core.orgProjects.createProject(otherOwner, {
      id: 'customer-project',
      name: 'Separate customer',
    });
    const walletA = await enable(core, owner, 'project-a', wallet);
    const walletB = await enable(core, owner, 'project-b', wallet);
    const satyrA = await enable(core, owner, 'project-a', satyr);
    const customerSatyr = await enable(core, otherOwner, 'customer-project', satyr);
    await core.billingUsage.ensureSchema();
    await core.billing.grantManualSupportCredit(owner, {
      amountMinor: 2000,
      reasonCode: 'acceptance',
      note: 'Isolated usage acceptance',
      idempotencyKey: 'acceptance-funds',
    });
    await database
      .prepare(
        `UPDATE billing_accounts SET low_balance_threshold_minor = 1500,
      low_balance_warning_active = 0 WHERE namespace = ? AND org_id = ?`,
      )
      .bind(namespace, owner.orgId)
      .run();
    await database
      .prepare(
        `INSERT INTO billing_ledger_entries
      (namespace,org_id,id,entry_type,amount_minor,currency,description,month_utc,source_event_id,actor_type,reason_code,idempotency_key,created_at_ms)
      VALUES (?,?,?,'PRODUCT_EXECUTION_DEBIT',-37,'USD','Historical unattributed execution','2026-10',?,'SYSTEM','historical_usage',?,?)`,
      )
      .bind(
        namespace,
        owner.orgId,
        'historical-usage',
        'historical-source',
        'historical-source',
        Date.parse(occurredAt),
      )
      .run();
    const first = monthlyEvent(walletA, 'resource-a', 'same-resource', occurredAt);
    await expect(loseAcknowledgement(core.billingUsage, wallet, first)).rejects.toThrow(
      'Injected transport loss after committed usage',
    );
    const firstReceipt = await core.billingUsage.record(wallet, first);
    expect(firstReceipt).toMatchObject({
      kind: 'accepted',
      value: {
        kind: 'charged',
        amountMinor: 300,
        priceVersion: 'wallet-monthly-active-resource-v1',
      },
    });
    expect(await core.billingUsage.record(wallet, first)).toEqual(firstReceipt);
    expect(
      await core.billingUsage.record(
        wallet,
        monthlyEvent(walletB, 'shared-resource-b', 'same-resource', occurredAt),
      ),
    ).toEqual({
      kind: 'accepted',
      value: { kind: 'recorded_without_charge', reason: 'meter_already_counted' },
    });
    accepted(
      await core.billingUsage.record(
        wallet,
        monthlyEvent(walletB, 'resource-b', 'second-resource', occurredAt),
      ),
    );
    accepted(
      await core.billingUsage.record(
        wallet,
        monthlyEvent(walletA, 'late-september', 'same-resource', '2026-09-30T23:59:59.999Z'),
      ),
    );
    expect(
      await core.billingUsage.record(
        wallet,
        monthlyEvent(walletA, 'resource-a', 'changed-resource', occurredAt),
      ),
    ).toEqual({ kind: 'rejected', error: { code: 'event_conflict' } });
    expect(
      await core.billingUsage.record(
        { serviceId: 'wallet', deploymentId: 'foreign-deployment' },
        first,
      ),
    ).toEqual({ kind: 'rejected', error: { code: 'scope_forbidden' } });
    expect(await core.billingUsage.record(satyr, first)).toEqual({
      kind: 'rejected',
      error: { code: 'scope_forbidden' },
    });

    const reservationA = await reserve(core, wallet, walletA, 'execution-a', 20);
    const quoteA = walletQuote(walletA, 'execution-a', 25);
    accepted(await core.billingUsage.registerWalletExecutionQuote(wallet, quoteA));
    accepted(await settleWallet(core, quoteA, reservationA));
    const usageA = executionEvent(quoteA, reservationA);
    expect(await core.billingUsage.record(wallet, usageA)).toMatchObject({
      kind: 'accepted',
      value: { amountMinor: 25, chargeId: fundsChargeId(reservationA.reservationId) },
    });
    expect(
      await core.billingUsage.registerWalletExecutionQuote(
        wallet,
        walletQuote(walletA, 'execution-a', 26),
      ),
    ).toEqual({ kind: 'rejected', error: { code: 'event_conflict' } });
    const reservationB = await reserve(core, wallet, walletB, 'execution-b', 17);
    const quoteB = walletQuote(walletB, 'execution-b', 17);
    accepted(await core.billingUsage.registerWalletExecutionQuote(wallet, quoteB));
    const uncertain = accepted(
      await core.funds.markIndeterminate(
        wallet,
        accepted(
          MarkFundsIndeterminateRequestV1.parse({
            version: 1,
            operationId: 'transport-lost:execution-b',
            reservationId: reservationB.reservationId,
            executionId: 'execution-b',
          }),
        ),
        { statements: [] },
      ),
    );
    expect(uncertain.kind).toBe('indeterminate');
    const usageB = executionEvent(quoteB, reservationB);
    accepted(await core.billingUsage.record(wallet, usageB));
    accepted(await settleWallet(core, quoteB, reservationB));

    const completed = await turn(
      core,
      satyrA,
      'customer-funded-completed',
      'completed',
      'customer',
    );
    await turn(core, satyrA, 'platform-funded-completed', 'completed', 'platform');
    await turn(core, satyrA, 'failed', 'failed', 'customer');
    await turn(core, satyrA, 'cancelled', 'cancelled', 'platform');
    const customerDenied = ReserveFundsRequestV1.parse({
      version: 1,
      operationId: 'customer-satyr',
      instanceId: customerSatyr,
      executionId: '["customer","turn"]',
      requestedMinor: 1,
      priceVersion: satyrPrice,
    });
    expect(await core.funds.reserve(satyr, accepted(customerDenied))).toEqual({
      kind: 'rejected',
      error: { code: 'price_unavailable' },
    });
    await addReaders(core);
    const financeToken = await tokenFor(product.session, 'finance');
    const operatorToken = await tokenFor(product.session, 'operator');
    const chargesPath = '/console/billing/usage/charges?periodMonthUtc=2026-10';
    expect((await request(product.router, operatorToken, chargesPath)).status).toBe(403);
    const financeCharges = await request(product.router, financeToken, chargesPath);
    expect(financeCharges.status).toBe(200);
    const charges = await financeCharges.json();
    expect(charges).toMatchObject({
      ok: true,
      organizationId: owner.orgId,
      periodMonthUtc: '2026-10',
    });
    const attributedCharges = await listD1BillingUsageCharges({
      database,
      namespace,
      organizationId: owner.orgId,
      periodMonthUtc: '2026-10',
    });
    const totals = { wallet: 0, satyr: 0, historical: 0 };
    for (const charge of attributedCharges) {
      switch (charge.kind) {
        case 'historical_organization':
          totals.historical += charge.amountMinor;
          break;
        case 'instance':
          totals[charge.attribution.serviceId] += charge.amountMinor;
          break;
      }
    }
    expect(totals).toEqual({ wallet: 642, satyr: 2, historical: 37 });
    await saveJson('charges.json', charges);
    for (const [name, endpoint] of [
      ['session', '/console/session'],
      ['organizations', '/console/account/organizations'],
      ['projects', '/console/projects'],
      ['onboarding', '/console/onboarding/state'],
      ['overview', '/console/billing/overview'],
      ['charges', chargesPath],
      ['activity', '/console/billing/account/activity'],
      ['invoices', '/console/billing/invoices'],
    ]) {
      const response = await request(product.router, financeToken, endpoint);
      expect(response.status, endpoint).toBe(200);
      await saveJson(`ui-fixture/${name}.json`, await response.json());
    }
    const overview = await core.billing.getOverview(owner);
    expect(overview.creditBalanceMinor).toBe(1019);
    expect(overview).toMatchObject({
      reservedMinor: 0,
      activeReservationCount: 0,
      pendingRefundMinor: 0,
      availableBalanceMinor: 1019,
    });
    const warnings = await database
      .prepare(
        `SELECT COUNT(*) AS count FROM billing_accounts
      WHERE namespace = ? AND org_id = ? AND low_balance_warning_active = 1`,
      )
      .bind(namespace, owner.orgId)
      .first<number>('count');
    expect(warnings).toBe(1);
    const statement = await core.billing.generateMonthlyInvoice(owner, {
      periodMonthUtc: '2026-10',
    });
    expect(statement.invoice.amountDueMinor).toBe(681);
    const statements = await core.billing.listInvoicesPage(owner, {
      documentType: 'USAGE_STATEMENT',
      periodMonthUtc: '2026-10',
    });
    expect(statements.invoices).toHaveLength(1);
    expect(statements.invoices[0].id).toBe(statement.invoice.id);
    const lines = await core.billing.listInvoiceLineItems(owner, statement.invoice.id);
    const pdf = buildConsoleBillingInvoicePdf({
      orgId: owner.orgId,
      invoice: statement.invoice,
      lineItems: lines,
      exportedAt: now(),
    });
    await writeFile(path.join(output, 'statement.pdf'), pdf);
    await saveJson('statement.json', {
      statement,
      lines,
      sha256: createHash('sha256').update(pdf).digest('hex'),
    });
    const before = await snapshot(database);
    expect(before.billing_usage_events).toHaveLength(10);
    expect(before.billing_usage_receipts).toHaveLength(10);
    expect(before.billing_execution_charges).toHaveLength(6);
    const balanced = await database
      .prepare(
        `SELECT ledger_entry_id FROM billing_ledger_postings
      WHERE namespace = ? AND org_id = ? GROUP BY ledger_entry_id
      HAVING SUM(CASE direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END) <> 0`,
      )
      .bind(namespace, owner.orgId)
      .all();
    expect(balanced.results).toEqual([]);
    await saveJson('before-restart.json', before);
    await worker.dispose();
    worker = runtime();
    database = await databaseOf(worker);
    product = await compose(database, {
      kind: 'isolated_e2e',
      organizationIds: [owner.orgId],
    });
    expect(await snapshot(database)).toEqual(before);
    expect(await product.core.billingUsage.record(wallet, first)).toEqual(firstReceipt);
    accepted(await product.core.billingUsage.record(wallet, usageB));
    accepted(await product.core.billingUsage.record(satyr, completed));
    expect(await snapshot(database)).toEqual(before);
    await saveJson('after-restart.json', await snapshot(database));
    await saveJson('report.json', {
      version: 1,
      passed: true,
      command:
        'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-usage.e2e.test.ts --reporter=line',
      migrations,
      expected: {
        octoberUsageMinor: 681,
        septemberUsageMinor: 300,
        postedBalanceMinor: 1019,
        unresolvedHoldsMinor: 0,
      },
      checks: [
        'organization-month-resource dedup across two Wallet instances',
        'late UTC-month usage',
        'conflicting event and quote rejected',
        'producer substitution denied',
        'explicit settlement then usage',
        'usage then explicit settlement',
        'customer and platform Satyr funding retained',
        'failed and cancelled zero-charge receipts',
        'customer Satyr price denied',
        'finance access without service grants',
        'operator finance denied',
        'historical unattributed costs',
        'lost acknowledgement and restart replay',
        'billing document and balanced ledger evidence',
        'one monthly low-balance warning across replay',
      ],
      limitation:
        'Satyr terminal facts are isolated contract fixtures; native Satyr execution is Phase 4.',
      evidence: [
        'before-restart.json',
        'after-restart.json',
        'charges.json',
        'statement.json',
        'statement.pdf',
        'ui-fixture/',
      ],
    });
  } finally {
    await worker.dispose();
  }
}

test(
  'shared usage records fixed and quoted charges with durable receipts and finance-only attribution',
  journey,
);
