import { t } from '@/marketing/i18n/browser';
import React from 'react';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import {
  H2Cta,
  H2DemoHero,
  H2Footer,
  H2Networks,
  H2Security,
  H2Start,
} from '@/components/h2/sections';
import { startSiteAnchorScroll } from '@/app/router/siteRouting';
import '@/styles/h2.css';
import { ComponentShowcase } from './ComponentShowcase';

export function WalletPage(): React.JSX.Element {
  React.useEffect(startSiteAnchorScroll, []);
  return (
    <div className="h2-page h2-page--wallet">
      <NavbarCompact />
      <div className="h2-col">
        <H2DemoHero
          authDefaultModeWhenNoDetectedAccount="register"
          title={t('heroTitle')}
          sub={t('heroDescription')}
        />
        <H2Networks />
        <ComponentShowcase />
        <H2Start />
        <H2Security />
        <H2Cta />
        <H2Footer />
      </div>
    </div>
  );
}

export default WalletPage;
