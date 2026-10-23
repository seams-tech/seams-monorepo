import React from 'react';
import { Bot, Fingerprint } from 'lucide-react';

/* The front page hero's live card: agent actions arrive at the top, show
   "Checking" for a beat, and land on the policy verdict that let them run,
   held them for the owner, or blocked them. It shows the hero's claim that
   policy checks every action before it runs. */

type PolicyVerdict = 'allowed' | 'held' | 'blocked';

type PolicyAction = {
  agent: string;
  action: string;
  rule: string;
  verdict: PolicyVerdict;
};

const policyActions: readonly PolicyAction[] = [
  {
    agent: 'Support agent',
    action: 'Refund ¥8,200 · order #8790',
    rule: 'Refunds up to ¥10,000',
    verdict: 'allowed',
  },
  {
    agent: 'Pricing agent',
    action: 'Discount 18% · autumn sale',
    rule: 'Over 10% needs the owner',
    verdict: 'held',
  },
  {
    agent: 'Ops agent',
    action: 'Pay supplier 2,400 USDC',
    rule: 'Known payees only',
    verdict: 'allowed',
  },
  {
    agent: 'Unknown script',
    action: 'Export customer list',
    rule: 'No bulk data export',
    verdict: 'blocked',
  },
  {
    agent: 'Restock agent',
    action: 'Order 120 units · SKU-0412',
    rule: 'Daily spend up to ¥200,000',
    verdict: 'allowed',
  },
  {
    agent: 'Support agent',
    action: 'Change shipping address',
    rule: 'Customer passkey required',
    verdict: 'held',
  },
];

const verdictView: Record<PolicyVerdict, { label: string; chip: string }> = {
  allowed: { label: 'Allowed', chip: 'h2-chip--green' },
  held: { label: 'Held', chip: 'h2-chip--amber' },
  blocked: { label: 'Blocked', chip: 'h2-chip--red' },
};

/* the CSS clips the list to this many rows */
const VISIBLE_ROWS = 4;
const TICK_MS = 2800;

function useFeedTick(): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return tick;
}

export function PolicyFeed(): React.JSX.Element {
  const tick = useFeedTick();
  const count = policyActions.length;
  /* the newest action sits on top. One extra row renders under the clipped
     list: each tick remounts the list a step up and slides it down, so the
     new row enters at the top and the oldest one leaves at the bottom */
  const rows = Array.from({ length: VISIBLE_ROWS + 1 }, (_, i) => {
    const arrival = tick + VISIBLE_ROWS - i;
    return { arrival, item: policyActions[arrival % count] };
  });

  return (
    <div
      className="h2-policy"
      role="img"
      aria-label="Policy check feed: each agent action is allowed, held for the owner, or blocked before it runs"
    >
      <div className="h2-policy__head">
        <span className="h2-policy__title">
          <span className="h2-policy__live" aria-hidden />
          Policy check
        </span>
        <span className="h2-policy__count">1,284 actions today</span>
      </div>
      <div className="h2-policy__window">
        <ul key={tick} className={`h2-policy__list${tick > 0 ? ' is-moving' : ''}`} aria-hidden>
          {rows.map(({ arrival, item }, i) => {
            const verdict = verdictView[item.verdict];
            const fresh = i === 0 && tick > 0;
            return (
              <li key={arrival} className={`h2-policy__row${fresh ? ' is-new' : ''}`}>
                <span className="h2-policy__agent">
                  <Bot aria-hidden />
                </span>
                <span className="h2-policy__main">
                  <span className="h2-policy__action">{item.action}</span>
                  <small>
                    {item.agent} · {item.rule}
                  </small>
                </span>
                <span className="h2-policy__verdict">
                  {fresh ? (
                    <span className="h2-chip h2-chip--plain h2-policy__checking">Checking</span>
                  ) : null}
                  <span className={`h2-chip ${verdict.chip} h2-policy__result`}>
                    {verdict.label}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="h2-policy__foot">
        <Fingerprint aria-hidden />
        Held actions wait for the owner's passkey
      </div>
    </div>
  );
}
