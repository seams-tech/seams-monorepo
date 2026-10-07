/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
const TOP = 64;
const BOTTOM = 58;
const CELLS = [
  { x: -47, y: -26, kind: 0, fits: false },
  { x: 0, y: -26, kind: 1, fits: false },
  { x: 47, y: -26, kind: 2, fits: false },
  { x: -47, y: 27, kind: 0, fits: true },
  { x: 0, y: 27, kind: 1, fits: true },
  { x: 47, y: 27, kind: 2, fits: true },
];

function offset(cell, point) {
  return { ...point, u: point.u + cell.x, v: point.v + cell.y };
}

function roundedSample(point) {
  return { u: point[0], v: point[1], nu: point[0], nv: point[1] };
}

function vertex(point) {
  return [point.u, point.v];
}

function shape(cell, radius) {
  let ring = HL.circ(radius, cell.kind === 1 ? 6 : 64);
  if (cell.kind === 1) ring = HL.fillet(ring.map(vertex), Array(6).fill(1.4), 5).map(roundedSample);
  if (cell.kind === 0) ring = HL.rrect(-radius, -radius, radius, radius, 3, 8);
  return ring.map(offset.bind(null, cell));
}

function path(parent, d, classes, attrs = {}) {
  return HL.mk('path', { d, class: classes, ...attrs }, parent);
}

function slab(parent, P, front, ring, inner, low, high) {
  HL.put(HL.solid(parent), HL.prism(P, front, ring, inner, low, high));
}

function posts(svg, P, front, y) {
  for (const x of [-72, 72]) {
    const ring = HL.rrect(x - 3, y - 3, x + 3, y + 3, 2, 8);
    slab(svg, P, front, ring, ring, 5, BOTTOM);
  }
}

function side(a, b, p) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

function intersection(subject, boundary) {
  let result = subject;
  for (let edge = 0; edge < boundary.length; edge++) {
    const a = boundary[edge];
    const b = boundary[(edge + 1) % boundary.length];
    const input = result;
    result = [];
    for (let index = 0; index < input.length; index++) {
      const p = input[index];
      const q = input[(index + 1) % input.length];
      const dp = side(a, b, p);
      const dq = side(a, b, q);
      if (dp >= 0) result.push(p);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        result.push([HL.lerp(p[0], q[0], t), HL.lerp(p[1], q[1], t)]);
      }
    }
  }
  return result;
}

function plate(svg, P) {
  const outer = HL.rrect(-78, -55, 78, 55, 8, 10);
  const top = HL.ringAt(P, outer, TOP);
  const bottom = HL.ringAt(P, outer, BOTTOM);
  let openings = '';
  let edges = '';
  for (const cell of CELLS) {
    const upper = HL.ringAt(P, shape(cell, 15), TOP);
    const lower = HL.ringAt(P, shape(cell, 15), BOTTOM);
    openings += HL.poly(intersection(upper, lower));
    edges += HL.poly(upper) + HL.poly(HL.ringAt(P, shape(cell, 16.4), TOP));
  }
  path(svg, HL.poly(HL.hull(top.concat(bottom))) + openings, 'sil', { 'fill-rule': 'evenodd' });
  path(svg, HL.poly(top) + edges, 'nf lo');
  for (const x of [-70, 70]) {
    for (const y of [-47, 47]) {
      const screw = HL.circ(2.4, 24).map(offset.bind(null, { x, y }));
      path(svg, HL.poly(HL.ringAt(P, screw, TOP)), 'nf lo');
      path(svg, HL.seg(P(x - 1, y - 1, TOP), P(x + 1, y + 1, TOP)), 'nf lo');
    }
  }
}

function makePiece(svg, below, cell, index) {
  const radius = cell.fits ? 12 : 19;
  return {
    ...cell,
    index,
    ring: shape(cell, radius),
    inner: shape(cell, radius - 1.2),
    lower: HL.solid(below),
    upper: HL.solid(svg),
    height: HL.tween(TOP + 17 + (index % 3) * 5),
    drawn: NaN,
  };
}

function portion(solid, state, piece, low, high) {
  const visible = high > low;
  solid.g.setAttribute('display', visible ? 'inline' : 'none');
  if (visible) HL.put(solid, HL.prism(state.P, state.front, piece.ring, piece.inner, low, high));
}

function tick(state, _dt, now) {
  let moving = false;
  for (const piece of state.pieces) {
    const base = HL.tval(piece.height, now);
    if (base !== piece.drawn) {
      portion(piece.lower, state, piece, base, Math.min(base + 9, TOP));
      portion(piece.upper, state, piece, Math.max(base, TOP), base + 9);
      piece.drawn = base;
    }
    if (!HL.tdone(piece.height, now)) moving = true;
  }
  return moving;
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  const now = performance.now();
  for (const piece of state.pieces) {
    const rest = TOP + 17 + (piece.index % 3) * 5;
    const landing = piece.fits ? 5 : TOP;
    const delay = Math.abs((piece.index % 3) - 1) * state.stagger;
    HL.tset(piece.height, active ? landing : rest, now, delay);
    const highlight = piece.index === (active ? 4 : 1);
    piece.lower.sil.classList.toggle('hi', highlight);
    piece.upper.sil.classList.toggle('hi', highlight);
  }
  state.read.textContent = active ? '3 pass · 3 held' : 'rest';
  state.loop.wake();
}

function move(state, point) {
  const [x, y] = HL.unproj(state.C, point[0], point[1], TOP);
  select(state, Math.abs(x) < 90 && y > -102 && y < 75);
}

function set(state, stagger) {
  state.stagger = stagger;
}

function mount({ stage, svg, read }, stagger) {
  const C = HL.Cam(45, 0.5, 1.35);
  const bounds = [
    [-82, -59, 0],
    [82, 59, 0],
    [-70, -48, 104],
    [70, 48, 104],
  ];
  HL.fit(C, bounds, 200, 166);
  const P = HL.proj(C);
  const front = HL.facing(C);
  const outer = HL.rrect(-78, -55, 78, 55, 8, 10);
  const inner = HL.rrect(-73, -50, 73, 50, 5, 10);
  slab(svg, P, front, outer, inner, 0, 5);
  path(svg, HL.poly(HL.ringAt(P, HL.rrect(-68, -45, 68, 45, 4, 8), 5.1)), 'nf lo');
  posts(svg, P, front, -45);
  const below = HL.mk('g', {}, svg);
  posts(svg, P, front, 45);
  plate(svg, P);
  const pieces = [];
  for (const [index, cell] of CELLS.entries()) pieces.push(makePiece(svg, below, cell, index));
  const state = { C, P, front, pieces, read, stagger, active: null, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  select(state, false);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const leave = select.bind(null, state, false);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'precision-sieve',
  means: 'Hover to sift: matching pieces pass through; oversized pieces stay on the plate.',
  rules: [1, 2, 4, 6, 8, 9],
  range: [30, 55, 80],
  mount,
});
