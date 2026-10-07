/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function plane(P, depth, point) {
  return P(depth, -point.u, point.v);
}
function contour(P, depth, ring) {
  return ring.map(plane.bind(null, P, depth));
}
function leatherPoint(height, point) {
  const sag = 3.8 * (1 - (point.u / 47) ** 2);
  return { ...point, v: point.v - sag * HL.clamp((point.v - height + 6) / 6, 0, 1) };
}
function leatherRing(height, inset = 0) {
  return HL.rrect(-47 + inset, inset, 47 - inset, height - inset, 5, 12).map(
    leatherPoint.bind(null, height - inset),
  );
}
function stitches(points) {
  let result = '';
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let step = 0; step < count; step++) {
      const start = (step + 0.15) / count;
      const end = (step + 0.65) / count;
      result += HL.seg(
        [HL.lerp(a[0], b[0], start), HL.lerp(a[1], b[1], start)],
        [HL.lerp(a[0], b[0], end), HL.lerp(a[1], b[1], end)],
      );
    }
  }
  return result;
}
function pocket(svg, P, depth, height, sewn) {
  const ring = leatherRing(height);
  const back = contour(P, depth - 1.4, ring);
  const face = contour(P, depth, ring);
  path(svg, HL.poly(HL.hull(back.concat(face))), 'sil');
  path(svg, HL.poly(face), 'sil');
  path(svg, HL.poly(contour(P, depth + 0.05, leatherRing(height, 1.1))));
  if (sewn) path(svg, stitches(contour(P, depth + 0.1, leatherRing(height, 2.6))));
}
function gusset(P, depth, side, point) {
  return P(depth + point.u, -side * (47 + 2 * Math.sin((point.u / 6) * Math.PI)), point.v);
}
function pocketSides(svg, P, depth, height) {
  for (const side of [-1, 1]) {
    const ring = HL.rrect(0, 5, 6, height - 5, 1.5, 10);
    const project = gusset.bind(null, P, depth, side);
    path(svg, HL.poly(ring.map(project)), 'sil');
    path(svg, HL.poly(HL.rrect(0.8, 6, 5.2, height - 6, 1, 8).map(project)));
  }
}
function cardShape(index) {
  if (index !== 0) return HL.rrect(-42, -10, 42, 54, 3.5, 12);
  const vertices = [
    [-42, -10],
    [42, -10],
    [42, 49],
    [38, 49],
    [38, 54],
    [-42, 54],
  ];
  return HL.fillet(vertices, [3.5, 3.5, 1, 1.8, 1, 3.5], 10).map(asRingPoint);
}
function asRingPoint(point) {
  return { u: point[0], v: point[1] };
}
function cardPoint(P, depth, base, point) {
  return P(depth, -point.u, base + point.v);
}
function card(svg, P, index) {
  const depth = -11 + index * 6;
  const base = 45 - index * 11;
  const group = HL.mk('g', {}, svg);
  const ring = cardShape(index);
  const project = cardPoint.bind(null, P, depth, base);
  const front = ring.map(project);
  const back = ring.map(cardPoint.bind(null, P, depth - 0.9, base));
  path(group, HL.poly(HL.hull(back.concat(front))), 'sil');
  const face = path(group, HL.poly(front), index === 0 ? 'sil hi' : 'sil');
  const chip = HL.rrect(-31, 34, -19, 43, 1.5, 8);
  path(group, HL.poly(chip.map(project)));
  let contacts = '';
  for (const u of [-27, -23]) contacts += HL.seg(project({ u, v: 34 }), project({ u, v: 43 }));
  for (const v of [37, 40]) {
    contacts += HL.seg(project({ u: -31, v }), project({ u: -27, v }));
    contacts += HL.seg(project({ u: -23, v }), project({ u: -19, v }));
  }
  path(group, contacts);
  for (let mark = 0; mark < index + 1; mark++) {
    const u = 33 - mark * 4.5;
    path(group, HL.poly(HL.rrect(u - 0.8, 47, u + 0.8, 49, 0.8, 8).map(project)));
  }
  return { index, group, face, motion: HL.tween(0), drawn: NaN };
}
function tick(state, _dt, now) {
  let moving = false;
  for (const item of state.cards) {
    const lift = HL.tval(item.motion, now);
    if (lift !== item.drawn) {
      const origin = state.P(0, 0, 0);
      const raised = state.P(0, 0, lift);
      item.group.setAttribute('transform', `translate(0 ${raised[1] - origin[1]})`);
      item.drawn = lift;
    }
    if (!HL.tdone(item.motion, now)) moving = true;
  }
  return moving;
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  const now = performance.now();
  for (const item of state.cards) {
    const lift = active ? state.travel - item.index * 6 : 0;
    HL.tset(item.motion, lift, now, Math.abs(item.index - 1) * 55);
    item.face.classList.toggle('hi', item.index === (active ? 1 : 0));
  }
  state.read.textContent = active ? '3 access cards' : 'rest';
  state.loop.wake();
}
function set(state, travel) {
  state.travel = travel;
  if (!state.active) return;
  for (const item of state.cards)
    HL.tset(item.motion, travel - item.index * 6, performance.now(), 0);
  state.loop.wake();
}
function mount({ stage, svg, read }, travel) {
  const C = HL.Cam(45, 0.5, 1.9);
  HL.fit(
    C,
    [
      [-15, -47, 135],
      [-15, 47, 0],
      [10, -47, 0],
      [10, 47, 135],
    ],
    200,
    155,
  );
  const P = HL.proj(C);
  pocket(svg, P, -15, 86, true);
  const cards = [];
  for (let index = 0; index < 3; index++) {
    const depth = -15 + index * 6;
    const height = 78 - index * 9;
    pocketSides(svg, P, depth, height);
    cards.push(card(svg, P, index));
    pocket(svg, P, depth + 6, height, index === 2);
  }
  const state = { P, cards, read, travel, active: null, loop: null };
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
  name: 'access-cards',
  means:
    'One wallet, three access cards. Hover to raise them; move away to slide them back into their pockets.',
  rules: [1, 2, 4, 6, 7, 8, 9],
  range: [24, 30, 36],
  mount,
});
