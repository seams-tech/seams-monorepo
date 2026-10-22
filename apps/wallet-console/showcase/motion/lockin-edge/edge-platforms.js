/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// "No lock-in" as flat geometry on one module: two square platforms whose open
// sides face each other, and a ring set lifted off the first. Hover traces its
// path in dashes, then in a solid line, then the rings travel the path and
// settle on the second platform; the solid line gives way behind them.
const UNIT = 6;
const HALF = 5 * UNIT;
const SOCKET = 3.5 * UNIT;
const GAP = 2 * UNIT;
const APART = 7 * UNIT;
const LIFT = 6 * UNIT;
const ARC = 2 * UNIT;
const CORNER = 1.5;
const RINGS = [3, 2.25, 1.5, 0.75].map((step) => step * UNIT);
// The rings share their point nearest the viewer, as the phones' rings do.
const SHARED = [Math.SQRT1_2, Math.SQRT1_2];
// Phases as fractions of the tween: dashed trace, solid trace, travel.
const TRACE = [0, 0.22];
const SOLID = [0.25, 0.45];
const MOVE = [0.5, 0.96];
const MOVE_EASE = HL.bezier(0.65, 0, 0.35, 1);

function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((fraction) => HL.EASE_LIFT(fraction));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

function quarter(cx, cy, from) {
  return Array.from({ length: 5 }, (_, i) => {
    const a = HL.rad(from + (90 * i) / 4);
    return [cx + CORNER * Math.cos(a), cy + CORNER * Math.sin(a)];
  });
}

// A square outline open at x = HALF for |y| < GAP, in platform coordinates.
const c = HALF - CORNER;
const OUTLINE = [
  [HALF, GAP],
  ...quarter(c, c, 0),
  ...quarter(-c, c, 90),
  ...quarter(-c, -c, 180),
  ...quarter(c, -c, 270),
  [HALF, -GAP],
];
const SOCKET_RING = HL.rrect(-SOCKET, -SOCKET, SOCKET, SOCKET, CORNER, 4).map((p) => [p.u, p.v]);

// The ring set lies level at height z, centred on (x, 0).
function rings(P, x, z) {
  return RINGS.map((radius) => {
    const [ox, oy] = SHARED.map((d) => d * (RINGS[0] - radius));
    return Array.from({ length: 64 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2;
      return P(x + ox + radius * Math.cos(a), oy + radius * Math.sin(a), z);
    });
  });
}

// The travel path: from above platform A's centre, over the gap, down to B's.
function along(u) {
  const z = (1 - u) * (1 - u) * LIFT + 2 * u * (1 - u) * (LIFT + ARC);
  return [HL.lerp(-APART, APART, u), 0, z];
}

function pathBetween(P, from, to) {
  if (to - from < 1e-3) return '';
  const steps = Math.max(2, Math.ceil((to - from) * 48));
  return HL.open(
    Array.from({ length: steps + 1 }, (_, i) => P(...along(HL.lerp(from, to, i / steps)))),
  );
}

function draw(state, t) {
  const { P } = state;
  const solid = phase(t, SOLID);
  const move = MOVE_EASE(phase(t, MOVE));
  state.dashed.setAttribute('d', pathBetween(P, 0, phase(t, TRACE)));
  state.solid.setAttribute('d', solid > 0 ? pathBetween(P, move, solid) : '');
  const [x, , z] = along(move);
  state.drop.setAttribute('d', z > 0.5 ? HL.seg(P(x, 0, z), P(x, 0, 0)) : '');
  const [outer, ...inner] = rings(P, x, z);
  state.face.setAttribute('d', HL.poly(outer));
  state.rings.setAttribute('d', inner.map((ring) => HL.poly(ring)).join(''));
  state.moved = move === 1;
}

function tick(state, _dt, now) {
  const t = HL.tval(state.motion, now);
  if (t !== state.drawn) {
    state.drawn = t;
    draw(state, t);
  }
  state.read.textContent = state.moved ? 'moved' : state.active && t > 0 ? 'leaving' : 'rest';
  return !HL.tdone(state.motion, now);
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

// The slider sets how long the whole move takes, from where it is now.
function set(state, duration) {
  const now = performance.now();
  state.motion = HL.tween(HL.tval(state.motion, now), duration);
  HL.tset(state.motion, Number(state.active), now, 0);
  state.loop.wake();
}

function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 1.88);
  const bounds = [];
  for (const x of [-APART - HALF, APART + HALF])
    for (const y of [-HALF, HALF]) bounds.push([x, y, 0]);
  bounds.push([-APART, 0, LIFT + ARC]);
  HL.fit(C, bounds, 200, 160);
  const P = HL.proj(C);
  // Construction first (rule 06): the line of travel through both openings.
  const axis = HL.seg(P(-APART - HALF - UNIT, 0, 0), P(APART + HALF + UNIT, 0, 0));
  HL.mk('path', { d: axis, class: 'nf lo dash' }, svg);
  // Platform A opens towards +x; platform B, its mirror, towards -x.
  for (const side of [-1, 1]) {
    const place = ([px, py]) => P(side * (APART - px), py, 0);
    HL.mk('path', { d: HL.open(OUTLINE.map(place)), class: 'nf sil' }, svg);
    HL.mk('path', { d: HL.poly(SOCKET_RING.map(place)), class: 'nf lo' }, svg);
  }
  const state = { P, read, motion: HL.tween(0, duration), drawn: NaN, active: false };
  state.drop = HL.mk('path', { class: 'nf lo dash' }, svg);
  state.dashed = HL.mk('path', { class: 'nf lo dash' }, svg);
  state.solid = HL.mk('path', { class: 'nf sil' }, svg);
  state.face = HL.mk('path', { class: 'sil hi' }, svg);
  state.rings = HL.mk('path', { class: 'nf lo' }, svg);
  Object.assign(state, { moved: false, loop: null });
  state.loop = HL.register(stage, tick.bind(null, state));
  draw(state, 0);
  state.read.textContent = 'rest';
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const pointer = { move: select.bind(null, state, true), leave: select.bind(null, state, false) };
  bag.add(HL.pointer(stage, pointer));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'edge-platforms',
  means:
    'Two open platforms and a ring set. Hover to trace its path and move it from one to the other.',
  rules: [4, 5, 6, 8],
  range: [2600, 2000, 1500],
  mount,
});
