import { secureRandomBase36 } from '../boundary';
import { queryD1All, queryD1One, type D1DatabaseLike, type D1Row } from '../boundary/d1';
import { ConsoleBillingError } from './errors';
import { planBaseChargeForMonth, type PlanBaseCharge } from './planBaseCharges';
import type {
  StripeBillingProviderAdapter,
  StripePlanBaseInvoice,
  StripePlanBaseInvoiceStatus,
} from './providers';
import { assertBillingProviderAvailable } from './providers';

const STRIPE_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

export const PLAN_BASE_COLLECTION_D1_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS billing_plan_base_collections (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    month_utc TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    provider_invoice_ref TEXT,
    status TEXT NOT NULL CHECK (status IN
      ('creating', 'draft', 'open', 'paid', 'void', 'uncollectible')),
    created_at_ms INTEGER NOT NULL,
    checked_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, org_id, month_utc),
    UNIQUE (namespace, idempotency_key),
    UNIQUE (namespace, provider_invoice_ref),
    FOREIGN KEY (namespace, org_id, month_utc)
      REFERENCES billing_plan_base_charges(namespace, org_id, month_utc),
    CHECK ((status = 'creating' AND provider_invoice_ref IS NULL)
      OR (status <> 'creating' AND provider_invoice_ref IS NOT NULL
        AND length(provider_invoice_ref) > 0))
  )`,
  `CREATE INDEX IF NOT EXISTS billing_plan_base_collections_due_idx
    ON billing_plan_base_collections (namespace, status, checked_at_ms)`,
]);

interface CollectiblePlanBaseCharge {
  readonly charge: PlanBaseCharge;
  readonly customerRef: string;
  readonly chargeKey: string;
}

type PlanBaseCollection =
  | {
      readonly kind: 'creating';
      readonly idempotencyKey: string;
      readonly createdAtMs: number;
      readonly invoiceId?: never;
    }
  | {
      readonly kind: 'invoiced';
      readonly idempotencyKey: string;
      readonly createdAtMs: number;
      readonly invoiceId: string;
      readonly status: StripePlanBaseInvoiceStatus;
    };

export interface PlanBaseCollectionTask {
  readonly orgId: string;
  readonly monthUtc: string;
}

function requiredString(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new ConsoleBillingError('plan_collection_invalid', 500, `${field} is missing`);
  return text;
}

function requiredInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ConsoleBillingError('plan_collection_invalid', 500, `${field} is invalid`);
  }
  return parsed;
}

function parseInvoiceStatus(value: unknown): StripePlanBaseInvoiceStatus {
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
      throw new ConsoleBillingError('plan_collection_invalid', 500, 'Invoice status is invalid');
  }
}

function parseCollection(row: D1Row): PlanBaseCollection {
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

function parseCollectionTask(row: D1Row): PlanBaseCollectionTask {
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
}): Promise<PlanBaseCollection> {
  const row = await queryD1One(
    input.database,
    `SELECT idempotency_key, provider_invoice_ref, status, created_at_ms
       FROM billing_plan_base_collections
      WHERE namespace = ? AND org_id = ? AND month_utc = ?`,
    [input.namespace, input.orgId, input.monthUtc],
  );
  if (!row)
    throw new ConsoleBillingError('plan_collection_missing', 500, 'Collection row is missing');
  return parseCollection(row);
}

async function loadCollectibleCharge(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
}): Promise<CollectiblePlanBaseCharge | null> {
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
    throw new ConsoleBillingError('plan_collection_invalid', 500, 'Base charge plan is invalid');
  }
  const charge = planBaseChargeForMonth({
    orgId: input.orgId,
    plan,
    priceVersion: requiredString(row.price_version, 'plan price version'),
    startedAtMs: requiredInteger(row.plan_started_at_ms, 'plan start time'),
    monthUtc: input.monthUtc,
  });
  if (
    !charge ||
    charge.periodStartMs !== Number(row.period_start_ms) ||
    charge.periodEndMs !== Number(row.period_end_ms) ||
    charge.amountMinor !== Number(row.amount_minor)
  ) {
    throw new ConsoleBillingError(
      'plan_collection_conflict',
      500,
      'Base charge differs from its pinned plan price',
    );
  }
  return {
    charge,
    customerRef: requiredString(row.customer_ref, 'Stripe customer id'),
    chargeKey: `${input.namespace}:${input.orgId}:${input.monthUtc}`,
  };
}

function assertInvoiceMatchesCharge(
  invoice: StripePlanBaseInvoice,
  collectible: CollectiblePlanBaseCharge,
): void {
  if (
    invoice.customerRef !== collectible.customerRef ||
    invoice.chargeKey !== collectible.chargeKey ||
    invoice.currency !== 'USD' ||
    invoice.collectionMethod !== 'charge_automatically' ||
    invoice.lineItems.length > 1
  ) {
    throw new ConsoleBillingError(
      'plan_collection_conflict',
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
        'plan_collection_conflict',
        500,
        'Stripe invoice total differs from the recorded base charge',
      );
    }
  } else if (invoice.subtotalMinor !== 0 || invoice.totalMinor !== 0) {
    throw new ConsoleBillingError(
      'plan_collection_conflict',
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
      `UPDATE billing_plan_base_collections
          SET provider_invoice_ref = ?, status = 'draft', checked_at_ms = ?
        WHERE namespace = ? AND org_id = ? AND month_utc = ?
          AND provider_invoice_ref IS NULL AND status = 'creating'`,
    )
    .bind(input.invoiceId, input.nowMs, input.namespace, input.orgId, input.monthUtc)
    .run();
  const stored = await loadCollection(input);
  if (stored.kind !== 'invoiced' || stored.invoiceId !== input.invoiceId) {
    throw new ConsoleBillingError(
      'plan_collection_conflict',
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
  readonly invoice: StripePlanBaseInvoice;
  readonly nowMs: number;
}): Promise<void> {
  await input.database
    .prepare(
      `UPDATE billing_plan_base_collections
          SET status = CASE WHEN status = 'paid' THEN 'paid' ELSE ? END,
              checked_at_ms = ?
        WHERE namespace = ? AND org_id = ? AND month_utc = ? AND provider_invoice_ref = ?`,
    )
    .bind(
      input.invoice.status,
      input.nowMs,
      input.namespace,
      input.orgId,
      input.monthUtc,
      input.invoice.id,
    )
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
      `UPDATE billing_plan_base_collections SET checked_at_ms = ?
        WHERE namespace = ? AND org_id = ? AND month_utc = ?`,
    )
    .bind(input.nowMs, input.namespace, input.orgId, input.monthUtc)
    .run();
}

export async function collectPlanBaseCharge(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly nowMs: number;
  readonly stripe: StripeBillingProviderAdapter;
}): Promise<StripePlanBaseInvoiceStatus | null> {
  const collectible = await loadCollectibleCharge(input);
  if (!collectible) return null;
  if (collectible.charge.periodEndMs > input.nowMs) {
    throw new ConsoleBillingError('plan_collection_early', 409, 'Base charge period is still open');
  }
  assertBillingProviderAvailable({ stripe: input.stripe });
  await input.database
    .prepare(
      `INSERT INTO billing_plan_base_collections
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
    const collection = await loadCollection(input);
    let invoice: StripePlanBaseInvoice;
    if (collection.kind === 'creating') {
      if (input.nowMs - collection.createdAtMs >= STRIPE_IDEMPOTENCY_WINDOW_MS) {
        throw new ConsoleBillingError(
          'plan_collection_reconcile_required',
          409,
          'Stripe invoice creation needs manual reconciliation before another attempt',
        );
      }
      invoice = await input.stripe.createPlanBaseInvoice({
        customerRef: collectible.customerRef,
        chargeKey: collectible.chargeKey,
        orgId: input.orgId,
        monthUtc: input.monthUtc,
        plan: collectible.charge.plan,
        priceVersion: collectible.charge.priceVersion,
        idempotencyKey: collection.idempotencyKey,
      });
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
      invoice = await input.stripe.getPlanBaseInvoice(collection.invoiceId);
    }
    assertInvoiceMatchesCharge(invoice, collectible);
    if (invoice.status === 'draft' && invoice.lineItems.length === 0) {
      await input.stripe.addPlanBaseInvoiceItem({
        invoiceId: invoice.id,
        customerRef: collectible.customerRef,
        chargeKey: collectible.chargeKey,
        plan: collectible.charge.plan,
        amountMinor: collectible.charge.amountMinor,
        periodStartMs: collectible.charge.periodStartMs,
        periodEndMs: collectible.charge.periodEndMs,
        idempotencyKey: collection.idempotencyKey,
      });
      invoice = await input.stripe.getPlanBaseInvoice(invoice.id);
      assertInvoiceMatchesCharge(invoice, collectible);
    }
    if (invoice.lineItems.length !== 1) {
      throw new ConsoleBillingError(
        'plan_collection_conflict',
        500,
        'Stripe invoice has no base-fee line',
      );
    }
    if (invoice.status === 'draft') {
      invoice = await input.stripe.finalizePlanBaseInvoice(invoice.id);
      assertInvoiceMatchesCharge(invoice, collectible);
    }
    if (invoice.status === 'open' && !invoice.autoAdvance) {
      throw new ConsoleBillingError(
        'plan_collection_conflict',
        500,
        'Stripe invoice is open without automatic collection',
      );
    }
    if (invoice.status === 'draft') {
      throw new ConsoleBillingError(
        'plan_collection_incomplete',
        503,
        'Stripe invoice remained in draft after finalization',
      );
    }
    await rememberStatus({
      database: input.database,
      namespace: input.namespace,
      orgId: input.orgId,
      monthUtc: input.monthUtc,
      invoice,
      nowMs: input.nowMs,
    });
    return invoice.status;
  } catch (error: unknown) {
    await touchCollection(input);
    throw error;
  }
}

export async function listDuePlanBaseCollectionTasks(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly nowMs: number;
  readonly previousMonthUtc: string;
  readonly previousMonthEndMs: number;
  readonly limit: number;
}): Promise<PlanBaseCollectionTask[]> {
  const rows = await queryD1All(
    input.database,
    `SELECT org_id, month_utc FROM (
       SELECT charge.org_id, charge.month_utc,
              COALESCE(collection.checked_at_ms, 0) AS checked_at_ms
         FROM billing_plan_base_charges AS charge
         LEFT JOIN billing_plan_base_collections AS collection
           ON collection.namespace = charge.namespace
          AND collection.org_id = charge.org_id
          AND collection.month_utc = charge.month_utc
        WHERE charge.namespace = ? AND charge.period_end_ms <= ?
          AND (collection.status IS NULL OR collection.status IN ('creating', 'draft', 'open'))
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
      input.previousMonthUtc,
      input.namespace,
      input.previousMonthEndMs,
      input.limit,
    ],
  );
  return rows.map(parseCollectionTask);
}
