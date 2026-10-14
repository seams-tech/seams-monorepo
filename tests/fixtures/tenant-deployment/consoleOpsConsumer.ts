import type { WalletConsoleServiceBinding } from '@seams/wallet-server/cloud-host';

export default {
  fetch(
    request: Request,
    env: {
      WALLET_CONSOLE: WalletConsoleServiceBinding;
      ACCOUNT_PLATFORM: WalletConsoleServiceBinding;
    },
  ): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/account-platform/'))
      return env.ACCOUNT_PLATFORM.fetch(request);
    return env.WALLET_CONSOLE.fetch(request);
  },
};
