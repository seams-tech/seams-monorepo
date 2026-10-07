/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function block(parent, P, front, x0, y0, x1, y1, low, high, radius = 1) {
  const solid = HL.solid(parent);
  const inset = Math.min(0.7, (x1 - x0) / 4, (y1 - y0) / 4);
  HL.put(solid, HL.prism(P, front, ...HL.rings(x0, y0, x1, y1, radius, inset), low, high));
  return solid;
}
function facePoint(P, x, point) {
  return P(x, point.u, point.v);
}
function face(parent, P, x, y0, z0, y1, z1, radius, classes = 'lo nf') {
  const ring = HL.rrect(y0, z0, y1, z1, radius, 8);
  return path(parent, HL.poly(ring.map(facePoint.bind(null, P, x))), classes);
}
function screw(parent, P, x, y, z) {
  const ring = HL.rrect(x - 1.7, y - 1.7, x + 1.7, y + 1.7, 1.7, 8);
  path(parent, HL.poly(HL.ringAt(P, ring, z)));
  path(parent, HL.seg(P(x - 0.8, y, z), P(x + 0.8, y, z)));
}
function chassis(parent, P, front) {
  block(parent, P, front, -64, -37, 44, 37, 0, 4, 3);
  for (const x of [-57, 37]) for (const y of [-32, 32]) screw(parent, P, x, y, 4);
  block(parent, P, front, -64, -37, -59, 37, 4, 37, 1.5);
  block(parent, P, front, -59, -37, 44, -33, 4, 30, 1);
  for (const y of [-29, 29]) {
    block(parent, P, front, -56, y - 2, 43, y + 2, 4, 9, 1);
    block(parent, P, front, -55, y - 0.8, 42, y + 0.8, 9, 12, 0.7);
  }
  block(parent, P, front, -59, -21, -53, 21, 12, 24, 1.2);
  face(parent, P, -52.9, -18, 14, 18, 22, 1, 'sil');
  for (let y = -15; y <= 15; y += 3) face(parent, P, -52.8, y, 16, y + 0.9, 20, 0.4);
  for (const y of [-28, 28]) face(parent, P, -58.9, y - 1.6, 27, y + 1.6, 30.2, 1.6);
}
function cartridge(parent, P, front) {
  block(parent, P, front, -51, -27, 43, 27, 10, 13, 2);
  block(parent, P, front, -49, -24, 39, 24, 13, 14.5, 1.5);
  // Exposed edge contacts seat inside the rear socket.
  block(parent, P, front, -49, -18, -44, 18, 14.5, 20, 1);
  for (let y = -15; y <= 15; y += 3) {
    block(parent, P, front, -54, y, -47, y + 1.2, 16.5, 17.7, 0.4);
  }
  for (const x of [-43, 32]) for (const y of [-20, 20]) screw(parent, P, x, y, 14.5);
  block(parent, P, front, -33, -18, -3, 10, 14.5, 17, 1.5);
  for (let x = -31; x <= -5; x += 3.25) {
    block(parent, P, front, x, -16, x + 1.1, 8, 17, 26, 0.5);
  }
  for (const y of [15, 20]) {
    block(parent, P, front, -33, y - 1.4, 6, y + 1.4, 14.5, 16.5, 0.6);
    for (const x of [-29, -20, -11, -2]) {
      block(parent, P, front, x, y - 1, x + 6, y + 1, 16.5, 22, 0.4);
    }
  }
  for (const x of [8, 21]) {
    block(parent, P, front, x, -16, x + 9, -6, 14.5, 18, 0.8);
    path(parent, HL.seg(P(x + 2, -13, 18), P(x + 7, -13, 18)));
  }
  block(parent, P, front, 10, 1, 28, 13, 14.5, 17, 1);
  path(parent, HL.poly(HL.ringAt(P, HL.rrect(13, 4, 25, 10, 1, 6), 17)));
  block(parent, P, front, -50, 25, 42, 27, 13, 17, 0.7);
  block(parent, P, front, 41, -31, 45, 31, 7, 33, 1.5);
  for (let y = -24; y <= 10; y += 4.5) face(parent, P, 45.1, y, 20, y + 1.5, 29, 0.75);
  face(parent, P, 45.1, -20, 11, 7, 16, 1.5);
  face(parent, P, 45.2, -18, 12.3, 5, 14.7, 1);
  for (const y of [-27, 27]) face(parent, P, 45.1, y - 1.2, 10, y + 1.2, 12.4, 1.2);
  block(parent, P, front, 45, 18, 48, 24, 10, 16, 1);
}
function leverPoint(P, angle, y, point) {
  const x = 48 + point.u * Math.sin(angle) + point.v * Math.cos(angle);
  const z = 13 + point.u * Math.cos(angle) - point.v * Math.sin(angle);
  return P(x, y, z);
}
function drawLever(state, angle) {
  const ring = HL.rrect(-2.5, -2, 18, 2, 1.8, 8);
  const far = ring.map(leverPoint.bind(null, state.P, angle, 20));
  const near = ring.map(leverPoint.bind(null, state.P, angle, 23));
  state.lever.setAttribute('d', HL.poly(HL.hull(far.concat(near))));
  const inset = HL.rrect(7, -0.7, 15, 0.7, 0.65, 6);
  const pivot = HL.circ(1.2, 24).map(leverPoint.bind(null, state.P, angle, 23.1));
  state.leverDetail.setAttribute(
    'd',
    HL.poly(inset.map(leverPoint.bind(null, state.P, angle, 23.1))) + HL.poly(pivot),
  );
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  // The cartridge seats before the latch closes; reversing opens it before withdrawal.
  const travel = 47 * (1 - HL.clamp(progress / 0.7, 0, 1));
  const latched = HL.clamp((progress - 0.7) / 0.3, 0, 1);
  const origin = state.P(0, 0, 0);
  const position = state.P(travel, 0, 0);
  state.cartridge.setAttribute(
    'transform',
    `translate(${position[0] - origin[0]} ${position[1] - origin[1]})`,
  );
  drawLever(state, HL.rad(78 * (1 - latched)));
  state.read.textContent = state.active ? 'seating' : 'rest';
  if (state.active && progress >= 0.7) state.read.textContent = 'latching';
  if (state.active && progress === 1) state.read.textContent = 'docked';
  return !HL.tdone(state.motion, now);
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
}
function set(state, duration) {
  const now = performance.now();
  state.motion = HL.tween(HL.tval(state.motion, now), duration);
  HL.tset(state.motion, state.active ? 1 : 0, now, 0);
  state.loop.wake();
}
function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 1.85);
  HL.fit(
    C,
    [
      [-64, -37, 37],
      [116, 37, 0],
      [-64, 37, 0],
      [116, -37, 33],
    ],
    200,
    163,
  );
  const P = HL.proj(C);
  const front = HL.facing(C);
  chassis(svg, P, front);
  const moving = HL.mk('g', {}, svg);
  cartridge(moving, P, front);
  const lever = path(moving, '', 'hi');
  const leverDetail = path(moving, '');
  block(svg, P, front, -59, 33, 44, 37, 4, 24, 1);
  path(svg, HL.seg(P(-54, 37.1, 9), P(38, 37.1, 9)));
  const state = {
    P,
    read,
    cartridge: moving,
    lever,
    leverDetail,
    motion: HL.tween(0, duration),
    drawn: NaN,
    active: null,
    loop: null,
  };
  state.loop = HL.register(stage, tick.bind(null, state));
  select(state, false);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(
    HL.pointer(stage, {
      move: select.bind(null, state, true),
      leave: select.bind(null, state, false),
    }),
  );
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}
hairline({
  name: 'self-hostable',
  means:
    'Your infrastructure. Your control. Run threshold signing on your own serverless infrastructure.',
  rules: [1, 4, 6, 7, 8, 9],
  range: [900, 1200, 1500],
  mount,
});
