/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function block(parent, P, front, x0, y0, x1, y1, low, high, radius = 1) {
  const solid = HL.solid(parent);
  HL.put(solid, HL.prism(P, front, ...HL.rings(x0, y0, x1, y1, radius, 0.6), low, high));
}
function screenPoint(P, center, point) {
  return P(3.1, center + point.u, point.v);
}
function screenPath(parent, P, center, ring, classes = 'lo nf') {
  return path(parent, HL.poly(ring.map(screenPoint.bind(null, P, center))), classes);
}
function phone(parent, P, center, active) {
  const group = HL.mk('g', {}, parent);
  const ring = HL.rrect(-21, 4, 21, 88, 5, 12);
  const front = ring.map(screenPoint.bind(null, P, center));
  const back = [];
  for (const point of ring) back.push(P(-3, center + point.u, point.v));
  path(group, HL.poly(HL.hull(back.concat(front))), 'sil');
  path(group, HL.poly(front), active ? 'hi' : 'sil');
  screenPath(group, P, center, HL.rrect(-18.5, 7, 18.5, 85, 3.8, 12));
  screenPath(group, P, center, HL.rrect(-4, 80, 4, 81.3, 0.65, 8));
  screenPath(group, P, center, HL.rrect(-5, 10, 5, 10.8, 0.4, 8));
  return { group, symbol: linkingSymbol(group, P, center) };
}
function linkingSymbol(parent, P, center) {
  const origin = P(3.1, center, 46);
  const u = P(3.1, center + 1, 46);
  const v = P(3.1, center, 45);
  const matrix = [
    u[0] - origin[0],
    u[1] - origin[1],
    v[0] - origin[0],
    v[1] - origin[1],
    ...origin,
  ];
  const group = HL.mk('g', { transform: `matrix(${matrix.join(' ')})` }, parent);
  const assembly = HL.mk('g', { transform: 'rotate(-35)' }, group);
  const clipId = `link-upper-${center < 0 ? 'first' : 'second'}`;
  const clip = HL.mk('clipPath', { id: clipId }, HL.mk('defs', {}, assembly));
  HL.mk('rect', { x: -20, y: -10, width: 40, height: 10 }, clip);
  const left = chainLink(assembly, 'left');
  const right = chainLink(assembly, 'right');
  // Alternate the crossing order: the left link passes above at the upper crossing.
  const crossing = HL.mk('g', { 'clip-path': `url(#${clipId})` }, assembly);
  const upper = chainLink(crossing, 'upper');
  return { left, right, upper };
}
function chainLink(parent, name) {
  const transform = name === 'right' ? 'translate(4.5 0) rotate(180)' : 'translate(-4.5 0)';
  const group = HL.mk('g', { 'data-link': name, transform }, parent);
  const body = path(group, '', 'lo');
  const gate = path(group, '', 'lo');
  gate.setAttribute('data-part', 'gate');
  body.setAttribute('data-part', 'body');
  return { group, body, gate };
}
function linkBand(progress, gate) {
  if (progress === 0) return '';
  const outer = [],
    inner = [];
  const arcLength = Math.PI * 3.8;
  const length = gate ? arcLength : 9.6 + arcLength;
  for (let step = 0; step <= 48; step++) {
    const distance = ((progress * step) / 48) * length;
    const arc = gate ? distance : -HL.clamp(distance - 4.8, 0, arcLength);
    const angle = -Math.PI / 2 + arc / 3.8;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const straight = Math.max(0, 4.8 - distance) + Math.max(0, distance - 4.8 - arcLength);
    const center = gate ? 2.4 : -2.4 + straight;
    const x = center + 3.8 * nx;
    const y = 3.8 * ny;
    outer.push([x + 0.8 * nx, y + 0.8 * ny]);
    inner.unshift([x - 0.8 * nx, y - 0.8 * ny]);
  }
  return HL.poly(outer.concat(inner));
}
function matchingPattern(phone, progress) {
  const draw = HL.EASE_LIFT(HL.clamp((progress - 0.56) / 0.2, 0, 1));
  const gateDraw = HL.EASE_LIFT(HL.clamp((progress - 0.72) / 0.1, 0, 1));
  const clamp = HL.EASE_LIFT(HL.clamp((progress - 0.82) / 0.12, 0, 1));
  const body = linkBand(HL.lerp(0.58, 1, draw), false);
  const gate = linkBand(gateDraw, true);
  for (const link of [phone.symbol.left, phone.symbol.right, phone.symbol.upper]) {
    link.body.setAttribute('d', body);
    link.gate.setAttribute('d', gate);
    link.gate.setAttribute('transform', `rotate(${-52 * (1 - clamp)} 2.4 -3.8)`);
    link.group.setAttribute('data-draw', draw);
    link.group.setAttribute('data-clamp', clamp);
    for (const part of [link.body, link.gate]) {
      part.setAttribute('class', clamp === 1 ? 'sil' : 'lo');
    }
  }
}
function base(parent, P, front) {
  block(parent, P, front, -14, -56, 16, 56, 0, 8, 4);
  for (const center of [-28, 28]) {
    const rim = HL.rrect(-6, center - 23, 6, center + 23, 3, 12);
    path(parent, HL.poly(HL.ringAt(P, rim, 8)), 'sil');
    const inner = HL.rrect(-4.5, center - 21.8, 4.5, center + 21.8, 2.2, 12);
    path(parent, HL.poly(HL.ringAt(P, inner, 4)), 'sil');
    block(parent, P, front, -1.3, center - 3, 1.3, center + 3, 4, 10, 0.8);
  }
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const lift = state.travel * (1 - HL.clamp(progress / 0.56, 0, 1));
  const zero = state.P(0, 0, 0),
    raised = state.P(0, 0, lift);
  state.moving.group.setAttribute('transform', `translate(0 ${raised[1] - zero[1]})`);
  matchingPattern(state.fixed, progress);
  matchingPattern(state.moving, progress);
  state.lamp.setAttribute('class', progress === 1 ? 'dot m' : 'dot off');
  state.read.textContent = state.active ? 'docking' : 'rest';
  if (state.active && progress >= 0.56)
    state.read.textContent = progress < 0.82 ? 'linking' : 'clamping';
  if (state.active && progress === 1) state.read.textContent = 'linked';
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
function view(P, x, y, z) {
  const point = P(x, y, z);
  return [400 - point[0], point[1]];
}
function mount({ stage, svg, read }, travel) {
  const C = HL.Cam(45, 0.5, 2.05);
  HL.fit(
    C,
    [
      [-14, -56, 116],
      [16, 56, 0],
      [-14, 56, 0],
      [16, -56, 116],
    ],
    200,
    160,
  );
  const P = view.bind(null, HL.proj(C));
  const front = HL.facing(C);
  base(svg, P, front);
  const fixed = phone(svg, P, -28, false);
  const moving = phone(svg, P, 28, true);
  block(svg, P, front, 6, -55, 16, 55, 0, 8, 2);
  for (const center of [-28, 28]) {
    const ring = HL.rrect(10, center - 0.9, 11.8, center + 0.9, 0.9, 8);
    path(svg, HL.poly(HL.ringAt(P, ring, 8.1)), 'lo nf');
  }
  const lamp = path(
    svg,
    HL.poly(HL.ringAt(P, HL.rrect(10.3, 27.4, 11.5, 28.6, 0.6, 8), 8.2)),
    'dot off',
  );
  const state = {
    P,
    fixed,
    moving,
    lamp,
    read,
    travel,
    motion: HL.tween(0, 2400),
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
  name: 'device-linking',
  means: 'Dock the second device; open links draw into place and clamp shut on both screens.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [18, 23, 28],
  mount,
});
