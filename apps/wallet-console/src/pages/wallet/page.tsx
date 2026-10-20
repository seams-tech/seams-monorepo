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
import '@/styles/h2.css';
import { ComponentShowcase } from './ComponentShowcase';

export function WalletPage(): React.JSX.Element {
  return (
    <div className="h2-page h2-page--wallet">
      <NavbarCompact />
      <div className="h2-col">
        <H2DemoHero
          authDefaultModeWhenNoDetectedAccount="register"
          title={<>Wallets that open with a passkey</>}
          sub={
            <>
              Users sign in with Face ID or a fingerprint. No seed phrases, only they control their
              funds, and email gets them back in. Try it here.
            </>
          }
        />
        <H2Networks />
        <ComponentShowcase />
        <H2Start />
        <H2Security />
        <H2Cta />
        <H2Footer faq="wallet" />
      </div>
    </div>
  );
}

export default WalletPage;
