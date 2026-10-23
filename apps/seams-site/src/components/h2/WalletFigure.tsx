import React from 'react';
/* The custody figures, their embed script and their copy have one source: the
   wallet site's. Importing them keeps both sites' figures the same as that
   site changes them. */
import { figureCatalog } from '../../../../wallet-console/src/marketing/i18n/catalog';
import keychain from '../../../../wallet-console/showcase/motion/keys-maze/index.html?raw';
import interlock from '../../../../wallet-console/showcase/motion/interlock-layers/index.html?raw';
import devices from '../../../../wallet-console/showcase/motion/devices-edge/index.html?raw';
import infrastructure from '../../../../wallet-console/showcase/motion/lockin-boundary/index.html?raw';
import signing from '../../../../wallet-console/showcase/motion/threshold-signing/index.html?raw';
import embed from '../../../../wallet-console/src/components/h2/hairline/embed.js?raw';

/* The front page is English only. */
const locale = 'en';

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
#stage svg { display: block; width: 100%; height: 100%; transform: scale(1.1); transform-origin: center; }
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

function figureEntry(title: string, html: string): { title: string; document: string } {
  return { title, document: figureDocument(html, 200, 160, [[200, 160, 0]]) };
}

const figures = {
  keychain: figureEntry('Keys you control', keychain),
  interlock: figureEntry('Scoped permissions', interlock),
  devices: figureEntry('Linked devices', devices),
  infrastructure: figureEntry('No lock-in', infrastructure),
  signing: figureEntry('Two shares, one signed transaction', signing),
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
