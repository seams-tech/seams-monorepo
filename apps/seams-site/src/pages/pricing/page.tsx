import React from 'react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { H2Faq, H2Footer } from '@/components/h2/sections';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { EnterpriseCalculator } from './EnterpriseCalculator';
import '@/styles/h2.css';
import './styles.css';

type PlanId = 'free' | 'growth' | 'enterprise';

type Plan = {
  id: PlanId;
  field: GrainFieldName;
  name: string;
  price: string;
  unit: string;
  summary: string;
  features: readonly string[];
  cta: { label: string; to: string; primary: boolean };
};

const plans: readonly Plan[] = [
  {
    id: 'free',
    field: 'sky-sand',
    name: 'Free',
    price: '$0',
    unit: 'per month',
    summary: 'For launches and small apps, in production.',
    features: [
      'Up to 300 monthly active users',
      '30,000 signatures a month',
      'Passkeys, Email OTP, and split-key wallets',
      'One free plan per organization',
      'Card required after 30 days, not charged',
    ],
    cta: { label: 'Start building', to: '/docs/concepts/', primary: false },
  },
  {
    id: 'growth',
    field: 'azure-coral',
    name: 'Growth',
    price: '$99',
    unit: 'per month',
    summary: 'For apps with a growing user base.',
    features: [
      '5,000 monthly active users included',
      '$0.004 per active user above 5,000',
      '300 signatures per user each month, pooled',
      '$0.05 per 1,000 signatures above the pool',
    ],
    cta: { label: 'Start building', to: '/docs/concepts/', primary: true },
  },
  {
    id: 'enterprise',
    field: 'mauve-ember',
    name: 'Enterprise',
    price: 'Custom',
    unit: 'committed volume',
    summary: 'For large apps and merchant fleets.',
    features: [
      'Volume pricing on committed usage',
      'From $0.003 per active user above 5,000',
      'Signatures from $0.03 per 1,000',
      'Rollout planning with our team',
    ],
    cta: { label: 'Contact sales', to: '/contact/', primary: false },
  },
];

// At 10 signatures per user per day, every app stays inside its pool.
const examples: readonly { users: string; price: string }[] = [
  { users: '1,000', price: '$99' },
  { users: '10,000', price: '$119' },
  { users: '100,000', price: '$479' },
  { users: '1,000,000', price: '$4,079' },
];

function PlanCard({ plan, selected }: { plan: Plan; selected: boolean }): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const ctaProps = linkProps(plan.cta.to);

  return (
    <article
      id={plan.id}
      className={selected ? 'pricing-plan pricing-plan--selected' : 'pricing-plan'}
      aria-labelledby={`pricing-plan-${plan.id}`}
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
      <a
        className={
          plan.cta.primary
            ? 'h2-btn h2-btn--primary pricing-plan__cta'
            : 'h2-btn h2-btn--outline pricing-plan__cta'
        }
        href={ctaProps.href}
        onClick={ctaProps.onClick}
      >
        {plan.cta.label}
      </a>
    </article>
  );
}

function scrollToPricingAnchor(): void {
  const id = window.location.hash.slice(1);
  if (id) document.getElementById(id)?.scrollIntoView();
}

function readSelectedPlanId(): PlanId {
  switch (window.location.hash) {
    case '#free':
      return 'free';
    case '#enterprise':
      return 'enterprise';
    default:
      return 'growth';
  }
}

function unsubscribeFromPricingNavigation(listener: () => void): void {
  window.removeEventListener('site:navigate', listener);
  window.removeEventListener('popstate', listener);
  window.removeEventListener('hashchange', listener);
}

function subscribeToPricingNavigation(listener: () => void): () => void {
  window.addEventListener('site:navigate', listener);
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  return unsubscribeFromPricingNavigation.bind(null, listener);
}

function startPricingAnchorScroll(): () => void {
  scrollToPricingAnchor();
  return subscribeToPricingNavigation(scrollToPricingAnchor);
}

export function PricingPage(): React.JSX.Element {
  React.useEffect(startPricingAnchorScroll, []);
  const selectedPlanId = React.useSyncExternalStore(
    subscribeToPricingNavigation,
    readSelectedPlanId,
  );
  const { linkProps } = useSiteRouter();
  const startProps = linkProps('/docs/concepts/');
  const contactProps = linkProps('/contact/');

  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <main aria-labelledby="pricing-title">
          <header className="h2-hero-simple h2-hero-simple--sage h2-hero-simple--grain">
            <div className="h2-shell">
              <GrainField field="teal-peach" flow={1.6} />
              <h1 id="pricing-title" className="h2-display h2-hero-simple__title">
                Free to start. Pay per active user.
              </h1>
              <p className="h2-hero-simple__sub">
                The first 300 users are free, and development is always free. As you grow, you pay
                per active user, with signing included.
              </p>
              <div className="h2-hero-simple__ctas">
                <a
                  className="h2-btn h2-btn--primary h2-btn--lg"
                  href={startProps.href}
                  onClick={startProps.onClick}
                >
                  Start building
                </a>
                <a
                  className="h2-btn h2-btn--outline h2-btn--lg"
                  href={contactProps.href}
                  onClick={contactProps.onClick}
                >
                  Contact sales
                </a>
              </div>
            </div>
          </header>

          <section
            className="h2-section h2-section--compact h2-rule"
            aria-labelledby="pricing-example-title"
          >
            <div className="h2-shell pricing-example-layout">
              <div className="pricing-example-head">
                <p className="h2-kicker">At scale</p>
                <h2 id="pricing-example-title" className="h2-display">
                  What a month costs as you grow
                </h2>
                <p className="pricing-example-head__copy">
                  An app where each user signs 10 times a day. Every user includes 300 signatures a
                  month, so you pay for active users only.
                </p>
              </div>
              <table className="pricing-example">
                <thead>
                  <tr>
                    <th scope="col">Monthly active users</th>
                    <th scope="col">Price per month</th>
                  </tr>
                </thead>
                <tbody>
                  {examples.map((row) => (
                    <tr key={row.users}>
                      <td>{row.users}</td>
                      <td>{row.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section
            className="h2-section h2-section--compact h2-rule"
            aria-labelledby="pricing-plans-title"
          >
            <div className="h2-shell">
              <div className="h2-split-head">
                <p className="h2-kicker">Plans</p>
                <h2 id="pricing-plans-title" className="h2-display">
                  One price per active user
                </h2>
                <p className="h2-split-head__copy">
                  Every plan has the full SDK: passkeys, split-key wallets, policy checks, and the
                  audit log. Development environments are free on every plan. Gas and chain fees
                  pass through at cost.
                </p>
              </div>
              <div className="pricing-plans">
                {plans.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} selected={plan.id === selectedPlanId} />
                ))}
              </div>
              <p className="pricing-note">
                Growth prices are fixed for 12 months from sign-up. After that, they may change with
                our own hosting costs.
              </p>
            </div>
          </section>

          <EnterpriseCalculator />

          <H2Faq audience="pricing" />
        </main>
        <H2Footer />
      </div>
    </div>
  );
}

export default PricingPage;
