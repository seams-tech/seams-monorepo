import { queueInvoiceRecoveryNotice } from './recoveryNotice';
import { queryD1One } from '../boundary/d1';
import type { ConsoleBillingD1Runtime } from './d1';
import { collectMonthlyInvoice } from './monthlyCollection';

export type StripeInvoiceEvent = {
  readonly invoiceId: string;
  readonly customerRef: string;
  readonly chargeKey: string;
  readonly failureAtMs: number | null;
};

/** The signed event requests a lookup. Only the current Stripe invoice can confirm payment. */
export async function reconcileInvoiceEvent(
  runtime: ConsoleBillingD1Runtime,
  event: StripeInvoiceEvent,
): Promise<boolean> {
  const row = await queryD1One(
    runtime.database,
    `SELECT c.org_id,c.month_utc,c.provider_invoice_ref
    FROM billing_monthly_collections c JOIN billing_payment_customers p USING(namespace,org_id)
    WHERE c.namespace=? AND p.customer_ref=? AND (c.provider_invoice_ref=? OR
      (c.provider_invoice_ref IS NULL AND c.namespace||':'||c.org_id||':'||c.month_utc=?))`,
    [runtime.namespace, event.customerRef, event.invoiceId, event.chargeKey],
  );
  if (!row || typeof row.org_id !== 'string' || typeof row.month_utc !== 'string') return false;
  const status = await collectMonthlyInvoice({
    database: runtime.database,
    namespace: runtime.namespace,
    orgId: row.org_id,
    monthUtc: row.month_utc,
    nowMs: runtime.now().getTime(),
    stripe: runtime.providers.stripe,
  });
  if (status !== 'paid' && event.failureAtMs !== null) {
    await runtime.database
      .prepare(
        `UPDATE billing_monthly_collections SET first_failed_at_ms=MIN(COALESCE(first_failed_at_ms,?),?)
      WHERE namespace=? AND org_id=? AND month_utc=? AND provider_invoice_ref=? AND status<>'paid'`,
      )
      .bind(
        event.failureAtMs,
        event.failureAtMs,
        runtime.namespace,
        row.org_id,
        row.month_utc,
        event.invoiceId,
      )
      .run();
  }
  await queueInvoiceRecoveryNotice(runtime, row.org_id, row.month_utc);
  return true;
}
