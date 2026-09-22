import { useState, type ChangeEvent } from 'react';
import { TransactionMock } from './TransactionMock';

function presentationValue(event: ChangeEvent<HTMLInputElement>): 'modal' | 'drawer' {
  return event.currentTarget.value === 'drawer' ? 'drawer' : 'modal';
}

export function TransactionMocksPage() {
  const [variant, setVariant] = useState<'modal' | 'drawer'>('modal');
  const [stage, setStage] = useState<'review' | 'signing' | 'broadcasting' | 'confirmed'>('signing');
  return (
    <main className="site-transaction-mocks-gallery">
      <h1>Transaction demos</h1>
      <p>Interactive mock components. No wallet connection, authentication, or transactions.</p>
      <fieldset className="site-transaction-mocks-view">
        <legend>Review presentation</legend>
        {(['modal', 'drawer'] as const).map((value) => (
          <label key={value}>
            <input type="radio" name="confirmation-view" value={value} checked={variant === value}
              onChange={(event) => setVariant(presentationValue(event))} />
            {value === 'modal' ? 'Modal' : 'Drawer'}
          </label>
        ))}
      </fieldset>
      <p>Receipts open as a modal. Continue in background minimizes them to a toast.</p>
      <label>Transaction stage{' '}
        <select value={stage} onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === 'review' || value === 'signing' || value === 'broadcasting' || value === 'confirmed') setStage(value);
        }}>
          <option value="review">Review</option>
          <option value="signing">Signing</option>
          <option value="broadcasting">Broadcasting</option>
          <option value="confirmed">Confirmed</option>
        </select>
      </label>
      <div className="site-transaction-mocks-grid">
        <section><h2>ETH transfer</h2><TransactionMock example="transfer" variant={variant} stage={stage} /></section>
        <section><h2>EVM function call</h2><TransactionMock example="evm" variant={variant} stage={stage} /></section>
        <section><h2>NEAR function call</h2><TransactionMock example="near" variant={variant} stage={stage} /></section>
      </div>
    </main>
  );
}
