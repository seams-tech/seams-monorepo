import { reconcilePostpaidDispute } from '../../../packages/console-server-ts/src/billing/invoiceDisputes';
import {
  parseConsoleEmailTemplate,
  renderConsoleEmailV1,
} from '../../../packages/console-server-ts/src/email/templates';
import {
  signingCreditForRegion,
  sealSigningCredit,
} from '../../../packages/console-server-ts/src/billing/signingCredit';
import {
  createWalletProductionSignatureStatements,
  WalletMonthlyUsageAdapter,
} from '../../../packages/wallet-console-server-ts/src/billing/usage';
import { seedPreFundsWalletEnvironments } from '../../helpers/accountWalletProject.fixtures';
import { buildConsoleBillingInvoicePdf } from '../../../packages/console-server-ts/src/billing/pdf';
import { expect, test } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  ReserveFundsRequestV1,
  SettleFundsRequestV1,
  PlatformPlanUsageEventV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import {
  createSimulatedBillingProviderAdapters,
  type StripeBillingInvoice,
  type BillingProviderAdapters,
} from '../../../packages/console-server-ts/src/billing/providers';
import {
  getConsoleBillingD1Runtime,
  runD1ConsoleBillingMonthlyFinalization,
} from '../../../packages/console-server-ts/src/billing/d1';
import {
  approveCreditLimit,
  CreditLimitApproval,
  getPostpaidAccount,
  requestFreeDowngrade,
} from '../../../packages/console-server-ts/src/billing/postpaid';
import { fundsChargeId } from '../../../packages/console-server-ts/src/billingPrepaidReservations/d1';
import {
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
} from '../../../packages/console-server-ts/src/boundary/d1';
import {
  acceptedBillingResult as accepted,
  enableBillingService,
} from '../../helpers/billingService.fixtures';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/platform-billing/account');
const namespace = 'postpaid-acceptance';
const owner = { orgId: 'postpaid-owner', actorUserId: 'verified-billing-owner' };
const wallet = { serviceId: 'wallet', deploymentId: 'postpaid-wallet' } as const;
const satyr = { serviceId: 'satyr', deploymentId: 'postpaid-satyr' } as const;
class Clock {
  ms = Date.parse('2026-10-01T02:00:00Z');
  now(): Date {
    return new Date(this.ms);
  }
}
class InvoiceControl {
  status: 'open' | 'paid' = 'open';
  attempted = false;
  loseCreate = true;
  constructor(readonly base: BillingProviderAdapters) {}
  async create(input: Parameters<BillingProviderAdapters['stripe']['createBillingInvoice']>[0]) {
    const invoice = await this.base.stripe.createBillingInvoice(input);
    if (this.loseCreate) {
      this.loseCreate = false;
      throw new Error('Acceptance lost Stripe response');
    }
    return invoice;
  }
  async read(id: string): Promise<StripeBillingInvoice> {
    const invoice = await this.base.stripe.getBillingInvoice(id);
    if (invoice.status === 'draft') return invoice;
    return {
      ...invoice,
      status: this.status,
      attempted: this.attempted,
      paymentFailed: this.attempted,
      amountPaidMinor: this.status === 'paid' ? invoice.totalMinor : 0,
      amountRemainingMinor: this.status === 'paid' ? 0 : invoice.totalMinor,
    };
  }
  async finalize(id: string): Promise<StripeBillingInvoice> {
    await this.base.stripe.finalizeBillingInvoice(id);
    return this.read(id);
  }
  providers(): BillingProviderAdapters {
    return {
      stripe: {
        ...this.base.stripe,
        createBillingInvoice: this.create.bind(this),
        getBillingInvoice: this.read.bind(this),
        finalizeBillingInvoice: this.finalize.bind(this),
      },
    };
  }
}
function worker(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Postpaid acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { DB: 'postpaid' },
    d1Persist: path.join(output, 'state'),
  });
}
async function databaseOf(instance: Miniflare): Promise<D1DatabaseLike> {
  const database = await instance.getD1Database('DB');
  if (!isD1DatabaseLike(database)) throw new Error('Missing D1 binding');
  return database;
}
async function migrate(database: D1DatabaseLike) {
  const directory = path.join(repository, 'packages/console-server-ts/migrations/d1-console-core');
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    const statements = [];
    for (const sql of unstable_splitSqlQuery(await readFile(path.join(directory, name), 'utf8')))
      statements.push(database.prepare(sql));
    await database.batch(statements);
  }
}
async function compose(database: D1DatabaseLike, clock: Clock, providers: BillingProviderAdapters) {
  return createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    now: clock.now.bind(clock),
    ensureSchema: false,
    externalDeletionGuard: null,
    billingProviders: providers,
    billingEmailConsoleBaseUrl: 'https://billing.acceptance.invalid',
  });
}
function reserve(
  instanceId: string,
  executionId: string,
  amount: number,
  priceVersion = 'wallet-acceptance-quote-v1',
) {
  return accepted(
    ReserveFundsRequestV1.parse({
      version: 1,
      instanceId,
      executionId,
      operationId: `reserve:${executionId}`,
      requestedMinor: amount,
      priceVersion,
    }),
  );
}
async function runPostpaidAcceptance() {
  test.setTimeout(180000);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const clock = new Clock();
  const control = new InvoiceControl(createSimulatedBillingProviderAdapters());
  const providers = control.providers();
  let instance = worker();
  try {
    let database = await databaseOf(instance);
    await migrate(database);
    let core = await compose(database, clock, providers);
    await core.orgProjects.upsertOrganization(owner, { name: 'Postpaid acceptance' });
    await core.organizationAccess.bootstrapInitialOwner({
      orgId: owner.orgId,
      userId: owner.actorUserId,
      email: 'owner@billing.invalid',
      displayName: 'Billing owner',
    });
    await core.orgProjects.createProject(owner, { id: 'wallet-project', name: 'Wallet project' });
    await core.orgProjects.createProject(owner, { id: 'satyr-project', name: 'Satyr project' });
    const walletId = await enableBillingService(core, owner, 'wallet-project', wallet, namespace);
    const satyrId = await enableBillingService(core, owner, 'satyr-project', satyr, namespace);
    await database
      .prepare('INSERT INTO billing_isolated_test_accounts VALUES(?,?)')
      .bind(namespace, owner.orgId)
      .run();
    const runtime = getConsoleBillingD1Runtime(core.billing);
    if (!runtime) throw new Error('Missing billing runtime');
    const approval = CreditLimitApproval.parse({
      orgId: owner.orgId,
      creditLimitMinor: 100,
      reason: 'Isolated credit acceptance',
      operationId: 'approval-1',
    });
    await expect(
      approveCreditLimit(runtime, { userId: 'support', platformSupport: true }, approval),
    ).rejects.toThrow('usable card');
    const card = await core.freePlan.startCardSetup(owner);
    await core.freePlan.reconcileCardSetup(owner, card.checkoutSessionId);
    await approveCreditLimit(runtime, { userId: 'support', platformSupport: true }, approval);
    const race = await Promise.all([
      core.funds.reserve(wallet, reserve(walletId, 'race-wallet', 100)),
      core.funds.reserve(satyr, reserve(satyrId, 'race-satyr', 1, 'satyr-completed-turn-test-v1')),
    ]);
    expect(race.filter(isAccepted)).toHaveLength(1);
    const winner = race.find(isAccepted);
    if (!winner || winner.kind !== 'accepted') throw new Error('No admitted operation');
    const held = winner.value.reservation;
    const authority = held.instanceId === walletId ? wallet : satyr;
    expect((await getPostpaidAccount(runtime, owner.orgId)).exposure?.reservedMinor).toBe(
      held.requestedMinor,
    );
    const settlement = accepted(
      SettleFundsRequestV1.parse({
        version: 1,
        operationId: 'settle-race',
        reservationId: held.reservationId,
        executionId: held.executionId,
        settledMinor: held.requestedMinor,
        priceVersion: held.priceVersion,
        evidence: { sourceRecordId: 'durable-result', sourceDigest: 'a'.repeat(64) },
      }),
    );
    const terminal = {
      chargeId: fundsChargeId(held.reservationId),
      ledgerSourceEventId: 'race-charge',
      resourceId: 'wallet-resource',
      occurredAt: clock.now().toISOString(),
      txOrExecutionRef: null,
      statements: [],
    };
    accepted(await core.funds.settle(authority, settlement, terminal));
    await instance.dispose();
    instance = worker();
    database = await databaseOf(instance);
    core = await compose(database, clock, providers);
    accepted(await core.funds.settle(authority, settlement, terminal));
    expect(
      await queryD1One(
        database,
        "SELECT COUNT(*) AS count FROM billing_ledger_entries WHERE entry_type='PRODUCT_EXECUTION_DEBIT'",
        [],
      ),
    ).toEqual({ count: 1 });
    const live = getConsoleBillingD1Runtime(core.billing);
    if (!live) throw new Error('Missing billing runtime');
    await approveCreditLimit(
      live,
      { userId: 'support', platformSupport: true },
      CreditLimitApproval.parse({
        orgId: owner.orgId,
        creditLimitMinor: 20000,
        reason: 'Test monthly plan',
        operationId: 'approval-2',
      }),
    );
    await core.freePlan.startPlan(owner, 'growth');
    await requestFreeDowngrade(live, owner.orgId);
    // Pin one accepted operation before monthly close. Its settlement arrives in the next close.
    const late = accepted(
      await core.funds.reserve(wallet, reserve(walletId, 'late-execution', 200)),
    ).reservation;
    clock.ms = Date.parse('2026-11-01T02:00:00Z');
    const first = await runD1ConsoleBillingMonthlyFinalization({
      database,
      namespace,
      now: clock.now.bind(clock),
      providers,
      emailConsoleBaseUrl: 'https://billing.acceptance.invalid',
      orgIds: [owner.orgId],
      ensureSchema: false,
    });
    expect(first.failures).toHaveLength(1);
    const retry = await runD1ConsoleBillingMonthlyFinalization({
      database,
      namespace,
      now: clock.now.bind(clock),
      providers,
      emailConsoleBaseUrl: 'https://billing.acceptance.invalid',
      orgIds: [owner.orgId],
      ensureSchema: false,
    });
    expect(retry.failures).toEqual([]);
    expect(retry.submittedCount).toBe(1);
    const before = await queryD1All(database, 'SELECT * FROM billing_monthly_invoice_items', []);
    expect(before).toHaveLength(2);
    control.attempted = true;
    await runD1ConsoleBillingMonthlyFinalization({
      database,
      namespace,
      now: clock.now.bind(clock),
      providers,
      emailConsoleBaseUrl: 'https://billing.acceptance.invalid',
      orgIds: [owner.orgId],
      ensureSchema: false,
    });
    clock.ms += 8 * 86400000;
    expect(await core.funds.reserve(wallet, reserve(walletId, 'grace-expired', 1))).toMatchObject({
      kind: 'rejected',
      error: { code: 'insufficient_funds' },
    });
    const replacement = await core.freePlan.startCardSetup(owner);
    await core.freePlan.reconcileCardSetup(owner, replacement.checkoutSessionId);
    expect(
      await core.funds.reserve(wallet, reserve(walletId, 'card-does-not-pay-debt', 1)),
    ).toMatchObject({ kind: 'rejected' });
    const lateTerminal = {
      chargeId: fundsChargeId(late.reservationId),
      ledgerSourceEventId: 'late-charge',
      resourceId: 'late-wallet',
      occurredAt: '2026-10-31T23:59:59.000Z',
      txOrExecutionRef: null,
      statements: [],
    };
    accepted(
      await core.funds.settle(
        wallet,
        accepted(
          SettleFundsRequestV1.parse({
            version: 1,
            operationId: 'late-settle',
            reservationId: late.reservationId,
            executionId: late.executionId,
            settledMinor: 200,
            priceVersion: late.priceVersion,
            evidence: { sourceRecordId: 'late-result', sourceDigest: 'b'.repeat(64) },
          }),
        ),
        lateTerminal,
      ),
    );
    expect(await queryD1All(database, 'SELECT * FROM billing_monthly_invoice_items', [])).toEqual(
      before,
    );
    control.status = 'paid';
    await runD1ConsoleBillingMonthlyFinalization({
      database,
      namespace,
      now: clock.now.bind(clock),
      providers,
      emailConsoleBaseUrl: 'https://billing.acceptance.invalid',
      orgIds: [owner.orgId],
      ensureSchema: false,
    });
    await runD1ConsoleBillingMonthlyFinalization({
      database,
      namespace,
      now: clock.now.bind(clock),
      providers,
      emailConsoleBaseUrl: 'https://billing.acceptance.invalid',
      orgIds: [owner.orgId],
      ensureSchema: false,
    });
    expect(
      await queryD1One(
        database,
        "SELECT COUNT(*) AS count FROM billing_ledger_entries WHERE entry_type='INVOICE_PAYMENT'",
        [],
      ),
    ).toEqual({ count: 1 });
    // A retry after month rollover must preserve the original effective date.
    await requestFreeDowngrade(live, owner.orgId);
    await core.freePlan.runScheduledPass({ limit: 100 });
    expect((await core.freePlan.getPlan(owner)).plan).toBe('free');
    clock.ms = Date.parse('2026-12-01T02:00:00Z');
    const next = await runD1ConsoleBillingMonthlyFinalization({
      database,
      namespace,
      now: clock.now.bind(clock),
      providers,
      emailConsoleBaseUrl: 'https://billing.acceptance.invalid',
      orgIds: [owner.orgId],
      ensureSchema: false,
    });
    expect(next.failures).toEqual([]);
    const lateItem = await queryD1One(
      database,
      'SELECT month_utc,usage_month_utc FROM billing_monthly_invoice_items WHERE ledger_entry_id=?',
      [lateTerminal.chargeId],
    );
    expect(lateItem).toEqual({ month_utc: '2026-11', usage_month_utc: '2026-10' });
    const ledger = await queryD1All(
      database,
      'SELECT * FROM billing_ledger_entries ORDER BY id',
      [],
    );
    const imbalance = await queryD1All(
      database,
      "SELECT ledger_entry_id FROM billing_ledger_postings GROUP BY ledger_entry_id HAVING SUM(CASE direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END)<>0",
      [],
    );
    expect(imbalance).toEqual([]);
    const payment = await queryD1One(
      database,
      'SELECT payment_ref FROM billing_invoice_payments WHERE namespace=? AND org_id=? LIMIT 1',
      [namespace, owner.orgId],
    );
    if (typeof payment?.payment_ref !== 'string')
      throw new Error('Invoice payment evidence is missing');
    const dispute = {
      eventId: 'dispute-open',
      eventType: 'charge.dispute.created',
      orgId: null,
      purchaseId: null,
      providerPaymentRef: payment.payment_ref,
      providerDisputeId: 'dispute-acceptance',
      amountMinor: 1,
    } as const;
    expect(await reconcilePostpaidDispute(live, dispute)).toBe(true);
    expect((await getPostpaidAccount(live, owner.orgId)).exposure?.collectionBlocked).toBe(true);
    await reconcilePostpaidDispute(live, {
      eventId: 'dispute-won',
      eventType: 'charge.dispute.closed',
      orgId: null,
      purchaseId: null,
      providerPaymentRef: payment.payment_ref,
      providerDisputeId: 'dispute-acceptance',
      amountMinor: 1,
      outcome: 'won',
    });
    await reconcilePostpaidDispute(live, dispute);
    const notices = await queryD1All(
      database,
      "SELECT template_payload_json FROM console_email_outbox WHERE template_family='BILLING_PAYMENT_RECOVERY'",
      [],
    );
    expect(notices).toHaveLength(1);
    const recoveryEmail = parseConsoleEmailTemplate(
      JSON.parse(String(notices[0].template_payload_json)),
    );
    if (recoveryEmail.family === 'ORGANIZATION_INVITATION')
      throw new Error('Unexpected recovery email family');
    await writeFile(
      path.join(output, 'payment-recovery.html'),
      renderConsoleEmailV1(recoveryEmail).html,
    );
    const account = await getPostpaidAccount(live, owner.orgId);
    expect(account.exposure?.unpaidMinor).toBe(0);
    await expect(
      core.billing.generateMonthlyInvoice(owner, { periodMonthUtc: '2026-10' }),
    ).rejects.toMatchObject({ code: 'postpaid_monthly_collection_required' });
    const documents = await core.billing.listInvoices(owner);
    expect(documents).toHaveLength(2);
    for (const document of documents) expect(document.documentType).toBe('MONTHLY_INVOICE');
    const firstDocument = documents[0];
    const items = await core.billing.listInvoiceLineItems(owner, firstDocument.id);
    expect(items.reduce(sumInvoiceItems, 0)).toBe(firstDocument.amountDueMinor);
    await writeFile(
      path.join(output, 'monthly-invoice.pdf'),
      buildConsoleBillingInvoicePdf({
        orgId: owner.orgId,
        invoice: firstDocument,
        lineItems: items,
        exportedAt: clock.now(),
      }),
    );
    const historicalDisputeEvidence = await verifyHistoricalDispute(database, core, clock);
    const mauEvidence = await verifyMauCreditBoundary(database, core, clock);
    const signingEvidence = await verifySigningGrants(database, core, clock);
    const minimumEvidence = await verifyMinimumInvoices(database, core, clock, providers);
    const creditNoteEvidence = await verifyLateSigningCredit(
      database,
      core,
      clock,
      providers,
      signingEvidence,
    );
    await writeFile(
      path.join(output, 'acceptance.json'),
      JSON.stringify(
        {
          command:
            'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/platform-postpaid.e2e.test.ts --reporter=line',
          revision: execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: repository,
            encoding: 'utf8',
          }).trim(),
          race,
          first,
          retry,
          next,
          account,
          ledger,
          documents,
          historicalDisputeEvidence,
          mauEvidence,
          signingEvidence,
          minimumEvidence,
          creditNoteEvidence,
          notices,
          snapshots: await queryD1All(database, 'SELECT * FROM billing_monthly_invoice_items', []),
        },
        null,
        2,
      ),
    );
  } finally {
    await instance.dispose();
  }
}
function isAccepted(result: { readonly kind: string }): boolean {
  return result.kind === 'accepted';
}
test(
  'postpaid credit survives concurrent services, restart, monthly close, failed payment, late settlement, and Free downgrade',
  runPostpaidAcceptance,
);

function sumInvoiceItems(total: number, item: { readonly amountMinor: number }): number {
  return total + item.amountMinor;
}
async function verifySigningGrants(
  database: D1DatabaseLike,
  core: Awaited<ReturnType<typeof compose>>,
  clock: Clock,
) {
  await seedPreFundsWalletEnvironments({
    database,
    namespace,
    orgId: owner.orgId,
    projectId: 'wallet-project',
    createdAtMs: clock.ms,
  });
  await core.freePlan.startPlan(owner, 'growth');
  const login = productionLogin('wallet:wallet-project', 'active-user', clock.ms);
  expect(accepted(await core.freePlan.recordProductionUsage(wallet, login)).kind).toBe('counted');
  expect(accepted(await core.freePlan.recordProductionUsage(wallet, login)).kind).toBe(
    'already_counted',
  );
  const target = {
    database,
    namespace,
    orgId: owner.orgId,
    projectId: 'wallet-project',
    environmentId: 'wallet-project:prod',
    deploymentLane: wallet.deploymentId,
    region: 'US',
    nowMs: clock.ms,
  };
  const grants = await Promise.all([
    signingCreditForRegion(target),
    signingCreditForRegion(target),
  ]);
  const first = grants[0].policy;
  const second = grants[1].policy;
  if (first.kind !== 'credit' || second.kind !== 'credit')
    throw new Error('Signing grant was not admitted');
  expect(first.grant.id).toBe(second.grant.id);
  const monthly = new WalletMonthlyUsageAdapter({
    database,
    namespace,
    deploymentId: wallet.deploymentId,
    usage: core.billingUsage,
    planUsage: core.freePlan,
  });
  await monthly.ensureSchema();
  const statements = [];
  for (let n = 0; n < 301; n += 1)
    statements.push(
      ...createWalletProductionSignatureStatements({
        database,
        deploymentId: wallet.deploymentId,
        tenant: {
          namespace,
          organizationId: owner.orgId,
          projectId: 'wallet-project',
          environmentId: 'wallet-project:prod',
        },
        signatureId: `signature-${n}`,
        completedAtMs: clock.ms,
        funding: {
          kind: 'credit',
          grantId: first.grant.id,
          walletId: 'active-signing-wallet',
          outcome: 'succeeded',
        },
      }),
    );
  await database.batch(statements);
  await database.batch(statements);
  for (let n = 0; n < 4; n += 1) await monthly.resumePending(100);
  const costs = await queryD1One(
    database,
    'SELECT amount_minor FROM billing_plan_usage_costs WHERE namespace=? AND org_id=? AND month_utc=?',
    [namespace, owner.orgId, '2026-12'],
  );
  expect(costs).toEqual({ amount_minor: 1 });
  const grant = await queryD1One(
    database,
    'SELECT capacity,settled_count FROM billing_signing_credit_grants WHERE namespace=? AND org_id=? AND id=?',
    [namespace, owner.orgId, first.grant.id],
  );
  expect(grant).toEqual({ capacity: first.grant.capacity, settled_count: 301 });
  await sealSigningCredit(target, first.grant.id, 301);
  const altered = createWalletProductionSignatureStatements({
    database,
    deploymentId: wallet.deploymentId,
    tenant: {
      namespace,
      organizationId: owner.orgId,
      projectId: 'wallet-project',
      environmentId: 'wallet-project:prod',
    },
    signatureId: 'signature-0',
    completedAtMs: clock.ms,
    funding: {
      kind: 'credit',
      grantId: first.grant.id,
      walletId: 'different-wallet',
      outcome: 'succeeded',
    },
  });
  await expect(database.batch(altered)).rejects.toThrow('signing_credit_receipt_conflict');
  return {
    grantId: first.grant.id,
    completedAtMs: clock.ms,
    grant,
    costs,
    oneMauForRepeatedLogins: true,
    exactReplay: true,
    unusedCreditReleased: true,
  };
}

async function verifyMinimumInvoices(
  database: D1DatabaseLike,
  core: Awaited<ReturnType<typeof compose>>,
  clock: Clock,
  providers: BillingProviderAdapters,
) {
  const payer = { orgId: 'carry-forward-account', actorUserId: owner.actorUserId };
  await core.orgProjects.upsertOrganization(payer, { name: 'Carry-forward acceptance' });
  await core.organizationAccess.bootstrapInitialOwner({
    orgId: payer.orgId,
    userId: payer.actorUserId,
    email: 'carry@billing.invalid',
    displayName: 'Carry owner',
  });
  await core.orgProjects.createProject(payer, { id: 'carry-project', name: 'Carry project' });
  const instanceId = await enableBillingService(core, payer, 'carry-project', wallet, namespace);
  const card = await core.freePlan.startCardSetup(payer);
  await core.freePlan.reconcileCardSetup(payer, card.checkoutSessionId);
  const runtime = getConsoleBillingD1Runtime(core.billing);
  if (!runtime) throw new Error('Missing billing runtime');
  await approveCreditLimit(
    runtime,
    { userId: 'support', platformSupport: true },
    CreditLimitApproval.parse({
      orgId: payer.orgId,
      creditLimitMinor: 100,
      reason: 'Carry-forward acceptance',
      operationId: 'carry-limit',
    }),
  );
  const first = accepted(
    await core.funds.reserve(wallet, reserve(instanceId, 'carry-first', 40)),
  ).reservation;
  clock.ms = Date.parse('2027-01-01T02:00:00Z');
  const zero = await runD1ConsoleBillingMonthlyFinalization({
    database,
    namespace,
    now: clock.now.bind(clock),
    providers,
    orgIds: [payer.orgId],
    ensureSchema: false,
  });
  expect(zero.noChargeCount).toBe(1);
  const firstSettlement = accepted(
    SettleFundsRequestV1.parse({
      version: 1,
      operationId: 'settle-carry-first',
      reservationId: first.reservationId,
      executionId: first.executionId,
      settledMinor: 40,
      priceVersion: first.priceVersion,
      evidence: { sourceRecordId: 'carry-first', sourceDigest: 'c'.repeat(64) },
    }),
  );
  accepted(
    await core.funds.settle(wallet, firstSettlement, {
      chargeId: fundsChargeId(first.reservationId),
      ledgerSourceEventId: 'carry-first',
      resourceId: 'carry-first',
      occurredAt: '2026-12-31T23:59:59Z',
      txOrExecutionRef: null,
      statements: [],
    }),
  );
  clock.ms = Date.parse('2027-02-01T02:00:00Z');
  const carried = await runD1ConsoleBillingMonthlyFinalization({
    database,
    namespace,
    now: clock.now.bind(clock),
    providers,
    orgIds: [payer.orgId],
    ensureSchema: false,
  });
  expect(carried.noChargeCount).toBe(1);
  const second = accepted(
    await core.funds.reserve(wallet, reserve(instanceId, 'carry-second', 20)),
  ).reservation;
  accepted(
    await core.funds.settle(
      wallet,
      accepted(
        SettleFundsRequestV1.parse({
          version: 1,
          operationId: 'settle-carry-second',
          reservationId: second.reservationId,
          executionId: second.executionId,
          settledMinor: 20,
          priceVersion: second.priceVersion,
          evidence: { sourceRecordId: 'carry-second', sourceDigest: 'd'.repeat(64) },
        }),
      ),
      {
        chargeId: fundsChargeId(second.reservationId),
        ledgerSourceEventId: 'carry-second',
        resourceId: 'carry-second',
        occurredAt: clock.now().toISOString(),
        txOrExecutionRef: null,
        statements: [],
      },
    ),
  );
  clock.ms = Date.parse('2027-03-01T02:00:00Z');
  const collected = await runD1ConsoleBillingMonthlyFinalization({
    database,
    namespace,
    now: clock.now.bind(clock),
    providers,
    orgIds: [payer.orgId],
    ensureSchema: false,
  });
  expect(collected.paidCount).toBe(1);
  expect((await core.billing.listInvoices(payer))[0].amountDueMinor).toBe(60);
  return {
    zero,
    carried,
    collected,
    closes: await queryD1All(database, 'SELECT * FROM billing_monthly_closes WHERE org_id=?', [
      payer.orgId,
    ]),
  };
}

async function verifyLateSigningCredit(
  database: D1DatabaseLike,
  core: Awaited<ReturnType<typeof compose>>,
  clock: Clock,
  providers: BillingProviderAdapters,
  signing: Awaited<ReturnType<typeof verifySigningGrants>>,
) {
  const before = await runD1ConsoleBillingMonthlyFinalization({
    database,
    namespace,
    now: clock.now.bind(clock),
    providers,
    orgIds: [owner.orgId],
    periodMonthUtc: '2026-12',
    ensureSchema: false,
  });
  expect(before.paidCount).toBe(1);
  const original = await core.billing.getInvoice(owner, `monthly:${owner.orgId}:2026-12`);
  accepted(
    await core.freePlan.recordProductionUsage(
      wallet,
      productionLogin('wallet:wallet-project', 'late-login-user', signing.completedAtMs + 1),
    ),
  );
  for (let retry = 0; retry < 2; retry += 1) {
    const result = await runD1ConsoleBillingMonthlyFinalization({
      database,
      namespace,
      now: clock.now.bind(clock),
      providers,
      orgIds: [owner.orgId],
      periodMonthUtc: '2026-12',
      ensureSchema: false,
    });
    expect(result.failures).toEqual([]);
  }
  const credits = await queryD1All(
    database,
    'SELECT credit_entry_id,amount_minor,provider_credit_note_ref FROM billing_invoice_credits WHERE org_id=?',
    [owner.orgId],
  );
  expect(credits).toHaveLength(1);
  expect(credits[0].amount_minor).toBe(1);
  expect(typeof credits[0].provider_credit_note_ref).toBe('string');
  expect(await core.billing.getInvoice(owner, `monthly:${owner.orgId}:2026-12`)).toEqual(original);
  const next = await runD1ConsoleBillingMonthlyFinalization({
    database,
    namespace,
    now: clock.now.bind(clock),
    providers,
    orgIds: [owner.orgId],
    periodMonthUtc: '2027-01',
    ensureSchema: false,
  });
  expect(next.paidCount).toBe(1);
  const adjusted = await core.billing.getInvoice(owner, `monthly:${owner.orgId}:2027-01`);
  expect(adjusted?.amountDueMinor).toBe(9899);
  return { credits, originalInvoiceUnchanged: true, nextInvoice: adjusted };
}

function productionLogin(instanceId: string, userKey: string, atMs: number) {
  return accepted(
    PlatformPlanUsageEventV1.parse({
      version: 1,
      kind: 'plan_usage',
      eventId: `login:${instanceId}:${userKey}:${atMs}`,
      instanceId,
      occurredAt: new Date(atMs).toISOString(),
      measure: {
        kind: 'production_active_user',
        environmentId: `${instanceId.slice('wallet:'.length)}:prod`,
        userKey,
      },
    }),
  );
}
async function verifyMauCreditBoundary(
  database: D1DatabaseLike,
  core: Awaited<ReturnType<typeof compose>>,
  clock: Clock,
) {
  const payer = { orgId: 'mau-credit-account', actorUserId: owner.actorUserId };
  await core.orgProjects.upsertOrganization(payer, { name: 'MAU credit acceptance' });
  await core.organizationAccess.bootstrapInitialOwner({
    orgId: payer.orgId,
    userId: payer.actorUserId,
    email: 'mau@billing.invalid',
    displayName: 'MAU owner',
  });
  await core.orgProjects.createProject(payer, { id: 'mau-project', name: 'MAU project' });
  const instanceId = await enableBillingService(core, payer, 'mau-project', wallet, namespace);
  const card = await core.freePlan.startCardSetup(payer);
  await core.freePlan.reconcileCardSetup(payer, card.checkoutSessionId);
  const runtime = getConsoleBillingD1Runtime(core.billing);
  if (!runtime) throw new Error('Missing billing runtime');
  await approveCreditLimit(
    runtime,
    { userId: 'support', platformSupport: true },
    CreditLimitApproval.parse({
      orgId: payer.orgId,
      creditLimitMinor: 10000,
      reason: 'MAU credit acceptance',
      operationId: 'mau-initial',
    }),
  );
  await core.freePlan.startPlan(payer, 'growth');
  const scope = accepted(await core.accountPlatform.bindProjectBilling(payer, 'mau-project'));
  // Bulk fixture: 5,000 distinct successful authentications inside Growth's allowance.
  await database
    .prepare(
      `WITH RECURSIVE users(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM users WHERE n<4999)
  INSERT INTO billing_plan_usage_facts(namespace,org_id,billing_account_id,month_utc,kind,fact_key,environment_id,recorded_at_ms)
  SELECT ?,?,?,'2026-12','active_user','mau-project:prod:existing-'||n,'mau-project:prod',? FROM users`,
    )
    .bind(namespace, payer.orgId, scope.billingAccountId, clock.ms)
    .run();
  const exposure = await getPostpaidAccount(runtime, payer.orgId);
  if (!exposure.exposure) throw new Error('Expected postpaid exposure');
  const base = exposure.exposure.unpaidMinor;
  await approveCreditLimit(
    runtime,
    { userId: 'support', platformSupport: true },
    CreditLimitApproval.parse({
      orgId: payer.orgId,
      creditLimitMinor: base,
      reason: 'Exhaust the available MAU credit',
      operationId: 'mau-no-credit',
    }),
  );
  expect(
    await core.freePlan.recordProductionUsage(
      wallet,
      productionLogin(instanceId, 'new-blocked', clock.ms),
    ),
  ).toEqual({ kind: 'rejected', error: { code: 'billing_credit_exhausted' } });
  expect(
    accepted(
      await core.freePlan.recordProductionUsage(
        wallet,
        productionLogin(instanceId, 'existing-0', clock.ms),
      ),
    ).kind,
  ).toBe('already_counted');
  await approveCreditLimit(
    runtime,
    { userId: 'support', platformSupport: true },
    CreditLimitApproval.parse({
      orgId: payer.orgId,
      creditLimitMinor: base + 1,
      reason: 'One cent of remaining credit',
      operationId: 'mau-one-cent',
    }),
  );
  const race = await Promise.all([
    core.freePlan.recordProductionUsage(wallet, productionLogin(instanceId, 'new-a', clock.ms)),
    core.freePlan.recordProductionUsage(wallet, productionLogin(instanceId, 'new-b', clock.ms)),
    core.freePlan.recordProductionUsage(wallet, productionLogin(instanceId, 'new-c', clock.ms)),
  ]);
  // Two USD 0.004 MAUs round to one cent. A third would require a second cent.
  expect(race.filter(isAccepted)).toHaveLength(2);
  const final = await getPostpaidAccount(runtime, payer.orgId);
  expect(final.exposure?.availableCreditMinor).toBe(0);
  const usage = await queryD1One(
    database,
    'SELECT active_users,signatures FROM billing_plan_paid_usage WHERE namespace=? AND org_id=?',
    [namespace, payer.orgId],
  );
  expect(usage).toEqual({ active_users: 5002, signatures: 0 });
  return {
    existingUsersCanLogin: true,
    newlyBillableLoginRejected: true,
    concurrentAdmissions: race.map(planUsageDisposition),
    usage,
    exposure: final.exposure,
  };
}
function planUsageDisposition(
  result: import('../../../packages/console-shared-ts/src/accountPlatform').PlanUsageRecordingResultV1,
): string {
  return result.kind === 'accepted' ? result.value.kind : result.error.code;
}

async function verifyHistoricalDispute(
  database: D1DatabaseLike,
  core: Awaited<ReturnType<typeof compose>>,
  clock: Clock,
) {
  const payer = { orgId: 'historical-credit-account', actorUserId: owner.actorUserId };
  await core.orgProjects.upsertOrganization(payer, { name: 'Historical credit acceptance' });
  await core.organizationAccess.bootstrapInitialOwner({
    orgId: payer.orgId,
    userId: payer.actorUserId,
    email: 'history@billing.invalid',
    displayName: 'Historical owner',
  });
  await core.orgProjects.createProject(payer, {
    id: 'historical-project',
    name: 'Historical project',
  });
  const instanceId = await enableBillingService(
    core,
    payer,
    'historical-project',
    wallet,
    namespace,
  );
  const purchase = await core.billing.createStripeCheckoutSession(payer, {
    creditPackId: 'usd_10',
  });
  const settled = await core.billing.reconcileStripeCheckoutSession(payer, {
    checkoutSessionId: purchase.id,
  });
  if (!settled.purchase || settled.purchase.status !== 'SETTLED')
    throw new Error('Historical purchase did not settle');
  const reservation = accepted(
    await core.funds.reserve(wallet, reserve(instanceId, 'historical-spend', 1000)),
  ).reservation;
  accepted(
    await core.funds.settle(
      wallet,
      accepted(
        SettleFundsRequestV1.parse({
          version: 1,
          operationId: 'settle-historical',
          reservationId: reservation.reservationId,
          executionId: reservation.executionId,
          settledMinor: 1000,
          priceVersion: reservation.priceVersion,
          evidence: { sourceRecordId: 'historical-spend', sourceDigest: 'e'.repeat(64) },
        }),
      ),
      {
        chargeId: fundsChargeId(reservation.reservationId),
        ledgerSourceEventId: 'historical-spend',
        resourceId: 'historical-resource',
        occurredAt: clock.now().toISOString(),
        txOrExecutionRef: null,
        statements: [],
      },
    ),
  );
  const card = await core.freePlan.startCardSetup(payer);
  await core.freePlan.reconcileCardSetup(payer, card.checkoutSessionId);
  const runtime = getConsoleBillingD1Runtime(core.billing);
  if (!runtime) throw new Error('Missing billing runtime');
  await approveCreditLimit(
    runtime,
    { userId: 'support', platformSupport: true },
    CreditLimitApproval.parse({
      orgId: payer.orgId,
      creditLimitMinor: 100,
      reason: 'Unfunded account conversion acceptance',
      operationId: 'historical-limit',
    }),
  );
  const paymentRef = settled.purchase.providerPaymentRef;
  await core.billing.processStripeWebhookEvent({
    eventId: 'historical-dispute-open',
    eventType: 'charge.dispute.created',
    orgId: payer.orgId,
    purchaseId: purchase.purchaseId,
    providerPaymentRef: paymentRef,
    providerDisputeId: 'historical-dispute',
    amountMinor: 1000,
  });
  const blocked = await getPostpaidAccount(runtime, payer.orgId);
  expect(blocked.exposure).toMatchObject({ unpaidMinor: 1000, collectionBlocked: true });
  expect(
    await core.funds.reserve(wallet, reserve(instanceId, 'after-historical-dispute', 1)),
  ).toMatchObject({ kind: 'rejected' });
  await core.billing.processStripeWebhookEvent({
    eventId: 'historical-dispute-won',
    eventType: 'charge.dispute.closed',
    orgId: payer.orgId,
    purchaseId: purchase.purchaseId,
    providerPaymentRef: paymentRef,
    providerDisputeId: 'historical-dispute',
    amountMinor: 1000,
    outcome: 'won',
  });
  const recovered = await getPostpaidAccount(runtime, payer.orgId);
  expect(recovered.exposure).toMatchObject({
    unpaidMinor: 0,
    collectionBlocked: false,
    availableCreditMinor: 100,
  });
  const postings = await queryD1All(
    database,
    "SELECT payment_model FROM billing_ledger_entries WHERE namespace=? AND org_id=? AND entry_type IN ('DISPUTE_OPENED','DISPUTE_WON')",
    [namespace, payer.orgId],
  );
  expect(postings).toEqual([{ payment_model: 'prepaid' }, { payment_model: 'prepaid' }]);
  return { blocked: blocked.exposure, recovered: recovered.exposure, postings };
}
