import type { InkPoint, InkStroke } from './brush';
import {
  ARM_LINE,
  blob,
  machineJoint,
  SOLID_LINE,
  steamCurl,
  type InkMotion,
  type InkPart,
  type InkScene,
} from './scenes';

/* Butterflies on the banner grid. The palmier that flies out of the oven closes
   the home page. The butterfly on a still robot hand and the two that leave a
   gift box are spares that no page uses yet. */

type Pt = readonly [number, number];
type Facing = 1 | -1;

const WIDTH = 620;
const HEIGHT = 196;
const GROUND = 184;

function groundLine(from: number, to: number): InkPart {
  return {
    id: 'ground',
    strokes: [
      {
        pts: [
          [from, GROUND + 2, 2],
          [(from + to) / 2, GROUND - 1, 7],
          [to, GROUND + 2, 2],
        ],
        dry: 0.8,
        rough: 0.9,
        grain: 0.02,
      },
    ],
  };
}

/* maps a butterfly's own units, with its thorax at 0, 0, onto the scene; turn
   rotates them, in radians */
function placer(x: number, y: number, k: number, facing: Facing, turn = 0) {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const at = (px: number, py: number): [number, number] => {
    const fx = px * facing;
    return [x + (fx * cos - py * sin) * k, y + (fx * sin + py * cos) * k];
  };
  const pts = (list: readonly InkPoint[]): InkPoint[] =>
    list.map(([px, py, w]): InkPoint => [...at(px, py), w * k]);
  return { at, pts };
}

const WING = { dry: 0.24, rough: 0.88, grain: 0.04 } as const;
const CELL = { color: 'clear', dry: 0.2, rough: 0.9, grain: 0 } as const;

/* ---------- a butterfly seen from above, head up ---------- */

/* the two wings of one side: a fan of three pulls for the forewing, a lobe and a
   tail for the hindwing, then the cells and the dots of the margin cut out */
function wingsFromAbove(
  x: number,
  y: number,
  k: number,
  side: Facing,
  gold: boolean,
  turn = 0,
): InkStroke[] {
  const { at, pts } = placer(x, y, k, side, turn);
  return [
    {
      ...WING,
      pts: pts([
        [3, -6, 8],
        [18, -18, 24],
        [34, -30, 28],
        [50, -40, 20],
        [60, -46, 6],
      ]),
    },
    {
      ...WING,
      pts: pts([
        [4, -3, 8],
        [22, -12, 24],
        [40, -22, 24],
        [56, -30, 8],
      ]),
    },
    {
      ...WING,
      dry: 0.3,
      pts: pts([
        [4, 0, 8],
        [20, -4, 20],
        [38, -8, 18],
        [50, -10, 6],
      ]),
    },
    {
      ...WING,
      pts: pts([
        [3, 2, 8],
        [14, 8, 22],
        [26, 16, 26],
        [34, 26, 16],
        [36, 34, 5],
      ]),
    },
    {
      ...WING,
      keepLine: true,
      pts: pts([
        [32, 28, 5],
        [36, 40, 3],
        [37, 52, 1.4],
      ]),
    },
    {
      ...CELL,
      pts: pts([
        [13, -14, 1.4],
        [30, -25, 5],
        [46, -35, 1.4],
      ]),
    },
    {
      ...CELL,
      pts: pts([
        [15, -7, 1.2],
        [32, -14, 4.4],
        [46, -20, 1.2],
      ]),
    },
    {
      ...CELL,
      pts: pts([
        [10, 6, 1.2],
        [20, 13, 4.2],
        [28, 21, 1.2],
      ]),
    },
    blob(...at(51, -37), 2.2 * k, 2.2 * k, 'clear'),
    blob(...at(53, -27), 2 * k, 2 * k, 'clear'),
    blob(...at(49, -16), 1.9 * k, 1.9 * k, 'clear'),
    blob(...at(31, 18), 1.9 * k, 1.9 * k, 'clear'),
    ...(gold ? [blob(...at(28, 27), 2.6 * k, 2.6 * k, 'gold')] : []),
  ];
}

function bodyFromAbove(x: number, y: number, k: number): InkStroke[] {
  const { at, pts } = placer(x, y, k, 1);
  return [
    {
      pts: pts([
        [0, 2, 7],
        [0, 16, 6],
        [0, 30, 2.4],
      ]),
      dry: 0.1,
      rough: 0.5,
      grain: 0.02,
    },
    blob(...at(0, -4), 4.6 * k, 8 * k),
    blob(...at(0, -15), 3.6 * k, 3.6 * k),
    {
      pts: pts([
        [2, -18, 1.5],
        [8, -34, 1.2],
        [17, -48, 1],
      ]),
      dry: 0.3,
      rough: 0.6,
      grain: 0,
      keepLine: true,
    },
    {
      pts: pts([
        [-2, -18, 1.5],
        [-7, -36, 1.2],
        [-18, -46, 1],
      ]),
      dry: 0.3,
      rough: 0.6,
      grain: 0,
      keepLine: true,
    },
    blob(...at(17, -49), 2.2 * k, 2.2 * k),
    blob(...at(-18, -47), 2.2 * k, 2.2 * k),
  ];
}

/* a butterfly in flight: both sides of its wings fold toward its body together,
   and the whole butterfly banks and wanders */
function flutter(
  id: string,
  x: number,
  y: number,
  k: number,
  beat: number,
  travel: readonly InkMotion[],
  gold = false,
): InkPart[] {
  const motions: InkMotion[] = [
    ...travel,
    { kind: 'sway', amount: '7deg', seconds: beat * 7.3, delay: -beat * 3, origin: [x, y] },
  ];
  const fold: InkMotion = {
    kind: 'fold',
    amount: '0.22',
    seconds: beat,
    delay: -beat * 0.4,
    origin: [x, y],
  };
  return [
    { id: `${id}-left`, motions: [...motions, fold], strokes: wingsFromAbove(x, y, k, -1, gold) },
    { id: `${id}-right`, motions: [...motions, fold], strokes: wingsFromAbove(x, y, k, 1, gold) },
    { id: `${id}-body`, motions, strokes: bodyFromAbove(x, y, k) },
  ];
}

/* ---------- a butterfly at rest, seen from the side ---------- */

/* its feet at x, y; its wings stand closed over its back, the forewing to the
   front and the hindwing behind, and they open and close slowly */
function restingButterfly(
  id: string,
  x: number,
  y: number,
  k: number,
  facing: Facing,
  carrier: readonly InkMotion[],
): InkPart[] {
  const { at, pts } = placer(x, y, k, facing);
  const base = at(1, -8);
  const upright = (Math.PI / 2) * facing;
  const wings: InkPart = {
    id: `${id}-wings`,
    motions: [
      ...carrier,
      { kind: 'flap', amount: '0.55', seconds: 1.6, delay: -0.5, origin: base },
    ],
    strokes: wingsFromAbove(...base, k * 0.86, -facing as Facing, true, upright - 0.22 * facing),
  };
  const foot = (from: Pt, to: Pt): InkStroke => ({
    pts: pts([
      [...from, 1.2],
      [...to, 0.9],
    ]),
    grain: 0,
    rough: 0.5,
  });
  return [
    {
      id: `${id}-body`,
      pause: 0.05,
      motions: carrier,
      strokes: [
        foot([-3, -4], [-6, 0]),
        foot([3, -4], [3, 0]),
        foot([7, -5], [11, 0]),
        {
          pts: pts([
            [-2, -7, 6],
            [-14, -6, 5],
            [-27, -3, 2.2],
          ]),
          dry: 0.1,
          rough: 0.5,
          grain: 0.02,
        },
        blob(...at(2, -7), 4.8 * k, 4.2 * k),
        blob(...at(9, -9), 3.4 * k, 3.4 * k),
        {
          pts: pts([
            [11, -11, 1.3],
            [24, -19, 1.1],
            [38, -24, 1],
          ]),
          dry: 0.3,
          rough: 0.6,
          grain: 0,
          keepLine: true,
        },
        blob(...at(39, -24.5), 2.1 * k, 2.1 * k),
      ],
    },
    wings,
  ];
}

/* ---------- a still hand: a butterfly rests on the open palm of a robot arm ---------- */

/* The subject stays left of x 285, where the closing banner's two buttons start. */

const HAND_SHOULDER: Pt = [250, 150];
const HAND_ELBOW: Pt = [216, 86];
const HAND_WRIST: Pt = [156, 102];
const PALM: Pt = [130, 95];

/* the arm holds so still that it barely breathes */
const HOLD: InkMotion = { kind: 'sway', amount: '0.4deg', seconds: 4.3, origin: HAND_SHOULDER };
const HOLD_ELBOW: InkMotion = {
  kind: 'sway',
  amount: '0.5deg',
  seconds: 3.1,
  delay: -1.2,
  origin: HAND_ELBOW,
};

export const stillHandScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    groundLine(90, 360),
    {
      id: 'base',
      strokes: [
        {
          flat: true,
          rough: 0.5,
          grain: 0.03,
          pts: [
            [HAND_SHOULDER[0], GROUND + 2, 54],
            [HAND_SHOULDER[0], 172, 44],
            [HAND_SHOULDER[0], 160, 30],
          ],
        },
        {
          color: 'gold',
          flat: true,
          rough: 0.4,
          grain: 0.03,
          pts: [
            [HAND_SHOULDER[0], 179, 42],
            [HAND_SHOULDER[0], 172, 40],
          ],
        },
      ],
    },
    {
      id: 'upper-arm',
      motions: [HOLD],
      strokes: [
        {
          ...ARM_LINE,
          pts: [
            [HAND_SHOULDER[0], HAND_SHOULDER[1], 21],
            [232, 118, 18],
            [HAND_ELBOW[0], HAND_ELBOW[1], 16],
          ],
        },
        {
          color: 'clear',
          dry: 0.2,
          rough: 0.5,
          grain: 0,
          pts: [
            [242, 136, 1.4],
            [231, 116, 2],
            [222, 100, 1.2],
          ],
        },
        {
          dry: 0.2,
          rough: 0.6,
          grain: 0.02,
          pts: [
            [266, 152, 1],
            [256, 112, 1.3],
            [224, 82, 1],
          ],
        },
        ...machineJoint(HAND_SHOULDER[0], HAND_SHOULDER[1], 16),
      ],
    },
    {
      id: 'forearm',
      motions: [HOLD, HOLD_ELBOW],
      strokes: [
        {
          ...ARM_LINE,
          pts: [
            [HAND_ELBOW[0], HAND_ELBOW[1], 15],
            [186, 92, 12],
            [HAND_WRIST[0], HAND_WRIST[1], 10],
          ],
        },
        {
          color: 'clear',
          dry: 0.2,
          rough: 0.5,
          grain: 0,
          pts: [
            [204, 90, 1.2],
            [186, 93, 1.8],
            [168, 98, 1],
          ],
        },
        ...machineJoint(HAND_ELBOW[0], HAND_ELBOW[1], 13),
        /* the hand: a flat palm held out level, with a lip at its tip */
        {
          ...SOLID_LINE,
          flat: true,
          pts: [
            [HAND_WRIST[0], 101, 9],
            [136, 99, 8],
            [114, 98, 6],
          ],
        },
        {
          ...SOLID_LINE,
          pts: [
            [116, 100, 4.6],
            [109, 94, 3.6],
            [108, 87, 1.8],
          ],
        },
        ...machineJoint(HAND_WRIST[0], HAND_WRIST[1], 9),
      ],
    },
    ...restingButterfly('resting', PALM[0], PALM[1], 1, -1, [HOLD, HOLD_ELBOW]),
  ],
};

/* ---------- papillon: a palmier flies out of the oven ---------- */

/* also left of x 285, for the closing banner */

const OVEN_LEFT = 148;
const OVEN_RIGHT = 272;
const OVEN_MIDDLE = (OVEN_LEFT + OVEN_RIGHT) / 2;
const OVEN_TOP = 100;
const OVEN_FOOT = 172;
const MOUTH_Y = 146;

/* one wing of the palmier: a gold lobe with its rolled layers cut out as a scroll */
function palmierWing(x: number, y: number, k: number, side: Facing): InkStroke[] {
  const { pts } = placer(x, y, k, side);
  const scroll: InkPoint[] = [];
  for (let i = 0; i <= 14; i += 1) {
    const turn = 0.3 + (i / 14) * 1.6 * Math.PI * 2;
    const r = 3 + (i / 14) * 15;
    scroll.push([22 + Math.cos(turn) * r * 0.9, -6 + Math.sin(turn) * r, 1.4 + (i / 14) * 1.6]);
  }
  return [
    {
      color: 'gold',
      dry: 0.08,
      rough: 0.55,
      grain: 0.05,
      pace: 0.8,
      pts: pts([
        [3, 14, 8],
        [10, 6, 24],
        [22, -6, 40],
        [26, -18, 30],
        [24, -28, 8],
      ]),
    },
    { color: 'clear', dry: 0.3, rough: 0.9, grain: 0, pts: pts(scroll) },
  ];
}

function palmierFlight(id: string, x: number, y: number, k: number, beat: number): InkPart[] {
  const motions: InkMotion[] = [
    { kind: 'drift', amount: '9px', seconds: 4.4, delay: -1 },
    { kind: 'bob', amount: '3px', seconds: beat * 2, delay: -beat },
    { kind: 'sway', amount: '6deg', seconds: 3.3, origin: [x, y] },
  ];
  const fold: InkMotion = { kind: 'fold', amount: '0.3', seconds: beat, origin: [x, y] };
  return [
    { id: `${id}-left`, motions: [...motions, fold], strokes: palmierWing(x, y, k, -1) },
    { id: `${id}-right`, motions: [...motions, fold], strokes: palmierWing(x, y, k, 1) },
    { id: `${id}-body`, motions, strokes: bodyFromAbove(x, y, k * 0.9) },
  ];
}

export const palmierOvenScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    groundLine(100, 380),
    {
      id: 'oven',
      strokes: [
        {
          flat: true,
          rough: 0.06,
          grain: 0.03,
          pts: [
            [OVEN_MIDDLE, OVEN_TOP, OVEN_RIGHT - OVEN_LEFT],
            [OVEN_MIDDLE, OVEN_FOOT, OVEN_RIGHT - OVEN_LEFT],
          ],
        },
        {
          flat: true,
          rough: 0.5,
          grain: 0.04,
          pts: [
            [OVEN_LEFT + 22, OVEN_TOP + 2, 13],
            [OVEN_LEFT + 22, OVEN_TOP - 18, 11],
          ],
        },
        /* the open deck, with the heat at its back */
        {
          color: 'clear',
          flat: true,
          rough: 0.25,
          grain: 0,
          pts: [
            [OVEN_LEFT + 14, MOUTH_Y, 30],
            [OVEN_RIGHT - 14, MOUTH_Y, 30],
          ],
        },
        {
          color: 'gold',
          dry: 0.45,
          rough: 1,
          grain: 0.02,
          pts: [
            [OVEN_LEFT + 20, MOUTH_Y - 10, 5],
            [OVEN_MIDDLE, MOUTH_Y - 9, 7],
            [OVEN_RIGHT - 20, MOUTH_Y - 10, 5],
          ],
        },
        {
          color: 'clear',
          dry: 0.2,
          rough: 0.6,
          grain: 0,
          pts: [
            [OVEN_LEFT + 10, 122, 2.2],
            [OVEN_RIGHT - 10, 122, 2.2],
          ],
        },
        {
          color: 'clear',
          rough: 0.5,
          grain: 0,
          pts: [
            [OVEN_MIDDLE - 14, 109, 3.6],
            [OVEN_MIDDLE + 34, 109, 3.6],
          ],
        },
        blob(OVEN_LEFT + 20, 109, 5, 5, 'clear'),
        blob(OVEN_LEFT + 20, 109, 2.4, 2.4),
        {
          ...SOLID_LINE,
          pts: [
            [OVEN_LEFT + 12, OVEN_FOOT - 2, 8],
            [OVEN_LEFT + 12, GROUND + 2, 6],
          ],
        },
        {
          ...SOLID_LINE,
          pts: [
            [OVEN_RIGHT - 12, OVEN_FOOT - 2, 8],
            [OVEN_RIGHT - 12, GROUND + 2, 6],
          ],
        },
      ],
    },
    steamCurl('smoke', OVEN_LEFT + 22, OVEN_TOP - 20, 0.44, -1.2),
    ...palmierFlight('palmier', 236, 58, 0.8, 0.42),
  ],
};

/* ---------- a gift: two butterflies leave a box with its ribbon undone ---------- */

const BOX_LEFT = 432;
const BOX_RIGHT = 516;
const BOX_MIDDLE = (BOX_LEFT + BOX_RIGHT) / 2;
const BOX_TOP = 130;
const HINGE: Pt = [BOX_RIGHT + 1, BOX_TOP - 4];

export const giftScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    groundLine(340, 590),
    {
      id: 'box',
      strokes: [
        {
          flat: true,
          rough: 0.08,
          grain: 0.03,
          pts: [
            [BOX_MIDDLE, BOX_TOP, BOX_RIGHT - BOX_LEFT],
            [BOX_MIDDLE, GROUND, BOX_RIGHT - BOX_LEFT],
          ],
        },
        /* the band that held the bow, and its loose end on the ground */
        {
          color: 'gold',
          flat: true,
          rough: 0.3,
          grain: 0.03,
          pts: [
            [BOX_MIDDLE, BOX_TOP, 10],
            [BOX_MIDDLE, GROUND, 10],
          ],
        },
        {
          color: 'gold',
          dry: 0.25,
          rough: 0.7,
          grain: 0.03,
          pts: [
            [BOX_MIDDLE - 2, BOX_TOP + 2, 6],
            [BOX_LEFT + 2, BOX_TOP + 4, 6],
            [BOX_LEFT - 10, BOX_TOP + 22, 5.5],
            [BOX_LEFT - 12, 168, 4.6],
            [BOX_LEFT - 34, GROUND - 1, 3],
          ],
        },
      ],
    },
    {
      id: 'lid',
      motions: [{ kind: 'sway', amount: '1.6deg', seconds: 2.7, delay: -0.8, origin: HINGE }],
      strokes: [
        {
          flat: true,
          rough: 0.3,
          grain: 0.03,
          pts: [
            [HINGE[0] + 2, HINGE[1] + 2, 13],
            [HINGE[0] + 20, HINGE[1] - 40, 13],
            [HINGE[0] + 36, HINGE[1] - 82, 13],
          ],
        },
      ],
    },
    ...flutter('low', 466, 100, 0.42, 0.3, [{ kind: 'bob', amount: '4px', seconds: 1.9 }]),
    ...flutter(
      'high',
      380,
      56,
      0.6,
      0.37,
      [{ kind: 'drift', amount: '12px', seconds: 4.6, delay: -2 }],
      true,
    ),
  ],
};
