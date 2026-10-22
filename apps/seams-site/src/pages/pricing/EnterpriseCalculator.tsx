import { useTranslation, useLocale } from '@/i18n/browser';
import type { Translate } from '@/i18n/catalog';
import { formatPrice, PRICING_USD } from '@/i18n/pricing';
import React from 'react';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

/* Published rates from docs/wallet-saas/pricing.md. Enterprise prices are
   negotiated, so the estimate applies only its published floors. */
const FREE_USERS = 300;
const FREE_SIGNATURES = 30_000;
const GROWTH_INCLUDED_USERS = 5_000;
const POOL_PER_USER = 300;
const DAYS_PER_MONTH = 30;

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
    base: PRICING_USD.growthBase,
    users: userCost,
    overageSignatures,
    overage,
    total: PRICING_USD.growthBase + userCost + overage,
  };
}

const wholeNumber = new Intl.NumberFormat('en-US');
function signaturePoolNote(t: Translate, free: boolean, overage: number): string {
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
  const t = useTranslation();
  const locale = useLocale();
  const compact = new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    notation: 'compact',
  });
  const { linkProps } = useSiteRouter();
  const contactProps = linkProps(CONTACT_LINK_TARGET);
  const [userStep, setUserStep] = React.useState(USER_STEPS.indexOf(100_000));
  const [perDay, setPerDay] = React.useState(10);
  const usersId = React.useId();
  const perDayId = React.useId();
  const users = USER_STEPS[userStep];
  const growth = estimate(
    users,
    perDay,
    PRICING_USD.growthPerUser,
    PRICING_USD.growthPer1000Signatures,
  );
  const enterprise = estimate(
    users,
    perDay,
    PRICING_USD.enterprisePerUser,
    PRICING_USD.enterprisePer1000Signatures,
  );
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
              {t('monthlySignatures').replace('{count}', wholeNumber.format(growth.signatures))}{' '}
              {signaturePoolNote(t, free, growth.overageSignatures)}
            </p>
          </div>
          <div className="pricing-calc__result" aria-live="polite">
            <dl className="pricing-calc__lines">
              <div>
                <dt>{t('growthBase')}</dt>
                <dd>{formatPrice(locale, growth.base)}</dd>
              </div>
              <div>
                <dt>{t('usersLine')}</dt>
                <dd>{formatPrice(locale, growth.users)}</dd>
              </div>
              <div>
                <dt>{t('signaturesLine')}</dt>
                <dd>{formatPrice(locale, growth.overage)}</dd>
              </div>
            </dl>
            <p className="pricing-calc__total">
              <span>{free ? t('freeMonthly') : t('growthMonthly')}</span>
              <strong>{formatPrice(locale, growth.total)}</strong>
            </p>
            {free ? null : (
              <p className="pricing-calc__total pricing-calc__total--enterprise">
                <span>{t('enterpriseFrom')}</span>
                <strong>{formatPrice(locale, enterprise.total)}</strong>
              </p>
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
