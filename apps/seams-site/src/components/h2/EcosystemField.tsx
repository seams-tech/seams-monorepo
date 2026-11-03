import React from 'react';
import { ECOSYSTEM_LOGO_MARKS } from './ecosystemLogoTiles';
import { InkDrawing } from './ink/InkScene';
import type { InkMotion } from './ink/scenes';
import {
  narrowField,
  wideField,
  type ToolStalk,
  type WheatFieldLayout,
} from './ink/wheatFieldScene';

/* The ink drawing paints the field. This layer adds what the brush cannot draw:
   a logo over each tool stalk and the gold grains that drift between the ears.
   Each logo uses the sway of its stalk, so the two move as one. */

const NARROW = '(max-width: 720px)';
const LOGO_INK = '#0c0b0a';
const GRAIN_GOLD = '#d98f24';

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

function Swayed({
  motions,
  base,
  children,
}: {
  motions: readonly InkMotion[];
  base: ToolStalk['base'];
  children: React.ReactNode;
}): React.JSX.Element {
  return motions.reduceRight<React.ReactNode>(
    (inner, motion) => (
      <g
        className="h2-ink__move h2-ink__move--sway"
        style={
          {
            transformOrigin: `${base[0]}px ${base[1]}px`,
            '--ink-a': motion.amount,
            animationDuration: `${motion.seconds}s`,
            animationDelay: `${motion.delay ?? 0}s`,
          } as React.CSSProperties
        }
      >
        {inner}
      </g>
    ),
    children,
  ) as React.JSX.Element;
}

function StalkLogo({ stalk }: { stalk: ToolStalk }): React.JSX.Element | null {
  const mark = ECOSYSTEM_LOGO_MARKS.find((candidate) => candidate.id === stalk.tool);
  if (!mark) return null;
  const [vx = 0, vy = 0, vw = 24, vh = 24] = (mark.viewBox ?? '0 0 24 24').split(' ').map(Number);
  const k = stalk.logoSize / Math.max(vw, vh);
  return (
    <Swayed motions={stalk.motions} base={stalk.base}>
      <g className="h2-ink-tools__logo" style={{ animationDelay: `${stalk.shown}s` }}>
        <g
          transform={`translate(${stalk.x} ${stalk.y}) scale(${k}) translate(${-vx - vw / 2} ${-vy - vh / 2})`}
          filter="url(#h2-field-rough)"
        >
          {mark.glyphs.map((glyph, index) => (
            <path key={index} d={glyph.d} fill={LOGO_INK} fillRule={glyph.fillRule} />
          ))}
        </g>
      </g>
    </Swayed>
  );
}

function Grain({ path, order }: { path: string; order: number }): React.JSX.Element {
  const seconds = `${3.4 + (order % 2) * 0.5}s`;
  const begin = `${1.5 + order * 0.6}s`;
  return (
    <circle r="3.8" fill={GRAIN_GOLD} opacity="0">
      <animateMotion dur={seconds} begin={begin} repeatCount="indefinite" path={path} />
      <animate
        attributeName="opacity"
        dur={seconds}
        begin={begin}
        repeatCount="indefinite"
        values="0;1;1;0"
        keyTimes="0;0.1;0.88;1"
      />
    </circle>
  );
}

export function EcosystemField(): React.JSX.Element {
  const narrow = useNarrow();
  const { scene, stalks, grains }: WheatFieldLayout = narrow ? narrowField : wideField;
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
  const label = `A field of wheat with a connected tool over some of the stalks: ${stalks
    .map(
      (stalk) => ECOSYSTEM_LOGO_MARKS.find((mark) => mark.id === stalk.tool)?.label ?? stalk.tool,
    )
    .join(', ')}`;

  return (
    <div
      ref={rootRef}
      className={`h2-ink-tools${resting ? ' is-resting' : ''}${awake ? ' is-awake' : ''}`}
      role="img"
      aria-label={label}
    >
      <InkDrawing key={narrow ? 'narrow' : 'wide'} scene={scene} />
      <svg
        className="h2-ink-tools__layer"
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        aria-hidden
        focusable="false"
      >
        <filter id="h2-field-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.09"
            numOctaves="2"
            seed="4"
            result="grain"
          />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.1" />
        </filter>
        {stalks.map((stalk) => (
          <StalkLogo key={stalk.tool} stalk={stalk} />
        ))}
        {!still && awake
          ? grains.map((path, order) => <Grain key={path} path={path} order={order} />)
          : null}
      </svg>
    </div>
  );
}

export default EcosystemField;
