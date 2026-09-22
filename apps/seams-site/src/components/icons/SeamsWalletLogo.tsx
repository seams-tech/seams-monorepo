import React from 'react';
import { SEAMS_BRAND_ASSETS } from '@/context/seamsBranding';

export default function SeamsWalletLogo({ size = 24 }: { size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        width: size,
        height: size,
        backgroundColor: 'currentColor',
        mask: `url("${SEAMS_BRAND_ASSETS.walletMark}") center / contain no-repeat`,
      }}
    />
  );
}
