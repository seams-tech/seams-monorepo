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
type SwatchAngle = -2 | -1 | 0 | 1 | 2;
type SwatchOffset = -12 | 0 | 12;

export type SwatchPaint =
  | { finish: 'dry'; stroke: DryStroke }
  | { finish: 'wet'; stroke: WetStroke };

export type SwatchLayer = {
  paint: SwatchPaint;
  angle: SwatchAngle;
  offset: SwatchOffset;
};

export type SwatchLayers =
  | { kind: 'single'; foreground: SwatchLayer; background?: never }
  | { kind: 'double'; foreground: SwatchLayer; background: SwatchLayer };

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
  layers: SwatchLayers;
  mirrored: boolean;
};

type SwatchPaintLayerProps = {
  colour: SwatchColour;
  layer: SwatchLayer;
  mirrored: boolean;
  background: boolean;
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

function swatchPaintStyle(
  colour: SwatchColour,
  layer: SwatchLayer,
  mirrored: boolean,
): React.CSSProperties {
  const maskImage = maskImageForPaint(layer.paint);
  const mirror = mirrored ? 'scaleX(-1)' : 'scaleX(1)';
  return {
    backgroundColor: SWATCH_COLOURS[colour],
    maskImage,
    transform: `translateY(${layer.offset}px) rotate(${layer.angle}deg) ${mirror}`,
    WebkitMaskImage: maskImage,
  };
}

function SwatchPaintLayer({
  colour,
  layer,
  mirrored,
  background,
}: SwatchPaintLayerProps): React.JSX.Element {
  const className = background ? 'h2-swatch__paint h2-swatch__paint--back' : 'h2-swatch__paint';

  return <div className={className} style={swatchPaintStyle(colour, layer, mirrored)} />;
}

/* A static painter's swatch. The image supplies the real bristle edge and
   partial paint coverage. CSS supplies the banner-specific pastel colour. */
export function BrushSwatch({ colour, layers, mirrored }: BrushSwatchProps): React.JSX.Element {
  const className = layers.kind === 'double' ? 'h2-swatch h2-swatch--double' : 'h2-swatch';
  const background =
    layers.kind === 'double' ? (
      <SwatchPaintLayer colour={colour} layer={layers.background} mirrored={mirrored} background />
    ) : null;

  return (
    <div className={className} aria-hidden>
      {background}
      <SwatchPaintLayer
        colour={colour}
        layer={layers.foreground}
        mirrored={mirrored}
        background={false}
      />
    </div>
  );
}
