import { reconcileInvoiceCredits } from './invoiceCredits';
import { readBillingPaymentPolicy } from './postpaid';
import { closePostpaidMonth, loadPostpaidClose } from './monthlyClose';
import { secureRandomBase36 } from '../boundary';
import { queryD1All, queryD1One, type D1DatabaseLike, type D1Row } from '../boundary/d1';
import { ConsoleBillingError } from './errors';
import { planBaseChargeForMonth } from './planBaseCharges';
import type {
  StripeBillingProviderAdapter,
  StripeBillingInvoice,
  StripeBillingInvoiceStatus,
} from './providers';
import { assertBillingProviderAvailable } from './providers';

const STRIPE_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

export const MONTHLY_COLLECTION_D1_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS billing_monthly_collections (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    month_utc TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    provider_invoice_ref TEXT,
    status TEXT NOT NULL CHECK (status IN
      ('creating', 'draft', 'open', 'paid', 'void', 'uncollectible')),
    created_at_ms INTEGER NOT NULL,
    checked_at_ms INTEGER NOT NULL,
    first_failed_at_ms INTEGER,
    hosted_invoice_url TEXT,
    PRIMARY KEY (namespace, org_id, month_utc),
    UNIQUE (namespace, idempotency_key),
    UNIQUE (namespace, provider_invoice_ref),
    FOREIGN KEY (namespace, org_id)
      REFERENCES organization_billing_accounts(namespace, org_id),
    CHECK ((status = 'creating' AND provider_invoice_ref IS NULL)
      OR (status <> 'creating' AND provider_invoice_ref IS NOT NULL
        AND length(provider_invoice_ref) > 0))
  )`,
  `CREATE INDEX IF NOT EXISTS billing_monthly_collections_due_idx
    ON billing_monthly_collections (namespace, status, checked_at_ms)`,
]);

interface CollectibleBillingCharge {
  readonly charge: {
    readonly priceVersion: string;
    readonly amountMinor: number;
    readonly periodStartMs: number;
    readonly periodEndMs: number;
  } & (
    | { readonly kind: 'plan_base'; readonly plan: 'growth' | 'pro' }
    | { readonly kind: 'monthly_usage'; readonly plan?: never }
  );
  readonly paymentModel: 'prepaid' | 'postpaid';
  readonly customerRef: string;
  readonly chargeKey: string;
}

type MonthlyCollection =
  | {
      readonly kind: 'creating';
      readonly idempotencyKey: string;
      readonly createdAtMs: number;
      readonly invoiceId?: never;
      readonly status?: never;
    }
  | {
      readonly kind: 'invoiced';
      readonly idempotencyKey: string;
      readonly createdAtMs: number;
      readonly invoiceId: string;
      readonly status: StripeBillingInvoiceStatus;
    };

export interface MonthlyCollectionTask {
  readonly orgId: string;
  readonly monthUtc: string;
}

function requiredString(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text)
    throw new ConsoleBillingError('billing_collection_invalid', 500, `${field} is missing`);
  return text;
}

function requiredInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ConsoleBillingError('billing_collection_invalid', 500, `${field} is invalid`);
  }
  return parsed;
}

function parseInvoiceStatus(value: unknown): StripeBillingInvoiceStatus {
  switch (value) {
    case 'draft':
      return 'draft';
    case 'open':
      return 'open';
    case 'paid':
      return 'paid';
    case 'void':
      return 'void';
    case 'uncollectible':
      return 'uncollectible';
    default:
      throw new ConsoleBillingError('billing_collection_invalid', 500, 'Invoice status is invalid');
  }
}

function parseCollection(row: D1Row): MonthlyCollection {
  const idempotencyKey = requiredString(row.idempotency_key, 'collection key');
  const createdAtMs = requiredInteger(row.created_at_ms, 'collection creation time');
  if (row.status === 'creating' && row.provider_invoice_ref === null) {
    return { kind: 'creating', idempotencyKey, createdAtMs };
  }
  return {
    kind: 'invoiced',
    idempotencyKey,
    createdAtMs,
    invoiceId: requiredString(row.provider_invoice_ref, 'Stripe invoice id'),
    status: parseInvoiceStatus(row.status),
  };
}

function parseCollectionTask(row: D1Row): MonthlyCollectionTask {
  return {
    orgId: requiredString(row.org_id, 'due organization id'),
    monthUtc: requiredString(row.month_utc, 'due month'),
  };
}

async function loadCollection(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
}): Promise<MonthlyCollection> {
  const row = await queryD1One(
    input.database,
    `SELECT idempotency_key, provider_invoice_ref, status, created_at_ms
       FROM billing_monthly_collections
      WHERE namespace = ? AND org_id = ? AND month_utc = ?`,
    [input.namespace, input.orgId, input.monthUtc],
  );
  if (!row)
    throw new ConsoleBillingError('billing_collection_missing', 500, 'Collection row is missing');
  return parseCollection(row);
}

async function loadCollectibleCharge(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly nowMs: number;
  readonly stripe: StripeBillingProviderAdapter;
}): Promise<CollectibleBillingCharge | null> {
  const policy = await readBillingPaymentPolicy(input.database, input.namespace, input.orgId);
  if (policy.kind === 'postpaid') {
    const existingClose = await loadPostpaidClose(input);
    await reconcileInvoiceCredits(input, existingClose ? 'reconcile' : 'before_close');
    await closePostpaidMonth(input);
    const close = await loadPostpaidClose(input);
    if (!close || close.kind !== 'collectible') return null;
    const customer = await queryD1One(
      input.database,
      'SELECT customer_ref FROM billing_payment_customers WHERE namespace=? AND org_id=?',
      [input.namespace, input.orgId],
    );
    const periodStartMs = Date.parse(`${input.monthUtc}-01T00:00:00.000Z`);
    const end = new Date(periodStartMs);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return {
      paymentModel: 'postpaid',
      charge: {
        kind: 'monthly_usage',
        priceVersion: 'platform-monthly-v1',
        amountMinor: close.amountMinor,
        periodStartMs,
        periodEndMs: end.getTime(),
      },
      customerRef: requiredString(customer?.customer_ref, 'Stripe customer id'),
      chargeKey: `${input.namespace}:${input.orgId}:${input.monthUtc}`,
    };
  }
  const row = await queryD1One(
    input.database,
    `SELECT charge.plan, charge.price_version, charge.period_start_ms,
            charge.period_end_ms, charge.amount_minor, plan.plan_started_at_ms,
            customer.customer_ref
       FROM billing_plan_base_charges AS charge
       JOIN billing_account_plans AS plan
         ON plan.namespace = charge.namespace AND plan.org_id = charge.org_id
       LEFT JOIN billing_payment_customers AS customer
         ON customer.namespace = charge.namespace AND customer.org_id = charge.org_id
      WHERE charge.namespace = ? AND charge.org_id = ? AND charge.month_utc = ?`,
    [input.namespace, input.orgId, input.monthUtc],
  );
  if (!row) return null;
  const plan = row.plan;
  if (plan !== 'growth' && plan !== 'pro') {
    throw new ConsoleBillingError('billing_collection_invalid', 500, 'Base charge plan is invalid');
  }
  const charge = planBaseChargeForMonth({
    orgId: input.orgId,
    plan,
    priceVersion: requiredString(row.price_version, 'plan price version'),
    startedAtMs: requiredInteger(row.period_start_ms, 'charge period start'),
    monthUtc: input.monthUtc,
  });
  if (
    !charge ||
    charge.periodStartMs !== Number(row.period_start_ms) ||
    charge.periodEndMs !== Number(row.period_end_ms) ||
    charge.amountMinor !== Number(row.amount_minor)
  ) {
    throw new ConsoleBillingError(
      'billing_collection_conflict',
      500,
      'Base charge differs from its pinned plan price',
    );
  }
  return {
    paymentModel: 'prepaid',
    charge: {
      kind: 'plan_base',
      plan: charge.plan,
      priceVersion: charge.priceVersion,
      amountMinor: charge.amountMinor,
      periodStartMs: charge.periodStartMs,
      periodEndMs: charge.periodEndMs,
    },
    customerRef: requiredString(row.customer_ref, 'Stripe customer id'),
    chargeKey: `${input.namespace}:${input.orgId}:${input.monthUtc}`,
  };
}

function assertInvoiceMatchesCharge(
  invoice: StripeBillingInvoice,
  collectible: CollectibleBillingCharge,
): void {
  if (
    invoice.customerRef !== collectible.customerRef ||
    invoice.chargeKey !== collectible.chargeKey ||
    invoice.currency !== 'USD' ||
    invoice.collectionMethod !== 'charge_automatically' ||
    invoice.lineItems.length > 1
  ) {
    throw new ConsoleBillingError(
      'billing_collection_conflict',
      500,
      'Stripe invoice belongs to another charge or contains extra lines',
    );
  }
  const lineItem = invoice.lineItems[0];
  if (lineItem) {
    if (
      lineItem.chargeKey !== collectible.chargeKey ||
      lineItem.amountMinor !== collectible.charge.amountMinor ||
      invoice.subtotalMinor !== collectible.charge.amountMinor ||
      invoice.totalMinor !== collectible.charge.amountMinor
    ) {
      throw new ConsoleBillingError(
        'billing_collection_conflict',
        500,
        'Stripe invoice total differs from the recorded base charge',
      );
    }
  } else if (invoice.subtotalMinor !== 0 || invoice.totalMinor !== 0) {
    throw new ConsoleBillingError(
      'billing_collection_conflict',
      500,
      'Empty Stripe invoice has a nonzero total',
    );
  }
}

async function rememberInvoice(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly invoiceId: string;
  readonly nowMs: number;
}): Promise<void> {
  await input.database
    .prepare(
      `UPDATE billing_monthly_collections
          SET provider_invoice_ref = ?, status = 'draft', checked_at_ms = ?
        WHERE namespace = ? AND org_id = ? AND month_utc = ?
          AND provider_invoice_ref IS NULL AND status = 'creating'`,
    )
    .bind(input.invoiceId, input.nowMs, input.namespace, input.orgId, input.monthUtc)
    .run();
  const stored = await loadCollection(input);
  if (stored.kind !== 'invoiced' || stored.invoiceId !== input.invoiceId) {
    throw new ConsoleBillingError(
      'billing_collection_conflict',
      500,
      'A different Stripe invoice is linked to this base charge',
    );
  }
}

async function rememberStatus(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly invoice: StripeBillingInvoice;
  readonly nowMs: number;
}): Promise<void> {
  await input.database
    .prepare(
      `UPDATE billing_monthly_collections
          SET status = CASE WHEN status = 'paid' THEN 'paid' ELSE ? END,
              first_failed_at_ms = CASE WHEN status='paid' THEN first_failed_at_ms WHEN ? THEN COALESCE(first_failed_at_ms, ?) ELSE first_failed_at_ms END,
              hosted_invoice_url = ?, checked_at_ms = ?
        WHERE namespace = ? AND org_id = ? AND month_utc = ? AND provider_invoice_ref = ?`,
    )
    .bind(
      input.invoice.status,
      input.invoice.status !== 'paid' && input.invoice.paymentFailed ? 1 : 0,
      input.nowMs,
      input.invoice.hostedInvoiceUrl,
      input.nowMs,
      input.namespace,
      input.orgId,
      input.monthUtc,
      input.invoice.id,
    )
    .run();
  await input.database
    .prepare(
      'UPDATE billing_account_plans SET evaluation_due_at_ms=0 WHERE namespace=? AND org_id=?',
    )
    .bind(input.namespace, input.orgId)
    .run();
}

async function touchCollection(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly nowMs: number;
}): Promise<void> {
  await input.database
    .prepare(
      `UPDATE billing_monthly_collections SET checked_at_ms = ?
        WHERE namespace = ? AND org_id = ? AND month_utc = ?`,
    )
    .bind(input.nowMs, input.namespace, input.orgId, input.monthUtc)
    .run();
}

async function reconcileStaleCreatingCollection(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly nowMs: number;
  readonly stripe: StripeBillingProviderAdapter;
  readonly collectible: CollectibleBillingCharge;
  readonly collection: Extract<MonthlyCollection, { readonly kind: 'creating' }>;
}): Promise<MonthlyCollection> {
  const matches = await input.stripe.findBillingInvoices({
    customerRef: input.collectible.customerRef,
    chargeKey: input.collectible.chargeKey,
  });
  if (matches.length > 1) {
    throw new ConsoleBillingError(
      'billing_collection_conflict',
      409,
      'Stripe has multiple invoices for this base charge',
    );
  }
  const found = matches[0];
  if (found) {
    assertInvoiceMatchesCharge(found, input.collectible);
    await rememberInvoice({
      database: input.database,
      namespace: input.namespace,
      orgId: input.orgId,
      monthUtc: input.monthUtc,
      invoiceId: found.id,
      nowMs: input.nowMs,
    });
    return await loadCollection(input);
  }

  const nextKey = secureRandomBase36(24, 'plan invoice idempotency key');
  await input.database
    .prepare(
      `UPDATE billing_monthly_collections
          SET idempotency_key = ?, created_at_ms = ?, checked_at_ms = ?
        WHERE namespace = ? AND org_id = ? AND month_utc = ?
          AND status = 'creating' AND provider_invoice_ref IS NULL
          AND idempotency_key = ? AND created_at_ms = ?`,
    )
    .bind(
      nextKey,
      input.nowMs,
      input.nowMs,
      input.namespace,
      input.orgId,
      input.monthUtc,
      input.collection.idempotencyKey,
      input.collection.createdAtMs,
    )
    .run();
  return await loadCollection(input);
}

export async function collectMonthlyInvoice(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly nowMs: number;
  readonly stripe: StripeBillingProviderAdapter;
}): Promise<StripeBillingInvoiceStatus | null> {
  const collectible = await loadCollectibleCharge(input);
  if (!collectible) return null;
  if (collectible.charge.periodEndMs > input.nowMs) {
    throw new ConsoleBillingError(
      'billing_collection_early',
      409,
      'Base charge period is still open',
    );
  }
  assertBillingProviderAvailable({ stripe: input.stripe });
  await input.database
    .prepare(
      `INSERT INTO billing_monthly_collections
        (namespace, org_id, month_utc, idempotency_key, provider_invoice_ref,
         status, created_at_ms, checked_at_ms)
       VALUES (?, ?, ?, ?, NULL, 'creating', ?, ?)
       ON CONFLICT(namespace, org_id, month_utc) DO NOTHING`,
    )
    .bind(
      input.namespace,
      input.orgId,
      input.monthUtc,
      secureRandomBase36(24, 'plan invoice idempotency key'),
      input.nowMs,
      input.nowMs,
    )
    .run();
  try {
    let collection = await loadCollection(input);
    let invoice: StripeBillingInvoice;
    if (collection.kind === 'creating') {
      if (input.nowMs - collection.createdAtMs >= STRIPE_IDEMPOTENCY_WINDOW_MS) {
        collection = await reconcileStaleCreatingCollection({
          ...input,
          collectible,
          collection,
        });
      }
    }
    if (collection.kind === 'creating') {
      if (input.nowMs - collection.createdAtMs >= STRIPE_IDEMPOTENCY_WINDOW_MS) {
        throw new ConsoleBillingError(
          'billing_collection_reconcile_incomplete',
          503,
          'Stripe invoice reconciliation did not advance the collection',
        );
      }
      invoice = await input.stripe.createBillingInvoice(
        invoiceCreateInput(collectible, input.orgId, input.monthUtc, collection.idempotencyKey),
      );
      assertInvoiceMatchesCharge(invoice, collectible);
      await rememberInvoice({
        database: input.database,
        namespace: input.namespace,
        orgId: input.orgId,
        monthUtc: input.monthUtc,
        invoiceId: invoice.id,
        nowMs: input.nowMs,
      });
    } else {
      invoice = await input.stripe.getBillingInvoice(collection.invoiceId);
    }
    assertInvoiceMatchesCharge(invoice, collectible);
    if (invoice.status === 'draft' && invoice.lineItems.length === 0) {
      await input.stripe.addBillingInvoiceItem({
        invoiceId: invoice.id,
        customerRef: collectible.customerRef,
        chargeKey: collectible.chargeKey,
        description:
          collectible.charge.kind === 'monthly_usage'
            ? 'Seams monthly plan and usage invoice'
            : `Seams ${collectible.charge.plan} plan base fee`,
        amountMinor: collectible.charge.amountMinor,
        periodStartMs: collectible.charge.periodStartMs,
        periodEndMs: collectible.charge.periodEndMs,
        idempotencyKey: collection.idempotencyKey,
      });
      invoice = await input.stripe.getBillingInvoice(invoice.id);
      assertInvoiceMatchesCharge(invoice, collectible);
    }
    if (invoice.lineItems.length !== 1) {
      throw new ConsoleBillingError(
        'billing_collection_conflict',
        500,
        'Stripe invoice has no base-fee line',
      );
    }
    if (invoice.status === 'draft') {
      invoice = await input.stripe.finalizeBillingInvoice(invoice.id);
      assertInvoiceMatchesCharge(invoice, collectible);
      invoice = await input.stripe.getBillingInvoice(invoice.id);
      assertInvoiceMatchesCharge(invoice, collectible);
    }
    if (invoice.status === 'open' && !invoice.autoAdvance) {
      throw new ConsoleBillingError(
        'billing_collection_conflict',
        500,
        'Stripe invoice is open without automatic collection',
      );
    }
    if (invoice.status === 'draft') {
      throw new ConsoleBillingError(
        'billing_collection_incomplete',
        503,
        'Stripe invoice remained in draft after finalization',
      );
    }
    if (collectible.paymentModel === 'postpaid' && invoice.status === 'paid') {
      if (
        invoice.confirmedPaymentMinor !== collectible.charge.amountMinor ||
        invoice.amountPaidMinor !== collectible.charge.amountMinor ||
        invoice.amountRemainingMinor !== 0 ||
        invoice.paidOutOfBand
      ) {
        throw new ConsoleBillingError(
          'invoice_payment_unverified',
          409,
          'Stripe has not confirmed the full invoice payment',
        );
      }
      const paymentStatements = [];
      for (const payment of invoice.confirmedPayments) {
        if (!payment.paymentRef || payment.amountMinor <= 0)
          throw new Error('Stripe payment evidence is invalid');
        paymentStatements.push(
          input.database
            .prepare(
              `INSERT INTO billing_invoice_payments(namespace,org_id,invoice_ref,payment_ref,amount_minor)
          VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING`,
            )
            .bind(
              input.namespace,
              input.orgId,
              invoice.id,
              payment.paymentRef,
              payment.amountMinor,
            ),
        );
      }
      if (paymentStatements.length === 0) throw new Error('Stripe payment evidence is missing');
      await input.database.batch(paymentStatements);
      await input.database
        .prepare(
          `INSERT INTO billing_ledger_entries
        (namespace,org_id,id,entry_type,amount_minor,currency,description,month_utc,related_invoice_id,source_event_id,actor_type,reason_code,created_at_ms,payment_model,ingested_at_ms)
        VALUES(?,?,?,'INVOICE_PAYMENT',?,'USD','Stripe monthly invoice payment',?,?,?,'PROVIDER','invoice_payment',?,'postpaid',?)
        ON CONFLICT DO NOTHING`,
        )
        .bind(
          input.namespace,
          input.orgId,
          `invoice-payment:${invoice.id}`,
          collectible.charge.amountMinor,
          input.monthUtc,
          `monthly:${input.orgId}:${input.monthUtc}`,
          invoice.id,
          input.nowMs,
          input.nowMs,
        )
        .run();
    }
    await rememberStatus({
      database: input.database,
      namespace: input.namespace,
      orgId: input.orgId,
      monthUtc: input.monthUtc,
      invoice,
      nowMs: input.nowMs,
    });
    if (collectible.paymentModel === 'postpaid' && invoice.status === 'paid')
      await reconcileInvoiceCredits(input, 'reconcile');
    return invoice.status;
  } catch (error: unknown) {
    await touchCollection(input);
    throw error;
  }
}

export async function listDueMonthlyCollectionTasks(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly nowMs: number;
  readonly previousMonthUtc: string;
  readonly previousMonthEndMs: number;
  readonly limit: number;
}): Promise<MonthlyCollectionTask[]> {
  const rows = await queryD1All(
    input.database,
    `SELECT org_id, month_utc FROM (
       SELECT charge.org_id, charge.month_utc,
              COALESCE(collection.checked_at_ms, 0) AS checked_at_ms
         FROM billing_plan_base_charges AS charge
         LEFT JOIN billing_monthly_collections AS collection
           ON collection.namespace = charge.namespace
          AND collection.org_id = charge.org_id
          AND collection.month_utc = charge.month_utc
        WHERE charge.namespace = ? AND charge.period_end_ms <= ?
          AND (collection.status IS NULL OR collection.status <> 'paid')
       UNION ALL
       SELECT p.org_id, ?, 0 FROM billing_payment_policies p WHERE p.namespace=? AND p.payment_model='postpaid'
         AND NOT EXISTS(SELECT 1 FROM billing_monthly_closes c WHERE c.namespace=p.namespace AND c.org_id=p.org_id AND c.month_utc=?)
       UNION ALL
       SELECT c.org_id,c.month_utc,c.checked_at_ms FROM billing_monthly_collections c
         JOIN billing_payment_policies p USING(namespace,org_id)
         WHERE c.namespace=? AND p.payment_model='postpaid' AND c.status<>'paid'
       UNION ALL
       SELECT DISTINCT c.org_id,c.month_utc,c.checked_at_ms FROM billing_invoice_credits n
         JOIN billing_monthly_collections c ON c.namespace=n.namespace AND c.org_id=n.org_id AND c.provider_invoice_ref=n.invoice_ref
         WHERE n.namespace=?1 AND n.provider_credit_note_ref IS NULL
       UNION ALL
       SELECT DISTINCT l.org_id,l.month_utc,0 FROM billing_ledger_entries l
         WHERE l.namespace=?1 AND l.payment_model='postpaid' AND l.month_utc<strftime('%Y-%m',?2/1000,'unixepoch')
           AND l.entry_type IN ('PLAN_BASE_CHARGE','PLAN_USAGE_CHARGE','PRODUCT_EXECUTION_DEBIT')
           AND NOT EXISTS(SELECT 1 FROM billing_monthly_closes c WHERE c.namespace=l.namespace AND c.org_id=l.org_id AND c.month_utc=l.month_utc)
       UNION ALL
       SELECT plan.org_id, ?, 0
         FROM billing_account_plans AS plan
         LEFT JOIN billing_plan_base_charges AS charge
           ON charge.namespace = plan.namespace AND charge.org_id = plan.org_id
          AND charge.month_utc = ?
        WHERE plan.namespace = ? AND plan.plan IN ('growth', 'pro')
          AND plan.plan_started_at_ms < ? AND charge.org_id IS NULL
     ) AS due
     ORDER BY checked_at_ms, month_utc, org_id
     LIMIT ?`,
    [
      input.namespace,
      input.nowMs,
      input.previousMonthUtc,
      input.namespace,
      input.previousMonthUtc,
      input.namespace,
      input.previousMonthUtc,
      input.previousMonthUtc,
      input.namespace,
      input.previousMonthEndMs,
      input.limit,
    ],
  );
  return rows.map(parseCollectionTask);
}

function invoiceCreateInput(
  collectible: CollectibleBillingCharge,
  orgId: string,
  monthUtc: string,
  idempotencyKey: string,
): import('./providers').StripeBillingInvoiceCreateInput {
  if (collectible.charge.kind === 'monthly_usage')
    return {
      kind: 'monthly_usage',
      customerRef: collectible.customerRef,
      chargeKey: collectible.chargeKey,
      orgId,
      monthUtc,
      idempotencyKey,
      priceVersion: 'platform-monthly-v1',
    };
  return {
    kind: 'plan_base',
    customerRef: collectible.customerRef,
    chargeKey: collectible.chargeKey,
    orgId,
    monthUtc,
    idempotencyKey,
    plan: collectible.charge.plan,
    priceVersion: collectible.charge.priceVersion,
  };
}
