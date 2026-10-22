/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// interlock/combination-interlock.js as opaque circles and lines, no thickness.
const AXIS = 45;
const RADIUS = 31;
const SLOT_HALF = 3;
const SLOT_FLOOR = 19;
const HOLE_RADIUS = 4.3;
const DISKS = [-135, 105, -165];
const BOUNDS = [-56, -40, -12, 16, 46, 54];
const PIN_FROM = -50;
const PIN_TO = 26;
const PIN_UP = AXIS + RADIUS + 10;
const PIN_DOWN = AXIS + SLOT_FLOOR + 2.5;
const TURN_MS = 700;

function arc(radius, start, end, steps) {
  const points = [];
  for (let step = 0; step <= steps; step++) {
    const angle = HL.lerp(start, end, step / steps);
    points.push([radius * Math.sin(angle), radius * Math.cos(angle)]);
  }
  return points;
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

function makeDisk(svg, P, index) {
  const x = BOUNDS[index + 1];
  const face = HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, svg);
  return {
    index,
    x,
    face,
    outline: [face],
    center: P(x, 0, AXIS)[0],
    angle: HL.tween(DISKS[index]),
    drawn: NaN,
  };
}

function makeDial(svg, P) {
  const x = BOUNDS[4];
  const face = HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, svg);
  const mark = HL.mk('path', { class: 'nf sil' }, svg);
  return { x, face, mark, outline: [face, mark], center: P(x, 0, AXIS)[0] };
}

function drawDisk(state, disk, angle) {
  if (angle === disk.drawn) return;
  disk.drawn = angle;
  const at = project.bind(null, state.P, disk.x, angle);
  disk.face.setAttribute('d', HL.poly(DISK.map(at)) + HL.poly(HOLE.map(at)));
}

function drawDial(state, angle) {
  const dial = state.dial;
  if (angle === dial.drawn) return;
  dial.drawn = angle;
  const at = project.bind(null, state.P, dial.x, angle);
  dial.face.setAttribute('d', HL.poly(DIAL.map(at)) + HL.poly(HOLE.map(at)));
  dial.mark.setAttribute('d', HL.seg(at([0, 8]), at([0, 13])));
}

function tick(state, _dt, now) {
  let moving = false;
  for (const disk of state.disks) {
    drawDisk(state, disk, HL.tval(disk.angle, now));
    if (!HL.tdone(disk.angle, now)) moving = true;
  }
  drawDial(state, HL.tval(state.disks[2].angle, now));
  const drop = HL.tval(state.pin, now);
  if (drop !== state.pinDrawn) {
    state.pinDrawn = drop;
    const z = HL.lerp(PIN_UP, PIN_DOWN, drop);
    for (const pin of state.pins) pin.path.setAttribute('d', HL.seg(pin.from(z), pin.to(z)));
  }
  if (!HL.tdone(state.pin, now)) moving = true;
  let phase = 'rest';
  if (drop === 1) phase = 'unlocked';
  else if (state.active) phase = 'aligning';
  state.read.textContent = phase;
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
  for (const disk of state.disks) {
    const delay = (last - disk.index) * state.step;
    const target = active ? 0 : DISKS[disk.index];
    HL.tset(disk.angle, target, now, active ? delay : TURN_MS + delay);
  }
  HL.tset(state.pin, active ? 1 : 0, now, active ? TURN_MS + last * state.step : 0);
  state.loop.wake();
}

// Rest centres along one row: the nearest x answers, and turning never moves it.
function move(state, point) {
  let nearest = state.targets[0];
  for (const part of state.targets) {
    if (Math.abs(part.center - point[0]) < Math.abs(nearest.center - point[0])) nearest = part;
  }
  highlight(state, nearest.outline);
  select(state, true);
}

function leave(state) {
  highlight(state, state.dial.outline);
  select(state, false);
}

function mount({ stage, svg, read }, step) {
  const C = HL.Cam(45, 0.5, 2.2);
  const bounds = [
    [-56, -31, 14],
    [-56, 31, PIN_UP + 8],
    [54, -31, PIN_UP + 8],
    [54, 31, 14],
  ];
  HL.fit(C, bounds, 200, 166);
  const P = HL.proj(C);
  let drop = '';
  for (const x of [PIN_FROM, PIN_TO]) drop += HL.seg(P(x, 0, PIN_DOWN - 4), P(x, 0, PIN_UP + 8));
  HL.mk('path', { d: drop, class: 'nf lo dash' }, svg);
  const disks = [];
  const pins = [];
  let dial = null;
  for (let index = 0; index < BOUNDS.length - 1; index++) {
    const from = BOUNDS[index];
    const to = BOUNDS[index + 1];
    const axle = HL.seg(P(from, 0, AXIS), P(to, 0, AXIS));
    HL.mk('path', { d: axle, class: 'nf lo dash' }, svg);
    const pinFrom = Math.max(from, PIN_FROM);
    const pinTo = Math.min(to, PIN_TO);
    if (pinFrom < pinTo) {
      const path = HL.mk('path', { class: 'nf sil' }, svg);
      pins.push({ path, from: (z) => P(pinFrom, 0, z), to: (z) => P(pinTo, 0, z) });
    }
    if (index < DISKS.length) disks.push(makeDisk(svg, P, index));
    else if (index === DISKS.length) dial = makeDial(svg, P);
  }
  const state = {
    P,
    read,
    disks,
    dial,
    pins,
    targets: [...disks, dial],
    pin: HL.tween(0),
    pinDrawn: NaN,
    step,
    active: null,
    highlight: [],
    loop: null,
  };
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
  name: 'abstract-interlock',
  means:
    'Three slotted disks on one axle. Hover to turn their slots into line and drop the pin through them.',
  rules: [1, 2, 4, 6, 8],
  range: [30, 45, 60],
  mount,
});
