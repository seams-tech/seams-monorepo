/* The site's gradients as data. Every field is a 12 x 12 grid of RGB colours
   that the shader smooths, flows and covers with grain, so no gradient costs
   an image download.

   Two fields are fitted to the original gradient photographs (cubic B-spline
   control points, base64, rows top to bottom; under 3/255 error per channel).
   Every other field is generated from the site's two monochrome colours and
   one or two accents; the type allows nothing else. Make new ones on the
   gradient lab page: /gradients/ on the dev server. */

export const GRAIN_FIELD_GRID_SIZE = 12;

type Accents = readonly [string] | readonly [string, string];

export type GeneratedField = {
  accents: Accents;
  /* CSS linear-gradient angle, from the light colour to the dark one */
  angle: number;
  /* picks the soft variation laid over the gradient line */
  seed: number;
};

export type GrainFieldSource = {
  key: string;
  grid: Uint8Array;
  /* a photograph keeps its shape and crops like background-size: cover; a
     generated field stretches to its box like a CSS gradient */
  fit: 'cover' | 'stretch';
  /* mean colour, shown until the first frame */
  base: string;
};

const LIGHT = '#ffffff';
const DARK = '#101010';
/* every colour moves a quarter of the way to mid grey, as in Shader R */
const CONTRAST = 0.75;
/* how far the variation pushes a point along the gradient line */
const VARIATION = 0.24;
/* lattice points per side for the variation; few, so it bends and never
   breaks up */
const LATTICE = 3;

const PHOTO_FIELDS = {
  'aqua-evergreen':
    'KWVfQH+JVpWnXZmwa6C4baG5eaa7e6m4f666bp6vW5CjJVdubaaZgr23hr7ClMbUnMfaosbarMrbt87ewNXdss3bl8PTVJSyhbmcncnCn83HpMzZpc3drc3ivNfkxtbjxtngvtPcpcXWaqS9nsivtdjDtNfQsdnYrtPfrtDlwtro1OLp0N/sxtnkstLfe67Jqc6wx9/MxOHOutvXp9HTnM7Yqs3bvtjjzeDkwNXfrMrabqnGocmzyeDMx+DNwN/NptPJiMHBhL+/kcDDmMXGk8HCf7jCS46qkcGus9jDwN7NutvIoM+8gbyqZ6ylYqaYYKGOVZuLPo2BJ250a6udoMy/qdDAqtXAl8atarSlUJ2OR5KBNH1jMHFQIFlDD0dBVZWSgr2tj8Syl8eugbykVaGVPJOPK31vI2tRG1RBFko7CTAqKWJraqufda6fdrCYXZ2IO46CJHF1HWhnElJJEko+CzcxCC8oE0FWPoJ7SJJ+RIZzOXlmJmleHmJhFFNWEUlLCzg6CzIyCSkpBx0uDTNDF0ZIE0I4F0E1EjQsEjEzCzA0CjA5CC8xBB8lBiEd',
  'sky-sand':
    'AFWrBVy1BGC5CGTBC2nGCGjIB23KDX3SBXfSBYPVA4fWC3/NC2y+BH7SDYHSDobYE4XZFordGY/gEYvfEJXjF57iIqbhI57UHnO1HYnRGo7VH5XbHpPeHpTgIZjeHpjkH57jKKvmK6/cQK/UQHedQpXFPJjQMqDcLqDbKp3eKp/kLqPmMq/qN7nfVsHZZrLCUW59a5qzZJ28XqbKXKjRVqrVUqrWRbPkULvfc7/RbbjJoa6eXWhvf42QiaCkgqe2jam1k7W8lbTAgbXHlLvEpbSsqbCgqZuCTVpmfYaHjZGNpp+PtrCcwbmfxLyhw7idw7mZwK+ExqJ1yZVuJT1XVm53doCGmp2K0K155b986cOC5b584axx3J5o1pNfwnpeGDVRK05tS2Z7gIiMrZ9637Nw9L5m7qxb6qZd3o1V1IRWv2VODiVBFDxgK0xrYG53g4F1tJhr2qZW56FP4pNH2YNJzWxFrlpGDCdCETBRHjpaSFVoa25rk39hvpBV35dE4Y1G2HI9x2hGmE1BBhktCR84FSc6JC0+PjxITEpJY1JDhGFBoF84lVE4iUU5YjQ0',
} as const;

const GENERATED_FIELDS = {
  ember: { accents: ['#ff7900'], angle: 120, seed: 7 },
  cobalt: { accents: ['#1f5eff'], angle: 150, seed: 3 },
  lime: { accents: ['#9ccc2c'], angle: 135, seed: 11 },
  'cobalt-ember': { accents: ['#1f5eff', '#ff7900'], angle: 160, seed: 5 },
  'mauve-cobalt': { accents: ['#b98ad0', '#1f5eff'], angle: 140, seed: 2 },
} as const satisfies Record<string, GeneratedField>;

export type GrainFieldName = keyof typeof PHOTO_FIELDS | keyof typeof GENERATED_FIELDS;

export const GRAIN_FIELD_NAMES = [
  ...Object.keys(PHOTO_FIELDS),
  ...Object.keys(GENERATED_FIELDS),
] as GrainFieldName[];

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function meanColour(grid: Uint8Array): string {
  const sum = [0, 0, 0];
  for (let i = 0; i < grid.length; i += 1) sum[i % 3] += grid[i];
  const cells = grid.length / 3;
  return `#${sum
    .map((total) =>
      Math.round(total / cells)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/* mulberry32: a small seeded generator, so a seed always gives one layout */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function generateGrid({ accents, angle, seed }: GeneratedField): Uint8Array {
  const size = GRAIN_FIELD_GRID_SIZE;
  const stops = [LIGHT, ...accents, DARK].map((hex) =>
    hexToRgb(hex).map((channel) => (channel - 127.5) * CONTRAST + 127.5),
  );
  const segments = stops.length - 1;
  /* a lattice of values in -1..1, smoothly interpolated over the field */
  const random = seededRandom(seed);
  const lattice = Array.from({ length: LATTICE * LATTICE }, () => random() * 2 - 1);
  const last = LATTICE - 1;
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const span = Math.abs(dx) + Math.abs(dy);
  const grid = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const lx = u * last;
      const ly = v * last;
      const ix = Math.min(Math.floor(lx), last - 1);
      const iy = Math.min(Math.floor(ly), last - 1);
      const fx = smooth(lx - ix);
      const fy = smooth(ly - iy);
      const row = iy * LATTICE + ix;
      const variation = mix(
        mix(lattice[row], lattice[row + 1], fx),
        mix(lattice[row + LATTICE], lattice[row + LATTICE + 1], fx),
        fy,
      );
      const along = 0.5 + ((u - 0.5) * dx + (v - 0.5) * dy) / span;
      const position = Math.min(Math.max(along + variation * VARIATION, 0), 1) * segments;
      const stop = Math.min(Math.floor(position), segments - 1);
      const blend = position - stop;
      for (let channel = 0; channel < 3; channel += 1) {
        grid[(y * size + x) * 3 + channel] = Math.round(
          mix(stops[stop][channel], stops[stop + 1][channel], blend),
        );
      }
    }
  }
  return grid;
}

function decodeGrid(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const sources = new Map<string, GrainFieldSource>();

function cachedSource(
  key: string,
  fit: GrainFieldSource['fit'],
  makeGrid: () => Uint8Array,
): GrainFieldSource {
  const cached = sources.get(key);
  if (cached) return cached;
  const grid = makeGrid();
  const source = { key, grid, fit, base: meanColour(grid) };
  sources.set(key, source);
  return source;
}

export function generatedFieldSource(field: GeneratedField): GrainFieldSource {
  return cachedSource(JSON.stringify(field), 'stretch', () => generateGrid(field));
}

function isPhotoField(field: GrainFieldName): field is keyof typeof PHOTO_FIELDS {
  return Object.hasOwn(PHOTO_FIELDS, field);
}

export function grainFieldSource(field: GrainFieldName | GeneratedField): GrainFieldSource {
  if (typeof field !== 'string') return generatedFieldSource(field);
  if (isPhotoField(field)) {
    return cachedSource(field, 'cover', () => decodeGrid(PHOTO_FIELDS[field]));
  }
  const generated: GeneratedField = GENERATED_FIELDS[field];
  return cachedSource(field, 'stretch', () => generateGrid(generated));
}
