import { useLocale, useTranslation } from '@/i18n/browser';
import type { Translate } from '@/i18n/catalog';
import { formatPrice } from '@/i18n/pricing';
import React from 'react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { H2Faq, H2Footer } from '@/components/h2/sections';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { startSiteAnchorScroll, subscribeToSiteNavigation } from '@/app/router/siteRouting';
import { EnterpriseCalculator } from './EnterpriseCalculator';
import { estimate, lowestSelfServePlan } from './estimate';
import { planSignupHref } from './planSignup';
import '@/styles/h2.css';
import './styles.css';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

type PlanId = 'free' | 'growth' | 'pro' | 'enterprise';

type Plan = {
  id: PlanId;
  field: GrainFieldName;
  name: string;
  price: string;
  unit: string;
  summary: string;
  features: readonly string[];
  cta: { label: string; to: string };
};

function getPlans(t: Translate): readonly Plan[] {
  return [
    {
      id: 'free',
      field: 'sky-sand',
      name: t('free'),
      price: t('freePrice'),
      unit: t('perMonth'),
      summary: t('freeSummary'),
      features: [
        t('freeUsers'),
        t('freeSignatures'),
        t('walletFeatures'),
        t('oneFree'),
        t('cardAfter30'),
      ],
      cta: { label: t('startBuilding'), to: planSignupHref('free') },
    },
    {
      id: 'growth',
      field: 'azure-coral',
      name: 'Growth',
      price: t('growthPrice'),
      unit: t('perMonth'),
      summary: t('growthSummary'),
      features: [
        t('growthUsers'),
        t('growthOverage'),
        t('pooledSignatures'),
        t('signatureOverage'),
      ],
      cta: { label: t('startBuilding'), to: planSignupHref('growth') },
    },
    {
      id: 'pro',
      field: 'vermilion-sky',
      name: 'Pro',
      price: t('proPrice'),
      unit: t('perMonth'),
      summary: t('proSummary'),
      features: [t('proUsers'), t('proOverage'), t('proSignatureOverage'), t('proSupport')],
      cta: { label: t('startBuilding'), to: planSignupHref('pro') },
    },
    {
      id: 'enterprise',
      field: 'onyx-slate',
      name: 'Enterprise',
      price: t('custom'),
      unit: t('committedVolume'),
      summary: t('enterpriseSummary'),
      features: [t('volumePricing'), t('enterpriseUsers'), t('enterpriseSignatures'), t('rollout')],
      cta: { label: t('contactSales'), to: CONTACT_LINK_TARGET },
    },
  ];
}

// At 10 signatures per user per day, every app stays inside its pool.
const EXAMPLE_PER_DAY = 10;
const EXAMPLE_USERS = [1_000, 10_000, 100_000, 1_000_000] as const;
const SELF_SERVE_NAMES = { growth: 'Growth', pro: 'Pro' } as const;
const examples = EXAMPLE_USERS.map((users) => {
  const plan = lowestSelfServePlan(users, EXAMPLE_PER_DAY);
  return {
    users: new Intl.NumberFormat('en-US').format(users),
    plan: SELF_SERVE_NAMES[plan],
    priceUsd: estimate(plan, users, EXAMPLE_PER_DAY).total,
  };
});

/* Short summaries for the closing banner's plan cards. */
function planTeasers(t: Translate): Record<PlanId, string> {
  return {
    free: t('freeTeaser'),
    growth: t('growthTeaser'),
    pro: t('proTeaser'),
    enterprise: t('enterpriseTeaser'),
  };
}

function BannerPlanCard({ plan }: { plan: Plan }): React.JSX.Element {
  const t = useTranslation();
  const { linkProps } = useSiteRouter();
  const ctaProps = linkProps(plan.cta.to);
  // The plan's gradient shows on hover or focus; it only animates while shown.
  const [lit, setLit] = React.useState(false);
  return (
    <a
      className={
        plan.id === 'enterprise'
          ? 'pricing-banner__card pricing-banner__card--enterprise'
          : 'pricing-banner__card'
      }
      href={ctaProps.href}
      onClick={ctaProps.onClick}
      onPointerEnter={() => setLit(true)}
      onPointerLeave={() => setLit(false)}
      onFocus={() => setLit(true)}
      onBlur={() => setLit(false)}
    >
      <GrainField field={plan.field} className="pricing-banner__card-gradient" playing={lit} />
      <span className="pricing-banner__card-name">{plan.name}</span>
      <span className="pricing-banner__card-price">
        <strong>{plan.price}</strong> {plan.id === 'enterprise' ? '' : plan.unit}
      </span>
      <span className="pricing-banner__card-teaser">{planTeasers(t)[plan.id]}</span>
      <span className="pricing-banner__card-cta">
        {plan.cta.label}
        <ArrowRightAnim size={12} />
      </span>
    </a>
  );
}

/* Closing call to action: the SDK pitch with one card per plan. */
function PlanBanner({ plans }: { plans: readonly Plan[] }): React.JSX.Element {
  const t = useTranslation();
  return (
    <>
      <section className="h2-cta h2-cta--banner h2-rule" aria-labelledby="pricing-banner-title">
        <div className="h2-shell h2-cta__banner">
          <GrainField field="teal-peach" flow={1.6} />
          <div>
            <h2 id="pricing-banner-title" className="h2-display h2-cta__title">
              {t('buildSdk')}
            </h2>
            <p className="h2-cta__sub">{t('bannerCopy')}</p>
          </div>
        </div>
      </section>
      <section
        className="h2-section h2-section--compact h2-rule pricing-banner-plans"
        aria-label={t('startPlan')}
      >
        <div className="h2-shell">
          <div className="pricing-banner__cards">
            {plans.map((plan) => (
              <BannerPlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/* Self-serve plans are cards in a row; Enterprise is a band below them. */
function PlanCard({ plan, selected }: { plan: Plan; selected: boolean }): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const ctaProps = linkProps(plan.cta.to);
  const className = [
    'pricing-plan',
    plan.id === 'enterprise' ? 'pricing-plan--enterprise' : null,
    selected ? 'pricing-plan--selected' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <a
      id={plan.id}
      className={className}
      href={ctaProps.href}
      onClick={ctaProps.onClick}
      aria-labelledby={`pricing-plan-${plan.id} pricing-plan-cta-${plan.id}`}
    >
      <GrainField field={plan.field} className="pricing-plan__gradient" />
      <h3 id={`pricing-plan-${plan.id}`} className="pricing-plan__name">
        {plan.name}
      </h3>
      <p className="pricing-plan__summary">{plan.summary}</p>
      <p className="pricing-plan__price">
        <strong>{plan.price}</strong>
        <span>{plan.unit}</span>
      </p>
      <ul className="pricing-plan__features">
        {plan.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <div id={`pricing-plan-cta-${plan.id}`} className="h2-btn h2-btn--primary pricing-plan__cta">
        {plan.cta.label}
        <ArrowRightAnim size={12} />
      </div>
    </a>
  );
}

function readSelectedPlanId(): PlanId {
  switch (window.location.hash) {
    case '#free':
      return 'free';
    case '#pro':
      return 'pro';
    case '#enterprise':
      return 'enterprise';
    default:
      return 'growth';
  }
}

export function PricingPage(): React.JSX.Element {
  const t = useTranslation();
  const locale = useLocale();
  const plans = getPlans(t);
  React.useEffect(startSiteAnchorScroll, []);
  const selectedPlanId = React.useSyncExternalStore(subscribeToSiteNavigation, readSelectedPlanId);

  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <main aria-labelledby="pricing-title">
          <header className="h2-hero-simple pricing-hero">
            <div className="h2-shell">
              <h1 id="pricing-title" className="h2-display h2-hero-simple__title">
                {t('pricingTitle')}
              </h1>
              <p className="h2-hero-simple__sub">{t('pricingDescription')}</p>
            </div>
          </header>

          <section
            className="h2-section h2-section--compact h2-rule pricing-plans-section"
            aria-label={t('plans')}
          >
            <div className="h2-shell">
              <div className="pricing-plans">
                {plans.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} selected={plan.id === selectedPlanId} />
                ))}
              </div>
              <div className="pricing-note">
                <p>{t('poolNote')}</p>
                <p>{t('sdkNote')}</p>
              </div>
            </div>
          </section>

          <section
            className="h2-section h2-section--compact h2-rule"
            aria-labelledby="pricing-example-title"
          >
            <div className="h2-shell pricing-example-layout">
              <div className="pricing-example-head">
                <h2 id="pricing-example-title" className="h2-display">
                  {t('exampleTitle')}
                </h2>
                <p className="pricing-example-head__copy">{t('exampleCopy')}</p>
              </div>
              <table className="pricing-example">
                <thead>
                  <tr>
                    <th scope="col">{t('monthlyUsers')}</th>
                    <th scope="col">{t('plan')}</th>
                    <th scope="col">{t('monthlyPrice')}</th>
                  </tr>
                </thead>
                <tbody>
                  {examples.map((row) => (
                    <tr key={row.users}>
                      <td>{row.users}</td>
                      <td>{row.plan}</td>
                      <td>{formatPrice(locale, row.priceUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <EnterpriseCalculator />

          <PlanBanner plans={plans} />

          <H2Faq audience="pricing" />
        </main>
        <H2Footer />
      </div>
    </div>
  );
}

export default PricingPage;
