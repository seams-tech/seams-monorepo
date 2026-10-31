import { queryD1One, type D1DatabaseLike } from '../boundary/d1';
import type { StripeBillingProviderAdapter } from './providers';
import { ConsoleBillingError } from './errors';

/** Card setup and credit purchases use the same persisted payer. */
export async function ensureBillingCustomer(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly stripe: StripeBillingProviderAdapter;
  readonly nowMs: number;
}): Promise<string> {
  const account = await queryD1One(
    input.database,
    `SELECT a.id, c.customer_ref
    FROM organization_billing_accounts a LEFT JOIN billing_payment_customers c USING(namespace,org_id)
    WHERE a.namespace=? AND a.org_id=?`,
    [input.namespace, input.orgId],
  );
  if (!account || typeof account.id !== 'string')
    throw new ConsoleBillingError(
      'billing_account_missing',
      409,
      'The organization has no billing account',
    );
  if (typeof account.customer_ref === 'string') return account.customer_ref;
  const customerRef = await input.stripe.createCustomer({
    orgId: input.orgId,
    billingAccountId: account.id,
  });
  await input.database
    .prepare(
      `INSERT INTO billing_payment_customers(namespace,org_id,billing_account_id,provider,customer_ref,created_at_ms)
    VALUES(?,?,?,'stripe',?,?) ON CONFLICT(namespace,org_id) DO NOTHING`,
    )
    .bind(input.namespace, input.orgId, account.id, customerRef, input.nowMs)
    .run();
  const stored = await queryD1One(
    input.database,
    'SELECT customer_ref FROM billing_payment_customers WHERE namespace=? AND org_id=?',
    [input.namespace, input.orgId],
  );
  if (typeof stored?.customer_ref !== 'string')
    throw new Error('Stripe customer mapping is missing');
  return stored.customer_ref;
}
