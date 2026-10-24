import React from 'react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { FieldBanner, H2Footer } from '@/components/h2/sections';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { startSiteAnchorScroll, subscribeToSiteNavigation } from '@/app/router/siteRouting';
import type { MessageKey } from './catalog';
import { EnterpriseCalculator } from './EnterpriseCalculator';
import { estimate, lowestSelfServePlan } from './estimate';
import { locale, t } from './i18n';
import { CONTACT_SALES_TARGET, planSignupHref } from './planSignup';
import { PlanSignupDialog, type SignupOffer } from './PlanSignupDialog';
import { formatPrice } from './prices';
import '@/styles/h2.css';
import './styles.css';

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

function getPlans(): readonly Plan[] {
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
      field: 'onyx-dusk',
      name: 'Enterprise',
      price: t('custom'),
      unit: t('committedVolume'),
      summary: t('enterpriseSummary'),
      features: [t('volumePricing'), t('enterpriseUsers'), t('enterpriseSignatures'), t('rollout')],
      cta: { label: t('contactSales'), to: CONTACT_SALES_TARGET },
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
function planTeasers(): Record<PlanId, string> {
  return {
    free: t('freeTeaser'),
    growth: t('growthTeaser'),
    pro: t('proTeaser'),
    enterprise: t('enterpriseTeaser'),
  };
}

/* A self-serve card opens the Console sign-in in a dialog on this page. A click with a
   modifier key keeps the link, which opens the full sign-in page. */
function usePlanCardLink(
  plan: Plan,
  onSignup: (offer: SignupOffer) => void,
): { href: string; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void } {
  const { linkProps } = useSiteRouter();
  const ctaProps = linkProps(plan.cta.to);
  if (plan.id === 'enterprise') return ctaProps;
  const offer: SignupOffer = {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    unit: plan.unit,
    field: plan.field,
  };
  return {
    href: plan.cta.to,
    onClick: (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      onSignup(offer);
    },
  };
}

function BannerPlanCard({
  plan,
  onSignup,
}: {
  plan: Plan;
  onSignup: (offer: SignupOffer) => void;
}): React.JSX.Element {
  const ctaProps = usePlanCardLink(plan, onSignup);
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
      <span className="pricing-banner__card-teaser">{planTeasers()[plan.id]}</span>
      <span className="pricing-banner__card-cta">
        {plan.cta.label}
        <ArrowRightAnim size={12} />
      </span>
    </a>
  );
}

/* Closing call to action: the SDK pitch with one card per plan. */
function PlanBanner({
  plans,
  onSignup,
}: {
  plans: readonly Plan[];
  onSignup: (offer: SignupOffer) => void;
}): React.JSX.Element {
  return (
    <>
      <section
        className="h2-section h2-section--banner h2-rule"
        aria-labelledby="pricing-banner-title"
      >
        <FieldBanner field="teal-peach">
          <div>
            <h2 id="pricing-banner-title" className="h2-display h2-banner__title">
              {t('buildSdk')}
            </h2>
            <p className="h2-banner__sub">{t('bannerCopy')}</p>
          </div>
        </FieldBanner>
      </section>
      <section
        className="h2-section h2-section--compact h2-rule pricing-banner-plans"
        aria-label={t('startPlan')}
      >
        <div className="h2-shell">
          <div className="pricing-banner__cards">
            {plans.map((plan) => (
              <BannerPlanCard key={plan.id} plan={plan} onSignup={onSignup} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/* Self-serve plans are cards in a row; Enterprise is a band below them. */
function PlanCard({
  plan,
  selected,
  onSignup,
}: {
  plan: Plan;
  selected: boolean;
  onSignup: (offer: SignupOffer) => void;
}): React.JSX.Element {
  const ctaProps = usePlanCardLink(plan, onSignup);
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

const FAQ: readonly { q: MessageKey; a: MessageKey }[] = [
  { q: 'faqUserQ', a: 'faqUserA' },
  { q: 'faqPoolQ', a: 'faqPoolA' },
  { q: 'faqDevQ', a: 'faqDevA' },
  { q: 'faqGasQ', a: 'faqGasA' },
  { q: 'faqGrowthQ', a: 'faqGrowthA' },
  { q: 'faqCardQ', a: 'faqCardA' },
  { q: 'faqOneQ', a: 'faqOneA' },
];

function PricingFaq(): React.JSX.Element {
  return (
    <section className="h2-section h2-rule" aria-labelledby="pricing-faq-title">
      <div className="h2-shell">
        <div className="h2-faq">
          <h2 id="pricing-faq-title" className="h2-display h2-faq__title">
            {t('faqTitle')}
          </h2>
          <div className="h2-faq__list">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{t(item.q)}</summary>
                <p>{t(item.a)}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function PricingPage(): React.JSX.Element {
  const plans = getPlans();
  React.useEffect(startSiteAnchorScroll, []);
  const selectedPlanId = React.useSyncExternalStore(subscribeToSiteNavigation, readSelectedPlanId);
  const [signupOffer, setSignupOffer] = React.useState<SignupOffer | null>(null);
  const closeSignup = React.useCallback(() => setSignupOffer(null), []);

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
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    selected={plan.id === selectedPlanId}
                    onSignup={setSignupOffer}
                  />
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

          <PlanBanner plans={plans} onSignup={setSignupOffer} />

          <PricingFaq />
        </main>
        <H2Footer faq={false} />
      </div>
      <PlanSignupDialog offer={signupOffer} onClose={closeSignup} />
    </div>
  );
}

export default PricingPage;
