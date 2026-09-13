import React from 'react';
import { AuthMenuMode } from '@seams/wallet/react';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import {
  H2DemoHero,
  H2Faq,
  H2Footer,
  H2Networks,
  H2Security,
  H2Start,
} from '@/components/h2/sections';
import '@/styles/h2.css';

export function WalletPage(): React.JSX.Element {
  return (
    <div className="h2-page h2-page--wallet">
      <NavbarCompact />
      <div className="h2-col">
        <H2DemoHero
          authDefaultModeWhenNoDetectedAccount={AuthMenuMode.Register}
          title={<>Non&#8209;custodial wallets, opened with a passkey</>}
          sub={
            <>
              Embed wallets your users can never lose: keys split between their device and your
              infrastructure, recovery through email and linked devices, and every action signed.
              Register right here to see it work.
            </>
          }
        />
        <H2Networks />
        <H2Security />
        <H2Start />
        <H2Faq audience="wallet" />
        <H2Footer />
      </div>
    </div>
  );
}

export default WalletPage;
