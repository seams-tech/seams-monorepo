import './transaction-mocks.css';

export type TransactionMockExample = 'transfer' | 'evm' | 'near';

export interface TransactionMockProps {
  example: TransactionMockExample;
  theme?: 'light' | 'dark';
  variant?: 'modal' | 'drawer';
  stage?: 'review' | 'signing' | 'broadcasting' | 'confirmed';
}

const titles: Record<TransactionMockExample, string> = {
  transfer: 'ETH transfer',
  evm: 'EVM function call',
  near: 'NEAR function call',
};

/** Interactive UI snapshot. The embedded document blocks all network connections. */
export function TransactionMock({ example, theme = 'light', variant = 'modal', stage = 'review' }: TransactionMockProps) {
  return (
    <iframe
      className="site-transaction-mock"
      title={`${titles[example]} — simulated interactive demo`}
      src={`/transaction-mocks/index.html?example=${example}&theme=${theme}&variant=${variant}&stage=${stage}`}
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
    />
  );
}

export function EthTransferMock() {
  return <TransactionMock example="transfer" />;
}

export function EvmFunctionCallMock() {
  return <TransactionMock example="evm" />;
}

export function NearFunctionCallMock() {
  return <TransactionMock example="near" />;
}
