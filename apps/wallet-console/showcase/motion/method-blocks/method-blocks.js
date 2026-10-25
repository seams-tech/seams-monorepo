/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// "A face, a fingerprint, or a voice opens the wallet": three blocks in a column
// through three thin planes, after the "Analyze" study of the reference video,
// with its thick frame drawn as planes like the other wallet figures. Each block is
// one sign-in method, its card's icon on its top face. Hover: the planes turn a
// quarter, top first, to read the block inside them, whose icon traces solid; the
// column steps up one place, a block shrinking out at the top and growing back at
// the foot; and so on for fingerprint, face and voice.
// Line only, as the other wallet figures: nothing is filled, an edge that a solid
// or a plane hides draws dotted, outlines are mid grey, creases, rims and unread
// icons light, and the block in the planes carries the accent.
// Proportions measured on the reference, in block sides: the planes 2.8 wide with
// a hole of 1.9, the block in them as tall as the frame was, and 4.1 between the
// blocks.
const B = 17; // a block's half side
const [W, IN] = [48, 27]; // a plane's outer and hole half sides
const PLANES = [14, 0, -14]; // the planes' heights, top first
const LAG = 0.035; // each lower plane starts its turns this much of the play later
const PITCH = 70;
// A block past the top place shrinks away over this much travel; one below the
// foot place grows in over the same.
const FADE = 0.25 * PITCH;
const NAMES = ['fingerprint', 'face', 'voice'];
const BASE = [0, -PITCH, PITCH]; // fingerprint in the frame, face below it, voice above
// The play: a turn, a step, a turn, a step, a turn.
const SLOTS = [
  [0, 0.22],
  [0.25, 0.42],
  [0.45, 0.64],
  [0.67, 0.84],
  [0.86, 1],
];
const READS = [0, 2, 4]; // the turn that reads each method
const EASE = HL.bezier(0.65, 0, 0.35, 1);
const phase = (head, [a, b]) => EASE(HL.clamp((head - a) / (b - a), 0, 1));
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
// Towards the viewer of Cam(45, 0.5): along it P does not move, so a point is
// hidden when a face lies ahead of it on this ray.
const TOWARD = [1, 1, (Math.SQRT2 * 0.5) / Math.sqrt(0.75)];
const STEP = 3; // screen units between visibility samples; a change between two is bisected
// Rounded footprints, after rule 09: corner radii in world units for a block, a
// plane's outline and its hole, and the steps round each corner. The planes are
// only slightly rounded.
const [R_BLOCK, R_PLANE, R_HOLE] = [3.5, 3, 2];
const ARC = 4;

// The cards' Lucide icons (ISC License, Copyright (c) Lucide Contributors):
// fingerprint, scan-face and mic from lucide-react 0.542.0, flattened to lines in
// icon units about the icon's centre, y up.
const ICONS = [
  [
    '0,2 -0.39,1.96 -0.77,1.85 -1.11,1.66 -1.41,1.41 -1.66,1.11 -1.85,0.77 -1.96,0.39 -2,0 -2,-0.32 -2.01,-0.66 -2.03,-1.03 -2.05,-1.42 -2.07,-1.82 -2.1,-2.24 -2.13,-2.67 -2.17,-3.11 -2.21,-3.55 -2.26,-4',
    '2,-1.12 2,-1.88 1.99,-2.72 1.97,-3.62 1.94,-4.55 1.88,-5.52 1.78,-6.48 1.66,-7.43 1.49,-8.34 1.27,-9.21 1,-10',
    '5.29,-9.02 5.33,-8.81 5.38,-8.54 5.44,-8.24 5.5,-7.91 5.56,-7.55 5.62,-7.2 5.67,-6.86 5.72,-6.53 5.76,-6.24 5.79,-6',
    '-10,0 -9.82,1.91 -9.27,3.75 -8.38,5.45 -7.19,6.95 -5.73,8.2 -4.06,9.14 -2.24,9.75 -0.34,9.99 1.58,9.87 3.44,9.39 5.17,8.56 6.71,7.42 8,6',
    '-10,-4 -9.99,-4',
    '9.8,-4 9.85,-3.36 9.89,-2.67 9.91,-1.94 9.92,-1.21 9.92,-0.49 9.91,0.18 9.9,0.8 9.87,1.32 9.84,1.73 9.8,2',
    '-7,-7.5 -6.85,-7.01 -6.7,-6.43 -6.56,-5.79 -6.43,-5.08 -6.31,-4.31 -6.21,-3.5 -6.12,-2.66 -6.06,-1.79 -6.01,-0.9 -6,0 -5.92,1.01 -5.66,2',
    '-3.35,-10 -3.29,-9.8 -3.22,-9.6 -3.16,-9.41 -3.09,-9.21 -3.03,-9.01 -2.97,-8.81 -2.92,-8.61 -2.87,-8.41 -2.82,-8.2 -2.78,-8',
    '-3,5.2 -1.96,5.67 -0.85,5.94 0.29,6 1.42,5.83 2.49,5.46 3.48,4.89 4.34,4.14 5.05,3.25 5.57,2.23 5.89,1.14 6,0 6,-2',
  ],
  [
    '-9,5 -9,7 -8.96,7.39 -8.85,7.77 -8.66,8.11 -8.41,8.41 -8.11,8.66 -7.77,8.85 -7.39,8.96 -7,9 -5,9',
    '5,9 7,9 7.39,8.96 7.77,8.85 8.11,8.66 8.41,8.41 8.66,8.11 8.85,7.77 8.96,7.39 9,7 9,5',
    '9,-5 9,-7 8.96,-7.39 8.85,-7.77 8.66,-8.11 8.41,-8.41 8.11,-8.66 7.77,-8.85 7.39,-8.96 7,-9 5,-9',
    '-5,-9 -7,-9 -7.39,-8.96 -7.77,-8.85 -8.11,-8.66 -8.41,-8.41 -8.66,-8.11 -8.85,-7.77 -8.96,-7.39 -9,-7 -9,-5',
    '-4,-2 -3.96,-2.06 -3.82,-2.21 -3.61,-2.43 -3.31,-2.7 -2.94,-3 -2.49,-3.3 -1.97,-3.57 -1.38,-3.79 -0.72,-3.94 0,-4 0.72,-3.94 1.38,-3.79 1.97,-3.57 2.49,-3.3 2.94,-3 3.31,-2.7 3.61,-2.43 3.82,-2.21 3.96,-2.06 4,-2',
    '-3,3 -2.99,3',
    '3,3 3.01,3',
  ],
  [
    '0,-7 0,-10',
    '7,2 7,0 6.87,-1.37 6.47,-2.68 5.82,-3.89 4.95,-4.95 3.89,-5.82 2.68,-6.47 1.37,-6.87 0,-7 -1.37,-6.87 -2.68,-6.47 -3.89,-5.82 -4.95,-4.95 -5.82,-3.89 -6.47,-2.68 -6.87,-1.37 -7,0 -7,2',
    '0,10 0.59,9.94 1.15,9.77 1.67,9.49 2.12,9.12 2.49,8.67 2.77,8.15 2.94,7.59 3,7 3,0 2.94,-0.59 2.77,-1.15 2.49,-1.67 2.12,-2.12 1.67,-2.49 1.15,-2.77 0.59,-2.94 0,-3 -0.59,-2.94 -1.15,-2.77 -1.67,-2.49 -2.12,-2.12 -2.49,-1.67 -2.77,-1.15 -2.94,-0.59 -3,0 -3,7 -2.94,7.59 -2.77,8.15 -2.49,8.67 -2.12,9.12 -1.67,9.49 -1.15,9.77 -0.59,9.94 0,10',
  ],
].map((lines) => lines.map((line) => line.split(' ').map((pair) => pair.split(',').map(Number))));
// Each icon lies square to its top face's edges, turned 45° from upright: its
// right runs along +x and its up along -y, so the camera foreshortens it with the
// face. Lucide draws in the middle 20 of its 24 units; that area fills 55% of the
// face, at one scale for all three icons. The user chose this over upright and
// embossed icons on 2026-10-25.
const ICON_SCALE = (0.55 * B) / 10;
const MARKS = ICONS.map((lines) =>
  lines.map((line) => line.map(([u, v]) => [u * ICON_SCALE, -v * ICON_SCALE])),
);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function partial(points, part) {
  const out = [points[0]];
  for (let i = 1, left = part * (points.length - 1); i < points.length && left > 0; i++, left--)
    out.push(points[i - 1].map((v, k) => HL.lerp(v, points[i][k], Math.min(1, left))));
  return out;
}

// Where a block is once the column has stepped up by s: its centre, wrapping every
// three places, and its size, which shrinks out above the top place and grows in
// below the foot place.
function pose(base, s) {
  const span = 3 * PITCH;
  const z = ((((base + s + span / 2) % span) + span) % span) - span / 2;
  return { z, size: HL.clamp((PITCH + FADE - Math.abs(z)) / FADE, 0, 1) };
}

// A solid as flat faces, each with its outward normal. Its edges are the sides
// that two faces at an angle share; a seam between two faces in one plane is not
// an edge. Faces that share a `wall` are strips of one rounded wall.
function solid(faces) {
  const sides = new Map();
  faces.forEach(({ pts }, f) =>
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const key = [a, b]
        .map((p) => p.map((v) => v.toFixed(3)).join())
        .sort()
        .join('|');
      if (!sides.has(key)) sides.set(key, { a, b, faces: [] });
      sides.get(key).faces.push(f);
    }),
  );
  const edges = [...sides.values()].filter(
    ({ faces: [f, g] }) => g !== undefined && dot(faces[f].n, faces[g].n) < 0.999,
  );
  return { faces, edges };
}

// A rounded square footprint of half side h and corner radius r, turned by yaw, at
// height z. It runs counter-clockwise.
function ring(h, r, yaw, z) {
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  return HL.rrect(-h, -h, h, h, r, ARC).map(({ u, v }) => [u * c - v * s, u * s + v * c, z]);
}

// The outward normal of the wall standing on a counter-clockwise footprint from a to b.
function outward(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[1] - a[1]) / len, -(b[0] - a[0]) / len, 0];
}

function block(z, h, r) {
  const [foot, top] = [ring(h, r, 0, z - h), ring(h, r, 0, z + h)];
  const sides = foot.map((a, i) => {
    const j = (i + 1) % foot.length;
    return { pts: [a, foot[j], top[j], top[i]], n: outward(a, foot[j]), wall: 'side' };
  });
  return solid([{ pts: top, n: [0, 0, 1] }, { pts: foot, n: [0, 0, -1] }, ...sides]);
}

// One thin plane at height z, turned by yaw: a slightly rounded square with a
// slightly rounded square hole, as quads round the hole. Its outline is grey and
// its rim light.
function plane(z, yaw) {
  const [o, i] = [ring(W, R_PLANE, yaw, z), ring(IN, R_HOLE, yaw, z)];
  const faces = [];
  const edges = [];
  o.forEach((_, k) => {
    const j = (k + 1) % o.length;
    faces.push({ pts: [o[k], o[j], i[j], i[k]], n: [0, 0, 1] });
    edges.push({ a: o[k], b: o[j], faces: [k], ink: 'sil' });
    edges.push({ a: i[k], b: i[j], faces: [k], ink: 'lo' });
  });
  return { faces, edges };
}

// Whether a screen point lies inside a convex polygon or on its border. Borders
// count, so a ray along the seam between a plane's quads is still caught; a
// line on a face's own border never reaches this test, because it lies in the
// face's plane.
function inside(poly, [x, y]) {
  let [low, high] = [Infinity, -Infinity];
  for (let i = 0; i < poly.length; i++) {
    const [[ax, ay], [bx, by]] = [poly[i], poly[(i + 1) % poly.length]];
    const c = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay);
    [low, high] = [Math.min(low, c), Math.max(high, c)];
  }
  return low >= -0.02 || high <= 0.02;
}

// The faces turned to the viewer, ready for the hidden test, each with its screen
// box for a quick reject. Any ray that crosses a closed solid leaves it through
// one of these.
function viewed(P, solids) {
  return solids.flatMap(({ faces }) =>
    faces
      .filter(({ n }) => dot(n, TOWARD) > 1e-6)
      .map(({ pts, n }) => {
        const screen = pts.map((p) => P(...p));
        const [xs, ys] = [0, 1].map((k) => screen.map((q) => q[k]));
        const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        return { n, d: dot(n, pts[0]), facing: dot(n, TOWARD), screen, box };
      }),
  );
}

function hidden(P, front, point) {
  const [x, y] = P(...point);
  return front.some(
    ({ n, d, facing, screen, box }) =>
      x > box[0] - 0.1 &&
      x < box[2] + 0.1 &&
      y > box[1] - 0.1 &&
      y < box[3] + 0.1 &&
      (d - dot(n, point)) / facing > 0.01 &&
      inside(screen, [x, y]),
  );
}

// A world polyline cut into its seen and hidden runs. Samples fall every STEP on
// screen, and a change between two samples is bisected, so a run ends on the edge
// that covers it.
function runs(P, front, points) {
  const out = { seen: '', hidden: '' };
  const test = (p) => (hidden(P, front, p) ? 'hidden' : 'seen');
  const along = (a, b, t) => a.map((v, c) => HL.lerp(v, b[c], t));
  let [kind, run] = [test(points[0]), [P(...points[0])]];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const [sa, sb] = [P(...a), P(...b)];
    const n = Math.max(1, Math.ceil(Math.hypot(sb[0] - sa[0], sb[1] - sa[1]) / STEP));
    for (let k = 1; k <= n; k++) {
      const next = test(along(a, b, k / n));
      if (next !== kind) {
        let [lo, hi] = [(k - 1) / n, k / n];
        for (let step = 0; step < 8; step++) {
          const mid = (lo + hi) / 2;
          if (test(along(a, b, mid)) === kind) lo = mid;
          else hi = mid;
        }
        const cut = P(...along(a, b, (lo + hi) / 2));
        run.push(cut);
        if (run.length > 1) out[kind] += HL.open(run);
        [kind, run] = [next, [cut]];
      }
      run.push(P(...along(a, b, k / n)));
    }
  }
  if (run.length > 1) out[kind] += HL.open(run);
  return out;
}

// One solid's edges into the buckets: hidden runs dotted; seen runs grey on the
// outline (one face turned to the viewer), light on a crease (both turned), or
// all in the accent. A rounded wall is smooth, so between two of its strips only
// the outline is drawn. A plane's edges carry their own ink.
function edges(P, front, { faces, edges: list }, paths, accent) {
  for (const { a, b, faces: pair, ink } of list) {
    const [tf, tg] = pair.map((f) => dot(faces[f].n, TOWARD) > 1e-6);
    const wall = faces[pair[0]].wall;
    if (!ink && wall && wall === faces[pair[1]].wall && tf === tg) continue;
    const { seen, hidden: behind } = runs(P, front, [a, b]);
    paths.hidden += behind;
    paths[accent ? 'hi' : (ink ?? (tf && tg ? 'lo' : 'sil'))] += seen;
  }
}

function draw(state, head) {
  const { P, el } = state;
  const s = PITCH * (phase(head, SLOTS[1]) + phase(head, SLOTS[3]));
  const poses = BASE.map((base) => pose(base, s));
  const blocks = poses.map(({ z, size }) =>
    size > 0.02 ? block(z, B * size, R_BLOCK * size) : null,
  );
  // Each plane makes the quarter turns, the top one first and each lower one a
  // beat later (rule 02), over turns of one length.
  const planes = PLANES.map((z, j) => {
    const lagged = ([a, b]) => [a + j * LAG, b - (PLANES.length - 1 - j) * LAG];
    const turns = READS.reduce((sum, slot) => sum + phase(head, lagged(SLOTS[slot])), 0);
    return plane(z, (turns * Math.PI) / 2);
  });
  const shapes = [...planes, ...blocks.filter(Boolean)];
  const front = viewed(P, shapes);
  const held = poses.reduce(
    (best, at, i) => (Math.abs(at.z) < Math.abs(poses[best].z) ? i : best),
    0,
  );
  const paths = { hidden: '', lo: '', sil: '', hi: '' };
  for (const shape of planes) edges(P, front, shape, paths, false);
  // The block in the planes carries the accent (rule 04).
  blocks.forEach((shape, i) => shape && edges(P, front, shape, paths, i === held));
  poses.forEach(({ z, size }, i) => {
    // Under the planes the top shows only through them, and a cut icon reads as noise.
    const top = z + B * size;
    if (!blocks[i] || top < PLANES[PLANES.length - 1]) return;
    const read = phase(head, SLOTS[READS[i]]);
    const world = (line) => line.map(([x, y]) => [x * size, y * size, top]);
    // Icons draw in the outline's grey. The one being read traces in the accent
    // with its block, and gives it up with the block (rule 04).
    const ink = i === held ? 'hi' : 'sil';
    for (const line of MARKS[i]) {
      if (read < 1) paths.sil += runs(P, front, world(line)).seen;
      if (read > 0) paths[ink] += runs(P, front, world(partial(line, read))).seen;
    }
  });
  for (const key in paths) el[key].setAttribute('d', paths[key]);
  const slot = SLOTS.findIndex(([, b]) => head < b);
  state.text = head === 0 ? 'rest' : head === 1 ? 'open' : NAMES[Math.ceil(slot / 2)];
}

// The play head runs forward while active and back while not (as maze-keys).
function tick(state, dt) {
  const target = state.active ? 1 : 0;
  const step = HL.reducedMotion() ? 1 : (dt * 1000) / state.duration;
  const head = HL.clamp(state.head + (target ? step : -step), 0, 1);
  if (head !== state.drawn) {
    state.head = state.drawn = head;
    draw(state, head);
  }
  state.read.textContent = state.text;
  return head !== target;
}

const select = (state, active) => ((state.active = active), state.loop.wake());

function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 1.25);
  const bounds = [];
  for (let a = 0; a < 360; a += 15) {
    const [x, y] = [W * Math.SQRT2 * Math.cos(HL.rad(a)), W * Math.SQRT2 * Math.sin(HL.rad(a))];
    for (const z of PLANES) bounds.push([x, y, z]);
  }
  for (const [x, y] of CORNERS) bounds.push([x * B, y * B, PITCH + B], [x * B, y * B, -PITCH - B]);
  HL.fit(C, bounds, 200, 160);
  const P = HL.proj(C);
  // The hidden edges are the dotted construction; axes under the planes would only
  // thicken the lattice inside them.
  const el = {};
  for (const [key, cls] of [
    ['hidden', 'nf lo dash'],
    ['lo', 'nf lo'],
    ['sil', 'nf sil'],
    ['hi', 'nf sil hi'],
  ])
    el[key] = HL.mk('path', { class: cls }, svg);
  const state = { P, read, el, duration, head: 0, drawn: NaN, active: false, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  draw(state, 0);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const pointer = { move: select.bind(null, state, true), leave: select.bind(null, state, false) };
  bag.add(HL.pointer(stage, pointer));
  bag.add(svg.replaceChildren.bind(svg));
  const set = (value) => ((state.duration = value), state.loop.wake());
  return { set, destroy: bag.dispose };
}

hairline({
  name: 'method-blocks',
  means:
    'Three blocks, one per sign-in method, through a frame. Hover: the frame reads each in turn.',
  rules: [4, 5, 6, 8],
  range: [4600, 3800, 3000],
  mount,
});
