/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
const {
  Cam,
  fillet,
  fit,
  poly,
  open,
  proj,
  unproj,
  rad,
  rrect,
  tween,
  tset,
  tval,
  tdone,
  mk,
  pointer,
  register,
  disposer,
} = HL;
const COUNT = 4;

function bow(radius) {
  const points = [];
  for (let step = 0; step <= 64; step++) {
    const angle = rad(109.47 + (321.06 * step) / 64);
    points.push([radius * Math.cos(angle), radius * Math.sin(angle) - 12]);
  }
  return points;
}

function outline(index) {
  const points = [
    [8, 10.63],
    [8, 43],
  ];
  for (let tooth = 0; tooth < 5; tooth++) {
    const y = 46 + tooth * 11;
    const depth = 3 + ((tooth * 3 + index * 5) % 7);
    points.push([depth, y], [depth, y + 5], [11, y + 8]);
  }
  points.push([11, 105], [5, 113], [-7, 113], [-9, 109], [-9, 17], [-8, 10.63]);
  return fillet(points, Array(points.length).fill(1)).concat(bow(24));
}

function restAngle(index) {
  return -42 + index * 24;
}

function projectKey(P, angle, slide, z, point) {
  const cosine = Math.cos(rad(angle));
  const sine = Math.sin(rad(angle));
  const y = point[1] + slide;
  return P(point[0] * cosine - y * sine, point[0] * sine + y * cosine, z);
}

function slotPoint(point) {
  return [point.u, point.v];
}
const SLOT = rrect(-5, -30, 5, 2, 5, 10).map(slotPoint);

function makeKey(svg, index) {
  const group = mk('g', {}, svg);
  const back = mk('path', { class: 'lo', 'fill-rule': 'evenodd' }, group);
  const face = mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, group);
  const details = mk('path', { class: 'nf lo' }, group);
  return {
    index,
    shape: outline(index),
    back,
    face,
    details,
    slide: tween(0),
    angle: tween(restAngle(index)),
    drawn: '',
  };
}

function drawKey(state, key, angle, slide) {
  const z = 3 + key.index * 3;
  const top = projectKey.bind(null, state.P, angle, slide, z);
  const bottom = projectKey.bind(null, state.P, angle, slide, z - 2.2);
  key.back.setAttribute('d', poly(key.shape.map(bottom)) + poly(SLOT.map(bottom)));
  key.face.setAttribute('d', poly(key.shape.map(top)) + poly(SLOT.map(top)));
  const channel = [
    [-5, 19],
    [-5, 104],
    [-2, 107],
    [0, 104],
    [0, 20],
  ];
  key.details.setAttribute('d', open(bow(19).map(top)) + open(channel.map(top)));
}

function ringPoint(P, radius, angle) {
  return P(0, -22 + radius * Math.cos(angle), 12 + radius * Math.sin(angle));
}

function ring(svg, P, start, end) {
  const outer = [];
  const inner = [];
  for (let step = 0; step <= 64; step++) {
    const angle = start + ((end - start) * step) / 64;
    outer.push(ringPoint(P, 23.5, angle));
    inner.push(ringPoint(P, 20.5, angle));
  }
  mk('path', { d: poly(outer.concat(inner.reverse())), class: 'sil' }, svg);
}

function tick(state, _dt, now) {
  let moving = false;
  for (const key of state.keys) {
    const angle = tval(key.angle, now);
    const slide = tval(key.slide, now);
    const pose = `${angle},${slide}`;
    if (pose !== key.drawn) drawKey(state, key, angle, slide);
    key.drawn = pose;
    if (!tdone(key.angle, now) || !tdone(key.slide, now)) moving = true;
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
    const part = index < 0 ? 0 : Math.sign(key.index - index) * 4;
    tset(key.slide, selected ? state.travel : 0, now, distance * 35);
    tset(key.angle, restAngle(key.index) + part, now, distance * 35);
    key.face.classList.toggle('hi', selected || (index < 0 && key.index === COUNT - 1));
  }
  state.read.textContent = index < 0 ? 'rest' : `key 0${index + 1}`;
  state.loop.wake();
}

function move(state, point) {
  let nearest = -1;
  let distance = Infinity;
  for (const key of state.keys) {
    const ground = unproj(state.C, point[0], point[1], 3 + key.index * 3);
    const angle = rad(restAngle(key.index));
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

function set(state, travel) {
  state.travel = travel;
  if (state.active < 0) return;
  tset(state.keys[state.active].slide, travel, performance.now(), 0);
  state.loop.wake();
}

function mount({ stage, svg, read }, travel) {
  const C = Cam(45, 0.5, 1.62);
  const bounds = [
    [-110, -44, 0],
    [100, 125, 0],
    [0, -22, 36],
  ];
  fit(C, bounds, 200, 166);
  const P = proj(C);
  ring(svg, P, Math.PI, Math.PI * 2);
  const keys = [];
  for (let index = 0; index < COUNT; index++) keys.push(makeKey(svg, index));
  ring(svg, P, 0, Math.PI);
  const state = { C, P, keys, read, travel, active: -2, loop: null };
  state.loop = register(stage, tick.bind(null, state));
  select(state, -1);
  const bag = disposer();
  bag.add(state.loop.unregister);
  bag.add(pointer(stage, { move: move.bind(null, state), leave: select.bind(null, state, -1) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'scoped-credentials',
  means:
    'Four keys on a ring: hover a key to slide it forward from the bundle, with its neighbours making room.',
  rules: [1, 2, 4, 6, 8],
  range: [12, 18, 24],
  mount,
});
