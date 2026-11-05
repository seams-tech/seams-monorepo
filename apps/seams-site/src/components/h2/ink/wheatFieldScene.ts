import type { InkColor, InkPoint, InkStroke } from './brush';
import { goatScene, wheat, wireScene, type InkMotion, type InkPart, type InkScene } from './scenes';

/* The integrations drawing: one close field of wheat, with a connected tool over
   some of the stalks. The stalks with no tool make it read as a field. */

type Pt = readonly [number, number];

export type ToolStalk = {
  /* a mark in ECOSYSTEM_LOGO_MARKS */
  readonly tool: string;
  readonly x: number;
  readonly y: number;
  readonly logoSize: number;
  readonly base: Pt;
  /* the second at which its ear is nearly drawn, so that its logo can appear */
  readonly shown: number;
  /* the sway of the stalk, so that its logo moves with it */
  readonly motions: readonly InkMotion[];
};

export type WheatFieldLayout = {
  readonly scene: InkScene;
  readonly stalks: readonly ToolStalk[];
  /* a gold grain drifts along each of these, from one ear to another */
  readonly grains: readonly string[];
  /* small gold motes that rise from the tops of the stalks */
  readonly motes: readonly Mote[];
};

export type Mote = {
  readonly path: string;
  readonly radius: number;
  readonly seconds: number;
  readonly begin: number;
};

type ToolPlace = readonly [tool: string, x: number, y: number, lean: number];
type BarePlace = readonly [x: number, tipY: number, lean: number, size: number];

/* The stalks grow in one wave from left to right: each starts at its own second
   and draws at the usual brush speed, so the field is whole in about a second and a half. */
const WAVE_SECONDS = 0.6;
const EAR_SECONDS = 0.5;
const KID_AT = 0.4;
const BIRD_AT = 0.9;

function startAt(parts: readonly InkPart[], at: number): InkPart[] {
  return parts.map((part, index) => (index === 0 ? { ...part, at } : part));
}

function placed(
  parts: readonly InkPart[],
  name: string,
  k: number,
  dx: number,
  dy: number,
): InkPart[] {
  return parts.map((part) => ({
    ...part,
    id: `${name}-${part.id}`,
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

/* a loaded brush on the stem: a dry one leaves gaps that read as a broken stalk */
function stalk(
  id: string,
  base: Pt,
  tip: Pt,
  lean: number,
  seed: number,
  size: number,
  at: number,
  color: InkColor = 'ink',
): InkPart[] {
  const bend: Pt = [base[0] + lean * 0.45, (base[1] + tip[1]) / 2];
  const parts = wheat(id, base, bend, tip, seed, size, color).map((part) =>
    part.id.endsWith('-stem')
      ? { ...part, strokes: part.strokes.map((stroke) => ({ ...stroke, dry: 0.08, rough: 0.6 })) }
      : part,
  );
  return startAt(parts, at);
}

const kid = partsNamed(goatScene, 'kid-');
const kidFeet = Math.max(
  ...kid.flatMap((part) => part.strokes.flatMap((stroke) => stroke.pts.map(([, y]) => y))),
);
const bird = partsNamed(wireScene, 'arriving');

function layout(
  width: number,
  height: number,
  logoSize: number,
  stalkSize: number,
  tools: readonly ToolPlace[],
  bare: readonly BarePlace[],
  kidScale: number,
  kidX: number,
  birds: readonly (readonly [x: number, y: number, k: number])[],
  grainPairs: readonly (readonly [number, number])[],
): WheatFieldLayout {
  const ground = height + 2;
  const gap = logoSize * 0.82;
  const waveAt = (x: number): number => (WAVE_SECONDS * x) / width;
  const toolParts = tools.map(([tool, x, y, lean], index) => {
    const at = waveAt(x);
    const parts = stalk(
      `tool-${tool}`,
      [x - lean, ground],
      [x, y + gap],
      lean,
      101 + index * 137,
      stalkSize,
      at,
    );
    const motions = parts[0]?.motions ?? [];
    const base = [x - lean, ground] as const;
    return { parts, stalk: { tool, x, y, logoSize, base, shown: at + EAR_SECONDS, motions } };
  });
  const bareParts = bare.flatMap(([x, tipY, lean, size], index) =>
    stalk(
      `bare-${index}`,
      [x - lean, ground],
      [x, tipY],
      lean,
      211 + index * 89,
      size,
      waveAt(x),
    ),
  );
  const stalks = toolParts.map((entry) => entry.stalk);
  const grains = grainPairs.flatMap(([a, b]) => {
    const from = stalks[a];
    const to = stalks[b];
    if (!from || !to) return [];
    const ay = from.y + gap + 8;
    const by = to.y + gap + 8;
    return [`M${from.x} ${ay} Q${(from.x + to.x) / 2} ${Math.min(ay, by) - 46} ${to.x} ${by}`];
  });
  /* motes rise from the ears of the bare stalks, in a stable order */
  const motes = bare.flatMap(([x, tipY, lean], index): Mote[] => {
    const drift = (index % 2 === 0 ? 1 : -1) * (14 + (index % 3) * 8);
    return [0].map((n) => ({
      path: `M${x} ${tipY - 6} Q${x + drift} ${tipY - 60 - n * 26} ${x + drift * 0.4 + lean} ${tipY - 120 - n * 40}`,
      radius: 1.6 + ((index + n) % 3) * 0.7,
      seconds: 4.2 + ((index * 7 + n * 5) % 9) * 0.45,
      begin: 1.8 + ((index * 3 + n * 4) % 11) * 0.5,
    }));
  });
  return {
    stalks,
    grains,
    motes,
    scene: {
      width,
      height,
      parts: [
        ...bareParts,
        ...toolParts.flatMap((entry) => entry.parts),
        ...startAt(placed(kid, 'kid', kidScale, kidX, height - kidFeet * kidScale - 8), KID_AT),
        ...birds.flatMap(([x, y, k], index) =>
          startAt(placed(bird, `bird-${index}`, k, x - 118 * k, y - 40 * k), BIRD_AT),
        ),
      ],
    },
  };
}

export const wideField: WheatFieldLayout = layout(
  1400,
  520,
  60,
  0.92,
  [
    ['slack', 176, 118, 16],
    ['gmail', 392, 44, -12],
    ['shopify', 610, 122, 14],
    ['stripe', 826, 46, -14],
    ['square', 1040, 116, 16],
    ['googledrive', 1254, 50, -12],
  ],
  [
    [36, 300, 12, 0.78],
    [92, 246, -10, 0.86],
    [252, 256, 14, 0.84],
    [312, 322, -8, 0.74],
    [462, 292, 10, 0.8],
    [528, 244, -14, 0.86],
    [684, 262, 12, 0.84],
    [752, 318, -10, 0.74],
    [900, 296, 14, 0.8],
    [966, 250, -10, 0.86],
    [1116, 262, 10, 0.84],
    [1182, 320, -12, 0.74],
    [1328, 254, 12, 0.86],
    [1380, 312, -8, 0.76],
  ],
  0.8,
  380,
  [[640, 40, 0.8]],
  [
    [0, 1],
    [2, 3],
    [4, 5],
    [1, 2],
    [3, 4],
  ],
);

export const narrowField: WheatFieldLayout = layout(
  620,
  560,
  70,
  0.82,
  [
    ['slack', 98, 150, 10],
    ['gmail', 244, 56, -8],
    ['shopify', 388, 150, 10],
    ['stripe', 530, 62, -10],
  ],
  [
    [30, 340, 8, 0.7],
    [168, 322, -8, 0.74],
    [316, 346, 8, 0.7],
    [458, 318, -8, 0.74],
    [596, 352, 6, 0.7],
  ],
  0.62,
  150,
  [],
  [
    [0, 1],
    [2, 3],
    [1, 2],
    [3, 0],
  ],
);
