import type { ConsoleWalletKey } from '../../packages/wallet-console-shared-ts/src/walletIdentity';
import type {
  ConsoleWalletService,
  ConsoleWalletsContext,
  RefreshConsoleWalletBalancesRequest,
} from '../../packages/wallet-console-server-ts/src/wallets/service';
import type {
  WalletRuntimeWalletIdentityRequest,
  WalletRuntimeWalletIdentitiesResult,
} from '@seams/wallet-server/cloud-host';

declare const service: ConsoleWalletService;
declare const context: ConsoleWalletsContext;
declare const partialKey: Partial<ConsoleWalletKey>;

// @ts-expect-error A wallet ID alone cannot select a wallet.
void service.getWallet(context, 'wallet');
// @ts-expect-error A broad spread cannot establish environment scope.
const spreadKey: ConsoleWalletKey = { ...partialKey, id: 'wallet', projectId: 'project' };
const refresh: RefreshConsoleWalletBalancesRequest = {
  // @ts-expect-error Refresh requests require complete wallet keys.
  wallets: [{ id: 'wallet', projectId: 'project' }],
};
const request: WalletRuntimeWalletIdentityRequest = {
  orgId: 'org',
  // @ts-expect-error Runtime identity requests require the runtime environment key.
  wallets: [{ walletId: 'wallet', projectId: 'project' }],
};
const result: WalletRuntimeWalletIdentitiesResult = {
  // @ts-expect-error Runtime replies must retain their wallet's scope.
  identities: [{ walletId: 'wallet', nearAccountId: 'wallet.testnet', evmAddress: '0x01' }],
};

void [spreadKey, refresh, request, result];
