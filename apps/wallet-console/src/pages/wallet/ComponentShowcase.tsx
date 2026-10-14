import React from 'react';
import { Layers2, Pause, Play } from 'lucide-react';
import { ComponentPreview } from './ComponentPreview';
import './component-showcase.css';

export type PreviewId =
  | 'create'
  | 'unlock'
  | 'recovery'
  | 'transfer'
  | 'contract'
  | 'receipt'
  | 'payment'
  | 'methods'
  | 'paid'
  | 'profile'
  | 'devices'
  | 'security';

type Category = 'authentication' | 'transactions' | 'checkout' | 'account';

type Preview = {
  id: PreviewId;
  category: Category;
  label: string;
  x: number;
  y: number;
};

const previews: readonly Preview[] = [
  { id: 'create', category: 'authentication', label: 'Create wallet', x: 0, y: 0 },
  { id: 'unlock', category: 'authentication', label: 'Unlock', x: 80, y: 590 },
  { id: 'recovery', category: 'authentication', label: 'Recovery', x: -70, y: 1180 },
  { id: 'transfer', category: 'transactions', label: 'Transfer', x: 420, y: 100 },
  { id: 'contract', category: 'transactions', label: 'Contract call', x: 500, y: 690 },
  { id: 'receipt', category: 'transactions', label: 'Receipt', x: 350, y: 1280 },
  { id: 'payment', category: 'checkout', label: 'Payment', x: 840, y: -70 },
  { id: 'methods', category: 'checkout', label: 'Payment method', x: 920, y: 520 },
  { id: 'paid', category: 'checkout', label: 'Confirmation', x: 770, y: 1110 },
  { id: 'profile', category: 'account', label: 'Profile', x: 1260, y: 60 },
  { id: 'devices', category: 'account', label: 'Devices', x: 1340, y: 650 },
  { id: 'security', category: 'account', label: 'Security', x: 1190, y: 1240 },
];

const categories: readonly { id: Category; label: string; first: PreviewId }[] = [
  { id: 'authentication', label: 'Authentication', first: 'create' },
  { id: 'transactions', label: 'Transactions', first: 'transfer' },
  { id: 'checkout', label: 'Checkout', first: 'payment' },
  { id: 'account', label: 'Account', first: 'profile' },
];

const captions: Record<Category, string> = {
  authentication: 'A first impression that feels familiar.',
  transactions: 'Every detail, before you approve.',
  checkout: 'From choosing to yours, in a moment.',
  account: 'Your wallet. Wherever you are.',
};

// Parse the radio value at the DOM boundary. Selection alone determines its category.
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

function togglePlayback(
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>,
  playing: boolean,
  event: React.MouseEvent<HTMLButtonElement>,
): void {
  setPlaying(!playing);
  if (!playing) {
    const showcase = event.currentTarget.closest<HTMLElement>('.component-showcase');
    if (showcase !== null) showcase.dataset.motion = 'playback';
  }
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

function renderCategory(
  selected: Preview,
  category: (typeof categories)[number],
): React.JSX.Element {
  return (
    <label className="component-showcase__choice" key={category.id}>
      <input
        type="radio"
        name="showcase-category"
        value={category.first}
        checked={selected.category === category.id}
        aria-controls="showcase-canvas"
        readOnly
      />
      <span>
        <span className="component-showcase__dot" />
        {category.label}
      </span>
    </label>
  );
}

function renderRailChoice(selected: Preview, preview: Preview): React.JSX.Element | null {
  if (preview.category !== selected.category) return null;
  return (
    <label className="component-showcase__choice" key={preview.id}>
      <input
        type="radio"
        name="showcase-component"
        value={preview.id}
        checked={preview.id === selected.id}
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
      <ComponentPreview key={`${preview.id}:${active}`} id={preview.id} active={active} />
    </div>
  );
}

export function ComponentShowcase(): React.JSX.Element {
  const [selected, setSelected] = React.useState<Preview>(previews[0]);
  const [playing, setPlaying] = React.useState(true);
  const visibilityObserver = React.useRef<IntersectionObserver | null>(null);

  return (
    <section
      className="component-showcase"
      aria-label="Wallet component showcase"
      data-playing={playing}
      onPointerDownCapture={setPointerMotion}
      onKeyDownCapture={setKeyboardMotion}
    >
      <div className="component-showcase__heading">
        <span>
          <Layers2 aria-hidden /> The wallet, in components
        </span>
        <button
          type="button"
          className="component-showcase__playback"
          onClick={togglePlayback.bind(null, setPlaying, playing)}
          aria-pressed={playing}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          {playing ? 'Pause demo' : 'Play demo'}
        </button>
      </div>
      <div className="component-showcase__frame">
        <div
          className="component-showcase__categories"
          role="radiogroup"
          aria-label="Component categories"
          onChange={selectPreview.bind(null, setSelected)}
        >
          {categories.map(renderCategory.bind(null, selected))}
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
            <div
              className="component-showcase__position"
              style={{ left: -420, top: 0 }}
              aria-hidden="true"
              ref={setPreviewInert.bind(null, false)}
            >
              <ComponentPreview id="unlock" active={false} />
            </div>
            <div
              className="component-showcase__position"
              style={{ left: 1680, top: 0 }}
              aria-hidden="true"
              ref={setPreviewInert.bind(null, false)}
            >
              <ComponentPreview id="receipt" active={false} />
            </div>
          </div>
          <div className="component-showcase__fade" aria-hidden="true" />
        </div>
      </div>
      <div
        className="component-showcase__rail"
        role="radiogroup"
        aria-label={`${selected.category} components`}
        onChange={selectPreview.bind(null, setSelected)}
      >
        {previews.map(renderRailChoice.bind(null, selected))}
      </div>
      <p className="component-showcase__caption" aria-live="polite">
        <span>{selected.label}</span>
        {captions[selected.category]}
      </p>
    </section>
  );
}
