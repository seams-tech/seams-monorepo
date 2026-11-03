import type { InkPoint, InkStroke } from './brush';
import {
  ARM_LINE,
  blob,
  roundBlob,
  SOLID_LINE,
  whiskGoatScene,
  type InkMotion,
  type InkPart,
  type InkScene,
} from './scenes';

/* A concept on the banner grid: the baby goat leads a big, gentle robot by a rope.
   The goat walks ahead with the rope over its back and the end in its mouth; the
   robot holds the other end and toddles after it. */

type Pt = readonly [number, number];

const GROUND = 184;

/* ---------- the goat: the walking kid of the whisk banner ---------- */

/* its mouth in the whisk banner, where the whisk is held */
const WHISK_MOUTH: Pt = [256 + (250 - 175) * 0.72, 182 + (408 - 488) * 0.72];

function movedGoat(move: (x: number) => number): InkPart[] {
  return whiskGoatScene.parts
    .filter((part) => ['far-legs', 'tail', 'kid', 'ear'].includes(part.id))
    .map((part) => ({
      ...part,
      id: `goat-${part.id}`,
      strokes: part.strokes.map(
        (stroke): InkStroke => ({
          ...stroke,
          pts: stroke.pts.map(([x, y, w]): InkPoint => [move(x), y, w]),
        }),
      ),
      motions: part.motions?.map((motion) =>
        motion.origin
          ? { ...motion, origin: [move(motion.origin[0]), motion.origin[1]] as const }
          : motion,
      ),
    }));
}

/* ---------- the robot: drawn on the pixel grid of its reference picture ---------- */

/* The robot keeps the proportions of its reference: a tall bullet helmet, a short
   barrel body under a wide collar, short rod legs in big boots, cuffed arms and a
   long antenna. It is drawn in the reference's pixels, then mirrored to face the
   goat and shrunk so that it stands barely taller than the goat. */
const REF_GROUND: Pt = [975, 1230];
const SCENE_GROUND: Pt = [430, 184];
const U = 0.11;

function fromRef([x, y]: Pt): Pt {
  return [SCENE_GROUND[0] - (x - REF_GROUND[0]) * U, SCENE_GROUND[1] + (y - REF_GROUND[1]) * U];
}

const ROBOT_LINE = { ...ARM_LINE, rough: 0.35 } as const;

/* it hums, rocks a little from boot to boot, and tips its helmet at the goat */
const HUM: InkMotion = { kind: 'bob', amount: '0.6px', seconds: 1.3 };
const ROCK: InkMotion = { kind: 'sway', amount: '1deg', seconds: 2.4, origin: [930, 1230] };
const LOOK: InkMotion = {
  kind: 'sway',
  amount: '3deg',
  seconds: 3.1,
  delay: -1,
  origin: [952, 610],
};

/* every stroke below is in reference pixels, widths too */
function mass(points: readonly InkPoint[], flat = false): InkStroke {
  return { ...ROBOT_LINE, flat, pts: points };
}

function cut(points: readonly InkPoint[]): InkStroke {
  return { color: 'clear', dry: 0.1, rough: 0.5, grain: 0, pts: points };
}

function rivets(points: readonly Pt[]): InkStroke[] {
  return points.map(([x, y]) => blob(x, y, 15, 15, 'clear'));
}

function rod(points: readonly InkPoint[]): InkStroke {
  return { ...SOLID_LINE, keepLine: true, pts: points };
}

/* two pincer fingers from a cuff toward a point */
function pincer(at: Pt, toward: Pt): InkStroke[] {
  const dx = toward[0] - at[0];
  const dy = toward[1] - at[1];
  const length = Math.hypot(dx, dy);
  const nx = -dy / length;
  const ny = dx / length;
  return [-1, 1].map(
    (side): InkStroke => ({
      ...SOLID_LINE,
      flat: true,
      pts: [
        [at[0] + nx * side * 26, at[1] + ny * side * 26, 30],
        [toward[0] + nx * side * 18, toward[1] + ny * side * 18, 24],
      ],
    }),
  );
}

/* where the rope hand grips, in reference pixels */
const REF_HAND: Pt = [540, 704];

function refRobot(): InkPart[] {
  return [
    {
      id: 'boots',
      strokes: [
        /* two short rod legs from the hips, each into a big boot on the ground */
        rod([
          [972, 895, 32],
          [1040, 996, 30],
        ]),
        blob(1045, 1000, 48, 28),
        mass(
          [
            [1045, 1010, 126],
            [1045, 1190, 126],
          ],
          true,
        ),
        mass([
          [1108, 1205, 48],
          [1030, 1200, 60],
          [966, 1206, 46],
        ]),
        cut([
          [988, 1050, 13],
          [1102, 1050, 17],
        ]),
        ...rivets([
          [1008, 1072],
          [1045, 1076],
          [1082, 1072],
        ]),
        rod([
          [902, 895, 32],
          [882, 996, 30],
        ]),
        blob(880, 1000, 50, 28),
        mass(
          [
            [880, 1010, 132],
            [880, 1190, 132],
          ],
          true,
        ),
        mass([
          [948, 1205, 50],
          [860, 1200, 64],
          [784, 1206, 48],
        ]),
        cut([
          [818, 1050, 13],
          [942, 1050, 17],
        ]),
        ...rivets([
          [840, 1072],
          [880, 1076],
          [920, 1072],
        ]),
      ],
    },
    {
      id: 'rope-arm',
      motions: [HUM, ROCK],
      strokes: [
        /* the left arm reaches out to grip the rope */
        rod([
          [826, 664, 34],
          [760, 680, 32],
          [700, 690, 32],
        ]),
        mass(
          [
            [712, 690, 124],
            [604, 700, 116],
          ],
          true,
        ),
        cut([
          [680, 642, 13],
          [682, 740, 17],
        ]),
        ...rivets([
          [650, 652],
          [652, 690],
          [654, 728],
        ]),
        ...pincer([600, 700], REF_HAND),
      ],
    },
    {
      id: 'body',
      motions: [HUM, ROCK],
      strokes: [
        /* hips, a short barrel and a collar wider than the helmet */
        mass([
          [866, 890, 42],
          [935, 888, 46],
          [1008, 890, 42],
        ]),
        mass(
          [
            [920, 660, 256],
            [920, 878, 248],
          ],
          true,
        ),
        mass(
          [
            [768, 664, 46],
            [944, 662, 52],
            [1118, 664, 46],
          ],
          true,
        ),
        /* the collar ends in a riveted point on the chest */
        cut([
          [800, 698, 13],
          [995, 806, 20],
          [1104, 700, 13],
        ]),
        ...rivets([
          [846, 728],
          [900, 760],
          [952, 788],
          [1030, 774],
          [1078, 738],
        ]),
        /* a shoulder ball on each side */
        blob(832, 660, 26, 26),
        blob(1094, 700, 24, 24),
      ],
    },
    {
      id: 'hanging-arm',
      motions: [
        HUM,
        ROCK,
        { kind: 'sway', amount: '4deg', seconds: 2.1, delay: -0.8, origin: [1094, 700] },
      ],
      strokes: [
        rod([
          [1098, 708, 32],
          [1140, 790, 30],
        ]),
        mass(
          [
            [1132, 770, 122],
            [1208, 880, 114],
          ],
          true,
        ),
        cut([
          [1112, 822, 13],
          [1196, 772, 17],
        ]),
        ...rivets([
          [1150, 806],
          [1176, 790],
          [1124, 822],
        ]),
        ...pincer([1214, 888], [1240, 960]),
      ],
    },
    {
      id: 'helmet',
      motions: [HUM, ROCK, LOOK],
      strokes: [
        /* a tall bullet helmet: a round dome on a long drum, clear of the collar */
        roundBlob(952, 437, 117, 117),
        mass(
          [
            [952, 430, 234],
            [952, 600, 234],
          ],
          true,
        ),
        /* two plain eyes */
        blob(868, 488, 16, 40, 'clear'),
        blob(942, 488, 19, 40, 'clear'),
        /* the antenna socket */
        mass(
          [
            [970, 304, 30],
            [970, 250, 28],
          ],
          true,
        ),
        mass(
          [
            [970, 326, 72],
            [970, 300, 68],
          ],
          true,
        ),
      ],
    },
    {
      id: 'antenna',
      motions: [
        HUM,
        ROCK,
        LOOK,
        { kind: 'sway', amount: '4deg', seconds: 1.8, delay: -0.5, origin: [970, 252] },
      ],
      strokes: [
        rod([
          [970, 256, 16],
          [982, 130, 14],
          [994, 26, 13],
        ]),
        blob(995, 6, 30, 30, 'gold'),
      ],
    },
  ];
}

function robot(): InkPart[] {
  return refRobot().map((part) => ({
    ...part,
    strokes: part.strokes.map(
      (stroke): InkStroke => ({
        ...stroke,
        pts: stroke.pts.map(([x, y, w]): InkPoint => [...fromRef([x, y]), w * U]),
      }),
    ),
    motions: part.motions?.map((motion) =>
      motion.origin ? { ...motion, origin: fromRef(motion.origin) } : motion,
    ),
  }));
}

function rope(id: string, points: readonly InkPoint[], pivot: Pt): InkPart {
  return {
    id,
    motions: [{ kind: 'sway', amount: '0.6deg', seconds: 2.6, origin: pivot }],
    strokes: [{ dry: 0.2, rough: 0.6, grain: 0, keepLine: true, pts: points }],
  };
}

function ropeEnd(mouth: Pt, toward: 1 | -1): InkPart {
  return {
    id: 'rope-end',
    motions: [{ kind: 'sway', amount: '9deg', seconds: 0.9, origin: mouth }],
    strokes: [
      {
        dry: 0.3,
        rough: 0.7,
        grain: 0,
        keepLine: true,
        pts: [
          [mouth[0], mouth[1], 1.6],
          [mouth[0] + 5 * toward, mouth[1] + 8, 1.4],
          [mouth[0] + 6 * toward, mouth[1] + 17, 0.8],
        ],
      },
    ],
  };
}

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

/* ---------- the walk: the goat walks ahead with the rope over its back ---------- */

const WALK_SHIFT = 260;
const WALK_MOUTH: Pt = [WHISK_MOUTH[0] + WALK_SHIFT, WHISK_MOUTH[1]];
const ROPE_HAND: Pt = fromRef(REF_HAND);

export const goatWalkScene: InkScene = {
  width: 620,
  height: 196,
  parts: [
    groundLine(350, 606),
    ...robot(),
    ...movedGoat((x) => x + WALK_SHIFT),
    rope(
      'rope',
      [
        [ROPE_HAND[0], ROPE_HAND[1], 1.9],
        [504, 123, 2],
        [532, 121, 2],
        [WALK_MOUTH[0] - 22, WALK_MOUTH[1] - 3, 1.8],
        [WALK_MOUTH[0], WALK_MOUTH[1], 1.6],
      ],
      WALK_MOUTH,
    ),
    ropeEnd([WALK_MOUTH[0] - 1, WALK_MOUTH[1]], 1),
  ],
};
