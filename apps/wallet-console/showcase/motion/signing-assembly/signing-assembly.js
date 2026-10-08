/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function local(P, angle, offset, x, y, z) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return P((x + offset) * c - y * s, (x + offset) * s + y * c, z);
}
function depthOrder(a, b) {
  return a.depth - b.depth;
}
function drawModule(state, module, angle, engagement) {
  const theta = angle + (module.index * Math.PI * 2) / 3;
  const slide = module.index < 2 ? engagement * 11 : 0;
  const P = local.bind(null, state.P, theta, -slide);
  const C = HL.Cam(45 - (theta * 180) / Math.PI, 0.5, 1);
  const front = HL.facing(C);
  const group = module.group;
  // Geometry is redrawn only while its pose changes; every face stays opaque.
  HL.put(
    module.body,
    HL.prism(P, front, ...HL.rings(34, -10, 54, 10, 3, 0.8), 7, 30 + module.index * 3),
  );
  HL.put(module.tongue, HL.prism(P, front, ...HL.rings(26, -3, 37, 3, 1, 0.5), 13, 17));
  let cuts = '';
  for (const x of [40, 44, 48])
    cuts += HL.seg(P(x, -5, 30.2 + module.index * 3), P(x, 5, 30.2 + module.index * 3));
  module.vents.setAttribute('d', cuts);
  let marks = '';
  for (let index = 0; index <= module.index; index++) {
    marks += HL.poly(
      HL.ringAt(
        P,
        HL.rrect(36 + index * 4, -7, 37.2 + index * 4, -5.8, 0.6, 8),
        30.3 + module.index * 3,
      ),
    );
  }
  module.marks.setAttribute('d', marks);
  module.body.sil.setAttribute('class', 'sil');
  module.depth = state.P((44 - slide) * Math.cos(theta), (44 - slide) * Math.sin(theta), 0)[1];
  state.parts.push({ group, depth: module.depth });
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const angle = HL.rad(-state.turn * (1 - HL.clamp(progress / 0.45, 0, 1)));
  const engagement = HL.clamp((progress - 0.52) / 0.32, 0, 1);
  const lift = 7 * HL.clamp((progress - 0.87) / 0.13, 0, 1);
  const P = local.bind(null, state.P, angle, 0);
  let ticks = '',
    tracks = '';
  for (let index = 0; index < 36; index++) {
    const a = (index * Math.PI) / 18;
    ticks += HL.seg(
      P(61 * Math.cos(a), 61 * Math.sin(a), 7.1),
      P(64 * Math.cos(a), 64 * Math.sin(a), 7.1),
    );
  }
  for (let index = 0; index < 3; index++) {
    const Q = local.bind(null, state.P, angle + (index * Math.PI * 2) / 3, 0);
    for (const y of [-6, 6]) tracks += HL.seg(Q(20, y, 7.2), Q(57, y, 7.2));
  }
  state.ticks.setAttribute('d', ticks);
  state.tracks.setAttribute('d', tracks);
  state.parts = [];
  for (const module of state.modules) drawModule(state, module, angle, engagement);
  HL.put(state.hub, HL.prism(state.P, state.front, HL.circ(19, 64), HL.circ(18, 64), 7, 20));
  HL.put(
    state.seal,
    HL.prism(state.P, state.front, HL.circ(11, 48), HL.circ(10, 48), 20, 22 + lift),
  );
  state.seal.sil.setAttribute('class', 'hi');
  state.parts.push({ group: state.center, depth: state.P(0, 0, 0)[1] });
  state.parts.sort(depthOrder);
  for (const part of state.parts) state.objects.appendChild(part.group);
  state.read.textContent = state.active ? 'aligning' : 'rest';
  if (state.active && progress >= 0.52) state.read.textContent = '2 of 3';
  if (state.active && progress === 1) state.read.textContent = 'signed';
  return !HL.tdone(state.motion, now);
}
function select(state, active) {
  state.active = active;
  HL.tset(state.motion, active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
}
function set(state, turn) {
  state.turn = turn;
  state.drawn = NaN;
  state.loop.wake();
}
function mount({ stage, svg, read }, turn) {
  const C = HL.Cam(45, 0.5, 1.95);
  HL.fit(
    C,
    [
      [-69, -69, 0],
      [69, 69, 0],
      [0, 0, 43],
    ],
    200,
    165,
  );
  const P = HL.proj(C),
    front = HL.facing(C);
  HL.put(HL.solid(svg), HL.prism(P, front, HL.circ(68, 96), HL.circ(66.5, 96), 0, 7));
  const ticks = path(svg, ''),
    tracks = path(svg, '');
  const objects = HL.mk('g', {}, svg),
    modules = [];
  for (let index = 0; index < 3; index++) {
    const group = HL.mk('g', {}, objects);
    const tongue = HL.solid(group),
      body = HL.solid(group);
    modules.push({
      index,
      group,
      tongue,
      body,
      depth: 0,
      vents: path(group, ''),
      marks: path(group, '', 'dot m'),
    });
  }
  const center = HL.mk('g', {}, objects),
    hub = HL.solid(center),
    seal = HL.solid(center);
  const state = {
    P,
    front,
    read,
    ticks,
    tracks,
    objects,
    modules,
    center,
    hub,
    seal,
    turn,
    parts: [],
    motion: HL.tween(0, 1800),
    drawn: NaN,
    active: false,
    loop: null,
  };
  state.loop = HL.register(stage, tick.bind(null, state));
  state.loop.wake();
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
  name: 'signing-assembly',
  means:
    'Independent signers, one result. Hover to align the platform and engage two of its three signing modules.',
  rules: [1, 3, 4, 5, 6, 7, 8, 9],
  range: [20, 32, 44],
  mount,
});
