/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// Three keys on one small ring; each blade has two cuts. Hover opens the fan: every
// key turns straight to its new place, staggered from the key nearest the pointer.
const UNIT = 8;
const [HEAD, HEAD_Y, TIP] = [2 * UNIT, 9, 14 * UNIT];
const [RING, RING_Z] = [7, 8];
const REST = [-34, -8, 18];
// Open, the outer keys swing out; the key nearest the pointer turns half the fan further.
const OPEN = [-10, 0, 10];
const STAGGER = 70;
// Two straight cuts on one side of each blade, set back from the tip; the cut
// nearer the handle is the longer one.
const CUTS = [
  [74, 1.25 * UNIT],
  [90, 0.75 * UNIT],
];
const HOLE = HL.circ(5, 40).map((p) => [p.u, p.v]);
const DISC = HL.circ(HEAD, 64).map((p) => [p.u, p.v + HEAD_Y]);

const keyHeight = (index) => 3 + index * 5;
const away = (i) => Math.sign(OPEN[i]) || -1;
const turn = (s, i) => (i === s.active ? (away(i) * s.fan) / 2 : 0);
const goal = (s, i) => REST[i] + (s.active < 0 ? 0 : OPEN[i] + turn(s, i));
const pt = (u, v) => [u, v];
// The blade as one line from the head to the tip, out and back along each cut.
function blade() {
  const cuts = CUTS.flatMap(([v, length]) => [pt(0, v), pt(length, v), pt(0, v)]);
  return [pt(0, HEAD_Y + HEAD), ...cuts, pt(0, TIP)];
}
function onPlane(P, angle, z) {
  const [s, c] = [Math.sin(HL.rad(angle)), Math.cos(HL.rad(angle))];
  return ([u, v]) => P(u * c - v * s, u * s + v * c, z);
}
function makeKey(svg, index) {
  const group = HL.mk('g', {}, svg);
  return {
    index,
    shape: blade(),
    blade: HL.mk('path', { class: 'nf sil' }, group),
    head: HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, group),
    angle: HL.tween(REST[index]),
  };
}
function drawKey(state, key, now) {
  const angle = HL.tval(key.angle, now);
  if (angle === key.drawn) return;
  key.drawn = angle;
  const at = onPlane(state.P, angle, keyHeight(key.index));
  key.head.setAttribute('d', HL.poly(DISC.map(at)) + HL.poly(HOLE.map(at)));
  key.blade.setAttribute('d', HL.open(key.shape.map(at)));
}
function guides(svg, P) {
  let d = '';
  for (const angle of REST)
    d += HL.seg(onPlane(P, angle, 0)([0, TIP - 10]), onPlane(P, angle, 0)([0, TIP + 4]));
  const tip = (step) => onPlane(P, HL.lerp(REST[0] - 11, REST[2] + 10, step / 24), 0);
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
  return state.keys.some((key) => !HL.tdone(key.angle, now));
}

// Every key whose place changes turns there, a step later per key from the pointer's
// (rule 02); leaving turns them back the same way.
function select(state, index, force) {
  if (index === state.active && !force) return;
  const from = index < 0 ? state.active : index;
  state.active = index;
  const now = performance.now();
  for (const key of state.keys) {
    const lit = key.index === index || (index < 0 && key.index === REST.length - 1);
    for (const el of [key.head, key.blade]) el.classList.toggle('hi', lit);
    const place = goal(state, key.index);
    if (place === key.goal) continue;
    const delay = Math.abs(key.index - from) * STAGGER;
    key.goal = place;
    HL.tset(key.angle, place, now, delay);
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
      bounds.push(...blade().map(at), at([HEAD, HEAD_Y]));
      bounds.push(at([-HEAD, HEAD_Y]), at([0, HEAD_Y - HEAD]));
    }
  }
  HL.fit(C, bounds, 196, 160);
  const P = HL.proj(C);
  guides(svg, P);
  ring(svg, P, -Infinity, keyHeight(0));
  const keys = [];
  for (let index = 0; index < REST.length; index++) {
    keys.push(makeKey(svg, index));
    ring(svg, P, keyHeight(index), index < REST.length - 1 ? keyHeight(index + 1) : Infinity);
  }
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
  means: 'Three keys on one ring. Hover: the fan opens, every key turning to its new place.',
  rules: [1, 2, 4, 8],
  range: [10, 14, 18],
  mount,
});
