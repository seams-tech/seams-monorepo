import './embeddedFocus';
import '@seams/wallet/react/styles';
import './showcase.css';
import './checkout.css';
import React from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { TransactionReviewControls } from '@seams/wallet/react';
import { CheckoutSession } from './checkoutSession';
import { market, sides, type Side } from './checkoutMarket';
import { schedulePlayback } from './playbackClock';
import { configureModalBackdrop } from './modalBackdrop';

configureModalBackdrop();

/* A sample prediction-market checkout: the host app's own review panel hands
   off to the SDK's wallet approval in one resizing modal. The market stays
   live behind the receipt toast, so picking a side there shows the page is
   still usable. */

type Quote = {
  side: Side;
  expiresAtMs: number;
};

const quoteLifetimeSeconds = 90;
const quoteUrgentSeconds = 15;

function Checkout(): React.JSX.Element {
  const [side, setSide] = React.useState<Side>('Yes');
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [outcome, setOutcome] = React.useState('');
  const finish = React.useCallback((message: string) => {
    setQuote(null);
    setOutcome(message);
  }, []);
  const refresh = React.useCallback((quoteSide: Side) => {
    setQuote({ side: quoteSide, expiresAtMs: Date.now() + quoteLifetimeSeconds * 1000 });
  }, []);
  return (
    <section className="checkout-market" aria-labelledby="checkout-market-title">
      <span className="checkout-lot">{market.lot}</span>
      <h1 id="checkout-market-title">{market.question}</h1>
      <div className="checkout-odds" role="radiogroup" aria-label="Outcome">
        {sides.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="checkout-side"
              value={option}
              checked={side === option}
              onChange={() => setSide(option)}
            />
            {option} <strong>{market.outcomes[option].odds}</strong>
          </label>
        ))}
      </div>
      <button
        className="checkout-buy"
        type="button"
        disabled={quote !== null}
        onClick={() => {
          setOutcome('');
          refresh(side);
        }}
      >
        <span>Buy {side}</span>
        <span aria-hidden="true">→</span>
      </button>
      {outcome ? (
        <p className="checkout-outcome" role="status">
          {outcome}
        </p>
      ) : null}
      {quote ? <CheckoutReview quote={quote} onFinish={finish} onRefresh={refresh} /> : null}
    </section>
  );
}

function CheckoutReview({
  quote,
  onFinish,
  onRefresh,
}: {
  quote: Quote;
  onFinish: (message: string) => void;
  onRefresh: (side: Side) => void;
}): React.JSX.Element | null {
  const [session, setSession] = React.useState<CheckoutSession | null>(null);
  React.useEffect(() => {
    const next = new CheckoutSession(quote.side, onFinish);
    setSession(next);
    return next.dispose;
  }, [quote.side, onFinish]);
  if (!session) return null;
  return createPortal(
    <section className="seams-transaction-review-content checkout-review" ref={session.observe}>
      <div className="checkout-review-heading">
        <span className="checkout-eyebrow">{market.sale}</span>
      </div>
      <h2>Review purchase</h2>
      <PurchaseSummary
        key={quote.expiresAtMs}
        quote={quote}
        onRefresh={onRefresh}
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
  onRefresh,
  controls,
}: {
  quote: Quote;
  onRefresh: (side: Side) => void;
  controls: TransactionReviewControls;
}): React.JSX.Element {
  const seconds = useSecondsUntil(quote.expiresAtMs);
  const outcome = market.outcomes[quote.side];
  return (
    <>
      <div className="checkout-summary-card">
        <div className="checkout-summary-claim">
          <span className="checkout-side">
            {quote.side} · {outcome.odds}
          </span>
          <span>{outcome.claim}</span>
        </div>
        <div className="checkout-summary-row checkout-summary-values">
          <div>
            <span className="checkout-summary-label">You pay</span>
            <strong className="checkout-amount">{market.pay}</strong>
            <span className="checkout-summary-label">units</span>
          </div>
          <div>
            <span className="checkout-summary-label">Payout if {quote.side}</span>
            <strong className="checkout-amount">{outcome.positions}</strong>
            <span className="checkout-summary-label">units</span>
          </div>
        </div>
      </div>
      <dl className="checkout-details">
        <dt>Price</dt>
        <dd>{outcome.price} units per position</dd>
        <dt>Minimum payout</dt>
        <dd>{outcome.minimumPositions} units</dd>
        <dt>Trading fee</dt>
        <dd>
          {market.fee} units <span className="checkout-included">(included)</span>
        </dd>
        <dt>Network fee</dt>
        <dd>Free</dd>
      </dl>
      <p className="checkout-note">
        Each position pays 1 unit if {quote.side} wins. If the price moves, you get at least the
        minimum payout.
      </p>
      <div className="checkout-expiry" data-urgent={seconds <= quoteUrgentSeconds || undefined}>
        <div>
          <span>{seconds === 0 ? 'Quote expired' : 'Quote expires in'}</span>
          {seconds === 0 ? (
            <button
              className="checkout-refresh"
              type="button"
              onClick={() => onRefresh(quote.side)}
            >
              Refresh quote
            </button>
          ) : (
            <strong>{seconds}s</strong>
          )}
        </div>
        <progress aria-label="Quote time remaining" max={quoteLifetimeSeconds} value={seconds} />
      </div>
      <div className="checkout-actions">
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
    </>
  );
}

function scheduleCountdown(
  seconds: number,
  setSeconds: React.Dispatch<React.SetStateAction<number>>,
): (() => void) | undefined {
  if (seconds === 0) return;
  return schedulePlayback(setSeconds.bind(null, seconds - 1), 1000);
}

function useSecondsUntil(deadlineMs: number): number {
  const [seconds, setSeconds] = React.useState(secondsUntil.bind(null, deadlineMs));
  React.useEffect(scheduleCountdown.bind(null, seconds, setSeconds), [seconds]);
  return seconds;
}

function secondsUntil(deadlineMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
}

createRoot(document.getElementById('root') as HTMLElement).render(<Checkout />);
