import React from 'react';
import { EcosystemField } from '@/components/h2/EcosystemField';
import { InkDrawing } from '@/components/h2/ink/InkScene';
import { goatScene, keyScene, stalkScene, whiskGoatScene, wireScene } from '@/components/h2/ink/scenes';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { ProductTour } from '@/components/h2/ProductTour';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import {
  H2Cta,
  H2Duo,
  H2Ecosystem,
  H2Footer,
  H2Pillars,
  H2WalletBand,
} from '@/components/h2/sections';
import '@/styles/h2.css';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

/* Umbrella front page, led by Satyr: a simple headline on paper, where a baby
   goat flies a croissant kite, then the product tour (Satyr and Satyr Kitchen, with
   overlapping Portal screens), the shop-to-oven split, the suite, and one band
   for Seams Wallet. Every tour screen is a real Portal screen. */

/* ---------- hero: headline + product tour ---------- */

function HomeHeroCurrent(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const contactProps = linkProps(CONTACT_LINK_TARGET);
  const satyrProps = linkProps('/ecommerce');
  const bakeryProps = linkProps('/ecommerce#kitchen');

  return (
    <>
      <header
        className="h2-hero-simple h2-hero-simple--panel h2-hero-simple--ink"
        aria-labelledby="h2-home-title"
      >
        <div className="h2-shell">
          <InkDrawing scene={goatScene} className="h2-ink--hero" drawn />
          <div className="h2-hero-simple__copy">
            <h1 id="h2-home-title" className="h2-display h2-hero-simple__title">
              <span>Ecommerce on autopilot.</span>{' '}
              <span className="h2-hero-simple__title-muted">For cafés and pâtisseries.</span>
            </h1>
            <p className="h2-hero-simple__sub">
              Satyr agents run your shop, inbox and bake plan. Changes that matter wait for your
              approval.
            </p>
            <div className="h2-hero-simple__ctas">
              <a
                className="h2-btn h2-btn--primary h2-btn--lg"
                href={contactProps.href}
                onClick={contactProps.onClick}
              >
                Talk to us
              </a>
              <a
                className="h2-btn h2-btn--outline h2-btn--lg"
                href={satyrProps.href}
                onClick={satyrProps.onClick}
              >
                Explore Satyr
              </a>
            </div>
          </div>
        </div>
      </header>

      <section className="h2-rule h2-tour-band" aria-label="Product tour">
        <ProductTour links={{ satyr: satyrProps, kitchen: bakeryProps }} />
      </section>
    </>
  );
}

export function HomePage(): React.JSX.Element {
  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <HomeHeroCurrent />
        <H2Duo />
        <H2Ecosystem
          drawing={<InkDrawing scene={wireScene} className="h2-ink--banner" />}
          tools={<EcosystemField />}
        />
        <H2Pillars drawing={<InkDrawing scene={stalkScene} className="h2-ink--banner" />} />
        <H2WalletBand drawing={<InkDrawing scene={keyScene} className="h2-ink--banner" />} />
        <H2Cta
          audience="home"
          drawing={<InkDrawing scene={whiskGoatScene} className="h2-ink--banner" />}
        />
        <H2Footer faq="home" />
      </div>
    </div>
  );
}
