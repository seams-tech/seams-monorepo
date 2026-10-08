/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function keyView(P, x0, y0, angle, x, y, z) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return P(x0 + x * c - y * s, y0 + x * s + y * c, z);
}
function cylinder(solid, P, front, radius, low, high) {
  HL.put(solid, HL.prism(P, front, HL.circ(radius, 64), HL.circ(radius - 0.7, 64), low, high));
}
function shaft(solid, P, front, bounds, low, high) {
  solid.g.setAttribute('display', high > 31.1 ? 'inline' : 'none');
  HL.put(
    solid,
    HL.prism(P, front, ...HL.rings(...bounds, 0.5, 0.3), Math.max(31.1, low), Math.max(31.1, high)),
  );
}
function drawKey(state, key, progress) {
  const insertion = key.index < 2 ? HL.clamp((progress - key.index * 0.02) / 0.18, 0, 1) : 0;
  const rotation = key.index < 2 ? HL.clamp((progress - 0.23 - key.index * 0.02) / 0.18, 0, 1) : 0;
  const angle = HL.rad(key.restAngle + rotation * 90);
  const height = 42 - insertion * state.travel;
  const P = keyView.bind(null, state.P, key.x, key.y, angle);
  const facingAngle = angle + state.angle;
  const front = HL.facing(HL.Cam(45 - (facingAngle * 180) / Math.PI, 0.5, 1));
  const Q = keyView.bind(null, state.P, key.x, key.y, 0);
  for (const part of key.socket)
    cylinder(part.solid, Q, state.front, part.radius, part.low, part.high);
  shaft(key.shaft, P, front, [-3, -2, 3, 2], height, height + 14);
  const toothHeight = height + 4 + key.index * 2;
  shaft(key.tooth, P, front, [2.5, -2, 5, 2], toothHeight, toothHeight + 3);
  if (Math.cos(facingAngle) + Math.sin(facingAngle) > 0) key.tooth.g.after(key.shaft.g);
  else key.shaft.g.after(key.tooth.g);
  HL.put(
    key.head,
    HL.prism(P, front, ...HL.rings(-10, -4, 10, 4, 2, 0.7), height + 14, height + 28),
  );
  key.slot.setAttribute('d', HL.poly(HL.ringAt(P, HL.rrect(-5, -2.4, 5, 2.4, 0.8, 8), 31.1)));
}
function depthOrder(a, b) {
  return a.depth - b.depth;
}
function transaction(state, progress) {
  const lift = 10 * HL.clamp((progress - 0.68) / 0.1, 0, 1);
  const output = HL.clamp((progress - 0.82) / 0.18, 0, 1);
  const floor = 12 + lift;
  const top = floor + 40 * output;
  const bottom = Math.max(floor, top - 18);
  HL.put(state.seal, HL.prism(state.P, state.front, HL.circ(14, 48), HL.circ(13, 48), 7, floor));
  state.seal.sil.setAttribute('class', output > 0 ? 'sil' : 'hi');
  state.block.g.setAttribute('display', output > 0 ? 'inline' : 'none');
  HL.put(
    state.block,
    HL.prism(state.P, state.front, ...HL.rings(-7, -7, 7, 7, 1.6, 0.6), bottom, top),
  );
  state.block.sil.setAttribute('class', 'hi');
  let marks = '';
  for (const drop of [4, 7, 10, 13]) {
    if (top - drop <= floor) continue;
    const length = drop === 10 ? 2 : 4.5;
    marks += HL.seg(state.P(7.1, -4.5, top - drop), state.P(7.1, length, top - drop));
  }
  marks += HL.poly(HL.ringAt(state.P, HL.rrect(-3, -3, 3, 3, 1, 8), top + 0.1));
  state.inscriptions.setAttribute('d', marks);
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  state.angle = HL.rad(70 * HL.clamp((progress - 0.46) / 0.18, 0, 1));
  state.P = keyView.bind(null, state.baseP, 0, 0, state.angle);
  state.front = HL.facing(HL.Cam(45 - (state.angle * 180) / Math.PI, 0.5, 1));
  let ticks = '';
  for (let index = 0; index < 36; index++) {
    const angle = (index * Math.PI) / 18;
    ticks += HL.seg(
      state.P(59 * Math.cos(angle), 59 * Math.sin(angle), 7.1),
      state.P(62 * Math.cos(angle), 62 * Math.sin(angle), 7.1),
    );
  }
  state.ticks.setAttribute('d', ticks);
  const parts = [{ group: state.center, depth: state.P(0, 0, 0)[1] }];
  for (const key of state.keys) {
    drawKey(state, key, progress);
    parts.push({ group: key.group, depth: state.P(key.x, key.y, 0)[1] });
  }
  transaction(state, progress);
  parts.sort(depthOrder);
  for (const part of parts) state.objects.appendChild(part.group);
  state.read.textContent = state.active ? 'inserting' : 'rest';
  if (state.active && progress >= 0.23) state.read.textContent = 'turning';
  if (state.active && progress >= 0.46) state.read.textContent = 'rotating';
  if (state.active && progress >= 0.68) state.read.textContent = 'raising';
  if (state.active && progress >= 0.82) state.read.textContent = 'issuing';
  if (state.active && progress === 1) state.read.textContent = 'signed';
  return !HL.tdone(state.motion, now);
}
function select(state, active) {
  state.active = active;
  HL.tset(state.motion, active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
}
function set(state, travel) {
  state.travel = travel;
  state.drawn = NaN;
  state.loop.wake();
}
function socket(parent) {
  const parts = [];
  for (const [radius, low, high] of [
    [10, 7, 30],
    [7.6, 30, 31],
  ]) {
    parts.push({ solid: HL.solid(parent), radius, low, high });
  }
  return parts;
}
function mount({ stage, svg, read }, travel) {
  const C = HL.Cam(45, 0.5, 1.85);
  const bounds = [
    [-65, -65, 0],
    [65, 65, 0],
    [-28, -20, 72],
  ];
  HL.fit(C, bounds, 200, 166);
  const P = HL.proj(C),
    front = HL.facing(C);
  HL.put(HL.solid(svg), HL.prism(P, front, HL.circ(65, 96), HL.circ(63.5, 96), 0, 7));
  const ticks = path(svg, '');
  const objects = HL.mk('g', {}, svg);
  const center = HL.mk('g', {}, objects);
  const seal = HL.solid(center),
    block = HL.solid(center),
    inscriptions = path(block.g, '');
  const keys = [];
  const locations = [
    [-27, -20, -20],
    [27, -19, 15],
    [0, 33, -12],
  ];
  for (let index = 0; index < 3; index++) {
    const [x, y, restAngle] = locations[index];
    const group = HL.mk('g', {}, objects);
    const housing = socket(group);
    const slot = path(group, '', 'sil');
    keys.push({
      index,
      group,
      socket: housing,
      x,
      y,
      restAngle,
      slot,
      shaft: HL.solid(group),
      tooth: HL.solid(group),
      head: HL.solid(group),
    });
  }
  const state = {
    P,
    baseP: P,
    angle: 0,
    front,
    ticks,
    objects,
    center,
    block,
    inscriptions,
    read,
    keys,
    seal,
    travel,
    motion: HL.tween(0, 3600),
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
  means: 'Insert, turn, rotate. The platform issues a signed transaction block.',
  rules: [1, 3, 4, 5, 6, 7, 8, 9],
  range: [22, 23, 24],
  mount,
});
