import type { InkColor, InkPoint, InkStroke } from './brush';
import { blob, croissant, type InkScene } from './scenes';

/* Tiles painted in ink: a rounded square of ink with the sign cut out of it, so
   the sign shows the page. Each sign is a few lines on a 64 by 64 square, and a
   sharp corner is two lines. */

type Pt = readonly [number, number];
type Line = readonly Pt[];

const SIZE = 64;
const WIDTH = 4.6;

function arc(cx: number, cy: number, r: number, from: number, to: number): Line {
  const steps = Math.max(6, Math.round(Math.abs(to - from) * 3));
  return Array.from({ length: steps + 1 }, (_, i): Pt => {
    const a = from + ((to - from) * i) / steps;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

function path(...corners: Pt[]): Line[] {
  return corners.slice(1).map((end, i) => [corners[i], end]);
}

const signs = {
  /* a shop front: the scalloped awning, the walls and the door */
  shop: [
    [
      [13, 18],
      [51, 18],
    ],
    arc(22.5, 23, 9, 0.15, Math.PI - 0.15),
    arc(41.5, 23, 9, 0.15, Math.PI - 0.15),
    [
      [18, 33],
      [18, 49],
    ],
    [
      [46, 33],
      [46, 49],
    ],
    [
      [15, 49],
      [49, 49],
    ],
    ...path([28, 49], [28, 41], [36, 41], [36, 49]),
  ],
  /* a shopping bag with its handle */
  bag: [
    ...path([19, 27], [45, 27], [46, 48], [18, 48], [19, 27]),
    arc(32, 27, 7.5, Math.PI, Math.PI * 2),
  ],
  /* a key: the ring, the shaft and two teeth */
  key: [
    arc(21, 32, 8.5, 0, Math.PI * 2),
    [
      [29.5, 32],
      [53, 32],
    ],
    [
      [45, 32],
      [45, 40],
    ],
    [
      [51, 32],
      [51, 38],
    ],
  ],
  /* a pulse across the day */
  activity: path([9, 34], [20, 34], [25, 16], [34, 50], [40, 27], [45, 34], [55, 34]),
  /* an envelope */
  inbox: [
    ...path([14, 21], [50, 21], [50, 44], [14, 44], [14, 21]),
    ...path([14, 21], [32, 34], [50, 21]),
  ],
  /* a channel sign */
  channel: [
    [
      [28, 14],
      [23, 50],
    ],
    [
      [42, 14],
      [37, 50],
    ],
    [
      [15, 26],
      [50, 26],
    ],
    [
      [14, 38],
      [49, 38],
    ],
  ],
} satisfies Record<string, Line[]>;

export type TileSign = keyof typeof signs | 'croissant';

/* the tile: a square pull down and a square pull across, and a round dab of ink
   in each corner, so the square comes out with round corners */
const INSET = 10;
const SLAB = { flat: true, dry: 0.04, rough: 0.3, grain: 0.05, pace: 0.8 } as const;
const TILE: InkStroke[] = [
  {
    ...SLAB,
    pts: [
      [32, 3, 64 - 2 * INSET],
      [32, 61, 64 - 2 * INSET],
    ],
  },
  {
    ...SLAB,
    pts: [
      [3, 32, 64 - 2 * INSET],
      [61, 32, 64 - 2 * INSET],
    ],
  },
  ...[
    [INSET, INSET],
    [64 - INSET, INSET],
    [INSET, 64 - INSET],
    [64 - INSET, 64 - INSET],
  ].map(([x, y]) => blob(x, y, INSET - 3, INSET - 3)),
];

function line(points: Line): InkStroke {
  const last = points.length - 1;
  const pts = points.map(
    ([x, y], i): InkPoint => [x, y, WIDTH * (i === 0 || i === last ? 0.8 : 1.08)],
  );
  return {
    color: 'clear',
    pts:
      pts.length === 2
        ? [pts[0], [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, WIDTH * 1.1], pts[1]]
        : pts,
    dry: 0.1,
    rough: 0.75,
    grain: 0,
    keepLine: true,
  };
}

/* the croissant is cut out whole, then its layers are painted back in ink */
function croissantSign(): InkStroke[] {
  const swap: Partial<Record<InkColor, InkColor>> = { gold: 'clear', clear: 'ink' };
  return croissant(32, 42, 18).map((stroke) => ({
    ...stroke,
    color: swap[stroke.color ?? 'ink'] ?? stroke.color,
    grain: 0,
  }));
}

function signScene(sign: TileSign): InkScene {
  const cut = sign === 'croissant' ? croissantSign() : signs[sign].map(line);
  return { width: SIZE, height: SIZE, parts: [{ id: sign, strokes: [...TILE, ...cut] }] };
}

/* one scene for each sign, made once, so a render never repaints a tile */
export const tileSignScenes: Record<TileSign, InkScene> = {
  shop: signScene('shop'),
  bag: signScene('bag'),
  key: signScene('key'),
  activity: signScene('activity'),
  inbox: signScene('inbox'),
  channel: signScene('channel'),
  croissant: signScene('croissant'),
};
