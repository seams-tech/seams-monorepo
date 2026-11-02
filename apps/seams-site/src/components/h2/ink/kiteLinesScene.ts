import type { InkColor, InkPoint, InkStroke } from './brush';
import { goatScene, wireScene, type InkMotion, type InkPart, type InkScene } from './scenes';

/* The integrations drawing: the kid from the hero holds one kite line to each
   tool. Every kite has its own angle from the mouth, so no two lines cross, and
   its own shape, tail and string, as kites made by different hands. */

type Pt = readonly [number, number];

type KiteShape = 'diamond' | 'edo' | 'delta' | 'hex' | 'round';
type KiteTail = 'bows' | 'long' | 'streamers' | 'tassel' | 'none';

type KiteString = {
  readonly width: number;
  /* 0 is a loaded brush; a high value leaves a broken, faint line */
  readonly dry: number;
  /* how far the line hangs, as a part of its length */
  readonly slack: number;
  /* a loose line wanders this many scene units from its curve */
  readonly wander?: number;
  readonly color?: InkColor;
};

type KiteLook = {
  readonly shape: KiteShape;
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

/* the outline around the logo, in parts of the radius, y pointing down */
function outline(shape: KiteShape): readonly Pt[] {
  switch (shape) {
    case 'diamond':
      return [
        [0, -1.12],
        [0.92, -0.1],
        [0, 1.32],
        [-0.92, -0.1],
      ];
    case 'edo':
      return [
        [-0.86, -0.98],
        [0.86, -0.98],
        [0.86, 0.98],
        [-0.86, 0.98],
      ];
    case 'delta':
      return [
        [0, -1.1],
        [1.12, 0.86],
        [-1.12, 0.86],
      ];
    case 'hex':
      return [
        [0, -1.08],
        [0.94, -0.54],
        [0.94, 0.54],
        [0, 1.08],
        [-0.94, 0.54],
        [-0.94, -0.54],
      ];
    case 'round':
      return Array.from({ length: 16 }, (_, index): Pt => {
        const angle = (index / 16) * Math.PI * 2;
        return [Math.sin(angle) * 1.02, -Math.cos(angle) * 1.02];
      });
  }
}

/* the left and right edge of a convex outline at one height */
function spanAt(points: readonly Pt[], y: number): readonly [number, number] {
  let left = Infinity;
  let right = -Infinity;
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length] as Pt;
    if ((a[1] - y) * (b[1] - y) > 0) return;
    const t = a[1] === b[1] ? 0 : (y - a[1]) / (b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t;
    left = Math.min(left, x);
    right = Math.max(right, x);
  });
  return [left, right];
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
): InkPart[] {
  const lean = Math.atan2(x - hold[0], hold[1] - y) * look.lean;
  const cos = Math.cos(lean);
  const sin = Math.sin(lean);
  const at = (px: number, py: number): Pt => [
    x + (px * cos - py * sin) * r,
    y + (px * sin + py * cos) * r,
  ];

  const shape = outline(look.shape);
  const bottomY = Math.max(...shape.map((point) => point[1]));
  const topY = Math.min(...shape.map((point) => point[1]));
  /* square and flat kites hang from a bridle, so the knot sits below the paper */
  const bridled = look.shape === 'edo' || look.shape === 'delta';
  const knot = at(0, bottomY + (bridled ? 0.42 : 0));

  const length = Math.hypot(hold[0] - knot[0], hold[1] - knot[1]);
  const slack: Pt = [
    (hold[0] + knot[0]) / 2 + (hold[0] - knot[0]) * 0.06,
    (hold[1] + knot[1]) / 2 + length * look.line.slack,
  ];
  const onLine = (t: number): InkPoint => {
    const u = 1 - t;
    const wander =
      Math.sin(t * Math.PI * 5 + index) * Math.sin(t * Math.PI) * (look.line.wander ?? 0);
    const lineWidth = look.line.width * (1 + 0.25 * Math.sin(t * Math.PI * 2 + index));
    return [
      u * u * knot[0] + 2 * u * t * slack[0] + t * t * hold[0],
      u * u * knot[1] + 2 * u * t * slack[1] + t * t * hold[1] + wander,
      lineWidth,
    ];
  };

  const edge = (from: Pt, to: Pt, width: number): InkStroke => ({
    pts: [
      [from[0], from[1], width * 0.85],
      [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, width * 1.1],
      [to[0], to[1], width * 0.75],
    ],
    dry: 0.15,
    rough: 1,
    pace: 2,
  });
  const edgeWidth = 1.7 + (index % 3) * 0.45;
  const corners = shape.map(([px, py]) => at(px, py));

  /* paper across the middle hides any line behind the kite */
  const rows = 7;
  const paper: InkPoint[] = Array.from({ length: rows }, (_, row) => {
    const local = topY + 0.03 + ((bottomY - topY - 0.06) * row) / (rows - 1);
    const [left, right] = spanAt(shape, local);
    return [...at((left + right) / 2, local), Math.max(1, (right - left) * r)];
  });

  const strokes: InkStroke[] = [
    { pts: paper, color: 'paper', rough: 0.2, grain: 0 },
    ...corners.map((corner, point) =>
      edge(corner, corners[(point + 1) % corners.length] as Pt, edgeWidth),
    ),
  ];
  if (bridled) {
    for (const end of [at(-0.62, bottomY), at(0.62, bottomY)]) {
      strokes.push({
        pts: [
          [end[0], end[1], 0.9],
          [knot[0], knot[1], 0.9],
        ],
        dry: 0.25,
        rough: 0.9,
        pace: 2.2,
      });
    }
  }

  const ribbon = (px: number, py: number, slope: number, size: number): InkStroke => {
    const [cx, cy] = at(px, bottomY + py);
    return {
      pts: [
        [cx - size, cy - slope, 3.2],
        [cx + size, cy + slope, 3.2],
      ],
      color: 'gold',
      rough: 0.8,
    };
  };
  const tailLine = (points: readonly Pt[], width: number, dry = 0.3): InkStroke => ({
    pts: points.map(([px, py]): InkPoint => [...at(px, bottomY + py), width]),
    dry,
    rough: 1,
    pace: 2.4,
  });
  switch (look.tail) {
    case 'bows':
      strokes.push(
        tailLine(
          [
            [0, 0],
            [-0.24, 0.36],
            [0.2, 0.68],
            [-0.12, 1.04],
          ],
          1,
        ),
        ribbon(-0.24, 0.36, 3, 7),
        ribbon(0.2, 0.68, -3, 7),
      );
      break;
    case 'long':
      strokes.push(
        tailLine(
          [
            [0, 0],
            [0.22, 0.34],
            [-0.18, 0.72],
            [0.2, 1.1],
            [-0.14, 1.48],
            [0.08, 1.8],
          ],
          0.9,
          0.2,
        ),
        ribbon(0.22, 0.34, 2, 5),
        ribbon(-0.18, 0.72, -2, 5),
        ribbon(0.2, 1.1, 2, 5),
        ribbon(-0.14, 1.48, -2, 4),
      );
      break;
    case 'streamers':
      strokes.push(
        tailLine(
          [
            [-0.3, 0],
            [-0.46, 0.5],
            [-0.28, 0.96],
          ],
          2,
          0.45,
        ),
        tailLine(
          [
            [0.3, 0],
            [0.42, 0.46],
            [0.3, 0.84],
          ],
          2,
          0.45,
        ),
      );
      break;
    case 'tassel':
      for (const spread of [-0.22, 0, 0.22]) {
        strokes.push(
          tailLine(
            [
              [spread * 0.3, 0],
              [spread, 0.62],
            ],
            1.5,
            0.6,
          ),
        );
      }
      strokes.push(ribbon(0, 0.04, 0, 6));
      break;
    case 'none':
      break;
  }

  return [
    {
      id: `${tool}-line`,
      motions: sway,
      strokes: [
        {
          pts: [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.85, 1].map(onLine),
          color: look.line.color,
          dry: look.line.dry,
          rough: 0.9,
          pace: 2.2,
        },
      ],
    },
    { id: `${tool}-kite`, motions: sway, strokes },
  ];
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
    const swayAmount = `${0.4 + (index % 3) * 0.22}deg`;
    const sway: readonly InkMotion[] = [
      { kind: 'sway', amount: swayAmount, seconds: swaySeconds, origin: hold },
    ];
    const r = radius * look.size;
    const parts = kiteParts(hold, tool, x, y, r, look, index, sway);
    const kite: ToolKite = {
      tool,
      x,
      y: y + (look.shape === 'delta' ? r * 0.26 : 0),
      logoSize: r * (look.shape === 'delta' ? 0.82 : 1),
      swaySeconds,
      swayAmount,
    };
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
  50,
  [
    [
      'airtable',
      150,
      196,
      {
        shape: 'diamond',
        size: 1,
        tail: 'bows',
        lean: 0.42,
        line: { width: 1.1, dry: 0.2, slack: 0.03 },
      },
    ],
    [
      'googledrive',
      360,
      190,
      {
        shape: 'edo',
        size: 0.86,
        tail: 'streamers',
        lean: 0.18,
        line: { width: 0.8, dry: 0.5, slack: 0.05 },
      },
    ],
    [
      'gmail',
      542,
      96,
      {
        shape: 'delta',
        size: 1.08,
        tail: 'long',
        lean: 0.5,
        line: { width: 1.7, dry: 0.08, slack: 0.012 },
      },
    ],
    [
      'notion',
      750,
      76,
      {
        shape: 'hex',
        size: 0.92,
        tail: 'tassel',
        lean: 0.3,
        line: { width: 1, dry: 0.3, slack: 0.035, wander: 3.5 },
      },
    ],
    [
      'slack',
      915,
      76,
      {
        shape: 'round',
        size: 1.04,
        tail: 'long',
        lean: 0.2,
        line: { width: 1.3, dry: 0.12, slack: 0.03, color: 'gold' },
      },
    ],
    [
      'dropbox',
      884,
      226,
      {
        shape: 'diamond',
        size: 0.8,
        tail: 'none',
        lean: 0.62,
        line: { width: 0.8, dry: 0.3, slack: 0.022 },
      },
    ],
    [
      'shopify',
      1125,
      205,
      {
        shape: 'edo',
        size: 1,
        tail: 'tassel',
        lean: 0.34,
        line: { width: 1.5, dry: 0.35, slack: 0.03, wander: 2.5 },
      },
    ],
    [
      'stripe',
      1340,
      262,
      {
        shape: 'delta',
        size: 0.94,
        tail: 'streamers',
        lean: 0.46,
        line: { width: 1, dry: 0.15, slack: 0.024 },
      },
    ],
    [
      'onepassword',
      1012,
      432,
      {
        shape: 'round',
        size: 0.84,
        tail: 'bows',
        lean: 0.3,
        line: { width: 0.9, dry: 0.55, slack: 0.03 },
      },
    ],
    [
      'square',
      1262,
      474,
      {
        shape: 'hex',
        size: 1.1,
        tail: 'none',
        lean: 0.4,
        line: { width: 1.8, dry: 0.06, slack: 0.03 },
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
      130,
      196,
      {
        shape: 'delta',
        size: 1,
        tail: 'long',
        lean: 0.2,
        line: { width: 1.6, dry: 0.08, slack: 0.012 },
      },
    ],
    [
      'slack',
      254,
      111,
      {
        shape: 'round',
        size: 0.94,
        tail: 'bows',
        lean: 0.3,
        line: { width: 1.2, dry: 0.12, slack: 0.03, color: 'gold' },
      },
    ],
    [
      'shopify',
      401,
      84,
      {
        shape: 'edo',
        size: 0.9,
        tail: 'tassel',
        lean: 0.34,
        line: { width: 1.1, dry: 0.35, slack: 0.03, wander: 3 },
      },
    ],
    [
      'stripe',
      552,
      98,
      {
        shape: 'diamond',
        size: 1,
        tail: 'streamers',
        lean: 0.5,
        line: { width: 0.9, dry: 0.45, slack: 0.04 },
      },
    ],
    [
      'square',
      522,
      319,
      {
        shape: 'hex',
        size: 0.9,
        tail: 'none',
        lean: 0.4,
        line: { width: 1.7, dry: 0.06, slack: 0.025 },
      },
    ],
    [
      'notion',
      552,
      480,
      {
        shape: 'diamond',
        size: 0.86,
        tail: 'bows',
        lean: 0.5,
        line: { width: 1, dry: 0.25, slack: 0.02, wander: 2 },
      },
    ],
  ],
  [],
);
