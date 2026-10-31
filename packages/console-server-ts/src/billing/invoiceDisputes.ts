import type { ConsoleBillingD1Runtime } from './d1';
import { queryD1One } from '../boundary/d1';
import type { StripeWebhookEventRequest } from './types';
import { ConsoleBillingError } from './errors';

type InvoiceDisputeEvent = Extract<
  StripeWebhookEventRequest,
  { eventType: 'charge.dispute.created' | 'charge.dispute.closed' }
>;
/** Verified Stripe events can restrict a paid invoice. A late open event cannot reverse a win. */
export async function reconcilePostpaidDispute(
  runtime: ConsoleBillingD1Runtime,
  event: InvoiceDisputeEvent,
): Promise<boolean> {
  const payment = await queryD1One(
    runtime.database,
    `SELECT org_id,SUM(amount_minor) AS amount_minor FROM billing_invoice_payments WHERE namespace=? AND payment_ref=? GROUP BY org_id`,
    [runtime.namespace, event.providerPaymentRef],
  );
  if (!payment) return false;
  if (
    typeof payment.org_id !== 'string' ||
    event.amountMinor > Number(payment.amount_minor) ||
    (event.orgId !== null && event.orgId !== payment.org_id)
  )
    throw new ConsoleBillingError(
      'invoice_dispute_conflict',
      409,
      'Stripe dispute does not match the invoice payment',
    );
  const status = event.eventType === 'charge.dispute.created' ? 'open' : event.outcome;
  await runtime.database
    .prepare(
      `INSERT INTO billing_invoice_disputes(namespace,org_id,dispute_ref,payment_ref,amount_minor,status,created_at_ms)
   VALUES(?,?,?,?,?,?,?) ON CONFLICT(namespace,dispute_ref) DO UPDATE SET status=CASE WHEN billing_invoice_disputes.status='open' THEN excluded.status ELSE billing_invoice_disputes.status END`,
    )
    .bind(
      runtime.namespace,
      payment.org_id,
      event.providerDisputeId,
      event.providerPaymentRef,
      event.amountMinor,
      status,
      runtime.now().getTime(),
    )
    .run();
  return true;
}
