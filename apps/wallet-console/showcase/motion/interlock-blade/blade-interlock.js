/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// Flat disks, a dial and a blade. Once the keyways align, the blade traces itself
// in dashes, then solid, then drops in: top level with the rims, ends 6 units out.
const AXIS = 45;
const RADIUS = 31;
const BLADE_HEIGHT = 9.6;
const SLOT_HALF = 1.6;
const SLOT_FLOOR = 21;
const HOLE_RADIUS = 4.3;
const DISKS = [-135, 105, -165];
const BOUNDS = [-56, -40, -12, 16, 46, 54];
const BLADE_FROM = -46;
const BLADE_TO = 22;
const BLADE_UP = AXIS + RADIUS + 3;
const BLADE_DOWN = AXIS + SLOT_FLOOR + 0.3;
const TURN_MS = 450;
const BLADE_MS = 1600;
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
const DIAL = arc(16, 0, Math.PI * 2, 48);

function project(P, x, angle, point) {
  const a = HL.rad(angle);
  const y = point[0] * Math.cos(a) + point[1] * Math.sin(a);
  const z = point[1] * Math.cos(a) - point[0] * Math.sin(a);
  return P(x, y, AXIS + z);
}

// One blade section from x0 to x1, base at z. Only the blade's true ends draw
// edges, so the disks divide it with no seams.
function makeBlade(svg, P, x0, x1) {
  const face = HL.mk('path', { class: 'fo' }, svg);
  const edge = HL.mk('path', { class: 'nf sil' }, svg);
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

function makePlate(svg, P, x, angle, shape) {
  const face = HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, svg);
  return { x, face, shape, outline: [face], center: P(x, 0, AXIS)[0], angle, drawn: NaN };
}

function drawPlate(state, plate, angle) {
  if (angle === plate.drawn) return;
  plate.drawn = angle;
  const at = project.bind(null, state.P, plate.x, angle);
  plate.face.setAttribute('d', HL.poly(plate.shape.map(at)) + HL.poly(HOLE.map(at)));
  if (plate.mark) plate.mark.setAttribute('d', HL.seg(at([0, 8]), at([0, 13])));
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
  }
  if (!HL.tdone(state.pin, now)) moving = true;
  state.read.textContent = blade === 1 ? 'unlocked' : state.active ? 'aligning' : 'rest';
  return moving;
}

function highlight(state, outline) {
  if (state.highlight === outline) return;
  for (const edge of state.highlight) edge.classList.remove('hi');
  for (const edge of outline) edge.classList.add('hi');
  state.highlight = outline;
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  const now = performance.now();
  const last = DISKS.length - 1;
  for (const [index, disk] of state.disks.entries()) {
    const delay = (last - index) * state.step;
    HL.tset(disk.angle, active ? 0 : DISKS[index], now, active ? delay : BLADE_MS + delay);
  }
  HL.tset(state.pin, active ? 1 : 0, now, active ? TURN_MS + last * state.step : 0);
  state.loop.wake();
}

// Rest centres along one row: the nearest x answers, and turning never moves it.
function move(state, point) {
  const distance = (part) => Math.abs(part.center - point[0]);
  const nearest = state.targets.reduce((best, part) =>
    distance(part) < distance(best) ? part : best,
  );
  highlight(state, nearest.outline);
  select(state, true);
}

function leave(state) {
  highlight(state, state.dial.outline);
  select(state, false);
}

function mount({ stage, svg, read }, step) {
  const C = HL.Cam(45, 0.5, 2.4);
  const bounds = [
    [-56, -31, 14],
    [-56, 31, BLADE_UP + BLADE_HEIGHT],
    [54, -31, BLADE_UP + BLADE_HEIGHT],
    [54, 31, 14],
  ];
  HL.fit(C, bounds, 205, 180);
  const P = HL.proj(C);
  const [disks, blades] = [[], []];
  let dial = null;
  for (let index = 0; index < BOUNDS.length - 1; index++) {
    const [from, to] = [BOUNDS[index], BOUNDS[index + 1]];
    HL.mk('path', { d: HL.seg(P(from, 0, AXIS), P(to, 0, AXIS)), class: 'nf lo dash' }, svg);
    const bladeFrom = Math.max(from, BLADE_FROM);
    const bladeTo = Math.min(to, BLADE_TO);
    if (bladeFrom < bladeTo) blades.push(makeBlade(svg, P, bladeFrom, bladeTo));
    if (index < DISKS.length)
      disks.push(makePlate(svg, P, to, HL.tween(DISKS[index], TURN_MS), DISK));
    else if (index === DISKS.length) dial = makePlate(svg, P, to, null, DIAL);
  }
  dial.mark = HL.mk('path', { class: 'nf sil' }, svg);
  dial.outline.push(dial.mark);
  const whole = makeBlade(svg, P, BLADE_FROM, BLADE_TO);
  const dashed = HL.mk('path', { class: 'nf lo dash' }, svg);
  const solid = HL.mk('path', { class: 'nf sil' }, svg);
  const state = { P, read, disks, dial, blades, whole, dashed, solid, step, highlight: [] };
  Object.assign(state, { targets: [...disks, dial], pin: HL.tween(0, BLADE_MS), pinDrawn: NaN });
  state.loop = HL.register(stage, tick.bind(null, state));
  highlight(state, dial.outline);
  select(state, false);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: leave.bind(null, state) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: (value) => (state.step = value), destroy: bag.dispose };
}

hairline({
  name: 'blade-interlock',
  means:
    'Three slotted disks on one axle. Hover to align their keyways; a blade traces itself and drops in.',
  rules: [1, 2, 4, 6, 8],
  range: [30, 45, 60],
  mount,
});
