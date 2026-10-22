/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// "Permissions" as a maze: three thin ring walls round a core, each cut by two gaps
// that sit out of line at rest. Hover turns the rings, alternating, until one gap
// in each lines up into a channel facing the viewer; a request block then slides
// along it to the core. Leaving plays the same motion back from where it is.
const [HEIGHT, CHANNEL] = [5.5, 11];
// Each ring: its radius, its rest turn in degrees, and its wide gap's centre and half
// width. The outer ring keeps a wall at its left, right and far points in both poses,
// and no gap ends near a ring's left or right edge, where two ends would stack.
const RINGS = [
  [13, 90, 180, 45],
  [26, -60, 140, 50],
  [39, 140, 225, 45],
];
const [CORE, CORE_HEIGHT] = [4, 9];
const [BLOCK, BLOCK_HEIGHT] = [3.4, 6.8];
const [START, DOCK] = [RINGS[2][0] + 4 + BLOCK, CORE + 1.5 + BLOCK];
// The channel runs from the centre straight towards the viewer (+x +y).
const AIM = 45;
// The play as fractions of its length: the rings turn outer first, then the block slides.
const turnSlot = (index) => [(2 - index) * 0.13, (2 - index) * 0.13 + 0.42];
const SLIDE = [0.58, 1];
const EASE = HL.bezier(0.65, 0, 0.35, 1);

const phase = (head, [a, b]) => EASE(HL.clamp((head - a) / (b - a), 0, 1));
const deg = (radians) => (radians * 180) / Math.PI;
const ring = (r, a, z) => [r * Math.cos(HL.rad(a)), r * Math.sin(HL.rad(a)), z];

// A ring's walls as arcs in world degrees, for a turn from 0 (rest) to 1 (aligned).
function arcs([r, rest, wide, half], turn) {
  const gap = deg(Math.asin(CHANNEL / 2 / r));
  const shift = AIM + rest * (1 - turn);
  return [
    [gap, wide - half],
    [wide + half, 360 - gap],
  ].map(([a0, a1]) => [a0 + shift, a1 + shift]);
}

// Cuts an arc where the ring turns from its near half (-45° to 135°) to its far half.
function halves([a0, a1]) {
  const s = ((((a0 + 45) % 360) + 360) % 360) - 45;
  const e = s + a1 - a0;
  const out = [];
  for (const lo of [-45, 135, 315]) {
    const [from, to, hi] = [Math.max(s, lo), Math.min(e, lo + 180), lo + 180];
    if (to > from) out.push({ from, to, near: lo !== 135, cutFrom: s < lo, cutTo: e > hi });
  }
  return out;
}

// One wall section, a plane standing on its arc: filled, its top and foot as the
// silhouette, a vertical at each end, and one where the ring turns away (near half).
function wall(P, r, { from, to, near, cutFrom, cutTo }) {
  const n = Math.max(2, Math.ceil((to - from) / 4));
  const arc = (z) =>
    Array.from({ length: n + 1 }, (_, i) => P(...ring(r, HL.lerp(from, to, i / n), z)));
  const [top, base] = [arc(HEIGHT), arc(0)];
  let sil = HL.open(base) + HL.open(top);
  // A sliver at the turn draws only its true end.
  const fold = near && Math.abs(base[0][0] - base[n][0]) > 3;
  if (!cutFrom || fold) sil += HL.seg(base[0], top[0]);
  if (!cutTo || fold) sil += HL.seg(base[n], top[n]);
  return { face: HL.poly(base.concat(top.reverse())), sil };
}

function layer(svg) {
  const g = HL.mk('g', {}, svg);
  const [face, sil] = ['fo', 'nf sil'].map((c) => HL.mk('path', { class: c }, g));
  return { g, face, sil };
}

function drawRing(state, index, head) {
  const parts = arcs(RINGS[index], phase(head, turnSlot(index))).flatMap(halves);
  for (const near of [false, true]) {
    const walls = parts
      .filter((part) => part.near === near)
      .map((part) => wall(state.P, RINGS[index][0], part));
    const el = state.layers[index][near ? 1 : 0];
    for (const key of ['face', 'sil']) el[key].setAttribute('d', walls.map((w) => w[key]).join(''));
  }
}

function drawBlock(state, head) {
  const r = HL.lerp(START, DOCK, phase(head, SLIDE));
  const [x, y] = ring(r, AIM, 0);
  const at = (u, v, z) => state.P(u + x, v + y, z);
  HL.put(
    state.block,
    HL.prism(at, state.front, state.blockRing, state.blockInner, 0, BLOCK_HEIGHT),
  );
  // The block paints after the near walls of every ring it is inside.
  const near = state.layers.filter((_, i) => RINGS[i][0] < r).map((l) => l[1].g);
  const after = near.length ? near[near.length - 1] : state.core.g;
  if (state.block.g.previousSibling !== after) after.after(state.block.g);
  state.docked = head === 1;
  state.block.sil.classList.toggle('hi', state.docked);
  state.core.sil.classList.toggle('hi', !state.docked);
}

// The play head runs forward while active and back while not, so a leave mid-play
// reverses from where it is; each part eases within its own slot of the play.
function tick(state, dt) {
  const target = state.active ? 1 : 0;
  const step = HL.reducedMotion() ? 1 : (dt * 1000) / state.duration;
  const head =
    target > state.head ? Math.min(1, state.head + step) : Math.max(0, state.head - step);
  if (head !== state.head || state.drawn !== head) {
    state.head = state.drawn = head;
    for (let i = 0; i < RINGS.length; i++) drawRing(state, i, head);
    drawBlock(state, head);
  }
  state.read.textContent = state.docked ? 'allowed' : head > 0 ? 'aligning' : 'rest';
  return head !== target;
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  state.loop.wake();
}

function turned(sample) {
  const [c, s] = [Math.cos(HL.rad(AIM)), Math.sin(HL.rad(AIM))];
  const { u, v, nu, nv } = sample;
  return { u: u * c - v * s, v: u * s + v * c, nu: nu * c - nv * s, nv: nu * s + nv * c };
}

function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 3.25);
  const outer = RINGS[RINGS.length - 1][0];
  const bounds = [];
  for (let a = 0; a < 360; a += 15) bounds.push(ring(outer, a, 0), ring(outer, a, HEIGHT));
  const blockRing = HL.rrect(-BLOCK, -BLOCK, BLOCK, BLOCK, 1.2).map(turned);
  const [sx, sy] = ring(START, AIM, 0);
  for (const z of [0, BLOCK_HEIGHT]) bounds.push(...blockRing.map((q) => [q.u + sx, q.v + sy, z]));
  // Centred a little low: the block at rest hangs below the rings, docked it does not.
  HL.fit(C, bounds, 200, 164);
  const P = HL.proj(C);
  // Construction first (rule 06): the channel's line, and where the block docks.
  const [dx, dy] = ring(DOCK, AIM, 0);
  let guides = HL.seg(P(...ring(outer + 22, AIM + 180, 0)), P(...ring(START + BLOCK + 6, AIM, 0)));
  guides += HL.poly(blockRing.map((q) => P(q.u + dx, q.v + dy, 0)));
  HL.mk('path', { d: guides, class: 'nf lo dash' }, svg);
  // Far halves from the outside in, the core, then near halves from the inside out.
  const layers = RINGS.map(() => [null, null]);
  for (let i = RINGS.length - 1; i >= 0; i--) layers[i][0] = layer(svg);
  const core = HL.solid(svg);
  const front = HL.facing(C);
  HL.put(core, HL.prism(P, front, HL.circ(CORE, 32), HL.circ(CORE - 0.8, 32), 0, CORE_HEIGHT));
  for (let i = 0; i < RINGS.length; i++) layers[i][1] = layer(svg);
  const block = HL.solid(svg);
  const blockInner = HL.rrect(0.8 - BLOCK, 0.8 - BLOCK, BLOCK - 0.8, BLOCK - 0.8, 0.6).map(turned);
  const state = { P, read, layers, core, block, front, blockRing, blockInner, duration };
  Object.assign(state, { head: 0, drawn: NaN, active: false, docked: false, loop: null });
  state.loop = HL.register(stage, tick.bind(null, state));
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  // Where the pointer is does not matter: any point plays, leaving plays back.
  const pointer = { move: select.bind(null, state, true), leave: select.bind(null, state, false) };
  bag.add(HL.pointer(stage, pointer));
  bag.add(svg.replaceChildren.bind(svg));
  const set = (value) => ((state.duration = value), state.loop.wake());
  return { set, destroy: bag.dispose };
}

hairline({
  name: 'maze-interlock',
  means:
    'Three ring walls with gaps round a core. Hover: they turn into line and a block slides in.',
  rules: [2, 4, 5, 6],
  range: [1900, 1500, 1200],
  mount,
});
