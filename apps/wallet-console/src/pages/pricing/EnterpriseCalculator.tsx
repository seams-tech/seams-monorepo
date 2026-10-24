import React from 'react';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import type { MessageKey } from './catalog';
import { estimate, FREE_USERS, lowestSelfServePlan, type SelfServePlanId } from './estimate';
import { locale, t } from './i18n';
import { CONTACT_SALES_TARGET } from './planSignup';
import { formatPrice } from './prices';

// A log-like scale from the Free plan's users: each slider step is one of these counts.
const USER_STEPS = [
  FREE_USERS,
  500,
  1_000,
  2_500,
  5_000,
  10_000,
  25_000,
  50_000,
  100_000,
  250_000,
  500_000,
  1_000_000,
  2_500_000,
  5_000_000,
  10_000_000,
] as const;
const MIN_PER_DAY = 1;
const MAX_PER_DAY = 50;

/* The price breakdown names the plan, its included users, and its rates. */
const SELF_SERVE_LABELS: Record<
  SelfServePlanId,
  Record<'base' | 'users' | 'signatures' | 'total', MessageKey>
> = {
  growth: {
    base: 'growthBase',
    users: 'usersLine',
    signatures: 'signaturesLine',
    total: 'growthMonthly',
  },
  pro: {
    base: 'proBaseLine',
    users: 'proUsersLine',
    signatures: 'proSignaturesLine',
    total: 'proMonthly',
  },
};

const wholeNumber = new Intl.NumberFormat('en-US');
function signaturePoolNote(free: boolean, overage: number): string {
  if (free) return t('insideFree');
  if (overage > 0) return t('abovePool').replace('{count}', wholeNumber.format(overage));
  return t('insidePool');
}

/* How much of the track the thumb has passed, for the filled part of the track. */
function fill(value: number, min: number, max: number): React.CSSProperties {
  return {
    '--pricing-range-fill': `${((value - min) / (max - min)) * 100}%`,
  } as React.CSSProperties;
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
  const compact = new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    notation: 'compact',
  });
  const { linkProps } = useSiteRouter();
  const contactProps = linkProps(CONTACT_SALES_TARGET);
  const [userStep, setUserStep] = React.useState(USER_STEPS.indexOf(100_000));
  const [perDay, setPerDay] = React.useState(10);
  const usersId = React.useId();
  const perDayId = React.useId();
  const users = USER_STEPS[userStep];
  const selfServe = {
    growth: estimate('growth', users, perDay),
    pro: estimate('pro', users, perDay),
  };
  const enterprise = estimate('enterprise', users, perDay);
  const lowestPlan = lowestSelfServePlan(users, perDay);
  const lowest = selfServe[lowestPlan];
  const labels = SELF_SERVE_LABELS[lowestPlan];
  const free = lowest.total === 0;

  return (
    <section
      id="calculator"
      className="h2-section h2-section--compact h2-rule pricing-calc-section"
      aria-labelledby="pricing-calculator-title"
    >
      <div className="h2-shell">
        <div className="h2-split-head">
          <h2 id="pricing-calculator-title" className="h2-display">
            {t('estimateTitle')}
          </h2>
          <p className="h2-split-head__copy">{t('estimateCopy')}</p>
        </div>
        <div className="pricing-calc">
          <div className="pricing-calc__inputs">
            <Range
              id={usersId}
              label={t('monthlyUsers')}
              value={userStep}
              display={wholeNumber.format(users)}
              min={0}
              max={USER_STEPS.length - 1}
              minLabel={compact.format(USER_STEPS[0])}
              maxLabel={compact.format(USER_STEPS[USER_STEPS.length - 1])}
              valueText={t('usersValue').replace('{count}', wholeNumber.format(users))}
              onChange={setUserStep}
            />
            <Range
              id={perDayId}
              label={t('signaturesPerDay')}
              value={perDay}
              display={String(perDay)}
              min={MIN_PER_DAY}
              max={MAX_PER_DAY}
              minLabel={String(MIN_PER_DAY)}
              maxLabel={String(MAX_PER_DAY)}
              valueText={t('signaturesValue').replace('{count}', String(perDay))}
              onChange={setPerDay}
            />
            <p className="pricing-calc__note">
              {t('monthlySignatures').replace('{count}', wholeNumber.format(lowest.signatures))}{' '}
              {signaturePoolNote(free, lowest.overageSignatures)}
            </p>
          </div>
          <div className="pricing-calc__result" aria-live="polite">
            <dl className="pricing-calc__lines">
              <div>
                <dt>{t(labels.base)}</dt>
                <dd>{formatPrice(locale, lowest.base)}</dd>
              </div>
              <div>
                <dt>{t(labels.users)}</dt>
                <dd>{formatPrice(locale, lowest.users)}</dd>
              </div>
              <div>
                <dt>{t(labels.signatures)}</dt>
                <dd>{formatPrice(locale, lowest.overage)}</dd>
              </div>
            </dl>
            {free ? (
              <p className="pricing-calc__total pricing-calc__total--lowest">
                <span>{t('freeMonthly')}</span>
                <strong>{formatPrice(locale, 0)}</strong>
              </p>
            ) : (
              <>
                {(['growth', 'pro'] as const).map((plan) => (
                  <p
                    key={plan}
                    className={
                      plan === lowestPlan
                        ? 'pricing-calc__total pricing-calc__total--lowest'
                        : 'pricing-calc__total pricing-calc__total--other'
                    }
                  >
                    <span>
                      {t(SELF_SERVE_LABELS[plan].total)}
                      {plan === lowestPlan ? (
                        <>
                          {' '}
                          <span className="pricing-calc__badge">{t('lowestSelfServe')}</span>
                        </>
                      ) : null}
                    </span>
                    <strong>{formatPrice(locale, selfServe[plan].total)}</strong>
                  </p>
                ))}
                <p className="pricing-calc__total pricing-calc__total--other">
                  <span>{t('enterpriseFrom')}</span>
                  <strong>{formatPrice(locale, enterprise.total)}</strong>
                </p>
              </>
            )}
            <p className="pricing-calc__fine">{t('enterpriseFine')}</p>
            <a
              className="h2-btn h2-btn--primary"
              href={contactProps.href}
              onClick={contactProps.onClick}
            >
              {t('contactSales')}
              <ArrowRightAnim size={12} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
