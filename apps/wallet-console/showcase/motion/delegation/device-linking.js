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
  const dots = [];
  for (const u of [-9, 0, 9]) {
    screenPath(group, P, center, HL.rrect(u - 2.6, 43.4, u + 2.6, 48.6, 2.6, 16));
    dots.push(screenPath(group, P, center, HL.rrect(u - 2, 44, u + 2, 48, 2, 16), 'dot off'));
  }
  return { group, dots };
}
function matchingPattern(state, progress) {
  for (let index = 0; index < 3; index++) {
    const classes = progress >= 0.66 + index * 0.13 ? 'dot m' : 'dot off';
    state.fixed.dots[index].setAttribute('class', classes);
    state.moving.dots[index].setAttribute('class', classes);
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
  const confirmed = HL.clamp((progress - 0.66) / 0.34, 0, 1);
  const zero = state.P(0, 0, 0),
    raised = state.P(0, 0, lift);
  state.moving.group.setAttribute('transform', `translate(0 ${raised[1] - zero[1]})`);
  matchingPattern(state, progress);
  state.lamp.setAttribute('class', confirmed === 1 ? 'dot m' : 'dot off');
  state.read.textContent = state.active ? 'docking' : 'rest';
  if (state.active && progress >= 0.66) state.read.textContent = 'confirming';
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
  const C = HL.Cam(60, 0.28, 2.05);
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
  // The front lip hides the phone bottoms once seated in their recesses.
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
    motion: HL.tween(0, 1800),
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
  means: 'Hover to dock the second device; matching dots light on both screens after it seats.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [18, 23, 28],
  mount,
});
