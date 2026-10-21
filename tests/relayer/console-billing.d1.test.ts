/// <reference lib="es2024.promise" />
import { expect, test } from '@playwright/test';
import {
  createD1BillingLedgerEntryInsertStatement,
  createD1ConsoleBillingService,
} from '../../packages/console-server-ts/src/billing/d1';
import { createSimulatedBillingProviderAdapters } from '../../packages/console-server-ts/src/billing/providers';
import type { ConsoleBillingRefundSupportContext } from '../../packages/console-server-ts/src/billing/service';
import { ensureAccountPlatformD1Schema } from '../../packages/console-server-ts/src/accountPlatform/schema';
import { ensureBillingFundsD1Schema } from '../../packages/console-server-ts/src/billingPrepaidReservations/schema';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
  readTableColumnNames,
} from '../helpers/sqliteD1';

const SUPPORT_CONTEXT: ConsoleBillingRefundSupportContext = {
  orgId: 'org-d1-refunds',
  actorUserId: 'support-d1-refunds',
  platformSupport: true,
};

const BILLING_NAMESPACE = 'billing-d1-refund-test';

async function seedBillingEmailOwners(
  database: Parameters<typeof createD1ConsoleBillingService>[0]['database'],
): Promise<void> {
  const createdAtMs = Date.parse('2026-03-19T00:00:00.000Z');
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (namespace, id, name, slug, created_by_user_id, status, created_at_ms, updated_at_ms)
         VALUES (?, ?, 'D1 Billing Org', 'd1-billing-org', ?, 'ACTIVE', ?, ?)`,
      )
      .bind(
        BILLING_NAMESPACE,
        SUPPORT_CONTEXT.orgId,
        SUPPORT_CONTEXT.actorUserId,
        createdAtMs,
        createdAtMs,
      ),
    database
      .prepare(
        `INSERT INTO organization_memberships
          (namespace, org_id, id, user_id, email, email_normalized, display_name, kind, role, suspended_at_ms, removed_at_ms, created_at_ms, updated_at_ms)
         VALUES (?, ?, 'membership-owner-one', 'owner-one', 'owner-one@example.com', 'owner-one@example.com', 'Owner One', 'ACTIVE', 'OWNER', NULL, NULL, ?, ?)`,
      )
      .bind(BILLING_NAMESPACE, SUPPORT_CONTEXT.orgId, createdAtMs, createdAtMs),
    database
      .prepare(
        `INSERT INTO organization_memberships
          (namespace, org_id, id, user_id, email, email_normalized, display_name, kind, role, suspended_at_ms, removed_at_ms, created_at_ms, updated_at_ms)
         VALUES (?, ?, 'membership-owner-two', 'owner-two', 'owner-two@example.com', 'owner-two@example.com', 'Owner Two', 'ACTIVE', 'OWNER', NULL, NULL, ?, ?)`,
      )
      .bind(BILLING_NAMESPACE, SUPPORT_CONTEXT.orgId, createdAtMs + 1, createdAtMs + 1),
    database
      .prepare(
        `UPDATE organizations
            SET owner_anchor_membership_id = 'membership-owner-one'
          WHERE namespace = ?
            AND id = ?`,
      )
      .bind(BILLING_NAMESPACE, SUPPORT_CONTEXT.orgId),
  ]);
}

async function listBillingEmailRows(
  database: Parameters<typeof createD1ConsoleBillingService>[0]['database'],
): Promise<Array<{ template_family: string; template_payload_json: string }>> {
  const result = await database
    .prepare(
      `SELECT template_family, template_payload_json
         FROM console_email_outbox
        WHERE namespace = ?
          AND org_id = ?
        ORDER BY template_family ASC, id ASC`,
    )
    .bind(BILLING_NAMESPACE, SUPPORT_CONTEXT.orgId)
    .all<{ template_family: string; template_payload_json: string }>();
  return [...(result.results || [])];
}

async function readLowBalanceWarningActive(
  database: Parameters<typeof createD1ConsoleBillingService>[0]['database'],
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT low_balance_warning_active
         FROM billing_accounts
        WHERE namespace = ?
          AND org_id = ?`,
    )
    .bind(BILLING_NAMESPACE, SUPPORT_CONTEXT.orgId)
    .first<{ low_balance_warning_active: number }>();
  return Number(row?.low_balance_warning_active);
}

async function seedHistoricalUsageDebit(
  database: Parameters<typeof createD1ConsoleBillingService>[0]['database'],
): Promise<void> {
  await createD1BillingLedgerEntryInsertStatement(database, {
    namespace: BILLING_NAMESPACE,
    orgId: SUPPORT_CONTEXT.orgId,
    entryId: 'historical-refund-usage',
    type: 'USAGE_DEBIT',
    amountMinor: -300,
    description: 'Historical usage before shared service attribution',
    monthUtc: '2026-03',
    relatedInvoiceId: null,
    relatedPurchaseId: null,
    sourceEventId: 'historical-refund-usage',
    actorType: 'SYSTEM',
    actorUserId: null,
    reasonCode: null,
    note: null,
    idempotencyKey: null,
    createdAtMs: Date.parse('2026-03-20T00:00:00.000Z'),
  }).run();
}

test('D1 billing reconstructs balanced credit and persists provider-backed refunds and disputes', async () => {
  const temporary = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(temporary.database, listD1MigrationFiles('d1-console-core'));
    await seedBillingEmailOwners(temporary.database);
    const billing = await createD1ConsoleBillingService({
      database: temporary.database,
      namespace: BILLING_NAMESPACE,
      now: () => new Date('2026-03-20T00:00:00.000Z'),
      providers: createSimulatedBillingProviderAdapters(),
      emailConsoleBaseUrl: 'https://console.example.com',
    });

    const checkout = await billing.createStripeCheckoutSession(SUPPORT_CONTEXT, {
      creditPackId: 'usd_25',
    });
    const settled = await billing.reconcileStripeCheckoutSession(SUPPORT_CONTEXT, {
      checkoutSessionId: checkout.id,
    });
    expect(settled.purchase?.status).toBe('SETTLED');
    expect(
      await billing.getStripePostProcessingOutboxItem(`stripe_checkout_reconcile:${checkout.id}`),
    ).toBeNull();
    if (!settled.purchase || settled.purchase.status !== 'SETTLED') {
      throw new Error('Expected settled D1 purchase');
    }
    expect(
      (await listBillingEmailRows(temporary.database)).filter(
        (row) => row.template_family === 'PREPAID_TOP_UP_RECEIPT',
      ),
    ).toHaveLength(2);

    const refund = await billing.createRefund(SUPPORT_CONTEXT, {
      purchaseId: settled.purchase.id,
      amountMinor: 1000,
      reason: 'customer_request',
      idempotencyKey: 'd1-refund-1',
    });
    expect(refund.refund.status).toBe('succeeded');
    expect(refund.creditBalanceMinor).toBe(1500);
    const afterRefundEmails = await listBillingEmailRows(temporary.database);
    expect(
      afterRefundEmails.filter((row) => row.template_family === 'BILLING_REFUND_RESULT'),
    ).toHaveLength(2);
    // a low balance arms the console warning and sends no email
    expect(
      afterRefundEmails.filter((row) => row.template_family === 'LOW_BALANCE_WARNING'),
    ).toHaveLength(0);
    expect(await readLowBalanceWarningActive(temporary.database)).toBe(1);

    const duplicate = await billing.createRefund(SUPPORT_CONTEXT, {
      purchaseId: settled.purchase.id,
      amountMinor: 1000,
      reason: 'customer_request',
      idempotencyKey: 'd1-refund-1',
    });
    expect(duplicate.created).toBe(false);
    expect(duplicate.refund.id).toBe(refund.refund.id);

    const entries = (await billing.listAccountActivity(SUPPORT_CONTEXT, { limit: 20 })).entries;
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.postings).toHaveLength(2);
      expect(entry.postings[0].direction).toBe('DEBIT');
      expect(entry.postings[1].direction).toBe('CREDIT');
      expect(entry.postings[0].amountMinor).toBe(entry.postings[1].amountMinor);
    }
    expect(await readTableColumnNames(temporary.database, 'billing_accounts')).not.toContain(
      'credit_balance_minor',
    );

    await seedHistoricalUsageDebit(temporary.database);
    const firstInvoicePage = await billing.listInvoicesPage(SUPPORT_CONTEXT, { limit: 1 });
    expect(firstInvoicePage.invoices).toHaveLength(1);
    expect(firstInvoicePage.nextCursor).not.toBeNull();
    const secondInvoicePage = await billing.listInvoicesPage(SUPPORT_CONTEXT, {
      limit: 1,
      cursor: firstInvoicePage.nextCursor || undefined,
    });
    expect(secondInvoicePage.invoices).toHaveLength(1);
    expect(secondInvoicePage.invoices[0]?.id).not.toBe(firstInvoicePage.invoices[0]?.id);
    expect(secondInvoicePage.nextCursor).toBeNull();
    expect(await readLowBalanceWarningActive(temporary.database)).toBe(1);
    const failedExternal = await billing.processStripeWebhookEvent({
      eventId: 'evt_d1_external_refund_failed',
      eventType: 'refund.updated',
      refund: {
        providerRefundId: 're_d1_external_failed',
        refundId: null,
        purchaseId: settled.purchase.id,
        orgId: SUPPORT_CONTEXT.orgId,
        providerPaymentRef: settled.purchase.providerPaymentRef,
        amountMinor: 100,
        status: 'failed',
        reason: 'provider_refund',
        failureCode: 'declined',
      },
    });
    expect(failedExternal.refunds[0]?.status).toBe('failed');
    // a failed refund shows in the console and sends no email
    expect(
      (await listBillingEmailRows(temporary.database)).filter(
        (row) => row.template_family === 'BILLING_REFUND_RESULT',
      ),
    ).toHaveLength(2);
    const external = await billing.processStripeWebhookEvent({
      eventId: 'evt_d1_external_refund',
      eventType: 'refund.updated',
      refund: {
        providerRefundId: 're_d1_external',
        refundId: null,
        purchaseId: settled.purchase.id,
        orgId: SUPPORT_CONTEXT.orgId,
        providerPaymentRef: settled.purchase.providerPaymentRef,
        amountMinor: 1500,
        status: 'succeeded',
        reason: 'provider_refund',
        failureCode: null,
      },
    });
    expect(external.refunds[0]?.status).toBe('succeeded');
    expect((await billing.getOverview(SUPPORT_CONTEXT)).creditBalanceMinor).toBe(-300);
    const finalRefundEmails = (await listBillingEmailRows(temporary.database)).filter(
      (row) => row.template_family === 'BILLING_REFUND_RESULT',
    );
    expect(finalRefundEmails).toHaveLength(4);
    expect(
      finalRefundEmails.map((row) => JSON.parse(row.template_payload_json).outcome).sort(),
    ).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);

    const opened = await billing.processStripeWebhookEvent({
      eventId: 'evt_d1_dispute_opened',
      eventType: 'charge.dispute.created',
      orgId: SUPPORT_CONTEXT.orgId,
      purchaseId: settled.purchase.id,
      providerPaymentRef: settled.purchase.providerPaymentRef,
      providerDisputeId: 'dp_d1_refund',
      amountMinor: 500,
    });
    expect(opened.dispute?.status).toBe('open');
    expect((await billing.getOverview(SUPPORT_CONTEXT)).creditBalanceMinor).toBe(-800);

    const won = await billing.processStripeWebhookEvent({
      eventId: 'evt_d1_dispute_won',
      eventType: 'charge.dispute.closed',
      orgId: SUPPORT_CONTEXT.orgId,
      purchaseId: settled.purchase.id,
      providerPaymentRef: settled.purchase.providerPaymentRef,
      providerDisputeId: 'dp_d1_refund',
      amountMinor: 500,
      outcome: 'won',
    });
    expect(won.dispute?.status).toBe('won');
    expect((await billing.getOverview(SUPPORT_CONTEXT)).creditBalanceMinor).toBe(-300);
  } finally {
    cleanupTemporaryD1Database(temporary.tempDir);
  }
});

test('D1 billing reserves refund capacity before awaiting Stripe', async () => {
  const temporary = createTemporaryD1Database();
  const firstRefundGate = Promise.withResolvers<void>();
  try {
    await applyD1MigrationFiles(temporary.database, listD1MigrationFiles('d1-console-core'));
    const defaults = createSimulatedBillingProviderAdapters();
    const firstRefundStarted = Promise.withResolvers<void>();
    let refundAttempts = 0;
    const billing = await createD1ConsoleBillingService({
      database: temporary.database,
      namespace: 'billing-d1-concurrent-refund-test',
      now: () => new Date('2026-03-20T00:00:00.000Z'),
      providers: {
        stripe: {
          ...defaults.stripe,
          createRefund: async (input) => {
            refundAttempts += 1;
            if (refundAttempts === 1) {
              firstRefundStarted.resolve();
              await firstRefundGate.promise;
            }
            return {
              id: `re_${input.refundId}`,
              status: 'pending',
              failureCode: null,
            };
          },
        },
      },
    });
    const checkout = await billing.createStripeCheckoutSession(SUPPORT_CONTEXT, {
      creditPackId: 'usd_10',
    });
    const settled = await billing.reconcileStripeCheckoutSession(SUPPORT_CONTEXT, {
      checkoutSessionId: checkout.id,
    });
    if (!settled.purchase || settled.purchase.status !== 'SETTLED') {
      throw new Error('Expected settled D1 purchase');
    }

    const firstRefund = billing.createRefund(SUPPORT_CONTEXT, {
      purchaseId: settled.purchase.id,
      amountMinor: 700,
      reason: 'customer_request',
      idempotencyKey: 'd1-concurrent-refund-one',
    });
    await firstRefundStarted.promise;
    await expect(
      billing.createRefund(SUPPORT_CONTEXT, {
        purchaseId: settled.purchase.id,
        amountMinor: 700,
        reason: 'customer_request',
        idempotencyKey: 'd1-concurrent-refund-two',
      }),
    ).rejects.toMatchObject({
      code: 'refund_amount_exceeds_purchase',
    });
    firstRefundGate.resolve();
    const reserved = await firstRefund;
    expect(reserved.refund.status).toBe('provider_pending');
    expect(refundAttempts).toBe(1);
  } finally {
    firstRefundGate.resolve();
    cleanupTemporaryD1Database(temporary.tempDir);
  }
});

test('D1 billing matches the exact checkout session and retries an ambiguous refund request', async () => {
  const temporary = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(temporary.database, listD1MigrationFiles('d1-console-core'));
    const defaults = createSimulatedBillingProviderAdapters();
    let refundAttempts = 0;
    const billing = await createD1ConsoleBillingService({
      database: temporary.database,
      namespace: 'billing-d1-provider-retry-test',
      now: () => new Date('2026-03-20T00:00:00.000Z'),
      providers: {
        stripe: {
          ...defaults.stripe,
          createRefund: (input) => {
            refundAttempts += 1;
            if (refundAttempts === 1) throw new Error('provider response lost');
            return {
              id: `re_${input.refundId}`,
              status: 'succeeded',
              failureCode: null,
            };
          },
        },
      },
    });
    const first = await billing.createStripeCheckoutSession(SUPPORT_CONTEXT, {
      creditPackId: 'usd_10',
    });
    const second = await billing.createStripeCheckoutSession(SUPPORT_CONTEXT, {
      creditPackId: 'usd_50',
    });
    expect(first.customerRef).toBe(second.customerRef);

    const settled = await billing.processStripeWebhookEvent({
      eventId: 'evt_d1_exact_checkout',
      eventType: 'checkout.session.completed',
      orgId: SUPPORT_CONTEXT.orgId,
      checkoutSessionId: first.id,
      providerCustomerRef: first.customerRef,
      providerPaymentRef: `pi_${first.purchaseId}`,
      providerRef: first.id,
      purchaseId: first.purchaseId,
      creditPackId: first.creditPackId,
      amountMinor: first.amountMinor,
      currency: 'USD',
      paymentStatus: 'paid',
    });
    expect(settled.purchase?.id).toBe(first.purchaseId);
    expect(await billing.getStripePostProcessingOutboxItem('evt_d1_exact_checkout')).toMatchObject({
      eventId: 'evt_d1_exact_checkout',
      orgId: SUPPORT_CONTEXT.orgId,
      auditCompletedAt: null,
      customerWebhookCompletedAt: null,
      attemptCount: 0,
    });
    const replayed = await billing.processStripeWebhookEvent({
      eventId: 'evt_d1_exact_checkout',
      eventType: 'checkout.session.completed',
      orgId: SUPPORT_CONTEXT.orgId,
      checkoutSessionId: first.id,
      providerCustomerRef: first.customerRef,
      providerPaymentRef: `pi_${first.purchaseId}`,
      providerRef: first.id,
      purchaseId: first.purchaseId,
      creditPackId: first.creditPackId,
      amountMinor: first.amountMinor,
      currency: 'USD',
      paymentStatus: 'paid',
    });
    expect(replayed.accepted).toBe(false);
    expect(replayed.purchase?.id).toBe(first.purchaseId);
    expect(replayed.invoice?.documentType).toBe('PURCHASE_RECEIPT');
    expect(await billing.listPendingStripePostProcessingOutboxItems(10)).toHaveLength(1);
    await billing.recordStripePostProcessingFailure({
      eventId: 'evt_d1_exact_checkout',
      error: 'simulated delivery failure',
    });
    await billing.completeStripePostProcessingEffect({
      eventId: 'evt_d1_exact_checkout',
      effect: 'audit',
    });
    expect(await billing.getStripePostProcessingOutboxItem('evt_d1_exact_checkout')).toMatchObject({
      attemptCount: 1,
      lastError: null,
      customerWebhookCompletedAt: null,
    });
    await billing.completeStripePostProcessingEffect({
      eventId: 'evt_d1_exact_checkout',
      effect: 'customer_webhook',
    });
    expect(await billing.listPendingStripePostProcessingOutboxItems(10)).toHaveLength(0);
    expect((await billing.getOverview(SUPPORT_CONTEXT)).creditBalanceMinor).toBe(1000);
    const expired = await billing.processStripeWebhookEvent({
      eventId: 'evt_d1_expired_checkout',
      eventType: 'checkout.session.expired',
      orgId: SUPPORT_CONTEXT.orgId,
      checkoutSessionId: second.id,
      providerRef: second.id,
      purchaseId: second.purchaseId,
    });
    expect(expired.purchase?.status).toBe('CANCELED');

    const request = {
      purchaseId: first.purchaseId,
      amountMinor: 500,
      reason: 'customer_request',
      idempotencyKey: 'd1-ambiguous-refund',
    };
    await expect(billing.createRefund(SUPPORT_CONTEXT, request)).rejects.toMatchObject({
      code: 'refund_provider_error',
    });
    expect((await billing.listRefunds(SUPPORT_CONTEXT))[0]).toMatchObject({
      status: 'requested',
      providerRefundId: null,
    });

    const retried = await billing.createRefund(SUPPORT_CONTEXT, request);
    expect(retried.created).toBe(false);
    expect(retried.refund.status).toBe('succeeded');
    expect(retried.creditBalanceMinor).toBe(500);
    expect(refundAttempts).toBe(2);
  } finally {
    cleanupTemporaryD1Database(temporary.tempDir);
  }
});

for (const directory of ['d1-console-core', 'd1-console'] as const) {
  test(`${directory} refund migration preserves existing balances and refund references`, async () => {
    const temporary = createTemporaryD1Database();
    try {
      const migrations = listD1MigrationFiles(directory);
      // Later migrations follow this one in d1-console, so it is selected by name.
      const refundIndex = migrations.findIndex((file) => file.endsWith('refund_ledger_debits.sql'));
      const migration = migrations[refundIndex];
      if (!migration) throw new Error('Expected refund migration');
      await applyD1MigrationFiles(temporary.database, migrations.slice(0, refundIndex));
      await ensureAccountPlatformD1Schema(temporary.database);
      await ensureBillingFundsD1Schema(temporary.database);
      const billing = await createD1ConsoleBillingService({
        database: temporary.database,
        namespace: BILLING_NAMESPACE,
        providers: createSimulatedBillingProviderAdapters(),
      });
      const checkout = await billing.createStripeCheckoutSession(SUPPORT_CONTEXT, {
        creditPackId: 'usd_25',
      });
      const settlement = await billing.reconcileStripeCheckoutSession(SUPPORT_CONTEXT, {
        checkoutSessionId: checkout.id,
      });
      if (settlement.purchase?.status !== 'SETTLED') throw new Error('Expected a settled purchase');
      const refundId = 'historical-refund';
      const entryId = `ble_${refundId}`;
      const providerRefundId = `re_${refundId}`;
      const createdAtMs = Date.now();
      await temporary.database.batch([
        createD1BillingLedgerEntryInsertStatement(temporary.database, {
          namespace: BILLING_NAMESPACE,
          orgId: SUPPORT_CONTEXT.orgId,
          entryId,
          type: 'REFUND',
          amountMinor: 100,
          description: 'Pre-migration refund',
          monthUtc: null,
          relatedInvoiceId: null,
          relatedPurchaseId: settlement.purchase.id,
          sourceEventId: providerRefundId,
          actorType: 'PROVIDER',
          actorUserId: null,
          reasonCode: 'customer_request',
          note: null,
          idempotencyKey: `refund:${refundId}`,
          createdAtMs,
        }),
        temporary.database
          .prepare(
            `INSERT INTO billing_refunds
              (namespace, org_id, id, purchase_id, amount_minor, currency, reason, origin,
                requester_user_id, idempotency_key, status, provider_refund_id, failure_code,
                journal_entry_id, created_at_ms, updated_at_ms)
             VALUES (?, ?, ?, ?, 100, 'USD', 'customer_request', 'console', ?,
               'migration-refund', 'succeeded', ?, NULL, ?, ?, ?)`,
          )
          .bind(
            BILLING_NAMESPACE,
            SUPPORT_CONTEXT.orgId,
            refundId,
            settlement.purchase.id,
            SUPPORT_CONTEXT.actorUserId,
            providerRefundId,
            entryId,
            createdAtMs,
            createdAtMs,
          ),
      ]);
      expect((await billing.getOverview(SUPPORT_CONTEXT)).creditBalanceMinor).toBe(2600);
      await applyD1MigrationFiles(temporary.database, [migration]);
      expect((await billing.getOverview(SUPPORT_CONTEXT)).creditBalanceMinor).toBe(2400);
      expect((await billing.listRefunds(SUPPORT_CONTEXT))[0]).toMatchObject({
        id: refundId,
        status: 'succeeded',
      });
      expect((await temporary.database.prepare('PRAGMA foreign_key_check').all()).results).toEqual(
        [],
      );
      const next = await billing.createRefund(SUPPORT_CONTEXT, {
        purchaseId: settlement.purchase.id,
        amountMinor: 100,
        reason: 'customer_request',
        idempotencyKey: 'after-migration-refund',
      });
      expect(next.refund.status).toBe('succeeded');
      expect(next.creditBalanceMinor).toBe(2300);
    } finally {
      cleanupTemporaryD1Database(temporary.tempDir);
    }
  });
}
