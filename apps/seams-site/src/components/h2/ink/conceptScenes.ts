import type { InkColor, InkPoint, InkStroke } from './brush';
import {
  blob,
  croissant,
  fallingSpeck,
  flying,
  loaf,
  roundBlob,
  sparrowPart,
  steamCurl,
  wheat,
  type InkMotion,
  type InkPart,
  type InkScene,
} from './scenes';

/* Spare drawings, on a 420 by 196 grid; the folding slip is banner width. None is
   used on a page yet. */

const WIDTH = 420;
const HEIGHT = 196;

function line(pts: readonly InkPoint[], extra: Partial<InkStroke> = {}): InkStroke {
  return { pts, dry: 0.16, rough: 0.8, grain: 0.02, ...extra };
}

/* ---------- a baker's mobile: everything hangs in balance ---------- */

const BALANCE: InkMotion = { kind: 'sway', amount: '1.6deg', seconds: 4.1, origin: [210, 34] };
const LOWER_BALANCE: InkMotion = { kind: 'sway', amount: '3deg', seconds: 3.1, origin: [298, 62] };

export const mobileScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    {
      id: 'hook',
      strokes: [
        line(
          [
            [210, 0, 1.2],
            [210, 34, 1.2],
          ],
          { pace: 2 },
        ),
      ],
    },
    {
      id: 'bar',
      motions: [BALANCE],
      strokes: [
        line(
          [
            [66, 44, 2.6],
            [210, 30, 4],
            [340, 42, 2.6],
          ],
          { pace: 1.2 },
        ),
      ],
    },
    {
      id: 'croissant',
      motions: [BALANCE, { kind: 'sway', amount: '4deg', seconds: 2.7, origin: [68, 44] }],
      strokes: [
        line(
          [
            [68, 44, 1],
            [68, 92, 1],
          ],
          { pace: 2 },
        ),
        ...croissant(68, 118, 30),
      ],
    },
    {
      id: 'thread',
      motions: [BALANCE],
      strokes: [
        line(
          [
            [298, 40, 1],
            [298, 62, 1],
          ],
          { pace: 2 },
        ),
      ],
    },
    {
      id: 'lower-bar',
      motions: [BALANCE, LOWER_BALANCE],
      strokes: [
        line(
          [
            [232, 70, 2],
            [298, 60, 3],
            [370, 70, 2],
          ],
          { pace: 1.2 },
        ),
      ],
    },
    {
      id: 'loaf',
      motions: [
        BALANCE,
        LOWER_BALANCE,
        { kind: 'sway', amount: '4deg', seconds: 2.3, origin: [234, 70] },
      ],
      strokes: [
        line(
          [
            [234, 70, 1],
            [234, 116, 1],
          ],
          { pace: 2 },
        ),
        ...loaf(234, 134, 56, 32),
      ],
    },
    {
      id: 'ear',
      motions: [BALANCE, { kind: 'sway', amount: '5deg', seconds: 2, origin: [150, 37] }],
      strokes: [
        line(
          [
            [150, 36, 1],
            [150, 58, 1],
          ],
          { pace: 2 },
        ),
      ],
    },
    ...wheat('hanging', [150, 40], [152, 100], [148, 172], 977, 0.8).map((part) => ({
      ...part,
      motions: [
        BALANCE,
        { kind: 'sway', amount: '5deg', seconds: 2, origin: [150, 37] },
      ] as readonly InkMotion[],
    })),
    {
      id: 'cup',
      motions: [
        BALANCE,
        LOWER_BALANCE,
        { kind: 'sway', amount: '4deg', seconds: 1.9, origin: [368, 70] },
      ],
      strokes: [
        line(
          [
            [368, 70, 1],
            [368, 112, 1],
          ],
          { pace: 2 },
        ),
        {
          flat: true,
          rough: 0.5,
          grain: 0.03,
          pts: [
            [368, 112, 44],
            [368, 132, 40],
            [368, 146, 24],
          ],
        },
        line(
          [
            [389, 118, 4],
            [400, 122, 5],
            [396, 136, 4],
            [384, 140, 3],
          ],
          { dry: 0, rough: 0.4 },
        ),
      ],
    },
  ],
};

/* ---------- one brush circle, and one gold ear that grows through it ---------- */

export const ensoScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    {
      id: 'circle',
      strokes: [
        {
          dry: 0.5,
          rough: 1,
          grain: 0.06,
          pace: 0.34,
          pts: Array.from({ length: 18 }, (_, i): InkPoint => {
            const angle = -0.75 + (i / 17) * Math.PI * 1.86;
            return [
              210 + Math.cos(angle) * 80,
              98 + Math.sin(angle) * 80,
              4 + 15 * Math.sin((i / 17) * Math.PI) ** 0.55,
            ];
          }),
        },
      ],
    },
    ...wheat('gold-ear', [150, 222], [176, 118], [266, 26], 41, 1.12, 'gold'),
    fallingSpeck('grain-a', 272, 60, 1.6, 0),
    fallingSpeck('grain-b', 286, 42, 1.3, -1),
  ],
};

/* ---------- an order slip folds, step by step, into a dart, and flies off as a bird ---------- */

type Corner = readonly [number, number];

/* a flat paper triangle: full width across its base, a point at its tip */
function wedge(base: Corner, tip: Corner, width: number, color: InkColor = 'ink'): InkStroke {
  return {
    color,
    flat: true,
    dry: 0.04,
    rough: 0.5,
    grain: color === 'clear' ? 0 : 0.03,
    pts: [
      [base[0], base[1], width],
      [tip[0], tip[1], 0.6],
    ],
  };
}

/* a cut through the paper, for a printed line, a crease or a torn edge */
function cut(pts: readonly InkPoint[]): InkStroke {
  return { pts, color: 'clear', dry: 0.3, rough: 0.6, grain: 0, pace: 2 };
}

function turnPoint([x, y]: Corner, [cx, cy]: Corner, degrees: number): Corner {
  const a = (degrees * Math.PI) / 180;
  return [
    cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
    cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
  ];
}

function turned(strokes: readonly InkStroke[], centre: Corner, degrees: number): InkStroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    pts: stroke.pts.map(([x, y, w]): InkPoint => [...turnPoint([x, y], centre, degrees), w]),
  }));
}

function trail(from: Corner, to: Corner): InkStroke {
  return line(
    [
      [from[0], from[1], 2.6],
      [to[0], to[1], 0.8],
    ],
    { dry: 0.7, rough: 0.9 },
  );
}

const SLIP_WIDTH = 36;
const SLIP_LENGTH = 64;
const SLIP_SLAB: Partial<InkStroke> = { flat: true, dry: 0.04, rough: 0.5, grain: 0.04 };

/* a top corner folded in to the middle line, gold side up */
function cornerFlap(cx: number, top: number, side: -1 | 1): { flap: InkStroke; hinge: Corner } {
  const half = SLIP_WIDTH / 2;
  const hinge: Corner = [cx + (side * half) / 2, top + half / 2];
  return { flap: wedge(hinge, [cx, top + half], half * 1.42, 'gold'), hinge };
}

/* the slip, upright around its centre, with its printed lines and a torn foot; a
   folded corner takes its square at the top, so the slab starts below that */
function slipStrokes(
  cx: number,
  cy: number,
  lines: readonly number[],
  folded: 0 | 1 | 2 = 0,
): InkStroke[] {
  const left = cx - SLIP_WIDTH / 2;
  const right = cx + SLIP_WIDTH / 2;
  const top = cy - SLIP_LENGTH / 2;
  const bottom = cy + SLIP_LENGTH / 2;
  const half = SLIP_WIDTH / 2;
  return [
    {
      ...SLIP_SLAB,
      pts: [
        [cx, folded === 0 ? top : top + half, SLIP_WIDTH],
        [cx, bottom, SLIP_WIDTH],
      ],
    },
    /* the right corner, while only the left one is folded */
    ...(folded === 1
      ? [
          {
            ...SLIP_SLAB,
            pts: [
              [cx + half / 2, top, half],
              [cx + half / 2, top + half + 2, half],
            ] as InkPoint[],
          },
        ]
      : []),
    ...lines.map((at, i) =>
      cut([
        [left + 7, top + SLIP_LENGTH * at, 2.4],
        [right - (i % 2 === 1 ? 15 : 7), top + SLIP_LENGTH * at, 2.4],
      ]),
    ),
    cut([
      [left - 3, bottom - 1, 5],
      [left + 8, bottom + 3, 5],
      [cx, bottom - 3, 5],
      [right - 8, bottom + 3, 5],
      [right + 3, bottom - 1, 5],
    ]),
  ];
}

/* step 1: the slip as it comes off the printer */
const FLAT: Corner = [52, 138];
/* step 2: one top corner folds in */
const ONE_CORNER: Corner = [146, 132];
const ONE_CORNER_TURN = 8;
const firstFold = cornerFlap(ONE_CORNER[0], ONE_CORNER[1] - SLIP_LENGTH / 2, -1);
/* step 3: both corners fold in, so the top becomes a point */
const TWO_CORNERS: Corner = [240, 122];
const leftFold = cornerFlap(TWO_CORNERS[0], TWO_CORNERS[1] - SLIP_LENGTH / 2, -1);
const rightFold = cornerFlap(TWO_CORNERS[0], TWO_CORNERS[1] - SLIP_LENGTH / 2, 1);
/* step 4: the sides folded in again and the slip folded in half, so it is a long point */
const HALF: Corner = [334, 110];

export const foldingScene: InkScene = {
  width: 620,
  height: HEIGHT,
  parts: [
    {
      id: 'flat-slip',
      motions: [{ kind: 'sway', amount: '2deg', seconds: 3.1, origin: [FLAT[0], FLAT[1] + 32] }],
      strokes: turned(slipStrokes(FLAT[0], FLAT[1], [0.22, 0.38, 0.54, 0.7]), FLAT, -4),
    },
    {
      id: 'one-corner',
      strokes: turned(
        slipStrokes(ONE_CORNER[0], ONE_CORNER[1], [0.42, 0.58, 0.74], 1),
        ONE_CORNER,
        ONE_CORNER_TURN,
      ),
    },
    {
      id: 'first-flap',
      /* the flap still presses down along its crease */
      motions: [
        {
          kind: 'sway',
          amount: '7deg',
          seconds: 1.9,
          origin: turnPoint(firstFold.hinge, ONE_CORNER, ONE_CORNER_TURN),
        },
      ],
      strokes: turned([firstFold.flap], ONE_CORNER, ONE_CORNER_TURN),
    },
    {
      id: 'two-corners',
      motions: [{ kind: 'bob', amount: '1.6px', seconds: 2.7 }],
      strokes: turned(
        [
          ...slipStrokes(TWO_CORNERS[0], TWO_CORNERS[1], [0.48, 0.64, 0.8], 2),
          leftFold.flap,
          rightFold.flap,
          cut([
            [TWO_CORNERS[0], TWO_CORNERS[1] - 32, 1.4],
            [TWO_CORNERS[0], TWO_CORNERS[1] - 13, 1.4],
          ]),
        ],
        TWO_CORNERS,
        24,
      ),
    },
    {
      id: 'half',
      motions: [{ kind: 'bob', amount: '2px', seconds: 2.4 }],
      strokes: turned(
        [
          /* a long ink point with the gold flaps along its edge, a crease and two printed lines */
          wedge([HALF[0], HALF[1] + 30], [HALF[0], HALF[1] - 34], 26),
          wedge([HALF[0] - 7, HALF[1] + 12], [HALF[0] - 1, HALF[1] - 28], 9, 'gold'),
          cut([
            [HALF[0], HALF[1] - 30, 1.4],
            [HALF[0], HALF[1] + 30, 1.4],
          ]),
          cut([
            [HALF[0] + 2, HALF[1] + 10, 2.2],
            [HALF[0] + 9, HALF[1] + 10, 2.2],
          ]),
          cut([
            [HALF[0] + 2, HALF[1] + 20, 2.2],
            [HALF[0] + 10, HALF[1] + 20, 2.2],
          ]),
        ],
        HALF,
        48,
      ),
    },
    {
      id: 'paper-plane',
      motions: [{ kind: 'bob', amount: '2.4px', seconds: 2.1 }],
      strokes: [
        /* step 5, the dart: an ink wing that keeps its printed lines, and a gold keel */
        wedge([410, 116], [456, 88], 12, 'gold'),
        wedge([398, 106], [462, 82], 26),
        cut([
          [406, 102, 2],
          [430, 93, 2],
        ]),
        cut([
          [408, 109, 2],
          [426, 102, 2],
        ]),
        cut([
          [400, 112, 1.4],
          [460, 83, 1.4],
        ]),
      ],
    },
    {
      id: 'trail',
      strokes: [
        trail([82, 137], [100, 135]),
        trail([178, 127], [196, 124]),
        trail([272, 116], [290, 112]),
        trail([366, 104], [384, 100]),
        trail([474, 78], [510, 66]),
      ],
    },
    ...flying('free-bird', 552, 56, 0.98, 1, 0.2),
  ],
};

/* ---------- the goat left: only its prints and its tail are still here ---------- */

function hoofPrint(x: number, y: number, k: number): InkStroke[] {
  return [
    {
      color: 'gold',
      rough: 0.6,
      grain: 0.04,
      pts: [
        [x, y, 2 * k],
        [x + 2 * k, y + 5 * k, 4 * k],
        [x + 2 * k, y + 10 * k, 1.6 * k],
      ],
    },
    {
      color: 'gold',
      rough: 0.6,
      grain: 0.04,
      pts: [
        [x + 7 * k, y, 2 * k],
        [x + 6 * k, y + 5 * k, 4 * k],
        [x + 5 * k, y + 10 * k, 1.6 * k],
      ],
    },
  ];
}

const prints: readonly [number, number, number][] = [
  [104, 166, 1.6],
  [134, 146, 1.5],
  [170, 162, 1.45],
  [200, 140, 1.35],
  [236, 156, 1.3],
  [266, 134, 1.2],
  [300, 148, 1.1],
  [328, 128, 1],
];

export const goatLeftScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    {
      id: 'ground',
      strokes: [
        line(
          [
            [8, 186, 2],
            [160, 183, 7],
            [330, 186, 2],
          ],
          { dry: 0.82, rough: 0.9 },
        ),
      ],
    },
    {
      id: 'sack',
      strokes: [
        {
          color: 'gold',
          flat: true,
          dry: 0.12,
          rough: 0.8,
          grain: 0.05,
          pace: 0.7,
          pts: [
            [22, 160, 42],
            [50, 158, 48],
            [76, 160, 44],
          ],
        },
        {
          rough: 0.7,
          pts: [
            [78, 142, 4],
            [84, 160, 13],
            [78, 178, 4],
          ],
        },
        {
          color: 'gold',
          dry: 0.14,
          rough: 0.9,
          grain: 0.03,
          pts: [
            [84, 176, 7],
            [100, 180, 12],
            [116, 184, 3],
          ],
        },
      ],
    },
    ...prints.map(
      ([x, y, k], i): InkPart => ({ id: `print-${i}`, pause: 0.04, strokes: hoofPrint(x, y, k) }),
    ),
    {
      id: 'tail',
      motions: [
        { kind: 'sway', amount: '14deg', seconds: 0.47, origin: [398, 92] },
        { kind: 'sway', amount: '5deg', seconds: 2.1, origin: [398, 92] },
      ],
      strokes: [
        line(
          [
            [404, 96, 10],
            [388, 80, 9],
            [380, 66, 2],
          ],
          { dry: 0.16, rough: 0.9 },
        ),
      ],
    },
    {
      id: 'rump',
      strokes: [
        roundBlob(428, 114, 34, 30),
        line(
          [
            [408, 130, 15],
            [400, 152, 8],
            [406, 178, 7],
          ],
          { dry: 0 },
        ),
        line(
          [
            [430, 134, 11],
            [428, 156, 7],
            [424, 178, 6],
          ],
          { dry: 0 },
        ),
      ],
    },
  ],
};

/* ---------- steam from a cup turns into a bird ---------- */

export const steamBirdScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    {
      id: 'cup',
      strokes: [
        line(
          [
            [126, 126, 4],
            [146, 124, 6],
            [150, 142, 5],
            [122, 156, 3.4],
          ],
          { dry: 0, rough: 0.5 },
        ),
        {
          color: 'gold',
          flat: true,
          dry: 0.1,
          rough: 0.7,
          grain: 0.05,
          pace: 0.7,
          pts: [
            [84, 114, 76],
            [84, 132, 72],
            [84, 152, 52],
            [84, 166, 30],
          ],
        },
        line(
          [
            [46, 114, 4],
            [84, 112, 6],
            [122, 114, 4],
          ],
          { dry: 0 },
        ),
        line(
          [
            [22, 170, 2.4],
            [84, 176, 6],
            [146, 170, 2.4],
          ],
          { dry: 0.06 },
        ),
        line(
          [
            [14, 184, 2],
            [90, 182, 6],
            [190, 185, 2],
          ],
          { dry: 0.8, rough: 0.9 },
        ),
      ],
    },
    {
      id: 'steam',
      motions: [{ kind: 'sway', amount: '1.2deg', seconds: 3.3, origin: [84, 106] }],
      strokes: [
        {
          dry: 0.3,
          rough: 1,
          grain: 0,
          pace: 0.46,
          pts: [
            [84, 104, 1],
            [100, 84, 2.4],
            [78, 62, 3.4],
            [112, 38, 4],
            [170, 62, 4.4],
            [228, 92, 4.8],
            [290, 72, 4],
            [322, 56, 2.4],
          ],
        },
      ],
    },
    ...flying('steam-bird', 346, 52, 0.9, 1, 0.2),
  ],
};

/* ---------- wheat grows through a crack in the pavement ---------- */

export const crackScene: InkScene = {
  width: WIDTH,
  height: HEIGHT,
  parts: [
    ...[
      ...wheat('side-ear', [214, 170], [186, 124], [150, 84], 2203, 0.7),
      ...wheat('crack-ear', [214, 172], [230, 96], [266, 22], 41, 1.08, 'gold'),
    ].map((part) => ({
      ...part,
      /* an unbroken stem, so the wheat clearly grows out of the crack */
      strokes: part.id.endsWith('-stem')
        ? part.strokes.map((stroke) => ({ ...stroke, dry: 0.08 }))
        : part.strokes,
    })),
    {
      id: 'pavement',
      strokes: [
        {
          flat: true,
          dry: 0.04,
          rough: 0.2,
          grain: 0.1,
          pace: 0.5,
          pts: [
            [0, 174, 46],
            [120, 174, 46],
            [300, 174, 46],
            [420, 174, 46],
          ],
        },
        /* the crack */
        {
          color: 'clear',
          grain: 0,
          rough: 1,
          pts: [
            [214, 148, 7],
            [204, 162, 3.6],
            [224, 174, 3],
            [208, 186, 2.4],
            [216, 198, 1.6],
          ],
        },
        {
          color: 'clear',
          grain: 0,
          rough: 1,
          pts: [
            [224, 174, 2],
            [250, 180, 1.4],
            [270, 176, 0.8],
          ],
        },
        {
          color: 'clear',
          grain: 0,
          rough: 1,
          pts: [
            [204, 162, 1.8],
            [178, 170, 1.2],
            [160, 166, 0.7],
          ],
        },
      ],
    },
    /* paint that ran along the wall of the kerb */
    {
      id: 'chips',
      strokes: [blob(196, 145, 2, 1.6), blob(234, 144, 2.4, 1.8), blob(246, 146, 1.2, 1)],
    },
    sparrowPart('watcher', 330, 151, 0.66, -1, 2.1),
  ],
};
