export type SignatureFunding =
  | { readonly kind: 'included'; readonly outcome: 'succeeded'; readonly grantId?: never }
  | {
      readonly kind: 'credit';
      readonly outcome: 'succeeded' | 'failed';
      readonly grantId: string;
      readonly walletId: string;
    };
export interface SignatureOutcome {
  readonly signatureId: string;
  readonly completedAtMs: number;
  readonly funding: SignatureFunding;
}
export function parseSignatureFunding(raw: unknown): SignatureFunding {
  if (raw === undefined) return { kind: 'included', outcome: 'succeeded' };
  if (!raw || typeof raw !== 'object' || !('kind' in raw) || !('outcome' in raw))
    throw new Error('Invalid signing outcome funding');
  if (raw.kind === 'included' && raw.outcome === 'succeeded')
    return { kind: 'included', outcome: 'succeeded' };
  if (
    raw.kind === 'credit' &&
    (raw.outcome === 'succeeded' || raw.outcome === 'failed') &&
    'grantId' in raw &&
    typeof raw.grantId === 'string' &&
    raw.grantId &&
    'walletId' in raw &&
    typeof raw.walletId === 'string' &&
    raw.walletId
  )
    return { kind: 'credit', outcome: raw.outcome, grantId: raw.grantId, walletId: raw.walletId };
  throw new Error('Invalid signing outcome funding');
}
