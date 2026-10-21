import React from 'react';
import { GrainField } from '@seams-internal/grain-field';
import { useSiteRouter } from '@/app/router/useSiteRouter';

/* Published rates from docs/wallet-saas/pricing.md. Enterprise prices are
   negotiated, so the estimate applies only its published floors. */
const FREE_USERS = 300;
const FREE_SIGNATURES = 30_000;
const GROWTH_BASE = 99;
const GROWTH_INCLUDED_USERS = 5_000;
const GROWTH_PER_USER = 0.004;
const ENTERPRISE_PER_USER = 0.003;
const POOL_PER_USER = 300;
const GROWTH_PER_1000_SIGNATURES = 0.05;
const ENTERPRISE_PER_1000_SIGNATURES = 0.03;
const DAYS_PER_MONTH = 30;

// A log-like scale from the Free plan's users: each slider step is one of these counts.
const USER_STEPS = [
  FREE_USERS, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
  1_000_000, 2_500_000, 5_000_000, 10_000_000,
] as const;
const MIN_PER_DAY = 1;
const MAX_PER_DAY = 50;

type Estimate = {
  signatures: number;
  base: number;
  users: number;
  overageSignatures: number;
  overage: number;
  total: number;
};

function estimate(users: number, perDay: number, perUser: number, per1000: number): Estimate {
  const signatures = users * perDay * DAYS_PER_MONTH;
  if (users <= FREE_USERS && signatures <= FREE_SIGNATURES) {
    return { signatures, base: 0, users: 0, overageSignatures: 0, overage: 0, total: 0 };
  }
  const userCost = Math.max(0, users - GROWTH_INCLUDED_USERS) * perUser;
  const overageSignatures = Math.max(0, signatures - users * POOL_PER_USER);
  const overage = (overageSignatures / 1_000) * per1000;
  return {
    signatures,
    base: GROWTH_BASE,
    users: userCost,
    overageSignatures,
    overage,
    total: GROWTH_BASE + userCost + overage,
  };
}

const wholeNumber = new Intl.NumberFormat('en-US');
const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatDollars(value: number): string {
  return dollars.format(Math.round(value));
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact' });

/* How much of the track the thumb has passed, for the filled part of the track. */
function fill(value: number, min: number, max: number): React.CSSProperties {
  return { '--pricing-range-fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties;
}

function Range(props: {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly display: string;
  readonly min: number;
  readonly max: number;
  readonly minLabel: string;
  readonly maxLabel: string;
  readonly valueText: string;
  readonly onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <div className="pricing-calc__field">
      <label className="pricing-calc__label" htmlFor={props.id}>
        {props.label}
      </label>
      <output className="pricing-calc__value" htmlFor={props.id}>
        {props.display}
      </output>
      <input
        id={props.id}
        className="pricing-range"
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        style={fill(props.value, props.min, props.max)}
        aria-valuetext={props.valueText}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <span className="pricing-calc__scale" aria-hidden="true">
        <span>{props.minLabel}</span>
        <span>{props.maxLabel}</span>
      </span>
    </div>
  );
}

export function EnterpriseCalculator(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const contactProps = linkProps('/contact/');
  const [userStep, setUserStep] = React.useState(USER_STEPS.indexOf(100_000));
  const [perDay, setPerDay] = React.useState(10);
  const usersId = React.useId();
  const perDayId = React.useId();
  const users = USER_STEPS[userStep];
  const growth = estimate(users, perDay, GROWTH_PER_USER, GROWTH_PER_1000_SIGNATURES);
  const enterprise = estimate(users, perDay, ENTERPRISE_PER_USER, ENTERPRISE_PER_1000_SIGNATURES);
  const free = growth.total === 0;

  return (
    <section
      id="calculator"
      className="h2-section h2-section--compact h2-rule pricing-calc-section"
      aria-labelledby="pricing-calculator-title"
    >
      <div className="h2-shell">
        <div className="h2-split-head">
          <h2 id="pricing-calculator-title" className="h2-display">
            Estimate your monthly price
          </h2>
          <p className="h2-split-head__copy">
            Set your active users and how often each user signs. The estimate uses our published
            rates. Committed volume can lower it further.
          </p>
        </div>
        <div className="pricing-calc">
          <div className="pricing-calc__inputs">
            <Range
              id={usersId}
              label="Monthly active users"
              value={userStep}
              display={wholeNumber.format(users)}
              min={0}
              max={USER_STEPS.length - 1}
              minLabel={compact.format(USER_STEPS[0])}
              maxLabel={compact.format(USER_STEPS[USER_STEPS.length - 1])}
              valueText={`${wholeNumber.format(users)} users`}
              onChange={setUserStep}
            />
            <Range
              id={perDayId}
              label="Signatures per user per day"
              value={perDay}
              display={String(perDay)}
              min={MIN_PER_DAY}
              max={MAX_PER_DAY}
              minLabel={String(MIN_PER_DAY)}
              maxLabel={String(MAX_PER_DAY)}
              valueText={`${perDay} signatures per day`}
              onChange={setPerDay}
            />
            <p className="pricing-calc__note">
              {wholeNumber.format(growth.signatures)} signatures a month.{' '}
              {free
                ? 'Inside the Free plan: 300 users and 30,000 signatures a month.'
                : growth.overageSignatures > 0
                  ? `${wholeNumber.format(growth.overageSignatures)} are above the pool of 300 per user.`
                  : 'All of them are inside the pool of 300 per user.'}
            </p>
          </div>
          <div className="pricing-calc__result" aria-live="polite">
            <GrainField field="coral-tide" flow={1.6} />
            <dl className="pricing-calc__lines">
              <div>
                <dt>Growth base, 5,000 users included</dt>
                <dd>{formatDollars(growth.base)}</dd>
              </div>
              <div>
                <dt>Users above 5,000 at $0.004</dt>
                <dd>{formatDollars(growth.users)}</dd>
              </div>
              <div>
                <dt>Signatures above the pool at $0.05 per 1,000</dt>
                <dd>{formatDollars(growth.overage)}</dd>
              </div>
            </dl>
            <p className="pricing-calc__total">
              <span>{free ? 'Free plan, per month' : 'Growth, per month'}</span>
              <strong>{formatDollars(growth.total)}</strong>
            </p>
            {free ? null : (
              <p className="pricing-calc__total pricing-calc__total--enterprise">
                <span>Enterprise, from</span>
                <strong>{formatDollars(enterprise.total)}</strong>
              </p>
            )}
            <p className="pricing-calc__fine">
              Enterprise starts at $0.003 per active user above 5,000 and $0.03 per 1,000 signatures
              above the pool. Volume pricing on committed usage is quoted by our team.
            </p>
            <a
              className="h2-btn h2-btn--primary"
              href={contactProps.href}
              onClick={contactProps.onClick}
            >
              Contact sales
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
