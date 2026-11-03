import React from 'react';

export const SWATCH_COLOURS = {
  blush: '#f5cfc2',
  seaglass: '#cfddd9',
  lavender: '#e4dee9',
  clay: '#dcc3b8',
  gold: '#e4c07c',
  sky: '#c2d6de',
  peach: '#f8d6c5',
} as const satisfies Record<string, `#${string}`>;

export type SwatchColour = keyof typeof SWATCH_COLOURS;
type DryStroke = 1 | 2 | 3 | 4 | 5;
type WetStroke = 1 | 2 | 3;

export type SwatchPaint =
  | { finish: 'dry'; stroke: DryStroke }
  | { finish: 'wet'; stroke: WetStroke };

const DRY_STROKE_MASKS: Readonly<Record<DryStroke, string>> = {
  1: 'url("/brush/stroke-1.webp")',
  2: 'url("/brush/stroke-2.webp")',
  3: 'url("/brush/stroke-3.webp")',
  4: 'url("/brush/stroke-4.webp")',
  5: 'url("/brush/stroke-5.webp")',
};

const WET_STROKE_MASKS: Readonly<Record<WetStroke, string>> = {
  1: 'url("/brush/wet-1.webp")',
  2: 'url("/brush/wet-2.webp")',
  3: 'url("/brush/wet-3.webp")',
};

type BrushSwatchProps = {
  colour: SwatchColour;
  paint: SwatchPaint;
  mirrored: boolean;
};

function assertNever(value: never): never {
  throw new Error(`Unexpected swatch paint: ${JSON.stringify(value)}`);
}

function maskImageForPaint(paint: SwatchPaint): string {
  switch (paint.finish) {
    case 'dry':
      return DRY_STROKE_MASKS[paint.stroke];
    case 'wet':
      return WET_STROKE_MASKS[paint.stroke];
    default:
      return assertNever(paint);
  }
}

function swatchPaintStyle(colour: SwatchColour, paint: SwatchPaint): React.CSSProperties {
  const maskImage = maskImageForPaint(paint);
  return {
    backgroundColor: SWATCH_COLOURS[colour],
    maskImage,
    WebkitMaskImage: maskImage,
  };
}

/* A static painter's swatch. The image supplies the real bristle edge and
   partial paint coverage. CSS supplies the banner-specific pastel colour. */
export function BrushSwatch({ colour, paint, mirrored }: BrushSwatchProps): React.JSX.Element {
  const className = mirrored ? 'h2-swatch__paint h2-swatch__paint--mirrored' : 'h2-swatch__paint';

  return (
    <div className="h2-swatch" aria-hidden>
      <div className={className} style={swatchPaintStyle(colour, paint)} />
    </div>
  );
}
