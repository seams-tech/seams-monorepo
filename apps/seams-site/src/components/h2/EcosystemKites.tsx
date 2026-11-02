import React from 'react';
import { ECOSYSTEM_LOGO_MARKS } from './ecosystemLogoTiles';
import { InkDrawing } from './ink/InkScene';
import {
  KITE_SWAY,
  narrowKites,
  wideKites,
  type KiteLayout,
  type ToolKite,
} from './ink/kiteLinesScene';

/* The ink drawing paints the goat, the lines and the kites. This layer adds what
   the brush cannot draw: a logo on each kite and a gold dot on some lines. The
   logos use the same sway as their kite, so the two move as one. */

const NARROW = '(max-width: 720px)';
const LOGO_INK = '#0c0b0a';
const DOT_GOLD = '#d98f24';

function useNarrow(): boolean {
  return React.useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(NARROW);
      query.addEventListener('change', change);
      return () => query.removeEventListener('change', change);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

function KiteLogo({
  kite,
  hold,
  order,
}: {
  kite: ToolKite;
  hold: KiteLayout['hold'];
  order: number;
}): React.JSX.Element | null {
  const mark = ECOSYSTEM_LOGO_MARKS.find((candidate) => candidate.id === kite.tool);
  if (!mark) return null;
  const [vx = 0, vy = 0, vw = 24, vh = 24] = (mark.viewBox ?? '0 0 24 24').split(' ').map(Number);
  const k = kite.logoSize / Math.max(vw, vh);
  return (
    <g
      className="h2-ink__move h2-ink__move--sway"
      style={
        {
          transformOrigin: `${hold[0]}px ${hold[1]}px`,
          '--ink-a': KITE_SWAY,
          animationDuration: `${kite.swaySeconds}s`,
        } as React.CSSProperties
      }
    >
      <g className="h2-kites__logo" style={{ animationDelay: `${0.9 + order * 0.3}s` }}>
        <g
          transform={`translate(${kite.x} ${kite.y + 4}) scale(${k}) translate(${-vx - vw / 2} ${-vy - vh / 2})`}
          filter="url(#h2-kites-rough)"
        >
          {mark.glyphs.map((glyph, index) => (
            <path key={index} d={glyph.d} fill={LOGO_INK} fillRule={glyph.fillRule} />
          ))}
        </g>
      </g>
    </g>
  );
}

function LineDot({
  kite,
  hold,
  order,
}: {
  kite: ToolKite;
  hold: KiteLayout['hold'];
  order: number;
}): React.JSX.Element {
  const seconds = 4.6 + (order % 3);
  const begin = `${4 + order * 0.7}s`;
  return (
    <g
      className="h2-ink__move h2-ink__move--sway"
      style={
        {
          transformOrigin: `${hold[0]}px ${hold[1]}px`,
          '--ink-a': KITE_SWAY,
          animationDuration: `${kite.swaySeconds}s`,
        } as React.CSSProperties
      }
    >
      <circle r="4" fill={DOT_GOLD} opacity="0">
        <animateMotion
          dur={`${seconds}s`}
          begin={begin}
          repeatCount="indefinite"
          path={kite.line}
        />
        <animate
          attributeName="opacity"
          dur={`${seconds}s`}
          begin={begin}
          repeatCount="indefinite"
          values="0;1;1;0"
          keyTimes="0;0.08;0.9;1"
        />
      </circle>
    </g>
  );
}

export function EcosystemKites(): React.JSX.Element {
  const narrow = useNarrow();
  const { scene, hold, kites } = narrow ? narrowKites : wideKites;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [resting, setResting] = React.useState(true);
  const [awake, setAwake] = React.useState(false);

  /* the same threshold as the drawing, so that both layers pause together */
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const watch = new IntersectionObserver(
      ([entry]) => {
        const seen = entry?.isIntersecting ?? false;
        setResting(!seen);
        if (seen) setAwake(true);
      },
      { threshold: 0.25 },
    );
    watch.observe(root);
    return () => watch.disconnect();
  }, []);

  const still =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const label = `Satyr holds a line to each tool: ${kites
    .map((kite) => ECOSYSTEM_LOGO_MARKS.find((mark) => mark.id === kite.tool)?.label ?? kite.tool)
    .join(', ')}`;

  return (
    <div
      ref={rootRef}
      className={`h2-kites${resting ? ' is-resting' : ''}${awake ? ' is-awake' : ''}`}
      role="img"
      aria-label={label}
    >
      <InkDrawing key={narrow ? 'narrow' : 'wide'} scene={scene} />
      <svg
        className="h2-kites__layer"
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        aria-hidden
        focusable="false"
      >
        <filter id="h2-kites-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.09"
            numOctaves="2"
            seed="4"
            result="grain"
          />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.1" />
        </filter>
        {kites.map((kite, order) => (
          <KiteLogo key={kite.tool} kite={kite} hold={hold} order={order} />
        ))}
        {!still && awake
          ? kites
              .filter((_, order) => order % 2 === 0)
              .map((kite, order) => (
                <LineDot key={kite.tool} kite={kite} hold={hold} order={order} />
              ))
          : null}
      </svg>
    </div>
  );
}

export default EcosystemKites;
