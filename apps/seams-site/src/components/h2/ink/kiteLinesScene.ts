import type { InkColor, InkPoint, InkStroke } from './brush';
import { goatScene, wireScene, type InkMotion, type InkPart, type InkScene } from './scenes';

/* The integrations drawing: the kid from the hero holds one kite line to each
   tool. Every kite has its own angle from the mouth, so no two lines cross. The
   kites are painted as the goat and the croissant are: a few fat strokes with
   torn edges, shapes cut out of them, and thin dry lines to tie them on. */

type Pt = readonly [number, number];
/* in parts of the radius: x, y, brush width */
type Mark = readonly [number, number, number];

type KiteShape =
  | 'diamond'
  | 'wing'
  | 'almond'
  | 'edo'
  | 'flower'
  | 'delta'
  | 'hex'
  | 'butterfly'
  | 'round';
type KiteTail = 'ties' | 'long' | 'ribbons' | 'tassel' | 'none';

type KiteString = {
  readonly width: number;
  /* 0 is a loaded brush; a high value leaves a broken, faint line */
  readonly dry: number;
  /* how far the line hangs, as a part of its length */
  readonly slack: number;
  /* a loose line wanders this many scene units from its curve */
  readonly wander?: number;
};

type KiteLook = {
  readonly shape: KiteShape;
  readonly color: InkColor;
  /* the size of this kite against the others */
  readonly size: number;
  readonly tail: KiteTail;
  readonly line: KiteString;
  /* how far the spine leans toward the line, from 0 to 1 */
  readonly lean: number;
};

export type ToolKite = {
  /* a mark in ECOSYSTEM_LOGO_MARKS */
  readonly tool: string;
  readonly x: number;
  readonly y: number;
  readonly logoSize: number;
  readonly swaySeconds: number;
  readonly swayAmount: string;
};

export type KiteLayout = {
  readonly scene: InkScene;
  readonly hold: Pt;
  readonly kites: readonly ToolKite[];
};

const heroLine = goatScene.parts.find((part) => part.id === 'line')?.strokes[0]?.pts[0];
const MOUTH: Pt = heroLine ? [heroLine[0], heroLine[1]] : [249, 387];

function placed(parts: readonly InkPart[], k: number, dx: number, dy: number): InkPart[] {
  return parts.map((part) => ({
    ...part,
    id: `placed-${part.id}`,
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

function partsNamed(scene: InkScene, prefix: string): readonly InkPart[] {
  return scene.parts.filter((part) => part.id.startsWith(prefix));
}

const TURN = Math.PI * 2;

/* The brush for one kite, leaning with it. */
function kitePen(x: number, y: number, r: number, lean: number) {
  const cos = Math.cos(lean);
  const sin = Math.sin(lean);
  /* line widths grow with the kite, so a phone kite has the same hand */
  const hand = r / 50;
  const at = (px: number, py: number): Pt => [
    x + (px * cos - py * sin) * r,
    y + (px * sin + py * cos) * r,
  ];
  const marks = (list: readonly Mark[], unit: number): InkPoint[] =>
    list.map(([px, py, w]): InkPoint => [...at(px, py), w * unit]);

  /* a fat stroke of colour, with widths in parts of the radius */
  const mass = (list: readonly Mark[], color: InkColor = 'ink', flat = false): InkStroke => ({
    pts: marks(list, r),
    color,
    flat,
    dry: 0.22,
    rough: 0.85,
    grain: 0.04,
  });
  /* a round blob: it swells and narrows along its own height */
  const dab = (cx: number, cy: number, radius: number, color: InkColor = 'ink'): InkStroke => ({
    pts: marks(
      [
        [cx, cy - radius, radius * 0.8],
        [cx, cy - radius * 0.55, radius * 1.72],
        [cx, cy, radius * 2],
        [cx, cy + radius * 0.55, radius * 1.72],
        [cx, cy + radius, radius * 0.8],
      ],
      r,
    ),
    color,
    grain: color === 'clear' ? 0 : 0.02,
    rough: 0.35,
  });
  /* a brush cut out of the colour, as the layers of the croissant are */
  const cut = (list: readonly Mark[]): InkStroke => ({
    pts: marks(list, hand),
    color: 'clear',
    dry: 0.26,
    rough: 0.9,
    grain: 0,
  });
  /* a thin scratchy line, as the kite line is */
  const scratch = (list: readonly Mark[], dry = 0.3): InkStroke => ({
    pts: marks(list, hand),
    dry,
    rough: 1,
    pace: 2,
  });
  /* a knot of colour on a tail, wide at both ends */
  const tie = (cx: number, cy: number, slope: number, color: InkColor = 'gold'): InkStroke => ({
    pts: marks(
      [
        [cx - 0.18, cy - slope, 7],
        [cx, cy, 2],
        [cx + 0.18, cy + slope, 7],
      ],
      hand,
    ),
    color,
    rough: 0.8,
    dry: 0.2,
  });
  /* the clear place where the logo sits */
  const opening = (cx: number, cy: number, radius: number): InkStroke =>
    dab(cx, cy, radius, 'clear');
  return { mass, dab, cut, scratch, tie, opening, at };
}

type KitePen = ReturnType<typeof kitePen>;

type Drawn = {
  readonly strokes: readonly InkStroke[];
  /* where the tail hangs from */
  readonly bottom: Pt;
  /* where the line ties on */
  readonly knot: Pt;
  readonly logo: Pt;
  readonly logoSize: number;
};

/* a short cut from the logo opening out toward the edge */
function spoke(
  pen: KitePen,
  cx: number,
  cy: number,
  angle: number,
  from: number,
  to: number,
): InkStroke {
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const mid = (from + to) / 2;
  return pen.cut([
    [cx + ux * from, cy + uy * from, 1.4],
    [cx + ux * mid, cy + uy * mid, 3.4],
    [cx + ux * to, cy + uy * to, 1.2],
  ]);
}

function drawShape(shape: KiteShape, color: InkColor, pen: KitePen): Drawn {
  const { cut, dab, mass, opening, scratch, tie } = pen;
  const bridle = (a: Pt, b: Pt, knot: Pt): InkStroke[] => [
    scratch(
      [
        [a[0], a[1], 1],
        [knot[0], knot[1], 1.2],
      ],
      0.3,
    ),
    scratch(
      [
        [b[0], b[1], 1],
        [knot[0], knot[1], 1.2],
      ],
      0.3,
    ),
  ];
  switch (shape) {
    case 'diamond':
      return {
        strokes: [
          mass(
            [
              [0, -1.26, 0.08],
              [0, -0.84, 0.92],
              [0, -0.26, 1.92],
              [0, 0.3, 1.26],
              [0, 0.88, 0.56],
              [0, 1.42, 0.06],
            ],
            color,
          ),
          spoke(pen, 0, -0.2, Math.PI, 0.56, 1.32),
          spoke(pen, 0, -0.2, Math.PI / 2, 0.56, 0.9),
          spoke(pen, 0, -0.2, -Math.PI / 2, 0.56, 0.9),
          spoke(pen, 0, -0.2, 0, 0.56, 0.96),
          opening(0, -0.2, 0.56),
        ],
        bottom: [0, 1.4],
        knot: [0, 1.4],
        logo: [0, -0.2],
        logoSize: 0.74,
      };
    case 'wing': {
      const R = 1.14;
      const on = (angle: number, radius = R): Pt => [
        Math.sin(angle) * radius,
        0.72 - Math.cos(angle) * radius,
      ];
      const spine = Array.from({ length: 9 }, (_, i): Mark => {
        const angle = -1.56 + (i / 8) * 3.12;
        const [px, py] = on(angle);
        return [px, py, 0.1 + 1.18 * Math.pow(Math.cos((angle / 1.56) * (Math.PI / 2)), 0.72)];
      });
      const layer = (angle: number): InkStroke => {
        const [ax, ay] = on(angle - 0.08, R - 0.36);
        const [bx, by] = on(angle + 0.04, R);
        const [ex, ey] = on(angle + 0.14, R + 0.36);
        return cut([
          [ax, ay, 1.2],
          [bx, by, 3.2],
          [ex, ey, 1.2],
        ]);
      };
      const knot: Pt = [0, 1.26];
      return {
        strokes: [
          mass(spine, color),
          layer(-1.14),
          layer(-0.84),
          layer(0.84),
          layer(1.14),
          opening(0, -0.4, 0.54),
          ...bridle(on(-1.5), on(1.5), knot),
        ],
        bottom: knot,
        knot,
        logo: [0, -0.4],
        logoSize: 0.7,
      };
    }
    case 'almond': {
      const hem = (x: number): number => -0.1 + x * x * 0.26;
      const knot: Pt = [0, 1.12];
      return {
        strokes: [
          mass(
            [-1.24, -0.84, -0.42, 0, 0.42, 0.84, 1.24].map(
              (x): Mark => [x, hem(x), 0.12 + 1.66 * Math.pow(1 - (x / 1.24) ** 2, 0.62)],
            ),
            color,
          ),
          cut([
            [-0.76, -0.4, 1.3],
            [-0.8, 0.02, 3.2],
            [-0.84, 0.42, 1.2],
          ]),
          cut([
            [0.76, -0.4, 1.3],
            [0.8, 0.02, 3.2],
            [0.84, 0.42, 1.2],
          ]),
          opening(0, -0.1, 0.56),
          ...bridle([-1.2, hem(1.2)], [1.2, hem(1.2)], knot),
        ],
        bottom: knot,
        knot,
        logo: [0, -0.1],
        logoSize: 0.74,
      };
    }
    case 'edo': {
      const knot: Pt = [0, 1.46];
      return {
        strokes: [
          mass(
            [
              [0, -1, 1.74],
              [0.02, 0, 1.8],
              [-0.02, 1, 1.72],
            ],
            color,
            true,
          ),
          cut([
            [-0.78, -0.74, 1.2],
            [0, -0.76, 3.2],
            [0.78, -0.72, 1.2],
          ]),
          cut([
            [-0.74, -0.66, 1.2],
            [-0.72, 0, 3],
            [-0.7, 0.72, 1.2],
          ]),
          cut([
            [-0.76, 0.74, 1.2],
            [0, 0.76, 3.2],
            [0.78, 0.72, 1.2],
          ]),
          cut([
            [0.72, -0.66, 1.2],
            [0.7, 0, 3],
            [0.72, 0.68, 1.2],
          ]),
          opening(0, 0, 0.56),
          ...bridle([-0.62, 1], [0.62, 1], knot),
          tie(0, 1.46, 0.04),
        ],
        bottom: knot,
        knot,
        logo: [0, 0],
        logoSize: 0.76,
      };
    }
    case 'flower': {
      const petals = Array.from({ length: 8 }, (_, i): Pt => {
        const angle = (i / 8) * TURN + 0.2;
        return [Math.sin(angle) * 0.88, -Math.cos(angle) * 0.88];
      });
      return {
        strokes: [
          ...petals.map(([px, py]) => dab(px, py, 0.4, color)),
          dab(0, 0, 0.84, color),
          opening(0, 0, 0.6),
        ],
        bottom: [0, 1.24],
        knot: [0, 1.24],
        logo: [0, 0],
        logoSize: 0.8,
      };
    }
    case 'delta': {
      const knot: Pt = [0, 1.24];
      const scale = (cx: number, cy: number): InkStroke =>
        cut([
          [cx - 0.2, cy + 0.03, 1.1],
          [cx, cy - 0.14, 2.8],
          [cx + 0.2, cy + 0.03, 1.1],
        ]);
      return {
        strokes: [
          mass(
            [
              [0, -1.16, 0.06],
              [0, -0.55, 0.72],
              [0, 0.1, 1.46],
              [0, 0.84, 2.3],
            ],
            color,
            true,
          ),
          ...[-0.84, -0.42, 0, 0.42, 0.84].map((cx) => scale(cx, 0.76)),
          opening(0, 0.02, 0.48),
          ...bridle([-0.74, 0.84], [0.74, 0.84], knot),
        ],
        bottom: knot,
        knot,
        logo: [0, 0.02],
        logoSize: 0.62,
      };
    }
    case 'hex':
      return {
        strokes: [
          mass(
            [
              [0, -1.12, 0.3],
              [0, -0.62, 1.72],
              [0, 0, 1.94],
              [0, 0.62, 1.72],
              [0, 1.12, 0.3],
            ],
            color,
          ),
          ...[0, 1, 2, 3, 4, 5].map((i) => spoke(pen, 0, 0, (i / 6) * TURN, 0.56, 1)),
          opening(0, 0, 0.56),
        ],
        bottom: [0, 1.1],
        knot: [0, 1.1],
        logo: [0, 0],
        logoSize: 0.74,
      };
    case 'butterfly': {
      const wing = (side: 1 | -1): InkStroke[] => [
        mass(
          [
            [side * 0.08, -0.2, 0.32],
            [side * 0.74, -0.58, 1.02],
            [side * 1.28, -0.62, 0.32],
          ],
          color,
        ),
        mass(
          [
            [side * 0.08, 0.24, 0.28],
            [side * 0.58, 0.64, 0.76],
            [side * 0.9, 0.88, 0.24],
          ],
          color,
        ),
        dab(side * 0.92, -0.58, 0.13, 'gold'),
        dab(side * 0.6, 0.66, 0.09, 'gold'),
      ];
      return {
        strokes: [
          ...wing(-1),
          ...wing(1),
          mass(
            [
              [0, -0.9, 0.08],
              [0, -0.2, 1.02],
              [0, 0.24, 0.96],
              [0, 1.18, 0.06],
            ],
            color,
          ),
          scratch([
            [-0.06, -0.86, 1.3],
            [-0.28, -1.18, 1],
            [-0.54, -1.22, 0.7],
          ]),
          scratch([
            [0.06, -0.86, 1.3],
            [0.28, -1.18, 1],
            [0.54, -1.22, 0.7],
          ]),
          opening(0, 0, 0.46),
        ],
        bottom: [0, 1.16],
        knot: [0, 1.16],
        logo: [0, 0],
        logoSize: 0.62,
      };
    }
    case 'round':
      return {
        strokes: [
          dab(0, 0, 1, color),
          ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
            spoke(pen, 0, 0, ((i + 0.5) / 8) * TURN, 0.62, 0.94),
          ),
          opening(0, 0, 0.58),
        ],
        bottom: [0, 1],
        knot: [0, 1],
        logo: [0, 0],
        logoSize: 0.8,
      };
  }
}

function drawTail(tail: KiteTail, from: Pt, pen: KitePen, index: number): InkStroke[] {
  const { mass, scratch, tie } = pen;
  const [bx, by] = from;
  const accent: InkColor = index % 3 === 2 ? 'ink' : 'gold';
  switch (tail) {
    case 'ties':
      return [
        scratch(
          [
            [bx, by, 2],
            [bx - 0.22, by + 0.42, 1.4],
            [bx + 0.18, by + 0.84, 1.8],
            [bx - 0.06, by + 1.28, 0.8],
          ],
          0.44,
        ),
        tie(bx - 0.2, by + 0.42, 0.05, accent),
        tie(bx + 0.16, by + 0.84, -0.05),
      ];
    case 'long':
      return [
        scratch(
          [
            [bx, by, 2],
            [bx + 0.24, by + 0.4, 1.4],
            [bx - 0.18, by + 0.82, 1.8],
            [bx + 0.2, by + 1.24, 1.4],
            [bx - 0.1, by + 1.72, 0.7],
          ],
          0.4,
        ),
        tie(bx + 0.22, by + 0.4, -0.05),
        tie(bx - 0.17, by + 0.82, 0.05, accent),
        tie(bx + 0.18, by + 1.24, -0.05),
      ];
    case 'ribbons':
      return [
        mass(
          [
            [bx - 0.08, by, 0.12],
            [bx - 0.26, by + 0.42, 0.14],
            [bx - 0.12, by + 0.92, 0.02],
          ],
          accent,
        ),
        mass(
          [
            [bx + 0.08, by, 0.12],
            [bx + 0.3, by + 0.36, 0.12],
            [bx + 0.24, by + 0.76, 0.02],
          ],
          accent,
        ),
      ];
    case 'tassel':
      return [-0.2, 0, 0.2].map((spread) =>
        scratch(
          [
            [bx + spread * 0.2, by, 1.3],
            [bx + spread, by + 0.66, 0.5],
          ],
          0.62,
        ),
      );
    case 'none':
      return [];
  }
}

function kiteParts(
  hold: Pt,
  tool: string,
  x: number,
  y: number,
  r: number,
  look: KiteLook,
  index: number,
  sway: readonly InkMotion[],
): { parts: InkPart[]; logo: Pt; logoSize: number } {
  const lean = Math.atan2(x - hold[0], hold[1] - y) * look.lean;
  const pen = kitePen(x, y, r, lean);
  const drawn = drawShape(look.shape, look.color, pen);
  const knot = pen.at(...drawn.knot);

  const length = Math.hypot(hold[0] - knot[0], hold[1] - knot[1]);
  const slack: Pt = [
    (hold[0] + knot[0]) / 2 + (hold[0] - knot[0]) * 0.06,
    (hold[1] + knot[1]) / 2 + length * look.line.slack,
  ];
  const onLine = (t: number): InkPoint => {
    const u = 1 - t;
    const wander =
      Math.sin(t * Math.PI * 5 + index) * Math.sin(t * Math.PI) * (look.line.wander ?? 0);
    const lineWidth = look.line.width * (1 + 0.22 * Math.sin(t * Math.PI * 2 + index));
    return [
      u * u * knot[0] + 2 * u * t * slack[0] + t * t * hold[0],
      u * u * knot[1] + 2 * u * t * slack[1] + t * t * hold[1] + wander,
      lineWidth,
    ];
  };
  const linePoints = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.85, 1].map(onLine);

  return {
    parts: [
      {
        id: `${tool}-line`,
        motions: sway,
        strokes: [{ pts: linePoints, dry: look.line.dry, rough: 1, pace: 1.8 }],
      },
      {
        id: `${tool}-kite`,
        motions: sway,
        strokes: [...drawn.strokes, ...drawTail(look.tail, drawn.bottom, pen, index)],
      },
    ],
    logo: pen.at(...drawn.logo),
    logoSize: r * drawn.logoSize,
  };
}

type Place = readonly [tool: string, x: number, y: number, look: KiteLook];

function layout(
  width: number,
  height: number,
  hold: Pt,
  kidScale: number,
  radius: number,
  places: readonly Place[],
  scenery: readonly InkPart[],
): KiteLayout {
  const kid = placed(
    partsNamed(goatScene, 'kid-'),
    kidScale,
    hold[0] - MOUTH[0] * kidScale,
    hold[1] - MOUTH[1] * kidScale,
  );
  const built = places.map(([tool, x, y, look], index) => {
    const swaySeconds = 3.1 + (index % 5) * 0.55;
    const swayAmount = `${(0.4 + (index % 3) * 0.22).toFixed(2)}deg`;
    const sway: readonly InkMotion[] = [
      { kind: 'sway', amount: swayAmount, seconds: swaySeconds, origin: hold },
    ];
    const { parts, logo, logoSize } = kiteParts(
      hold,
      tool,
      x,
      y,
      radius * look.size,
      look,
      index,
      sway,
    );
    const kite: ToolKite = { tool, x: logo[0], y: logo[1], logoSize, swaySeconds, swayAmount };
    return { parts, kite };
  });
  return {
    hold,
    kites: built.map((entry) => entry.kite),
    scene: { width, height, parts: [...scenery, ...kid, ...built.flatMap((entry) => entry.parts)] },
  };
}

const bird = partsNamed(wireScene, 'arriving');

export const wideKites: KiteLayout = layout(
  1400,
  600,
  [300, 432],
  1.5,
  54,
  [
    [
      'airtable',
      150,
      176,
      {
        shape: 'diamond',
        color: 'ink',
        size: 1,
        tail: 'ties',
        lean: 0.3,
        line: { width: 1.8, dry: 0.18, slack: 0.03 },
      },
    ],
    [
      'googledrive',
      360,
      170,
      {
        shape: 'almond',
        color: 'ink',
        size: 0.92,
        tail: 'tassel',
        lean: 0.12,
        line: { width: 1.2, dry: 0.42, slack: 0.05 },
      },
    ],
    [
      'gmail',
      542,
      92,
      {
        shape: 'wing',
        color: 'gold',
        size: 1.04,
        tail: 'ties',
        lean: 0.2,
        line: { width: 2.2, dry: 0.12, slack: 0.012 },
      },
    ],
    [
      'notion',
      750,
      76,
      {
        shape: 'hex',
        color: 'ink',
        size: 0.94,
        tail: 'ribbons',
        lean: 0.24,
        line: { width: 1.5, dry: 0.3, slack: 0.035, wander: 3 },
      },
    ],
    [
      'slack',
      940,
      84,
      {
        shape: 'flower',
        color: 'gold',
        size: 0.92,
        tail: 'long',
        lean: 0.1,
        line: { width: 1.7, dry: 0.2, slack: 0.03 },
      },
    ],
    [
      'dropbox',
      866,
      240,
      {
        shape: 'butterfly',
        color: 'ink',
        size: 0.84,
        tail: 'none',
        lean: 0.3,
        line: { width: 1.2, dry: 0.34, slack: 0.022 },
      },
    ],
    [
      'shopify',
      1132,
      196,
      {
        shape: 'edo',
        color: 'ink',
        size: 0.94,
        tail: 'tassel',
        lean: 0.22,
        line: { width: 2, dry: 0.3, slack: 0.03, wander: 2 },
      },
    ],
    [
      'stripe',
      1318,
      250,
      {
        shape: 'delta',
        color: 'ink',
        size: 0.94,
        tail: 'none',
        lean: 0.3,
        line: { width: 1.5, dry: 0.18, slack: 0.024, wander: 2.5 },
      },
    ],
    [
      'onepassword',
      1012,
      420,
      {
        shape: 'round',
        color: 'ink',
        size: 0.8,
        tail: 'ribbons',
        lean: 0.2,
        line: { width: 1.2, dry: 0.44, slack: 0.03 },
      },
    ],
    [
      'square',
      1262,
      462,
      {
        shape: 'diamond',
        color: 'gold',
        size: 0.84,
        tail: 'none',
        lean: 0.36,
        line: { width: 2.3, dry: 0.08, slack: 0.03 },
      },
    ],
  ],
  [
    ...placed(partsNamed(goatScene, 'behind-'), 1, -40, 56),
    ...placed(partsNamed(goatScene, 'under-a'), 1, 180, 56),
    ...placed(partsNamed(goatScene, 'under-b'), 1, 620, 56),
    ...placed(bird, 1, 1030, 366),
  ],
);

export const narrowKites: KiteLayout = layout(
  620,
  680,
  [120, 548],
  1.08,
  62,
  [
    [
      'gmail',
      120,
      190,
      {
        shape: 'wing',
        color: 'gold',
        size: 0.94,
        tail: 'none',
        lean: 0.1,
        line: { width: 2.2, dry: 0.12, slack: 0.012 },
      },
    ],
    [
      'slack',
      262,
      104,
      {
        shape: 'flower',
        color: 'gold',
        size: 0.8,
        tail: 'ties',
        lean: 0.12,
        line: { width: 1.7, dry: 0.2, slack: 0.03 },
      },
    ],
    [
      'shopify',
      412,
      84,
      {
        shape: 'edo',
        color: 'ink',
        size: 0.84,
        tail: 'tassel',
        lean: 0.2,
        line: { width: 1.9, dry: 0.3, slack: 0.03, wander: 2.5 },
      },
    ],
    [
      'stripe',
      548,
      116,
      {
        shape: 'diamond',
        color: 'ink',
        size: 0.94,
        tail: 'ties',
        lean: 0.28,
        line: { width: 1.3, dry: 0.4, slack: 0.04 },
      },
    ],
    [
      'square',
      510,
      336,
      {
        shape: 'hex',
        color: 'ink',
        size: 0.88,
        tail: 'none',
        lean: 0.26,
        line: { width: 2.3, dry: 0.08, slack: 0.025 },
      },
    ],
    [
      'notion',
      546,
      496,
      {
        shape: 'butterfly',
        color: 'ink',
        size: 0.82,
        tail: 'none',
        lean: 0.26,
        line: { width: 1.5, dry: 0.25, slack: 0.02, wander: 2 },
      },
    ],
  ],
  [],
);
