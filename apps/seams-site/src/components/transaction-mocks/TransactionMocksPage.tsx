import { EthTransferMock, EvmFunctionCallMock, NearFunctionCallMock } from './TransactionMock';

export function TransactionMocksPage() {
  return (
    <main className="site-transaction-mocks-gallery">
      <h1>Transaction demos</h1>
      <p>Interactive mock components. No wallet connection, authentication, or transactions.</p>
      <div className="site-transaction-mocks-grid">
        <section><h2>ETH transfer</h2><EthTransferMock /></section>
        <section><h2>EVM function call</h2><EvmFunctionCallMock /></section>
        <section><h2>NEAR function call</h2><NearFunctionCallMock /></section>
      </div>
    </main>
  );
}
