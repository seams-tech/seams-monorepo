import { queryD1All, type D1DatabaseLike } from '../boundary/d1';
import { textValue, integer } from '@seams-internal/console-shared/accountPlatform/boundary';
import { secureRandomBase36 } from '../boundary';
import type { StripeBillingProviderAdapter } from './providers';
import { ConsoleBillingError } from './errors';

interface InvoiceCreditsInput {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly nowMs: number;
  readonly stripe: StripeBillingProviderAdapter;
}

/** Match prior-period ledger credits to paid invoices. Stripe records the credit held by Platform. */
export async function reconcileInvoiceCredits(
  input: InvoiceCreditsInput,
  phase: 'before_close' | 'reconcile',
): Promise<void> {
  const candidates = await queryD1All(
    input.database,
    `SELECT DISTINCT l.id,c.provider_invoice_ref
  FROM billing_ledger_entries l JOIN billing_monthly_invoice_items i ON i.namespace=l.namespace AND i.org_id=l.org_id AND i.usage_month_utc=l.month_utc
  JOIN billing_ledger_entries original ON original.namespace=i.namespace AND original.org_id=i.org_id AND original.id=i.ledger_entry_id
  JOIN billing_monthly_collections c ON c.namespace=i.namespace AND c.org_id=i.org_id AND c.month_utc=i.month_utc
  WHERE l.namespace=? AND l.org_id=? AND l.payment_model='postpaid' AND l.entry_type='PLAN_USAGE_CHARGE' AND l.amount_minor>0
   AND original.entry_type='PLAN_USAGE_CHARGE' AND i.amount_minor>0 AND c.status='paid'
   AND NOT EXISTS(SELECT 1 FROM billing_monthly_invoice_items assigned WHERE assigned.namespace=l.namespace AND assigned.org_id=l.org_id AND assigned.ledger_entry_id=l.id)
  ORDER BY l.id,c.provider_invoice_ref`,
    [input.namespace, input.orgId],
  );
  for (const candidate of candidates) {
    const entryId = textValue(candidate.id, 'usage credit entry');
    const invoiceId = textValue(candidate.provider_invoice_ref, 'credited invoice');
    await input.database
      .prepare(
        `WITH source AS (
    SELECT l.* FROM billing_ledger_entries l WHERE l.namespace=?1 AND l.org_id=?2 AND l.id=?3
   ), allocation AS (
    SELECT MIN(
      s.amount_minor-COALESCE((SELECT SUM(n.amount_minor) FROM billing_invoice_credits n WHERE n.namespace=s.namespace AND n.org_id=s.org_id AND n.credit_entry_id=s.id),0),
      MAX(0,
       COALESCE((SELECT SUM(i.amount_minor) FROM billing_monthly_invoice_items i JOIN billing_ledger_entries l ON l.namespace=i.namespace AND l.org_id=i.org_id AND l.id=i.ledger_entry_id
         WHERE l.namespace=s.namespace AND l.org_id=s.org_id AND l.month_utc=s.month_utc AND l.entry_type='PLAN_USAGE_CHARGE'),0)
       -COALESCE((SELECT charged_minor FROM billing_plan_paid_usage u WHERE u.namespace=s.namespace AND u.org_id=s.org_id AND u.month_utc=s.month_utc),0)
       -COALESCE((SELECT SUM(n.amount_minor) FROM billing_invoice_credits n JOIN billing_ledger_entries l ON l.namespace=n.namespace AND l.org_id=n.org_id AND l.id=n.credit_entry_id
         WHERE l.namespace=s.namespace AND l.org_id=s.org_id AND l.month_utc=s.month_utc AND NOT EXISTS(SELECT 1 FROM billing_monthly_invoice_items i WHERE i.namespace=l.namespace AND i.org_id=l.org_id AND i.ledger_entry_id=l.id)),0)),
      MAX(0,(SELECT c.amount_minor FROM billing_monthly_closes c JOIN billing_monthly_collections p USING(namespace,org_id,month_utc) WHERE p.namespace=?1 AND p.org_id=?2 AND p.provider_invoice_ref=?4)
       -COALESCE((SELECT SUM(amount_minor) FROM billing_invoice_credits WHERE namespace=?1 AND org_id=?2 AND invoice_ref=?4),0))
     ) AS amount FROM source s
   )
   INSERT INTO billing_invoice_credits(namespace,org_id,credit_entry_id,invoice_ref,amount_minor,idempotency_key,created_at_ms)
   SELECT ?1,?2,?3,?4,amount,?5,?6 FROM allocation WHERE amount>0
   ON CONFLICT(namespace,org_id,credit_entry_id,invoice_ref) DO NOTHING`,
      )
      .bind(
        input.namespace,
        input.orgId,
        entryId,
        invoiceId,
        secureRandomBase36(24, 'invoice credit idempotency'),
        input.nowMs,
      )
      .run();
  }
  const pending = await queryD1All(
    input.database,
    `SELECT n.*,c.customer_ref FROM billing_invoice_credits n JOIN billing_payment_customers c USING(namespace,org_id)
  WHERE n.namespace=? AND n.org_id=? AND n.provider_credit_note_ref IS NULL ORDER BY n.created_at_ms,n.credit_entry_id`,
    [input.namespace, input.orgId],
  );
  for (const row of pending) {
    const entryId = textValue(row.credit_entry_id, 'credit entry');
    const invoiceId = textValue(row.invoice_ref, 'invoice');
    const customerRef = textValue(row.customer_ref, 'customer');
    const amountMinor = integer(row.amount_minor, 'credit amount', 1);
    const creditKey = `${input.namespace}:${input.orgId}:${entryId}:${invoiceId}`;
    const note = await input.stripe.reconcileInvoiceCredit({
      invoiceId,
      customerRef,
      creditKey,
      amountMinor,
      idempotencyKey: textValue(row.idempotency_key, 'credit idempotency key'),
    });
    if (
      note.status !== 'issued' ||
      note.invoiceId !== invoiceId ||
      note.customerRef !== customerRef ||
      note.creditKey !== creditKey ||
      note.amountMinor !== amountMinor
    )
      throw new ConsoleBillingError(
        'invoice_credit_conflict',
        409,
        'Stripe credit note differs from the ledger adjustment',
      );
    await input.database
      .prepare(
        `UPDATE billing_invoice_credits SET provider_credit_note_ref=? WHERE namespace=? AND org_id=? AND credit_entry_id=? AND invoice_ref=? AND (provider_credit_note_ref IS NULL OR provider_credit_note_ref=?)`,
      )
      .bind(note.id, input.namespace, input.orgId, entryId, invoiceId, note.id)
      .run();
  }
  if (phase === 'before_close') {
    const waiting = await queryD1All(
      input.database,
      `SELECT DISTINCT l.month_utc FROM billing_ledger_entries l
   JOIN billing_monthly_invoice_items i ON i.namespace=l.namespace AND i.org_id=l.org_id AND i.usage_month_utc=l.month_utc
   JOIN billing_ledger_entries original ON original.namespace=i.namespace AND original.org_id=i.org_id AND original.id=i.ledger_entry_id
   JOIN billing_monthly_collections c ON c.namespace=i.namespace AND c.org_id=i.org_id AND c.month_utc=i.month_utc
   WHERE l.namespace=? AND l.org_id=? AND l.entry_type='PLAN_USAGE_CHARGE' AND l.amount_minor>0 AND c.status<>'paid'
    AND original.entry_type='PLAN_USAGE_CHARGE' AND i.amount_minor>0
    AND NOT EXISTS(SELECT 1 FROM billing_monthly_invoice_items assigned WHERE assigned.namespace=l.namespace AND assigned.org_id=l.org_id AND assigned.ledger_entry_id=l.id)
    AND (SELECT COALESCE(SUM(i2.amount_minor),0) FROM billing_monthly_invoice_items i2 JOIN billing_ledger_entries billed ON billed.namespace=i2.namespace AND billed.org_id=i2.org_id AND billed.id=i2.ledger_entry_id WHERE billed.namespace=l.namespace AND billed.org_id=l.org_id AND billed.month_utc=l.month_utc AND billed.entry_type='PLAN_USAGE_CHARGE')
      > COALESCE((SELECT charged_minor FROM billing_plan_paid_usage u WHERE u.namespace=l.namespace AND u.org_id=l.org_id AND u.month_utc=l.month_utc),0)`,
      [input.namespace, input.orgId],
    );
    if (waiting.length > 0)
      throw new ConsoleBillingError(
        'invoice_credit_waiting_for_payment',
        409,
        'Prior invoice payment must reconcile before its usage credit closes',
      );
  }
}
