import type { SponsoredEvmExecutionResult } from './evmExecutorTypes';

export type SponsoredEvmExecutionFailure =
  | {
      readonly kind: 'rejected';
      readonly txHash?: never;
      readonly execution?: never;
    }
  | {
      readonly kind: 'indeterminate';
      readonly txHash: `0x${string}`;
      readonly execution?: never;
    }
  | {
      readonly kind: 'reverted';
      readonly execution: SponsoredEvmExecutionResult;
      readonly txHash?: never;
    };

/** The executor records whether broadcasting started before it reports a failure. */
export class SponsoredEvmExecutionError extends Error {
  constructor(
    readonly failure: SponsoredEvmExecutionFailure,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'SponsoredEvmExecutionError';
  }
}

export class SponsoredNearDelegateRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SponsoredNearDelegateRejectedError';
  }
}
