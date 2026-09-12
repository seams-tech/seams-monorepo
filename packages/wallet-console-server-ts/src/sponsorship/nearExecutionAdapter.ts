import {
  buildDelegateActionPolicyFromResolvedRule,
  type ResolvedSponsoredNearDelegatePolicy,
} from './near';
import type { SponsorshipExecutionAdapter } from './executionAdapter';
import {
  parseWalletRuntimeExecuteSignedDelegateRequest,
  type WalletRuntimeExecuteSignedDelegateResult,
  type WalletRuntimeExecuteSignedDelegateRequest,
} from '@seams/wallet-server/cloud-host';

export interface SponsoredNearDelegateAuthService {
  executeSignedDelegate(
    input: WalletRuntimeExecuteSignedDelegateRequest,
  ): Promise<WalletRuntimeExecuteSignedDelegateResult>;
}

export type SponsoredNearDelegateExecutionResult = Awaited<
  ReturnType<SponsoredNearDelegateAuthService['executeSignedDelegate']>
>;

export type SponsoredNearDelegateExecutionAdapter = SponsorshipExecutionAdapter<
  SponsoredNearDelegateExecutionResult,
  'near_delegate',
  Record<string, never>
>;

export function createSponsoredNearDelegateExecutionAdapter(input: {
  authService: SponsoredNearDelegateAuthService;
  hash: string;
  signedDelegate: unknown;
  allowedDelegateAction: ResolvedSponsoredNearDelegatePolicy['allowedDelegateActions'][number];
}): SponsoredNearDelegateExecutionAdapter {
  return {
    executorKind: 'near_delegate',
    meta: {},
    execute: async () => {
      const request = parseWalletRuntimeExecuteSignedDelegateRequest({
        hash: input.hash,
        signedDelegate: input.signedDelegate,
        policy: buildDelegateActionPolicyFromResolvedRule({
          allowedDelegateAction: input.allowedDelegateAction,
        }),
      });
      if (!request) throw new Error('invalid signed delegate request');
      return await input.authService.executeSignedDelegate(request);
    },
  };
}
