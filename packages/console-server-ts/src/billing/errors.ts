export class ConsoleBillingError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ConsoleBillingError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isConsoleBillingError(error: unknown): error is ConsoleBillingError {
  return error instanceof ConsoleBillingError;
}

/** Parse credit admission failures at the database boundary. */
export function isBillingCreditConstraint(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  for (const marker of [
    'billing_mau_credit_exhausted',
    'postpaid_base_credit_exhausted',
    'signing_credit_unavailable',
  ]) {
    if (error.message.includes(marker)) return true;
  }
  return false;
}
