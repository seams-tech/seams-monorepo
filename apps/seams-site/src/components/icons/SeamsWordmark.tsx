import React from 'react';
import { SEAMS_BRAND_ASSETS } from '@/context/seamsBranding';

export type SeamsWordmarkProps = {
  /** Height of the complete wordmark and symbol. */
  height?: number;
  variant?: 'company' | 'wallet';
  className?: string;
  style?: React.CSSProperties;
};

const SeamsWordmark: React.FC<SeamsWordmarkProps> = ({
  height = 28,
  variant = 'company',
  className,
  style,
}) => (
  <span
    role="img"
    aria-label={variant === 'wallet' ? 'Seams Wallet' : 'Seams'}
    className={['seams-wordmark', className].filter(Boolean).join(' ')}
    style={{
      height,
      width: height * (variant === 'wallet' ? 1565 / 256 : 1428 / 285),
      maskImage: `url("${variant === 'wallet' ? SEAMS_BRAND_ASSETS.walletWordmark : SEAMS_BRAND_ASSETS.wordmark}")`,
      ...style,
    }}
  />
);

export default SeamsWordmark;
