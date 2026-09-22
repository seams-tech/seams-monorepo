import React from 'react';
import { SeamsQRSvg } from './seamsQRSvg';

export function BrowserWithQR(props: {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { width = '100%', height = '100%', className, style } = props;
  // Default dimensions for viewBox
  const vbW = 600;
  const vbH = 380;
  const windowFill = 'var(--seams-colors-surface2)';
  const barFill = 'var(--seams-colors-surface, rgba(0,0,0,0.04))';
  const controlRed = '#FF5F56';
  const controlYellow = '#FFBD2E';
  const controlGreen = '#27C93F';
  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      width={width}
      height={height}
      className={className}
      style={style}
      aria-label="Desktop browser showing QR code"
    >
      {/* Window background */}
      <rect
        x={0.5}
        y={0.5}
        width={vbW - 1}
        height={vbH - 1}
        rx={16}
        fill={windowFill}
        stroke={'none'}
      />
      {/* Title / address bar */}
      <rect x={16} y={16} width={vbW - 32} height={44} rx={10} fill={barFill} />
      {/* Window controls */}
      <circle cx={36} cy={38} r={7} fill={controlRed} />
      <circle cx={58} cy={38} r={7} fill={controlYellow} />
      <circle cx={80} cy={38} r={7} fill={controlGreen} />
      {/* Address pill */}
      <rect x={120} y={26} width={vbW - 152} height={24} rx={6} fill="rgba(255,255,255,0.7)" />

      {/* Content area */}
      <g transform="translate(0, 72)">
        <rect
          x={16}
          y={0}
          width={vbW - 32}
          height={vbH - 88}
          rx={12}
          fill="rgba(0,0,0,0.02)"
          stroke={'none'}
        />
        {/* QR container: re-use SeamsQRSvg scaled to 160px and positioned */}
        <g transform="translate(220, 66)">
          <SeamsQRSvg width={160} height={160} />
        </g>
      </g>
    </svg>
  );
}

export default BrowserWithQR;
