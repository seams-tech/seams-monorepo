import React from 'react';
import { SEAMS_BRAND_ASSETS } from '@/context/seamsBranding';

export type SeamsLogoProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  size?: number | string;
};

const SeamsLogo: React.FC<SeamsLogoProps> = ({
  size = 36,
  className,
  alt = '',
  draggable = false,
  style,
  ...rest
}) => {
  const numericSize = typeof size === 'number' ? size : undefined;
  return (
    <img
      {...rest}
      src={SEAMS_BRAND_ASSETS.mark}
      alt={alt}
      width={numericSize}
      height={numericSize}
      draggable={draggable}
      className={['seams-logo-icon', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, ...style }}
      aria-hidden={alt ? rest['aria-hidden'] : true}
    />
  );
};

export default SeamsLogo;
