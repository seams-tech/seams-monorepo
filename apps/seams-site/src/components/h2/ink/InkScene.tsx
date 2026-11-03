import React from 'react';
import { createNoise, prepareStroke, strokeBounds, type PreparedStroke } from './brush';
import type { InkMotion, InkPart, InkScene as InkSceneData } from './scenes';
import '@/styles/h2-ink.css';

/* Paints one scene once it is in view, stroke by stroke, then leaves it to CSS:
   each part keeps its own canvas and moves on the compositor, so a finished
   drawing costs no script. Two motions with periods that do not divide evenly
   never line up, so a part does not visibly repeat. */

const BRUSH_SPEED = 700;
const LONGEST_STROKE_S = 0.93;
const SHORTEST_STROKE_S = 0.08;
/* the next stroke starts when this much of the one before has been drawn */
const STROKE_OVERLAP = 0.55;
/* The parts of a scene start in their own order but inside this window, so a few
   draw at once, each a moment after the one before. Each part then draws as
   slowly as it can, up to the slowest pace, and every part ends inside the scene. */
const START_WINDOW_S = 0.8;
const LONGEST_SCENE_S = 1.5;
const SLOWEST_STROKE_PACE = 1.7;
/* the strokes of a part that grows together start this far apart */
const TOGETHER_STAGGER_S = 0.018;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Timed = {
  stroke: PreparedStroke;
  ctx: CanvasRenderingContext2D;
  part: number;
  start: number;
  duration: number;
};

/* moves each part's start into the window, then stretches each part's strokes */
function overlapParts(timed: readonly Timed[], begins: readonly number[]): void {
  const last = Math.max(0, ...timed.map((entry) => begins[entry.part]));
  const spread = last > START_WINDOW_S ? START_WINDOW_S / last : 1;
  const spans = new Map<number, number>();
  for (const entry of timed) {
    const span = entry.start - begins[entry.part] + entry.duration;
    spans.set(entry.part, Math.max(spans.get(entry.part) ?? 0, span));
  }
  let pace = SLOWEST_STROKE_PACE;
  for (const [part, span] of spans) {
    pace = Math.min(pace, (LONGEST_SCENE_S - begins[part] * spread) / span);
  }
  for (const entry of timed) {
    entry.start = begins[entry.part] * spread + (entry.start - begins[entry.part]) * pace;
    entry.duration *= pace;
  }
}

function paint(
  scene: InkSceneData,
  canvases: readonly (HTMLCanvasElement | null)[],
  instantly: boolean,
): () => void {
  const scale = window.devicePixelRatio || 1;
  const noise = createNoise(Math.floor(Math.random() * 2147483646) + 1);
  const timed: Timed[] = [];
  const begins: number[] = [];
  let clock = 0;

  scene.parts.forEach((part, index) => {
    const canvas = canvases[index];
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const box = strokeBounds(part.strokes);
    canvas.width = Math.ceil(box.width * scale);
    canvas.height = Math.ceil(box.height * scale);
    ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
    if (part.at !== undefined) clock = part.at;
    clock += part.pause ?? 0;
    const first = clock;
    begins[index] = first;
    let end = clock;
    part.strokes.forEach((raw, strokeIndex) => {
      const stroke = prepareStroke(raw, scale, noise);
      const duration = Math.min(
        LONGEST_STROKE_S,
        Math.max(SHORTEST_STROKE_S, stroke.length / (BRUSH_SPEED * (raw.pace ?? 1))),
      );
      const start = part.together ? first + strokeIndex * TOGETHER_STAGGER_S : clock;
      timed.push({ stroke, ctx, part: index, start, duration });
      end = Math.max(end, start + duration);
      clock += duration * STROKE_OVERLAP;
    });
    if (part.together) clock = first + (end - first) * STROKE_OVERLAP;
  });

  /* a scene that times its own parts, such as the wheat field, keeps those times */
  if (!scene.parts.some((part) => part.at !== undefined)) overlapParts(timed, begins);

  if (instantly) {
    for (const entry of timed) entry.stroke.draw(entry.ctx, 1);
    return () => undefined;
  }

  let frame = 0;
  let first = 0;
  const tick = (now: number): void => {
    first ||= now;
    const elapsed = (now - first) / 1000;
    let open = false;
    for (const entry of timed) {
      const progress = (elapsed - entry.start) / entry.duration;
      if (progress < 1) open = true;
      if (progress > 0) entry.stroke.draw(entry.ctx, Math.min(1, progress));
    }
    if (open) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

function Moved({
  motions,
  children,
}: {
  motions: readonly InkMotion[];
  children: React.ReactNode;
}): React.JSX.Element {
  return motions.reduceRight<React.ReactNode>(
    (inner, motion) => (
      <div
        className={`h2-ink__move h2-ink__move--${motion.kind}`}
        style={
          {
            transformOrigin: `${motion.origin?.[0] ?? 0}px ${motion.origin?.[1] ?? 0}px`,
            '--ink-a': motion.amount,
            animationDuration: `${motion.seconds}s`,
            animationDelay: `${motion.delay ?? 0}s`,
          } as React.CSSProperties
        }
      >
        {inner}
      </div>
    ),
    children,
  ) as React.JSX.Element;
}

function PartLayer({
  part,
  canvasRef,
}: {
  part: InkPart;
  canvasRef: (canvas: HTMLCanvasElement | null) => void;
}): React.JSX.Element {
  const box = React.useMemo(() => strokeBounds(part.strokes), [part.strokes]);
  const canvas = (
    <canvas
      ref={canvasRef}
      className="h2-ink__part"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    />
  );
  const motions = part.motions ?? [];
  if (motions.length === 0) return canvas;
  return <Moved motions={motions}>{canvas}</Moved>;
}

export function InkDrawing({
  scene,
  className,
  drawn = false,
}: {
  scene: InkSceneData;
  className?: string;
  /* already painted and moving on load, with no brush strokes to watch */
  drawn?: boolean;
}): React.JSX.Element {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const canvases = React.useRef<(HTMLCanvasElement | null)[]>([]);
  const [resting, setResting] = React.useState(!drawn);

  /* before the first frame, so that a drawn scene never shows empty */
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return undefined;

    /* the stage keeps scene units, and only its scale follows the page */
    const fit = (): void => {
      stage.style.transform = `scale(${root.clientWidth / scene.width})`;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(root);

    let stopPaint: (() => void) | null = drawn ? paint(scene, canvases.current, true) : null;
    const watch = new IntersectionObserver(
      ([entry]) => {
        setResting(!entry.isIntersecting);
        if (entry.isIntersecting && !stopPaint) {
          stopPaint = paint(scene, canvases.current, reducedMotion());
        }
      },
      { threshold: 0.25 },
    );
    watch.observe(root);

    return () => {
      resize.disconnect();
      watch.disconnect();
      stopPaint?.();
    };
  }, [scene, drawn]);

  return (
    <div
      ref={rootRef}
      className={`h2-ink${resting ? ' is-resting' : ''}${className ? ` ${className}` : ''}`}
      style={{ aspectRatio: `${scene.width} / ${scene.height}` }}
      aria-hidden
    >
      <div
        ref={stageRef}
        className="h2-ink__stage"
        style={{ width: scene.width, height: scene.height }}
      >
        {scene.parts.map((part, index) => (
          <PartLayer
            key={part.id}
            part={part}
            canvasRef={(canvas) => {
              canvases.current[index] = canvas;
            }}
          />
        ))}
      </div>
    </div>
  );
}
