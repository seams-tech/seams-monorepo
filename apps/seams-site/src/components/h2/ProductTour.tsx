import React from 'react';
import { IntegrationsWindow } from '@/components/h2/SceneHero';
import { InkTile } from '@/components/h2/sections';
import type { TileSign } from '@/components/h2/ink/tileSignScenes';
import '@/styles/h2-tour.css';

/* Front-page product tour: two tabs (Satyr, Satyr Kitchen), each with three features. A
   feature shows a Portal screen, marks one region of it in gold, dims the screen and lays a
   zoomed card of that region, or a related screen, over it. The tour moves on by itself and
   stops while the pointer or the focus is on it. */

const SHOTS = {
  inbox: [1600, 1183],
  'inbox-draft': [1196, 1536],
  activity: [1600, 859],
  orders: [1600, 1000],
  'bakery-timeline': [1600, 1210],
  'bakery-details': [1600, 1127],
  'kitchen-floor': [1600, 855],
} as const;
type Shot = keyof typeof SHOTS;

/** A region in percent of the main screen. */
type Mark = { x: number; y: number; w: number; h: number };
/** A region in pixels of a shot. */
type Crop = { x: number; y: number; w: number; h: number };
type Place = 'left' | 'right' | 'bottom';
type Overlap =
  | { kind: 'crop'; shot: Shot; crop: Crop; place: Place; width?: number }
  | { kind: 'slack'; place: Place };

type Feature = {
  id: string;
  title: string;
  body: string;
  main: Shot;
  /** Part of the main shot to show; the whole shot when absent. */
  mainCrop?: Crop;
  alt: string;
  mark: Mark;
  overlap: Overlap;
};
type Tab = { id: string; label: string; sign: TileSign; features: Feature[] };

const TABS: Tab[] = [
  {
    id: 'satyr',
    label: 'Satyr Commerce Agents',
    sign: 'shop',
    features: [
      {
        id: 'inbox',
        title: 'Replies wait for you',
        body: 'An agent drafts each customer reply and shows its sources. Nothing is sent until you approve it.',
        main: 'inbox',
        alt: 'The Satyr Inbox with a reply that an agent drafted for a customer',
        mark: { x: 51.5, y: 43.5, w: 46.5, h: 27 },
        overlap: {
          kind: 'crop',
          shot: 'inbox-draft',
          crop: { x: 0, y: 150, w: 1196, h: 1150 },
          place: 'left',
        },
      },
      {
        id: 'activity',
        title: 'Every Case of the day',
        body: 'See what each agent works on, and which Cases wait for a person.',
        main: 'activity',
        alt: 'The Activity timeline of the Satyr Portal with three Cases that wait for a person',
        mark: { x: 19.5, y: 23, w: 30.5, h: 41.5 },
        overlap: {
          kind: 'crop',
          shot: 'activity',
          crop: { x: 312, y: 197, w: 470, h: 352 },
          place: 'right',
        },
      },
      {
        id: 'slack',
        title: 'Approve from Slack',
        body: 'An order that needs you reaches the café’s Slack thread, with the same checks as in the Portal.',
        main: 'orders',
        alt: 'The Orders page of the Satyr Portal with two orders that need a person',
        mark: { x: 2.5, y: 38.5, w: 95, h: 41.5 },
        overlap: { kind: 'slack', place: 'right' },
      },
    ],
  },
  {
    id: 'kitchen',
    label: 'Satyr Kitchen',
    sign: 'croissant',
    features: [
      {
        id: 'plan',
        title: 'Orders become a bake plan',
        body: 'Satyr turns the day’s orders into batches, steps and times for the kitchen.',
        main: 'bakery-timeline',
        alt: 'Satyr Kitchen: the 3D bakery above the production timeline',
        mark: { x: 1.2, y: 74.5, w: 66.5, h: 24.5 },
        overlap: {
          kind: 'crop',
          shot: 'bakery-timeline',
          crop: { x: 20, y: 905, w: 1070, h: 295 },
          place: 'bottom',
        },
      },
      {
        id: 'batch',
        title: 'Each batch, step by step',
        body: 'Open a batch to see its current step, its baker and when it will finish.',
        main: 'bakery-details',
        alt: 'Satyr Kitchen: the details of one batch of 48 financiers',
        mark: { x: 66.5, y: 8, w: 32, h: 51.5 },
        overlap: {
          kind: 'crop',
          shot: 'bakery-details',
          crop: { x: 1065, y: 90, w: 510, h: 580 },
          place: 'left',
        },
      },
      {
        id: 'floor',
        title: 'Rehearse the shift',
        body: 'Play the morning in the floor plan and the 3D kitchen before the shift starts.',
        main: 'kitchen-floor',
        mainCrop: { x: 0, y: 0, w: 1035, h: 855 },
        alt: 'Satyr Kitchen: the floor plan and the 3D view of the bakery',
        mark: { x: 5.2, y: 21.5, w: 30, h: 46.5 },
        overlap: {
          kind: 'crop',
          shot: 'kitchen-floor',
          crop: { x: 50, y: 180, w: 320, h: 410 },
          place: 'right',
          width: 27,
        },
      },
    ],
  },
];

const ORDER = TABS.flatMap((tab, t) => tab.features.map((_, f) => ({ t, f })));
const DWELL_MS = 6500;
/* Within one feature: the gold mark appears, then the screen dims and the card enters. */
const MARK_AT = 0.12;
const OVERLAP_AT = 0.22;

function shotSrc(shot: Shot): string {
  return `/satyr-portal/${shot}.webp`;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

/** Progress of the current feature, from 0 to 1. It stops while `paused`. */
function useTour(paused: boolean, reduced: boolean, hold: boolean, initialStep: number) {
  const [step, setStep] = React.useState(() => initialStep % ORDER.length);
  const [progress, setProgress] = React.useState(0);
  const elapsed = React.useRef(0);

  React.useEffect(() => {
    elapsed.current = 0;
    setProgress(reduced || hold ? 0.6 : 0);
  }, [step, reduced, hold]);

  React.useEffect(() => {
    if (paused || reduced || hold) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += Math.min(now - last, 100);
      last = now;
      if (elapsed.current >= DWELL_MS) {
        setStep((s) => (s + 1) % ORDER.length);
        return;
      }
      setProgress(elapsed.current / DWELL_MS);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, reduced, hold, step]);

  return { step, setStep, progress };
}

function CropCard({
  shot,
  crop,
  alt = '',
  imageClass,
  children,
}: {
  shot: Shot;
  crop: Crop;
  alt?: string;
  imageClass?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [width, height] = SHOTS[shot];
  return (
    <div className="h2-tour-crop" style={{ aspectRatio: `${crop.w} / ${crop.h}` }}>
      <img
        className={imageClass}
        src={shotSrc(shot)}
        alt={alt}
        style={{
          width: `${(width / crop.w) * 100}%`,
          height: `${(height / crop.h) * 100}%`,
          left: `${(-crop.x / crop.w) * 100}%`,
          top: `${(-crop.y / crop.h) * 100}%`,
        }}
      />
      {children}
    </div>
  );
}

function Stage({ feature, progress }: { feature: Feature; progress: number }): React.JSX.Element {
  const marked = progress >= MARK_AT;
  const layered = progress >= OVERLAP_AT;
  const place = feature.overlap.place;
  return (
    <div className={`h2-tour-stage h2-tour-stage--${place}`}>
      <span className="h2-tour-corner h2-tour-corner--tl" aria-hidden />
      <span className="h2-tour-corner h2-tour-corner--tr" aria-hidden />
      <span className="h2-tour-corner h2-tour-corner--bl" aria-hidden />
      <span className="h2-tour-corner h2-tour-corner--br" aria-hidden />
      <div className="h2-tour-dots" aria-hidden />

      <div className="h2-tour-main" key={`main-${feature.id}`}>
        <CropCard
          shot={feature.main}
          crop={
            feature.mainCrop ?? {
              x: 0,
              y: 0,
              w: SHOTS[feature.main][0],
              h: SHOTS[feature.main][1],
            }
          }
          alt={feature.alt}
          imageClass={`h2-tour-main__shot${layered ? ' is-dim' : ''}`}
        >
          <span
            className={`h2-tour-mark${marked ? ' is-on' : ''}`}
            style={{
              left: `${feature.mark.x}%`,
              top: `${feature.mark.y}%`,
              width: `${feature.mark.w}%`,
              height: `${feature.mark.h}%`,
            }}
            aria-hidden
          />
        </CropCard>
      </div>

      <div
        className={`h2-tour-overlap h2-tour-overlap--${place}${layered ? ' is-on' : ''}`}
        key={`overlap-${feature.id}`}
        style={
          feature.overlap.kind === 'crop' && feature.overlap.width !== undefined
            ? { width: `${feature.overlap.width}%` }
            : undefined
        }
        aria-hidden
      >
        {feature.overlap.kind === 'crop' ? (
          <CropCard shot={feature.overlap.shot} crop={feature.overlap.crop} />
        ) : (
          <div className="h2-tour-slack">
            <IntegrationsWindow />
          </div>
        )}
      </div>
    </div>
  );
}

type TourLink = { href: string; onClick?: React.MouseEventHandler<HTMLAnchorElement> };

export function ProductTour({
  links,
  initialStep = 0,
  hold = false,
  still = false,
}: {
  /** Where the stage leads for each tab, by tab id. */
  links?: Partial<Record<string, TourLink>>;
  /** Review aids: start on one feature, stop there, and turn off the motion. */
  initialStep?: number;
  hold?: boolean;
  still?: boolean;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const { step, setStep, progress } = useTour(hovered || focused, reduced, hold, initialStep);
  const { t, f } = ORDER[step];
  const tab = TABS[t];
  const feature = tab.features[f];
  const jump = (tabIndex: number, featureIndex: number) =>
    setStep(ORDER.findIndex((o) => o.t === tabIndex && o.f === featureIndex));

  return (
    <section
      className={still ? 'h2-tour h2-tour--still' : 'h2-tour'}
      aria-label="Product tour"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="h2-tour-tabs" role="tablist" aria-label="Products">
        {TABS.map((item, i) => {
          const active = i === t;
          const fill = active ? (f + progress) / item.features.length : 0;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`h2-tour-tab${active ? ' is-active' : ''}`}
              onClick={() => jump(i, 0)}
            >
              <span className="h2-tour-line" style={{ transform: `scaleX(${fill})` }} aria-hidden />
              <InkTile sign={item.sign} />
              {item.label}
            </button>
          );
        })}
      </div>

      {links?.[tab.id] ? (
        <a
          className="h2-tour-stage-link"
          href={links[tab.id]!.href}
          onClick={links[tab.id]!.onClick}
          aria-label={`Explore ${tab.label}`}
        >
          <Stage feature={feature} progress={progress} />
        </a>
      ) : (
        <Stage feature={feature} progress={progress} />
      )}

      <div className="h2-tour-pager-line">
        {/* Pager sits on the line between the stage and the features. */}
        <div className="h2-pager" role="group" aria-label="Product views">
          <span className="h2-pager__dots">
            {tab.features.map((item, i) => (
              <span
                key={item.id}
                className={`h2-pager__dot${i === f ? ' is-active' : ''}`}
                title={item.title}
              />
            ))}
          </span>
        </div>
      </div>

      <div className="h2-tour-features" role="tablist" aria-label={`${tab.label} features`}>
        {tab.features.map((item, i) => {
          const active = i === f;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`h2-tour-feature${active ? ' is-active' : ''}`}
              onClick={() => jump(t, i)}
            >
              <span
                className="h2-tour-line"
                style={{ transform: `scaleX(${active ? progress : 0})` }}
                aria-hidden
              />
              <span className="h2-tour-feature__bullet" aria-hidden />
              <span className="h2-tour-feature__title">{item.title}</span>
              <span className="h2-tour-feature__body">{item.body}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
