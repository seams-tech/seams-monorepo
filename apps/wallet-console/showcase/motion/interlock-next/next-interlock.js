/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// Slotted wheels and a dial, out of line at rest; once aligned, a traced blade drops in.
const [AXIS, RADIUS, BLADE_HEIGHT] = [45, 31, 9.6];
const [SLOT_HALF, SLOT_FLOOR, HOLE_RADIUS] = [0.9, 21, 4.3]; // slits: the blade has no depth
const DISKS = [50, 140, -100];
const BOUNDS = [-56, -40, -12, 16, 46, 54];
const [BLADE_FROM, BLADE_TO] = [-46, 22];
const [BLADE_UP, BLADE_DOWN] = [AXIS + RADIUS + 1, AXIS + SLOT_FLOOR + 0.3];
const [TURN_MS, BLADE_MS] = [450, 1600];
// The blade tween's phases in ms: dashed trace, solid trace, then the drop.
const TRACE = [0, 450];
const SOLID = [500, 950];
const DROP = [1050, 1600];

function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / BLADE_MS));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

function arc(radius, start, end, steps) {
  const angles = Array.from({ length: steps + 1 }, (_, step) => HL.lerp(start, end, step / steps));
  return angles.map((angle) => [radius * Math.sin(angle), radius * Math.cos(angle)]);
}
const OPEN = Math.asin(SLOT_HALF / RADIUS);
const DISK = arc(RADIUS, OPEN, Math.PI * 2 - OPEN, 72).concat([
  [-SLOT_HALF, SLOT_FLOOR],
  [SLOT_HALF, SLOT_FLOOR],
]);
const HOLE = arc(HOLE_RADIUS, 0, Math.PI * 2, 24);
const HUB = arc(HOLE_RADIUS + 1.6, 0, Math.PI * 2, 24);
const DIAL = arc(16, 0, Math.PI * 2, 48);
// Wheel ticks inside the rim, long every quarter turn, none at the keyway (angle 0).
const wheel = (count, rim) =>
  Array.from({ length: count - 1 }, (_, i) => {
    const [t, r0] = [((i + 1) / count) * 2 * Math.PI, (i + 1) % (count / 4) ? rim - 3 : rim - 6];
    return [r0, rim - 1.5].map((r) => [r * Math.sin(t), r * Math.cos(t)]);
  });
// Back to front, finer on nearer disks; the dial carries the finest scale.
const TICKS = [4, 8, 16].map((count) => wheel(count, RADIUS)).concat([wheel(16, 16)]);

function project(P, x, angle, point) {
  const a = HL.rad(angle);
  const y = point[0] * Math.cos(a) + point[1] * Math.sin(a);
  const z = point[1] * Math.cos(a) - point[0] * Math.sin(a);
  return P(x, y, AXIS + z);
}

// A blade section from x0 to x1, base at z; only true ends draw edges, so no seams.
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

// The raised blade's outline from its far lower corner, as far as part of it.
function outline(P, part) {
  const [a, b, z, top] = [BLADE_FROM, BLADE_TO, BLADE_UP, BLADE_UP + BLADE_HEIGHT];
  const xs = [a, b, b, a, a];
  const zs = [z, z, top, top, z];
  let left = part * 2 * (b - a + BLADE_HEIGHT);
  const points = [P(a, 0, z)];
  for (let i = 1; i < xs.length && left > 0; i++) {
    const length = Math.abs(xs[i] - xs[i - 1]) + Math.abs(zs[i] - zs[i - 1]);
    const t = Math.min(1, left / length);
    points.push(P(HL.lerp(xs[i - 1], xs[i], t), 0, HL.lerp(zs[i - 1], zs[i], t)));
    left -= length;
  }
  return part > 0 ? HL.open(points) : '';
}

function makePlate(svg, P, x, angle, shape, ticks) {
  const face = HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, svg);
  const detail = HL.mk('path', { class: 'nf lo' }, svg);
  return { x, face, detail, shape, ticks, outline: [face], center: P(x, 0, AXIS)[0], angle };
}

function drawPlate(state, plate, angle) {
  if (angle === plate.drawn) return;
  plate.drawn = angle;
  const at = project.bind(null, state.P, plate.x, angle);
  plate.face.setAttribute('d', HL.poly(plate.shape.map(at)) + HL.poly(HOLE.map(at)));
  if (plate.mark) plate.mark.setAttribute('d', HL.seg(at([0, 8]), at([0, 13])));
  const ticks = plate.ticks.map(([a, b]) => HL.seg(at(a), at(b))).join('');
  plate.detail.setAttribute('d', ticks + (plate.mark ? '' : HL.poly(HUB.map(at)))); // no dial hub
}

function tick(state, _dt, now) {
  let moving = false;
  for (const disk of state.disks) {
    drawPlate(state, disk, HL.tval(disk.angle, now));
    if (!HL.tdone(disk.angle, now)) moving = true;
  }
  drawPlate(state, state.dial, HL.tval(state.disks[2].angle, now));
  const blade = HL.tval(state.pin, now);
  if (blade !== state.pinDrawn) {
    state.pinDrawn = blade;
    const [solid, z] = [phase(blade, SOLID), HL.lerp(BLADE_UP, BLADE_DOWN, phase(blade, DROP))];
    const above = z >= AXIS + RADIUS;
    for (const draw of state.blades) draw(above ? null : z);
    state.whole(above && solid === 1 ? z : null);
    state.dashed.setAttribute('d', solid < 1 ? outline(state.P, phase(blade, TRACE)) : '');
    state.solid.setAttribute('d', solid < 1 ? outline(state.P, solid) : '');
    state.bladeLit = state.active && solid > 0;
    if (state.bladeLit) highlight(state, state.bladeOutline);
  }
  if (!HL.tdone(state.pin, now)) moving = true;
  state.read.textContent = blade === 1 ? 'unlocked' : state.active ? 'aligning' : 'rest';
  return moving;
}

function highlight(state, outline) {
  for (const edge of state.highlight) edge.classList.remove('hi');
  for (const edge of outline) edge.classList.add('hi');
  state.highlight = outline;
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  const [now, last] = [performance.now(), DISKS.length - 1];
  for (const [index, disk] of state.disks.entries()) {
    const delay = (last - index) * state.step;
    HL.tset(disk.angle, active ? 0 : DISKS[index], now, active ? delay : BLADE_MS + delay);
  }
  HL.tset(state.pin, active ? 1 : 0, now, active ? TURN_MS + last * state.step : 0);
  state.loop.wake();
}

// Rest centres along one row: the nearest x answers, and turning never moves it.
function move(state, point) {
  const gap = (part) => Math.abs(part.center - point[0]);
  const nearest = state.targets.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  if (!state.bladeLit) highlight(state, nearest.outline);
  select(state, true);
}

function leave(state) {
  highlight(state, state.disks[DISKS.length - 1].outline);
  select(state, false);
}

function mount({ stage, svg, read }, step) {
  const C = HL.Cam(45, 0.5, 2.57);
  const bounds = [
    [BLADE_FROM, 31, BLADE_UP + BLADE_HEIGHT],
    [BLADE_TO, -31, BLADE_UP + BLADE_HEIGHT],
    [BLADE_TO, 31, 14],
  ];
  HL.fit(C, bounds, 186, 177);
  const P = HL.proj(C);
  const target = HL.seg(P(BLADE_FROM, 0, AXIS + RADIUS), P(BLADE_TO, 0, AXIS + RADIUS));
  HL.mk('path', { d: target, class: 'nf lo dash' }, svg);
  const [disks, blades, edges] = [[], [], []];
  let dial = null;
  for (let index = 0; index < BOUNDS.length - 1; index++) {
    const [from, to] = [BOUNDS[index], BOUNDS[index + 1]];
    HL.mk('path', { d: HL.seg(P(from, 0, AXIS), P(to, 0, AXIS)), class: 'nf lo dash' }, svg);
    const [bladeFrom, bladeTo] = [Math.max(from, BLADE_FROM), Math.min(to, BLADE_TO)];
    if (bladeFrom < bladeTo) blades.push(makeBlade(svg, P, bladeFrom, bladeTo, edges));
    const turn = index < DISKS.length && HL.tween(DISKS[index], TURN_MS);
    if (index < DISKS.length) disks.push(makePlate(svg, P, to, turn, DISK, TICKS[index]));
    else if (index === DISKS.length) dial = makePlate(svg, P, to, null, DIAL, TICKS[index]);
  }
  dial.outline.push((dial.mark = HL.mk('path', { class: 'nf sil' }, svg)));
  const whole = makeBlade(svg, P, BLADE_FROM, BLADE_TO, edges);
  const dashed = HL.mk('path', { class: 'nf lo dash' }, svg);
  const solid = HL.mk('path', { class: 'nf sil' }, svg);
  const state = { P, read, disks, blades, whole, dashed, solid, step, highlight: [] };
  Object.assign(state, { dial, targets: [...disks, dial], pin: HL.tween(0, BLADE_MS) });
  state.bladeOutline = [solid, ...edges];
  state.loop = HL.register(stage, tick.bind(null, state));
  leave(state);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: leave.bind(null, state) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: (value) => (state.step = value), destroy: bag.dispose };
}

hairline({
  name: 'next-interlock',
  means: 'Slotted wheels, keyways out of line. Hover: they align and a traced blade drops in.',
  rules: [1, 2, 4, 6, 8],
  range: [30, 45, 60],
  mount,
});
