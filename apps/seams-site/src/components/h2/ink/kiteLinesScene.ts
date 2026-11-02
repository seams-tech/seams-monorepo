import type { InkColor, InkPoint, InkStroke } from './brush';
import { goatScene, wireScene, type InkMotion, type InkPart, type InkScene } from './scenes';

/* The integrations drawing: the kid from the hero holds one kite line to each
   tool. Every kite has its own angle from the mouth, so no two lines cross, and
   each is its own toy: painted panels, dots, scallops, a flower, a butterfly,
   with bows on its tail and a string of its own. */

type Pt = readonly [number, number];

type KiteShape =
  | 'diamond'
  | 'wing'
  | 'bonnet'
  | 'edo'
  | 'flower'
  | 'scallop'
  | 'hex'
  | 'butterfly'
  | 'round';
type KiteTail = 'bows' | 'loop' | 'ribbons' | 'tassel' | 'none';

type KiteString = {
  readonly width: number;
  /* 0 is a loaded brush; a high value leaves a broken, faint line */
  readonly dry: number;
  /* how far the line hangs, as a part of its length */
  readonly slack: number;
  /* a loose line wanders this many scene units from its curve */
  readonly wander?: number;
  /* the line turns once around itself here, from 0 at the kite to 1 at the goat */
  readonly curlAt?: number;
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

/* the left and right edge of an outline at one height */
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

function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  n = 10,
): Pt[] {
  return Array.from({ length: n + 1 }, (_, i): Pt => {
    const angle = from + ((to - from) * i) / n;
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry];
  });
}

const TURN = Math.PI * 2;

/* The brush for one kite: everything in parts of the radius, y pointing down,
   leaning with the kite. */
function kitePen(x: number, y: number, r: number, lean: number) {
  const cos = Math.cos(lean);
  const sin = Math.sin(lean);
  const at = (px: number, py: number): Pt => [
    x + (px * cos - py * sin) * r,
    y + (px * sin + py * cos) * r,
  ];
  const line = (points: readonly Pt[], width = 1.1, dry = 0.2, color?: InkColor): InkStroke => ({
    pts: points.map(([px, py]): InkPoint => [...at(px, py), width]),
    color,
    dry,
    rough: 1,
    pace: 2.2,
  });
  /* straight sides for a polygon with corners; one round stroke for a curve */
  const closed = (points: readonly Pt[], width = 2): InkStroke[] => {
    if (points.length <= 6) {
      return points.map((from, index): InkStroke => {
        const to = points[(index + 1) % points.length] as Pt;
        const [ax, ay] = at(from[0], from[1]);
        const [bx, by] = at(to[0], to[1]);
        return {
          pts: [
            [ax, ay, width * 0.85],
            [(ax + bx) / 2, (ay + by) / 2, width * 1.1],
            [bx, by, width * 0.75],
          ],
          dry: 0.12,
          rough: 1,
          pace: 2,
        };
      });
    }
    return [
      {
        pts: [...points, points[0] as Pt].map(([px, py], i, all): InkPoint => {
          const swell = 1 + 0.2 * Math.sin((i / all.length) * TURN * 2);
          return [...at(px, py), width * swell];
        }),
        dry: 0.12,
        rough: 1,
        pace: 2,
      },
    ];
  };
  /* paper across an outline hides any line behind the kite */
  const paper = (points: readonly Pt[]): InkStroke[] => {
    const ys = points.map((point) => point[1]);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const rows = 7;
    const step = (bottom - top) / rows;
    return Array.from({ length: rows }, (_, row): InkStroke => {
      const local = top + step * (row + 0.5);
      const [left, right] = spanAt(points, local);
      const [ax, ay] = at(left, local);
      const [bx, by] = at(right, local);
      return {
        pts: [
          [ax, ay, step * r * 1.25],
          [bx, by, step * r * 1.25],
        ],
        color: 'paper',
        flat: true,
        rough: 0.05,
        grain: 0,
        pace: 4,
      };
    });
  };
  const disc = (cx: number, cy: number, radius: number): InkStroke[] =>
    paper(arc(cx, cy, radius, radius, 0, TURN, 16).slice(0, 16));
  const ring = (cx: number, cy: number, radius: number, width = 1): InkStroke =>
    line(arc(cx, cy, radius, radius, 0, TURN, 10), width, 0.08);
  const dot = (cx: number, cy: number, radius: number, color: InkColor = 'ink'): InkStroke => {
    const [ax, ay] = at(cx, cy - radius * 0.4);
    const [bx, by] = at(cx, cy + radius * 0.4);
    return {
      pts: [
        [ax, ay, radius * r * 1.6],
        [bx, by, radius * r * 2],
      ],
      color,
      rough: 0.5,
      grain: 0.02,
    };
  };
  /* a bow of two loops and a knot */
  const bow = (cx: number, cy: number, size: number, color: InkColor = 'ink'): InkStroke[] => [
    line(
      [
        [cx, cy],
        [cx - size * 0.7, cy - size * 0.55],
        [cx - size * 1.1, cy - size * 0.1],
        [cx - size * 0.7, cy + size * 0.42],
        [cx, cy],
      ],
      1.1,
      0.08,
      color,
    ),
    line(
      [
        [cx, cy],
        [cx + size * 0.7, cy + size * 0.42],
        [cx + size * 1.1, cy - size * 0.1],
        [cx + size * 0.7, cy - size * 0.55],
        [cx, cy],
      ],
      1.1,
      0.08,
      color,
    ),
    dot(cx, cy, size * 0.14, color),
  ];
  return { at, line, closed, paper, disc, ring, dot, bow };
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

function drawShape(shape: KiteShape, pen: KitePen): Drawn {
  const { closed, disc, dot, line, paper, ring, bow } = pen;
  switch (shape) {
    case 'diamond': {
      const outline: Pt[] = [
        [0, -1.24],
        [0.94, -0.22],
        [0, 1.36],
        [-0.94, -0.22],
      ];
      return {
        strokes: [
          ...paper(outline),
          line(
            [
              [0, -1.24],
              [0, 1.36],
            ],
            1,
          ),
          line(
            [
              [-0.94, -0.22],
              [0.94, -0.22],
            ],
            1,
          ),
          line(
            [
              [-0.46, 0.3],
              [0, 0.72],
              [0.46, 0.3],
            ],
            0.9,
          ),
          dot(-0.3, -0.5, 0.05),
          dot(-0.14, -0.78, 0.05),
          dot(-0.46, -0.34, 0.05),
          dot(-0.14, -0.42, 0.05),
          ...closed(outline, 2.4),
          ...disc(0, 0, 0.52),
        ],
        bottom: [0, 1.36],
        knot: [0, 1.36],
        logo: [0, 0],
        logoSize: 0.8,
      };
    }
    case 'wing': {
      const outline: Pt[] = [
        [-1.2, -0.56],
        [0.72, -1.02],
        [1.06, 0.74],
        [0.3, 0.72],
        [-0.42, 0.34],
      ];
      return {
        strokes: [
          ...paper(outline),
          line(
            [
              [0.72, -1.02],
              [0.3, 0.72],
            ],
            1,
          ),
          ring(0.72, -0.34, 0.11),
          ring(0.82, 0.14, 0.14),
          ring(0.56, 0.42, 0.08),
          dot(0.6, -0.68, 0.05),
          ...closed(outline, 2.2),
          ...disc(-0.16, -0.14, 0.48),
          line(
            [
              [-1.2, -0.56],
              [-1.46, -0.3],
              [-1.34, -0.04],
            ],
            2.2,
            0.4,
          ),
          line(
            [
              [-1.2, -0.56],
              [-1.56, -0.56],
              [-1.72, -0.34],
            ],
            2.2,
            0.4,
          ),
        ],
        bottom: [0.3, 0.72],
        knot: [0.3, 0.72],
        logo: [-0.16, -0.14],
        logoSize: 0.72,
      };
    }
    case 'bonnet': {
      const dome = arc(0, 0.24, 1.08, 1.26, Math.PI, TURN, 12);
      const hem = arc(0, 0.24, 1.08, 0.42, 0, Math.PI, 8).slice(1, -1);
      const outline = [...dome, ...hem];
      return {
        strokes: [
          ...paper(outline),
          line(
            [
              [0, -1.02],
              [-0.56, 0.5],
            ],
            1,
          ),
          line(
            [
              [0, -1.02],
              [0.56, 0.5],
            ],
            1,
          ),
          dot(-0.68, -0.26, 0.05),
          dot(-0.84, 0.04, 0.05),
          dot(-0.58, 0.1, 0.05),
          dot(0.68, -0.26, 0.05),
          dot(0.84, 0.04, 0.05),
          ...closed(outline, 2.2),
          ...disc(0, -0.12, 0.46),
          line(
            [
              [-1.08, 0.24],
              [-1.34, 0.56],
              [-1.2, 0.92],
            ],
            1,
          ),
          line(
            [
              [1.08, 0.24],
              [1.32, 0.56],
              [1.2, 0.86],
            ],
            1,
          ),
          line(
            [
              [-0.7, 0.54],
              [0, 1.06],
              [0.7, 0.54],
            ],
            0.9,
          ),
        ],
        bottom: [0, 0.66],
        knot: [0, 1.06],
        logo: [0, -0.12],
        logoSize: 0.72,
      };
    }
    case 'edo': {
      const outline: Pt[] = [
        [-0.92, -0.92],
        [0.86, -1.02],
        [0.98, 0.9],
        [-0.86, 1],
      ];
      const corner = (k: number): Pt[] => [
        [-0.86 + k, -0.92 + k * 0.1],
        [-0.8 + k, 0.98 - k],
        [0.98 - k * 0.1, 0.9 - k],
      ];
      return {
        strokes: [
          ...paper(outline),
          line(corner(0.16), 1),
          line(corner(0.3), 1),
          ...closed(outline, 2.3),
          ...[-0.62, -0.22, 0.18, 0.58].map((py) => ring(1.02, py, 0.07, 0.9)),
          ...[-0.46, -0.06, 0.34, 0.74].map((px) => ring(px, 1.04, 0.07, 0.9)),
          ...disc(0.1, -0.08, 0.52),
          line(
            [
              [-0.6, 1],
              [0, 1.44],
              [0.6, 0.95],
            ],
            0.9,
          ),
          ...bow(0, 1.46, 0.16, 'gold'),
        ],
        bottom: [0, 1.46],
        knot: [0, 1.44],
        logo: [0.1, -0.08],
        logoSize: 0.8,
      };
    }
    case 'flower': {
      const petals = Array.from({ length: 8 }, (_, i): Pt => {
        const angle = (i / 8) * TURN - Math.PI / 2;
        return [Math.cos(angle) * 0.92, Math.sin(angle) * 0.92];
      });
      return {
        strokes: [
          ...disc(0, 0, 0.9),
          ...petals.flatMap(([px, py]) => disc(px, py, 0.34)),
          ...petals.map(([px, py]) => {
            const out = Math.atan2(py, px);
            return line(arc(px, py, 0.34, 0.34, out - 1.75, out + 1.75, 8), 1.8, 0.1);
          }),
          ...disc(0, 0, 0.62),
          ring(0, 0, 0.62, 1.6),
        ],
        bottom: [0, 1.26],
        knot: [0, 1.26],
        logo: [0, 0],
        logoSize: 0.78,
      };
    }
    case 'scallop': {
      const outline: Pt[] = [
        [0.22, -1.16],
        [1.16, 0.78],
        [-1.2, 0.72],
      ];
      const row = (y: number, from: number, to: number, count: number): Pt[] => {
        const step = (to - from) / count;
        return Array.from({ length: count }, (_, i) =>
          arc(from + step * (i + 0.5), y, step / 2, step * 0.5, Math.PI, 0, 5),
        ).flat();
      };
      return {
        strokes: [
          ...paper(outline),
          line(row(0.46, -0.92, 0.98, 6), 1),
          line(row(0.72, -1.14, 1.1, 7), 1),
          ...closed(outline, 2.3),
          ...disc(0.08, -0.08, 0.44),
          line(
            [
              [-1.2, 0.72],
              [-1.44, 0.46],
              [-1.66, 0.62],
            ],
            1,
          ),
          ...bow(-1.7, 0.66, 0.14),
        ],
        bottom: [0.1, 0.76],
        knot: [0.1, 0.76],
        logo: [0.08, -0.08],
        logoSize: 0.66,
      };
    }
    case 'hex': {
      const outline = arc(0, 0, 1.02, 1.08, -Math.PI / 2, TURN - Math.PI / 2, 6).slice(0, 6);
      return {
        strokes: [
          ...paper(outline),
          ...outline.map((corner) =>
            line(
              [
                [0, 0],
                [corner[0], corner[1]],
              ],
              1,
            ),
          ),
          dot(0.42, -0.62, 0.05),
          dot(0.6, -0.4, 0.05),
          dot(0.72, -0.62, 0.05),
          line(
            [
              [-0.72, 0.44],
              [-0.3, 0.74],
            ],
            0.9,
          ),
          line(
            [
              [-0.56, 0.2],
              [-0.08, 0.56],
            ],
            0.9,
          ),
          ...closed(outline, 2.3),
          ...disc(0, 0, 0.5),
        ],
        bottom: [0, 1.08],
        knot: [0, 1.08],
        logo: [0, 0],
        logoSize: 0.76,
      };
    }
    case 'butterfly': {
      const wings: readonly (readonly [number, number, number, number])[] = [
        [-0.78, -0.28, 0.6, 0.66],
        [0.78, -0.28, 0.6, 0.66],
        [-0.54, 0.62, 0.42, 0.46],
        [0.54, 0.62, 0.42, 0.46],
      ];
      const body: Pt[] = [
        [0, -0.86],
        [0.36, 0.1],
        [0, 1.16],
        [-0.36, 0.1],
      ];
      return {
        strokes: wings
          .flatMap(([cx, cy, rx, ry]) => {
            const shapeOf = arc(cx, cy, rx, ry, 0, TURN, 14).slice(0, 14);
            return [
              ...paper(shapeOf),
              ...closed(shapeOf, 2),
              ring(cx + (cx < 0 ? -0.12 : 0.12), cy, ry * 0.38, 1),
            ];
          })
          .concat([
            ...paper(body),
            ...closed(body, 2),
            ...disc(0, 0.08, 0.46),
            line(
              [
                [-0.08, -0.86],
                [-0.26, -1.16],
                [-0.5, -1.2],
              ],
              1,
            ),
            line(
              [
                [0.08, -0.86],
                [0.26, -1.16],
                [0.5, -1.2],
              ],
              1,
            ),
          ]),
        bottom: [0, 1.16],
        knot: [0, 1.16],
        logo: [0, 0.08],
        logoSize: 0.7,
      };
    }
    case 'round': {
      const outline = arc(0, 0, 1.02, 1.02, 0, TURN, 16).slice(0, 16);
      return {
        strokes: [
          ...paper(outline),
          ...arc(0, 0, 0.8, 0.8, 0, TURN, 12)
            .slice(0, 12)
            .map(([px, py], i) => dot(px, py, i % 3 === 0 ? 0.07 : 0.04)),
          ...closed(outline, 2.1),
          ...disc(0, 0, 0.58),
        ],
        bottom: [0, 1.02],
        knot: [0, 1.02],
        logo: [0, 0],
        logoSize: 0.84,
      };
    }
  }
}

function drawTail(tail: KiteTail, from: Pt, pen: KitePen, index: number): InkStroke[] {
  const { bow, line } = pen;
  const [bx, by] = from;
  const accent: InkColor = index % 2 === 0 ? 'gold' : 'ink';
  switch (tail) {
    case 'bows':
      return [
        line(
          [
            [bx, by],
            [bx - 0.22, by + 0.34],
            [bx + 0.2, by + 0.72],
            [bx - 0.14, by + 1.12],
            [bx + 0.1, by + 1.5],
          ],
          1,
        ),
        ...bow(bx - 0.2, by + 0.36, 0.2, accent),
        ...bow(bx + 0.18, by + 0.74, 0.2),
        ...bow(bx - 0.12, by + 1.14, 0.2, accent),
      ];
    case 'loop':
      return [
        line(
          [
            [bx, by],
            [bx + 0.14, by + 0.3],
            [bx - 0.1, by + 0.56],
            [bx - 0.42, by + 0.5],
            [bx - 0.52, by + 0.22],
            [bx - 0.24, by + 0.12],
            [bx - 0.02, by + 0.48],
            [bx + 0.16, by + 0.96],
            [bx - 0.02, by + 1.32],
          ],
          1,
          0.12,
        ),
        ...bow(bx, by + 0.02, 0.22, accent),
      ];
    case 'ribbons':
      return [
        line(
          [
            [bx - 0.14, by],
            [bx - 0.3, by + 0.5],
            [bx - 0.1, by + 1.02],
          ],
          1.3,
          0.3,
        ),
        line(
          [
            [bx + 0.14, by],
            [bx + 0.34, by + 0.42],
            [bx + 0.22, by + 0.84],
          ],
          1.3,
          0.3,
        ),
        ...bow(bx - 0.1, by + 1.04, 0.2, accent),
      ];
    case 'tassel':
      return [
        ...[-0.2, 0, 0.2].map((spread) =>
          line(
            [
              [bx + spread * 0.3, by],
              [bx + spread, by + 0.62],
            ],
            1.4,
            0.6,
          ),
        ),
        ...bow(bx, by + 0.04, 0.16, accent),
      ];
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
  const drawn = drawShape(look.shape, pen);
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
    const lineWidth = look.line.width * (1 + 0.25 * Math.sin(t * Math.PI * 2 + index));
    return [
      u * u * knot[0] + 2 * u * t * slack[0] + t * t * hold[0],
      u * u * knot[1] + 2 * u * t * slack[1] + t * t * hold[1] + wander,
      lineWidth,
    ];
  };
  const steps = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.85, 1];
  const linePoints: InkPoint[] = [];
  let curled = look.line.curlAt === undefined;
  for (const t of steps) {
    if (!curled && t > (look.line.curlAt ?? 0)) {
      curled = true;
      const [cx, cy, w] = onLine(look.line.curlAt ?? 0);
      for (let a = 0; a <= 8; a += 1) {
        const angle = (a / 8) * TURN + Math.PI / 2;
        linePoints.push([cx + Math.cos(angle) * 11, cy - 11 + Math.sin(angle) * 11, w]);
      }
    }
    linePoints.push(onLine(t));
  }

  return {
    parts: [
      {
        id: `${tool}-line`,
        motions: sway,
        strokes: [
          {
            pts: linePoints,
            color: look.line.color,
            dry: look.line.dry,
            rough: 0.9,
            pace: 2.2,
          },
        ],
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
  52,
  [
    [
      'airtable',
      150,
      176,
      {
        shape: 'diamond',
        size: 1,
        tail: 'bows',
        lean: 0.3,
        line: { width: 1.1, dry: 0.2, slack: 0.03 },
      },
    ],
    [
      'googledrive',
      360,
      176,
      {
        shape: 'bonnet',
        size: 0.92,
        tail: 'none',
        lean: 0.12,
        line: { width: 0.8, dry: 0.5, slack: 0.05 },
      },
    ],
    [
      'gmail',
      542,
      92,
      {
        shape: 'wing',
        size: 1.04,
        tail: 'bows',
        lean: 0.2,
        line: { width: 1.7, dry: 0.08, slack: 0.012 },
      },
    ],
    [
      'notion',
      750,
      76,
      {
        shape: 'hex',
        size: 0.94,
        tail: 'ribbons',
        lean: 0.24,
        line: { width: 1, dry: 0.3, slack: 0.035, wander: 3.5 },
      },
    ],
    [
      'slack',
      940,
      84,
      {
        shape: 'flower',
        size: 0.96,
        tail: 'loop',
        lean: 0.1,
        line: { width: 1.2, dry: 0.12, slack: 0.03, color: 'gold' },
      },
    ],
    [
      'dropbox',
      866,
      240,
      {
        shape: 'butterfly',
        size: 0.8,
        tail: 'none',
        lean: 0.3,
        line: { width: 0.8, dry: 0.3, slack: 0.022 },
      },
    ],
    [
      'shopify',
      1132,
      196,
      {
        shape: 'edo',
        size: 0.94,
        tail: 'tassel',
        lean: 0.22,
        line: { width: 1.4, dry: 0.35, slack: 0.03, wander: 2.5 },
      },
    ],
    [
      'stripe',
      1318,
      250,
      {
        shape: 'scallop',
        size: 0.94,
        tail: 'none',
        lean: 0.34,
        line: { width: 1, dry: 0.15, slack: 0.024, curlAt: 0.3 },
      },
    ],
    [
      'onepassword',
      1012,
      420,
      {
        shape: 'round',
        size: 0.8,
        tail: 'ribbons',
        lean: 0.2,
        line: { width: 0.9, dry: 0.55, slack: 0.03 },
      },
    ],
    [
      'square',
      1262,
      462,
      {
        shape: 'diamond',
        size: 0.86,
        tail: 'none',
        lean: 0.36,
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
      120,
      190,
      {
        shape: 'wing',
        size: 0.94,
        tail: 'none',
        lean: 0.1,
        line: { width: 1.6, dry: 0.08, slack: 0.012 },
      },
    ],
    [
      'slack',
      262,
      104,
      {
        shape: 'flower',
        size: 0.84,
        tail: 'loop',
        lean: 0.12,
        line: { width: 1.2, dry: 0.12, slack: 0.03, color: 'gold' },
      },
    ],
    [
      'shopify',
      412,
      84,
      {
        shape: 'edo',
        size: 0.84,
        tail: 'tassel',
        lean: 0.2,
        line: { width: 1.1, dry: 0.35, slack: 0.03, wander: 3 },
      },
    ],
    [
      'stripe',
      548,
      116,
      {
        shape: 'diamond',
        size: 0.94,
        tail: 'bows',
        lean: 0.28,
        line: { width: 0.9, dry: 0.45, slack: 0.04 },
      },
    ],
    [
      'square',
      510,
      336,
      {
        shape: 'hex',
        size: 0.88,
        tail: 'none',
        lean: 0.26,
        line: { width: 1.7, dry: 0.06, slack: 0.025 },
      },
    ],
    [
      'notion',
      546,
      496,
      {
        shape: 'butterfly',
        size: 0.82,
        tail: 'none',
        lean: 0.26,
        line: { width: 1, dry: 0.25, slack: 0.02, curlAt: 0.4 },
      },
    ],
  ],
  [],
);
