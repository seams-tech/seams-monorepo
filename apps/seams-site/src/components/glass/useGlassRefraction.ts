import React from 'react';

/* Edge refraction for glass cards, after Aave's "Building Glass for the Web":
   a displacement map built from the card's rounded-rectangle shape drives an
   SVG feDisplacementMap. Pixels in the curved rim are pulled from further inside
   the card, so the backdrop stretches and bends like light through a rounded
   glass edge, and the flat centre stays sharp. The pull points inwards because a
   backdrop filter sees only the pixels behind the card itself. The red, green, and blue channels bend by slightly
   different amounts, which gives the colour fringe of real glass.

   Only Chromium runs an SVG filter inside `backdrop-filter`, so the hook does
   nothing elsewhere; the CSS glass (blur, rim light, highlight) still shows. */

export type GlassRefractionOptions = {
  /** Corner radius of the card, in CSS pixels. */
  radius: number;
  /** Width of the curved rim that bends light, in CSS pixels. */
  bezel?: number;
  /** Strength of the bend: the pull at the very edge is half of it, in CSS pixels. */
  scale?: number;
  /** Extra bend for green and blue, as a fraction of `scale`: the colour fringe. */
  dispersion?: number;
  /** Frosting applied to the backdrop before it bends, in CSS pixels. */
  blur?: number;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function runsBackdropSvgFilters(): boolean {
  const nav = navigator as Navigator & {
    userAgentData?: { brands?: readonly { brand: string }[] };
  };
  return !!nav.userAgentData?.brands?.some((entry) => entry.brand === 'Chromium');
}

/* Red and green hold the x and y pull, centred on 128; outside the rim the map
   is neutral. The pull points inwards, is strongest at the edge, and eases to
   zero at the inner end of the rim, like the slope of a rounded glass edge. */
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
      const depth = -(outside + Math.min(Math.max(qx, qy), 0) - r);
      let dx = 0;
      let dy = 0;
      if (depth > 0 && depth < bezel) {
        const t = depth / bezel;
        const strength = (1 - t) * (1 - t) * (1 + 2 * t);
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
        dx = -nx * strength;
        dy = -ny * strength;
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

function svgElement(name: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

const CHANNELS = [
  { name: 'r', matrix: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
  { name: 'g', matrix: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0' },
  { name: 'b', matrix: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0' },
] as const;

export function useGlassRefraction<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  { radius, bezel = 30, scale = 90, dispersion = 0.12, blur = 1.5 }: GlassRefractionOptions,
): void {
  const baseId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');

  React.useEffect(() => {
    const element = ref.current;
    if (!element || !runsBackdropSvgFilters()) return undefined;

    const svg = svgElement('svg', { 'aria-hidden': 'true', width: '0', height: '0' });
    (svg as SVGSVGElement).style.position = 'absolute';
    const defs = svgElement('defs', {});
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
      const box = { x: '0', y: '0', width: String(width), height: String(height) };
      const filter = svgElement('filter', {
        id,
        filterUnits: 'userSpaceOnUse',
        primitiveUnits: 'userSpaceOnUse',
        'color-interpolation-filters': 'sRGB',
        ...box,
      });
      filter.append(
        svgElement('feGaussianBlur', {
          in: 'SourceGraphic',
          stdDeviation: String(blur),
          edgeMode: 'duplicate',
          result: 'frost',
        }),
        svgElement('feImage', {
          href: displacementMap(width, height, radius, bezel),
          ...box,
          result: 'map',
        }),
      );
      // Bend each colour channel on its own, a little more for green and blue.
      CHANNELS.forEach((channel, index) => {
        filter.append(
          svgElement('feDisplacementMap', {
            in: 'frost',
            in2: 'map',
            scale: String(scale * (1 + dispersion * index)),
            xChannelSelector: 'R',
            yChannelSelector: 'G',
            result: `${channel.name}-bent`,
          }),
          svgElement('feColorMatrix', {
            in: `${channel.name}-bent`,
            type: 'matrix',
            values: channel.matrix,
            result: channel.name,
          }),
        );
      });
      filter.append(
        svgElement('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }),
        svgElement('feBlend', { in: 'rg', in2: 'b', mode: 'screen' }),
      );
      defs.replaceChildren(filter);
      element.style.backdropFilter = `url(#${id}) saturate(150%)`;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      svg.remove();
      element.style.backdropFilter = '';
    };
  }, [ref, baseId, radius, bezel, scale, dispersion, blur]);
}
