import React from 'react';
import { SEAMS_BRAND_ASSETS } from '@/context/seamsBranding';

export type SeamsWordmarkProps = {
  /** Height of the complete wordmark and symbol. */
  height?: number;
  className?: string;
  style?: React.CSSProperties;
};

const SeamsWordmark: React.FC<SeamsWordmarkProps> = ({ height = 28, className, style }) => (
  <span
    role="img"
    aria-label="Seams"
    className={['seams-wordmark', className].filter(Boolean).join(' ')}
    style={{
      height,
      width: (height * 1428) / 285,
      maskImage: `url("${SEAMS_BRAND_ASSETS.wordmark}")`,
      ...style,
    }}
  />
);

export default SeamsWordmark;
