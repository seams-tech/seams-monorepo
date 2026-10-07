/* @license MIT License — Copyright (c) 2026 Lucas Marques Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const PLANES = [-12, 30, 83, 136, 210];
const RADII = [12, 7, 3.8, 2];
const GRADES = [3, 0, 0, 1, 2, 1, 1, 3, 2, 3, 2, 3, 2, 3, 3, 3];
const POSTS = [
  { x: -57, y: -20 },
  { x: 20, y: -57 },
  { x: -20, y: 57 },
  { x: 57, y: 20 },
];
function offset(cell, scale, point) {
  const u = cell.x + point.u * scale + (1 - scale) * Math.hypot(point.nu, point.nv) * 0.3;
  return { ...point, u, v: cell.y + point.v * scale };
}
function sample(point) {
  return { u: point[0], v: point[1], nu: point[0], nv: point[1] };
}
function path(svg, d, classes, attrs = {}) {
  return HL.mk('path', { d, class: classes, ...attrs }, svg);
}
function slab(svg, P, front, ring, inner, low, high) {
  const solid = HL.solid(svg);
  HL.put(solid, HL.prism(P, front, ring, inner, low, high));
  return solid;
}
function grain(index) {
  const grade = GRADES[index];
  const radius = RADII[grade];
  const outline = [];
  for (let i = 0; i < 7; i++) {
    const angle = (i * Math.PI * 2) / 7 + index;
    const r = radius * (0.84 + 0.16 * Math.sin(i * 2.7 + index));
    outline.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  const profile = HL.fillet(outline, Array(7).fill(radius * 0.08), 3).map(sample);
  const x = ((index % 4) * 2 - 3) * 11;
  const y = (Math.floor(index / 4) * 2 - 3) * 11;
  const rest = 152 + ((index * 7) % 5) * 4;
  const motion = HL.tween(0, 1700);
  return { index, grade, radius, profile, x, y, rest, motion, chunks: [], drawn: NaN };
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
      const ring = HL.circ(radius, 32).map(offset.bind(null, { x, y }, 1));
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
    const rod = HL.circ(1.5, 20).map(offset.bind(null, post, 1));
    const nut = HL.circ(3.1, 6).map(offset.bind(null, post, 1));
    slab(svg, P, front, rod, rod, low, Math.min(high, 141));
    slab(svg, P, front, nut, nut, low, low + 2.8);
  }
}
function portion(state, piece, chunk, base) {
  const height = piece.radius * 0.55;
  const low = Math.max(base, chunk.low);
  const high = Math.min(base + height, chunk.high);
  chunk.solid.g.setAttribute('display', high > low ? 'inline' : 'none');
  if (high <= low) return;
  const bottom = piece.profile.map(offset.bind(null, piece, 1 - (0.75 * (low - base)) / height));
  const top = piece.profile.map(offset.bind(null, piece, 1 - (0.75 * (high - base)) / height));
  const bottomPoints = HL.ringAt(state.P, bottom, low);
  const topPoints = HL.ringAt(state.P, top, high);
  const front = HL.run(top, state.front);
  const corner = top.indexOf(front[Math.floor(front.length / 2)]);
  let crease = high === base + height ? HL.open(HL.ringAt(state.P, front, high)) : '';
  if (high === base + height) crease += HL.seg(topPoints[corner], bottomPoints[corner]);
  HL.put(chunk.solid, { sil: HL.poly(HL.hull(bottomPoints.concat(topPoints))), crease });
}
function tick(state, _dt, now) {
  let moving = false;
  for (const piece of state.pieces) {
    const progress = Math.min(HL.tval(piece.motion, now), piece.grade + 1);
    const step = Math.min(3, Math.floor(progress));
    const stops = [piece.rest, 136, 83, 30, -12];
    const base = HL.lerp(
      stops[step],
      stops[step + 1],
      HL.clamp((progress - step - 0.1) / 0.8, 0, 1),
    );
    for (const chunk of piece.chunks) {
      if (base !== piece.drawn) portion(state, piece, chunk, base);
      const bright = piece.index === (state.active ? 15 : 2) && base > -12;
      chunk.solid.sil.classList.toggle('hi', bright);
    }
    if (piece.index === 15)
      state.collector.sil.classList.toggle('hi', state.active && base === -12);
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
    for (const chunk of piece.chunks)
      chunk.solid.sil.classList.toggle('hi', piece.index === (active ? 15 : 2));
  }
  state.collector.sil.classList.remove('hi');
  state.read.textContent = active ? '3 grades · fines' : 'rest';
  state.loop.wake();
}
function set(state, stagger) {
  state.stagger = stagger;
}
function mount({ stage, svg, read }, stagger) {
  const C = HL.Cam(45, 0.5, 1.35);
  const bounds = [
    [-48, 48, 2],
    [48, -48, 2],
    [48, 48, -17],
    [-33, -33, 176],
  ];
  HL.fit(C, bounds, 200, 166);
  const P = HL.proj(C);
  const front = HL.facing(C);
  const collector = slab(svg, P, front, HL.circ(68, 96), HL.circ(64, 96), -17, -12);
  path(svg, HL.poly(HL.ringAt(P, HL.circ(57, 96), -12)), 'nf lo');
  const pieces = [];
  for (let i = 0; i < 16; i++) if (![0, 4, 10, 14].includes(i)) pieces.push(grain(i));
  pieces.sort(depth);
  for (let band = 0; band < 4; band++) {
    const low = PLANES[band];
    const high = PLANES[band + 1];
    posts(svg, P, front, low, high, false);
    for (const piece of pieces) piece.chunks.push({ solid: HL.solid(svg), low, high });
    posts(svg, P, front, low, high, true);
    if (band < 3) screen(svg, P, high, [2.4, 4.6, 9][band], band === 2 ? 22 : 11);
  }
  const state = { P, front, pieces, collector, read, stagger, active: null, loop: null };
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
  means: 'Hover to sift: three screens retain larger grains while fines reach the collector.',
  rules: [1, 2, 4, 6, 7, 8, 9],
  range: [30, 60, 90],
  mount,
});
