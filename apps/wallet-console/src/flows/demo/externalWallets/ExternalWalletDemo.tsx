import { Component, type FormEvent } from 'react';
import { ActionType } from '@seams/wallet';
import { ExternalNearController } from '@seams/wallet/external-near';
import { ExternalNearWalletPicker } from '@seams/wallet/react/external-near';
import { ExternalEvmController, type ExternalEvmChain } from '@seams/wallet/external-evm';
import { ExternalEvmWalletPicker } from '@seams/wallet/react/external-evm';
import { FRONTEND_CONFIG } from '@/config';
import { DEMO_CONTRACT_ID } from '@/shared/types';

function configuredEvmChains(): ExternalEvmChain[] {
  const chains: ExternalEvmChain[] = [];
  for (const chain of FRONTEND_CONFIG.chains) {
    if ('chainId' in chain && typeof chain.chainId === 'number' && chain.rpcUrl) {
      chains.push({ chainId: chain.chainId, name: chain.network, rpcUrl: chain.rpcUrl });
    }
  }
  return chains;
}

export default class ExternalWalletDemo extends Component<
  {},
  { network: 'near' | 'evm'; message: string }
> {
  state: { network: 'near' | 'evm'; message: string } = { network: 'near', message: '' };
  private near = new ExternalNearController(
    FRONTEND_CONFIG.nearNetwork,
    FRONTEND_CONFIG.nearRpcUrl,
  );
  private evm = new ExternalEvmController(configuredEvmChains());
  private unsubscribeNear: (() => void) | null = null;
  private unsubscribeEvm: (() => void) | null = null;
  componentDidMount(): void {
    this.unsubscribeNear = this.near.subscribe(this.refresh);
    this.unsubscribeEvm = this.evm.subscribe(this.refresh);
    this.evm.start(window);
  }
  componentWillUnmount(): void {
    this.unsubscribeNear?.();
    this.unsubscribeEvm?.();
    this.near.disconnect();
    this.evm.dispose();
  }
  private refresh = (): void => {
    this.forceUpdate();
  };
  private selectNear = (): void => {
    this.evm.disconnect();
    this.setState({ network: 'near', message: '' });
  };
  private selectEvm = (): void => {
    this.near.disconnect();
    this.setState({ network: 'evm', message: '' });
  };
  private send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (this.state.network === 'near') {
      const connection = this.near.getSnapshot().connection;
      const greeting = form.get('greeting');
      if (connection.kind !== 'connected' || typeof greeting !== 'string' || !greeting.trim())
        return;
      this.setState({ message: 'Approve in Meteor.' });
      const result = await this.near.sendTransaction(connection, {
        receiverId: DEMO_CONTRACT_ID,
        actions: [
          {
            type: ActionType.FunctionCall,
            methodName: 'set_greeting',
            args: { greeting },
            gas: '10000000000000',
            deposit: '0',
          },
        ],
      });
      if (!result.ok) {
        this.setState({ message: result.message });
        return;
      }
      const outcome = await this.near.checkOutcome(result.value);
      this.setState({
        message: `${result.value.accountId}: ${outcome.kind}. Transaction: ${result.value.hash}`,
      });
    } else {
      const connection = this.evm.getSnapshot().connection;
      const to = form.get('recipient');
      const amount = form.get('amount');
      if (
        connection.kind !== 'connected' ||
        typeof to !== 'string' ||
        typeof amount !== 'string' ||
        !/^\d+$/.test(amount)
      )
        return;
      this.setState({ message: `Approve in ${connection.wallet.name}.` });
      const result = await this.evm.sendTransaction(connection, {
        to,
        data: '0x',
        value: BigInt(amount),
        gas: { kind: 'wallet' },
        fees: { kind: 'wallet' },
      });
      if (!result.ok) {
        this.setState({ message: result.message });
        return;
      }
      const receipt = await this.evm.waitForReceipt(result.value);
      this.setState({
        message: `${result.value.account}: ${receipt.kind}. Transaction: ${result.value.hash}`,
      });
    }
  };
  render() {
    const near = this.near.getSnapshot();
    const evm = this.evm.getSnapshot();
    const selected = this.state.network === 'near' ? near : evm;
    return (
      <section aria-label="Connect an existing wallet">
        <button
          type="button"
          aria-pressed={this.state.network === 'near'}
          onClick={this.selectNear}
        >
          NEAR
        </button>
        <button type="button" aria-pressed={this.state.network === 'evm'} onClick={this.selectEvm}>
          EVM
        </button>
        {this.state.network === 'near' ? (
          <ExternalNearWalletPicker controller={this.near} />
        ) : (
          <ExternalEvmWalletPicker controller={this.evm} snapshot={evm} />
        )}
        <form onSubmit={this.send}>
          {this.state.network === 'near' ? (
            <label>
              Greeting <input name="greeting" required />
            </label>
          ) : (
            <>
              <label>
                Recipient <input name="recipient" required />
              </label>
              <label>
                Native token amount in wei{' '}
                <input name="amount" inputMode="numeric" pattern="[0-9]+" required />
              </label>
            </>
          )}
          <button
            type="submit"
            disabled={selected.busy || selected.connection.kind !== 'connected'}
          >
            Approve transaction in wallet
          </button>
        </form>
        <p role="status">{this.state.message}</p>
      </section>
    );
  }
}
