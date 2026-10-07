/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function block(parent, P, front, x0, y0, x1, y1, low, high, radius = 1) {
  const solid = HL.solid(parent);
  const inset = Math.min(0.65, (x1 - x0) / 4, (y1 - y0) / 4);
  HL.put(solid, HL.prism(P, front, ...HL.rings(x0, y0, x1, y1, radius, inset), low, high));
}
function facePoint(P, x, point) {
  return P(x, point.u, point.v);
}
function face(parent, P, x, y0, z0, y1, z1, radius, classes = 'lo nf') {
  const ring = HL.rrect(y0, z0, y1, z1, radius, 8);
  return path(parent, HL.poly(ring.map(facePoint.bind(null, P, x))), classes);
}
function server(parent, P, front, z, active) {
  block(parent, P, front, -15, -38, 42, 38, z, z + 12, 1.3);
  for (const y of [-39.5, 39.5]) {
    block(parent, P, front, -22, y - 0.7, 41, y + 0.7, z + 1, z + 3, 0.5);
  }
  face(parent, P, 42.1, -38, z, 38, z + 12, 1.2, active ? 'hi' : 'sil');
  face(parent, P, 42.2, -15, z + 4.5, 1, z + 7.5, 1.5, active ? 'hi nf' : 'sil nf');
  for (const y of [10, 14, 18]) {
    face(parent, P, 42.2, y - 0.65, z + 7, y + 0.65, z + 8.3, 0.65);
  }
  for (const dz of [3, 6, 9]) {
    face(parent, P, 42.2, 25, z + dz - 0.5, 33, z + dz + 0.5, 0.5);
  }
}
function post(parent, P, front, y) {
  block(parent, P, front, 38, y - 2, 43, y + 2, 6, 94, 0.7);
  for (let z = 10; z < 92; z += 7) {
    face(parent, P, 43.1, y - 0.65, z, y + 0.65, z + 1.8, 0.25);
  }
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const origin = state.P(0, 0, 0);
  const position = state.P(state.travel * (1 - progress), 0, 0);
  state.server.setAttribute(
    'transform',
    `translate(${position[0] - origin[0]} ${position[1] - origin[1]})`,
  );
  state.read.textContent = state.active ? 'seating' : 'rest';
  if (state.active && progress === 1) state.read.textContent = 'installed';
  return !HL.tdone(state.motion, now);
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
}
function set(state, travel) {
  state.travel = travel;
  state.drawn = NaN;
  state.loop.wake();
}
function mount({ stage, svg, read }, travel) {
  const C = HL.Cam(45, 0.5, 1.9);
  HL.fit(
    C,
    [
      [-22, -46, 99],
      [76, 46, -4],
      [-22, 46, -4],
      [76, -46, 99],
    ],
    200,
    163,
  );
  const P = HL.proj(C);
  const front = HL.facing(C);
  for (const x of [-14, 33]) {
    for (const y of [-37, 37]) block(svg, P, front, x - 4, y - 4, x + 4, y + 4, -4, 0, 2);
  }
  block(svg, P, front, -22, -46, 44, 46, 0, 6, 2);
  block(svg, P, front, -22, -44, -19, 44, 6, 94, 1);
  block(svg, P, front, -19, -46, 40, -42, 6, 94, 1);
  post(svg, P, front, -41);
  let moving;
  // Lower bays precede upper bays; the near wall masks everything inside the rack.
  for (let index = 0; index < 6; index++) {
    const z = 8 + index * 14;
    for (const y of [-39.5, 39.5]) block(svg, P, front, -15, y - 1, 39, y + 1, z, z + 2, 0.5);
    const group = HL.mk('g', {}, svg);
    server(group, P, front, z, index === 3);
    if (index === 3) moving = group;
  }
  block(svg, P, front, -19, 42, 40, 46, 6, 94, 1);
  post(svg, P, front, 41);
  block(svg, P, front, -22, -46, 44, 46, 94, 99, 2);
  const state = {
    P,
    read,
    server: moving,
    travel,
    motion: HL.tween(0),
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
  means: 'Your infrastructure. Your control. Hover to install the server in your own rack.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [20, 26, 32],
  mount,
});
