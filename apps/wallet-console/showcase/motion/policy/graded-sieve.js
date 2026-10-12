/* @license MIT License — Copyright (c) 2026 Lucas Marques Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const PLANES = [-12, 30, 83, 136, 210];
const RADII = [10.5, 7, 3.8, 2];
const GRADES = [3, 0, 0, 1, 2, 1, 1, 3, 2, 3, 2, 3, 2, 3, 3, 3];
const POSTS = [
  { x: -57, y: -20 },
  { x: 20, y: -57 },
  { x: -20, y: 57 },
  { x: 57, y: 20 },
];
function offset(cell, point) {
  return { ...point, u: cell.x + point.u, v: cell.y + point.v };
}
function path(svg, d, classes, attrs = {}) {
  return HL.mk('path', { d, class: classes, ...attrs }, svg);
}
function slab(svg, P, front, ring, inner, low, high) {
  const solid = HL.solid(svg);
  HL.put(solid, HL.prism(P, front, ring, inner, low, high));
  return solid;
}
function token(index) {
  const grade = GRADES[index];
  const radius = RADII[grade];
  const ring = HL.circ(radius, 48);
  const x = ((index % 4) * 2 - 3) * 11;
  const y = (Math.floor(index / 4) * 2 - 3) * 11;
  const rest = 152 + ((index * 7) % 5) * 4;
  const motion = HL.tween(0, 3500);
  return { index, grade, radius, ring, x, y, rest, motion, chunks: [], drawn: NaN };
}
function depth(a, b) {
  return a.x + a.y - b.x - b.y;
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
function screen(svg, P, z, radius, step) {
  const outer = HL.circ(65, 96);
  const rimTop = HL.ringAt(P, outer, z);
  const rimBottom = HL.ringAt(P, outer, z - 5);
  const inner = HL.circ(58, 96);
  const cavity = intersection(HL.ringAt(P, inner, z), HL.ringAt(P, inner, z - 5));
  path(svg, HL.poly(HL.hull(rimTop.concat(rimBottom))) + HL.poly(cavity), 'sil', {
    'fill-rule': 'evenodd',
  });
  path(svg, HL.poly(HL.ringAt(P, HL.circ(64, 96), z)), 'nf lo');
  let holes = '';
  let edges = '';
  for (let x = -44; x <= 44; x += 11) {
    for (let y = -44; y <= 44; y += 11) {
      if (Math.hypot(x, y) > 51 || (step === 22 && (x % 22 === 0 || y % 22 === 0))) continue;
      const ring = HL.circ(radius, 32).map(offset.bind(null, { x, y }));
      const top = HL.ringAt(P, ring, z);
      holes += HL.poly(intersection(top, HL.ringAt(P, ring, z - 0.8)));
      edges += HL.poly(top);
    }
  }
  path(svg, HL.poly(HL.ringAt(P, HL.circ(60, 96), z)) + holes, 'lo', { 'fill-rule': 'evenodd' });
  path(svg, edges, 'nf lo');
}
function posts(svg, P, front, low, high, near) {
  for (const post of POSTS) {
    if (post.x + post.y > 0 !== near) continue;
    const rod = HL.circ(1.5, 20).map(offset.bind(null, post));
    const nut = HL.circ(3.1, 6).map(offset.bind(null, post));
    slab(svg, P, front, rod, rod, low, Math.min(high, 141));
    slab(svg, P, front, nut, nut, low, low + 2.8);
  }
}
function tokenPoint(P, piece, base, height, scale, point) {
  const tilt = ((piece.index % 3) - 1) * 0.1 * HL.clamp((base - 136) / 16, 0, 1);
  const z = base + height + piece.radius * Math.abs(tilt) + point.u * scale * tilt;
  return P(piece.x + point.u * scale, piece.y + point.v * scale, z);
}
function portion(state, piece, chunk, base) {
  const thickness = piece.radius * 0.3;
  const low = Math.max(base, chunk.low) - base;
  const high = Math.min(base + thickness, chunk.high) - base;
  chunk.solid.g.setAttribute('display', high > low ? 'inline' : 'none');
  if (high <= low) return;
  const points = [];
  for (const h of [low, HL.clamp(thickness * 0.7, low, high), high]) {
    const scale = 1 - 0.1 * HL.clamp((h / thickness - 0.7) / 0.3, 0, 1);
    const project = tokenPoint.bind(null, state.P, piece, base, h, scale);
    points.push(...piece.ring.map(project));
  }
  let crease = '';
  if (chunk.high >= base + thickness) {
    crease = HL.poly(piece.ring.map(tokenPoint.bind(null, state.P, piece, base, high, 0.9)));
    if (piece.radius > 3)
      crease += HL.poly(piece.ring.map(tokenPoint.bind(null, state.P, piece, base, high, 0.72)));
  }
  chunk.outline = HL.hull(points);
  chunk.outline.push(chunk.outline[0]);
  HL.put(chunk.solid, { sil: HL.poly(chunk.outline), crease });
}
function tick(state, _dt, now) {
  let moving = false;
  for (const piece of state.pieces) {
    const progress = HL.tval(piece.motion, now);
    const arrival = piece.grade + 0.5;
    const phase = progress - arrival;
    const terminal = PLANES[3 - piece.grade];
    const base = HL.lerp(piece.rest, terminal, HL.clamp(progress / arrival, 0, 1));
    const tracing = state.active && phase > 0 && phase < 0.5;
    for (const chunk of piece.chunks) {
      if (base !== piece.drawn) portion(state, piece, chunk, base);
      chunk.solid.sil.classList.toggle('hi', !state.active && piece.index === 2);
      const length = tracing ? Math.ceil(HL.clamp(phase / 0.4, 0, 1) * chunk.outline.length) : 0;
      if (length !== chunk.traced)
        chunk.trace.setAttribute('d', HL.open(chunk.outline.slice(0, length)));
      chunk.traced = length;
    }
    piece.drawn = base;
    if (!HL.tdone(piece.motion, now)) moving = true;
  }
  return moving;
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  for (const piece of state.pieces) {
    const delay = ((Math.abs(piece.x) + Math.abs(piece.y)) / 22) * state.stagger;
    HL.tset(piece.motion, active ? 4 : 0, performance.now(), delay);
  }
  state.read.textContent = active ? '3 grades · fines' : 'rest';
  state.loop.wake();
}
function set(state, stagger) {
  state.stagger = stagger;
}
function mount({ stage, svg, read }, stagger) {
  const C = HL.Cam(45, 0.5, 1.35);
  const bounds = [
    [48, 48, -17],
    [-33, -33, 176],
  ];
  HL.fit(C, bounds, 200, 166);
  const P = HL.proj(C);
  const front = HL.facing(C);
  slab(svg, P, front, HL.circ(68, 96), HL.circ(64, 96), -17, -12);
  path(svg, HL.poly(HL.ringAt(P, HL.circ(57, 96), -12)), 'nf lo');
  const pieces = [];
  for (let i = 0; i < 16; i++) if (![0, 4, 10, 14].includes(i)) pieces.push(token(i));
  pieces.sort(depth);
  for (let band = 0; band < 4; band++) {
    const low = PLANES[band];
    const high = PLANES[band + 1];
    posts(svg, P, front, low, high, false);
    for (const piece of pieces) {
      const solid = HL.solid(svg);
      const trace = path(solid.g, '', 'hi nf');
      piece.chunks.push({ solid, trace, low, high, outline: [], traced: 0 });
    }
    posts(svg, P, front, low, high, true);
    if (band < 3) screen(svg, P, high, [2.4, 4.6, 9][band], band === 2 ? 22 : 11);
  }
  const state = { P, pieces, read, stagger, active: null, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  select(state, false);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const move = select.bind(null, state, true);
  const leave = select.bind(null, state, false);
  bag.add(HL.pointer(stage, { move, leave }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}
hairline({
  name: 'graded-sieve',
  means: 'Hover to sift: each token falls to its final layer, then traces its rim.',
  rules: [1, 2, 4, 6, 7, 8, 9],
  range: [30, 60, 90],
  mount,
});
