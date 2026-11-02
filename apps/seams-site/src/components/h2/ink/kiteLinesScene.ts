import type { InkPoint, InkStroke } from './brush';
import { goatScene, wireScene, type InkMotion, type InkPart, type InkScene } from './scenes';

/* The integrations drawing: the kid from the hero holds one kite line to each
   tool. Every kite has its own angle from the mouth, so no two lines cross. */

type Pt = readonly [number, number];

export type ToolKite = {
  /* a mark in ECOSYSTEM_LOGO_MARKS */
  readonly tool: string;
  readonly x: number;
  readonly y: number;
  readonly logoSize: number;
  readonly swaySeconds: number;
  /* from the knot to the mouth, for a gold dot to follow */
  readonly line: string;
};

export type KiteLayout = {
  readonly scene: InkScene;
  readonly hold: Pt;
  readonly kites: readonly ToolKite[];
};

export const KITE_SWAY = '0.6deg';

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

function kiteParts(hold: Pt, tool: string, x: number, y: number, r: number, seconds: number) {
  /* the spine leans part of the way toward the line that holds it */
  const lean = Math.atan2(x - hold[0], hold[1] - y) * 0.42;
  const cos = Math.cos(lean);
  const sin = Math.sin(lean);
  const at = (px: number, py: number): Pt => [x + px * cos - py * sin, y + px * sin + py * cos];

  const top = at(0, -r * 1.12);
  const right = at(r * 0.92, -r * 0.1);
  const knot = at(0, r * 1.32);
  const left = at(-r * 0.92, -r * 0.1);
  const tailA = at(-r * 0.24, r * 1.68);
  const tailB = at(r * 0.2, r * 2);
  const tailC = at(-r * 0.12, r * 2.36);

  /* a slack line, drawn close to the curve that the gold dot follows */
  const slack: Pt = [
    (hold[0] + knot[0]) / 2 + (hold[0] - knot[0]) * 0.06,
    (hold[1] + knot[1]) / 2 + 22,
  ];
  const onLine = (t: number): Pt => {
    const u = 1 - t;
    return [
      u * u * knot[0] + 2 * u * t * slack[0] + t * t * hold[0],
      u * u * knot[1] + 2 * u * t * slack[1] + t * t * hold[1],
    ];
  };

  const edge = (from: Pt, to: Pt): InkStroke => ({
    pts: [
      [from[0], from[1], 2.1],
      [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 2.6],
      [to[0], to[1], 1.8],
    ],
    dry: 0.15,
    rough: 1,
    pace: 2,
  });
  const ribbon = (at2: Pt, slope: number): InkStroke => ({
    pts: [
      [at2[0] - 7, at2[1] - slope, 3.4],
      [at2[0] + 7, at2[1] + slope, 3.4],
    ],
    color: 'gold',
    rough: 0.8,
  });

  const sway: readonly InkMotion[] = [{ kind: 'sway', amount: KITE_SWAY, seconds, origin: hold }];
  const parts: InkPart[] = [
    {
      id: `${tool}-line`,
      motions: sway,
      strokes: [
        {
          pts: [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1].map((t): InkPoint => [...onLine(t), 1.1]),
          dry: 0.2,
          rough: 0.9,
          pace: 2.2,
        },
      ],
    },
    {
      id: `${tool}-kite`,
      motions: sway,
      strokes: [
        /* paper across the middle hides any line behind the kite */
        {
          pts: [
            [top[0], top[1], r * 0.1],
            [...at(0, -r * 0.3), r * 1.1],
            [...at(0, r * 0.1), r * 1.45],
            [...at(0, r * 0.7), r * 0.8],
            [knot[0], knot[1], r * 0.08],
          ],
          color: 'paper',
          rough: 0.2,
          grain: 0,
        },
        edge(top, right),
        edge(right, knot),
        edge(knot, left),
        edge(left, top),
        {
          pts: [
            [knot[0], knot[1], 1],
            [tailA[0], tailA[1], 1],
            [tailB[0], tailB[1], 1],
            [tailC[0], tailC[1], 0.8],
          ],
          dry: 0.3,
          rough: 1,
          pace: 2.4,
        },
        ribbon(tailA, 3),
        ribbon(tailB, -3),
      ],
    },
  ];
  const line = `M${knot[0]} ${knot[1]} Q${slack[0]} ${slack[1]} ${hold[0]} ${hold[1]}`;
  return { parts, line };
}

function layout(
  width: number,
  height: number,
  hold: Pt,
  kidScale: number,
  radius: number,
  logoSize: number,
  places: readonly (readonly [string, number, number])[],
  scenery: readonly InkPart[],
): KiteLayout {
  const kid = placed(
    partsNamed(goatScene, 'kid-'),
    kidScale,
    hold[0] - MOUTH[0] * kidScale,
    hold[1] - MOUTH[1] * kidScale,
  );
  const built = places.map(([tool, x, y], index) => {
    const swaySeconds = 3.7 + (index % 4) * 0.6;
    const { parts, line } = kiteParts(hold, tool, x, y, radius, swaySeconds);
    return { parts, kite: { tool, x, y, logoSize, swaySeconds, line } };
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
  50,
  [
    ['googledrive', 360, 210],
    ['gmail', 517, 114],
    ['notion', 708, 150],
    ['slack', 897, 68],
    ['airtable', 1029, 265],
    ['dropbox', 1085, 68],
    ['onepassword', 948, 418],
    ['stripe', 1222, 252],
    ['shopify', 1318, 68],
    ['square', 1296, 448],
  ],
  [
    ...placed(partsNamed(goatScene, 'behind-'), 1, -40, 56),
    ...placed(partsNamed(goatScene, 'under-a'), 1, 180, 56),
    ...placed(partsNamed(goatScene, 'under-b'), 1, 620, 56),
    ...placed(bird, 1, 66, 60),
  ],
);

export const narrowKites: KiteLayout = layout(
  620,
  680,
  [120, 548],
  1.08,
  62,
  62,
  [
    ['gmail', 130, 196],
    ['slack', 254, 111],
    ['shopify', 401, 84],
    ['stripe', 552, 98],
    ['square', 522, 319],
    ['notion', 552, 480],
  ],
  [],
);
