import type { TrustedWalletExecutionQuoteV1 } from '../../packages/console-server-ts/src/billing/pricing';

declare const quote: TrustedWalletExecutionQuoteV1;

// @ts-expect-error A trusted quote must enter through its boundary parser.
const spreadQuote: TrustedWalletExecutionQuoteV1 = { ...quote };

// @ts-expect-error Plain fields cannot construct an accepted Wallet quote.
const literalQuote: TrustedWalletExecutionQuoteV1 = {
  version: 1,
  currency: 'USD',
  instanceId: 'wallet_instance',
  executionId: 'accepted_execution',
  quoteVersion: 'wallet-price-v1',
  quotedAt: '2026-10-13T00:00:00.000Z',
  amountMinor: 25,
  sourceRecordId: 'execution_receipt',
  sourceDigest: 'a'.repeat(64),
  ledgerSourceEventId: 'sponsored_evm_call_debit:accepted_execution',
  resourceId: 'native_wallet',
  txOrExecutionRef: null,
  toJSON: quote.toJSON,
};

void spreadQuote;
void literalQuote;
