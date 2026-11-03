import type { InkColor, InkPoint, InkStroke } from './brush';

/* The site's drawings, in the style of a croissant that flies itself over wheat. */

export type InkMotion = {
  readonly kind: 'sway' | 'bob' | 'drift' | 'flap' | 'breathe' | 'rise' | 'fall';
  readonly amount: string;
  readonly seconds: number;
  readonly delay?: number;
  readonly origin?: readonly [number, number];
};

export type InkPart = {
  readonly id: string;
  readonly strokes: readonly InkStroke[];
  readonly motions?: readonly InkMotion[];
  /* seconds to wait before this part starts */
  readonly pause?: number;
  /* the second at which this part starts, in place of after the part before it */
  readonly at?: number;
  /* its strokes grow at nearly the same time, in place of one after another */
  readonly together?: boolean;
};

export type InkScene = {
  readonly width: number;
  readonly height: number;
  readonly parts: readonly InkPart[];
};

type Pt = readonly [number, number];

/* A brush is wide across its travel, so a short wide stroke makes a bar. A round
   shape swells and narrows along its own height instead. */
export function blob(
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: InkColor = 'ink',
): InkStroke {
  return {
    color,
    grain: color === 'clear' ? 0 : 0.02,
    rough: 0.35,
    pts: [
      [x, y - ry, rx * 0.8],
      [x, y - ry * 0.55, rx * 1.72],
      [x, y, rx * 2],
      [x, y + ry * 0.55, rx * 1.72],
      [x, y + ry, rx * 0.8],
    ],
  };
}

/* ---------- the croissant kite ---------- */

/* one fat crescent with its tips turned down, then its layers cut out across it */
export function croissant(
  cx: number,
  cy: number,
  radius: number,
  thickness = radius / 40,
): InkStroke[] {
  const size = thickness;
  const reach = (size * 40) / radius;
  const at = (angle: number, r: number): [number, number] => [
    cx + Math.sin(angle) * r,
    cy - Math.cos(angle) * r,
  ];
  const body: [number, number, number][] = [];
  for (let i = 0; i <= 8; i += 1) {
    const angle = -1.72 + (i / 8) * 3.44;
    const [x, y] = at(angle, radius);
    body.push([x, y, (5 + 37 * Math.pow(Math.cos((angle / 1.72) * (Math.PI / 2)), 0.72)) * size]);
  }
  const cuts = [-1.12, -0.62, -0.2, 0.22, 0.64, 1.14].map((angle): InkStroke => {
    const [ax, ay] = at(angle - 0.1, radius * (1 - 0.5 * reach));
    const [bx, by] = at(angle + 0.06, radius);
    const [ex, ey] = at(angle + 0.2, radius * (1 + 0.56 * reach));
    return {
      color: 'clear',
      dry: 0.26,
      rough: 0.9,
      grain: 0,
      pts: [
        [ax, ay, 1.2 * size],
        [bx, by, 3.2 * size],
        [ex, ey, 1.2 * size],
      ],
    };
  });
  return [{ color: 'gold', pts: body, dry: 0.12, rough: 0.7, grain: 0.05, pace: 0.8 }, ...cuts];
}

const KITE_TIE: Pt = [642, 120];
const KITE_MIDDLE: Pt = [642, 78];

/* the line from a holding point up to the kite, then the kite and its tail */
function kiteParts(hold: Pt): InkPart[] {
  const sway: readonly InkMotion[] = [
    { kind: 'sway', amount: '0.6deg', seconds: 4.3, origin: hold },
    { kind: 'sway', amount: '0.28deg', seconds: 1.9, delay: -0.8, origin: hold },
  ];
  const mid1: Pt = [
    hold[0] + (KITE_TIE[0] - hold[0]) * 0.34,
    hold[1] + (KITE_TIE[1] - hold[1]) * 0.28,
  ];
  const mid2: Pt = [
    hold[0] + (KITE_TIE[0] - hold[0]) * 0.68,
    hold[1] + (KITE_TIE[1] - hold[1]) * 0.66,
  ];
  return [
    {
      id: 'line',
      pause: 0.08,
      motions: sway,
      strokes: [
        {
          pts: [
            [hold[0], hold[1], 1.8],
            [mid1[0], mid1[1], 1.8],
            [mid2[0], mid2[1], 1.5],
            [KITE_TIE[0], KITE_TIE[1], 2],
          ],
          dry: 0.18,
          rough: 1,
          pace: 1.6,
        },
      ],
    },
    {
      id: 'kite',
      motions: [...sway, { kind: 'sway', amount: '4.5deg', seconds: 3.1, origin: KITE_TIE }],
      strokes: [
        ...croissant(KITE_MIDDLE[0], KITE_MIDDLE[1], 40),
        /* the two lines from its tips to the knot */
        {
          pts: [
            [602, 86, 1],
            [KITE_TIE[0], KITE_TIE[1], 1.2],
          ],
          dry: 0.3,
          rough: 1,
          pace: 2,
        },
        {
          pts: [
            [682, 86, 1],
            [KITE_TIE[0], KITE_TIE[1], 1.2],
          ],
          dry: 0.3,
          rough: 1,
          pace: 2,
        },
        /* its tail in the margin beside the card, with two knots of colour */
        {
          pts: [
            [684, 92, 2],
            [716, 122, 1.4],
            [722, 158, 1.8],
            [738, 196, 0.8],
          ],
          dry: 0.44,
          rough: 1,
        },
        {
          pts: [
            [708, 112, 7],
            [716, 116, 2],
            [726, 112, 7],
          ],
          color: 'gold',
          rough: 0.8,
          dry: 0.2,
        },
        {
          pts: [
            [713, 158, 6],
            [722, 160, 2],
            [731, 156, 6],
          ],
          color: 'gold',
          rough: 0.8,
          dry: 0.2,
        },
      ],
    },
    {
      id: 'birds',
      pause: 0.1,
      motions: [{ kind: 'drift', amount: '26px', seconds: 19 }],
      strokes: [
        {
          pts: [
            [372, 90, 1],
            [382, 85, 3.4],
            [388, 89, 1],
          ],
          dry: 0.3,
        },
        {
          pts: [
            [388, 89, 1],
            [396, 84, 2.6],
            [404, 86, 0.8],
          ],
          dry: 0.3,
        },
        {
          pts: [
            [338, 112, 0.6],
            [343, 109, 1.8],
            [347, 111, 0.6],
          ],
          dry: 0.3,
        },
        {
          pts: [
            [347, 111, 0.6],
            [351, 108, 1.5],
            [355, 109, 0.5],
          ],
          dry: 0.3,
        },
      ],
    },
  ];
}

/* ---------- wheat ---------- */

/* a small stable random, so the wheat keeps its shape between page loads */
function shaper(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

function bezierAt(a: Pt, b: Pt, c: Pt, t: number): [number, number, number, number] {
  const m = 1 - t;
  const x = m * m * a[0] + 2 * m * t * b[0] + t * t * c[0];
  const y = m * m * a[1] + 2 * m * t * b[1] + t * t * c[1];
  const dx = 2 * m * (b[0] - a[0]) + 2 * t * (c[0] - b[0]);
  const dy = 2 * m * (b[1] - a[1]) + 2 * t * (c[1] - b[1]);
  const l = Math.hypot(dx, dy) || 1;
  return [x, y, dx / l, dy / l];
}

/* one stalk: a dry stem, then an ear of loaded dabs with long whiskers */
export function wheat(
  id: string,
  base: Pt,
  bend: Pt,
  tip: Pt,
  seed: number,
  size: number,
  color: InkColor = 'ink',
): InkPart[] {
  const shape = shaper(seed);
  const earStart = 0.66;
  const stem: [number, number, number][] = [];
  for (let i = 0; i <= 6; i += 1) {
    const t = (i / 6) * (earStart + 0.3);
    const [x, y] = bezierAt(base, bend, tip, t);
    stem.push([x, y, (3.4 - 2.4 * (i / 6)) * size]);
  }
  const [earX, earY] = bezierAt(base, bend, tip, earStart);
  const strokes: InkStroke[] = [];
  const rows = 9;
  for (let row = 0; row < rows; row += 1) {
    for (const side of [-1, 1]) {
      const t = earStart + ((row + (side > 0 ? 0.5 : 0)) / rows) * (1 - earStart);
      const [x, y, dx, dy] = bezierAt(base, bend, tip, t);
      const fade = 1 - (row / rows) * 0.5;
      const length = (15 + shape() * 5) * size * fade;
      const spread = (0.52 + shape() * 0.16) * side;
      const gx = dx * Math.cos(spread) - dy * Math.sin(spread);
      const gy = dx * Math.sin(spread) + dy * Math.cos(spread);
      strokes.push({
        color,
        dry: 0.22,
        rough: 0.85,
        grain: 0.06,
        pace: 1.5,
        pts: [
          [x, y, 2 * size],
          [x + gx * length * 0.5, y + gy * length * 0.5, (7.6 + shape() * 2) * size * fade],
          [x + gx * length, y + gy * length, 1.4 * size],
        ],
      });
      const whisker = (24 + shape() * 20) * size * fade;
      const ax = gx * 0.86 + dx * 0.32;
      const ay = gy * 0.86 + dy * 0.32;
      strokes.push({
        dry: 0.62,
        rough: 1,
        grain: 0.02,
        pace: 2.4,
        pts: [
          [x + gx * length, y + gy * length, 1.2 * size],
          [x + gx * length + ax * whisker, y + gy * length + ay * whisker, 0.5 * size],
        ],
      });
    }
  }
  return [
    {
      id: `${id}-stem`,
      motions: [
        { kind: 'sway', amount: '0.8deg', seconds: 3.7 + (seed % 7) * 0.31, origin: base },
        { kind: 'sway', amount: '0.3deg', seconds: 1.73, delay: -(seed % 5) * 0.3, origin: base },
      ],
      strokes: [{ pts: stem, dry: 0.5, rough: 0.9, pace: 1.6, keepLine: true }],
    },
    {
      id: `${id}-ear`,
      together: true,
      motions: [
        { kind: 'sway', amount: '0.8deg', seconds: 3.7 + (seed % 7) * 0.31, origin: base },
        { kind: 'sway', amount: '0.3deg', seconds: 1.73, delay: -(seed % 5) * 0.3, origin: base },
        { kind: 'sway', amount: '2.2deg', seconds: 2.3 + (seed % 3) * 0.37, origin: [earX, earY] },
      ],
      strokes,
    },
  ];
}

/* ---------- the baby goat: the hero, and the shop flies itself ---------- */

const MOUTH: Pt = [249, 387];

export const goatScene: InkScene = {
  width: 760,
  height: 520,
  parts: [
    ...wheat('tall', [272, 545], [420, 310], [552, 24], 41, 1.0),
    ...wheat('under-a', [430, 545], [500, 500], [640, 452], 977, 0.92),
    ...wheat('under-b', [566, 545], [640, 510], [752, 462], 7321, 0.82),
    ...wheat('under-c', [330, 545], [372, 505], [470, 468], 2203, 0.78),
    /* the wheat stands much taller than the goat */
    ...wheat('behind-a', [118, 545], [84, 450], [122, 346], 6101, 0.98),
    ...wheat('behind-b', [52, 545], [30, 480], [62, 400], 5021, 0.86),
    {
      id: 'kid-far-legs',
      strokes: [
        {
          pts: [
            [158, 448, 10],
            [161, 468, 5.5],
            [158, 488, 5.5],
          ],
          grain: 0.03,
        },
        {
          pts: [
            [190, 448, 10],
            [188, 468, 5.5],
            [183, 488, 5.5],
          ],
          grain: 0.03,
        },
      ],
    },
    {
      id: 'kid-tail',
      motions: [
        { kind: 'sway', amount: '14deg', seconds: 0.47, origin: [134, 428] },
        { kind: 'sway', amount: '5deg', seconds: 2.1, origin: [134, 428] },
      ],
      strokes: [
        {
          pts: [
            [140, 432, 9],
            [126, 418, 8],
            [120, 406, 2],
          ],
          dry: 0.16,
          rough: 0.9,
          grain: 0.01,
        },
      ],
    },
    {
      id: 'kid-body',
      strokes: [
        /* long, thin legs with knobbly knees */
        {
          pts: [
            [146, 446, 14],
            [139, 466, 7.5],
            [144, 488, 6.5],
          ],
          grain: 0.03,
        },
        {
          pts: [
            [200, 444, 12],
            [205, 466, 7.5],
            [210, 488, 6.5],
          ],
          grain: 0.03,
        },
        /* a small round body */
        {
          pts: [
            [132, 436, 20],
            [150, 434, 40],
            [172, 433, 47],
            [194, 431, 43],
            [210, 425, 22],
          ],
          dry: 0.03,
          rough: 0.7,
          grain: 0.03,
          pace: 0.7,
        },
        /* the neck */
        {
          pts: [
            [200, 428, 26],
            [212, 408, 19],
            [218, 396, 17],
          ],
          grain: 0.02,
          rough: 0.7,
        },
        /* a white patch on the flank and a sock, so the body stays light */
        {
          color: 'clear',
          pts: [
            [150, 428, 5],
            [161, 431, 14],
            [174, 434, 11],
            [184, 442, 2],
          ],
          dry: 0.2,
          rough: 1,
          grain: 0,
        },
        {
          color: 'clear',
          pts: [
            [201, 470, 5],
            [206, 480, 6.5],
            [209, 486, 5],
          ],
          dry: 0.1,
          rough: 0.8,
          grain: 0,
        },
      ],
    },
    {
      id: 'kid-bell',
      pause: 0.06,
      motions: [{ kind: 'sway', amount: '10deg', seconds: 0.9, origin: [212, 414] }],
      strokes: [blob(214, 424, 4.6, 5, 'gold')],
    },
    {
      id: 'kid-head',
      /* it turns around the mouth, so the line stays in the mouth */
      motions: [{ kind: 'sway', amount: '1.6deg', seconds: 2.2, origin: MOUTH }],
      strokes: [
        /* two small horn buds */
        {
          pts: [
            [219, 383, 6],
            [215, 373, 5],
            [212, 369, 2],
          ],
          grain: 0.01,
          rough: 0.25,
        },
        {
          pts: [
            [228, 381, 5.5],
            [227, 372, 4.5],
            [224, 367, 1.8],
          ],
          grain: 0.01,
          rough: 0.25,
        },
        /* a head that is big for the body */
        blob(222, 396, 17, 16),
        /* the muzzle, tipped up to the line */
        {
          pts: [
            [226, 396, 22],
            [238, 392, 16],
            [248, 388, 10],
          ],
          grain: 0.01,
          rough: 0.25,
        },
        /* a big, soft eye */
        blob(229, 389, 4.4, 4.4, 'clear'),
        blob(230, 389.5, 2.5, 2.5),
      ],
    },
    {
      id: 'kid-ear',
      motions: [{ kind: 'sway', amount: '7deg', seconds: 1.4, origin: [214, 388] }],
      strokes: [
        {
          pts: [
            [216, 386, 6],
            [202, 391, 11],
            [191, 404, 3.4],
          ],
          grain: 0.01,
          rough: 0.4,
        },
      ],
    },
    ...wheat('front-a', [84, 545], [104, 505], [160, 498], 1313, 0.56),
    ...kiteParts(MOUTH),
  ],
};

/* ---------- sparrows: the other banners ---------- */

type Facing = 1 | -1;

/* a sparrow standing with its feet at x, y */
function perched(x: number, y: number, k: number, facing: Facing): InkStroke[] {
  const at = (px: number, py: number): [number, number] => [x + px * k * facing, y + py * k];
  const pts = (list: readonly InkPoint[]): InkPoint[] =>
    list.map(([px, py, w]): InkPoint => [...at(px, py), w * k]);
  return [
    {
      pts: pts([
        [-10, -14, 11],
        [-32, -4, 8],
        [-50, 12, 1.6],
      ]),
      dry: 0.24,
      rough: 0.8,
      grain: 0.02,
    },
    {
      pts: pts([
        [-4, -9, 1.6],
        [-2, 0, 1.3],
      ]),
      grain: 0,
    },
    {
      pts: pts([
        [6, -9, 1.6],
        [3, 0, 1.3],
      ]),
      grain: 0,
    },
    blob(...at(0, -22), 19 * k, 17 * k),
    blob(...at(18, -38), 14 * k, 13 * k),
    {
      pts: pts([
        [28, -39, 5.5],
        [37, -38, 1],
      ]),
      grain: 0,
    },
    blob(...at(21, -42), 3.8 * k, 3.8 * k, 'paper'),
    blob(...at(22, -41.5), 2 * k, 2 * k),
    {
      color: 'paper',
      pts: pts([
        [-12, -32, 1.6],
        [0, -18, 3],
        [12, -14, 1],
      ]),
      dry: 0.3,
      rough: 1,
      grain: 0,
    },
  ];
}

/* a part for one standing sparrow, which shifts its weight on its feet */
export function sparrowPart(
  id: string,
  x: number,
  y: number,
  k: number,
  facing: Facing,
  seconds: number,
  carrier: readonly InkMotion[] = [],
): InkPart {
  return {
    id,
    pause: 0.05,
    motions: [
      ...carrier,
      { kind: 'sway', amount: '2.4deg', seconds, delay: -seconds / 2, origin: [x, y] },
    ],
    strokes: perched(x, y, k, facing),
  };
}

/* a sparrow in flight, with its near wing as its own part so that it can beat */
export function flying(
  id: string,
  x: number,
  y: number,
  k: number,
  facing: Facing,
  seconds: number,
): InkPart[] {
  const at = (px: number, py: number): [number, number] => [x + px * k * facing, y + py * k];
  const pts = (list: readonly InkPoint[]): InkPoint[] =>
    list.map(([px, py, w]): InkPoint => [...at(px, py), w * k]);
  const glide: InkMotion = { kind: 'bob', amount: '2.5px', seconds: 1.7, delay: -seconds };
  return [
    {
      id: `${id}-far-wing`,
      motions: [
        glide,
        { kind: 'flap', amount: '0.45', seconds, delay: -seconds * 0.3, origin: at(4, -6) },
      ],
      strokes: [
        {
          pts: pts([
            [8, -8, 8],
            [12, -26, 11],
            [6, -40, 2],
          ]),
          dry: 0.2,
          rough: 0.9,
          grain: 0.02,
        },
      ],
    },
    {
      id: `${id}-body`,
      motions: [glide],
      strokes: [
        {
          pts: pts([
            [-14, 0, 10],
            [-36, 5, 8],
            [-50, 8, 2],
          ]),
          dry: 0.24,
          rough: 0.8,
          grain: 0.02,
        },
        {
          pts: pts([
            [-22, 0, 8],
            [-6, -1, 24],
            [10, -3, 22],
            [20, -6, 12],
          ]),
          grain: 0.02,
          rough: 0.5,
        },
        blob(...at(20, -9), 12 * k, 11 * k),
        {
          pts: pts([
            [29, -10, 5],
            [38, -10, 1],
          ]),
          grain: 0,
        },
        blob(...at(23, -12), 3.2 * k, 3.2 * k, 'clear'),
        blob(...at(24, -11.6), 1.8 * k, 1.8 * k),
      ],
    },
    {
      id: `${id}-near-wing`,
      motions: [glide, { kind: 'flap', amount: '0.4', seconds, origin: at(-2, -6) }],
      strokes: [
        {
          pts: pts([
            [0, -7, 11],
            [-8, -26, 15],
            [-24, -46, 3],
          ]),
          dry: 0.2,
          rough: 0.9,
          grain: 0.02,
        },
      ],
    },
  ];
}

const BANNER_WIDTH = 620;
const BANNER_HEIGHT = 196;

/* Connects to the tools: sparrows gather on one line */
const WIRE_A: Pt = [40, 106];
const WIRE_B: Pt = [310, 164];
const WIRE_C: Pt = [632, 26];

function onWire(t: number): Pt {
  const [x, y] = bezierAt(WIRE_A, WIRE_B, WIRE_C, t);
  return [x, y];
}

export const wireScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    {
      id: 'wire',
      strokes: [
        {
          pts: [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => [...onWire(t), 1.5] as const),
          dry: 0.16,
          rough: 0.9,
          pace: 1.6,
        },
      ],
    },
    sparrowPart('one', ...onWire(0.24), 0.78, 1, 1.9),
    sparrowPart('two', ...onWire(0.34), 0.66, -1, 2.3),
    sparrowPart('three', ...onWire(0.47), 0.82, 1, 2.7),
    sparrowPart('four', ...onWire(0.92), 0.7, -1, 2.1),
    ...flying('arriving', 118, 40, 0.7, 1, 0.21),
  ],
};

/* One suite: three sparrows share one stalk of wheat */
const STALK_A: Pt = [150, 225];
const STALK_B: Pt = [206, 100];
const STALK_C: Pt = [396, 18];

function onStalk(t: number): Pt {
  const [x, y] = bezierAt(STALK_A, STALK_B, STALK_C, t);
  return [x, y];
}

const STALK_MOTION: readonly InkMotion[] = [
  { kind: 'sway', amount: '0.8deg', seconds: 3.7 + (41 % 7) * 0.31, origin: STALK_A },
  { kind: 'sway', amount: '0.3deg', seconds: 1.73, delay: -(41 % 5) * 0.3, origin: STALK_A },
];

export const stalkScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    ...wheat('stalk', STALK_A, STALK_B, STALK_C, 41, 0.9),
    ...wheat('stalk-low', [236, 225], [262, 186], [322, 172], 2203, 0.6),
    sparrowPart('low', ...onStalk(0.37), 0.72, 1, 2.2, STALK_MOTION),
    sparrowPart('high', ...onStalk(0.56), 0.64, -1, 1.8, STALK_MOTION),
    ...flying('coming', 348, 118, 0.6, -1, 0.19),
  ],
};

/* Seams Wallet: a key that balances between two sparrows, so neither holds it alone */
const KEY_MIDDLE: Pt = [236, 146];
const KEY_TIP: readonly InkMotion[] = [
  { kind: 'sway', amount: '2.6deg', seconds: 2.9, origin: KEY_MIDDLE },
];

export const keyScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    {
      id: 'stone',
      strokes: [
        {
          pts: [
            [KEY_MIDDLE[0] - 6, 160, 7],
            [KEY_MIDDLE[0], 170, 15],
            [KEY_MIDDLE[0] + 7, 180, 24],
          ],
          dry: 0.2,
          rough: 1,
          grain: 0.04,
        },
        {
          pts: [
            [160, 186, 1.5],
            [236, 183, 5],
            [316, 187, 1.5],
          ],
          dry: 0.76,
          rough: 0.9,
        },
      ],
    },
    {
      id: 'key',
      motions: KEY_TIP,
      strokes: [
        {
          color: 'gold',
          pts: [
            [150, 150, 7],
            [236, 148, 7],
            [322, 146, 7],
          ],
          dry: 0.1,
          rough: 0.5,
          grain: 0.03,
          pace: 0.8,
        },
        blob(142, 150, 15, 15, 'gold'),
        blob(142, 150, 6.5, 6.5, 'clear'),
        {
          color: 'gold',
          pts: [
            [303, 148, 5],
            [303, 159, 5],
          ],
          rough: 0.3,
          grain: 0,
        },
        {
          color: 'gold',
          pts: [
            [316, 147, 5],
            [316, 156, 5],
          ],
          rough: 0.3,
          grain: 0,
        },
      ],
    },
    sparrowPart('left', 170, 144, 0.74, 1, 2.2, KEY_TIP),
    sparrowPart('right', 296, 142, 0.74, -1, 1.9, KEY_TIP),
  ],
};

/* Put agents to work: two sparrows carry a fresh croissant to the café */
const LOAD: Pt = [186, 124];
const LOAD_SWING: readonly InkMotion[] = [
  { kind: 'sway', amount: '2.8deg', seconds: 1.7, origin: [186, 56] },
];

export const carryScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    {
      id: 'load',
      motions: LOAD_SWING,
      strokes: [
        {
          pts: [
            [132, 50, 1],
            [LOAD[0] - 28, LOAD[1] + 2, 1],
          ],
          dry: 0.2,
          rough: 1,
          pace: 2,
        },
        {
          pts: [
            [242, 44, 1],
            [LOAD[0] + 28, LOAD[1] + 2, 1],
          ],
          dry: 0.2,
          rough: 1,
          pace: 2,
        },
        ...croissant(LOAD[0], LOAD[1] + 8, 30),
      ],
    },
    ...flying('left', 122, 48, 0.66, 1, 0.2),
    ...flying('right', 244, 42, 0.62, -1, 0.17),
  ],
};

/* ---------- the pillow goat: the closing banner of the Satyr page ---------- */

/* a truly round mark, for a head: its width follows a circle down its height */
export function roundBlob(x: number, y: number, rx: number, ry: number): InkStroke {
  /* evenly spaced, or the spline would double back and spoil the circle */
  const rows = Array.from({ length: 19 }, (_, i) => -0.99 + (i / 18) * 1.98);
  return {
    /* the circle already closes at each end, so the brush adds no round cap */
    flat: true,
    grain: 0.02,
    rough: 0.3,
    pts: rows.map((t): InkPoint => [x, y + t * ry, 2 * rx * Math.sqrt(1 - t * t)]),
  };
}

function sleepZ(id: string, x: number, y: number, size: number, delay: number): InkPart {
  return {
    id,
    pause: 0.05,
    motions: [{ kind: 'rise', amount: '14px', seconds: 4.5, delay }],
    strokes: [
      {
        rough: 0.6,
        grain: 0.01,
        pts: [
          [x, y, 1.2],
          [x + size, y, 1.7],
          [x, y + size, 1.7],
          [x + size, y + size, 1.2],
        ],
      },
    ],
  };
}

const PILLOW_BREATH: InkMotion = {
  kind: 'breathe',
  amount: '1.03',
  seconds: 2.3,
  origin: [200, 174],
};
const PILLOW_NOD: InkMotion = { kind: 'bob', amount: '0.6px', seconds: 2.3 };

/* A baby goat asleep in side view, with its head on a croissant. */
export const pillowGoatScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    ...wheat('wheat', [92, 225], [72, 150], [108, 70], 6101, 0.74),
    {
      id: 'ground',
      strokes: [
        {
          pts: [
            [100, 180, 2],
            [190, 176, 7],
            [266, 180, 2],
          ],
          dry: 0.8,
          rough: 0.9,
        },
        {
          pts: [
            [210, 190, 1.5],
            [284, 187, 6],
            [352, 190, 1.5],
          ],
          dry: 0.76,
          rough: 0.9,
        },
      ],
    },
    { id: 'pillow', strokes: croissant(296, 168, 46, 1.25) },
    {
      id: 'tail',
      motions: [{ kind: 'sway', amount: '9deg', seconds: 2.6, origin: [146, 142] }],
      strokes: [
        {
          dry: 0.16,
          rough: 0.9,
          grain: 0.01,
          pts: [
            [150, 146, 11],
            [136, 132, 10],
            [128, 118, 2],
          ],
        },
      ],
    },
    {
      id: 'body',
      motions: [PILLOW_BREATH],
      strokes: [
        /* a small round body that rests on the ground */
        {
          dry: 0.03,
          rough: 0.7,
          grain: 0.03,
          pace: 0.7,
          pts: [
            [146, 154, 38],
            [170, 144, 58],
            [208, 140, 68],
            [240, 142, 62],
            [266, 150, 44],
          ],
        },
        /* the legs folded under, with white hocks */
        {
          grain: 0.03,
          pts: [
            [160, 166, 16],
            [182, 172, 12],
            [204, 172, 6],
          ],
        },
        {
          grain: 0.03,
          pts: [
            [246, 166, 12],
            [264, 172, 10],
            [280, 171, 6],
          ],
        },
        {
          color: 'paper',
          dry: 0.1,
          grain: 0,
          rough: 0.7,
          pts: [
            [190, 171, 7],
            [198, 172, 7.5],
            [205, 172, 4],
          ],
        },
        {
          color: 'paper',
          dry: 0.1,
          grain: 0,
          rough: 0.7,
          pts: [
            [268, 171, 6],
            [276, 171, 6],
            [281, 171, 3],
          ],
        },
        /* a white patch on the flank, so the body stays light */
        {
          color: 'clear',
          dry: 0.2,
          rough: 1,
          grain: 0,
          pts: [
            [180, 128, 5],
            [196, 128, 17],
            [216, 132, 14],
            [230, 142, 2],
          ],
        },
      ],
    },
    { id: 'bell', motions: [PILLOW_NOD], strokes: [blob(262, 122, 5, 5.4, 'accent')] },
    {
      id: 'head',
      motions: [PILLOW_NOD],
      strokes: [
        /* the neck, reaching forward to the pillow */
        {
          grain: 0.02,
          rough: 0.7,
          pts: [
            [246, 132, 40],
            [266, 102, 30],
          ],
        },
        /* two horns, curved back */
        {
          grain: 0.01,
          rough: 0.3,
          pace: 0.8,
          pts: [
            [278, 68, 7],
            [270, 52, 6],
            [258, 44, 3],
            [250, 47, 1],
          ],
        },
        {
          grain: 0.01,
          rough: 0.3,
          pace: 0.8,
          pts: [
            [288, 65, 7],
            [284, 48, 6],
            [272, 38, 3],
            [264, 39, 1],
          ],
        },
        /* a round head and a short muzzle that rests on the croissant */
        roundBlob(284, 80, 24, 22),
        {
          grain: 0.01,
          rough: 0.25,
          pts: [
            [288, 84, 30],
            [302, 90, 24],
            [314, 94, 17],
          ],
        },
        /* a white stripe down the nose */
        {
          color: 'paper',
          grain: 0,
          rough: 0.5,
          pts: [
            [290, 66, 3],
            [297, 78, 6.5],
            [306, 88, 11],
            [312, 92, 7],
          ],
        },
        blob(316, 90, 3.6, 3.2),
        /* one shut eye */
        {
          color: 'clear',
          grain: 0,
          rough: 0.2,
          pts: [
            [275, 79, 1.2],
            [281, 83, 2.8],
            [288, 80, 1.2],
          ],
        },
      ],
    },
    {
      id: 'ear',
      motions: [PILLOW_NOD, { kind: 'sway', amount: '3deg', seconds: 3.7, origin: [272, 74] }],
      strokes: [
        /* a thin pale edge lifts the ear off the dark neck */
        {
          color: 'paper',
          grain: 0,
          rough: 0.5,
          pts: [
            [274, 72, 9],
            [258, 82, 16],
            [246, 102, 11],
            [244, 116, 5],
          ],
        },
        {
          grain: 0.01,
          rough: 0.4,
          pts: [
            [274, 72, 7],
            [258, 82, 13.5],
            [246, 102, 8.5],
            [244, 114, 2],
          ],
        },
      ],
    },
    sleepZ('z-small', 326, 62, 7, 0),
    sleepZ('z-middle', 334, 48, 9, -1.5),
    sleepZ('z-large', 332, 32, 11, -3),
  ],
};

/* ---------- the other pages: flour, a delivery and a cup ---------- */

export function fallingSpeck(id: string, x: number, y: number, r: number, delay: number): InkPart {
  return {
    id,
    motions: [{ kind: 'fall', amount: '20px', seconds: 2.4, delay }],
    strokes: [blob(x, y, r, r, 'gold')],
  };
}

/* the baby goat of the hero at a smaller size, with its feet at x, y */
const KID_ON_SACK = 0.66;

function onSack(x: number, y: number, w: number): InkPoint {
  return [204 + (x - 175) * KID_ON_SACK, 99 + (y - 488) * KID_ON_SACK, w * KID_ON_SACK];
}

function onSackAt(x: number, y: number): [number, number] {
  const [px, py] = onSack(x, y, 0);
  return [px, py];
}

function sackPoints(list: readonly InkPoint[]): InkPoint[] {
  return list.map(([x, y, w]) => onSack(x, y, w));
}

const SACK_INK = { dry: 0.14, rough: 0.8, grain: 0.04 } as const;

/* A baby goat on a tall flour sack looks down at the sack that it tipped over. */
export const flourGoatScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    {
      id: 'ground',
      strokes: [
        {
          pts: [
            [112, 188, 2],
            [214, 185, 7],
            [320, 188, 2],
          ],
          dry: 0.8,
          rough: 0.9,
        },
        {
          pts: [
            [284, 192, 1.5],
            [350, 190, 6],
            [418, 192, 1.5],
          ],
          dry: 0.78,
          rough: 0.9,
        },
      ],
    },
    {
      id: 'tall-sack',
      strokes: [
        /* a full gold sack, square at the top and the bottom */
        {
          color: 'gold',
          flat: true,
          dry: 0.12,
          rough: 0.8,
          grain: 0.05,
          pace: 0.7,
          pts: [
            [204, 98, 72],
            [204, 122, 80],
            [204, 154, 86],
            [204, 186, 84],
          ],
        },
        /* a row of stitches across the top */
        {
          pts: [
            [170, 106, 1.6],
            [204, 104, 2],
            [238, 106, 1.6],
          ],
          dry: 0.58,
          rough: 0.5,
          grain: 0,
        },
        /* folds in the cloth */
        {
          color: 'clear',
          dry: 0.5,
          rough: 1,
          grain: 0,
          pts: [
            [174, 120, 1],
            [168, 148, 2.4],
            [172, 176, 0.8],
          ],
        },
        {
          color: 'clear',
          dry: 0.5,
          rough: 1,
          grain: 0,
          pts: [
            [234, 120, 1],
            [240, 148, 2.4],
            [236, 176, 0.8],
          ],
        },
        /* the sign of the mill: one dark ear of wheat */
        {
          pts: [
            [204, 170, 1.6],
            [204, 150, 2.2],
            [204, 128, 1.2],
          ],
          rough: 0.5,
          grain: 0,
        },
        {
          pts: [
            [204, 158, 2],
            [195, 150, 6],
            [191, 143, 1.2],
          ],
          rough: 0.7,
          grain: 0.02,
        },
        {
          pts: [
            [204, 158, 2],
            [213, 150, 6],
            [217, 143, 1.2],
          ],
          rough: 0.7,
          grain: 0.02,
        },
        {
          pts: [
            [204, 146, 2],
            [196, 138, 5.5],
            [193, 131, 1.2],
          ],
          rough: 0.7,
          grain: 0.02,
        },
        {
          pts: [
            [204, 146, 2],
            [212, 138, 5.5],
            [215, 131, 1.2],
          ],
          rough: 0.7,
          grain: 0.02,
        },
      ],
    },
    {
      id: 'tipped-sack',
      strokes: [
        /* it lies on its side, with its open mouth to the goat */
        {
          color: 'gold',
          flat: true,
          dry: 0.12,
          rough: 0.8,
          grain: 0.05,
          pace: 0.7,
          pts: [
            [288, 164, 42],
            [324, 162, 48],
            [366, 162, 50],
            [398, 164, 46],
          ],
        },
        {
          color: 'clear',
          dry: 0.5,
          rough: 1,
          grain: 0,
          pts: [
            [316, 148, 0.8],
            [348, 144, 2.2],
            [382, 150, 0.8],
          ],
        },
        {
          color: 'clear',
          dry: 0.5,
          rough: 1,
          grain: 0,
          pts: [
            [318, 178, 0.8],
            [350, 180, 2.2],
            [382, 176, 0.8],
          ],
        },
        /* the dark inside of the mouth */
        {
          ...SACK_INK,
          dry: 0,
          rough: 0.7,
          pts: [
            [288, 146, 4],
            [282, 164, 14],
            [288, 182, 4],
          ],
        },
        /* the flour that came out */
        {
          color: 'gold',
          dry: 0.12,
          rough: 0.9,
          grain: 0.03,
          pts: [
            [288, 178, 7],
            [270, 180, 12],
            [250, 186, 3],
          ],
        },
      ],
    },
    fallingSpeck('flour-a', 276, 160, 1.5, 0),
    fallingSpeck('flour-b', 268, 154, 1.2, -0.8),
    fallingSpeck('flour-c', 262, 164, 1, -1.6),
    {
      id: 'kid-far-legs',
      strokes: [
        {
          pts: sackPoints([
            [158, 448, 10],
            [161, 468, 5.5],
            [158, 488, 5.5],
          ]),
          grain: 0.02,
        },
        {
          pts: sackPoints([
            [190, 448, 10],
            [188, 468, 5.5],
            [183, 488, 5.5],
          ]),
          grain: 0.02,
        },
      ],
    },
    {
      id: 'kid-tail',
      motions: [
        {
          kind: 'sway',
          amount: '14deg',
          seconds: 0.47,
          origin: onSackAt(134, 428),
        },
        {
          kind: 'sway',
          amount: '5deg',
          seconds: 2.1,
          origin: onSackAt(134, 428),
        },
      ],
      strokes: [
        {
          dry: 0.16,
          rough: 0.9,
          grain: 0.01,
          pts: sackPoints([
            [140, 432, 9],
            [126, 418, 8],
            [120, 406, 2],
          ]),
        },
      ],
    },
    {
      id: 'kid-body',
      strokes: [
        {
          pts: sackPoints([
            [146, 446, 14],
            [139, 466, 7.5],
            [144, 488, 6.5],
          ]),
          grain: 0.02,
        },
        {
          pts: sackPoints([
            [200, 444, 12],
            [205, 466, 7.5],
            [210, 488, 6.5],
          ]),
          grain: 0.02,
        },
        {
          dry: 0.03,
          rough: 0.7,
          grain: 0.03,
          pts: sackPoints([
            [132, 436, 20],
            [150, 434, 40],
            [172, 433, 47],
            [194, 431, 43],
            [210, 425, 22],
          ]),
        },
        {
          grain: 0.02,
          rough: 0.7,
          pts: sackPoints([
            [200, 428, 26],
            [212, 412, 19],
            [220, 402, 17],
          ]),
        },
        {
          color: 'clear',
          dry: 0.2,
          rough: 1,
          grain: 0,
          pts: sackPoints([
            [150, 428, 5],
            [161, 431, 14],
            [174, 434, 11],
            [184, 442, 2],
          ]),
        },
      ],
    },
    {
      id: 'kid-head',
      motions: [
        {
          kind: 'sway',
          amount: '3deg',
          seconds: 2.9,
          origin: onSackAt(214, 410),
        },
      ],
      strokes: [
        {
          grain: 0.01,
          rough: 0.25,
          pts: sackPoints([
            [219, 385, 6],
            [215, 375, 5],
            [212, 371, 2],
          ]),
        },
        {
          grain: 0.01,
          rough: 0.25,
          pts: sackPoints([
            [228, 383, 5.5],
            [227, 374, 4.5],
            [224, 369, 1.8],
          ]),
        },
        roundBlob(...onSackAt(222, 398), 17 * KID_ON_SACK, 16 * KID_ON_SACK),
        /* the muzzle, tipped down to look at the spill */
        {
          grain: 0.01,
          rough: 0.25,
          pts: sackPoints([
            [226, 400, 22],
            [238, 408, 16],
            [247, 416, 10],
          ]),
        },
        blob(...onSackAt(228, 392), 3, 3, 'clear'),
        blob(...onSackAt(229, 393), 1.7, 1.7),
      ],
    },
    {
      id: 'kid-ear',
      motions: [
        {
          kind: 'sway',
          amount: '7deg',
          seconds: 1.4,
          origin: onSackAt(214, 390),
        },
      ],
      strokes: [
        {
          grain: 0.01,
          rough: 0.4,
          pts: sackPoints([
            [216, 388, 6],
            [202, 393, 11],
            [191, 406, 3.4],
          ]),
        },
      ],
    },
  ],
};

/* A sparrow carries a gold gift box across the banner. */
const PARCEL_SECONDS = 0.2;
const PARCEL_TIE: Pt = [226, 66];
const PARCEL_MOTIONS: readonly InkMotion[] = [
  { kind: 'bob', amount: '2.5px', seconds: 1.7, delay: -PARCEL_SECONDS },
  { kind: 'sway', amount: '3.4deg', seconds: 1.9, origin: PARCEL_TIE },
];

export const parcelSparrowScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    /* the wheat far below, and the air that the bird left behind */
    ...wheat('field-a', [110, 225], [140, 196], [206, 184], 977, 0.5),
    ...wheat('field-b', [226, 225], [262, 194], [330, 182], 7321, 0.56),
    ...wheat('field-c', [336, 225], [362, 200], [412, 188], 2203, 0.42),
    {
      id: 'wake',
      motions: [{ kind: 'drift', amount: '6px', seconds: 2.9 }],
      strokes: [
        {
          pts: [
            [96, 48, 0.6],
            [132, 52, 1.5],
            [154, 52, 0.5],
          ],
          dry: 0.74,
          rough: 1,
        },
        {
          pts: [
            [116, 72, 0.5],
            [146, 74, 1.2],
            [166, 72, 0.5],
          ],
          dry: 0.74,
          rough: 1,
        },
      ],
    },
    {
      id: 'parcel',
      motions: PARCEL_MOTIONS,
      strokes: [
        {
          pts: [
            [PARCEL_TIE[0], PARCEL_TIE[1], 1],
            [228, 104, 1.1],
          ],
          dry: 0.12,
          rough: 0.8,
          pace: 2,
        },
        /* the box: one loaded pull, and the ribbon cut out of the gold */
        {
          color: 'gold',
          flat: true,
          dry: 0.06,
          rough: 0.45,
          grain: 0.04,
          pts: [
            [204, 132, 46],
            [228, 132, 47],
            [252, 132, 46],
          ],
        },
        {
          color: 'clear',
          grain: 0,
          rough: 0.5,
          pts: [
            [228, 106, 4],
            [228, 132, 4.5],
            [228, 158, 4],
          ],
        },
        {
          color: 'clear',
          grain: 0,
          rough: 0.5,
          pts: [
            [192, 128, 3.4],
            [228, 128, 3.8],
            [264, 128, 3.4],
          ],
        },
        /* the bow */
        {
          pts: [
            [228, 106, 1.6],
            [216, 96, 7],
            [212, 104, 3],
          ],
          rough: 0.7,
          grain: 0.02,
        },
        {
          pts: [
            [228, 106, 1.6],
            [240, 96, 7],
            [244, 104, 3],
          ],
          rough: 0.7,
          grain: 0.02,
        },
      ],
    },
    ...flying('carrier', 222, 62, 0.98, 1, PARCEL_SECONDS),
    ...flying('far', 348, 40, 0.34, 1, 0.16),
  ],
};

export function steamCurl(id: string, x: number, y: number, k: number, delay: number): InkPart {
  return {
    id,
    motions: [
      { kind: 'rise', amount: '10px', seconds: 5.2, delay },
      { kind: 'sway', amount: '4deg', seconds: 2.3, delay, origin: [x, y] },
    ],
    strokes: [
      {
        dry: 0.5,
        rough: 1,
        grain: 0,
        pace: 0.7,
        pts: [
          [x, y, 1],
          [x + 12 * k, y - 18 * k, 2.2],
          [x - 8 * k, y - 38 * k, 2.6],
          [x + 12 * k, y - 60 * k, 1.8],
          [x + 2 * k, y - 78 * k, 0.8],
        ],
      },
    ],
  };
}

/* A gold cup on its saucer, all in side view, with a sparrow on the rim. */
const CUP_RIM_Y = 92;

export const cupSparrowScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    {
      id: 'ground',
      strokes: [
        {
          pts: [
            [116, 188, 2],
            [214, 185, 7],
            [316, 188, 2],
          ],
          dry: 0.8,
          rough: 0.9,
        },
        {
          pts: [
            [262, 192, 1.5],
            [330, 190, 5],
            [396, 192, 1.5],
          ],
          dry: 0.78,
          rough: 0.9,
        },
      ],
    },
    {
      id: 'handle',
      strokes: [
        {
          rough: 0.6,
          grain: 0.03,
          pace: 0.8,
          pts: [
            [278, 106, 6],
            [306, 102, 8],
            [316, 122, 8],
            [302, 142, 7],
            [272, 150, 5],
          ],
        },
      ],
    },
    {
      id: 'cup',
      strokes: [
        /* one gold pull down the cup, wide at the rim and narrow at the foot */
        {
          color: 'gold',
          flat: true,
          dry: 0.1,
          rough: 0.7,
          grain: 0.05,
          pace: 0.7,
          pts: [
            [234, CUP_RIM_Y, 100],
            [234, 114, 100],
            [234, 138, 88],
            [234, 158, 64],
            [234, 172, 40],
          ],
        },
        /* light on the side of the cup */
        {
          color: 'clear',
          dry: 0.42,
          rough: 1,
          grain: 0,
          pts: [
            [198, 104, 1.2],
            [202, 128, 3],
            [216, 152, 1],
          ],
        },
        /* the dark coffee at the rim, then the saucer and the foot */
        {
          rough: 0.6,
          grain: 0.02,
          pts: [
            [184, CUP_RIM_Y, 5],
            [234, CUP_RIM_Y - 3, 8],
            [284, CUP_RIM_Y, 5],
          ],
        },
        {
          rough: 0.8,
          grain: 0.03,
          pts: [
            [150, 172, 3],
            [234, 180, 8],
            [318, 172, 3],
          ],
        },
      ],
    },
    steamCurl('steam-a', 244, 80, 0.5, 0),
    steamCurl('steam-b', 266, 84, 0.42, -2.6),
    sparrowPart('rim-bird', 198, CUP_RIM_Y - 4, 0.72, 1, 2.1),
  ],
};

/* ---------- the Satyr page: loaves, wind, a whisk and order slips ---------- */

/* one loaf: a loaded gold pull, with its scores cut out across the top */
export function loaf(x: number, y: number, length: number, width: number): InkStroke[] {
  const half = length / 2;
  return [
    {
      color: 'gold',
      dry: 0.1,
      rough: 0.7,
      grain: 0.05,
      pts: [
        [x - half, y + 1, width * 0.82],
        [x - half * 0.4, y, width],
        [x + half * 0.4, y, width],
        [x + half, y + 1, width * 0.82],
      ],
    },
    ...[-0.42, 0, 0.42].map(
      (at): InkStroke => ({
        color: 'clear',
        grain: 0,
        rough: 0.7,
        dry: 0.1,
        pts: [
          [x + half * at - 5, y + width * 0.26, 1],
          [x + half * at, y, 2.6],
          [x + half * at + 7, y - width * 0.3, 1],
        ],
      }),
    ),
  ];
}

const PEEL_Y = 172;
const CRUMB: Pt = [326, PEEL_Y - 4];

/* A row of loaves cools on a long board, and a sparrow takes a crumb from the last. */
export const loavesScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    {
      id: 'board',
      strokes: [
        {
          pts: [
            [92, PEEL_Y, 7],
            [240, PEEL_Y + 1, 9],
            [404, PEEL_Y, 7],
          ],
          dry: 0.2,
          rough: 0.9,
          grain: 0.05,
          pace: 0.8,
        },
        {
          pts: [
            [108, PEEL_Y + 2, 5],
            [110, PEEL_Y + 18, 4],
            [108, PEEL_Y + 30, 3],
          ],
          rough: 0.6,
        },
        {
          pts: [
            [388, PEEL_Y + 2, 5],
            [386, PEEL_Y + 18, 4],
            [388, PEEL_Y + 30, 3],
          ],
          rough: 0.6,
        },
      ],
    },
    { id: 'loaf-a', strokes: loaf(130, PEEL_Y - 21, 58, 36) },
    { id: 'loaf-b', strokes: loaf(194, PEEL_Y - 21, 58, 36) },
    { id: 'loaf-c', strokes: loaf(258, PEEL_Y - 21, 58, 36) },
    steamCurl('steam-a', 130, 124, 0.56, 0),
    steamCurl('steam-b', 194, 124, 0.62, -1.7),
    steamCurl('steam-c', 258, 124, 0.56, -3.4),
    {
      id: 'crumbs',
      strokes: [
        blob(CRUMB[0], CRUMB[1], 3, 2.6, 'gold'),
        blob(CRUMB[0] + 9, CRUMB[1] + 1, 1.8, 1.6, 'gold'),
      ],
    },
    {
      id: 'pecking',
      motions: [
        { kind: 'sway', amount: '7deg', seconds: 0.55, origin: [364, PEEL_Y - 4] },
        { kind: 'sway', amount: '3deg', seconds: 2.3, origin: [364, PEEL_Y - 4] },
      ],
      strokes: perched(364, PEEL_Y - 4, 0.78, -1),
    },
  ],
};

/* Wheat in the wind: each stalk leans a moment after the one before it, so a slow
   wave crosses the banner, and one ear is gold. */
function windStalk(
  index: number,
  x: number,
  height: number,
  size: number,
  color: InkColor,
): InkPart[] {
  const base: Pt = [x, 225];
  const motions: readonly InkMotion[] = [
    { kind: 'sway', amount: '3.2deg', seconds: 2.4, delay: -index * 0.26, origin: base },
  ];
  return wheat(
    `stalk-${index}`,
    base,
    [x + 8, 225 - height * 0.56],
    [x + 40, 225 - height],
    977 + index * 613,
    size,
    color,
  ).map(
    /* an unbroken stem, because one gap shows in a dense field */
    (part) => ({
      ...part,
      motions,
      strokes: part.id.endsWith('-stem')
        ? part.strokes.map((stroke) => ({ ...stroke, dry: 0.08 }))
        : part.strokes,
    }),
  );
}

export const windScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    windStalk(0, 76, 150, 0.6, 'ink'),
    windStalk(1, 104, 182, 0.66, 'ink'),
    windStalk(2, 132, 158, 0.6, 'ink'),
    windStalk(3, 160, 192, 0.7, 'ink'),
    windStalk(4, 188, 166, 0.62, 'ink'),
    windStalk(5, 216, 198, 0.74, 'gold'),
    windStalk(6, 244, 170, 0.62, 'ink'),
    windStalk(7, 272, 188, 0.68, 'ink'),
    windStalk(8, 300, 156, 0.6, 'ink'),
    windStalk(9, 328, 178, 0.66, 'ink'),
    windStalk(10, 356, 146, 0.58, 'ink'),
  ].flat(),
};

/* A baby goat walks away from the bowl with the whisk in its mouth. */
const KID_WALK = { x: 256, feet: 182, k: 0.72 } as const;

function kidAt(x: number, y: number): [number, number] {
  return [KID_WALK.x + (x - 175) * KID_WALK.k, KID_WALK.feet + (y - 488) * KID_WALK.k];
}

function kidPoints(list: readonly InkPoint[]): InkPoint[] {
  return list.map(([x, y, w]): InkPoint => [...kidAt(x, y), w * KID_WALK.k]);
}

/* a small whisk, held by its handle, that tips forward and down from the mouth */
const WHISK_MOUTH = kidAt(250, 408);
const WHISK_NECK: Pt = [WHISK_MOUTH[0] + 12, WHISK_MOUTH[1] + 4];
const WHISK_TIP: Pt = [WHISK_MOUTH[0] + 36, WHISK_MOUTH[1] + 13];

function whiskWire(bulge: number): InkStroke {
  const midX = (WHISK_NECK[0] + WHISK_TIP[0]) / 2;
  const midY = (WHISK_NECK[1] + WHISK_TIP[1]) / 2;
  return {
    rough: 0.3,
    grain: 0,
    pace: 1.4,
    pts: [
      [WHISK_NECK[0], WHISK_NECK[1], 0.9],
      [midX - bulge * 0.35, midY + bulge * 0.94, 1.1],
      [WHISK_TIP[0], WHISK_TIP[1], 0.9],
    ],
  };
}

export const whiskGoatScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    {
      id: 'ground',
      strokes: [
        {
          pts: [
            [96, 186, 2],
            [196, 183, 7],
            [300, 186, 2],
          ],
          dry: 0.8,
          rough: 0.9,
        },
        {
          pts: [
            [250, 191, 1.5],
            [330, 189, 6],
            [404, 191, 1.5],
          ],
          dry: 0.78,
          rough: 0.9,
        },
      ],
    },
    {
      id: 'bowl',
      strokes: [
        /* a deep bowl, with a little batter on the rim */
        {
          color: 'gold',
          flat: true,
          dry: 0.1,
          rough: 0.7,
          grain: 0.05,
          pts: [
            [116, 136, 76],
            [116, 158, 70],
            [116, 176, 48],
            [116, 184, 34],
          ].map(([x, y, w]): InkPoint => [x + 32, y, w]),
        },
        {
          pts: [
            [106, 136, 5],
            [148, 133, 6],
            [190, 136, 5],
          ],
          rough: 0.7,
          grain: 0.03,
        },
      ],
    },
    {
      id: 'far-legs',
      motions: [{ kind: 'sway', amount: '3deg', seconds: 0.9, origin: kidAt(172, 440) }],
      strokes: [
        {
          pts: kidPoints([
            [158, 448, 10],
            [161, 468, 5.5],
            [158, 488, 5.5],
          ]),
          grain: 0.02,
        },
        {
          pts: kidPoints([
            [190, 448, 10],
            [188, 468, 5.5],
            [183, 488, 5.5],
          ]),
          grain: 0.02,
        },
      ],
    },
    {
      id: 'tail',
      motions: [
        { kind: 'sway', amount: '14deg', seconds: 0.47, origin: kidAt(134, 428) },
        { kind: 'sway', amount: '5deg', seconds: 2.1, origin: kidAt(134, 428) },
      ],
      strokes: [
        {
          dry: 0.16,
          rough: 0.9,
          grain: 0.01,
          pts: kidPoints([
            [140, 432, 9],
            [126, 418, 8],
            [120, 406, 2],
          ]),
        },
      ],
    },
    {
      id: 'kid',
      motions: [{ kind: 'bob', amount: '0.8px', seconds: 0.45 }],
      strokes: [
        {
          pts: kidPoints([
            [146, 446, 14],
            [139, 466, 7.5],
            [144, 488, 6.5],
          ]),
          grain: 0.02,
        },
        {
          pts: kidPoints([
            [200, 444, 12],
            [205, 466, 7.5],
            [210, 488, 6.5],
          ]),
          grain: 0.02,
        },
        {
          dry: 0.03,
          rough: 0.7,
          grain: 0.03,
          pts: kidPoints([
            [132, 436, 20],
            [150, 434, 40],
            [172, 433, 47],
            [194, 431, 43],
            [210, 425, 22],
          ]),
        },
        {
          grain: 0.02,
          rough: 0.7,
          pts: kidPoints([
            [200, 428, 26],
            [212, 408, 19],
            [218, 396, 17],
          ]),
        },
        {
          color: 'clear',
          dry: 0.2,
          rough: 1,
          grain: 0,
          pts: kidPoints([
            [150, 428, 5],
            [161, 431, 14],
            [174, 434, 11],
            [184, 442, 2],
          ]),
        },
        {
          grain: 0.01,
          rough: 0.25,
          pts: kidPoints([
            [219, 383, 6],
            [215, 373, 5],
            [212, 369, 2],
          ]),
        },
        {
          grain: 0.01,
          rough: 0.25,
          pts: kidPoints([
            [228, 381, 5.5],
            [227, 372, 4.5],
            [224, 367, 1.8],
          ]),
        },
        roundBlob(...kidAt(222, 396), 17 * KID_WALK.k, 16 * KID_WALK.k),
        {
          grain: 0.01,
          rough: 0.25,
          pts: kidPoints([
            [226, 398, 22],
            [238, 403, 16],
            [249, 408, 10],
          ]),
        },
        blob(...kidAt(229, 389), 3.2, 3.2, 'clear'),
        blob(...kidAt(230, 389.5), 1.8, 1.8),
      ],
    },
    {
      id: 'ear',
      motions: [{ kind: 'sway', amount: '7deg', seconds: 1.4, origin: kidAt(214, 388) }],
      strokes: [
        {
          grain: 0.01,
          rough: 0.4,
          pts: kidPoints([
            [216, 386, 6],
            [202, 391, 11],
            [191, 404, 3.4],
          ]),
        },
      ],
    },
    {
      id: 'whisk',
      motions: [{ kind: 'sway', amount: '2deg', seconds: 0.9, origin: WHISK_MOUTH }],
      strokes: [
        {
          pts: [
            [WHISK_MOUTH[0] - 4, WHISK_MOUTH[1] - 1, 2.4],
            [WHISK_NECK[0], WHISK_NECK[1], 2.4],
          ],
          rough: 0.3,
          grain: 0,
        },
        whiskWire(-6),
        whiskWire(-3),
        whiskWire(0),
        whiskWire(3),
        whiskWire(6),
      ],
    },
    fallingSpeck('batter-a', WHISK_TIP[0] + 1, WHISK_TIP[1] + 6, 1.5, 0),
    fallingSpeck('batter-b', WHISK_TIP[0] - 8, WHISK_TIP[1] + 6, 1.2, -0.9),
    fallingSpeck('batter-c', WHISK_TIP[0] - 3, WHISK_TIP[1] + 9, 1.3, -1.7),
  ],
};

/* Order slips hang on one line, and a sparrow carries one away in its beak. */
function onSlipLine(t: number): Pt {
  const [x, y] = bezierAt([56, 26], [300, 84], [632, 8], t);
  return [x, y];
}

function orderSlip(
  id: string,
  t: number,
  length: number,
  seconds: number,
  delay: number,
  gold = false,
): InkPart {
  const [x, y] = onSlipLine(t);
  const top = y + 2;
  const width = 34;
  const left = x - width / 2;
  const right = x + width / 2;
  const bottom = top + length;
  const outline = (pts: readonly InkPoint[]): InkStroke => ({
    pts,
    dry: 0.22,
    rough: 0.8,
    grain: 0.02,
    pace: 1.6,
  });
  return {
    id,
    motions: [{ kind: 'sway', amount: '5deg', seconds, delay, origin: [x, y] }],
    strokes: [
      {
        color: gold ? 'gold' : 'paper',
        flat: true,
        grain: gold ? 0.04 : 0,
        rough: 0.4,
        pts: [
          [x, top, width],
          [x, (top + bottom) / 2, width],
          [x, bottom, width],
        ],
      },
      ...(gold
        ? []
        : [
            outline([
              [left, top, 1.6],
              [left, bottom, 1.4],
            ]),
            outline([
              [right, top, 1.6],
              [right, bottom, 1.4],
            ]),
            outline([
              [left, bottom, 1.4],
              [x - 8, bottom + 3, 1.3],
              [x + 6, bottom - 1, 1.3],
              [right, bottom + 2, 1.4],
            ]),
          ]),
      /* the printed lines */
      ...[0.26, 0.44, 0.62, 0.78].map(
        (at, i): InkStroke => ({
          color: gold ? 'clear' : 'ink',
          dry: 0.36,
          rough: 0.6,
          grain: 0,
          pace: 2,
          pts: [
            [left + 6, top + length * at, 1.1],
            [right - (i % 2 === 0 ? 6 : 13), top + length * at, 1.1],
          ],
        }),
      ),
      /* the peg on the line */
      {
        pts: [
          [x, y - 6, 3.6],
          [x, y + 7, 3.6],
        ],
        rough: 0.3,
        grain: 0,
      },
    ],
  };
}

const SLIP_BIRD = onSlipLine(0.56);
const SLIP_BEAK: Pt = [SLIP_BIRD[0] + 29, SLIP_BIRD[1] - 30];
const SLIP_CARRIED: readonly InkMotion[] = [
  { kind: 'sway', amount: '4deg', seconds: 1.5, origin: SLIP_BEAK },
];

export const orderSlipsScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    {
      id: 'line',
      strokes: [
        {
          pts: [0, 0.2, 0.4, 0.6, 0.8, 1].map((t): InkPoint => [...onSlipLine(t), 1.5]),
          dry: 0.16,
          rough: 0.9,
          pace: 1.6,
        },
      ],
    },
    orderSlip('slip-a', 0.1, 74, 2.2, 0),
    orderSlip('slip-b', 0.22, 60, 2.6, -0.6),
    orderSlip('slip-c', 0.34, 82, 2, -1.2),
    orderSlip('slip-d', 0.46, 64, 2.4, -1.8),
    sparrowPart('taker', SLIP_BIRD[0], SLIP_BIRD[1], 0.78, 1, 2.3),
    {
      id: 'carried-slip',
      motions: SLIP_CARRIED,
      strokes: [
        {
          pts: [
            [SLIP_BEAK[0], SLIP_BEAK[1], 1],
            [SLIP_BEAK[0] + 2, SLIP_BEAK[1] + 34, 1],
          ],
          rough: 0.5,
          grain: 0,
          pace: 2,
        },
        {
          color: 'gold',
          flat: true,
          rough: 0.4,
          grain: 0.04,
          pts: [
            [SLIP_BEAK[0] + 2, SLIP_BEAK[1] + 34, 34],
            [SLIP_BEAK[0] + 2, SLIP_BEAK[1] + 62, 34],
            [SLIP_BEAK[0] + 2, SLIP_BEAK[1] + 96, 34],
          ],
        },
        ...[0.2, 0.42, 0.64, 0.84].map(
          (at, i): InkStroke => ({
            color: 'clear',
            dry: 0.3,
            rough: 0.6,
            grain: 0,
            pts: [
              [SLIP_BEAK[0] - 9, SLIP_BEAK[1] + 34 + 62 * at, 1.3],
              [SLIP_BEAK[0] + (i % 2 === 0 ? 13 : 6), SLIP_BEAK[1] + 34 + 62 * at, 1.3],
            ],
          }),
        ),
      ],
    },
  ],
};

/* ---------- the cobot: an arm lifts a croissant off the line ---------- */

/* a machine joint: a dark ball with a pale ring and a dark pin */
export function machineJoint(x: number, y: number, r: number): InkStroke[] {
  return [
    roundBlob(x, y, r, r),
    blob(x, y, r * 0.52, r * 0.52, 'clear'),
    blob(x, y, r * 0.24, r * 0.24),
  ];
}

const SHOULDER: Pt = [204, 138];
const ELBOW: Pt = [250, 74];
const WRIST: Pt = [326, 80];

const AT_SHOULDER: InkMotion = { kind: 'sway', amount: '2.2deg', seconds: 3.7, origin: SHOULDER };
const AT_ELBOW: InkMotion = {
  kind: 'sway',
  amount: '3.4deg',
  seconds: 2.9,
  delay: -1,
  origin: ELBOW,
};
const AT_WRIST: InkMotion = {
  kind: 'sway',
  amount: '4deg',
  seconds: 2.1,
  delay: -0.6,
  origin: WRIST,
};

function beltCroissant(id: string, x: number): InkPart {
  return {
    id,
    motions: [{ kind: 'drift', amount: '7px', seconds: 3.6 }],
    strokes: croissant(x, 156, 17),
  };
}

export const ARM_LINE = { dry: 0.04, rough: 0.6, grain: 0.02 } as const;
export const SOLID_LINE = { dry: 0, rough: 0.6, grain: 0.02 } as const;

export const cobotScene: InkScene = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  parts: [
    {
      id: 'ground',
      strokes: [
        {
          pts: [
            [130, 186, 2],
            [320, 183, 7],
            [512, 186, 2],
          ],
          dry: 0.8,
          rough: 0.9,
          grain: 0.02,
        },
      ],
    },
    {
      id: 'belt',
      strokes: [
        {
          flat: true,
          rough: 0.5,
          grain: 0.04,
          pts: [
            [310, 166, 12],
            [410, 166, 12],
            [510, 166, 12],
          ],
        },
        ...[332, 382, 432, 482].flatMap((x) => machineJoint(x, 166, 4.4)),
        {
          ...SOLID_LINE,
          pts: [
            [326, 172, 5],
            [326, 184, 4],
          ],
        },
        {
          ...SOLID_LINE,
          pts: [
            [496, 172, 5],
            [496, 184, 4],
          ],
        },
      ],
    },
    beltCroissant('on-belt-a', 386),
    beltCroissant('on-belt-b', 454),
    {
      id: 'base',
      strokes: [
        {
          flat: true,
          rough: 0.5,
          grain: 0.03,
          pts: [
            [SHOULDER[0], 186, 56],
            [SHOULDER[0], 170, 46],
            [SHOULDER[0], 150, 32],
          ],
        },
        {
          color: 'gold',
          flat: true,
          rough: 0.4,
          grain: 0.03,
          pts: [
            [SHOULDER[0], 178, 42],
            [SHOULDER[0], 170, 40],
          ],
        },
      ],
    },
    {
      id: 'upper-arm',
      motions: [AT_SHOULDER],
      strokes: [
        {
          ...ARM_LINE,
          pts: [
            [SHOULDER[0], SHOULDER[1], 22],
            [228, 106, 19],
            [ELBOW[0], ELBOW[1], 17],
          ],
        },
        /* the seam of the casing, and a loose cable */
        {
          color: 'clear',
          dry: 0.2,
          rough: 0.5,
          grain: 0,
          pts: [
            [212, 124, 1.4],
            [228, 100, 2],
            [242, 84, 1.2],
          ],
        },
        {
          dry: 0.2,
          rough: 0.6,
          grain: 0.02,
          pts: [
            [190, 142, 1],
            [196, 104, 1.3],
            [238, 72, 1],
          ],
        },
        ...machineJoint(SHOULDER[0], SHOULDER[1], 16),
      ],
    },
    {
      id: 'forearm',
      motions: [AT_SHOULDER, AT_ELBOW],
      strokes: [
        {
          ...ARM_LINE,
          pts: [
            [ELBOW[0], ELBOW[1], 16],
            [290, 76, 13],
            [WRIST[0], WRIST[1], 11],
          ],
        },
        {
          color: 'clear',
          dry: 0.2,
          rough: 0.5,
          grain: 0,
          pts: [
            [266, 74, 1.2],
            [292, 74, 1.8],
            [314, 78, 1],
          ],
        },
        ...machineJoint(ELBOW[0], ELBOW[1], 13),
      ],
    },
    sparrowPart('rider', 286, 66, 0.52, -1, 2, [AT_SHOULDER, AT_ELBOW]),
    {
      id: 'gripper',
      motions: [AT_SHOULDER, AT_ELBOW, AT_WRIST],
      strokes: [
        ...croissant(332, 126, 15),
        {
          ...SOLID_LINE,
          pts: [
            [WRIST[0], WRIST[1], 9],
            [330, 98, 8],
          ],
        },
        {
          ...SOLID_LINE,
          pts: [
            [330, 100, 4],
            [312, 104, 4.6],
            [312, 118, 3.4],
            [316, 128, 1.8],
          ],
        },
        {
          ...SOLID_LINE,
          pts: [
            [330, 100, 4],
            [350, 104, 4.6],
            [350, 118, 3.4],
            [346, 128, 1.8],
          ],
        },
        ...machineJoint(WRIST[0], WRIST[1], 9),
      ],
    },
  ],
};
