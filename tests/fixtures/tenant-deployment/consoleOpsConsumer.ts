import type { WalletConsoleServiceBinding } from '@seams/wallet-server/cloud-host';

export default {
  fetch(request: Request, env: { WALLET_CONSOLE: WalletConsoleServiceBinding }): Promise<Response> {
    return env.WALLET_CONSOLE.fetch(request);
  },
};
