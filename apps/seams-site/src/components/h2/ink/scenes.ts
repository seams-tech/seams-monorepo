import type { InkColor, InkPoint, InkStroke } from './brush';

/* The home page drawings: a croissant that flies itself over a field of wheat. */

export type InkMotion = {
  readonly kind: 'sway' | 'bob' | 'drift' | 'flap';
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
};

export type InkScene = {
  readonly width: number;
  readonly height: number;
  readonly parts: readonly InkPart[];
};

type Pt = readonly [number, number];

/* A brush is wide across its travel, so a short wide stroke makes a bar. A round
   shape swells and narrows along its own height instead. */
function blob(x: number, y: number, rx: number, ry: number, color: InkColor = 'ink'): InkStroke {
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
function croissant(cx: number, cy: number, radius: number): InkStroke[] {
  const size = radius / 40;
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
    const [ax, ay] = at(angle - 0.1, radius * 0.5);
    const [bx, by] = at(angle + 0.06, radius);
    const [ex, ey] = at(angle + 0.2, radius * 1.56);
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
function wheat(id: string, base: Pt, bend: Pt, tip: Pt, seed: number, size: number): InkPart[] {
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
      strokes: [{ pts: stem, dry: 0.5, rough: 0.9, pace: 1.6 }],
    },
    {
      id: `${id}-ear`,
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
    blob(...at(21, -42), 3.8 * k, 3.8 * k, 'clear'),
    blob(...at(22, -41.5), 2 * k, 2 * k),
    {
      color: 'clear',
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
function sparrowPart(
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
function flying(
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
