/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// Three keys on one pivot, on an 8-unit module, each with a code near its tip.
// Hover traces a key's new place in dashes, then solid, then turns it there.
const UNIT = 8;
const HEAD = 2 * UNIT;
const HEAD_Y = 9;
const TIP = 14 * UNIT;
const RING = 1.25 * UNIT;
const RING_Z = 6;
const REST = [-40, -10, 20];
const TRACE_MS = 1300;
const DASH = [0, 380];
const SOLID = [420, 800];
const TURN = [850, 1300];
// Each key's code at three places 1.5 units apart: 'dots' marks a place with a
// solid or an open dot, 'teeth' cuts a sharp tooth where the code has a 1.
const BIT = 'dots';
const CODES = ['101', '110', '011'];
const PLACES = [84, 96, 108];

const HOLE = HL.circ(5, 40).map((p) => [p.u, p.v]);
const DISC = HL.circ(HEAD, 64).map((p) => [p.u, p.v + HEAD_Y]);
const CREASE = HL.circ(8.5, 48).map((p) => [p.u, p.v]);
const RIM = HL.circ(2.6, 20).map((p) => [p.u, p.v]);

function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / TRACE_MS));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

const keyHeight = (index) => 3 + index * 3;
const pt = (u, v) => [u, v];
const coded = (index, digit) => PLACES.filter((_, place) => CODES[index][place] === digit);

// The blade as one line from the head to the tip, with any teeth on one edge.
function blade(index) {
  const teeth = BIT === 'teeth' ? coded(index, '1') : [];
  const edge = teeth.flatMap((v) => [pt(0, v - 4), pt(0.75 * UNIT, v), pt(0, v + 4)]);
  return [pt(0, HEAD_Y + HEAD), ...edge, pt(0, TIP)];
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
    blade: HL.mk('path', { class: 'nf sil' }, group),
    full: HL.mk('path', { class: 'dot m' }, group),
    open: HL.mk('path', { class: 'lo' }, group),
    head: HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, group),
    crease: HL.mk('path', { class: 'nf lo' }, group),
    dashed: HL.mk('path', { class: 'nf lo dash' }, ghosts),
    solid: HL.mk('path', { class: 'nf sil' }, ghosts),
    trace: HL.tween(0, TRACE_MS),
    lean: HL.tween(0),
    drawn: '',
  };
}

function drawKey(state, key, now) {
  const progress = HL.tval(key.trace, now);
  const target = REST[key.index] - state.fan;
  const angle = HL.lerp(REST[key.index], target, phase(progress, TURN)) + HL.tval(key.lean, now);
  const signature = `${angle}|${progress}|${state.fan}`;
  if (signature === key.drawn) return;
  key.drawn = signature;
  const at = onPlane(state.P, angle, keyHeight(key.index));
  key.head.setAttribute('d', HL.poly(DISC.map(at)) + HL.poly(HOLE.map(at)));
  key.blade.setAttribute('d', HL.open(key.shape.map(at)));
  // The dot code: one dot on the blade line for each place whose digit matches.
  const bead = (v) => HL.poly(RIM.map(([u, w]) => at([u, w + v])));
  const dots = (digit) => (BIT === 'dots' ? coded(key.index, digit).map(bead).join('') : '');
  key.full.setAttribute('d', dots('1'));
  key.open.setAttribute('d', dots('0'));
  key.crease.setAttribute('d', HL.poly(CREASE.map(at)));
  // The ghost shows where the key will go until the key has arrived.
  const ghost = onPlane(state.P, target, keyHeight(key.index));
  const arrived = phase(progress, TURN) === 1;
  const trace = (part) => (arrived || !part ? '' : HL.open(partial(key.shape, part).map(ghost)));
  key.dashed.setAttribute('d', trace(phase(progress, DASH)));
  key.solid.setAttribute('d', trace(phase(progress, SOLID)));
}

function guides(svg, P) {
  let d = '';
  for (const angle of REST)
    d += HL.seg(onPlane(P, angle, 0)([0, TIP - 10]), onPlane(P, angle, 0)([0, TIP + 8]));
  const arc = [];
  for (let step = 0; step <= 24; step++) {
    const angle = HL.lerp(REST[0] - 6, REST[2] + 4, step / 24);
    arc.push(onPlane(P, angle, 0)([0, TIP + 4]));
  }
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
  HL.mk('path', { d, class: 'nf sil' }, svg);
}

function tick(state, _dt, now) {
  for (const key of state.keys) drawKey(state, key, now);
  return state.keys.some((key) => !HL.tdone(key.trace, now) || !HL.tdone(key.lean, now));
}

function select(state, index) {
  if (index === state.active) return;
  const from = index < 0 ? state.active : index;
  state.active = index;
  for (const key of state.keys) {
    const selected = key.index === index;
    const lean = !selected && index >= 0 ? Math.sign(key.index - index) * 4 : 0;
    HL.tset(key.trace, selected ? 1 : 0, performance.now(), 0);
    HL.tset(key.lean, lean, performance.now(), Math.abs(key.index - from) * 35);
    const lit = selected || (index < 0 && key.index === REST.length - 1);
    for (const el of [key.head, key.blade]) el.classList.toggle('hi', lit);
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
  const C = HL.Cam(45, 0.5, 2.28);
  const world = (x, y, z) => [x, y, z];
  const bounds = [];
  for (const [index, angle] of REST.entries()) {
    const at = onPlane(world, angle, keyHeight(index));
    bounds.push(...blade(index).map(at), at([HEAD, HEAD_Y]), at([-HEAD, HEAD_Y]), at([0, -7]));
  }
  HL.fit(C, bounds, 200, 166);
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
  return { set: (value) => ((state.fan = value), state.loop.wake()), destroy: bag.dispose };
}

hairline({
  name: 'edge-keys',
  means: 'Three keys on one pivot. Hover a key: its new place traces, then the key turns there.',
  rules: [1, 2, 4, 8],
  range: [10, 14, 18],
  mount,
});
