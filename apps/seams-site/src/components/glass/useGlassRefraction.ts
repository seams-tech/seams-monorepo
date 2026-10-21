import React from 'react';

/* Edge refraction for glass cards, after Aave's "Building Glass for the Web":
   a displacement map built from the card's rounded-rectangle shape drives an
   SVG feDisplacementMap. Pixels near the rim are pushed along the edge normal,
   so the backdrop bends like light through curved glass, and the flat centre
   is left alone.

   Only Chromium runs an SVG filter inside `backdrop-filter`, so the hook does
   nothing elsewhere; the CSS glass (blur, rim light, highlight) still shows. */

export type GlassRefractionOptions = {
  /** Corner radius of the card, in CSS pixels. */
  radius: number;
  /** Width of the curved rim that bends light, in CSS pixels. */
  bezel?: number;
  /** Strength of the bend, in CSS pixels of displacement at the very edge. */
  scale?: number;
  /** Frosting applied to the backdrop before it bends. */
  blur?: number;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function runsBackdropSvgFilters(): boolean {
  const nav = navigator as Navigator & {
    userAgentData?: { brands?: readonly { brand: string }[] };
  };
  return !!nav.userAgentData?.brands?.some((entry) => entry.brand === 'Chromium');
}

/* Red and green hold the x and y push, centred on 128; outside the rim the map
   is neutral. The rounded rectangle has four-fold symmetry, but the cards are
   small, so the whole map is computed directly. */
function displacementMap(width: number, height: number, radius: number, bezel: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(width, height);
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(radius, halfW, halfH);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = x + 0.5 - halfW;
      const py = y + 0.5 - halfH;
      const qx = Math.abs(px) - (halfW - r);
      const qy = Math.abs(py) - (halfH - r);
      // Signed distance to the rounded edge: negative inside.
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const distance = outside + Math.min(Math.max(qx, qy), 0) - r;
      const depth = -distance;
      let dx = 0;
      let dy = 0;
      if (depth > 0 && depth < bezel) {
        // A curved surface: the bend grows fast towards the rim.
        const strength = (1 - depth / bezel) ** 2;
        let nx: number;
        let ny: number;
        if (qx > 0 && qy > 0) {
          nx = (qx / outside) * Math.sign(px);
          ny = (qy / outside) * Math.sign(py);
        } else if (qx > qy) {
          nx = Math.sign(px);
          ny = 0;
        } else {
          nx = 0;
          ny = Math.sign(py);
        }
        dx = nx * strength;
        dy = ny * strength;
      }
      const offset = (y * width + x) * 4;
      image.data[offset] = Math.round(128 + dx * 127);
      image.data[offset + 1] = Math.round(128 + dy * 127);
      image.data[offset + 2] = 128;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

export function useGlassRefraction<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  { radius, bezel = 16, scale = 36, blur = 12 }: GlassRefractionOptions,
): void {
  const baseId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');

  React.useEffect(() => {
    const element = ref.current;
    if (!element || !runsBackdropSvgFilters()) return undefined;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    const defs = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defs);
    document.body.appendChild(svg);

    let version = 0;
    let lastSize = '';
    const update = () => {
      const width = Math.round(element.offsetWidth);
      const height = Math.round(element.offsetHeight);
      if (width === 0 || height === 0) return;
      const size = `${width}x${height}`;
      if (size === lastSize) return;
      lastSize = size;
      // A fresh id per map, so no browser keeps serving a cached filter output.
      version += 1;
      const id = `glass-${baseId}-${version}`;
      const filter = document.createElementNS(SVG_NS, 'filter');
      filter.setAttribute('id', id);
      filter.setAttribute('filterUnits', 'userSpaceOnUse');
      filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
      filter.setAttribute('x', '0');
      filter.setAttribute('y', '0');
      filter.setAttribute('width', String(width));
      filter.setAttribute('height', String(height));
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      const map = document.createElementNS(SVG_NS, 'feImage');
      map.setAttribute('href', displacementMap(width, height, radius, bezel));
      map.setAttribute('x', '0');
      map.setAttribute('y', '0');
      map.setAttribute('width', String(width));
      map.setAttribute('height', String(height));
      map.setAttribute('result', 'map');
      const displace = document.createElementNS(SVG_NS, 'feDisplacementMap');
      displace.setAttribute('in', 'SourceGraphic');
      displace.setAttribute('in2', 'map');
      displace.setAttribute('scale', String(scale));
      displace.setAttribute('xChannelSelector', 'R');
      displace.setAttribute('yChannelSelector', 'G');
      filter.append(map, displace);
      defs.replaceChildren(filter);
      element.style.backdropFilter = `blur(${blur}px) saturate(160%) url(#${id})`;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      svg.remove();
      element.style.backdropFilter = '';
    };
  }, [ref, baseId, radius, bezel, scale, blur]);
}
