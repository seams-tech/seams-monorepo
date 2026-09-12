import { expect, readConsoleSuccess, test } from './harness';

type BillingOverview = {
  readonly creditBalanceMinor: number;
  readonly liveEnvironmentState: string;
};

type BillingActivityEntry = {
  readonly amountMinor: number;
  readonly type: string;
  readonly sourceEventId: string;
};

type BillingInvoice = {
  readonly id: string;
  readonly documentType: string;
  readonly amountDueMinor: number;
  readonly amountPaidMinor: number;
};

type BillingReconcileResult = {
  readonly settled: boolean;
  readonly settledNow: boolean;
  readonly invoice: { readonly id: string };
};

function readBillingString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBillingNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBillingBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a non-empty string`);
  const result = value.trim();
  if (!result) throw new Error(`${label} must be a non-empty string`);
  return result;
}

function parseBillingOverviewResponse(value: unknown, _label: string): BillingOverview | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const overview = Reflect.get(value, 'overview');
  if (overview === null || typeof overview !== 'object' || Array.isArray(overview)) return null;
  const creditBalanceMinor = readBillingNumber(Reflect.get(overview, 'creditBalanceMinor'));
  const liveEnvironmentState = readBillingString(Reflect.get(overview, 'liveEnvironmentState'));
  if (creditBalanceMinor === null || liveEnvironmentState === null) return null;
  return { creditBalanceMinor, liveEnvironmentState };
}

function parseBillingActivityEntry(value: unknown): BillingActivityEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const amountMinor = readBillingNumber(Reflect.get(value, 'amountMinor'));
  const type = readBillingString(Reflect.get(value, 'type'));
  const sourceEventId = readBillingString(Reflect.get(value, 'sourceEventId'));
  if (amountMinor === null || type === null || sourceEventId === null) return null;
  return { amountMinor, type, sourceEventId };
}

function parseBillingActivityResponse(
  value: unknown,
  _label: string,
): readonly BillingActivityEntry[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const activity = Reflect.get(value, 'activity');
  if (activity === null || typeof activity !== 'object' || Array.isArray(activity)) return null;
  const entries = Reflect.get(activity, 'entries');
  if (!Array.isArray(entries)) return null;
  const decoded: BillingActivityEntry[] = [];
  for (const entry of entries) {
    const parsed = parseBillingActivityEntry(entry);
    if (parsed === null) return null;
    decoded.push(parsed);
  }
  return decoded;
}

function parseBillingInvoice(value: unknown): BillingInvoice | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = readBillingString(Reflect.get(value, 'id'));
  const documentType = readBillingString(Reflect.get(value, 'documentType'));
  const amountDueMinor = readBillingNumber(Reflect.get(value, 'amountDueMinor'));
  const amountPaidMinor = readBillingNumber(Reflect.get(value, 'amountPaidMinor'));
  if (id === null || documentType === null || amountDueMinor === null || amountPaidMinor === null) {
    return null;
  }
  return { id, documentType, amountDueMinor, amountPaidMinor };
}

function parseBillingReconcileResponse(
  value: unknown,
  _label: string,
): BillingReconcileResult | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const result = Reflect.get(value, 'result');
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return null;
  const settled = readBillingBoolean(Reflect.get(result, 'settled'));
  const settledNow = readBillingBoolean(Reflect.get(result, 'settledNow'));
  const invoice = parseBillingInvoice(Reflect.get(result, 'invoice'));
  if (settled === null || settledNow === null || invoice === null) return null;
  return { settled, settledNow, invoice: { id: invoice.id } };
}

function parseBillingInvoiceListResponse(
  value: unknown,
  _label: string,
): readonly BillingInvoice[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const invoices = Reflect.get(value, 'invoices');
  if (!Array.isArray(invoices)) return null;
  const decoded: BillingInvoice[] = [];
  for (const invoice of invoices) {
    const parsed = parseBillingInvoice(invoice);
    if (parsed === null) return null;
    decoded.push(parsed);
  }
  return decoded;
}

test('billing checkout funds a zero-balance account and persists its receipt document', async ({
  console,
}) => {
  const { page, api } = console;
  await console.provisionCompletedTenant();

  const initialOverviewResponse = await api.get('/console/billing/overview');
  const initialOverview = await readConsoleSuccess(
    initialOverviewResponse,
    'Initial billing overview',
    parseBillingOverviewResponse,
  );
  expect(initialOverview.creditBalanceMinor).toBe(0);
  expect(initialOverview.liveEnvironmentState.toUpperCase()).toBe('BLOCKED');

  await page.goto('/dashboard/billing/account');
  const billingPage = page.getByLabel('Billing page');
  await expect(billingPage).toBeVisible();
  const summary = page.getByRole('region', { name: 'Billing account summary metrics' });
  await expect(summary).toContainText('$0.00');
  await expect(summary).toContainText('Live environments are blocked');

  await page
    .getByRole('group', { name: 'Top-up amount' })
    .getByRole('button', { name: '$25', exact: true })
    .click();
  await page.getByRole('button', { name: 'Buy $25', exact: true }).click();
  await expect(page).toHaveURL(
    /\/dashboard\/billing\/account\?checkout=success&checkout_session_id=/,
  );
  const checkoutSessionId = requireString(
    new URL(page.url()).searchParams.get('checkout_session_id'),
    'Checkout session id',
  );

  await expect(summary).toContainText('$25.00', { timeout: 30_000 });
  await expect(page.getByText('Balance updated')).toBeVisible();
  const settledOverviewResponse = await api.get('/console/billing/overview');
  const settledOverview = await readConsoleSuccess(
    settledOverviewResponse,
    'Settled billing overview',
    parseBillingOverviewResponse,
  );
  expect(settledOverview.creditBalanceMinor).toBe(2500);
  expect(settledOverview.liveEnvironmentState.toUpperCase()).toBe('HEALTHY');

  const activityResponse = await api.get(
    '/console/billing/account/activity?limit=100&eventType=CREDIT_PURCHASE',
  );
  const activityEntries = await readConsoleSuccess(
    activityResponse,
    'Billing account activity',
    parseBillingActivityResponse,
  );
  expect(activityEntries).toHaveLength(1);
  const purchaseActivity = activityEntries[0];
  expect(purchaseActivity.amountMinor).toBe(2500);
  expect(purchaseActivity.type.toUpperCase()).toBe('CREDIT_PURCHASE');
  expect(purchaseActivity.sourceEventId).toBe(checkoutSessionId);

  const secondReconcileResponse = await api.post(
    '/console/billing/stripe/checkout-session/reconcile',
    { data: { checkoutSessionId } },
  );
  const secondResult = await readConsoleSuccess(
    secondReconcileResponse,
    'Second checkout reconciliation',
    parseBillingReconcileResponse,
  );
  expect(secondResult.settled).toBe(true);
  expect(secondResult.settledNow).toBe(false);
  const invoiceId = secondResult.invoice.id;

  const invoicesResponse = await api.get(
    '/console/billing/invoices?documentType=PURCHASE_RECEIPT&limit=100',
  );
  const invoices = await readConsoleSuccess(
    invoicesResponse,
    'Billing document list',
    parseBillingInvoiceListResponse,
  );
  const invoice = invoices.find((entry) => entry.id === invoiceId);
  if (!invoice) throw new Error(`Purchase receipt ${invoiceId} was not found`);
  expect(invoice.documentType.toUpperCase()).toBe('PURCHASE_RECEIPT');
  expect(invoice.amountDueMinor).toBe(2500);
  expect(invoice.amountPaidMinor).toBe(2500);

  await page.goto('/dashboard/invoices');
  await expect(page.getByLabel('Billing page')).toBeVisible();
  const invoiceRow = page.getByRole('row').filter({ hasText: invoiceId });
  await expect(invoiceRow).toBeVisible();
  await expect(invoiceRow).toContainText('Receipt');
  await expect(invoiceRow).toContainText('$25.00');
  await invoiceRow.getByRole('button', { name: 'View document', exact: true }).click();
  expect(new URL(page.url()).pathname).toBe(`/dashboard/invoices/${invoiceId}`);

  const detailHeader = page.getByRole('region', { name: 'Billing document detail header' });
  await expect(detailHeader).toContainText(invoiceId);
  await expect(
    page.getByRole('region', { name: 'Billing document summary metrics' }),
  ).toContainText('$25.00');
  await expect(
    page.getByRole('region', { name: 'Billing document activity timeline' }),
  ).toContainText('Purchase receipt');
  await expect(page.getByRole('table', { name: 'Billing document line items' })).toContainText(
    'Prepaid credit top-up',
  );

  const download = page.waitForEvent('download');
  await page
    .getByRole('region', { name: 'Billing document detail header' })
    .getByRole('button', { name: 'Download PDF', exact: true })
    .click();
  await expect(await download).toBeTruthy();

  const pdfResponse = await api.get(
    `/console/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`,
  );
  expect(pdfResponse.ok()).toBe(true);
  expect(String(pdfResponse.headers()['content-type'] || '').toLowerCase()).toContain(
    'application/pdf',
  );
  const pdfBody = await pdfResponse.body();
  expect(pdfBody.byteLength).toBeGreaterThan(0);
  expect(pdfBody.subarray(0, 4).toString('ascii')).toBe('%PDF');

  await page.reload();
  await expect(page.getByRole('region', { name: 'Billing document detail header' })).toContainText(
    invoiceId,
  );
  const finalOverviewResponse = await api.get('/console/billing/overview');
  const finalOverview = await readConsoleSuccess(
    finalOverviewResponse,
    'Final billing overview',
    parseBillingOverviewResponse,
  );
  expect(finalOverview.creditBalanceMinor).toBe(2500);
  const finalActivityResponse = await api.get(
    '/console/billing/account/activity?limit=100&eventType=CREDIT_PURCHASE',
  );
  const finalActivityEntries = await readConsoleSuccess(
    finalActivityResponse,
    'Final billing account activity',
    parseBillingActivityResponse,
  );
  expect(finalActivityEntries).toHaveLength(1);
});
