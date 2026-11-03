import type { InkPoint, InkStroke } from './brush';
import {
  ARM_LINE,
  blob,
  croissant,
  goatScene,
  loaf,
  machineJoint,
  SOLID_LINE,
  sparrowPart,
  steamCurl,
  type InkMotion,
  type InkPart,
  type InkScene,
} from './scenes';

/* Two more bakery robots for the Satyr page, on the banner grid and in the hand
   of the cobot banner: an oven arm and a cart that carries a rack. */

type Pt = readonly [number, number];

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

/* ---------- the oven arm: an arm slides a peel of loaves into a deck oven ---------- */

const OVEN_LEFT = 330;
const OVEN_RIGHT = 510;
const OVEN_MIDDLE = (OVEN_LEFT + OVEN_RIGHT) / 2;
const CHIMNEY = OVEN_RIGHT - 24;
const OVEN_TOP = 64;
const OVEN_FOOT = 174;
const MOUTH_Y = 134;
const BLADE_Y = 145;

const SHOULDER: Pt = [206, 146];
const ELBOW: Pt = [240, 96];
const WRIST: Pt = [284, 106];
const CLAMP: Pt = [296, 118];

const AT_SHOULDER: InkMotion = { kind: 'sway', amount: '0.6deg', seconds: 3.4, origin: SHOULDER };
const AT_ELBOW: InkMotion = {
  kind: 'sway',
  amount: '0.8deg',
  seconds: 2.6,
  delay: -1,
  origin: ELBOW,
};
/* the peel slides in and out of the mouth */
const PUSH: InkMotion = { kind: 'drift', amount: '5px', seconds: 2.8, delay: -0.7 };

export const ovenArmScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    groundLine(150, 570),
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
        /* the chimney */
        {
          flat: true,
          rough: 0.5,
          grain: 0.04,
          pts: [
            [CHIMNEY, OVEN_TOP + 2, 14],
            [CHIMNEY, OVEN_TOP - 20, 12],
          ],
        },
        /* the open lower deck */
        {
          color: 'clear',
          flat: true,
          rough: 0.25,
          grain: 0,
          pts: [
            [OVEN_LEFT + 16, MOUTH_Y, 34],
            [OVEN_RIGHT - 16, MOUTH_Y, 34],
          ],
        },
        /* the heat at the back of the mouth */
        {
          color: 'gold',
          dry: 0.45,
          rough: 1,
          grain: 0.02,
          pts: [
            [OVEN_LEFT + 22, MOUTH_Y - 12, 5],
            [OVEN_MIDDLE, MOUTH_Y - 11, 7],
            [OVEN_RIGHT - 22, MOUTH_Y - 12, 5],
          ],
        },
        /* the closed upper deck: its seam, its handle, a dial and a light */
        {
          color: 'clear',
          dry: 0.2,
          rough: 0.6,
          grain: 0,
          pts: [
            [OVEN_LEFT + 12, 108, 2.4],
            [OVEN_RIGHT - 12, 108, 2.4],
          ],
        },
        {
          color: 'clear',
          rough: 0.5,
          grain: 0,
          pts: [
            [OVEN_MIDDLE - 32, 92, 4],
            [OVEN_MIDDLE + 32, 92, 4],
          ],
        },
        blob(OVEN_RIGHT - 26, 80, 7, 7, 'clear'),
        blob(OVEN_RIGHT - 26, 80, 3.2, 3.2),
        blob(OVEN_RIGHT - 46, 80, 3.4, 3.4, 'gold'),
        /* the legs */
        {
          ...SOLID_LINE,
          pts: [
            [OVEN_LEFT + 14, OVEN_FOOT - 2, 9],
            [OVEN_LEFT + 14, GROUND + 2, 7],
          ],
        },
        {
          ...SOLID_LINE,
          pts: [
            [OVEN_RIGHT - 14, OVEN_FOOT - 2, 9],
            [OVEN_RIGHT - 14, GROUND + 2, 7],
          ],
        },
      ],
    },
    steamCurl('smoke', CHIMNEY, OVEN_TOP - 22, 0.5, -1.2),
    {
      id: 'base',
      strokes: [
        {
          flat: true,
          rough: 0.5,
          grain: 0.03,
          pts: [
            [SHOULDER[0], GROUND + 2, 52],
            [SHOULDER[0], 170, 42],
            [SHOULDER[0], 156, 30],
          ],
        },
        {
          color: 'gold',
          flat: true,
          rough: 0.4,
          grain: 0.03,
          pts: [
            [SHOULDER[0], 178, 40],
            [SHOULDER[0], 170, 38],
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
            [SHOULDER[0], SHOULDER[1], 21],
            [220, 120, 18],
            [ELBOW[0], ELBOW[1], 16],
          ],
        },
        {
          color: 'clear',
          dry: 0.2,
          rough: 0.5,
          grain: 0,
          pts: [
            [211, 136, 1.4],
            [221, 118, 2],
            [232, 104, 1.2],
          ],
        },
        ...machineJoint(SHOULDER[0], SHOULDER[1], 15),
      ],
    },
    {
      id: 'forearm',
      motions: [AT_SHOULDER, AT_ELBOW],
      strokes: [
        {
          ...ARM_LINE,
          pts: [
            [ELBOW[0], ELBOW[1], 15],
            [262, 98, 13],
            [WRIST[0], WRIST[1], 11],
          ],
        },
        {
          color: 'clear',
          dry: 0.2,
          rough: 0.5,
          grain: 0,
          pts: [
            [248, 94, 1.2],
            [262, 95, 1.8],
            [276, 100, 1],
          ],
        },
        ...machineJoint(ELBOW[0], ELBOW[1], 12),
      ],
    },
    {
      id: 'peel',
      motions: [AT_SHOULDER, AT_ELBOW, PUSH],
      strokes: [
        /* the handle, held in a clamp, then the thin blade in the mouth */
        {
          ...SOLID_LINE,
          pts: [
            [CLAMP[0] - 20, CLAMP[1] - 10, 6.5],
            [CLAMP[0], CLAMP[1], 7],
            [OVEN_LEFT - 8, 131, 6.4],
            [OVEN_LEFT + 18, BLADE_Y - 1, 5.6],
          ],
        },
        {
          ...SOLID_LINE,
          flat: true,
          pts: [
            [OVEN_LEFT + 16, BLADE_Y, 6],
            [OVEN_LEFT + 110, BLADE_Y, 6],
          ],
        },
        ...loaf(OVEN_LEFT + 42, BLADE_Y - 9, 34, 13),
        ...loaf(OVEN_LEFT + 84, BLADE_Y - 9, 34, 13),
        {
          ...SOLID_LINE,
          pts: [
            [WRIST[0], WRIST[1], 9],
            [CLAMP[0], CLAMP[1], 7.5],
          ],
        },
        ...machineJoint(CLAMP[0], CLAMP[1], 7.5),
        ...machineJoint(WRIST[0], WRIST[1], 9),
      ],
    },
    sparrowPart('watcher', OVEN_MIDDLE - 10, OVEN_TOP, 0.5, -1, 2.4),
  ],
};

/* ---------- the rack runner: a cart robot carries a rack, and the goat follows ---------- */

const BODY_LEFT = 252;
const BODY_RIGHT = 398;
const BODY_TOP = 146;
const POST_LEFT = 264;
const POST_RIGHT = 386;
const SHELF_B = 114;
const SHELF_C = 82;
const RACK_TOP = 52;

/* the cart rumbles on the floor */
const RUN: InkMotion = { kind: 'bob', amount: '0.9px', seconds: 0.34 };
const SHELF_RATTLE: InkMotion = { kind: 'sway', amount: '1.4deg', seconds: 0.6, delay: -0.2 };

function shelf(y: number): InkStroke {
  return {
    ...SOLID_LINE,
    flat: true,
    pts: [
      [POST_LEFT - 4, y, 8],
      [POST_RIGHT + 4, y, 8],
    ],
  };
}

function brioche(x: number, base: number): InkStroke[] {
  return [
    blob(x, base - 8, 13, 8, 'gold'),
    blob(x, base - 19, 5.5, 4.5, 'gold'),
    {
      color: 'clear',
      grain: 0,
      rough: 0.6,
      pts: [
        [x - 7, base - 13, 1],
        [x, base - 15, 2],
        [x + 7, base - 13, 1],
      ],
    },
  ];
}

/* the baby goat of the hero, smaller, with its nose at x and its feet on the floor */
const kid = goatScene.parts.filter((part) => part.id.startsWith('kid-'));
const kidPoints = kid.flatMap((part) => part.strokes.flatMap((stroke) => stroke.pts));
const kidNose = Math.max(...kidPoints.map(([x]) => x));
const kidFeet = Math.max(...kidPoints.map(([, y]) => y));

function kidAt(noseX: number, k: number): InkPart[] {
  const dx = noseX - kidNose * k;
  const dy = GROUND + 1 - kidFeet * k;
  return kid.map((part) => ({
    ...part,
    id: `runner-${part.id}`,
    strokes: part.strokes.map(
      (stroke): InkStroke => ({
        ...stroke,
        pts: stroke.pts.map(([x, y, w]): InkPoint => [x * k + dx, y * k + dy, w * k]),
      }),
    ),
    motions: part.motions?.map((motion) =>
      motion.origin
        ? { ...motion, origin: [motion.origin[0] * k + dx, motion.origin[1] * k + dy] as const }
        : motion,
    ),
  }));
}

export const rackRunnerScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    groundLine(40, 580),
    /* dust kicked up behind the wheels */
    {
      id: 'dust',
      motions: [{ kind: 'drift', amount: '4px', seconds: 1.3 }],
      strokes: [
        {
          dry: 0.7,
          rough: 1,
          grain: 0.02,
          pts: [
            [244, GROUND - 3, 2.4],
            [226, GROUND - 7, 1.8],
            [212, GROUND - 6, 0.8],
          ],
        },
        {
          dry: 0.7,
          rough: 1,
          grain: 0.02,
          pts: [
            [238, GROUND - 12, 1.8],
            [222, GROUND - 17, 1.2],
          ],
        },
      ],
    },
    ...kidAt(212, 0.5),
    {
      id: 'cart',
      motions: [RUN],
      strokes: [
        {
          flat: true,
          rough: 0.25,
          grain: 0.03,
          pts: [
            [BODY_LEFT, BODY_TOP + 14, 28],
            [BODY_RIGHT, BODY_TOP + 14, 28],
          ],
        },
        {
          color: 'gold',
          flat: true,
          rough: 0.4,
          grain: 0.03,
          pts: [
            [BODY_LEFT + 8, BODY_TOP + 19, 6],
            [BODY_RIGHT - 8, BODY_TOP + 19, 6],
          ],
        },
        /* the sensor on its mast looks ahead */
        {
          ...SOLID_LINE,
          pts: [
            [BODY_RIGHT - 6, BODY_TOP, 3.4],
            [BODY_RIGHT - 2, BODY_TOP - 16, 2.8],
          ],
        },
        ...machineJoint(BODY_RIGHT - 1, BODY_TOP - 21, 6),
        ...machineJoint(BODY_LEFT + 26, GROUND - 7, 9),
        ...machineJoint(BODY_RIGHT - 26, GROUND - 7, 9),
        /* the rack */
        {
          ...SOLID_LINE,
          pts: [
            [POST_LEFT, BODY_TOP, 8],
            [POST_LEFT, RACK_TOP, 7],
          ],
        },
        {
          ...SOLID_LINE,
          pts: [
            [POST_RIGHT, BODY_TOP, 8],
            [POST_RIGHT, RACK_TOP, 7],
          ],
        },
        shelf(SHELF_B),
        shelf(SHELF_C),
        shelf(RACK_TOP),
      ],
    },
    {
      id: 'croissants',
      motions: [RUN],
      strokes: [
        ...croissant(291, BODY_TOP - 6, 10.5),
        ...croissant(325, BODY_TOP - 6, 10.5),
        ...croissant(359, BODY_TOP - 6, 10.5),
      ],
    },
    {
      id: 'loaves',
      motions: [RUN, { ...SHELF_RATTLE, origin: [325, SHELF_B] }],
      strokes: [...loaf(302, SHELF_B - 10, 34, 14), ...loaf(350, SHELF_B - 10, 34, 14)],
    },
    {
      id: 'brioches',
      motions: [RUN],
      strokes: [...brioche(306, SHELF_C - 2), ...brioche(346, SHELF_C - 2)],
    },
    sparrowPart('rider', 344, RACK_TOP - 3, 0.42, 1, 2.2, [RUN]),
  ],
};
