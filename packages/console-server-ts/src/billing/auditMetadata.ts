import type { GenerateMonthlyInvoiceResult } from './types';

export function buildConsoleBillingInvoiceGeneratedAuditEvent(input: {
  generation: GenerateMonthlyInvoiceResult;
}): {
  summary: string;
  metadata: Record<string, unknown>;
} {
  return {
    summary: input.generation.generated
      ? `Generated monthly invoice ${input.generation.invoice.id}`
      : `Refreshed monthly invoice ${input.generation.invoice.id}`,
    metadata: {
      invoiceId: input.generation.invoice.id,
      invoiceStatus: input.generation.invoice.status,
      invoiceDocumentType: input.generation.invoice.documentType,
      periodMonthUtc: input.generation.invoice.periodMonthUtc,
      currency: input.generation.invoice.currency,
      amountDueMinor: input.generation.invoice.amountDueMinor,
      amountPaidMinor: input.generation.invoice.amountPaidMinor,
      ...(input.generation.invoice.dueAt ? { dueAt: input.generation.invoice.dueAt } : {}),
      generated: input.generation.generated,
      monthlyActiveResources: input.generation.monthlyActiveResources,
      lineItemCount: input.generation.lineItems.length,
      activeResourceUnitPriceMinor: input.generation.pricing.activeResourceUnitPriceMinor,
    },
  };
}
