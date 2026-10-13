import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  BoundServiceInstanceV1,
  PlatformUsageEventV1,
  ReserveFundsRequestV1,
  type PlatformResult,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import {
  AccountMigrationCohortV1,
  planAccountMigration,
  reconcileAccountMigration,
} from '../../../packages/console-server-ts/src/accountPlatform/migration';
import type { D1DatabaseLike, D1Row } from '../../../packages/console-server-ts/src/boundary/d1';
import { createD1ConsoleOrgProjectService } from '../../../packages/console-server-ts/src/orgProjectEnv/d1';
import { createD1ConsoleWalletEnvironmentService } from '../../../packages/wallet-console-server-ts/src/environments/d1';
import { createD1ConsoleBillingService } from '../../../packages/console-server-ts/src/billing/d1';
import { createD1ConsoleOrganizationAccessService } from '../../../packages/console-server-ts/src/teamRbac/d1';
import { buildConsoleBillingInvoicePdf } from '../../../packages/console-server-ts/src/billing/pdf';
import { createD1ConsoleBillingPrepaidReservationService } from '../../../packages/wallet-console-server-ts/src/billingPrepaidReservations/d1';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/rehearsal');
const namespace = 'account-platform-rehearsal-v1';
const context = { orgId: 'org_rehearsal', actorUserId: 'owner-rehearsal' };

function now(): Date {
  return new Date('2026-10-13T00:00:00.000Z');
}

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Account migration rehearsal"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'account-migration' },
    d1Persist: path.join(output, 'state'),
  });
}

async function sourceDatabase(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('CONSOLE_DB');
  if (!isD1DatabaseLike(database)) throw new Error('Rehearsal D1 binding is unavailable');
  return database;
}

async function migrateSource(
  database: D1DatabaseLike,
): Promise<readonly { name: string; digest: string }[]> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  const migrations: { name: string; digest: string }[] = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    const sql = await readFile(path.join(directory, name), 'utf8');
    for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
    migrations.push({ name, digest: digest(sql) });
  }
  return migrations;
}

async function seedSource(database: D1DatabaseLike): Promise<void> {
  const projects = await createD1ConsoleOrgProjectService({ database, namespace, now });
  await projects.upsertOrganization(context, { name: 'Migration rehearsal' });
  const access = await createD1ConsoleOrganizationAccessService({ database, namespace, now });
  await access.bootstrapInitialOwner({
    orgId: context.orgId,
    userId: context.actorUserId,
    email: 'owner@rehearsal.invalid',
    displayName: 'Rehearsal owner',
  });
  await projects.createProject(context, { id: 'native-project-a', name: 'Wallet A' });
  await projects.createProject(context, { id: 'native-project-b', name: 'Wallet B' });
  const environments = await createD1ConsoleWalletEnvironmentService({ database, namespace, now });
  await environments.provisionProjectEnvironments(context, {
    projectId: 'native-project-a',
    liveAccess: 'disabled',
  });
  await environments.provisionProjectEnvironments(context, {
    projectId: 'native-project-b',
    liveAccess: 'disabled',
  });
  const billing = await createD1ConsoleBillingService({ database, namespace, now });
  await billing.grantManualSupportCredit(context, {
    amountMinor: 2500,
    reasonCode: 'migration_rehearsal',
    note: 'Isolated acceptance funds',
    idempotencyKey: 'rehearsal-credit',
  });
  const purchase = await billing.createStripeCheckoutSession(context, { creditPackId: 'usd_10' });
  await billing.reconcileStripeCheckoutSession(context, { checkoutSessionId: purchase.id });
  const replayedPurchase = await billing.reconcileStripeCheckoutSession(context, {
    checkoutSessionId: purchase.id,
  });
  expect(replayedPurchase.settledNow).toBe(false);
  const refund = await billing.createRefund(
    { ...context, platformSupport: true },
    {
      purchaseId: purchase.purchaseId,
      amountMinor: 200,
      reason: 'Isolated migration refund',
      idempotencyKey: 'rehearsal-refund',
    },
  );
  expect(refund.refund.status).toBe('succeeded');
  const first = await billing.recordUsageEvent(context, {
    resourceId: 'shared-native-wallet',
    shouldCount: true,
    sourceEventId: 'wallet-project-a-action',
    occurredAt: now().toISOString(),
  });
  const second = await billing.recordUsageEvent(context, {
    resourceId: 'shared-native-wallet',
    shouldCount: true,
    sourceEventId: 'wallet-project-b-action',
    occurredAt: now().toISOString(),
  });
  expect(first.debitAppliedMinor).toBe(300);
  expect(second.debitAppliedMinor).toBe(0);
  const reservations = await createD1ConsoleBillingPrepaidReservationService({
    database,
    namespace,
    now,
  });
  await reservations.reserve(context, {
    sourceEventId: 'accepted-unfinished-execution',
    environmentId: 'native-project-a:dev',
    postedBalanceMinor: 3000,
    estimatedSpendMinor: 75,
    expiresAt: '2026-10-14T00:00:00.000Z',
  });
  // Existing metered or manual debits can exhaust the balance after admission.
  await billing.appendManualAdminDebit(context, {
    amountMinor: 3100,
    reasonCode: 'migration_rehearsal',
    note: 'Preserve a real outstanding obligation',
    idempotencyKey: 'rehearsal-debit',
  });
  expect((await billing.getOverview(context)).creditBalanceMinor).toBe(-100);
}

async function snapshot(database: D1DatabaseLike): Promise<Record<string, readonly D1Row[]>> {
  const tables = [
    'organizations',
    'projects',
    'environments',
    'organization_memberships',
    'organization_admin_permissions',
    'project_member_access',
    'user_profiles',
    'billing_accounts',
    'billing_ledger_entries',
    'billing_ledger_postings',
    'billing_credit_purchases',
    'billing_refunds',
    'billing_disputes',
    'billing_prepaid_reservations',
    'billing_prepaid_reservation_summaries',
    'billing_monthly_active_resources',
    'invoices',
    'invoice_line_items',
  ];
  const rows: Record<string, readonly D1Row[]> = {};
  for (const table of tables) {
    const result = await database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all<D1Row>();
    rows[table] = result.results || [];
  }
  return rows;
}

function walletEntry(rows: Record<string, readonly D1Row[]>, projectId: string) {
  const environments: string[] = [];
  for (const environment of rows.environments) {
    if (environment.project_id === projectId && typeof environment.id === 'string')
      environments.push(environment.id);
  }
  return {
    binding: {
      instanceId: `instance-${projectId}`,
      scope: {
        namespace,
        organizationId: context.orgId,
        projectId,
        billingAccountId: 'billing-wallet',
      },
      nativeScope: {
        serviceId: 'wallet',
        deploymentId: 'wallet-rehearsal',
        namespace,
        nativeOrganizationId: context.orgId,
        nativeProjectId: projectId,
      },
    },
    checkpoint: {
      serviceId: 'wallet',
      authorityRevision: sourceAuthorityRevision(rows),
      ownership: sourceOwnership(rows),
      identityDigest: digest(rows.user_profiles),
      membershipDigest: digest([
        rows.organization_memberships,
        rows.organization_admin_permissions,
        rows.project_member_access,
      ]),
      operationalDigest: digest(rows.environments),
      ledgerDigest: digest([rows.billing_ledger_entries, rows.billing_ledger_postings]),
      paymentDigest: digest([
        rows.billing_credit_purchases,
        rows.billing_refunds,
        rows.billing_disputes,
      ]),
      postedBalanceMinor: -100,
      openReservationsMinor: 75,
      historicalUnattributedChargeCount: 1,
      environmentIds: environments,
    },
  };
}

function satyrEntry() {
  return {
    binding: {
      instanceId: 'instance-satyr',
      scope: {
        namespace,
        organizationId: 'org_satyr_separate',
        projectId: 'satyr-dedicated',
        billingAccountId: 'billing-satyr',
      },
      nativeScope: {
        serviceId: 'satyr',
        deploymentId: 'satyr-rehearsal',
        nativeOrganizationId: 'native-satyr-tenant',
      },
    },
    checkpoint: {
      serviceId: 'satyr',
      authorityRevision: 7,
      ownership: { kind: 'preserve_source_owners', activeOwnerCount: 1 },
      identityDigest: digest('synthetic-identities'),
      membershipDigest: digest('synthetic-owner-operator-person-bindings'),
      operationalDigest: digest('synthetic-work-projects'),
      placementDigest: digest('synthetic-pinned-placement'),
      placementCellId: 'isolated-apac',
      placementEpoch: 3,
      environment: 'development',
      money: 'no_customer_ledger',
    },
  };
}

function cohortInput(rows: Record<string, readonly D1Row[]>) {
  const entries = [
    walletEntry(rows, 'native-project-a'),
    walletEntry(rows, 'native-project-b'),
    satyrEntry(),
  ];
  const inventory = [];
  for (const entry of entries) inventory.push(entry.binding.nativeScope);
  return { version: 1, cohortId: 'isolated-rehearsal-v1', inventory, entries };
}

function sourceAuthorityRevision(rows: Record<string, readonly D1Row[]>): number {
  for (const organization of rows.organizations) {
    if (
      organization.id === context.orgId &&
      typeof organization.authorization_version === 'number'
    ) {
      return organization.authorization_version;
    }
  }
  throw new Error('Source account revision is unavailable');
}

function sourceOwnership(rows: Record<string, readonly D1Row[]>) {
  let activeOwnerCount = 0;
  for (const membership of rows.organization_memberships) {
    if (
      membership.org_id === context.orgId &&
      membership.role === 'OWNER' &&
      membership.kind === 'ACTIVE'
    ) {
      activeOwnerCount += 1;
    }
  }
  if (activeOwnerCount === 0) return { kind: 'unresolved', reason: 'owner_missing' };
  return { kind: 'preserve_source_owners', activeOwnerCount };
}

function verifyConflicts(rows: Record<string, readonly D1Row[]>): readonly string[] {
  const nativeConflict = cohortInput(rows);
  nativeConflict.entries[1].binding.nativeScope = nativeConflict.entries[0].binding.nativeScope;
  expect(
    planAccountMigration(accepted(AccountMigrationCohortV1.parse(nativeConflict))),
  ).toMatchObject({
    kind: 'rejected',
    error: { code: 'native_scope_already_bound' },
  });
  const billingConflict = cohortInput(rows);
  billingConflict.entries[1].binding.scope.billingAccountId = 'another-billing-account';
  expect(
    planAccountMigration(accepted(AccountMigrationCohortV1.parse(billingConflict))),
  ).toMatchObject({
    kind: 'rejected',
    error: { code: 'billing_account_conflict' },
  });
  const merge = cohortInput(rows);
  merge.entries[2].binding.scope.organizationId = context.orgId;
  merge.entries[2].binding.scope.billingAccountId = 'billing-wallet';
  expect(planAccountMigration(accepted(AccountMigrationCohortV1.parse(merge)))).toMatchObject({
    kind: 'rejected',
    error: { code: 'account_merge_requires_mapping' },
  });
  const omitted = cohortInput(rows);
  omitted.entries.pop();
  expect(planAccountMigration(accepted(AccountMigrationCohortV1.parse(omitted)))).toMatchObject({
    kind: 'rejected',
    error: { code: 'inventory_mapping_incomplete' },
  });
  const ownerless = cohortInput(rows);
  ownerless.entries[0].checkpoint.ownership = { kind: 'unresolved', reason: 'owner_missing' };
  expect(planAccountMigration(accepted(AccountMigrationCohortV1.parse(ownerless)))).toMatchObject({
    kind: 'rejected',
    error: { code: 'owner_mapping_required' },
  });
  return [
    'native_scope_already_bound',
    'billing_account_conflict',
    'account_merge_requires_mapping',
    'inventory_mapping_incomplete',
    'owner_mapping_required',
  ];
}

function verifyUsageBoundary() {
  const usage = {
    version: 1,
    eventId: 'turn:session-1:turn-1',
    instanceId: 'instance-satyr',
    occurredAt: now().toISOString(),
    meterId: 'satyr.completed_turn.test',
    quantity: 1,
    unit: 'turn',
    evidence: {
      kind: 'satyr_turn',
      sourceRecordId: 'accepted-turn-1',
      sourceDigest: digest('terminal-receipt'),
      sessionId: 'session-1',
      turnId: 'turn-1',
      terminalOutcome: 'completed',
      reservationId: 'reservation-turn-1',
      funding: {
        kind: 'platform',
        selection: 'satyr_platform',
        modelRouteDigest: digest('pinned-model-route'),
      },
    },
  };
  const parsed = accepted(PlatformUsageEventV1.parse(usage));
  expect(accepted(PlatformUsageEventV1.parse(JSON.parse(JSON.stringify(parsed))))).toEqual(parsed);
  expect(PlatformUsageEventV1.parse({ ...usage, quantity: 0.5 })).toMatchObject({
    kind: 'rejected',
  });
  expect(PlatformUsageEventV1.parse({ ...usage, amountMinor: 100 })).toMatchObject({
    kind: 'rejected',
  });
  expect(PlatformUsageEventV1.parse({ ...usage, version: 2 })).toMatchObject({
    kind: 'rejected',
    error: { code: 'version_unsupported' },
  });
  const reserve = {
    version: 1,
    operationId: 'reserve-1',
    instanceId: 'instance-satyr',
    executionId: 'turn-1',
    requestedMinor: 1,
    priceVersion: 'satyr-completed-turn-test-v1',
  };
  expect(ReserveFundsRequestV1.parse(reserve)).toMatchObject({ kind: 'accepted' });
  expect(ReserveFundsRequestV1.parse({ ...reserve, postedBalanceMinor: 1_000_000 })).toMatchObject({
    kind: 'rejected',
  });
  return parsed;
}

test('migration preflight preserves two native Wallet projects, money, holds, and a separate Satyr tenant across restart', async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  let worker = runtime();
  try {
    let database = await sourceDatabase(worker);
    const migrations = await migrateSource(database);
    await seedSource(database);
    const billing = await createD1ConsoleBillingService({ database, namespace, now });
    const generated = await billing.generateMonthlyInvoice(context, { periodMonthUtc: '2026-10' });
    if (!generated.invoice) throw new Error('Rehearsal statement is unavailable');
    const lineItems = await billing.listInvoiceLineItems(context, generated.invoice.id);
    await writeFile(
      path.join(output, 'statement.pdf'),
      buildConsoleBillingInvoicePdf({
        orgId: context.orgId,
        invoice: generated.invoice,
        lineItems,
        exportedAt: now(),
      }),
    );
    const before = await snapshot(database);
    const input = cohortInput(before);
    const cohort = accepted(AccountMigrationCohortV1.parse(input));
    const plan = accepted(planAccountMigration(cohort));
    expect(plan.entries).toHaveLength(3);
    expect(plan.billingAccounts).toHaveLength(2);
    expect(plan.billingAccounts).toContainEqual({
      namespace,
      organizationId: context.orgId,
      billingAccountId: 'billing-wallet',
      currency: 'USD',
      money: {
        kind: 'preserve_ledger',
        postedBalanceMinor: -100,
        openReservationsMinor: 75,
        ledgerDigest: digest([before.billing_ledger_entries, before.billing_ledger_postings]),
      },
    });
    const conflicts = verifyConflicts(before);
    const usage = verifyUsageBoundary();
    const binding = plan.entries[0].binding;
    const activation = {
      instanceId: binding.instanceId,
      operationId: 'activate-1',
      desiredState: 'enabled',
      desiredRevision: 1,
      receipt: {
        version: 1,
        operationId: 'activate-1',
        instanceId: binding.instanceId,
        desiredRevision: 1,
        result: 'active',
        binding,
      },
    };
    expect(BoundServiceInstanceV1.active(activation).kind).toBe('accepted');
    expect(BoundServiceInstanceV1.active({ ...activation, desiredRevision: 2 })).toMatchObject({
      kind: 'rejected',
      error: { field: 'receipt.desiredRevision' },
    });
    expect(
      BoundServiceInstanceV1.active({ ...activation, desiredState: 'disabled' }),
    ).toMatchObject({
      kind: 'rejected',
      error: { field: 'desiredState' },
    });
    await writeFile(path.join(output, 'cohort.json'), JSON.stringify(input, null, 2));
    await worker.dispose();
    worker = runtime();
    database = await sourceDatabase(worker);
    const persisted = accepted(
      AccountMigrationCohortV1.parse(
        JSON.parse(await readFile(path.join(output, 'cohort.json'), 'utf8')),
      ),
    );
    const after = await snapshot(database);
    const reloaded = accepted(AccountMigrationCohortV1.parse(cohortInput(after)));
    expect(reconcileAccountMigration(persisted, reloaded).kind).toBe('accepted');
    expect(after).toEqual(before);
    const changed = cohortInput(after);
    changed.entries[0].checkpoint.membershipDigest = digest('changed-membership');
    expect(
      reconcileAccountMigration(cohort, accepted(AccountMigrationCohortV1.parse(changed))).kind,
    ).toBe('rejected');
    await writeFile(path.join(output, 'usage-events.json'), JSON.stringify([usage], null, 2));
    await writeFile(
      path.join(output, 'reconciliation.json'),
      JSON.stringify({ before, after, unchanged: true }, null, 2),
    );
    await writeFile(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2));
    await writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          version: 1,
          phase: 1,
          result: 'passed',
          fixtureVersion: 'isolated-rehearsal-v1',
          command:
            'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-migration.e2e.test.ts',
          migrations,
          bindingCount: plan.entries.length,
          billingAccountCount: plan.billingAccounts.length,
          expected: {
            postedBalanceMinor: -100,
            openReservationsMinor: 75,
            refundCount: 1,
            unchangedSourceRows: true,
          },
          rejectedConflicts: conflicts,
          billingDocument: 'statement.pdf',
          limitations: [
            'Satyr tenant checkpoint is synthetic',
            'No target schema or production cutover',
            'No UI steps in phase 1',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await worker.dispose();
  }
});
