/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// The interlock as crisp planes on one module, U = 4 units: three disks with
// square keyways on a dashed axle. Hover turns the keyways into line, traces the
// alignment axis along their tops, then a flat blade traces itself in dashes and
// in a solid line and drops in: its top on that axis, its ends past the disks.
const U = 4;
const AXIS = 11 * U;
const RADIUS = 8 * U;
const HOLE_RADIUS = U;
const SLOT_HALF = U / 2;
const SLOT_FLOOR = 5 * U;
const BLADE_HEIGHT = RADIUS - SLOT_FLOOR;
const DISK_X = [-10.5 * U, -3.5 * U, 3.5 * U];
const REST = [-135, 105, -165];
const BLADE_FROM = DISK_X[0] - 1.5 * U;
const BLADE_TO = DISK_X[2] + 1.5 * U;
const AXLE = [BLADE_FROM - 5 * U, BLADE_TO + 5 * U];
const BLADE_UP = AXIS + RADIUS + U / 2;
const BLADE_DOWN = AXIS + SLOT_FLOOR;
const TURN_MS = 700;
const SEQ_MS = 3200;
// Phases of the one sequence tween in ms, after the disks' staggered turns:
// the alignment axis, the blade's dashed trace, its solid trace, the drop.
const ALIGN = [850, 1250];
const TRACE = [1300, 1800];
const SOLID = [1850, 2350];
const DROP = [2450, 3200];

function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / SEQ_MS));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

function arc(radius, start, end, steps) {
  const angles = Array.from({ length: steps + 1 }, (_, step) => HL.lerp(start, end, step / steps));
  return angles.map((angle) => [radius * Math.sin(angle), radius * Math.cos(angle)]);
}
const OPEN = Math.asin(SLOT_HALF / RADIUS);
const DISK = arc(RADIUS, OPEN, Math.PI * 2 - OPEN, 96).concat([
  [-SLOT_HALF, SLOT_FLOOR],
  [SLOT_HALF, SLOT_FLOOR],
]);
const HOLE = arc(HOLE_RADIUS, 0, Math.PI * 2, 32).slice(0, -1);

function project(P, x, angle, point) {
  const a = HL.rad(angle);
  const y = point[0] * Math.cos(a) + point[1] * Math.sin(a);
  const z = point[1] * Math.cos(a) - point[0] * Math.sin(a);
  return P(x, y, AXIS + z);
}

// A polyline of [x, z] points in the blade's plane, y = 0, as far as part of
// its length.
function trace(P, xs, zs, part) {
  const lengths = xs.slice(1).map((x, i) => Math.abs(x - xs[i]) + Math.abs(zs[i + 1] - zs[i]));
  let left = part * lengths.reduce((sum, length) => sum + length, 0);
  const points = [P(xs[0], 0, zs[0])];
  for (let i = 1; i < xs.length && left > 0; i++) {
    const t = Math.min(1, left / lengths[i - 1]);
    points.push(P(HL.lerp(xs[i - 1], xs[i], t), 0, HL.lerp(zs[i - 1], zs[i], t)));
    left -= lengths[i - 1];
  }
  return part > 0 ? HL.open(points) : '';
}

function bladeOutline(P, part) {
  const [a, b, z, top] = [BLADE_FROM, BLADE_TO, BLADE_UP, BLADE_UP + BLADE_HEIGHT];
  return trace(P, [a, b, b, a, a], [z, z, top, top, z], part);
}

// One blade section from x0 to x1, base at z. Only the blade's true ends draw
// edges, so the disks divide it with no seams.
function makeBlade(svg, P, x0, x1, edges) {
  const face = HL.mk('path', { class: 'fo' }, svg);
  const edge = HL.mk('path', { class: 'nf sil' }, svg);
  edges.push(edge);
  return (z) => {
    if (z === null) return [face, edge].forEach((el) => el.setAttribute('d', ''));
    const top = z + BLADE_HEIGHT;
    face.setAttribute('d', HL.poly([P(x0, 0, z), P(x1, 0, z), P(x1, 0, top), P(x0, 0, top)]));
    let d = HL.seg(P(x0, 0, z), P(x1, 0, z)) + HL.seg(P(x0, 0, top), P(x1, 0, top));
    if (x0 === BLADE_FROM) d += HL.seg(P(x0, 0, z), P(x0, 0, top));
    if (x1 === BLADE_TO) d += HL.seg(P(x1, 0, z), P(x1, 0, top));
    edge.setAttribute('d', d);
  };
}

function tick(state, _dt, now) {
  const progress = HL.tval(state.sequence, now);
  if (progress !== state.drawn) {
    state.drawn = progress;
    for (const [index, disk] of state.disks.entries()) {
      const start = (DISK_X.length - 1 - index) * state.step;
      const turn = HL.EASE_LIFT(phase(progress, [start, start + TURN_MS]));
      const at = project.bind(null, state.P, disk.x, HL.lerp(REST[index], 0, turn));
      disk.face.setAttribute('d', HL.poly(DISK.map(at)) + HL.poly(HOLE.map(at)));
    }
    const top = AXIS + RADIUS;
    state.align.setAttribute('d', trace(state.P, AXLE, [top, top], phase(progress, ALIGN)));
    const solid = phase(progress, SOLID);
    const z = HL.lerp(BLADE_UP, BLADE_DOWN, phase(progress, DROP));
    const above = z >= AXIS + RADIUS;
    for (const draw of state.blades) draw(above ? null : z);
    state.whole(above && solid === 1 ? z : null);
    state.dashed.setAttribute('d', solid < 1 ? bladeOutline(state.P, phase(progress, TRACE)) : '');
    state.solid.setAttribute('d', solid < 1 ? bladeOutline(state.P, solid) : '');
    // The accent moves from the front disk to the blade once its solid line starts.
    state.disks[DISK_X.length - 1].face.classList.toggle('hi', solid === 0);
    for (const edge of state.edges) edge.classList.toggle('hi', solid > 0);
  }
  state.read.textContent = progress === 1 ? 'unlocked' : state.active ? 'aligning' : 'rest';
  return !HL.tdone(state.sequence, now);
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.sequence, active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
}

function set(state, step) {
  state.step = step;
  state.drawn = NaN;
  state.loop.wake();
}

function mount({ stage, svg, read }, step) {
  const C = HL.Cam(45, 0.5, 2.48);
  const top = BLADE_UP + BLADE_HEIGHT;
  const [left, right] = [BLADE_FROM - 2 * U, BLADE_TO + 2 * U];
  const bounds = [
    [left, -RADIUS, AXIS - RADIUS],
    [left, RADIUS, top],
    [right, -RADIUS, top],
    [right, RADIUS, AXIS - RADIUS],
  ];
  HL.fit(C, bounds, 200, 178);
  const P = HL.proj(C);
  const align = HL.mk('path', { class: 'nf lo dash' }, svg);
  const [disks, blades, edges] = [[], [], []];
  const stops = [AXLE[0], ...DISK_X, AXLE[1]];
  for (let index = 0; index < stops.length - 1; index++) {
    const [from, to] = [stops[index], stops[index + 1]];
    HL.mk('path', { d: HL.seg(P(from, 0, AXIS), P(to, 0, AXIS)), class: 'nf lo dash' }, svg);
    const [bladeFrom, bladeTo] = [Math.max(from, BLADE_FROM), Math.min(to, BLADE_TO)];
    if (bladeFrom < bladeTo) blades.push(makeBlade(svg, P, bladeFrom, bladeTo, edges));
    if (index < DISK_X.length) {
      disks.push({ x: to, face: HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, svg) });
    }
  }
  const whole = makeBlade(svg, P, BLADE_FROM, BLADE_TO, edges);
  const dashed = HL.mk('path', { class: 'nf lo dash' }, svg);
  const solid = HL.mk('path', { class: 'nf sil' }, svg);
  edges.push(solid);
  const state = { P, read, disks, blades, whole, align, dashed, solid, edges, step };
  Object.assign(state, { sequence: HL.tween(0, SEQ_MS), drawn: NaN, active: false, loop: null });
  state.loop = HL.register(stage, tick.bind(null, state));
  state.loop.wake();
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(
    HL.pointer(stage, { move: () => select(state, true), leave: () => select(state, false) }),
  );
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'edge-interlock',
  means:
    'Three keyed disks on one axle. Hover to align the keyways; an axis and a blade trace in and the blade drops.',
  rules: [2, 4, 6, 8],
  range: [30, 45, 60],
  mount,
});
