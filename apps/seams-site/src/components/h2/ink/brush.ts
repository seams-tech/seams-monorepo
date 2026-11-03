/* A small bristle brush for the home page drawings. A stroke is a spline with a
   width at each point. Each bristle walks that spline on its own and skips where
   it runs dry or where the plaster grain stops it, so the edges tear and the
   tail breaks up as real brush ink does. No two page loads draw the same marks.
   A stroke draws in slices, so a frame only pays for the new marks. */

export type InkColor = 'ink' | 'accent' | 'gold' | 'paper' | 'clear';

/* scene x, scene y, brush width at that point */
export type InkPoint = readonly [number, number, number];

export type InkStroke = {
  readonly pts: readonly InkPoint[];
  readonly color?: InkColor;
  /* 0 is a loaded brush; 1 is nearly out of ink by the end of the stroke */
  readonly dry?: number;
  /* how much the two edges tear */
  readonly rough?: number;
  /* holes from the wall, 0 to about 0.4 */
  readonly grain?: number;
  /* greater than 1 moves the brush faster */
  readonly pace?: number;
  /* square ends, for a box or a sack, in place of round ones */
  readonly flat?: boolean;
  /* the middle bristle stays down, so a thin part of the stroke keeps its line */
  readonly keepLine?: boolean;
};

const COLORS: Record<InkColor, string> = {
  ink: '#0c0b0a',
  accent: '#e4572e',
  gold: '#d98f24',
  paper: '#f9f7f2',
  clear: '#000000',
};

const TABLE_SIZE = 1024;

export type InkNoise = {
  one: (x: number) => number;
  two: (x: number, y: number) => number;
  random: () => number;
};

export function createNoise(seed: number): InkNoise {
  let state = seed >>> 0 || 1;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const table = new Float32Array(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; i += 1) table[i] = random();
  const at = (i: number): number => table[i & (TABLE_SIZE - 1)];
  const ease = (t: number): number => t * t * (3 - 2 * t);
  return {
    random,
    one(x) {
      const i = Math.floor(x);
      const f = ease(x - i);
      return at(i) + (at(i + 1) - at(i)) * f;
    },
    two(x, y) {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = ease(x - ix);
      const fy = ease(y - iy);
      const row = (j: number): number => {
        const a = at(ix + Math.imul(j, 57));
        const b = at(ix + 1 + Math.imul(j, 57));
        return a + (b - a) * fx;
      };
      const top = row(iy);
      return top + (row(iy + 1) - top) * fy;
    },
  };
}

/* the walked spline: position, normal and width at each brush step */
type Spine = {
  x: Float32Array;
  y: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  w: Float32Array;
  length: number;
};

const SPINE_STEP = 1.1;

function walkSpine(pts: readonly InkPoint[], flat: boolean): Spine {
  const raw: number[][] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 18; k += 1) {
      const t = k / 18;
      const t2 = t * t;
      const t3 = t2 * t;
      const blend = (a: number, b: number, c: number, d: number): number =>
        0.5 *
        (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      raw.push([
        blend(p0[0], p1[0], p2[0], p3[0]),
        blend(p0[1], p1[1], p2[1], p3[1]),
        p1[2] + (p2[2] - p1[2]) * t,
      ]);
    }
  }
  raw.push([...pts[pts.length - 1]]);

  let length = 0;
  const lengths = [0];
  for (let i = 1; i < raw.length; i += 1) {
    length += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    lengths.push(length);
  }
  const count = Math.max(3, Math.ceil(length / SPINE_STEP));
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const nx = new Float32Array(count);
  const ny = new Float32Array(count);
  const w = new Float32Array(count);
  let j = 0;
  for (let i = 0; i < count; i += 1) {
    const d = (i / (count - 1)) * length;
    while (j < raw.length - 2 && lengths[j + 1] < d) j += 1;
    const span = lengths[j + 1] - lengths[j] || 1;
    const f = Math.min(1, (d - lengths[j]) / span);
    x[i] = raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f;
    y[i] = raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f;
    const tx = raw[j + 1][0] - raw[j][0];
    const ty = raw[j + 1][1] - raw[j][1];
    const tl = Math.hypot(tx, ty) || 1;
    nx[i] = -ty / tl;
    ny[i] = tx / tl;
    /* the brush lands and lifts round, inside one width of each end */
    const own = raw[j][2] + (raw[j + 1][2] - raw[j][2]) * f;
    const round = Math.max(0.5, Math.min(own * 0.5, length * 0.3));
    const land = Math.min(1, d / round);
    const lift = Math.min(1, (length - d) / round);
    w[i] = flat ? own : own * Math.sqrt(Math.min(land, lift));
  }
  return { x, y, nx, ny, w, length };
}

export type PreparedStroke = {
  readonly length: number;
  readonly draw: (ctx: CanvasRenderingContext2D, progress: number) => void;
};

/* device pixels between bristle centres, and the mark width over that gap */
const BRISTLE_GAP = 1.5;
const BRISTLE_OVERLAP = 1.55;

export function prepareStroke(stroke: InkStroke, scale: number, noise: InkNoise): PreparedStroke {
  const spine = walkSpine(stroke.pts, stroke.flat ?? false);
  const steps = spine.x.length;
  const dry = stroke.dry ?? 0;
  const rough = stroke.rough ?? 0.5;
  const grain = stroke.grain ?? 0.12;
  const color = stroke.color ?? 'ink';

  let widest = 0;
  for (let i = 0; i < steps; i += 1) widest = Math.max(widest, spine.w[i]);
  const gap = BRISTLE_GAP / scale;
  const count = Math.max(3, Math.ceil(widest / gap));
  const lineWidth = gap * BRISTLE_OVERLAP;

  const offset = new Float32Array(count);
  const rank = new Float32Array(count);
  const seed = new Float32Array(count);
  const rate = new Float32Array(count);
  const lastX = new Float32Array(count);
  const lastY = new Float32Array(count);
  const lastOn = new Uint8Array(count);
  for (let b = 0; b < count; b += 1) {
    offset[b] = ((b + noise.random()) / count) * 2 - 1;
    rank[b] = noise.random();
    seed[b] = noise.random() * 1000;
    rate[b] = 0.018 + noise.random() * 0.07;
  }
  if (stroke.keepLine) {
    let middle = 0;
    for (let b = 1; b < count; b += 1) {
      if (Math.abs(offset[b]) < Math.abs(offset[middle])) middle = b;
    }
    rank[middle] = 0;
  }
  const leftEdge = noise.random() * 1000;
  const rightEdge = noise.random() * 1000;

  let done = 0;
  return {
    length: spine.length,
    draw(ctx, progress) {
      const target = Math.min(steps, Math.ceil(progress * steps));
      if (target <= done) return;
      ctx.globalCompositeOperation = color === 'clear' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = COLORS[color];
      ctx.lineCap = 'round';
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = done; i < target; i += 1) {
        const distance = i * SPINE_STEP;
        const t = i / (steps - 1);
        const width = spine.w[i];
        const dryness = dry * (0.18 + 0.82 * t * t);
        for (let b = 0; b < count; b += 1) {
          /* a narrow part of the stroke needs fewer bristles */
          if (rank[b] > width / widest + 0.04) {
            lastOn[b] = 0;
            continue;
          }
          const u = offset[b];
          const tear =
            u < 0 ? noise.one(leftEdge + distance * 0.07) : noise.one(rightEdge + distance * 0.07);
          const flare = 1 + (tear - 0.5) * rough * 0.55 * u * u;
          const lateral = (u * width * flare) / 2;
          const px = spine.x[i] + spine.nx[i] * lateral;
          const py = spine.y[i] + spine.ny[i] * lateral;
          const streak = noise.one(seed[b] + distance * rate[b]);
          const wall = noise.two(px * 0.42, py * 0.42);
          const edge = u * u * u * u * rough * 0.42;
          const on =
            streak * 0.62 + wall * 0.38 > dryness * 0.95 + edge + grain * wall * 0.9 ? 1 : 0;
          if (on && lastOn[b]) {
            ctx.moveTo(lastX[b], lastY[b]);
            ctx.lineTo(px, py);
          }
          lastX[b] = px;
          lastY[b] = py;
          lastOn[b] = on;
        }
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      done = target;
    },
  };
}

/* scene box that holds a set of strokes, with room for torn edges */
export function strokeBounds(strokes: readonly InkStroke[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number, pad: number): void => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  };
  /* the spline can swing past its points, so leave some air */
  for (const stroke of strokes) {
    for (const [x, y, w] of stroke.pts) take(x, y, w * 0.8 + 10);
  }
  const x = Math.floor(minX);
  const y = Math.floor(minY);
  return { x, y, width: Math.ceil(maxX) - x, height: Math.ceil(maxY) - y };
}
