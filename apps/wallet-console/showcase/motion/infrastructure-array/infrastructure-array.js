/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function restHeight(x, y) {
  return (
    16 +
    21 * Math.exp(-((x - 30) ** 2 + (y - 70) ** 2) / 650) +
    10 * Math.exp(-((x - 80) ** 2 + (y - 20) ** 2) / 350)
  );
}
function drawModule(state, module) {
  const height = module.height.x;
  if (height === module.drawn) return;
  module.drawn = height;
  HL.put(module.body, HL.prism(state.P, state.front, module.ring, module.inner, 0, height));
  let vents = '';
  for (const offset of [-4, 0, 4]) {
    vents += HL.seg(
      state.P(module.x - 5, module.y + offset, height + 0.1),
      state.P(module.x + 5, module.y + offset, height + 0.1),
    );
  }
  module.vents.setAttribute('d', vents);
  let bays = '';
  for (const drop of [5, 9]) {
    bays += HL.seg(
      state.P(module.x + 8.6, module.y - 5, height - drop),
      state.P(module.x + 8.6, module.y + 5, height - drop),
    );
  }
  module.bays.setAttribute('d', bays);
  HL.place(module.lamp, state.P(module.x + 8.7, module.y + 5, height - 12));
}
function tick(state, dt) {
  let moving = false;
  for (const module of state.modules) {
    if (HL.stepS(module.height, dt)) moving = true;
    drawModule(state, module);
  }
  return moving;
}
function retarget(state) {
  let nearest = state.modules[0];
  let distance = Infinity;
  for (const module of state.modules) {
    const delta = state.over
      ? Math.hypot(module.x - state.over[0], module.y - state.over[1])
      : Infinity;
    module.height.t = state.over ? 15 + 37 * Math.exp(-((delta / state.radius) ** 2)) : module.rest;
    if (!state.over && module.rest > nearest.rest) nearest = module;
    if (delta < distance) {
      nearest = module;
      distance = delta;
    }
  }
  for (const module of state.modules) {
    module.body.sil.setAttribute('class', module === nearest ? 'hi' : 'sil');
    module.lamp.setAttribute('class', module === nearest ? 'dot' : 'dot m');
  }
  state.read.textContent = state.over ? `node ${nearest.i + 1}·${nearest.j + 1}` : 'rest';
  state.loop.wake();
}
function move(state, point) {
  let closest = null;
  let distance = Infinity;
  for (const module of state.modules) {
    const world = HL.unproj(state.C, point[0], point[1], module.rest);
    const delta = Math.hypot(world[0] - module.x, world[1] - module.y);
    if (delta < distance) {
      closest = world;
      distance = delta;
    }
  }
  state.over = [HL.clamp(closest[0], 10, 98), HL.clamp(closest[1], 10, 98)];
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
function mount({ stage, svg, read }, radius) {
  const C = HL.Cam(45, 0.5, 1.75);
  HL.fit(
    C,
    [
      [-3, -3, -6],
      [111, 111, -6],
      [111, -3, 52],
      [-3, 111, 52],
    ],
    200,
    164,
  );
  const P = HL.proj(C),
    front = HL.facing(C);
  HL.put(HL.solid(svg), HL.prism(P, front, ...HL.rings(-3, -3, 111, 111, 6, 1.5), -6, 0));
  const modules = [];
  for (let diagonal = 0; diagonal <= 8; diagonal++) {
    for (let i = 0; i < 5; i++) {
      const j = diagonal - i;
      if (j < 0 || j > 4) continue;
      const x = 10 + i * 22,
        y = 10 + j * 22;
      const [ring, inner] = HL.rings(x - 8.5, y - 8.5, x + 8.5, y + 8.5, 2.5, 0.8);
      const group = HL.mk('g', {}, svg);
      const rest = restHeight(x, y);
      modules.push({
        i,
        j,
        x,
        y,
        ring,
        inner,
        rest,
        height: HL.spring(rest),
        drawn: NaN,
        body: HL.solid(group),
        vents: HL.mk('path', { class: 'lo nf' }, group),
        bays: HL.mk('path', { class: 'lo nf' }, group),
        lamp: HL.mk('circle', { r: 0.7, class: 'dot m' }, group),
      });
    }
  }
  const state = { C, P, front, modules, read, radius, over: null, loop: null };
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
    'Your infrastructure, at your fingertips. Move across the array to raise a wave of server modules.',
  rules: [1, 3, 4, 5, 6, 7, 8, 9],
  range: [22, 34, 48],
  mount,
});
