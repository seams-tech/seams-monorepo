import React from 'react';
import { SEAMS_BRAND_ASSETS } from './seamsBranding';

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
    style={{ display: 'inline-flex', alignItems: 'center', height, ...style }}
  >
    <span
      className="seams-wordmark__text"
      aria-hidden="true"
      style={{
        display: 'block',
        flex: '0 1 auto',
        width: (height * 1131) / 285,
        height,
        backgroundColor: 'currentColor',
        maskImage: `url("${SEAMS_BRAND_ASSETS.wordmark}")`,
        maskSize: `${(height * 1428) / 285}px ${height}px`,
        maskPosition: 'left center',
        maskRepeat: 'no-repeat',
      }}
    />
    <span
      className="seams-wordmark__mark"
      aria-hidden="true"
      style={{
        display: 'block',
        flex: '0 0 auto',
        width: (height * 298) / 285,
        height,
        backgroundColor: 'currentColor',
        maskImage: `url("${SEAMS_BRAND_ASSETS.mark}")`,
        maskSize: 'contain',
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
      }}
    />
  </span>
);

export default SeamsWordmark;
