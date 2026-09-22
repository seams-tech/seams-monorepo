import { expect, test } from '@playwright/test';
import { loadWalletHostConfig } from '../../apps/wallet-console/src/frontendConfig';

const productionEnvironment = {
  BASE_URL: '/',
  MODE: 'production',
  DEV: false,
  PROD: true,
  SSR: false,
  VITE_SITE_ID: 'production',
  VITE_TESTNET_NEAR_RPC_URL: 'https://rpc.testnet.example',
  VITE_TESTNET_NEAR_EXPLORER: 'https://explorer.testnet.example',
  VITE_MAINNET_NEAR_RPC_URL: 'https://rpc.mainnet.example',
  VITE_MAINNET_NEAR_EXPLORER: 'https://explorer.mainnet.example',
  VITE_TESTNET_ROUTER_AB_NORMAL_SIGNING_WORKER_ID: 'testnet-worker',
  VITE_MAINNET_ROUTER_AB_NORMAL_SIGNING_WORKER_ID: 'mainnet-worker',
} satisfies ImportMetaEnv;

class DiscoveryRequests {
  readonly urls: string[] = [];

  fetch(input: RequestInfo | URL): Promise<Response> {
    this.urls.push(String(input));
    return Promise.resolve(new Response('{}', { status: 503 }));
  }
}

test('hosted settings discovers only the tenant belonging to the current wallet origin', async () => {
  const requests = new DiscoveryRequests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = requests.fetch.bind(requests);
  try {
    await expect(
      loadWalletHostConfig(productionEnvironment, 'https://sign.seams.sh'),
    ).rejects.toThrow('Tenant deployment is unavailable');
    expect(requests.urls).toEqual([
      'https://api.wallet.seams.sh/.well-known/seams-tenant-deployment.json',
    ]);
    requests.urls.length = 0;
    await expect(
      loadWalletHostConfig(productionEnvironment, 'https://test.sign.seams.sh'),
    ).rejects.toThrow('Tenant deployment is unavailable');
    expect(requests.urls).toEqual([
      'https://test.api.wallet.seams.sh/.well-known/seams-tenant-deployment.json',
    ]);
    requests.urls.length = 0;
    await expect(
      loadWalletHostConfig(productionEnvironment, 'https://unknown.example'),
    ).rejects.toThrow('This origin is not configured as a hosted wallet');
    expect(requests.urls).toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
