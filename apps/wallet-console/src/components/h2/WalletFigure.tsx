import React from 'react';
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

function figureDocument(html: string, pointerX: number, pointerY: number): string {
  return `<!doctype html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: light; --muted: #777169; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #fff; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
#stage { width: 100%; height: 100%; touch-action: pan-y; }
#stage:is([data-hairline="scoped-credentials"], [data-hairline="interlock"], [data-hairline="device-linking"], [data-hairline="infrastructure-array"]) { --hairline-stroke: 0.65; }
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
<body><div id="stage" data-pointer-x="${pointerX}" data-pointer-y="${pointerY}"></div><output id="read" aria-live="polite"></output>
<script>${scriptSource(html, 'hl-kernel')}</script>
<script>${embed}</script>
<script type="module">${scriptSource(html, 'hl-figure')}</script>
</body></html>`;
}

const figures = {
  keychain: { title: 'Keys you control', document: figureDocument(keychain, 150, 180) },
  interlock: { title: 'Scoped permissions', document: figureDocument(interlock, 200, 160) },
  devices: { title: 'Linked devices', document: figureDocument(devices, 200, 160) },
  infrastructure: { title: 'Self-hostable', document: figureDocument(infrastructure, 205, 157) },
  signing: {
    title: 'Two shares, one signed transaction',
    document: figureDocument(signing, 200, 160),
  },
};

export type WalletFigureName = keyof typeof figures;

export function WalletFigure({ figure }: { figure: WalletFigureName }): React.JSX.Element {
  const { title, document } = figures[figure];
  return (
    <iframe
      className="h2-wallet-figure"
      data-figure={figure}
      title={title}
      srcDoc={document}
      sandbox="allow-scripts"
      loading="lazy"
    />
  );
}
