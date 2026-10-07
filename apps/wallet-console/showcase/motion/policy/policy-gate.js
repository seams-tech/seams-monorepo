/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
const LANES = 3;
const PITCH = 66;
const REST_ANGLES = [0, 12, 0];
const ARM = HL.rrect(-6, -3, 52, 3, 2, 8);

function block(parent, P, front, x0, y0, x1, y1, z0, z1, radius) {
  const [ring, inner] = HL.rings(x0, y0, x1, y1, radius, 0.7);
  const solid = HL.solid(parent);
  HL.put(solid, HL.prism(P, front, ring, inner, z0, z1));
}

function wallPoint(P, x, y, side, point) {
  return side ? P(x, y + point.u, point.v) : P(x + point.u, y, point.v);
}

function panel(parent, P, x, y, side, bounds) {
  const points = HL.rrect(...bounds, 1.5, 6).map(wallPoint.bind(null, P, x, y, side));
  HL.mk('path', { d: HL.poly(points), class: 'nf lo' }, parent);
}

function lanePoint(P, x, u, v, z) {
  return P(x + u, v, z);
}

function booth(parent, P, front) {
  for (const bounds of [
    [-10, -31, 16, 46, 3, 6, 5],
    [-2, -26, 3, -21, 6, 56, 1],
    [-8, -24, 13, 0, 6, 42, 2],
    [-10, -26, 15, 2, 42, 44, 2],
    [-6, -2, -3, 1, 44, 56, 1],
    [13, -23, 18, -1, 23, 24.5, 1],
    [-1, 17, 10, 30, 6, 32, 2],
    [-7, 38, -3, 42, 6, 17, 2],
  ])
    block(parent, P, front, ...bounds);
  for (const bounds of [
    [-5, 8, 10, 39],
    [-3, 25, 8, 37],
    [-3, 11, 8, 21],
  ]) {
    panel(parent, P, 0, 0.1, false, bounds);
  }
  panel(parent, P, 13.1, 0, true, [-22, 25, -2, 39]);
  panel(parent, P, 13.2, 0, true, [-20.8, 26.2, -3.2, 37.8]);
  panel(parent, P, 0, 30.1, false, [1, 10, 8, 21]);
  let details = HL.seg(P(7, 0.2, 22), P(7, 0.2, 25));
  details += HL.seg(P(13.3, -12, 26.2), P(13.3, -12, 37.8));
  details += HL.seg(P(13.3, -19, 30), P(13.3, -15, 34));
  for (const z of [13, 16, 19]) details += HL.seg(P(3, 30.2, z), P(6, 30.2, z));
  HL.mk('path', { d: details, class: 'nf lo' }, parent);
}

function armPoint(P, x, angle, depth, point) {
  const cosine = Math.cos(HL.rad(angle));
  const sine = Math.sin(HL.rad(angle));
  return P(
    x + 6 + point.u * cosine - point.v * sine,
    31 + depth,
    29 + point.u * sine + point.v * cosine,
  );
}

function makeArm(parent, P, index) {
  const x = index * PITCH;
  const beam = HL.solid(parent);
  const marks = HL.mk('path', { class: 'nf lo' }, parent);
  const hub = HL.circ(4.3, 40);
  const rear = hub.map(armPoint.bind(null, P, x, 0, -1));
  const face = hub.map(armPoint.bind(null, P, x, 0, 5));
  HL.mk('path', { d: HL.poly(HL.hull(rear.concat(face))), class: 'sil' }, parent);
  HL.mk('path', { d: HL.poly(face), class: 'nf lo' }, parent);
  const axle = HL.circ(1.5, 6).map(armPoint.bind(null, P, x, 0, 5));
  HL.mk('path', { d: HL.poly(axle), class: 'nf lo' }, parent);
  return { index, beam, marks, angle: HL.tween(REST_ANGLES[index]), drawn: NaN };
}

function drawArm(state, arm, angle) {
  const x = arm.index * PITCH;
  const rear = armPoint.bind(null, state.P, x, angle, 0);
  const front = armPoint.bind(null, state.P, x, angle, 3.2);
  const face = HL.rrect(-5.4, -2.4, 51.4, 2.4, 1.4, 8).map(front);
  const silhouette = HL.poly(HL.hull(ARM.map(rear).concat(ARM.map(front))));
  HL.put(arm.beam, { sil: silhouette, crease: HL.poly(face) });
  let stripes = '';
  for (let stripe = 0; stripe < 4; stripe++) {
    const u = 9 + stripe * 11;
    stripes += HL.seg(front({ u, v: -2.5 }), front({ u: u + 4, v: 2.5 }));
    stripes += HL.seg(front({ u: u + 3, v: -2.5 }), front({ u: u + 7, v: 2.5 }));
  }
  arm.marks.setAttribute('d', stripes);
}

function tick(state, _dt, now) {
  let moving = false;
  for (const arm of state.arms) {
    const angle = HL.tval(arm.angle, now);
    if (angle !== arm.drawn) drawArm(state, arm, angle);
    arm.drawn = angle;
    if (!HL.tdone(arm.angle, now)) moving = true;
  }
  return moving;
}

function select(state, index) {
  if (state.active === index) return;
  state.active = index;
  const now = performance.now();
  for (const arm of state.arms) {
    const selected = index === arm.index;
    const delay = Math.abs(arm.index - index) * 35;
    HL.tset(arm.angle, selected ? state.lift : REST_ANGLES[arm.index], now, delay);
    arm.beam.sil.classList.toggle('hi', selected || (index < 0 && arm.index === 1));
  }
  state.read.textContent = index < 0 ? 'rest' : `lane 0${index + 1}`;
  state.loop.wake();
}

function armDistance(P, index, point) {
  const root = P(index * PITCH + 6, 34.2, 29);
  const tip = armPoint(P, index * PITCH, REST_ANGLES[index], 3.2, { u: 52, v: 0 });
  const dx = tip[0] - root[0];
  const dy = tip[1] - root[1];
  const along = ((point[0] - root[0]) * dx + (point[1] - root[1]) * dy) / (dx * dx + dy * dy);
  const fraction = HL.clamp(along, 0, 1);
  return Math.hypot(point[0] - root[0] - fraction * dx, point[1] - root[1] - fraction * dy);
}

function move(state, point) {
  for (let index = LANES - 1; index >= 0; index--) {
    if (armDistance(state.P, index, point) < 8) {
      select(state, index);
      return;
    }
  }
  const [x, y] = HL.unproj(state.C, point[0], point[1], 3);
  const index = Math.floor(x / PITCH);
  const localX = x - index * PITCH;
  const onRoad = localX > 18 && localX < 62 && y > -34 && y < 56;
  select(state, index >= 0 && index < LANES && onRoad ? index : -1);
}

function set(state, lift) {
  state.lift = lift;
  if (state.active < 0) return;
  HL.tset(state.arms[state.active].angle, lift, performance.now(), 0);
  state.loop.wake();
}

function mount({ stage, svg, read }, lift) {
  const C = HL.Cam(45, 0.5, 1.45);
  const bounds = [
    [-14, -32, 60],
    [194, -40, 0],
    [-12, 56, 0],
    [194, 56, 0],
  ];
  HL.fit(C, bounds, 200, 166);
  const P = HL.proj(C);
  const front = HL.facing(C);
  block(svg, P, front, -12, -40, 194, 56, 0, 3, 6);
  let road = '';
  for (let lane = 0; lane < LANES; lane++) {
    const x = lane * PITCH;
    road += HL.poly(HL.ringAt(P, HL.rrect(x + 20, 43, x + 59, 44.3, 0.3, 4), 3.1));
    road += HL.poly(HL.ringAt(P, HL.rrect(x + 23, 30, x + 55, 39, 1.5, 6), 3.1));
  }
  HL.mk('path', { d: road, class: 'nf lo' }, svg);
  for (let lane = 0; lane < LANES; lane++) booth(svg, lanePoint.bind(null, P, lane * PITCH), front);
  block(svg, P, front, -5, -16, 185, -9, 51, 56, 1);
  block(svg, P, front, -14, -32, 194, 5, 56, 59, 2);
  block(svg, P, front, -11, -29, 191, 2, 59, 60, 1);
  for (const x of [54, 120, 186]) {
    HL.mk('path', { d: HL.seg(P(x, -27, 60.1), P(x, 0, 60.1)), class: 'nf lo' }, svg);
  }
  const arms = [];
  for (let index = 0; index < LANES; index++) arms.push(makeArm(svg, P, index));
  const state = { C, P, arms, read, lift, active: -2, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  select(state, -1);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: select.bind(null, state, -1) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'policy-gate',
  means: 'A three-lane tollgate: hover a lane to raise its barrier, then leave to lower it.',
  rules: [1, 3, 4, 6, 8, 9],
  range: [58, 72, 86],
  mount,
});
