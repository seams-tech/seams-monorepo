import { useTranslation } from '@/i18n/browser';
import type { Translate } from '@/i18n/catalog';
import React from 'react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { H2Footer } from '@/components/h2/sections';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { startSiteAnchorScroll } from '@/app/router/siteRouting';
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

function getProducts(t: Translate): readonly Product[] {
  return [
    {
      title: 'Satyr',
      copy: t('satyrCopy'),
      to: '/ecommerce',
      cta: t('exploreSatyr'),
      field: 'azure-coral',
    },
    {
      title: 'BakeryOS',
      copy: t('bakeryCopy'),
      to: '/ecommerce#bakeryos',
      cta: t('exploreBakery'),
      field: 'apricot-beam',
    },
    {
      title: 'Seams Wallet',
      copy: t('walletCopy'),
      to: '/wallet',
      cta: t('exploreWallet'),
      field: 'teal-peach',
    },
  ];
}

function getPrinciples(t: Translate): readonly Principle[] {
  return [
    {
      title: t('ownerDecides'),
      copy: t('ownerDecidesCopy'),
    },
    {
      title: t('everyReceipt'),
      copy: t('everyReceiptCopy'),
    },
    {
      title: t('secretsOut'),
      copy: t('secretsOutCopy'),
    },
  ];
}

function getLinks(t: Translate): readonly CompanyLink[] {
  return [
    { title: t('contact'), copy: t('talkTeam'), to: CONTACT_LINK_TARGET, external: false },
    {
      title: t('documentation'),
      copy: t('referenceCopy'),
      to: '/docs/concepts/',
      external: false,
    },
    {
      title: 'GitHub',
      copy: t('openSource'),
      to: 'https://github.com/seams-tech',
      external: true,
    },
    { title: 'X', copy: t('news'), to: 'https://x.com/lowerarchy', external: true },
  ];
}

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
  return (
    <a className="company-card" href={props.href} onClick={props.onClick}>
      <GrainField field={product.field} />
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
  React.useEffect(startSiteAnchorScroll, []);
  const t = useTranslation();
  const products = getProducts(t);
  const principles = getPrinciples(t);
  const links = getLinks(t);
  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <main aria-labelledby="company-title">
          <header className="h2-hero-simple company-hero">
            <div className="h2-shell">
              <h1 id="company-title" className="h2-display h2-hero-simple__title">
                {t('companyTitle')}
              </h1>
              <p className="h2-hero-simple__sub">{t('companyDescription')}</p>
              <div className="h2-hero-simple__ctas">
                <SiteLink
                  to={CONTACT_LINK_TARGET}
                  external={false}
                  className="h2-btn h2-btn--primary h2-btn--lg"
                >
                  {t('contactUs')}
                  <ArrowRightAnim size={12} />
                </SiteLink>
                <SiteLink
                  to="/ecommerce"
                  external={false}
                  className="h2-btn h2-btn--outline h2-btn--lg"
                >
                  {t('exploreSatyr')}
                  <ArrowRightAnim size={12} />
                </SiteLink>
              </div>
            </div>
          </header>

          <section
            id="blog"
            className="h2-section h2-section--compact h2-rule company-products"
            aria-labelledby="company-products-title"
          >
            <div className="h2-shell">
              <div className="h2-split-head">
                <h2 id="company-products-title" className="h2-display">
                  {t('productsTitle')}
                </h2>
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
                  {t('principlesTitle')}
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

          <section className="h2-cta h2-cta--banner h2-rule" aria-labelledby="company-banner-title">
            <div className="h2-shell h2-cta__banner company-banner">
              <GrainField field="teal-peach" flow={1.6} />
              <div>
                <h2 id="company-banner-title" className="h2-display h2-cta__title">
                  {t('talkTeam')}
                </h2>
                <p className="h2-cta__sub">{t('teamReply')}</p>
              </div>
              <div className="h2-cta__actions">
                <SiteLink
                  to={CONTACT_LINK_TARGET}
                  external={false}
                  className="h2-btn h2-btn--primary"
                >
                  {t('contactUs')}
                  <ArrowRightAnim size={12} />
                </SiteLink>
              </div>
            </div>
          </section>

          <section
            id="company"
            className="h2-section h2-section--compact h2-rule"
            aria-labelledby="company-details-title"
          >
            <div className="h2-shell company-split company-details">
              <div>
                <h2 id="company-details-title" className="h2-display company-split__title">
                  Seams Technologies KK
                </h2>
                <p className="company-split__copy">
                  {t('companyLocation').replace('{year}', String(new Date().getFullYear()))}
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
