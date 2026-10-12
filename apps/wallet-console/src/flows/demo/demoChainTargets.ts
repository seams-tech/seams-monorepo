import type { EvmEip155ChainTarget, TempoChainTarget } from '@seams/wallet/react';

import { FRONTEND_CONFIG, type FrontendConfig } from '@/config';

type DemoEcdsaChain = 'tempo' | 'evm';

/* seams.tempo and seams.evm each accept one chain family, so the family the
   caller names is the family of the returned target. */
export function resolveDemoThresholdEcdsaChainTarget(
  chain: 'tempo',
  chains?: FrontendConfig['chains'],
): TempoChainTarget;
export function resolveDemoThresholdEcdsaChainTarget(
  chain: 'evm',
  chains?: FrontendConfig['chains'],
): EvmEip155ChainTarget;
export function resolveDemoThresholdEcdsaChainTarget(
  chain: DemoEcdsaChain,
  chains: FrontendConfig['chains'] = FRONTEND_CONFIG.chains,
): TempoChainTarget | EvmEip155ChainTarget {
  const networkSlug = chain === 'tempo' ? 'tempo-testnet' : 'arc-testnet';
  const chainConfig = chains.find((candidate) => candidate.network === networkSlug);
  const chainId = Number((chainConfig as { chainId?: unknown } | undefined)?.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`Demo ${networkSlug} ECDSA chain target is missing a concrete chainId`);
  }
  return chain === 'tempo'
    ? {
        kind: 'tempo' as const,
        chainId,
        networkSlug,
      }
    : {
        kind: 'evm' as const,
        namespace: 'eip155' as const,
        chainId,
        networkSlug,
      };
}
