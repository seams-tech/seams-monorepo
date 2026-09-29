import '@seams/wallet/react/styles';
import './showcase.css';
import './checkout.css';
import React from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { TransactionReviewControls } from '@seams/wallet/react';
import { CheckoutSession } from './checkoutSession';

/* A sample prediction-market checkout: the host app's own review panel hands
   off to the SDK's wallet approval in one resizing modal. */

type Quote = {
  pay: string;
  positions: string;
  minimumPositions: string;
  fee: string;
  expiresAtMs: number;
};

const quoteLifetimeSeconds = 90;

function freshQuote(): Quote {
  return {
    pay: '0.1',
    positions: '0.19333',
    minimumPositions: '0.191400',
    fee: '0.001',
    expiresAtMs: Date.now() + quoteLifetimeSeconds * 1000,
  };
}

function Checkout(): React.JSX.Element {
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [outcome, setOutcome] = React.useState('');
  const finish = React.useCallback((message: string) => {
    setQuote(null);
    setOutcome(message);
  }, []);
  return (
    <section className="checkout-market" aria-labelledby="checkout-market-title">
      <span className="checkout-lot">LOT 542 · OTSUKA LOTEC NO.7.5</span>
      <h1 id="checkout-market-title">Will it sell above its estimate?</h1>
      <div className="checkout-odds">
        <span>
          Yes <strong>52%</strong>
        </span>
        <span>
          No <strong>48%</strong>
        </span>
      </div>
      <button
        className="checkout-buy"
        type="button"
        onClick={() => {
          setOutcome('');
          setQuote(freshQuote());
        }}
      >
        <span>Buy Yes</span>
        <span aria-hidden="true">→</span>
      </button>
      <p className="checkout-outcome" role="status">
        {outcome || 'Sample data. Nothing is signed or sent.'}
      </p>
      {quote ? <CheckoutReview quote={quote} onFinish={finish} /> : null}
    </section>
  );
}

function CheckoutReview({
  quote,
  onFinish,
}: {
  quote: Quote;
  onFinish: (message: string) => void;
}): React.JSX.Element | null {
  const [session, setSession] = React.useState<CheckoutSession | null>(null);
  React.useEffect(() => {
    const next = new CheckoutSession(onFinish);
    setSession(next);
    return next.dispose;
  }, [onFinish]);
  if (!session) return null;
  return createPortal(
    <section className="seams-transaction-review-content checkout-review" ref={session.observe}>
      <div className="checkout-review-heading">
        <span>01 / Review order</span>
        <span className="checkout-badge">Sample data</span>
      </div>
      <h2>Review purchase</h2>
      <PurchaseSummary
        quote={quote}
        controls={{
          continueToWallet: session.continueToWallet,
          cancel: session.cancel,
          fail: session.fail,
        }}
      />
    </section>,
    session.slot,
  );
}

function PurchaseSummary({
  quote,
  controls,
}: {
  quote: Quote;
  controls: TransactionReviewControls;
}): React.JSX.Element {
  const seconds = useSecondsUntil(quote.expiresAtMs);
  return (
    <div className="checkout-summary">
      <div className="checkout-summary-card">
        <div className="checkout-summary-row">
          <span className="checkout-side">
            Buy Yes <span aria-hidden="true">↗</span>
          </span>
          <span className="checkout-summary-label">Prediction market</span>
        </div>
        <div className="checkout-summary-row checkout-summary-values">
          <div>
            <span className="checkout-summary-label">You pay</span>
            <strong className="checkout-pay">{quote.pay}</strong>
            <span className="checkout-summary-label">test units</span>
          </div>
          <div>
            <span className="checkout-summary-label">You receive</span>
            <strong className="checkout-positions">{quote.positions}</strong>
            <span className="checkout-summary-label">Yes positions</span>
          </div>
        </div>
      </div>
      <dl className="checkout-details">
        <dt>Minimum positions</dt>
        <dd>{quote.minimumPositions}</dd>
        <dt>
          Trading fee <span className="checkout-included">Included</span>
        </dt>
        <dd>{quote.fee} test units</dd>
        <dt>Network fee</dt>
        <dd>None</dd>
      </dl>
      <div className="checkout-expiry">
        <div>
          <span>{seconds === 0 ? 'Quote expired' : 'Quote expires in'}</span>
          <strong>{seconds}s</strong>
        </div>
        <progress aria-label="Quote time remaining" max={quoteLifetimeSeconds} value={seconds} />
      </div>
      <button
        className="checkout-confirm"
        type="button"
        disabled={seconds === 0}
        onClick={controls.continueToWallet}
      >
        <span>Confirm in wallet</span>
        <span aria-hidden="true">→</span>
      </button>
      <button className="checkout-cancel" type="button" onClick={controls.cancel}>
        Back to market
      </button>
    </div>
  );
}

function useSecondsUntil(deadlineMs: number): number {
  const [seconds, setSeconds] = React.useState(() => secondsUntil(deadlineMs));
  React.useEffect(() => {
    const timer = window.setInterval(() => setSeconds(secondsUntil(deadlineMs)), 1000);
    return () => window.clearInterval(timer);
  }, [deadlineMs]);
  return seconds;
}

function secondsUntil(deadlineMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
}

createRoot(document.getElementById('root') as HTMLElement).render(<Checkout />);
