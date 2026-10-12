import type {
  WalletRuntimeServiceBinding,
  WalletRuntimeWalletIdentitiesResult,
  WalletRuntimeWalletIdentityRequest,
} from '@seams/wallet-server/cloud-host';
import type { D1WalletHomeDirectory } from '../walletPlacement/d1';
import { WalletOwnershipKey, type WalletRegion } from '../walletPlacement/home';
import { createWalletRuntimeOpsClient } from './walletRuntimeOpsClient';

type WalletSelector = WalletRuntimeWalletIdentityRequest['wallets'][number];
type WalletIdentity = WalletRuntimeWalletIdentitiesResult['identities'][number];

export class RegionalWalletIdentities {
  constructor(
    private readonly namespace: string,
    private readonly directory: Pick<D1WalletHomeDirectory, 'find'>,
    private readonly runtimes: Readonly<Record<WalletRegion, WalletRuntimeServiceBinding>>,
  ) {}

  async read(
    input: WalletRuntimeWalletIdentityRequest,
  ): Promise<WalletRuntimeWalletIdentitiesResult> {
    const groups = new Map<WalletRegion, Map<string, WalletSelector>>();
    for (const wallet of input.wallets) {
      const assignment = await this.directory.find(
        WalletOwnershipKey.parse({
          namespace: this.namespace,
          organizationId: input.orgId,
          projectId: wallet.projectId,
          environmentId: wallet.envId,
          walletId: wallet.walletId,
        }),
      );
      if (!assignment || assignment.state !== 'established') {
        throw new Error('Wallet identity home is unavailable');
      }
      let group = groups.get(assignment.home.region);
      if (!group) {
        group = new Map();
        groups.set(assignment.home.region, group);
      }
      group.set(selectorKey(wallet), wallet);
    }

    const identities = new Map<string, WalletIdentity>();
    for (const [region, wallets] of groups) {
      const client = createWalletRuntimeOpsClient(this.runtimes[region]);
      const result = await client.getWalletIdentities({
        orgId: input.orgId,
        wallets: [...wallets.values()],
      });
      for (const identity of result.identities) {
        const key = selectorKey(identity);
        if (!wallets.has(key) || identities.has(key)) {
          throw new Error('Wallet runtime returned an unexpected or duplicate identity');
        }
        identities.set(key, identity);
      }
    }

    // The runtime omits wallets without both chain identities. Preserve that
    // contract while distinguishing missing placement from an incomplete wallet.
    const ordered: WalletIdentity[] = [];
    for (const wallet of input.wallets) {
      const identity = identities.get(selectorKey(wallet));
      if (identity) ordered.push(identity);
    }
    return { identities: ordered };
  }
}

function selectorKey(wallet: WalletSelector): string {
  return JSON.stringify([wallet.projectId, wallet.envId, wallet.walletId]);
}
