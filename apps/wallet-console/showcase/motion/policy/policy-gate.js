/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
const LANES = 3;
const PITCH = 66;
const ARM = HL.rrect(-6, -3, 52, 3, 2, 8);

function block(parent, P, front, x0, y0, x1, y1, z0, z1, radius) {
  const [ring, inner] = HL.rings(x0, y0, x1, y1, radius, 0.7);
  const solid = HL.solid(parent);
  HL.put(solid, HL.prism(P, front, ring, inner, z0, z1));
  return solid;
}

function wallPoint(P, x, y, side, point) {
  return side ? P(x, y + point.u, point.v) : P(x + point.u, y, point.v);
}

function panel(parent, P, x, y, side, bounds) {
  const points = HL.rrect(...bounds, 1.5, 6).map(wallPoint.bind(null, P, x, y, side));
  HL.mk('path', { d: HL.poly(points), class: 'nf lo' }, parent);
}

function booth(parent, P, front, x) {
  block(parent, P, front, x - 5, -29, x + 12, 46, 3, 6, 6);
  block(parent, P, front, x - 3, -22, x + 10, -2, 6, 48, 2);
  panel(parent, P, x, -1.9, false, [-1, 29, 8, 43]);
  panel(parent, P, x + 10.1, 0, true, [-20, 29, -4, 43]);
  panel(parent, P, x, -1.9, false, [0, 10, 7, 25]);
  HL.mk('path', { d: HL.seg(P(x + 5, -1.8, 19), P(x + 5, -1.8, 22)), class: 'nf lo' }, parent);
  block(parent, P, front, x - 1, 17, x + 10, 30, 6, 32, 2);
  panel(parent, P, x, 30.1, false, [1, 10, 8, 21]);
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

function hubPoint(P, x, depth, point) {
  return P(x + 6 + point.u, 31 + depth, 29 + point.v);
}

function makeArm(parent, P, index) {
  const x = index * PITCH;
  const beam = HL.solid(parent);
  const marks = HL.mk('path', { class: 'nf lo' }, parent);
  const hub = HL.circ(4.3, 40);
  const rear = hub.map(hubPoint.bind(null, P, x, -1));
  const face = hub.map(hubPoint.bind(null, P, x, 5));
  HL.mk('path', { d: HL.poly(HL.hull(rear.concat(face))), class: 'sil' }, parent);
  HL.mk('path', { d: HL.poly(face), class: 'nf lo' }, parent);
  const axle = HL.circ(1.5, 24).map(hubPoint.bind(null, P, x, 5));
  HL.mk('path', { d: HL.poly(axle), class: 'nf lo' }, parent);
  return { index, beam, marks, angle: HL.tween(restAngle(index)), drawn: NaN };
}

function restAngle(index) {
  return index === 1 ? 12 : 0;
}

function drawArm(state, arm, angle) {
  const x = arm.index * PITCH;
  const rear = armPoint.bind(null, state.P, x, angle, 0);
  const front = armPoint.bind(null, state.P, x, angle, 3.2);
  const face = ARM.map(front);
  const silhouette = HL.poly(HL.hull(ARM.map(rear).concat(face)));
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
    HL.tset(
      arm.angle,
      selected ? state.lift : restAngle(arm.index),
      now,
      Math.abs(arm.index - index) * 35,
    );
    arm.beam.sil.classList.toggle('hi', selected || (index < 0 && arm.index === 1));
  }
  state.read.textContent = index < 0 ? 'rest' : `lane 0${index + 1}`;
  state.loop.wake();
}

function armDistance(P, index, point) {
  const root = P(index * PITCH + 6, 34.2, 29);
  const tip = armPoint(P, index * PITCH, restAngle(index), 3.2, { u: 52, v: 0 });
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
  const onRoad = localX > 12 && localX < 62 && y > -34 && y < 56;
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
    [-12, -40, 0],
    [194, -40, 0],
    [-12, 56, 0],
    [194, 56, 0],
    [6, 34, 84],
    [138, 34, 84],
  ];
  HL.fit(C, bounds, 200, 166);
  const P = HL.proj(C);
  const front = HL.facing(C);
  block(svg, P, front, -12, -40, 194, 56, 0, 3, 6);
  let road = '';
  for (let lane = 0; lane < LANES; lane++) {
    const x = lane * PITCH + 35;
    for (const y of [-28, -10, 8, 43]) road += HL.seg(P(x, y, 3.1), P(x, y + 8, 3.1));
  }
  HL.mk('path', { d: road, class: 'nf lo' }, svg);
  for (let lane = 0; lane < LANES; lane++) booth(svg, P, front, lane * PITCH);
  block(svg, P, front, -7, -27, 181, 1, 48, 54, 3);
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
