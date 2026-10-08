/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function block(parent, P, front, x0, y0, x1, y1, low, high, radius = 1) {
  const inset = Math.min(0.6, (x1 - x0) / 4, (y1 - y0) / 4);
  HL.put(
    HL.solid(parent),
    HL.prism(P, front, ...HL.rings(x0, y0, x1, y1, radius, inset), low, high),
  );
}
function facePoint(P, x, point) {
  return P(x, point.u, point.v);
}
function face(parent, P, x, y0, z0, y1, z1, radius, classes = 'lo nf') {
  const ring = HL.rrect(y0, z0, y1, z1, radius, 8);
  return HL.mk(
    'path',
    { d: HL.poly(ring.map(facePoint.bind(null, P, x))), class: classes },
    parent,
  );
}
function post(parent, P, front, y) {
  block(parent, P, front, 10, y - 1, 13, y + 1, 5, 80, 0.5);
  for (let z = 9; z < 79; z += 6) face(parent, P, 13.1, y - 0.3, z, y + 0.3, z + 1, 0.15);
}
function server(parent, P, front, rack, bay) {
  const y = 16 + rack * 32,
    z = 7 + bay * 12;
  const group = HL.mk('g', {}, parent);
  for (const rail of [-12.8, 12.8])
    block(group, P, front, -17, y + rail - 0.4, 12, y + rail + 0.4, z + 1, z + 2, 0.3);
  block(group, P, front, -19, y - 12, 12, y + 12, z, z + 10.8, 1);
  const panel = face(group, P, 12.1, y - 12, z, y + 12, z + 10.8, 0.9, 'sil');
  face(group, P, 12.2, y - 8, z + 4.3, y - 1, z + 6.2, 0.8);
  for (const dz of [3, 5, 7]) face(group, P, 12.2, y + 6, z + dz, y + 10, z + dz + 0.6, 0.3);
  for (const edge of [-10.5, 10.5])
    face(group, P, 12.2, y + edge - 0.3, z + 8.5, y + edge + 0.3, z + 9.1, 0.3);
  const lamp = face(group, P, 12.3, y + 2, z + 6, y + 3, z + 7, 0.5, 'dot m');
  const rest = 0.6 + 6 * Math.exp(-((rack - 1.4) ** 2 / 0.8 + (bay - 3.2) ** 2 / 2));
  return { rack, bay, y, z: z + 5.4, group, panel, lamp, rest, slide: HL.spring(rest), drawn: NaN };
}
function tick(state, dt) {
  let moving = false;
  const origin = state.P(0, 0, 0);
  for (const module of state.modules) {
    if (HL.stepS(module.slide, dt)) moving = true;
    if (module.slide.x === module.drawn) continue;
    module.drawn = module.slide.x;
    const position = state.P(module.slide.x, 0, 0);
    module.group.setAttribute(
      'transform',
      `translate(${position[0] - origin[0]} ${position[1] - origin[1]})`,
    );
  }
  return moving;
}
function retarget(state) {
  let nearest = state.modules[0],
    distance = Infinity;
  for (const module of state.modules) {
    const delta = state.over
      ? Math.hypot(module.y - state.over[0], module.z - state.over[1])
      : Infinity;
    module.slide.t = state.over ? 24 * Math.exp(-((delta / state.radius) ** 2)) : module.rest;
    if (!state.over && module.rest > nearest.rest) nearest = module;
    if (delta < distance) {
      nearest = module;
      distance = delta;
    }
  }
  for (const module of state.modules) {
    module.panel.setAttribute('class', module === nearest ? 'hi' : 'sil');
    module.lamp.setAttribute('class', module === nearest ? 'dot' : 'dot m');
  }
  state.read.textContent = state.over
    ? `rack ${nearest.rack + 1} · bay ${nearest.bay + 1}`
    : 'rest';
  state.loop.wake();
}
function move(state, point) {
  // Invert the fixed rack face, never the moving server fronts.
  const origin = state.P(12, 0, 0),
    across = state.P(12, 1, 0),
    up = state.P(12, 0, 1);
  const y = (point[0] - origin[0]) / (across[0] - origin[0]);
  const z = (point[1] - origin[1] - y * (across[1] - origin[1])) / (up[1] - origin[1]);
  state.over = [HL.clamp(y, 16, 144), HL.clamp(z, 12.4, 72.4)];
  retarget(state);
}
function leave(state) {
  state.over = null;
  retarget(state);
}
function set(state, radius) {
  state.radius = radius;
  retarget(state);
}
function view(P, x, y, z) {
  const point = P(x, y, z);
  return [400 - point[0], point[1]];
}
function mount({ stage, svg, read }, radius) {
  const C = HL.Cam(65, 0.3, 1.72);
  const bounds = [
    [-22, 0, 84],
    [32, 160, 0],
    [-22, 160, 84],
    [32, 0, 0],
  ];
  HL.fit(C, bounds, 200, 164);
  const P = view.bind(null, HL.proj(C)),
    front = HL.facing(C);
  const modules = [];
  // Racks run back to front; upper servers and near walls cover the parts behind them.
  for (let rack = 0; rack < 5; rack++) {
    const y = rack * 32;
    block(svg, P, front, -22, y, 14, y + 32, 0, 5, 1.4);
    block(svg, P, front, -22, y + 1, -20, y + 31, 5, 80, 0.7);
    block(svg, P, front, -20, y, 11, y + 2, 5, 80, 0.7);
    post(svg, P, front, y + 2);
    for (let bay = 0; bay < 6; bay++) modules.push(server(svg, P, front, rack, bay));
    block(svg, P, front, -20, y + 30, 11, y + 32, 5, 80, 0.7);
    post(svg, P, front, y + 30);
    block(svg, P, front, -22, y, 14, y + 32, 80, 84, 1.4);
  }
  const state = { P, modules, read, radius, over: null, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  retarget(state);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: leave.bind(null, state) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}
hairline({
  name: 'infrastructure-array',
  means:
    'Your infrastructure. Move across the rack wall to draw a wave of server modules out along their rails.',
  rules: [1, 3, 4, 5, 6, 7, 8, 9],
  range: [18, 30, 44],
  mount,
});
