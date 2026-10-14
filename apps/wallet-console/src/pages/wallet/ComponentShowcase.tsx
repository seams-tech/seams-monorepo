import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ComponentPreview } from './ComponentPreview';
import { BackgroundPreview, type BackgroundPreviewKind } from './BackgroundPreview';
import './component-showcase.css';

export type PreviewId = 'create' | 'transaction-modal' | 'prediction-market' | 'profile' | 'access';

type Preview = {
  id: PreviewId;
  label: string;
  x: number;
  y: number;
};

const defaultPreview: Preview = { id: 'transaction-modal', label: 'Transactions', x: 420, y: 100 };

const previews: readonly Preview[] = [
  { id: 'create', label: 'Authentication', x: 0, y: 0 },
  defaultPreview,
  { id: 'prediction-market', label: 'Custom Components', x: 840, y: -70 },
  { id: 'access', label: 'Link & recover', x: 1680, y: -100 },
  { id: 'profile', label: 'Account management', x: 1260, y: 60 },
];

type BackgroundPlacement = { kind: BackgroundPreviewKind; x: number; y: number };

const backgroundPreviews: readonly BackgroundPlacement[] = [
  { kind: 'unlock', x: -420, y: -60 },
  { kind: 'recovery', x: -420, y: 360 },
  { kind: 'receipt', x: 0, y: 490 },
  { kind: 'payment', x: 420, y: -360 },
  { kind: 'recovery', x: 420, y: 580 },
  { kind: 'receipt', x: 840, y: -500 },
  { kind: 'unlock', x: 1260, y: 520 },
  { kind: 'recovery', x: 1260, y: -400 },
  { kind: 'payment', x: 2100, y: -240 },
  { kind: 'receipt', x: 1680, y: 390 },
];

// Both selectors resolve to the same component at the DOM boundary.
function readPreview(value: string): Preview | null {
  for (const preview of previews) {
    if (preview.id === value) return preview;
  }
  return null;
}

function selectPreview(
  setPreview: React.Dispatch<React.SetStateAction<Preview>>,
  event: React.ChangeEvent<HTMLDivElement>,
): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  const preview = readPreview(event.target.value);
  if (preview !== null) setPreview(preview);
}

function stepPreview(
  setSelected: React.Dispatch<React.SetStateAction<Preview>>,
  selected: Preview,
  direction: -1 | 1,
): void {
  const index = previews.indexOf(selected);
  setSelected(previews[(index + direction + previews.length) % previews.length]);
}

function setPointerMotion(event: React.PointerEvent<HTMLElement>): void {
  event.currentTarget.dataset.motion = 'pointer';
}

function setKeyboardMotion(event: React.KeyboardEvent<HTMLElement>): void {
  event.currentTarget.dataset.motion = 'keyboard';
}

function setPreviewInert(active: boolean, element: HTMLDivElement | null): void {
  if (element !== null) element.inert = !active;
}

function updateCursorVisibility(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    if (entry.target instanceof HTMLElement) {
      entry.target.dataset.inView = String(entry.isIntersecting && entry.intersectionRatio >= 0.3);
    }
  }
}

function observeCanvas(
  observer: React.MutableRefObject<IntersectionObserver | null>,
  element: HTMLDivElement | null,
): void {
  observer.current?.disconnect();
  observer.current = null;
  if (element === null) return;
  observer.current = new IntersectionObserver(updateCursorVisibility, { threshold: 0.3 });
  observer.current.observe(element);
}

function renderSelectorChoice(selected: Preview, preview: Preview): React.JSX.Element {
  return (
    <label className="component-showcase__choice" key={preview.id}>
      <input
        type="radio"
        name="showcase-selector"
        value={preview.id}
        checked={selected.id === preview.id}
        aria-controls="showcase-canvas"
        readOnly
      />
      <span>
        <span className="component-showcase__dot" />
        {preview.label}
      </span>
    </label>
  );
}

function renderRailChoice(selected: Preview, preview: Preview): React.JSX.Element {
  return (
    <label
      className="component-showcase__choice component-showcase__dot-choice"
      key={preview.id}
      title={preview.label}
    >
      <input
        type="radio"
        name="showcase-component"
        value={preview.id}
        checked={preview.id === selected.id}
        aria-label={preview.label}
        aria-controls="showcase-canvas"
        readOnly
      />
      <span aria-hidden="true">
        <span className={`h2-pager__dot${preview.id === selected.id ? ' is-active' : ''}`} />
      </span>
    </label>
  );
}

function renderPreview(selected: Preview, preview: Preview): React.JSX.Element {
  const active = preview.id === selected.id;
  return (
    <div
      key={preview.id}
      className="component-showcase__position"
      style={{ left: preview.x, top: preview.y }}
      data-active={active}
      aria-hidden={!active}
      ref={setPreviewInert.bind(null, active)}
    >
      <ComponentPreview
        key={`${preview.id}:${active}`}
        id={preview.id}
        active={active}
        backdrop="none"
      />
    </div>
  );
}

function renderBackground(preview: BackgroundPlacement): React.JSX.Element {
  return (
    <div
      key={`${preview.kind}:${preview.x}:${preview.y}`}
      className="component-showcase__position"
      style={{ left: preview.x, top: preview.y }}
      aria-hidden="true"
      ref={setPreviewInert.bind(null, false)}
    >
      <BackgroundPreview kind={preview.kind} />
    </div>
  );
}

export function ComponentShowcase(): React.JSX.Element {
  const [selected, setSelected] = React.useState<Preview>(defaultPreview);
  const visibilityObserver = React.useRef<IntersectionObserver | null>(null);

  return (
    <section
      className="component-showcase h2-rule"
      aria-label="Wallet component showcase"
      onPointerDownCapture={setPointerMotion}
      onKeyDownCapture={setKeyboardMotion}
    >
      <div className="component-showcase__frame">
        <div
          className="component-showcase__selector"
          role="radiogroup"
          aria-label="Components"
          onChange={selectPreview.bind(null, setSelected)}
        >
          {previews.map(renderSelectorChoice.bind(null, selected))}
        </div>
        <div
          className="component-showcase__viewport"
          id="showcase-canvas"
          ref={observeCanvas.bind(null, visibilityObserver)}
        >
          <div className="component-showcase__glow" aria-hidden="true" />
          <div
            className="component-showcase__world"
            style={{ transform: `translate(${-selected.x}px, ${-selected.y}px)` }}
          >
            {previews.map(renderPreview.bind(null, selected))}
            {backgroundPreviews.map(renderBackground)}
          </div>
          <div className="component-showcase__fade" aria-hidden="true" />
        </div>
      </div>
      <div className="component-showcase__navigation">
        <div className="component-showcase__rail" aria-label="Component navigation">
          <button
            type="button"
            className="h2-pager__btn"
            aria-label="Previous component"
            onClick={stepPreview.bind(null, setSelected, selected, -1)}
          >
            <ChevronLeft aria-hidden />
          </button>
          <div
            className="h2-pager__dots"
            role="radiogroup"
            aria-label="Component pagination"
            onChange={selectPreview.bind(null, setSelected)}
          >
            {previews.map(renderRailChoice.bind(null, selected))}
          </div>
          <button
            type="button"
            className="h2-pager__btn"
            aria-label="Next component"
            onClick={stepPreview.bind(null, setSelected, selected, 1)}
          >
            <ChevronRight aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
