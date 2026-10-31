import { expect, test } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'dotenv';
import { createStripeBillingProviderAdapter } from '../../../packages/console-server-ts/src/billing/stripeProvider';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
async function stripeRequest(
  key: string,
  endpoint: string,
  fields: Record<string, string>,
  operation: string,
) {
  const response = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': operation,
    },
    body: new URLSearchParams(fields),
  });
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') throw new Error('Invalid Stripe response');
  return { status: response.status, body };
}
function responseId(value: object): string {
  if (!('id' in value) || typeof value.id !== 'string')
    throw new Error('Stripe response has no id');
  return value.id;
}
function redacted(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
async function runStripeAcceptance() {
  test.skip(
    process.env.SEAMS_STRIPE_ACCEPTANCE !== '1',
    'Explicit Stripe test-mode acceptance only',
  );
  test.setTimeout(120000);
  const config = parse(await readFile(path.join(repository, '.env.local')));
  const key = process.env.STRIPE_API_SK || config.STRIPE_API_SK;
  if (!key || !/^(sk|rk)_test_/.test(key))
    throw new Error('Acceptance requires a Stripe test-mode key');
  const stripe = createStripeBillingProviderAdapter({ secretKey: key });
  const run = `billing-acceptance-${Date.now()}`;
  const customerRef = await stripe.createCustomer({ orgId: run, billingAccountId: `payer:${run}` });
  expect(await stripe.createCustomer({ orgId: run, billingAccountId: `payer:${run}` })).toBe(
    customerRef,
  );
  const setup = await stripe.createCardSetupSession({
    setupId: run,
    orgId: run,
    billingAccountId: `payer:${run}`,
    customerRef,
    successUrl: 'https://example.com/billing?checkout_session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://example.com/billing',
    now: new Date(),
    startPlan: 'growth',
  });
  expect((await stripe.getCardSetupSession({ checkoutSessionId: setup.id })).kind).toBe(
    'incomplete',
  );
  const declined = await stripeRequest(
    key,
    'payment_methods',
    { type: 'card', 'card[token]': 'tok_chargeCustomerFail' },
    `${run}:decline-card`,
  );
  expect(declined.status).toBe(200);
  const declinedId = responseId(declined.body);
  const attached = await stripeRequest(
    key,
    `payment_methods/${declinedId}/attach`,
    { customer: customerRef },
    `${run}:attach-decline`,
  );
  expect(attached.status).toBe(200);
  await stripe.setDefaultPaymentMethod({ customerRef, paymentMethodRef: declinedId });
  const chargeKey = `${run}:2026-10`;
  const input = {
    customerRef,
    chargeKey,
    orgId: run,
    monthUtc: '2026-10',
    kind: 'monthly_usage',
    priceVersion: 'platform-monthly-v1',
    idempotencyKey: run,
  } as const;
  const created = await stripe.createBillingInvoice(input);
  expect((await stripe.createBillingInvoice(input)).id).toBe(created.id);
  await stripe.addBillingInvoiceItem({
    invoiceId: created.id,
    customerRef,
    chargeKey,
    description: 'Seams monthly plan and usage invoice',
    amountMinor: 150,
    periodStartMs: Date.parse('2026-10-01'),
    periodEndMs: Date.parse('2026-11-01'),
    idempotencyKey: run,
  });
  const finalized = await stripe.finalizeBillingInvoice(created.id);
  expect(finalized.status).toBe('open');
  const failed = await stripeRequest(key, `invoices/${created.id}/pay`, {}, `${run}:first-pay`);
  expect(failed.status).toBe(402);
  const unpaid = await stripe.getBillingInvoice(created.id);
  expect(unpaid.status).toBe('open');
  expect(unpaid.paymentFailed).toBe(true);
  expect(unpaid.amountRemainingMinor).toBe(150);
  const replacement = await stripeRequest(
    key,
    'payment_methods',
    { type: 'card', 'card[token]': 'tok_visa' },
    `${run}:replacement-card`,
  );
  expect(replacement.status).toBe(200);
  const replacementId = responseId(replacement.body);
  expect(
    (
      await stripeRequest(
        key,
        `payment_methods/${replacementId}/attach`,
        { customer: customerRef },
        `${run}:attach-replacement`,
      )
    ).status,
  ).toBe(200);
  await stripe.setDefaultPaymentMethod({ customerRef, paymentMethodRef: replacementId });
  expect((await stripe.getBillingInvoice(created.id)).status).toBe('open');
  expect(
    (await stripeRequest(key, `invoices/${created.id}/pay`, {}, `${run}:recovery-pay`)).status,
  ).toBe(200);
  const paid = await stripe.getBillingInvoice(created.id);
  expect(paid.status).toBe('paid');
  expect(paid.amountPaidMinor).toBe(150);
  expect(paid.confirmedPaymentMinor).toBe(150);
  expect(paid.confirmedPayments).toHaveLength(1);
  expect(paid.amountRemainingMinor).toBe(0);
  expect(await stripe.findBillingInvoices({ customerRef, chargeKey })).toHaveLength(1);
  const creditInput = {
    invoiceId: paid.id,
    customerRef,
    creditKey: `${run}:usage-credit`,
    amountMinor: 25,
    idempotencyKey: `${run}:usage-credit`,
  };
  const credit = await stripe.reconcileInvoiceCredit(creditInput);
  expect(credit.amountMinor).toBe(25);
  expect(credit.status).toBe('issued');
  expect((await stripe.reconcileInvoiceCredit(creditInput)).id).toBe(credit.id);
  const output = path.join(repository, '.artifacts/platform-billing/stripe');
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'acceptance.json'),
    JSON.stringify(
      {
        command:
          'SEAMS_STRIPE_ACCEPTANCE=1 pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/platform-stripe-test-mode.e2e.test.ts --reporter=line',
        mode: 'test',
        customer: redacted(customerRef),
        invoice: redacted(paid.id),
        incompleteSetup: true,
        failedStatus: failed.status,
        unpaid: unpaid.amountRemainingMinor,
        paid: paid.amountPaidMinor,
        invoiceCount: 1,
        creditNote: redacted(credit.id),
        creditMinor: credit.amountMinor,
      },
      null,
      2,
    ),
  );
  await stripeRequest(
    key,
    `checkout/sessions/${setup.id}/expire`,
    {},
    `${run}:expire-unused-setup`,
  );
}
test(
  'Stripe test mode: one invoice survives failed payment, replacement card, and replay',
  runStripeAcceptance,
);
