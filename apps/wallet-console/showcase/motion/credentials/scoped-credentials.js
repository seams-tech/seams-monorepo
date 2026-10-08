/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
const COUNT = 4;
const BOW_RADIUS = 27;
const BOW_Y = 14;
const NECK_Y = BOW_Y + Math.sqrt(BOW_RADIUS ** 2 - 8 ** 2);
const RING_RADIUS = 34;

function bow(radius) {
  const points = [];
  const neckAngle = Math.acos(8 / BOW_RADIUS);
  for (let step = 0; step <= 64; step++) {
    const angle = Math.PI - neckAngle + ((Math.PI + 2 * neckAngle) * step) / 64;
    points.push([radius * Math.cos(angle), radius * Math.sin(angle) + BOW_Y]);
  }
  return points;
}

function outline(index) {
  const points = [[8, NECK_Y]];
  for (let tooth = 0; tooth < 4; tooth++) {
    const y = 59 + tooth * 12;
    const depth = 4 + ((tooth + index) % 3);
    points.push([8, y], [depth, y + 2], [depth, y + 5], [8, y + 7]);
  }
  points.push([8, 106], [3, 113], [-6, 113], [-8, 109], [-8, NECK_Y]);
  const radii = Array(points.length).fill(0.7);
  radii[0] = 0;
  radii[radii.length - 1] = 0;
  return HL.fillet(points, radii).concat(bow(BOW_RADIUS));
}

function restAngle(index) {
  return -42 + index * 24;
}

function projectKey(P, angle, z, point) {
  const cosine = Math.cos(HL.rad(angle));
  const sine = Math.sin(HL.rad(angle));
  const y = point[1];
  return P(point[0] * cosine - y * sine, point[0] * sine + y * cosine, z);
}

function planarPoint(point) {
  return [point.u, point.v];
}
const HOLE = HL.circ(6.2, 48).map(planarPoint);
const COLLAR = HL.circ(8.2, 48).map(planarPoint);
const GROOVE = HL.rrect(-4.5, 43, -1, 106, 0.9, 8).map(planarPoint);

function translatedRing(ring, x, y) {
  const points = [];
  for (const point of ring) points.push([point.u + x, point.v + y]);
  return points;
}

const INSET = translatedRing(HL.circ(23.5, 64), 0, BOW_Y);

function handleTexture() {
  const segments = [];
  const diagonal = Math.SQRT1_2;
  for (const slope of [-1, 1]) {
    const dx = diagonal,
      dy = slope * diagonal;
    for (let offset = -20; offset <= 20; offset += 4) {
      const x = -dy * offset,
        y = BOW_Y + dx * offset;
      const reach = Math.sqrt(22 ** 2 - offset ** 2);
      const holeCenter = -(x * dx + y * dy);
      const holeDistance = x * x + y * y - holeCenter ** 2;
      const intervals = [];
      if (holeDistance < 9.1 ** 2) {
        const clearance = Math.sqrt(9.1 ** 2 - holeDistance);
        intervals.push([-reach, Math.min(reach, holeCenter - clearance)]);
        intervals.push([Math.max(-reach, holeCenter + clearance), reach]);
      } else {
        intervals.push([-reach, reach]);
      }
      for (const [start, end] of intervals) {
        if (end <= start) continue;
        segments.push([
          [x + dx * start, y + dy * start],
          [x + dx * end, y + dy * end],
        ]);
      }
    }
  }
  return segments;
}
const TEXTURE = handleTexture();
const NAMEPLATE = HL.rrect(-12, 19, 12, 29, 1.4, 8).map(planarPoint);

function makeKey(svg, index) {
  const group = HL.mk('g', {}, svg);
  return {
    index,
    shape: outline(index),
    back: HL.mk('path', { class: 'lo', 'fill-rule': 'evenodd' }, group),
    inset: HL.mk('path', { class: 'lo', 'fill-rule': 'evenodd' }, group),
    texture: HL.mk('path', { class: 'nf lo' }, group),
    nameplate: HL.mk('path', { class: 'lo' }, group),
    insetWall: HL.mk('path', { class: 'lo', 'fill-rule': 'evenodd' }, group),
    face: HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, group),
    collar: HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, group),
    details: HL.mk('path', { class: 'nf lo' }, group),
    angle: HL.tween(restAngle(index)),
  };
}

function drawKey(state, key, angle) {
  const z = 3 + key.index * 3;
  const top = projectKey.bind(null, state.P, angle, z);
  const bottom = projectKey.bind(null, state.P, angle, z - 2.2);
  key.back.setAttribute('d', HL.poly(key.shape.map(bottom)) + HL.poly(HOLE.map(bottom)));
  const inset = projectKey.bind(null, state.P, angle, z - 0.8);
  key.inset.setAttribute('d', HL.poly(INSET.map(inset)) + HL.poly(HOLE.map(inset)));
  let texture = '';
  for (const [start, end] of TEXTURE) texture += HL.seg(inset(start), inset(end));
  key.texture.setAttribute('d', texture);
  key.nameplate.setAttribute('d', HL.poly(NAMEPLATE.map(inset)));
  key.insetWall.setAttribute('d', HL.poly(INSET.map(top)) + HL.poly(INSET.map(inset)));
  key.face.setAttribute('d', HL.poly(key.shape.map(top)) + HL.poly(INSET.map(top)));
  const lip = projectKey.bind(null, state.P, angle, z - 0.35);
  key.collar.setAttribute('d', HL.poly(COLLAR.map(lip)) + HL.poly(HOLE.map(lip)));
  key.details.setAttribute('d', HL.poly(GROOVE.map(top)));
}

function torusPoint(angle, tubeAngle) {
  const radius = RING_RADIUS + 2.6 * Math.cos(tubeAngle);
  const y = radius * Math.cos(angle) - RING_RADIUS;
  return [2.6 * Math.sin(tubeAngle), y, 8 + radius * Math.sin(angle)];
}

function ring(svg, P, minimum, maximum) {
  const origin = P(0, 0, 0);
  const vz = (P(1, 1, 0)[1] - origin[1]) / (origin[1] - P(0, 0, 1)[1]);
  let body = '',
    edges = '',
    ridge = '';
  for (let step = 0; step < 192; step++) {
    const a = (step / 192) * Math.PI * 2;
    const b = ((step + 1) / 192) * Math.PI * 2;
    const height = 8 + RING_RADIUS * Math.sin((a + b) / 2);
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
    drawKey(state, key, angle);
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

function set(state, fanAngle) {
  state.fanAngle = fanAngle;
  if (state.active < 0) return;
  HL.tset(state.keys[state.active].angle, restAngle(state.active) - fanAngle, performance.now(), 0);
  state.loop.wake();
}

function mount({ stage, svg, read }, fanAngle) {
  const C = HL.Cam(45, 0.5, 1.62);
  const bounds = [
    [-110, -44, 0],
    [100, 125, 0],
    [0, -34, 45],
  ];
  HL.fit(C, bounds, 200, 166);
  const P = HL.proj(C);
  ring(svg, P, -Infinity, 3);
  const keys = [];
  for (let index = 0; index < COUNT; index++) {
    keys.push(makeKey(svg, index));
    ring(svg, P, 3 + index * 3, index === COUNT - 1 ? Infinity : 6 + index * 3);
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
  name: 'scoped-credentials',
  means:
    'Four house keys threaded through small head holes. Hover a key to fan it out around the ring.',
  rules: [1, 2, 4, 6, 8],
  range: [6, 10, 14],
  mount,
});
