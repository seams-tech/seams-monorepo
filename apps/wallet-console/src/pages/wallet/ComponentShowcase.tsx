import React from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { ComponentPreview } from './ComponentPreview';
import { BackgroundPreview, type BackgroundPreviewKind } from './BackgroundPreview';
import './component-showcase.css';

export type PreviewId = 'create' | 'transaction-modal' | 'prediction-market' | 'profile';

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
  { id: 'profile', label: 'Recover and Link Devices', x: 1260, y: 60 },
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
  { kind: 'payment', x: 840, y: 560 },
  { kind: 'unlock', x: 1680, y: -250 },
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

function renderPreview(
  selected: Preview,
  run: number,
  onComplete: () => void,
  onInteract: () => void,
  preview: Preview,
): React.JSX.Element {
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
        key={`${preview.id}:${active}:${run}`}
        id={preview.id}
        active={active}
        backdrop="none"
        onComplete={onComplete}
        onInteract={onInteract}
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

type PlaybackState = { kind: 'playing' } | { kind: 'paused'; reason: 'control' | 'interaction' };

function nextPreview(selected: Preview): Preview {
  return previews[(previews.indexOf(selected) + 1) % previews.length];
}

function completePlayback(setSelected: React.Dispatch<React.SetStateAction<Preview>>): void {
  setSelected(nextPreview);
}

// A demo's own Next control asks for the next component. Only a frame inside
// this canvas may ask, so no other page can move it.
function advanceFromPreview(
  setSelected: React.Dispatch<React.SetStateAction<Preview>>,
  event: MessageEvent<unknown>,
): void {
  if (event.origin !== window.location.origin) return;
  const message = event.data;
  if (typeof message !== 'object' || message === null) return;
  if (!('type' in message) || message.type !== 'seams-showcase-next') return;
  const frames = document.querySelectorAll<HTMLIFrameElement>('.component-showcase iframe');
  if (Array.from(frames).some((frame) => frame.contentWindow === event.source)) {
    setSelected(nextPreview);
  }
}

function listenForPreviewNext(
  setSelected: React.Dispatch<React.SetStateAction<Preview>>,
): () => void {
  const listener = advanceFromPreview.bind(null, setSelected);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

function interruptPlayback(setPlayback: React.Dispatch<React.SetStateAction<PlaybackState>>): void {
  setPlayback({ kind: 'paused', reason: 'interaction' });
}

function incrementRun(run: number): number {
  return run + 1;
}

function togglePlayback(
  playback: PlaybackState,
  setPlayback: React.Dispatch<React.SetStateAction<PlaybackState>>,
  setRun: React.Dispatch<React.SetStateAction<number>>,
  event: React.MouseEvent<HTMLButtonElement>,
): void {
  if (playback.kind === 'playing') {
    setPlayback({ kind: 'paused', reason: 'control' });
  } else {
    if (playback.reason === 'interaction') setRun(incrementRun);
    const section = event.currentTarget.closest<HTMLElement>('.component-showcase');
    if (section) section.dataset.motion = 'pointer';
    setPlayback({ kind: 'playing' });
  }
}

export function ComponentShowcase(): React.JSX.Element {
  const [selected, setSelected] = React.useState<Preview>(defaultPreview);
  const [playback, setPlayback] = React.useState<PlaybackState>({ kind: 'playing' });
  const [run, setRun] = React.useState(0);
  const onComplete = React.useCallback(completePlayback.bind(null, setSelected), []);
  const onInteract = React.useCallback(interruptPlayback.bind(null, setPlayback), []);
  const visibilityObserver = React.useRef<IntersectionObserver | null>(null);
  React.useEffect(listenForPreviewNext.bind(null, setSelected), []);

  return (
    <section
      className="component-showcase h2-rule"
      aria-labelledby="component-showcase-title"
      data-playback={playback.kind}
      data-pause-reason={playback.kind === 'paused' ? playback.reason : undefined}
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
        <h2
          id="component-showcase-title"
          className="h2-display h2-eco__title component-showcase__title"
        >
          Use the built-in wallet components, or design your own
        </h2>
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
            {previews.map(renderPreview.bind(null, selected, run, onComplete, onInteract))}
            {backgroundPreviews.map(renderBackground)}
          </div>
          <div className="component-showcase__fade" aria-hidden="true" />
        </div>
      </div>
      <button
        type="button"
        className="h2-pager__btn component-showcase__playback"
        aria-label={playback.kind === 'playing' ? 'Pause playback' : 'Play playback'}
        title={playback.kind === 'playing' ? 'Pause playback' : 'Play playback'}
        onClick={togglePlayback.bind(null, playback, setPlayback, setRun)}
      >
        {playback.kind === 'playing' ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" strokeLinecap="round">
            <path d="M8 5v14M16 5v14" />
          </svg>
        ) : (
          <Play aria-hidden />
        )}
      </button>
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
