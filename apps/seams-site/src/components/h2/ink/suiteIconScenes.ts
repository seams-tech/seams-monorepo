import type { InkPoint, InkStroke } from './brush';
import { blob, type InkScene } from './scenes';

/* The Satyr suite's app icons for the home hero: each is a torn square of ink
   with its sign cut out of it, so the sign shows the paper. */

type Pt = readonly [number, number];
type Line = readonly Pt[];

const SIZE = 64;

/* the sign of each app, as lines in a 64 by 64 square; a sharp corner is two lines */
function box(x0: number, y0: number, x1: number, y1: number): Line[] {
  return [
    [
      [x0, y0],
      [x1, y0 + 0.4],
    ],
    [
      [x1, y0],
      [x1 + 0.4, y1],
    ],
    [
      [x1, y1],
      [x0, y1 - 0.3],
    ],
    [
      [x0, y1],
      [x0 - 0.3, y0],
    ],
  ];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): Line {
  const steps = 6;
  return Array.from({ length: steps + 1 }, (_, i): Pt => {
    const a = from + ((to - from) * i) / steps;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

type Sign = { lines: Line[]; dots?: readonly (readonly [number, number, number])[] };

const signs = {
  shop: {
    lines: [...box(19, 27, 45, 47), arc(32, 27, 7, Math.PI, Math.PI * 2)],
  },
  menu: {
    lines: [...box(14, 14, 28, 28), ...box(36, 14, 50, 28), ...box(14, 36, 28, 50)],
    dots: [
      [21, 21, 2.8],
      [43, 21, 2.8],
      [21, 43, 2.8],
      [40, 40, 2.3],
      [48, 42, 2.1],
      [43, 48, 2.3],
    ],
  },
  inbox: {
    lines: [
      ...box(15, 21, 49, 44),
      [
        [15, 21],
        [32, 34],
      ],
      [
        [32, 34],
        [49, 21],
      ],
    ],
  },
  kitchen: {
    lines: [
      [
        [22, 38],
        [18, 29],
        [22, 21],
        [29, 19],
        [32, 15],
        [36, 19],
        [43, 21],
        [46, 29],
        [42, 38],
      ],
      ...box(22, 38, 42, 47),
    ],
  },
  stock: {
    lines: [
      [
        [32, 14],
        [48, 22],
      ],
      [
        [48, 22],
        [48, 41],
      ],
      [
        [48, 41],
        [32, 50],
      ],
      [
        [32, 50],
        [16, 41],
      ],
      [
        [16, 41],
        [16, 22],
      ],
      [
        [16, 22],
        [32, 14],
      ],
      [
        [16, 22],
        [32, 31],
      ],
      [
        [32, 31],
        [48, 22],
      ],
      [
        [32, 31],
        [32, 50],
      ],
    ],
  },
  payments: {
    lines: [
      ...box(15, 21, 49, 46),
      [
        [49, 29],
        [37, 29],
      ],
      [
        [37, 29],
        [37, 39],
      ],
      [
        [37, 39],
        [49, 39],
      ],
    ],
    dots: [[42, 34, 1.9]],
  },
  devices: {
    lines: [
      ...box(15, 35, 49, 47),
      [
        [40, 35],
        [42, 25],
      ],
      arc(42, 23, 5, Math.PI * 1.15, Math.PI * 1.85),
      arc(42, 23, 10, Math.PI * 1.2, Math.PI * 1.8),
    ],
    dots: [
      [22, 41, 1.8],
      [28, 41, 1.8],
    ],
  },
  brain: {
    /* two lobes, each three bumps, and the fold between them */
    lines: [
      arc(26, 21, 7, Math.PI * 0.9, Math.PI * 1.75),
      arc(21, 31, 7, Math.PI * 0.6, Math.PI * 1.3),
      arc(26, 41, 7, Math.PI * 0.25, Math.PI * 0.95),
      arc(38, 21, 7, -Math.PI * 0.75, Math.PI * 0.1),
      arc(43, 31, 7, -Math.PI * 0.3, Math.PI * 0.4),
      arc(38, 41, 7, Math.PI * 0.05, Math.PI * 0.75),
      [
        [32, 15],
        [32, 48],
      ],
      [
        [25, 28],
        [28, 33],
      ],
      [
        [39, 28],
        [36, 33],
      ],
    ],
  },
} satisfies Record<string, Sign>;

export type SuiteIcon = keyof typeof signs;

function line(points: Line, width: number): InkStroke {
  const last = points.length - 1;
  const pts = points.map(([x, y], i): InkPoint => {
    /* a little swell in the middle and a lighter touch at each end */
    const edge = i === 0 || i === last ? 0.78 : 1.08;
    return [x, y, width * edge];
  });
  return {
    color: 'clear',
    pts: pts.length === 2 ? [pts[0], midpoint(pts[0], pts[1], width * 1.1), pts[1]] : pts,
    dry: 0.1,
    rough: 0.75,
    grain: 0,
    keepLine: true,
  };
}

function midpoint(a: InkPoint, b: InkPoint, width: number): InkPoint {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, width];
}

export function suiteIconScene(name: SuiteIcon): InkScene {
  const sign: Sign = signs[name];
  const tile: InkStroke = {
    flat: true,
    dry: 0.05,
    rough: 0.28,
    grain: 0.05,
    pace: 0.8,
    pts: [
      [32, 6, 50],
      [32, 32, 53],
      [32, 58, 51],
    ],
  };
  const dots = (sign.dots ?? []).map(([x, y, r]) => blob(x, y, r * 1.1, r * 1.1, 'clear'));
  return {
    width: SIZE,
    height: SIZE,
    parts: [
      {
        id: name,
        strokes: [tile, ...sign.lines.map((points) => line(points, 3.6)), ...dots],
      },
    ],
  };
}
