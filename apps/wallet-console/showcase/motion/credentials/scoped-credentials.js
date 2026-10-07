/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
const COUNT = 4;

function bow(radius) {
  const points = [];
  for (let step = 0; step <= 64; step++) {
    const angle = HL.rad(109.47 + (321.06 * step) / 64);
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
  return HL.fillet(points, Array(points.length).fill(1)).concat(bow(24));
}

function restAngle(index) {
  return -42 + index * 24;
}

function projectKey(P, angle, slide, z, point) {
  const cosine = Math.cos(HL.rad(angle));
  const sine = Math.sin(HL.rad(angle));
  const y = point[1] + slide;
  return P(point[0] * cosine - y * sine, point[0] * sine + y * cosine, z);
}

function slotPoint(point) {
  return [point.u, point.v];
}
const SLOT = HL.rrect(-6.5, -31, 6.5, 4, 6.5, 10).map(slotPoint);

function makeKey(svg, index) {
  const group = HL.mk('g', {}, svg);
  return {
    index,
    shape: outline(index),
    back: HL.mk('path', { class: 'lo', 'fill-rule': 'evenodd' }, group),
    face: HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, group),
    details: HL.mk('path', { class: 'nf lo' }, group),
    slide: HL.tween(0),
    angle: HL.tween(restAngle(index)),
  };
}

function drawKey(state, key, angle, slide) {
  const z = 3 + key.index * 3;
  const top = projectKey.bind(null, state.P, angle, slide, z);
  const bottom = projectKey.bind(null, state.P, angle, slide, z - 2.2);
  key.back.setAttribute('d', HL.poly(key.shape.map(bottom)) + HL.poly(SLOT.map(bottom)));
  key.face.setAttribute('d', HL.poly(key.shape.map(top)) + HL.poly(SLOT.map(top)));
  const channel = [
    [-5, 19],
    [-5, 104],
    [-2, 107],
    [0, 104],
    [0, 20],
  ];
  key.details.setAttribute('d', HL.open(bow(19).map(top)) + HL.open(channel.map(top)));
}

function torusPoint(angle, tubeAngle) {
  const radius = 26 + 2.6 * Math.cos(tubeAngle);
  return [2.6 * Math.sin(tubeAngle), -26 + radius * Math.cos(angle), 8 + radius * Math.sin(angle)];
}

function ring(svg, P, minimum, maximum) {
  // The 45-degree camera looks along (1, 1, vz).
  const origin = P(0, 0, 0);
  const vz = (P(1, 1, 0)[1] - origin[1]) / (origin[1] - P(0, 0, 1)[1]);
  let body = '',
    edges = '',
    ridge = '';
  for (let step = 0; step < 192; step++) {
    const a = (step / 192) * Math.PI * 2;
    const b = ((step + 1) / 192) * Math.PI * 2;
    const height = 8 + 26 * Math.sin((a + b) / 2);
    if (height < minimum || height >= maximum) continue;
    const surface = [];
    for (let tube = 0; tube < 24; tube++) {
      const phi = (tube / 24) * Math.PI * 2;
      surface.push(P(...torusPoint(a, phi)), P(...torusPoint(b, phi)));
    }
    body += HL.poly(HL.hull(surface));
    const na = Math.cos(a) + vz * Math.sin(a);
    const nb = Math.cos(b) + vz * Math.sin(b);
    for (const side of [0, Math.PI]) {
      edges += HL.seg(
        P(...torusPoint(a, Math.atan2(-na, 1) + side)),
        P(...torusPoint(b, Math.atan2(-nb, 1) + side)),
      );
    }
    ridge += HL.seg(P(...torusPoint(a, Math.atan2(1, na))), P(...torusPoint(b, Math.atan2(1, nb))));
  }
  HL.mk('path', { d: body, class: 'fo' }, svg);
  HL.mk('path', { d: edges, class: 'nf sil' }, svg);
  HL.mk('path', { d: ridge, class: 'nf lo' }, svg);
}

function tick(state, _dt, now) {
  let moving = false;
  for (const key of state.keys) {
    const angle = HL.tval(key.angle, now);
    const slide = HL.tval(key.slide, now);
    drawKey(state, key, angle, slide);
    if (!HL.tdone(key.angle, now) || !HL.tdone(key.slide, now)) moving = true;
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
    HL.tset(key.slide, selected ? state.travel : 0, now, distance * 35);
    HL.tset(key.angle, restAngle(key.index) + part, now, distance * 35);
    key.face.classList.toggle('hi', selected || (index < 0 && key.index === COUNT - 1));
  }
  state.read.textContent = index < 0 ? 'rest' : `key 0${index + 1}`;
  state.loop.wake();
}

function move(state, point) {
  let nearest = -1;
  let distance = Infinity;
  for (const key of state.keys) {
    const ground = HL.unproj(state.C, point[0], point[1], 3 + key.index * 3);
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

function set(state, travel) {
  state.travel = travel;
  if (state.active < 0) return;
  HL.tset(state.keys[state.active].slide, travel, performance.now(), 0);
  state.loop.wake();
}

function mount({ stage, svg, read }, travel) {
  const C = HL.Cam(45, 0.5, 1.62);
  const bounds = [
    [-110, -44, 0],
    [100, 125, 0],
    [0, -22, 36],
  ];
  HL.fit(C, bounds, 200, 166);
  const P = HL.proj(C);
  ring(svg, P, -Infinity, 3);
  const keys = [];
  for (let index = 0; index < COUNT; index++) {
    keys.push(makeKey(svg, index));
    ring(svg, P, 3 + index * 3, index === COUNT - 1 ? Infinity : 6 + index * 3);
  }
  const state = { C, P, keys, read, travel, active: -2, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  select(state, -1);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: select.bind(null, state, -1) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'scoped-credentials',
  means: 'Four keys threaded onto a solid ring. Hover a key to slide it out of the bundle.',
  rules: [1, 2, 4, 6, 8],
  range: [12, 18, 24],
  mount,
});
