import type {
  BillingProviderAdapters,
  StripeInvoiceCredit,
  StripeInvoiceCreditInput,
  StripeBillingProviderAdapter,
  StripeCardSetupSessionLookupProviderInput,
  StripeCardSetupSessionLookupProviderOutput,
  StripeCardSetupSessionProviderInput,
  StripeCardSetupSessionProviderOutput,
  StripeCustomerProviderInput,
  StripeDefaultPaymentMethodProviderInput,
  StripeBillingInvoice,
  StripeBillingInvoiceCreateInput,
  StripeBillingInvoiceItemInput,
  StripeBillingInvoiceLookupInput,
  StripeVerifiedCardV1,
  StripeCheckoutSessionLookupProviderInput,
  StripeCheckoutSessionLookupProviderOutput,
  StripeCheckoutSessionProviderInput,
  StripeCheckoutSessionProviderOutput,
  StripeRefundLookupProviderInput,
  StripeRefundProviderInput,
  StripeRefundProviderOutput,
} from './providers';
import type { BillingCreditPackId, StripeProviderRefundStatus } from './types';
import { UnavailableStripeBillingProvider } from './providers';
import { SELF_SERVE_PLAN_PRICES_V1, type SelfServePlanKindV1 } from './freePlan';

export interface StripeBillingProviderOptions {
  readonly secretKey: string;
  readonly apiBaseUrl?: string;
  readonly requestTimeoutMs?: number;
}

export interface StripeBillingProviderEnv {
  readonly STRIPE_API_SK?: string;
  readonly STRIPE_API_BASE_URL?: string;
  readonly STRIPE_API_TIMEOUT_MS?: string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const STRIPE_PUBLISHABLE_KEY_PREFIX = 'pk_';
const STRIPE_SECRET_KEY_PREFIXES = ['sk_', 'rk_'] as const;
const DEFAULT_STRIPE_API_BASE_URL = 'https://api.stripe.com';
const DEFAULT_STRIPE_API_TIMEOUT_MS = 15_000;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasAllowedPrefix(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

export function normalizeStripeSecretKey(value: unknown): string {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  if (hasAllowedPrefix(normalized, STRIPE_SECRET_KEY_PREFIXES)) return normalized;
  throw new Error(
    'STRIPE_API_SK must be a Stripe secret key (sk_...) or restricted key (rk_...), not a publishable key.',
  );
}

export function normalizeOptionalStripePublishableKey(value: unknown): string {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  if (normalized.startsWith(STRIPE_PUBLISHABLE_KEY_PREFIX)) return normalized;
  throw new Error('STRIPE_API_PK must be a Stripe publishable key (pk_...).');
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.floor(parsed);
  return integer > 0 ? integer : fallback;
}

function toUnknownRecord(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as UnknownRecord;
}

async function readJsonResponse(response: Response): Promise<UnknownRecord> {
  try {
    return toUnknownRecord(await response.json());
  } catch {
    return {};
  }
}

function resolveExpiresAt(input: {
  readonly now: Date;
  readonly stripeUnixSeconds: unknown;
  readonly fallbackMinutes: number;
}): string {
  const unixSeconds = Number(input.stripeUnixSeconds);
  if (Number.isFinite(unixSeconds) && unixSeconds > 0) {
    return new Date(unixSeconds * 1000).toISOString();
  }
  return new Date(input.now.getTime() + input.fallbackMinutes * 60 * 1000).toISOString();
}

function setFormField(form: URLSearchParams, key: string, value: string | number): void {
  const normalized = String(value).trim();
  if (normalized) form.set(key, normalized);
}

function toStripeApiErrorMessage(status: number, payload: UnknownRecord): string {
  const error = toUnknownRecord(payload.error);
  const message = normalizeString(error.message);
  const code = normalizeString(error.code);
  const type = normalizeString(error.type);
  if (message && code) return `[stripe:${code}] ${message}`;
  if (message) return message;
  if (code && type) return `[stripe:${type}:${code}] request failed (${status})`;
  if (code) return `[stripe:${code}] request failed (${status})`;
  return `Stripe API request failed (${status})`;
}

function buildCreditPackName(input: StripeCheckoutSessionProviderInput): string {
  const amount = `$${(input.amountMinor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return `Seams prepaid credits (${amount})`;
}

function parseStripeRefundStatus(value: unknown): StripeProviderRefundStatus {
  const normalized = normalizeString(value).toLowerCase();
  switch (normalized) {
    case 'succeeded':
    case 'failed':
    case 'canceled':
      return normalized;
    case 'pending':
    case 'requires_action':
      return 'pending';
    default:
      throw new Error(`Stripe refund returned unsupported status: ${normalized || 'empty'}`);
  }
}

function parseStripeRefund(payload: UnknownRecord): StripeRefundProviderOutput {
  const id = normalizeString(payload.id);
  if (!id) throw new Error('Stripe refund returned missing id');
  return {
    id,
    status: parseStripeRefundStatus(payload.status),
    failureCode: normalizeString(payload.failure_reason) || null,
  };
}

function parseStripeCreditPackId(value: unknown): BillingCreditPackId {
  const normalized = normalizeString(value);
  switch (normalized) {
    case 'usd_10':
    case 'usd_25':
    case 'usd_50':
      return normalized;
    default:
      throw new Error(`Stripe checkout session has invalid credit pack metadata: ${normalized}`);
  }
}

function parseStripeCard(paymentMethod: UnknownRecord): StripeVerifiedCardV1 | null {
  const id = normalizeString(paymentMethod.id);
  const card = toUnknownRecord(paymentMethod.card);
  const brand = normalizeString(card.brand).toLowerCase();
  const last4 = normalizeString(card.last4);
  const expMonth = Number(card.exp_month);
  const expYear = Number(card.exp_year);
  if (
    !id ||
    normalizeString(paymentMethod.type) !== 'card' ||
    !brand ||
    !/^[0-9]{4}$/.test(last4) ||
    !Number.isSafeInteger(expMonth) ||
    expMonth < 1 ||
    expMonth > 12 ||
    !Number.isSafeInteger(expYear) ||
    expYear < 2000
  ) {
    return null;
  }
  return { id, brand, last4, expMonth, expYear };
}

function parseStripeBillingInvoiceStatus(value: unknown): StripeBillingInvoice['status'] {
  switch (normalizeString(value)) {
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
      throw new Error('Stripe plan invoice returned an invalid status');
  }
}

function parseStripeBillingInvoiceLineItem(
  raw: unknown,
): StripeBillingInvoice['lineItems'][number] {
  const row = toUnknownRecord(raw);
  const amountMinor = Number(row.amount);
  const chargeKey = normalizeString(toUnknownRecord(row.metadata).plan_base_charge_key);
  if (!Number.isSafeInteger(amountMinor) || !chargeKey) {
    throw new Error('Stripe plan invoice returned an invalid line item');
  }
  return { chargeKey, amountMinor };
}

function paymentIntentFailed(intent: UnknownRecord): boolean {
  return (
    intent.status === 'requires_action' ||
    (intent.status === 'requires_payment_method' &&
      intent.last_payment_error !== null &&
      intent.last_payment_error !== undefined)
  );
}

function requiredStripeAmount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid Stripe ${field}`);
  return value;
}

function parseStripeBillingInvoice(payload: UnknownRecord): StripeBillingInvoice {
  const id = normalizeString(payload.id);
  const customerRef = normalizeString(payload.customer);
  const metadata = toUnknownRecord(payload.metadata);
  const chargeKey = normalizeString(metadata.plan_base_charge_key);
  const status = parseStripeBillingInvoiceStatus(payload.status);
  const currency = normalizeString(payload.currency).toLowerCase();
  const collectionMethod = normalizeString(payload.collection_method);
  const autoAdvance = payload.auto_advance;
  const subtotalMinor = Number(payload.subtotal);
  const totalMinor = Number(payload.total);
  const lines = toUnknownRecord(payload.lines);
  const rawLineItems = Array.isArray(lines.data) ? lines.data : [];
  const lineCount = Number(lines.total_count);
  if (
    !id ||
    !customerRef ||
    !chargeKey ||
    currency !== 'usd' ||
    collectionMethod !== 'charge_automatically' ||
    typeof autoAdvance !== 'boolean' ||
    !Number.isSafeInteger(subtotalMinor) ||
    !Number.isSafeInteger(totalMinor) ||
    !Number.isSafeInteger(lineCount) ||
    lineCount !== rawLineItems.length
  ) {
    throw new Error('Stripe plan invoice returned invalid identity, status, or lines');
  }
  const lineItems = rawLineItems.map(parseStripeBillingInvoiceLineItem);
  return {
    id,
    customerRef,
    chargeKey,
    status,
    currency: 'USD',
    collectionMethod: 'charge_automatically',
    autoAdvance,
    subtotalMinor,
    totalMinor,
    lineItems,
    amountPaidMinor: requiredStripeAmount(payload.amount_paid, 'amount_paid'),
    confirmedPaymentMinor: 0,
    confirmedPayments: [],
    amountRemainingMinor: requiredStripeAmount(payload.amount_remaining, 'amount_remaining'),
    attempted: payload.attempted === true,
    paymentFailed: false,
    paidOutOfBand: payload.paid_out_of_band === true,
    hostedInvoiceUrl: normalizeString(payload.hosted_invoice_url) || null,
  };
}

/** Stripe's page states the price before the visitor enters a card. */
function cardSetupSubmitMessage(startPlan: SelfServePlanKindV1 | null): string {
  if (!startPlan) {
    return 'We charge this card for Growth and usage after each month. We do not charge it while you stay inside the Free limits.';
  }
  const name = startPlan === 'pro' ? 'Pro' : 'Growth';
  const monthly = SELF_SERVE_PLAN_PRICES_V1[startPlan].monthlyBaseMinor / 100;
  return `${name} starts today at $${monthly} a month. We charge this card for the plan and usage after each month.`;
}

class StripeBillingProvider implements StripeBillingProviderAdapter {
  private readonly secretKey: string;
  private readonly apiBaseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(options: StripeBillingProviderOptions) {
    this.secretKey = normalizeStripeSecretKey(options.secretKey);
    if (!this.secretKey) {
      throw new Error('STRIPE_API_SK must be set to enable live Stripe billing provider adapter');
    }
    this.apiBaseUrl =
      normalizeString(options.apiBaseUrl).replace(/\/+$/, '') || DEFAULT_STRIPE_API_BASE_URL;
    this.requestTimeoutMs = toPositiveInteger(
      options.requestTimeoutMs,
      DEFAULT_STRIPE_API_TIMEOUT_MS,
    );
  }

  async createCheckoutSession(
    input: StripeCheckoutSessionProviderInput,
  ): Promise<StripeCheckoutSessionProviderOutput> {
    const customerRef = input.customerRef;
    const form = new URLSearchParams();
    setFormField(form, 'mode', 'payment');
    setFormField(form, 'customer', customerRef);
    setFormField(form, 'success_url', input.successUrl);
    setFormField(form, 'cancel_url', input.cancelUrl);
    setFormField(form, 'client_reference_id', input.orgId);
    setFormField(form, 'metadata[org_id]', input.orgId);
    setFormField(form, 'metadata[purchase_id]', input.purchaseId);
    setFormField(form, 'metadata[credit_pack_id]', input.creditPackId);
    this.setCheckoutLineItem(form, input);

    const payload = await this.postForm('/v1/checkout/sessions', form, input.purchaseId);
    const id = normalizeString(payload.id);
    const url = normalizeString(payload.url);
    if (!id || !url) {
      throw new Error('Stripe checkout session returned missing id/url');
    }

    return {
      id,
      url,
      customerRef,
      expiresAt: resolveExpiresAt({
        now: input.now,
        stripeUnixSeconds: payload.expires_at,
        fallbackMinutes: 30,
      }),
    };
  }

  async getCheckoutSession(
    input: StripeCheckoutSessionLookupProviderInput,
  ): Promise<StripeCheckoutSessionLookupProviderOutput> {
    const checkoutSessionId = normalizeString(input.checkoutSessionId);
    if (!checkoutSessionId) {
      throw new Error('Stripe checkout session id is required');
    }
    const payload = await this.getJson(
      `/v1/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`,
    );
    const id = normalizeString(payload.id);
    if (!id) {
      throw new Error('Stripe checkout session lookup returned missing id');
    }
    const metadata = toUnknownRecord(payload.metadata);
    const amountMinor = Number(payload.amount_total);
    const currency = normalizeString(payload.currency).toLowerCase();
    const purchaseId = normalizeString(metadata.purchase_id);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new Error('Stripe checkout session lookup returned invalid amount_total');
    }
    if (currency !== 'usd') {
      throw new Error('Stripe checkout session lookup returned a non-USD currency');
    }
    if (!purchaseId) {
      throw new Error('Stripe checkout session lookup returned missing purchase metadata');
    }
    return {
      id,
      orgId:
        normalizeString(payload.client_reference_id) || normalizeString(metadata.org_id) || null,
      customerRef: normalizeString(payload.customer) || null,
      paymentIntentRef: normalizeString(payload.payment_intent) || null,
      paymentStatus: normalizeString(payload.payment_status).toLowerCase() || 'unknown',
      checkoutStatus: normalizeString(payload.status).toLowerCase() || 'unknown',
      purchaseId,
      creditPackId: parseStripeCreditPackId(metadata.credit_pack_id),
      amountMinor,
      currency: 'USD',
    };
  }

  async createRefund(input: StripeRefundProviderInput): Promise<StripeRefundProviderOutput> {
    const form = new URLSearchParams();
    setFormField(form, 'payment_intent', input.providerPaymentRef);
    setFormField(form, 'amount', input.amountMinor);
    setFormField(form, 'metadata[org_id]', input.orgId);
    setFormField(form, 'metadata[purchase_id]', input.purchaseId);
    setFormField(form, 'metadata[refund_id]', input.refundId);
    setFormField(form, 'metadata[reason]', input.reason);
    return parseStripeRefund(await this.postForm('/v1/refunds', form, input.refundId));
  }

  async getRefund(input: StripeRefundLookupProviderInput): Promise<StripeRefundProviderOutput> {
    const providerRefundId = normalizeString(input.providerRefundId);
    if (!providerRefundId) throw new Error('Stripe refund id is required');
    return parseStripeRefund(
      await this.getJson(`/v1/refunds/${encodeURIComponent(providerRefundId)}`),
    );
  }

  async createCustomer(input: StripeCustomerProviderInput): Promise<string> {
    const form = new URLSearchParams();
    setFormField(form, 'name', `Console ${input.orgId}`);
    setFormField(form, 'metadata[org_id]', input.orgId);
    setFormField(form, 'metadata[billing_account_id]', input.billingAccountId);
    setFormField(form, 'description', `Seams console billing customer for ${input.orgId}`);
    // One key per billing account: a lost reply cannot create a second Customer.
    const payload = await this.postForm(
      '/v1/customers',
      form,
      `customer:${input.billingAccountId}`,
    );
    const customerId = normalizeString(payload.id);
    if (!customerId) throw new Error('Stripe customer create returned missing id');
    return customerId;
  }

  async createCardSetupSession(
    input: StripeCardSetupSessionProviderInput,
  ): Promise<StripeCardSetupSessionProviderOutput> {
    const form = new URLSearchParams();
    setFormField(form, 'mode', 'setup');
    setFormField(form, 'currency', 'usd');
    setFormField(form, 'customer', input.customerRef);
    setFormField(form, 'payment_method_types[0]', 'card');
    setFormField(form, 'success_url', input.successUrl);
    setFormField(form, 'cancel_url', input.cancelUrl);
    setFormField(form, 'client_reference_id', input.orgId);
    setFormField(form, 'metadata[org_id]', input.orgId);
    setFormField(form, 'metadata[billing_account_id]', input.billingAccountId);
    setFormField(form, 'metadata[card_setup_id]', input.setupId);
    setFormField(form, 'custom_text[submit][message]', cardSetupSubmitMessage(input.startPlan));
    const payload = await this.postForm('/v1/checkout/sessions', form, input.setupId);
    const id = normalizeString(payload.id);
    const url = normalizeString(payload.url);
    if (!id || !url) throw new Error('Stripe setup session returned missing id/url');
    return {
      id,
      url,
      expiresAt: resolveExpiresAt({
        now: input.now,
        stripeUnixSeconds: payload.expires_at,
        fallbackMinutes: 30,
      }),
    };
  }

  async getCardSetupSession(
    input: StripeCardSetupSessionLookupProviderInput,
  ): Promise<StripeCardSetupSessionLookupProviderOutput> {
    const checkoutSessionId = normalizeString(input.checkoutSessionId);
    if (!checkoutSessionId) throw new Error('Stripe setup session id is required');
    const payload = await this.getJson(
      `/v1/checkout/sessions/${encodeURIComponent(checkoutSessionId)}?expand[]=setup_intent.payment_method`,
    );
    const id = normalizeString(payload.id);
    if (!id) throw new Error('Stripe setup session lookup returned missing id');
    if (normalizeString(payload.mode) !== 'setup') {
      throw new Error('Stripe checkout session is not a card setup session');
    }
    const metadata = toUnknownRecord(payload.metadata);
    const orgId =
      normalizeString(payload.client_reference_id) || normalizeString(metadata.org_id) || null;
    const customerRef = normalizeString(payload.customer) || null;
    const setupIntent = toUnknownRecord(payload.setup_intent);
    const card = parseStripeCard(toUnknownRecord(setupIntent.payment_method));
    if (
      normalizeString(payload.status) !== 'complete' ||
      normalizeString(setupIntent.status) !== 'succeeded' ||
      !customerRef ||
      !card
    ) {
      return { kind: 'incomplete', id, orgId, customerRef };
    }
    return { kind: 'verified', id, orgId, customerRef, card };
  }

  async setDefaultPaymentMethod(input: StripeDefaultPaymentMethodProviderInput): Promise<void> {
    const form = new URLSearchParams();
    setFormField(form, 'invoice_settings[default_payment_method]', input.paymentMethodRef);
    await this.postForm(
      `/v1/customers/${encodeURIComponent(input.customerRef)}`,
      form,
      `default:${input.customerRef}:${input.paymentMethodRef}`,
    );
  }

  async reconcileInvoiceCredit(input: StripeInvoiceCreditInput): Promise<StripeInvoiceCredit> {
    let cursor: string | null = null;
    const matches: StripeInvoiceCredit[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 100; page += 1) {
      const params = new URLSearchParams({ invoice: input.invoiceId, limit: '100' });
      if (cursor) params.set('starting_after', cursor);
      const response = await this.getJson(`/v1/credit_notes?${params}`);
      if (!Array.isArray(response.data) || typeof response.has_more !== 'boolean')
        throw new Error('Stripe credit note lookup is incomplete');
      for (const raw of response.data) {
        const note = toUnknownRecord(raw);
        const id = normalizeString(note.id);
        if (!id || seen.has(id)) throw new Error('Stripe credit note pagination did not advance');
        seen.add(id);
        cursor = id;
        if (normalizeString(toUnknownRecord(note.metadata).billing_credit_key) === input.creditKey)
          matches.push(parseInvoiceCredit(note));
      }
      if (!response.has_more) {
        if (matches.length > 1)
          throw new Error('Stripe has multiple credit notes for one adjustment');
        if (matches[0]) return matches[0];
        const form = new URLSearchParams();
        setFormField(form, 'invoice', input.invoiceId);
        setFormField(form, 'lines[0][type]', 'custom_line_item');
        setFormField(
          form,
          'lines[0][description]',
          'Wallet usage adjustment credited to the Seams billing account',
        );
        setFormField(form, 'lines[0][quantity]', 1);
        setFormField(form, 'lines[0][unit_amount]', input.amountMinor);
        setFormField(form, 'out_of_band_amount', input.amountMinor);
        setFormField(form, 'email_type', 'none');
        setFormField(form, 'metadata[billing_credit_key]', input.creditKey);
        return parseInvoiceCredit(
          await this.postForm('/v1/credit_notes', form, `invoice-credit:${input.idempotencyKey}`),
        );
      }
      if (response.data.length === 0)
        throw new Error('Stripe credit note pagination did not advance');
    }
    throw new Error('Stripe credit note lookup exceeded its page limit');
  }

  async createBillingInvoice(
    input: StripeBillingInvoiceCreateInput,
  ): Promise<StripeBillingInvoice> {
    const form = new URLSearchParams();
    setFormField(form, 'customer', input.customerRef);
    setFormField(form, 'currency', 'usd');
    setFormField(form, 'collection_method', 'charge_automatically');
    setFormField(form, 'auto_advance', 'false');
    setFormField(form, 'pending_invoice_items_behavior', 'exclude');
    setFormField(form, 'metadata[plan_base_charge_key]', input.chargeKey);
    setFormField(form, 'metadata[org_id]', input.orgId);
    setFormField(form, 'metadata[month_utc]', input.monthUtc);
    if (input.kind === 'plan_base') setFormField(form, 'metadata[plan]', input.plan);
    setFormField(form, 'metadata[price_version]', input.priceVersion);
    const payload = await this.postForm(
      '/v1/invoices',
      form,
      `plan-base-invoice:${input.idempotencyKey}`,
    );
    return parseStripeBillingInvoice(payload);
  }

  async getBillingInvoice(invoiceId: string): Promise<StripeBillingInvoice> {
    const id = normalizeString(invoiceId);
    if (!id) throw new Error('Stripe plan invoice id is required');
    const payload = await this.getJson(`/v1/invoices/${encodeURIComponent(id)}`);
    const invoice = parseStripeBillingInvoice(payload);
    if ((invoice.status !== 'open' || !invoice.attempted) && invoice.status !== 'paid')
      return invoice;
    let failed = false;
    let confirmedPaymentMinor = 0;
    const confirmedPayments: { paymentRef: string; amountMinor: number }[] = [];
    if (typeof payload.payment_intent === 'string') {
      const intent = await this.getJson(
        `/v1/payment_intents/${encodeURIComponent(payload.payment_intent)}`,
      );
      failed = paymentIntentFailed(intent);
      if (
        intent.status === 'succeeded' &&
        intent.currency === 'usd' &&
        intent.customer === invoice.customerRef &&
        requiredStripeAmount(intent.amount_received, 'amount received') >= invoice.amountPaidMinor
      ) {
        confirmedPaymentMinor = invoice.amountPaidMinor;
        confirmedPayments.push({
          paymentRef: normalizeString(intent.id),
          amountMinor: invoice.amountPaidMinor,
        });
      }
    } else {
      const payments = await this.getJson(
        `/v1/invoice_payments?invoice=${encodeURIComponent(id)}&limit=100&expand[]=data.payment.payment_intent`,
      );
      if (!Array.isArray(payments.data) || payments.has_more !== false)
        throw new Error('Stripe invoice payment lookup is incomplete');
      for (const raw of payments.data) {
        const payment = toUnknownRecord(raw);
        if (payment.invoice !== id) throw new Error('Stripe payment belongs to another invoice');
        const details = toUnknownRecord(payment.payment);
        const intent = toUnknownRecord(details.payment_intent);
        if (paymentIntentFailed(intent)) failed = true;
        if (
          payment.status === 'paid' &&
          intent.status === 'succeeded' &&
          intent.currency === 'usd' &&
          intent.customer === invoice.customerRef
        ) {
          const applied = requiredStripeAmount(payment.amount_paid, 'invoice payment amount');
          if (requiredStripeAmount(intent.amount_received, 'amount received') < applied)
            throw new Error('Stripe payment received less than its invoice allocation');
          confirmedPaymentMinor += applied;
          confirmedPayments.push({ paymentRef: normalizeString(intent.id), amountMinor: applied });
        }
      }
    }
    return { ...invoice, paymentFailed: failed, confirmedPaymentMinor, confirmedPayments };
  }

  async findBillingInvoices(
    input: StripeBillingInvoiceLookupInput,
  ): Promise<readonly StripeBillingInvoice[]> {
    const customerRef = normalizeString(input.customerRef);
    const chargeKey = normalizeString(input.chargeKey);
    if (!customerRef || !chargeKey) throw new Error('Stripe plan invoice lookup is incomplete');

    const invoices: StripeBillingInvoice[] = [];
    const seenIds = new Set<string>();
    let startingAfter: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ customer: customerRef, limit: '100' });
      if (startingAfter) query.set('starting_after', startingAfter);
      const response = await this.getJson(`/v1/invoices?${query.toString()}`);
      if (!Array.isArray(response.data) || typeof response.has_more !== 'boolean') {
        throw new Error('Stripe invoice list returned an invalid page');
      }
      for (const rawInvoice of response.data) {
        const invoice = toUnknownRecord(rawInvoice);
        const id = normalizeString(invoice.id);
        if (!id || seenIds.has(id) || normalizeString(invoice.customer) !== customerRef) {
          throw new Error('Stripe invoice list returned an invalid invoice');
        }
        seenIds.add(id);
        startingAfter = id;
        const metadata = toUnknownRecord(invoice.metadata);
        if (normalizeString(metadata.plan_base_charge_key) === chargeKey) {
          invoices.push(parseStripeBillingInvoice(invoice));
        }
      }
      if (!response.has_more) return invoices;
      if (response.data.length === 0) {
        throw new Error('Stripe invoice list did not advance its cursor');
      }
    }
    throw new Error('Stripe invoice list exceeded the reconciliation page limit');
  }

  async addBillingInvoiceItem(input: StripeBillingInvoiceItemInput): Promise<void> {
    const form = new URLSearchParams();
    setFormField(form, 'customer', input.customerRef);
    setFormField(form, 'invoice', input.invoiceId);
    setFormField(form, 'amount', input.amountMinor);
    setFormField(form, 'currency', 'usd');
    setFormField(form, 'description', input.description);
    setFormField(form, 'discountable', 'false');
    setFormField(form, 'period[start]', Math.floor(input.periodStartMs / 1000));
    setFormField(form, 'period[end]', Math.floor(input.periodEndMs / 1000));
    setFormField(form, 'metadata[plan_base_charge_key]', input.chargeKey);
    await this.postForm('/v1/invoiceitems', form, `plan-base-item:${input.idempotencyKey}`);
  }

  async finalizeBillingInvoice(invoiceId: string): Promise<StripeBillingInvoice> {
    const id = normalizeString(invoiceId);
    if (!id) throw new Error('Stripe plan invoice id is required');
    const form = new URLSearchParams();
    setFormField(form, 'auto_advance', 'true');
    return parseStripeBillingInvoice(
      await this.postForm(
        `/v1/invoices/${encodeURIComponent(id)}/finalize`,
        form,
        `plan-base-finalize:${id}`,
      ),
    );
  }

  private setCheckoutLineItem(
    form: URLSearchParams,
    input: StripeCheckoutSessionProviderInput,
  ): void {
    setFormField(form, 'line_items[0][price_data][currency]', 'usd');
    setFormField(form, 'line_items[0][price_data][unit_amount]', input.amountMinor);
    setFormField(form, 'line_items[0][price_data][product_data][name]', buildCreditPackName(input));
    setFormField(form, 'line_items[0][quantity]', 1);
  }

  private async postForm(
    pathname: string,
    form: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<UnknownRecord> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return await this.request(pathname, {
      method: 'POST',
      headers,
      body: form.toString(),
    });
  }

  private async getJson(pathname: string): Promise<UnknownRecord> {
    return await this.request(pathname, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
      },
    });
  }

  private async request(pathname: string, init: RequestInit): Promise<UnknownRecord> {
    const controller = new AbortController();
    const timeout = setTimeout(controller.abort.bind(controller), this.requestTimeoutMs);
    try {
      const response = await fetch(`${this.apiBaseUrl}${pathname}`, {
        ...init,
        signal: controller.signal,
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(toStripeApiErrorMessage(response.status, payload));
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createStripeBillingProviderAdapter(
  options: StripeBillingProviderOptions,
): StripeBillingProviderAdapter {
  return new StripeBillingProvider(options);
}

export function createStripeBillingProviderAdaptersFromEnv(
  env: StripeBillingProviderEnv,
): BillingProviderAdapters {
  try {
    const secretKey = normalizeStripeSecretKey(env.STRIPE_API_SK);
    if (!secretKey) {
      return { stripe: new UnavailableStripeBillingProvider('Stripe is not configured') };
    }
    return {
      stripe: createStripeBillingProviderAdapter({
        secretKey,
        apiBaseUrl: normalizeString(env.STRIPE_API_BASE_URL),
        requestTimeoutMs: toPositiveInteger(
          env.STRIPE_API_TIMEOUT_MS,
          DEFAULT_STRIPE_API_TIMEOUT_MS,
        ),
      }),
    };
  } catch {
    return { stripe: new UnavailableStripeBillingProvider('Stripe configuration is invalid') };
  }
}

function parseInvoiceCredit(raw: UnknownRecord): StripeInvoiceCredit {
  const id = normalizeString(raw.id);
  const invoiceId = normalizeString(raw.invoice);
  const customerRef = normalizeString(raw.customer);
  const creditKey = normalizeString(toUnknownRecord(raw.metadata).billing_credit_key);
  const amountMinor = requiredStripeAmount(raw.total, 'credit note total');
  if (
    !id ||
    !invoiceId ||
    !customerRef ||
    !creditKey ||
    raw.currency !== 'usd' ||
    (raw.status !== 'issued' && raw.status !== 'void') ||
    amountMinor <= 0 ||
    raw.out_of_band_amount !== amountMinor ||
    raw.post_payment_amount !== amountMinor ||
    raw.pre_payment_amount !== 0 ||
    raw.customer_balance_transaction !== null ||
    !Array.isArray(raw.refunds) ||
    raw.refunds.length !== 0
  )
    throw new Error('Stripe credit note does not represent the Platform ledger credit');
  return { id, invoiceId, customerRef, creditKey, amountMinor, status: raw.status };
}
