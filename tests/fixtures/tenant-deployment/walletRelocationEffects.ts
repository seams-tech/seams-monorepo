import { WalletRelocationReceipt } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationEffects } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationCoordinator';
import { relocationFailure } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';

// Synthetic participant responses exercise the production coordinator and D1 journal.
export class RelocationFixtureEffects implements WalletRelocationEffects {
  constructor(
    private readonly receipt: unknown,
    private readonly failure: unknown,
  ) {}

  async freeze(): ReturnType<WalletRelocationEffects['freeze']> {
    if (this.failure !== null) return { state: 'failed', code: relocationFailure(this.failure) };
    if (this.receipt === null) return { state: 'pending' };
    return {
      state: 'frozen',
      receipt: WalletRelocationReceipt.parse(this.receipt, 'source_fence'),
    };
  }
  async transfer(): ReturnType<WalletRelocationEffects['transfer']> {
    if (this.failure !== null) return { state: 'failed', code: relocationFailure(this.failure) };
    if (this.receipt === null) return { state: 'pending' };
    return {
      state: 'verified',
      receipt: WalletRelocationReceipt.parse(this.receipt, 'destination_verification'),
    };
  }
  async activate() {
    return this.result('destination_activation');
  }
  async cleanup(): ReturnType<WalletRelocationEffects['cleanup']> {
    if (this.failure !== null) return { state: 'failed', code: relocationFailure(this.failure) };
    if (this.receipt === null) return { state: 'pending' };
    return { state: 'cleaned', receipt: WalletRelocationReceipt.parse(this.receipt, 'source_cleanup') };
  }

  private result<Kind extends WalletRelocationReceipt['kind']>(kind: Kind) {
    if (this.failure !== null) return { ok: false as const, code: relocationFailure(this.failure) };
    return { ok: true as const, receipt: WalletRelocationReceipt.parse(this.receipt, kind) };
  }
}
