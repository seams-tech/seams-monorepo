/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// The keychain of credentials/scoped-credentials.js, reduced to circles and
// lines: the same keys, ring, fan and camera, with no thickness. Each head is
// an opaque disc with a real hole, so nearer heads cover farther keys.
const COUNT = 4;
const BOW_RADIUS = 16;
const BOW_Y = 9;
const TIP_Y = 113;
const RING_RADIUS = 22;
const RING_Z = 8;

function planarPoint(point) {
  return [point.u, point.v];
}
const BOW = HL.circ(BOW_RADIUS, 64).map((point) => [point.u, point.v + BOW_Y]);
const HOLE = HL.circ(5, 48).map(planarPoint);

function restAngle(index) {
  return -42 + index * 24;
}

function keyHeight(index) {
  return 3 + index * 3;
}

function projectKey(P, angle, z, point) {
  const cosine = Math.cos(HL.rad(angle));
  const sine = Math.sin(HL.rad(angle));
  const y = point[1];
  return P(point[0] * cosine - y * sine, point[0] * sine + y * cosine, z);
}

// Two cuts per key, at different depths, keep the four keys distinct.
function cuts(index) {
  return [
    [74 + 8 * (index % 2), 6 + 2 * (index % 3)],
    [96, 6 + 2 * ((index + 1) % 3)],
  ];
}

function makeKey(svg, index) {
  const group = HL.mk('g', {}, svg);
  return {
    index,
    cuts: cuts(index),
    blade: HL.mk('path', { class: 'nf sil' }, group),
    head: HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, group),
    angle: HL.tween(restAngle(index)),
    drawn: NaN,
  };
}

function drawKey(state, key, angle) {
  if (angle === key.drawn) return;
  key.drawn = angle;
  const at = projectKey.bind(null, state.P, angle, keyHeight(key.index));
  key.head.setAttribute('d', HL.poly(BOW.map(at)) + HL.poly(HOLE.map(at)));
  let blade = HL.seg(at([0, BOW_Y + BOW_RADIUS]), at([0, TIP_Y]));
  for (const [v, depth] of key.cuts) blade += HL.seg(at([0, v]), at([depth, v]));
  key.blade.setAttribute('d', blade);
}

function guides(svg, P) {
  const middle = keyHeight((COUNT - 1) / 2);
  const sweep = [];
  for (let step = 0; step <= 48; step++) {
    const angle = HL.rad(-60 + (96 * step) / 48);
    sweep.push(P(-TIP_Y * Math.sin(angle), TIP_Y * Math.cos(angle), middle));
  }
  let d = HL.open(sweep);
  d += HL.seg(P(0, 0, -18), P(0, 0, RING_Z + RING_RADIUS + 10));
  d += HL.seg(P(0, -2 * RING_RADIUS - 8, RING_Z), P(0, 20, RING_Z));
  HL.mk('path', { d, class: 'nf lo dash' }, svg);
}

function ringPoint(P, angle) {
  return P(0, RING_RADIUS * Math.cos(angle) - RING_RADIUS, RING_Z + RING_RADIUS * Math.sin(angle));
}

// The ring section between two key heights, painted between those keys, so
// the ring passes through each head's hole.
function ring(svg, P, minimum, maximum) {
  let d = '';
  for (let step = 0; step < 96; step++) {
    const a = (step / 96) * Math.PI * 2;
    const b = ((step + 1) / 96) * Math.PI * 2;
    const height = RING_Z + RING_RADIUS * Math.sin((a + b) / 2);
    if (height >= minimum && height < maximum) d += HL.seg(ringPoint(P, a), ringPoint(P, b));
  }
  HL.mk('path', { d, class: 'nf sil' }, svg);
}

// The ring, and each key's head and tip at rest and fanned out as far as the
// slider allows, so the fit holds the most extreme pose (rule 03).
function extremes() {
  const world = (x, y, z) => [x, y, z];
  const points = [
    [0, -RING_RADIUS, RING_Z - RING_RADIUS],
    [0, -2 * RING_RADIUS, RING_Z],
    [0, -RING_RADIUS, RING_Z + RING_RADIUS],
  ];
  for (let index = 0; index < COUNT; index++) {
    for (const angle of [restAngle(index), restAngle(index) - 14]) {
      const at = projectKey.bind(null, world, angle, keyHeight(index));
      points.push(at([0, TIP_Y]), at([BOW_RADIUS, BOW_Y]), at([-BOW_RADIUS, BOW_Y]), at([0, -7]));
    }
  }
  return points;
}

function tick(state, _dt, now) {
  let moving = false;
  for (const key of state.keys) {
    drawKey(state, key, HL.tval(key.angle, now));
    if (!HL.tdone(key.angle, now)) moving = true;
  }
  return moving;
}

function select(state, index) {
  if (index === state.active) return;
  const from = index < 0 ? state.active : index;
  state.active = index;
  const now = performance.now();
  for (const key of state.keys) {
    const distance = Math.abs(key.index - from);
    const selected = key.index === index;
    let part = 0;
    if (selected) part = -state.fanAngle;
    else if (index >= 0) part = Math.sign(key.index - index) * 4;
    HL.tset(key.angle, restAngle(key.index) + part, now, distance * 35);
    const lit = selected || (index < 0 && key.index === COUNT - 1);
    key.head.classList.toggle('hi', lit);
    key.blade.classList.toggle('hi', lit);
  }
  state.read.textContent = index < 0 ? 'rest' : `key 0${index + 1}`;
  state.loop.wake();
}

function move(state, point) {
  let nearest = -1;
  let distance = Infinity;
  for (const key of state.keys) {
    const ground = HL.unproj(state.C, point[0], point[1], keyHeight(key.index));
    const angle = HL.rad(restAngle(key.index));
    const x = ground[0] * Math.cos(angle) + ground[1] * Math.sin(angle);
    const y = -ground[0] * Math.sin(angle) + ground[1] * Math.cos(angle);
    if (y < 20 || y > 150 || Math.abs(x) > 26) continue;
    const delta = Math.abs(x) / y;
    if (delta < distance) {
      nearest = key.index;
      distance = delta;
    }
  }
  select(state, nearest);
}

function set(state, fanAngle) {
  state.fanAngle = fanAngle;
  if (state.active < 0) return;
  HL.tset(state.keys[state.active].angle, restAngle(state.active) - fanAngle, performance.now(), 0);
  state.loop.wake();
}

function mount({ stage, svg, read }, fanAngle) {
  const C = HL.Cam(45, 0.5, 1.85);
  HL.fit(C, extremes(), 200, 160);
  const P = HL.proj(C);
  guides(svg, P);
  ring(svg, P, -Infinity, keyHeight(0));
  const keys = [];
  for (let index = 0; index < COUNT; index++) {
    keys.push(makeKey(svg, index));
    ring(svg, P, keyHeight(index), index === COUNT - 1 ? Infinity : keyHeight(index + 1));
  }
  const state = { C, P, keys, read, fanAngle, active: -2, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  select(state, -1);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: select.bind(null, state, -1) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'abstract-keychain',
  means:
    'Four keys on one ring, drawn as solid discs and lines. Hover a key to fan it out around the ring.',
  rules: [1, 2, 4, 8],
  range: [6, 10, 14],
  mount,
});
