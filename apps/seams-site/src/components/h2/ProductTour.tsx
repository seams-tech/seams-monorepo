import React from 'react';
import { InkTile } from '@/components/h2/sections';
import type { TileSign } from '@/components/h2/ink/tileSignScenes';
import { useSiteCopy } from '@/i18n/browser';
import { fill, type SiteCopy } from '@/i18n/siteCopy';
import '@/styles/h2-tour.css';

/* Front-page product tour: two tabs (Satyr, Satyr Kitchen), each with three features. A
   feature shows a Portal screen, marks one region of it in gold, dims the screen and lays a
   zoomed card of that region, or a related screen, over it. The tour moves on by itself and
   stops while the pointer or the focus is on it. */

/* Full Portal screens at 1600 × 1000, captured at 1.5× from the local previews with sample data. */
const SHOTS = {
  'tour-inbox': [2400, 1500],
  'tour-activity': [2400, 1500],
  'tour-orders': [2400, 1500],
  'tour-orders-drawer': [2400, 1500],
  'tour-kitchen-timeline': [2400, 1500],
  'tour-kitchen-details': [2400, 1500],
  'tour-kitchen-plan': [2400, 1500],
} as const;
type Shot = keyof typeof SHOTS;

/** A region in percent of the main screen. */
type Mark = { x: number; y: number; w: number; h: number };
/** A region in pixels of a shot. */
type Crop = { x: number; y: number; w: number; h: number };
type Place = 'left' | 'right' | 'bottom';
/** A zoomed card of a region of a shot, laid over the main screen. */
type Overlap = { kind: 'crop'; shot: Shot; crop: Crop; place: Place; width?: number };

type TourCopy = SiteCopy['tour'];
type FeatureId = keyof TourCopy['items'];
type TabId = keyof TourCopy['tabs'];

/* The shots and marks of one feature; its words come from the site copy. */
type FeatureLayout = {
  id: FeatureId;
  main: Shot;
  /** Part of the main shot to show; the whole shot when absent. */
  mainCrop?: Crop;
  mark: Mark;
  overlap: Overlap;
};
type Feature = FeatureLayout & TourCopy['items'][FeatureId];
type TabLayout = { id: TabId; sign: TileSign; features: FeatureLayout[] };
type Tab = Omit<TabLayout, 'features'> & { label: string; features: Feature[] };

function localizeTabs(copy: TourCopy): Tab[] {
  return TAB_LAYOUTS.map((tab) => ({
    ...tab,
    label: copy.tabs[tab.id],
    features: tab.features.map((feature) => ({ ...feature, ...copy.items[feature.id] })),
  }));
}

const TAB_LAYOUTS: TabLayout[] = [
  {
    id: 'satyr',
    sign: 'shop',
    features: [
      {
        id: 'inbox',
        main: 'tour-inbox',
        mark: { x: 39.5, y: 62.5, w: 58.5, h: 36 },
        overlap: {
          kind: 'crop',
          shot: 'tour-inbox',
          crop: { x: 950, y: 935, w: 1410, h: 550 },
          place: 'left',
          width: 44,
        },
      },
      {
        id: 'activity',
        main: 'tour-activity',
        mark: { x: 17.5, y: 41, w: 80.5, h: 13.5 },
        overlap: {
          kind: 'crop',
          shot: 'tour-activity',
          crop: { x: 1280, y: 605, w: 1000, h: 210 },
          place: 'bottom',
        },
      },
      {
        id: 'orders',
        main: 'tour-orders',
        mark: { x: 17.2, y: 36, w: 55, h: 10.2 },
        overlap: {
          kind: 'crop',
          shot: 'tour-orders-drawer',
          crop: { x: 1745, y: 0, w: 655, h: 850 },
          place: 'right',
          width: 30,
        },
      },
    ],
  },
  {
    id: 'kitchen',
    sign: 'croissant',
    features: [
      {
        id: 'plan',
        main: 'tour-kitchen-timeline',
        mark: { x: 16.5, y: 76, w: 55.5, h: 23.5 },
        overlap: {
          kind: 'crop',
          shot: 'tour-kitchen-timeline',
          crop: { x: 400, y: 1135, w: 1330, h: 355 },
          place: 'bottom',
        },
      },
      {
        id: 'batch',
        main: 'tour-kitchen-details',
        mark: { x: 75.8, y: 7.5, w: 23.2, h: 65 },
        overlap: {
          kind: 'crop',
          shot: 'tour-kitchen-details',
          crop: { x: 1825, y: 115, w: 550, h: 970 },
          place: 'left',
          width: 22,
        },
      },
      {
        id: 'floor',
        main: 'tour-kitchen-plan',
        mark: { x: 15.5, y: 19.5, w: 27.5, h: 59 },
        overlap: {
          kind: 'crop',
          shot: 'tour-kitchen-plan',
          crop: { x: 380, y: 290, w: 645, h: 885 },
          place: 'right',
          width: 26,
        },
      },
    ],
  },
];

const ORDER = TAB_LAYOUTS.flatMap((tab, t) => tab.features.map((_, f) => ({ t, f })));
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

  /* A paused view still shows its layers: the pointer or a click must not stop the
     tour before the gold mark and the card appear. */
  React.useEffect(() => {
    if (!paused || reduced || hold) return;
    const layered = OVERLAP_AT * DWELL_MS;
    if (elapsed.current < layered) {
      elapsed.current = layered;
      setProgress(OVERLAP_AT);
    }
  }, [paused, reduced, hold, step]);

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
          feature.overlap.width !== undefined ? { width: `${feature.overlap.width}%` } : undefined
        }
        aria-hidden
      >
        <CropCard shot={feature.overlap.shot} crop={feature.overlap.crop} />
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
  const copy = useSiteCopy().tour;
  const tabs = React.useMemo(() => localizeTabs(copy), [copy]);
  const { t, f } = ORDER[step];
  const tab = tabs[t];
  const feature = tab.features[f];
  const jump = (tabIndex: number, featureIndex: number) =>
    setStep(ORDER.findIndex((o) => o.t === tabIndex && o.f === featureIndex));

  return (
    <section
      className={still ? 'h2-tour h2-tour--still' : 'h2-tour'}
      aria-label={copy.label}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="h2-tour-tabs" role="tablist" aria-label={copy.tabsLabel}>
        {tabs.map((item, i) => {
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
          aria-label={fill(copy.explore, { name: tab.label })}
        >
          <Stage feature={feature} progress={progress} />
        </a>
      ) : (
        <Stage feature={feature} progress={progress} />
      )}

      <div className="h2-tour-pager-line">
        {/* Pager sits on the line between the stage and the features. */}
        <div className="h2-pager" role="group" aria-label={copy.views}>
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

      <div
        className="h2-tour-features"
        role="tablist"
        aria-label={fill(copy.features, { name: tab.label })}
      >
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
