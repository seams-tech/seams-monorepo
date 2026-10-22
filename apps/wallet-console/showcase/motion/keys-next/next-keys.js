/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// Three keys on one small ring; key n has n rings round its hole and its own blade.
// Hover opens the fan: each key traces its new place (dashes, then solid), then turns.
const UNIT = 8;
const [HEAD, HEAD_Y, TIP] = [2 * UNIT, 9, 14 * UNIT];
const [RING, RING_Z] = [7, 8];
const REST = [-34, -8, 18];
// Open, the outer keys swing out; the key nearest the pointer turns half the fan further.
const OPEN = [-10, 0, 10];
const [TRACE_MS, TURN_AT, TURN_MS, STAGGER] = [800, 850, 450, 80];
const RINGS = [8, 11, 14];
// 'wave' cuts each blade's outer third into a sine of 1, 1.5 or 2 periods; 'tip'
// ends it in a triangle, a diamond or a circle; 'plain' leaves it straight.
const BLADE = 'wave';
const HOLE = HL.circ(5, 40).map((p) => [p.u, p.v]);
const DISC = HL.circ(HEAD, 64).map((p) => [p.u, p.v + HEAD_Y]);
function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / TRACE_MS));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

const keyHeight = (index) => 3 + index * 5;
const away = (i) => Math.sign(OPEN[i]) || -1;
const turn = (s, i) => (i === s.active ? (away(i) * s.fan) / 2 : 0);
const goal = (s, i) => REST[i] + (s.active < 0 ? 0 : OPEN[i] + turn(s, i));
// Key n's n rings round its hole, each cut where it would leave the head.
const inHead = (p) => Math.hypot(p.u, p.v - HEAD_Y) < HEAD - 0.6;
const ringsOf = (index) =>
  RINGS.slice(0, index + 1).map((r) => HL.run(HL.circ(r, 64), inHead).map((p) => [p.u, p.v]));
const pt = (u, v) => [u, v];
// The blade as one line from the head to the tip.
function blade(index) {
  const [start, from] = [HEAD_Y + HEAD, TIP - (TIP - HEAD_Y - HEAD) / 3];
  if (BLADE !== 'wave') return [pt(0, start), pt(0, TIP)];
  const wave = Array.from({ length: 25 }, (_, step) =>
    pt(0.5 * UNIT * Math.sin(Math.PI * (2 + index) * (step / 24)), HL.lerp(from, TIP, step / 24)),
  );
  return [pt(0, start), ...wave];
}
// The 'tip' shape past the blade's end, one module across: 3, 4 or many corners.
function tipOf(index) {
  const corners = BLADE === 'tip' ? [3, 4, 32][index] : 0;
  const [r, angle] = [UNIT / 2, (k) => (k / corners) * Math.PI * 2];
  return Array.from({ length: corners }, (_, k) =>
    pt(r * Math.sin(angle(k)), TIP + r - r * Math.cos(angle(k))),
  );
}
function onPlane(P, angle, z) {
  const [s, c] = [Math.sin(HL.rad(angle)), Math.cos(HL.rad(angle))];
  return ([u, v]) => P(u * c - v * s, u * s + v * c, z);
}
// The open polyline as far as part of its length (the trace).
function partial(points, part) {
  const len = (i) => Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  let left = part * points.slice(1).reduce((sum, _, i) => sum + len(i + 1), 0);
  const out = [points[0]];
  for (let i = 1; i < points.length && left > 0; left -= len(i++)) {
    const t = Math.min(1, left / len(i));
    out.push(points[i - 1].map((value, axis) => HL.lerp(value, points[i][axis], t)));
  }
  return out;
}
function makeKey(svg, ghosts, index) {
  const group = HL.mk('g', {}, svg);
  return {
    index,
    shape: blade(index),
    marks: ringsOf(index),
    blade: HL.mk('path', { class: 'nf sil' }, group),
    tipShape: tipOf(index),
    head: HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, group),
    rings: HL.mk('path', { class: 'nf lo' }, group),
    tip: HL.mk('path', { class: 'sil' }, group),
    dashed: HL.mk('path', { class: 'nf lo dash' }, ghosts),
    solid: HL.mk('path', { class: 'nf sil' }, ghosts),
    angle: HL.tween(REST[index], TURN_MS),
    trace: HL.tween(0, TRACE_MS),
  };
}
function drawKey(state, key, now) {
  const [angle, progress] = [HL.tval(key.angle, now), HL.tval(key.trace, now)];
  const signature = `${angle}|${progress}|${key.goal}`;
  if (signature === key.drawn) return;
  key.drawn = signature;
  const at = onPlane(state.P, angle, keyHeight(key.index));
  key.head.setAttribute('d', HL.poly(DISC.map(at)) + HL.poly(HOLE.map(at)));
  key.rings.setAttribute('d', key.marks.map((mark) => HL.open(mark.map(at))).join(''));
  key.blade.setAttribute('d', HL.open(key.shape.map(at)));
  key.tip.setAttribute('d', key.tipShape.length ? HL.poly(key.tipShape.map(at)) : '');
  // The ghost traces where the key will go, until the key has arrived there.
  const ghost = onPlane(state.P, key.goal, keyHeight(key.index));
  const trace = (part) =>
    angle === key.goal || !part ? '' : HL.open(partial(key.shape, part).map(ghost));
  key.dashed.setAttribute('d', trace(phase(progress, [0, 380])));
  key.solid.setAttribute('d', trace(phase(progress, [420, 800])));
}
function guides(svg, P) {
  let d = '';
  for (const angle of REST)
    d += HL.seg(onPlane(P, angle, 0)([0, TIP - 10]), onPlane(P, angle, 0)([0, TIP + 8]));
  const tip = (step) => onPlane(P, HL.lerp(REST[0] - 14, REST[2] + 10, step / 24), 0);
  const arc = Array.from({ length: 25 }, (_, step) => tip(step)([0, TIP + 4]));
  HL.mk('path', { d: d + HL.open(arc), class: 'nf lo dash' }, svg);
}
// The ring between two key heights, painted between them: it passes each hole.
function ring(svg, P, minimum, maximum) {
  const ringPoint = (a) => P(0, RING * Math.cos(a) - RING, RING_Z + RING * Math.sin(a));
  let d = '';
  for (let step = 0; step < 48; step++) {
    const [a, b] = [(step / 48) * Math.PI * 2, ((step + 1) / 48) * Math.PI * 2];
    const height = RING_Z + RING * Math.sin((a + b) / 2);
    if (height >= minimum && height < maximum) d += HL.seg(ringPoint(a), ringPoint(b));
  }
  HL.mk('path', { d, class: 'nf lo' }, svg);
}
function tick(state, _dt, now) {
  for (const key of state.keys) drawKey(state, key, now);
  return state.keys.some((key) => !HL.tdone(key.trace, now) || !HL.tdone(key.angle, now));
}

// A key whose place changes traces it, then turns, staggered (rule 02); leaving turns back.
function select(state, index, force) {
  if (index === state.active && !force) return;
  const from = index < 0 ? state.active : index;
  state.active = index;
  const now = performance.now();
  for (const key of state.keys) {
    const lit = key.index === index || (index < 0 && key.index === REST.length - 1);
    for (const el of [key.head, key.blade, key.tip]) el.classList.toggle('hi', lit);
    const place = goal(state, key.index);
    if (place === key.goal) continue;
    const delay = Math.abs(key.index - from) * STAGGER;
    key.goal = place;
    key.trace = HL.tween(0, TRACE_MS);
    if (index >= 0) HL.tset(key.trace, 1, now, delay);
    HL.tset(key.angle, place, now, index >= 0 ? delay + TURN_AT : delay);
  }
  state.read.textContent = index < 0 ? 'rest' : `key 0${index + 1}`;
  state.loop.wake();
}

// Each key answers on its own plane, in its resting frame (rule 01).
function move(state, point) {
  let [nearest, best] = [-1, Infinity];
  for (const key of state.keys) {
    const [gx, gy] = HL.unproj(state.C, point[0], point[1], keyHeight(key.index));
    const a = HL.rad(REST[key.index]);
    const x = gx * Math.cos(a) + gy * Math.sin(a);
    const y = -gx * Math.sin(a) + gy * Math.cos(a);
    if (y < 20 || y > TIP + 16 || Math.abs(x) > 22 || Math.abs(x) / y >= best) continue;
    [nearest, best] = [key.index, Math.abs(x) / y];
  }
  select(state, nearest);
}

function mount({ stage, svg, read }, fan) {
  const C = HL.Cam(45, 0.5, 2.32);
  const [world, bounds] = [(x, y, z) => [x, y, z], []];
  // Fit the rest pose and the fan fully open at the slider's far end (rule 03).
  for (const [index, rest] of REST.entries()) {
    for (const angle of [rest, rest + OPEN[index] + away(index) * 9]) {
      const at = onPlane(world, angle, keyHeight(index));
      bounds.push(...blade(index).map(at), ...tipOf(index).map(at), at([HEAD, HEAD_Y]));
      bounds.push(at([-HEAD, HEAD_Y]), at([0, HEAD_Y - HEAD]));
    }
  }
  HL.fit(C, bounds, 194, 160);
  const P = HL.proj(C);
  guides(svg, P);
  ring(svg, P, -Infinity, keyHeight(0));
  const ghosts = HL.mk('g', {}, null);
  const keys = [];
  for (let index = 0; index < REST.length; index++) {
    keys.push(makeKey(svg, ghosts, index));
    ring(svg, P, keyHeight(index), index < REST.length - 1 ? keyHeight(index + 1) : Infinity);
  }
  svg.append(ghosts);
  const state = { C, P, keys, read, fan, active: -2, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  select(state, -1);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: select.bind(null, state, -1) }));
  bag.add(svg.replaceChildren.bind(svg));
  const set = (value) => ((state.fan = value), select(state, state.active, true));
  return { set, destroy: bag.dispose };
}

hairline({
  name: 'next-keys',
  means: 'Three keys on one ring. Hover: the fan opens; each key traces its place, then turns.',
  rules: [1, 2, 4, 8],
  range: [10, 14, 18],
  mount,
});
