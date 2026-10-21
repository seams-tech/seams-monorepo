import React from 'react';
import { locale, t } from '@/marketing/i18n/browser';
import { figureCatalog } from '@/marketing/i18n/catalog';
import keychain from '../../../showcase/motion/credentials/index.html?raw';
import interlock from '../../../showcase/motion/interlock/index.html?raw';
import devices from '../../../showcase/motion/delegation/index.html?raw';
import infrastructure from '../../../showcase/motion/infrastructure-array/index.html?raw';
import signing from '../../../showcase/motion/threshold-signing/index.html?raw';
import embed from './hairline/embed.js?raw';

function scriptSource(html: string, id: 'hl-kernel' | 'hl-figure'): string {
  const start = html.indexOf(`id="${id}"`);
  const contentStart = html.indexOf('>', start) + 1;
  const end = html.indexOf('</script>', contentStart);
  if (start < 0 || end < contentStart) throw new Error(`Missing Hairline script: ${id}`);
  return html.slice(contentStart, end);
}

// Keyframes for the host's synthetic pointer: x and y in the 400 by 320 frame,
// then the time in ms from the start of the play.
type PlayPath = ReadonlyArray<readonly [x: number, y: number, ms: number]>;

function figureDocument(html: string, pointerX: number, pointerY: number, play: PlayPath): string {
  const copy: Record<string, string> = {};
  for (const [key, translation] of Object.entries(figureCatalog)) copy[key] = translation[locale];
  const serializedCopy = JSON.stringify(copy).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="${locale}" data-theme="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: light; --muted: #777169; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #fff; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
#stage { width: 100%; height: 100%; touch-action: pan-y; --hairline-stroke: 0.65; }
#stage svg { display: block; width: 100%; height: 100%; transform: scale(1.22); transform-origin: center; }
#stage[data-hairline="scoped-credentials"] svg { transform: translateX(5%) scale(1.22); }
#stage[data-hairline="interlock"] svg { transform: translateX(2%) scale(1.22); }
#stage[data-hairline="device-linking"] svg,
#stage[data-hairline="infrastructure-array"] svg { transform: translateY(5%) scale(1.22); }
#stage[data-hairline="threshold-signing"] svg { transform: translateX(2.5%) scale(1.44); }
@media (max-width: 480px) {
  #stage[data-hairline="threshold-signing"] svg { transform: translateX(1.5%); }
}
[data-hairline="threshold-signing"] svg text { font-size: 8.2px; letter-spacing: 0.25px; }
#stage:focus-visible { outline: 1px solid #777169; outline-offset: -3px; border-radius: 8px; }
#read { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style></head>
<body><div id="stage" data-pointer-x="${pointerX}" data-pointer-y="${pointerY}" data-play="${play.join(' ')}"></div><output id="read" aria-live="polite"></output>
<script>const walletFigureCopy = ${serializedCopy}; window.walletFigureText = function(key) { return walletFigureCopy[key]; };</script>
<script>${scriptSource(html, 'hl-kernel')}</script>
<script>${embed}</script>
<script type="module">${scriptSource(html, 'hl-figure')}</script>
</body></html>`;
}

// The keychain and the racks answer to where the pointer is, so their plays
// sweep across each key and each cabinet; the lock, the phones and the
// signing diagram run their whole sequence from a single point.
const keychainPlay: PlayPath = [
  [210, 245, 0],
  [210, 245, 450],
  [140, 225, 750],
  [140, 225, 1200],
  [70, 195, 1500],
  [70, 195, 1950],
  [60, 140, 2250],
];
const infrastructurePlay: PlayPath = [
  [145, 100, 0],
  [150, 195, 1000],
  [190, 170, 1500],
  [190, 170, 1900],
  [255, 195, 2400],
];

const figures = {
  keychain: {
    title: t('keysControl'),
    document: figureDocument(keychain, 150, 180, keychainPlay),
  },
  interlock: {
    title: t('scopedPermissions'),
    document: figureDocument(interlock, 200, 160, [[200, 160, 0]]),
  },
  devices: {
    title: t('linkedDevices'),
    document: figureDocument(devices, 200, 160, [[200, 160, 0]]),
  },
  infrastructure: {
    title: t('noLockIn'),
    document: figureDocument(infrastructure, 205, 157, infrastructurePlay),
  },
  signing: {
    title: t('signingFigure'),
    document: figureDocument(signing, 200, 160, [[200, 160, 0]]),
  },
};

export type WalletFigureName = keyof typeof figures;

type HostCommand = 'play' | 'rest' | 'outside';

function sendHostCommand(frame: HTMLIFrameElement | null, command: HostCommand | null): void {
  // The sandboxed figure has an opaque origin, so no narrower target exists.
  if (command) frame?.contentWindow?.postMessage({ hairline: command }, '*');
}

/* `playing` hands the figure to the host page: true plays it as if hovered,
   false returns it to rest. Leave it unset for a figure the page never plays.
   `onHover` hears a visitor's mouse enter (true) and leave (false) the frame. */
export function WalletFigure({
  figure,
  playing,
  onHover,
}: {
  figure: WalletFigureName;
  playing?: boolean;
  onHover?: (inside: boolean) => void;
}): React.JSX.Element {
  const { title, document: source } = figures[figure];
  const frame = React.useRef<HTMLIFrameElement>(null);
  let command: HostCommand | null = null;
  if (playing !== undefined) command = playing ? 'play' : 'rest';
  React.useEffect(() => sendHostCommand(frame.current, command), [command]);
  // A lazy frame loads after the first command, so it receives the latest one again.
  const loaded = React.useCallback(() => sendHostCommand(frame.current, command), [command]);
  React.useEffect(() => {
    if (!onHover) return undefined;
    const hover = onHover;
    let inside = false;
    function release(): void {
      if (!inside) return;
      inside = false;
      document.removeEventListener('pointermove', pointerOutside);
      hover(false);
    }
    // A frame is not always told that the mouse left it, but a pointer event on
    // this page proves that it did.
    function pointerOutside(): void {
      sendHostCommand(frame.current, 'outside');
      release();
    }
    function heard(event: MessageEvent): void {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.hairline === 'leave') release();
      if (event.data?.hairline !== 'hover' || inside) return;
      inside = true;
      document.addEventListener('pointermove', pointerOutside);
      hover(true);
    }
    window.addEventListener('message', heard);
    return () => {
      window.removeEventListener('message', heard);
      document.removeEventListener('pointermove', pointerOutside);
    };
  }, [onHover]);
  return (
    <iframe
      ref={frame}
      className="h2-wallet-figure"
      data-figure={figure}
      title={title}
      srcDoc={source}
      sandbox="allow-scripts"
      loading="lazy"
      onLoad={loaded}
    />
  );
}
