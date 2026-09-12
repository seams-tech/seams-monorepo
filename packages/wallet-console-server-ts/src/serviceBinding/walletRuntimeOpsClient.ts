import {
  WALLET_RUNTIME_OP_PATHS_V1,
  WALLET_RUNTIME_SERVICE_ORIGIN_V1,
  parseWalletRuntimeExecuteSignedDelegateResponse,
  parseWalletRuntimeRelayerAccount,
  parseWalletRuntimeWalletIdentitiesResult,
  type WalletRuntimeOps,
  type WalletRuntimeExecuteSignedDelegateRequest,
  type WalletRuntimeExecuteSignedDelegateResult,
  type WalletRuntimeServiceBinding,
  type WalletRuntimeWalletIdentitiesResult,
  type WalletRuntimeWalletIdentityRequest,
} from '@seams/wallet-server/cloud-host';

async function postJson(
  binding: WalletRuntimeServiceBinding,
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await binding.fetch(`${WALLET_RUNTIME_SERVICE_ORIGIN_V1}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json().catch(() => null);
  if (response.status < 200 || response.status >= 300 || parsed === null) {
    throw new Error(`Wallet runtime operation failed with HTTP ${response.status}`);
  }
  return parsed;
}

export function createWalletRuntimeOpsClient(
  binding: WalletRuntimeServiceBinding,
): WalletRuntimeOps {
  return {
    async executeSignedDelegate(
      input: WalletRuntimeExecuteSignedDelegateRequest,
    ): Promise<WalletRuntimeExecuteSignedDelegateResult> {
      const body = await postJson(binding, WALLET_RUNTIME_OP_PATHS_V1.executeSignedDelegate, input);
      const result = parseWalletRuntimeExecuteSignedDelegateResponse(body);
      if (!result) throw new Error('Wallet runtime returned an invalid signed delegate result');
      return result;
    },
    async getRelayerAccount(): Promise<{ accountId: string; publicKey: string }> {
      const body = await postJson(binding, WALLET_RUNTIME_OP_PATHS_V1.relayerAccount, {});
      const result = parseWalletRuntimeRelayerAccount(body);
      if (!result) throw new Error('Wallet runtime returned an invalid relayer account');
      return result;
    },
    async getWalletIdentities(
      input: WalletRuntimeWalletIdentityRequest,
    ): Promise<WalletRuntimeWalletIdentitiesResult> {
      const body = await postJson(binding, WALLET_RUNTIME_OP_PATHS_V1.walletIdentities, input);
      const result = parseWalletRuntimeWalletIdentitiesResult(body);
      if (!result) throw new Error('Wallet runtime returned invalid wallet identities');
      return result;
    },
  };
}
