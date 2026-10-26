import { Component, type FormEvent } from 'react';
import { ActionType } from '@seams/wallet';
import {
  ExternalNearController,
  nearWalletName,
  type ExternalNearSubmission,
} from '@seams/wallet/external-near';
import { ExternalNearWalletPicker } from '@seams/wallet/react/external-near';
import {
  ExternalEvmController,
  type ExternalEvmChain,
  type ExternalEvmSubmission,
} from '@seams/wallet/external-evm';
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

type Observation =
  | { kind: 'none' }
  | {
      kind: 'near';
      submission: ExternalNearSubmission;
      status: 'checking' | 'unresolved' | 'confirmed' | 'failed';
    }
  | {
      kind: 'evm';
      submission: ExternalEvmSubmission;
      status: 'checking' | 'unresolved' | 'confirmed' | 'reverted';
    };
type RequestState = 'idle' | 'awaiting_wallet' | 'submission_unknown';
type DemoState = {
  network: 'near' | 'evm';
  message: string;
  observation: Observation;
  request: RequestState;
};

export default class ExternalWalletDemo extends Component<{ active: boolean }, DemoState> {
  state: DemoState = {
    network: 'near',
    message: '',
    observation: { kind: 'none' },
    request: 'idle',
  };
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
  componentDidUpdate(previous: { active: boolean }): void {
    if (previous.active && !this.props.active) {
      this.near.disconnect();
      this.evm.disconnect();
    }
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
    if (
      !this.props.active ||
      this.state.request !== 'idle' ||
      (this.state.observation.kind !== 'none' && this.state.observation.status === 'checking')
    )
      return;
    const form = new FormData(event.currentTarget);
    if (this.state.network === 'near') {
      const connection = this.near.getSnapshot().connection;
      const greeting = form.get('greeting');
      if (connection.kind !== 'connected' || typeof greeting !== 'string' || !greeting.trim())
        return;
      this.setState({
        message: `Approve in ${nearWalletName(connection.wallet)}.`,
        request: 'awaiting_wallet',
        observation: { kind: 'none' },
      });
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
        this.setState({
          message: result.message,
          request: result.code === 'submission_unknown' ? 'submission_unknown' : 'idle',
        });
        return;
      }
      this.setState(
        {
          request: 'idle',
          observation: { kind: 'near', submission: result.value, status: 'unresolved' },
        },
        this.recheck,
      );
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
      this.setState({
        message: `Approve in ${connection.wallet.name}.`,
        request: 'awaiting_wallet',
        observation: { kind: 'none' },
      });
      const result = await this.evm.sendTransaction(connection, {
        to,
        data: '0x',
        value: BigInt(amount),
        gas: { kind: 'wallet' },
        fees: { kind: 'wallet' },
      });
      if (!result.ok) {
        this.setState({
          message: result.message,
          request: result.code === 'submission_unknown' ? 'submission_unknown' : 'idle',
        });
        return;
      }
      this.setState(
        {
          request: 'idle',
          observation: { kind: 'evm', submission: result.value, status: 'unresolved' },
        },
        this.recheck,
      );
    }
  };
  private acknowledgeUnknown = (): void => {
    this.setState({
      request: 'idle',
      message: 'Check the original transaction before preparing another request.',
    });
  };
  private recheck = async (): Promise<void> => {
    const observation = this.state.observation;
    if (observation.kind === 'none' || observation.status === 'checking') return;
    switch (observation.kind) {
      case 'near': {
        this.setState({
          observation: { kind: 'near', submission: observation.submission, status: 'checking' },
        });
        const result = await this.near.checkOutcome(observation.submission);
        this.setState({
          observation: { kind: 'near', submission: observation.submission, status: result.kind },
          message: `${observation.submission.accountId}: ${result.kind}. Transaction: ${observation.submission.hash}`,
        });
        return;
      }
      case 'evm': {
        this.setState({
          observation: { kind: 'evm', submission: observation.submission, status: 'checking' },
        });
        const result = await this.evm.waitForReceipt(observation.submission);
        this.setState({
          observation: { kind: 'evm', submission: observation.submission, status: result.kind },
          message: `${observation.submission.account}: ${result.kind}. Transaction: ${observation.submission.hash}`,
        });
        return;
      }
      default:
        return assertNever(observation);
    }
  };
  render() {
    const near = this.near.getSnapshot();
    const evm = this.evm.getSnapshot();
    const locked =
      this.state.request !== 'idle' ||
      (this.state.observation.kind !== 'none' && this.state.observation.status === 'checking');
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
            disabled={locked || selected.busy || selected.connection.kind !== 'connected'}
          >
            Approve transaction in wallet
          </button>
        </form>
        {this.state.observation.kind !== 'none' &&
          this.state.observation.status === 'unresolved' && (
            <button type="button" onClick={this.recheck}>
              Check transaction status
            </button>
          )}
        {this.state.request === 'submission_unknown' && (
          <button type="button" onClick={this.acknowledgeUnknown}>
            I checked wallet activity
          </button>
        )}
        <p role="status">{this.state.message}</p>
      </section>
    );
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown transaction source: ${value}`);
}
