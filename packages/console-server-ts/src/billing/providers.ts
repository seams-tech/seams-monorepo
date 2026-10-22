import { secureRandomBase36 } from '../boundary';
import { ConsoleBillingError } from './errors';
import type { SelfServePlanKindV1 } from './freePlan';
import type { BillingCreditPackId, StripeProviderRefundStatus } from './types';

export interface StripeCheckoutSessionProviderInput {
  purchaseId: string;
  orgId: string;
  successUrl: string;
  cancelUrl: string;
  creditPackId: BillingCreditPackId;
  amountMinor: number;
  now: Date;
}

export interface StripeCheckoutSessionProviderOutput {
  id: string;
  url: string;
  customerRef: string;
  expiresAt: string;
}

export interface StripeCheckoutSessionLookupProviderInput {
  checkoutSessionId: string;
}

export interface StripeCheckoutSessionLookupProviderOutput {
  id: string;
  orgId: string | null;
  customerRef: string | null;
  paymentIntentRef: string | null;
  paymentStatus: string;
  checkoutStatus: string;
  purchaseId: string;
  creditPackId: BillingCreditPackId;
  amountMinor: number;
  currency: 'USD';
}

export interface StripeRefundProviderInput {
  refundId: string;
  orgId: string;
  purchaseId: string;
  providerPaymentRef: string;
  amountMinor: number;
  reason: string;
}

export interface StripeRefundLookupProviderInput {
  providerRefundId: string;
}

export interface StripeRefundProviderOutput {
  id: string;
  status: StripeProviderRefundStatus;
  failureCode: string | null;
}

export interface StripeCustomerProviderInput {
  orgId: string;
  billingAccountId: string;
}

export interface StripeCardSetupSessionProviderInput {
  setupId: string;
  orgId: string;
  billingAccountId: string;
  customerRef: string;
  successUrl: string;
  cancelUrl: string;
  now: Date;
  /** The plan that the verified card starts; Stripe's page states its price. */
  startPlan: SelfServePlanKindV1 | null;
}

export interface StripeCardSetupSessionProviderOutput {
  id: string;
  url: string;
  expiresAt: string;
}

export interface StripeCardSetupSessionLookupProviderInput {
  checkoutSessionId: string;
}

export interface StripeVerifiedCardV1 {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** A setup session is verified only when Stripe reports a succeeded SetupIntent with a card. */
export type StripeCardSetupSessionLookupProviderOutput =
  | {
      kind: 'verified';
      id: string;
      orgId: string | null;
      customerRef: string;
      card: StripeVerifiedCardV1;
    }
  | {
      kind: 'incomplete';
      id: string;
      orgId: string | null;
      customerRef: string | null;
      card?: never;
    };

export interface StripeDefaultPaymentMethodProviderInput {
  customerRef: string;
  paymentMethodRef: string;
}

export type StripePlanBaseInvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export interface StripePlanBaseInvoice {
  readonly id: string;
  readonly customerRef: string;
  readonly chargeKey: string;
  readonly status: StripePlanBaseInvoiceStatus;
  readonly currency: 'USD';
  readonly collectionMethod: 'charge_automatically';
  readonly autoAdvance: boolean;
  readonly subtotalMinor: number;
  readonly totalMinor: number;
  readonly lineItems: readonly { readonly chargeKey: string; readonly amountMinor: number }[];
}

export interface StripePlanBaseInvoiceCreateInput {
  readonly customerRef: string;
  readonly chargeKey: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly plan: SelfServePlanKindV1;
  readonly priceVersion: string;
  readonly idempotencyKey: string;
}

export interface StripePlanBaseInvoiceItemInput {
  readonly invoiceId: string;
  readonly customerRef: string;
  readonly chargeKey: string;
  readonly plan: SelfServePlanKindV1;
  readonly amountMinor: number;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly idempotencyKey: string;
}

export interface StripeBillingProviderAdapter {
  createCustomer(input: StripeCustomerProviderInput): Promise<string> | string;
  createCardSetupSession(
    input: StripeCardSetupSessionProviderInput,
  ): Promise<StripeCardSetupSessionProviderOutput> | StripeCardSetupSessionProviderOutput;
  getCardSetupSession(
    input: StripeCardSetupSessionLookupProviderInput,
  ):
    | Promise<StripeCardSetupSessionLookupProviderOutput>
    | StripeCardSetupSessionLookupProviderOutput;
  setDefaultPaymentMethod(input: StripeDefaultPaymentMethodProviderInput): Promise<void> | void;
  createPlanBaseInvoice(
    input: StripePlanBaseInvoiceCreateInput,
  ): Promise<StripePlanBaseInvoice> | StripePlanBaseInvoice;
  getPlanBaseInvoice(invoiceId: string): Promise<StripePlanBaseInvoice> | StripePlanBaseInvoice;
  addPlanBaseInvoiceItem(input: StripePlanBaseInvoiceItemInput): Promise<void> | void;
  finalizePlanBaseInvoice(
    invoiceId: string,
  ): Promise<StripePlanBaseInvoice> | StripePlanBaseInvoice;
  createCheckoutSession(
    input: StripeCheckoutSessionProviderInput,
  ): Promise<StripeCheckoutSessionProviderOutput> | StripeCheckoutSessionProviderOutput;
  getCheckoutSession(
    input: StripeCheckoutSessionLookupProviderInput,
  ): Promise<StripeCheckoutSessionLookupProviderOutput> | StripeCheckoutSessionLookupProviderOutput;
  createRefund(
    input: StripeRefundProviderInput,
  ): Promise<StripeRefundProviderOutput> | StripeRefundProviderOutput;
  getRefund(
    input: StripeRefundLookupProviderInput,
  ): Promise<StripeRefundProviderOutput> | StripeRefundProviderOutput;
}

export interface BillingProviderAdapters {
  stripe: StripeBillingProviderAdapter;
}

function makeProviderId(prefix: string, now: Date): string {
  const ts = now.getTime().toString(36);
  const rand = secureRandomBase36(8, 'console IDs');
  return `${prefix}_${ts}_${rand}`;
}

function makeCustomerRef(orgId: string): string {
  return `cus_${orgId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'org'}`;
}

function buildMockCheckoutSuccessUrl(successUrl: string, checkoutSessionId: string): string {
  const url = new URL(successUrl);
  url.searchParams.set('checkout_session_id', checkoutSessionId);
  return url.toString();
}

export interface SimulatedBillingProviderOptions {
  /** The card that each simulated setup session verifies. */
  readonly setupCard?: Omit<StripeVerifiedCardV1, 'id'>;
}

/** Explicit payment simulation for local development and acceptance fixtures. */
export function createSimulatedBillingProviderAdapters(
  options: SimulatedBillingProviderOptions = {},
): BillingProviderAdapters {
  const sessions = new Map<string, StripeCheckoutSessionLookupProviderOutput>();
  const refunds = new Map<string, StripeRefundProviderOutput>();
  const setupSessions = new Map<string, StripeCardSetupSessionLookupProviderOutput>();
  const customers = new Map<string, string>();
  const planInvoices = new Map<string, StripePlanBaseInvoice>();
  const planInvoiceByKey = new Map<string, string>();
  const setupCard = options.setupCard ?? {
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2099,
  };
  return {
    stripe: {
      createCustomer(input: StripeCustomerProviderInput): string {
        const existing = customers.get(input.billingAccountId);
        if (existing) return existing;
        const customerRef = makeCustomerRef(input.billingAccountId);
        customers.set(input.billingAccountId, customerRef);
        return customerRef;
      },
      createCardSetupSession(
        input: StripeCardSetupSessionProviderInput,
      ): StripeCardSetupSessionProviderOutput {
        const id = makeProviderId('cs_setup', input.now);
        setupSessions.set(id, {
          kind: 'verified',
          id,
          orgId: input.orgId,
          customerRef: input.customerRef,
          card: { id: `pm_${input.setupId}`, ...setupCard },
        });
        return {
          id,
          url: buildMockCheckoutSuccessUrl(input.successUrl, id),
          expiresAt: new Date(input.now.getTime() + 30 * 60 * 1000).toISOString(),
        };
      },
      getCardSetupSession(
        input: StripeCardSetupSessionLookupProviderInput,
      ): StripeCardSetupSessionLookupProviderOutput {
        const session = setupSessions.get(String(input.checkoutSessionId || '').trim());
        if (!session) {
          throw new Error(
            `Stripe setup session ${input.checkoutSessionId || '(missing)'} was not found`,
          );
        }
        return session;
      },
      setDefaultPaymentMethod(): void {},
      createPlanBaseInvoice(input: StripePlanBaseInvoiceCreateInput): StripePlanBaseInvoice {
        const existingId = planInvoiceByKey.get(input.idempotencyKey);
        if (existingId) return planInvoices.get(existingId)!;
        const invoice: StripePlanBaseInvoice = {
          id: makeProviderId('in', new Date()),
          customerRef: input.customerRef,
          chargeKey: input.chargeKey,
          status: 'draft',
          currency: 'USD',
          collectionMethod: 'charge_automatically',
          autoAdvance: false,
          subtotalMinor: 0,
          totalMinor: 0,
          lineItems: [],
        };
        planInvoices.set(invoice.id, invoice);
        planInvoiceByKey.set(input.idempotencyKey, invoice.id);
        return invoice;
      },
      getPlanBaseInvoice(invoiceId: string): StripePlanBaseInvoice {
        const invoice = planInvoices.get(invoiceId);
        if (!invoice) throw new Error(`Stripe plan invoice ${invoiceId} was not found`);
        return invoice;
      },
      addPlanBaseInvoiceItem(input: StripePlanBaseInvoiceItemInput): void {
        const invoice = planInvoices.get(input.invoiceId);
        if (!invoice || invoice.status !== 'draft') {
          throw new Error(`Stripe plan invoice ${input.invoiceId} is not a draft`);
        }
        if (invoice.lineItems.length > 0) return;
        planInvoices.set(input.invoiceId, {
          ...invoice,
          subtotalMinor: input.amountMinor,
          totalMinor: input.amountMinor,
          lineItems: [{ chargeKey: input.chargeKey, amountMinor: input.amountMinor }],
        });
      },
      finalizePlanBaseInvoice(invoiceId: string): StripePlanBaseInvoice {
        const invoice = planInvoices.get(invoiceId);
        if (!invoice) throw new Error(`Stripe plan invoice ${invoiceId} was not found`);
        if (invoice.status !== 'draft') return invoice;
        const finalized: StripePlanBaseInvoice = { ...invoice, status: 'paid', autoAdvance: true };
        planInvoices.set(invoiceId, finalized);
        return finalized;
      },
      createCheckoutSession(
        input: StripeCheckoutSessionProviderInput,
      ): StripeCheckoutSessionProviderOutput {
        const id = makeProviderId('cs', input.now);
        const customerRef = makeCustomerRef(input.orgId);
        sessions.set(id, {
          id,
          orgId: input.orgId,
          customerRef,
          paymentIntentRef: `pi_${input.purchaseId}`,
          paymentStatus: 'paid',
          checkoutStatus: 'complete',
          purchaseId: input.purchaseId,
          creditPackId: input.creditPackId,
          amountMinor: input.amountMinor,
          currency: 'USD',
        });
        return {
          id,
          url: buildMockCheckoutSuccessUrl(input.successUrl, id),
          customerRef,
          expiresAt: new Date(input.now.getTime() + 30 * 60 * 1000).toISOString(),
        };
      },
      getCheckoutSession(
        input: StripeCheckoutSessionLookupProviderInput,
      ): StripeCheckoutSessionLookupProviderOutput {
        const checkoutSessionId = String(input.checkoutSessionId || '').trim();
        const session = sessions.get(checkoutSessionId);
        if (!session) {
          throw new Error(
            `Stripe checkout session ${checkoutSessionId || '(missing)'} was not found`,
          );
        }
        return session;
      },
      createRefund(input: StripeRefundProviderInput): StripeRefundProviderOutput {
        const existing = refunds.get(input.refundId);
        if (existing) return existing;
        const refund = {
          id: `re_${input.refundId}`,
          status: 'succeeded',
          failureCode: null,
        } as const;
        refunds.set(input.refundId, refund);
        refunds.set(refund.id, refund);
        return refund;
      },
      getRefund(input: StripeRefundLookupProviderInput): StripeRefundProviderOutput {
        const providerRefundId = String(input.providerRefundId || '').trim();
        const refund = refunds.get(providerRefundId);
        if (!refund) {
          throw new Error(`Stripe refund ${providerRefundId || '(missing)'} was not found`);
        }
        return refund;
      },
    },
  };
}

export function resolveBillingProviderAdapters(
  overrides?: Partial<BillingProviderAdapters>,
): BillingProviderAdapters {
  return {
    stripe: overrides?.stripe ?? new UnavailableStripeBillingProvider('Stripe is not configured'),
  };
}

export class UnavailableStripeBillingProvider implements StripeBillingProviderAdapter {
  constructor(private readonly message: string) {}

  requireAvailable(): never {
    throw new ConsoleBillingError('payment_provider_unavailable', 503, this.message);
  }

  createCustomer(): never {
    return this.requireAvailable();
  }

  createCardSetupSession(): never {
    return this.requireAvailable();
  }

  getCardSetupSession(): never {
    return this.requireAvailable();
  }

  setDefaultPaymentMethod(): never {
    return this.requireAvailable();
  }

  createPlanBaseInvoice(): never {
    return this.requireAvailable();
  }

  getPlanBaseInvoice(): never {
    return this.requireAvailable();
  }

  addPlanBaseInvoiceItem(): never {
    return this.requireAvailable();
  }

  finalizePlanBaseInvoice(): never {
    return this.requireAvailable();
  }

  createCheckoutSession(): never {
    return this.requireAvailable();
  }

  getCheckoutSession(): never {
    return this.requireAvailable();
  }

  createRefund(): never {
    return this.requireAvailable();
  }

  getRefund(): never {
    return this.requireAvailable();
  }
}

/** Reject unavailable configuration before a payment creates durable pending state. */
export function assertBillingProviderAvailable(providers: BillingProviderAdapters): void {
  if (providers.stripe instanceof UnavailableStripeBillingProvider) {
    providers.stripe.requireAvailable();
  }
}
