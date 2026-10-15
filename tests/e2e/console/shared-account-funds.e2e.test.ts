import { createSimulatedBillingProviderAdapters } from '../../../packages/console-server-ts/src/billing/providers';
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  MarkFundsIndeterminateRequestV1,
  ReconcileFundsRequestV1,
  ReleaseFundsRequestV1,
  ReserveFundsRequestV1,
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  SettleFundsRequestV1,
  parseServiceProvisionReceiptV1,
  type FundsReservationV1,
  type PlatformResult,
  type PlatformScopeV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import { createD1AccountPlatformService } from '../../../packages/console-server-ts/src/accountPlatform/d1';
import {
  createD1ConsoleBillingService,
  createProductExecutionDebitD1Statements,
  getConsoleBillingD1Runtime,
} from '../../../packages/console-server-ts/src/billing/d1';
import { buildConsoleBillingInvoicePdf } from '../../../packages/console-server-ts/src/billing/pdf';
import {
  createD1ConsoleBillingPrepaidReservationService,
  fundsChargeId,
} from '../../../packages/console-server-ts/src/billingPrepaidReservations/d1';
import type { FundsSettlementTransactionV1 } from '../../../packages/console-server-ts/src/billingPrepaidReservations/types';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
} from '../../../packages/console-server-ts/src/boundary/d1';
import { createD1ConsoleOrgProjectService } from '../../../packages/console-server-ts/src/orgProjectEnv/d1';
import { createD1ConsoleOrganizationAccessService } from '../../../packages/console-server-ts/src/teamRbac/d1';
import { createD1ConsoleWalletEnvironmentService } from '../../../packages/wallet-console-server-ts/src/environments/d1';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/funds');
const namespace = 'shared-account-funds-acceptance';
const wallet = { serviceId: 'wallet', deploymentId: 'funds-wallet' } as const;
const satyr = { serviceId: 'satyr', deploymentId: 'funds-satyr' } as const;

function now(): Date {
  return new Date('2026-10-13T03:00:00.000Z');
}
function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function context(orgId: string) {
  return { orgId, actorUserId: 'verified-funds-owner' };
}
function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Shared funds acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'shared-funds' },
    d1Persist: path.join(output, 'state'),
  });
}
async function databaseFor(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('CONSOLE_DB');
  if (!isD1DatabaseLike(database)) throw new Error('Funds D1 binding is unavailable');
  return database;
}
function statement(database: D1DatabaseLike, sql: string): D1PreparedStatementLike {
  return database.prepare(sql);
}
async function applyMigration(database: D1DatabaseLike, filename: string): Promise<void> {
  const sql = await readFile(
    path.join(repository, 'packages/wallet-console-server-ts/migrations/d1-console', filename),
    'utf8',
  );
  await database.batch(unstable_splitSqlQuery(sql).map(statement.bind(null, database)));
}
async function migrateBeforeFunds(database: D1DatabaseLike): Promise<void> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  for (const name of (await readdir(directory)).sort()) {
    if (name.endsWith('.sql') && name < '0094') await applyMigration(database, name);
  }
}
async function migrateAfterFunds(database: D1DatabaseLike): Promise<void> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  for (const name of (await readdir(directory)).sort()) {
    if (name.endsWith('.sql') && name > '0094_funds_authority.sql')
      await applyMigration(database, name);
  }
}
async function services(database: D1DatabaseLike) {
  const projects = await createD1ConsoleOrgProjectService({ database, namespace, now });
  const access = await createD1ConsoleOrganizationAccessService({ database, namespace, now });
  const billing = await createD1ConsoleBillingService({
    database,
    namespace,
    now,
    providers: createSimulatedBillingProviderAdapters(),
  });
  const platform = createD1AccountPlatformService({
    database,
    namespace,
    organizationAccess: access,
    now,
  });
  const environments = await createD1ConsoleWalletEnvironmentService({ database, namespace, now });
  return { projects, access, billing, platform, environments };
}
async function seedOrganization(
  database: D1DatabaseLike,
  orgId: string,
  credit: number,
): Promise<void> {
  const source = await services(database);
  const ctx = context(orgId);
  await source.projects.upsertOrganization(ctx, { name: orgId });
  await source.access.bootstrapInitialOwner({
    orgId,
    userId: ctx.actorUserId,
    email: 'owner@funds.invalid',
    displayName: 'Funds owner',
  });
  await source.projects.createProject(ctx, { id: `project-${orgId}`, name: `Project ${orgId}` });
  await source.environments.provisionProjectEnvironments(ctx, {
    projectId: `project-${orgId}`,
    liveAccess: 'disabled',
  });
  if (credit > 0)
    await source.billing.grantManualSupportCredit(ctx, {
      amountMinor: credit,
      reasonCode: 'funds_acceptance',
      note: 'Isolated acceptance funds',
      idempotencyKey: `credit-${orgId}`,
    });
}
async function activate(
  database: D1DatabaseLike,
  orgId: string,
  serviceId: 'wallet' | 'satyr',
): Promise<PlatformScopeV1> {
  const source = await services(database);
  const scope = accepted(
    await source.platform.bindProjectBilling(context(orgId), `project-${orgId}`),
  );
  const authority = serviceId === 'wallet' ? wallet : satyr;
  const configuration =
    serviceId === 'wallet'
      ? { deploymentId: wallet.deploymentId, namespace, signingRootVersion: 'default' }
      : {
          deploymentId: satyr.deploymentId,
          placementCellId: 'acceptance-apac',
          environment: 'development',
        };
  const command = accepted(
    ServiceProvisionCommandV1.parse({
      version: 1,
      operationId: `enable-${serviceId}-${orgId}`,
      instanceId: `${serviceId}-${orgId}`,
      desiredRevision: 1,
      command: 'enable',
      binding: { kind: 'create_native_scope', serviceId, parent: scope, configuration },
    }),
  );
  accepted(await source.platform.requestProvision(context(orgId), { scope, command }));
  const nativeScope =
    serviceId === 'wallet'
      ? {
          serviceId,
          deploymentId: wallet.deploymentId,
          namespace,
          nativeOrganizationId: orgId,
          nativeProjectId: `project-${orgId}`,
        }
      : {
          serviceId,
          deploymentId: satyr.deploymentId,
          nativeOrganizationId: `satyr-native-${orgId}`,
        };
  const binding = accepted(
    ServiceTenantBindingV1.parse({ instanceId: command.instanceId, scope, nativeScope }),
  );
  accepted(
    await source.platform.acknowledgeProvision(
      authority,
      accepted(
        parseServiceProvisionReceiptV1({
          version: 1,
          operationId: command.operationId,
          instanceId: command.instanceId,
          desiredRevision: 1,
          result: 'active',
          binding,
        }),
      ),
    ),
  );
  return scope;
}
async function funds(database: D1DatabaseLike) {
  const source = await services(database);
  return createD1ConsoleBillingPrepaidReservationService({
    database,
    namespace,
    platform: source.platform,
    billing: source.billing,
    now,
    ensureSchema: false,
  });
}
function reserveRequest(
  instanceId: string,
  executionId: string,
  requestedMinor: number,
  priceVersion = 'wallet-acceptance-quote-v1',
): ReserveFundsRequestV1 {
  return accepted(
    ReserveFundsRequestV1.parse({
      version: 1,
      operationId: `reserve:${instanceId}:${executionId}`,
      instanceId,
      executionId,
      requestedMinor,
      priceVersion,
    }),
  );
}
function settlement(
  reservation: FundsReservationV1,
  amount: number,
  operationId = `settle:${reservation.instanceId}:${reservation.executionId}`,
): SettleFundsRequestV1 {
  return accepted(
    SettleFundsRequestV1.parse({
      version: 1,
      operationId,
      reservationId: reservation.reservationId,
      executionId: reservation.executionId,
      settledMinor: amount,
      priceVersion: reservation.priceVersion,
      evidence: {
        sourceRecordId: `terminal:${reservation.executionId}`,
        sourceDigest: digest(['accepted-terminal', reservation.executionId, amount]),
      },
    }),
  );
}
function terminalOptions(
  reservation: FundsReservationV1,
  statements: readonly D1PreparedStatementLike[],
): FundsSettlementTransactionV1 {
  return {
    chargeId: fundsChargeId(reservation.reservationId),
    ledgerSourceEventId: `sponsored_evm_call_debit:${reservation.executionId}`,
    resourceId: reservation.executionId,
    occurredAt: now().toISOString(),
    txOrExecutionRef: `tx:${reservation.executionId}`,
    statements,
  };
}
async function release(database: D1DatabaseLike, reservation: FundsReservationV1): Promise<void> {
  const store = await funds(database);
  accepted(
    await store.release(
      wallet,
      accepted(
        ReleaseFundsRequestV1.parse({
          version: 1,
          operationId: `release:${reservation.instanceId}:${reservation.executionId}`,
          reservationId: reservation.reservationId,
          executionId: reservation.executionId,
          noChargeEvidence: {
            sourceRecordId: `no-charge:${reservation.executionId}`,
            sourceDigest: digest(['never-admitted', reservation.executionId]),
          },
        }),
      ),
      {
        chargeId: fundsChargeId(reservation.reservationId),
        ledgerSourceEventId: `sponsored_evm_call_debit:${reservation.executionId}`,
        occurredAt: now().toISOString(),
        statements: [],
      },
    ),
  );
}
async function sourceSnapshot(database: D1DatabaseLike) {
  const rows = await database
    .prepare('SELECT * FROM billing_prepaid_reservations ORDER BY id')
    .all();
  const triggers = await database
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('billing_prepaid_reservations_reserve_insert','billing_prepaid_reservations_reserved_exit_update') ORDER BY name",
    )
    .all();
  return { rows: rows.results, triggers: triggers.results };
}
async function moneySnapshot(database: D1DatabaseLike) {
  const reservations = await database
    .prepare('SELECT * FROM billing_funds_reservations ORDER BY org_id,id')
    .all();
  const charges = await database
    .prepare('SELECT * FROM billing_execution_charges ORDER BY org_id,charge_id')
    .all();
  const ledger = await database
    .prepare('SELECT * FROM billing_ledger_entries ORDER BY org_id,id')
    .all();
  const postings = await database
    .prepare('SELECT * FROM billing_ledger_postings ORDER BY org_id,id')
    .all();
  const accounts = await database
    .prepare(
      `SELECT o.id AS org_id,
    COALESCE((SELECT SUM(CASE direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor END) FROM billing_ledger_postings WHERE namespace=o.namespace AND org_id=o.id AND account_code='org_prepaid_liability'),0) AS posted,
    COALESCE((SELECT SUM(requested_minor) FROM billing_funds_reservations WHERE namespace=o.namespace AND org_id=o.id AND status IN('reserved','indeterminate')),0) AS held,
    COALESCE((SELECT SUM(amount_minor) FROM billing_refunds WHERE namespace=o.namespace AND org_id=o.id AND origin='console' AND status IN('requested','provider_pending')),0) AS pending
    FROM organizations o WHERE namespace=? ORDER BY id`,
    )
    .bind(namespace)
    .all();
  return {
    reservations: reservations.results,
    charges: charges.results,
    ledger: ledger.results,
    postings: postings.results,
    accounts: accounts.results,
  };
}
async function oldSource(database: D1DatabaseLike): Promise<void> {
  const timestamp = now().getTime();
  for (const state of ['RESERVED', 'SETTLED', 'RELEASED']) {
    const requested = state === 'RESERVED' ? 60 : 40;
    await database
      .prepare(
        `INSERT INTO billing_prepaid_reservations
      (namespace,org_id,id,environment_id,policy_id,source_event_id,requested_minor,posted_balance_minor,settled_minor,released_minor,status,tx_or_execution_ref,pricing_version,expires_at_ms,created_at_ms,updated_at_ms)
      VALUES (?,?,?,?,NULL,?,?,500,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        namespace,
        'migration',
        `old-${state}`,
        'project-migration:dev',
        `old-execution-${state}`,
        requested,
        state === 'SETTLED' ? requested : 0,
        state === 'RELEASED' ? requested : 0,
        state,
        state === 'SETTLED' ? 'old-chain-reference' : null,
        state === 'SETTLED' ? 'old-wallet-price-v1' : null,
        timestamp + 300_000,
        timestamp,
        timestamp,
      )
      .run();
  }
  const source = await services(database);
  const runtime = getConsoleBillingD1Runtime(source.billing);
  if (!runtime) throw new Error('Historical billing runtime is unavailable');
  const debit = await createProductExecutionDebitD1Statements({
    runtime,
    ctx: context('migration'),
    request: {
      amountMinor: 40,
      sourceEventId: 'sponsored_evm_call_debit:old-execution-SETTLED',
      resourceId: 'old-wallet',
      occurredAt: now().toISOString(),
      pricingVersion: 'old-wallet-price-v1',
      txOrExecutionRef: 'old-chain-reference',
    },
    entryId: 'ble_old_settled',
    occurredAtMs: timestamp,
  });
  await database.batch([debit.ledgerStatement, ...debit.notificationStatements]);
}
function isAccepted<T, E>(result: PlatformResult<T, E>): boolean {
  return result.kind === 'accepted';
}

test('shared funds preserve old holds and serialize service, refund, debit, and terminal races', async () => {
  test.setTimeout(120_000);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  let worker = runtime();
  try {
    let database = await databaseFor(worker);
    await migrateBeforeFunds(database);
    await seedOrganization(database, 'migration', 500);
    await oldSource(database);
    const original = await sourceSnapshot(database);
    await expect(applyMigration(database, '0094_funds_authority.sql')).rejects.toThrow(
      'funds_migration_requires_verified_mapping',
    );
    expect(await sourceSnapshot(database)).toEqual(original);
    expect(
      await database
        .prepare("SELECT name FROM sqlite_master WHERE name='billing_reservation_history'")
        .first(),
    ).toBeNull();
    await activate(database, 'migration', 'wallet');
    await applyMigration(database, '0094_funds_authority.sql');
    await migrateAfterFunds(database);
    const history = await database
      .prepare('SELECT * FROM billing_reservation_history ORDER BY id')
      .all();
    expect(history.results).toEqual(original.rows);
    await writeFile(
      path.join(output, 'migration-source.json'),
      `${JSON.stringify(original, null, 2)}\n`,
    );
    await writeFile(
      path.join(output, 'migration-history.json'),
      `${JSON.stringify(history.results, null, 2)}\n`,
    );
    let store = await funds(database);
    const imported = accepted(
      await store.getByExecution(wallet, {
        instanceId: 'wallet-migration',
        executionId: 'old-execution-RESERVED',
      }),
    );
    expect(imported.kind).toBe('indeterminate');
    expect(imported.reservationId).toBe('old-RESERVED');
    expect(imported.requestedMinor).toBe(60);
    expect(imported.createdAt).toBe(now().toISOString());
    expect(accepted(await store.getSummary(wallet, imported.instanceId)).reservedMinor).toBe(60);

    await seedOrganization(database, 'limited', 1);
    await activate(database, 'limited', 'wallet');
    await activate(database, 'limited', 'satyr');
    await database
      .prepare('INSERT INTO billing_isolated_test_accounts (namespace,org_id) VALUES (?,?)')
      .bind(namespace, 'limited')
      .run();
    const cross = await Promise.all([
      store.reserve(wallet, reserveRequest('wallet-limited', 'wallet-race', 1)),
      store.reserve(
        satyr,
        reserveRequest('satyr-limited', 'satyr-race', 1, 'satyr-completed-turn-test-v1'),
      ),
    ]);
    expect(cross.filter(isAccepted).length).toBe(1);
    expect(accepted(await store.getSummary(wallet, 'wallet-limited'))).toMatchObject({
      postedBalanceMinor: 1,
      reservedMinor: 1,
      pendingRefundMinor: 0,
      availableBalanceMinor: 0,
    });
    await seedOrganization(database, 'duplicate', 5);
    await activate(database, 'duplicate', 'wallet');
    const same = reserveRequest('wallet-duplicate', 'same-request', 5);
    const duplicates = await Promise.all([
      store.reserve(wallet, same),
      store.reserve(wallet, same),
    ]);
    expect(duplicates.filter(isAccepted).length).toBe(2);
    const held = accepted(duplicates[0]).reservation;
    expect(accepted(duplicates[1]).reservation.reservationId).toBe(held.reservationId);
    expect(accepted(await store.getSummary(wallet, 'wallet-duplicate')).reservedMinor).toBe(5);
    await database.prepare('CREATE TABLE funds_effects (label TEXT NOT NULL)').run();
    const effect = database.prepare("INSERT INTO funds_effects(label) VALUES ('terminal')");
    const terminal = settlement(held, 8);
    const terminalRace = await Promise.all([
      store.settle(wallet, terminal, terminalOptions(held, [effect])),
      store.settle(wallet, terminal, terminalOptions(held, [effect])),
    ]);
    expect(terminalRace.filter(isAccepted).length).toBe(2);
    expect(
      await database.prepare('SELECT COUNT(*) AS count FROM funds_effects').first<number>('count'),
    ).toBe(1);
    expect(accepted(await store.getSummary(wallet, held.instanceId))).toMatchObject({
      postedBalanceMinor: -3,
      reservedMinor: 0,
      availableBalanceMinor: -3,
    });
    expect(
      await store.settle(wallet, settlement(held, 9), terminalOptions(held, [effect])),
    ).toMatchObject({ kind: 'rejected', error: { code: 'operation_conflict' } });
    const alteredEvidence = accepted(
      SettleFundsRequestV1.parse({
        version: 1,
        operationId: terminal.operationId,
        reservationId: held.reservationId,
        executionId: held.executionId,
        settledMinor: 8,
        priceVersion: held.priceVersion,
        evidence: {
          sourceRecordId: terminal.evidence.sourceRecordId,
          sourceDigest: digest('different-proof'),
        },
      }),
    );
    expect(
      await store.settle(wallet, alteredEvidence, terminalOptions(held, [effect])),
    ).toMatchObject({ kind: 'rejected', error: { code: 'operation_conflict' } });
    expect(
      await database.prepare('SELECT COUNT(*) AS count FROM funds_effects').first<number>('count'),
    ).toBe(1);

    await seedOrganization(database, 'refund-race', 0);
    await activate(database, 'refund-race', 'wallet');
    const source = await services(database);
    const purchase = await source.billing.createStripeCheckoutSession(context('refund-race'), {
      creditPackId: 'usd_10',
    });
    await source.billing.reconcileStripeCheckoutSession(context('refund-race'), {
      checkoutSessionId: purchase.id,
    });
    const refundRace = await Promise.allSettled([
      store.reserve(wallet, reserveRequest('wallet-refund-race', 'refund-race', 700)),
      source.billing.createRefund(
        { ...context('refund-race'), platformSupport: true },
        {
          purchaseId: purchase.purchaseId,
          amountMinor: 700,
          reason: 'Isolated refund race',
          idempotencyKey: 'refund-race',
        },
      ),
    ]);
    const refundTotals = accepted(await store.getSummary(wallet, 'wallet-refund-race'));
    expect(refundTotals.availableBalanceMinor).toBeGreaterThanOrEqual(0);
    const reserveResult = refundRace[0];
    const refundResult = refundRace[1];
    expect(
      reserveResult.status === 'fulfilled' &&
        reserveResult.value.kind === 'accepted' &&
        refundResult.status === 'fulfilled',
    ).toBe(false);
    await writeFile(
      path.join(output, 'refund-race.json'),
      `${JSON.stringify({ refundRace, refundTotals }, null, 2)}\n`,
    );

    await seedOrganization(database, 'debit-race', 100);
    await activate(database, 'debit-race', 'wallet');
    const debitRace = await Promise.all([
      store.reserve(wallet, reserveRequest('wallet-debit-race', 'debit-race', 90)),
      source.billing.appendManualAdminDebit(context('debit-race'), {
        amountMinor: 30,
        reasonCode: 'acceptance_debit',
        note: 'Metered and manual debits may exhaust admitted funds',
        idempotencyKey: 'debit-race',
      }),
    ]);
    expect(accepted(await store.getSummary(wallet, 'wallet-debit-race')).postedBalanceMinor).toBe(
      70,
    );
    expect(
      await store.reserve(wallet, reserveRequest('wallet-debit-race', 'after-debit', 90)),
    ).toMatchObject({ kind: 'rejected', error: { code: 'insufficient_funds' } });
    await writeFile(
      path.join(output, 'debit-race.json'),
      `${JSON.stringify(debitRace, null, 2)}\n`,
    );

    await seedOrganization(database, 'uncertain', 20);
    await activate(database, 'uncertain', 'wallet');
    const unresolved = accepted(
      await store.reserve(wallet, reserveRequest('wallet-uncertain', 'uncertain-execution', 12)),
    ).reservation;
    accepted(
      await store.markIndeterminate(
        wallet,
        accepted(
          MarkFundsIndeterminateRequestV1.parse({
            version: 1,
            operationId: 'uncertain-marker',
            reservationId: unresolved.reservationId,
            executionId: unresolved.executionId,
          }),
        ),
        { statements: [] },
      ),
    );
    await store.markStaleIndeterminate({ at: new Date('2026-10-14T03:00:00.000Z'), limit: 100 });
    expect(accepted(await store.getSummary(wallet, 'wallet-uncertain')).reservedMinor).toBe(12);
    expect(
      await store.settle(wallet, settlement(unresolved, 12), terminalOptions(unresolved, [])),
    ).toMatchObject({ kind: 'rejected', error: { code: 'execution_unreconciled' } });
    await seedOrganization(database, 'zero', 0);
    await activate(database, 'zero', 'wallet');
    const zero = accepted(
      await store.reserve(wallet, reserveRequest('wallet-zero', 'zero-execution', 0)),
    ).reservation;
    accepted(await store.settle(wallet, settlement(zero, 0), terminalOptions(zero, [])));
    expect(
      (
        await store.getExecutionCharge(wallet, {
          instanceId: zero.instanceId,
          executionId: zero.executionId,
        })
      )?.ledgerEntryId,
    ).toBeNull();
    expect(
      await database
        .prepare('SELECT id FROM billing_ledger_entries WHERE namespace=? AND org_id=?')
        .bind(namespace, 'zero')
        .first(),
    ).toBeNull();
    await seedOrganization(database, 'customer-satyr', 10);
    await activate(database, 'customer-satyr', 'satyr');
    expect(
      await store.reserve(
        satyr,
        reserveRequest('satyr-customer-satyr', 'customer-turn', 1, 'satyr-completed-turn-test-v1'),
      ),
    ).toMatchObject({ kind: 'rejected', error: { code: 'price_unavailable' } });
    const beforeRestart = await moneySnapshot(database);
    await writeFile(
      path.join(output, 'before-restart.json'),
      `${JSON.stringify(beforeRestart, null, 2)}\n`,
    );
    await worker.dispose();
    worker = runtime();
    database = await databaseFor(worker);
    store = await funds(database);
    expect(await moneySnapshot(database)).toEqual(beforeRestart);
    expect(accepted(await store.getReservation(wallet, unresolved.reservationId)).kind).toBe(
      'indeterminate',
    );
    accepted(
      await store.settle(
        wallet,
        terminal,
        terminalOptions(held, [
          database.prepare("INSERT INTO funds_effects(label) VALUES ('replay-must-not-run')"),
        ]),
      ),
    );
    expect(
      await database.prepare('SELECT COUNT(*) AS count FROM funds_effects').first<number>('count'),
    ).toBe(1);
    const reconciliation = accepted(
      ReconcileFundsRequestV1.parse({
        version: 1,
        operationId: 'uncertain-reconciled',
        reservationId: unresolved.reservationId,
        executionId: unresolved.executionId,
        outcome: {
          kind: 'charged',
          settledMinor: 15,
          priceVersion: unresolved.priceVersion,
          evidence: {
            sourceRecordId: 'accepted-chain-receipt',
            sourceDigest: digest('accepted-chain-receipt'),
          },
        },
      }),
    );
    expect(
      accepted(await store.reconcile(wallet, reconciliation, terminalOptions(unresolved, []))).kind,
    ).toBe('settled');
    const migratedReconcile = accepted(
      ReconcileFundsRequestV1.parse({
        version: 1,
        operationId: 'imported-no-charge',
        reservationId: imported.reservationId,
        executionId: imported.executionId,
        outcome: {
          kind: 'no_charge',
          noChargeEvidence: {
            sourceRecordId: 'imported-execution-no-broadcast',
            sourceDigest: digest('imported-execution-no-broadcast'),
          },
        },
      }),
    );
    accepted(await store.reconcile(wallet, migratedReconcile, terminalOptions(imported, [])));
    const finalSource = await services(database);
    const statementResult = await finalSource.billing.generateMonthlyInvoice(context('duplicate'), {
      periodMonthUtc: '2026-10',
    });
    if (!statementResult.invoice) throw new Error('Funds billing statement is unavailable');
    const lineItems = await finalSource.billing.listInvoiceLineItems(
      context('duplicate'),
      statementResult.invoice.id,
    );
    await writeFile(
      path.join(output, 'statement.pdf'),
      buildConsoleBillingInvoicePdf({
        orgId: 'duplicate',
        invoice: statementResult.invoice,
        lineItems,
        exportedAt: now(),
      }),
    );
    await writeFile(
      path.join(output, 'after-restart.json'),
      `${JSON.stringify(await moneySnapshot(database), null, 2)}\n`,
    );
    const report = {
      version: 1,
      passed: true,
      command:
        'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-funds.e2e.test.ts',
      evidence: [
        'migration-source.json',
        'migration-history.json',
        'before-restart.json',
        'after-restart.json',
        'refund-race.json',
        'debit-race.json',
        'statement.pdf',
      ],
      checks: [
        'unmapped migration rolls back original rows and triggers',
        'original open and closed reservation rows preserved',
        'open imported holds become indeterminate',
        'cross-service limited balance race',
        'identical reserve race returns one durable hold',
        'actual Wallet cost exceeds hold and preserves negative balance',
        'terminal race executes extension once',
        'changed amount and evidence conflict',
        'refund and reserve serialize',
        'manual debit and reserve serialize',
        'timers preserve unresolved holds',
        'restart and crash-after-commit replay',
        'proof-backed reconciliation',
        'zero holds and charges create no zero postings',
        'customer Satyr test price denied',
      ],
    };
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await worker.dispose();
  }
});
