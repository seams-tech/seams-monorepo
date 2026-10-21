import React from 'react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { H2Footer } from '@/components/h2/sections';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import '@/styles/h2.css';
import './styles.css';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

type Product = {
  title: string;
  copy: string;
  to: string;
  cta: string;
  field: GrainFieldName;
};

type Principle = {
  title: string;
  copy: string;
};

type CompanyLink = {
  title: string;
  copy: string;
  to: string;
  external: boolean;
};

const products: readonly Product[] = [
  {
    title: 'Embedded Wallet',
    copy: 'Non-custodial wallets that open with a passkey. Keys are split between the user’s device and your infrastructure, so neither side can sign alone.',
    to: '/wallet',
    cta: 'Explore Embedded Wallet',
    field: 'sky-sand',
  },
  {
    title: 'Ecommerce Agents',
    copy: 'Scoped credentials for AI agents and staff, with limits, approvals, and an audit trail on every action.',
    to: '/ecommerce',
    cta: 'Explore Ecommerce Agents',
    field: 'azure-coral',
  },
  {
    title: 'Policy and audit',
    copy: 'Approvals, budgets, and revocation run before anything is signed. Each decision is logged with who acted and why.',
    to: '/docs/concepts/policy/mandates',
    cta: 'Read about policy',
    field: 'slate-amber',
  },
];

const principles: readonly Principle[] = [
  {
    title: 'Users keep their keys',
    copy: 'No single party can sign alone. Exporting a key needs fresh approval from its owner.',
  },
  {
    title: 'Policy runs first',
    copy: 'Limits, approvals, and session checks run before any credential can act.',
  },
  {
    title: 'One small SDK',
    copy: 'Sign-in, wallets, and delegated access come from one SDK, so teams do not rebuild key infrastructure.',
  },
];

const links: readonly CompanyLink[] = [
  { title: 'Contact', copy: 'Talk to the team', to: CONTACT_LINK_TARGET, external: false },
  {
    title: 'Documentation',
    copy: 'Concepts, guides, and the SDK reference',
    to: '/docs/concepts/',
    external: false,
  },
  {
    title: 'GitHub',
    copy: 'Our open-source repositories',
    to: 'https://github.com/seams-tech',
    external: true,
  },
  { title: 'X', copy: 'News and releases', to: 'https://x.com/lowerarchy', external: true },
];

function SiteLink({
  to,
  external,
  className,
  children,
}: {
  to: string;
  external: boolean;
  className: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  if (external) {
    return (
      <a className={className} href={to} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  const props = linkProps(to);
  return (
    <a className={className} href={props.href} onClick={props.onClick}>
      {children}
    </a>
  );
}

function ProductCard({ product }: { product: Product }): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const props = linkProps(product.to);
  // The gradient shows on hover or focus; it only animates while shown.
  const [lit, setLit] = React.useState(false);
  return (
    <a
      className="company-card"
      href={props.href}
      onClick={props.onClick}
      onPointerEnter={() => setLit(true)}
      onPointerLeave={() => setLit(false)}
      onFocus={() => setLit(true)}
      onBlur={() => setLit(false)}
    >
      <GrainField field={product.field} className="company-card__gradient" playing={lit} />
      <h3 className="company-card__title">{product.title}</h3>
      <p className="company-card__copy">{product.copy}</p>
      <span className="company-card__cta">
        {product.cta}
        <ArrowRightAnim size={12} />
      </span>
    </a>
  );
}

export function CompanyPage(): React.JSX.Element {
  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <main aria-labelledby="company-title">
          <header className="h2-hero-simple h2-hero-simple--sage h2-hero-simple--grain">
            <div className="h2-shell">
              <GrainField field="sky-sand" flow={1.6} />
              <h1 id="company-title" className="h2-display h2-hero-simple__title">
                We build the account layer for commerce.
              </h1>
              <p className="h2-hero-simple__sub">
                Seams makes passkey wallets for users and scoped credentials for AI agents. Policy
                checks every action before it runs.
              </p>
              <div className="h2-hero-simple__ctas">
                <SiteLink
                  to={CONTACT_LINK_TARGET}
                  external={false}
                  className="h2-btn h2-btn--primary h2-btn--lg"
                >
                  Contact us
                </SiteLink>
                <SiteLink
                  to="/docs/concepts/"
                  external={false}
                  className="h2-btn h2-btn--outline h2-btn--lg"
                >
                  Read the docs
                </SiteLink>
              </div>
            </div>
          </header>

          <section
            className="h2-section h2-section--compact h2-rule"
            aria-labelledby="company-products-title"
          >
            <div className="h2-shell">
              <div className="h2-split-head">
                <h2 id="company-products-title" className="h2-display">
                  Two products on one policy engine
                </h2>
                <p className="h2-split-head__copy">
                  Both products use the same keys, credentials, and policy checks.
                </p>
              </div>
              <div className="company-cards">
                {products.map((product) => (
                  <ProductCard key={product.title} product={product} />
                ))}
              </div>
            </div>
          </section>

          <section
            className="h2-section h2-section--compact h2-rule"
            aria-labelledby="company-principles-title"
          >
            <div className="h2-shell company-split">
              <div>
                <h2 id="company-principles-title" className="h2-display company-split__title">
                  Three rules behind every feature
                </h2>
              </div>
              <ol className="company-principles">
                {principles.map((principle) => (
                  <li key={principle.title}>
                    <h3>{principle.title}</h3>
                    <p>{principle.copy}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section
            className="h2-section h2-section--compact h2-rule"
            aria-labelledby="company-details-title"
          >
            <div className="h2-shell company-split">
              <div>
                <h2 id="company-details-title" className="h2-display company-split__title">
                  Seams Technologies KK
                </h2>
                <p className="company-split__copy">
                  Tokyo, Japan. Copyright © {new Date().getFullYear()}. All rights reserved.
                </p>
              </div>
              <ul className="company-links">
                {links.map((link) => (
                  <li key={link.title}>
                    <SiteLink to={link.to} external={link.external} className="company-link">
                      <span>
                        <strong>{link.title}</strong>
                        <small>{link.copy}</small>
                      </span>
                      <ArrowRightAnim size={13} />
                    </SiteLink>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </main>
        <H2Footer />
      </div>
    </div>
  );
}

export default CompanyPage;
