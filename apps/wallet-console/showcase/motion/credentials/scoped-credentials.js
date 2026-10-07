/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// Two cut keys rotate on one fixed shoulder pin; their metal never separates.
const {
  Cam,
  clamp,
  fillet,
  fit,
  poly,
  open,
  proj,
  rad,
  rrect,
  ringAt,
  seg,
  spring,
  stepS,
  mk,
  pointer,
  register,
  disposer,
} = HL;
const REST = 14;

function bow(radius) {
  const points = [];
  for (let step = 0; step <= 64; step++) {
    const angle = rad(109.47 + (321.06 * step) / 64);
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return points;
}

function outline(index) {
  const points = [
    [8, 22.63],
    [8, 55],
  ];
  const cuts = index === 0 ? [3, 7, 4, 9, 5] : [8, 3, 7, 4, 9];
  for (let tooth = 0; tooth < cuts.length; tooth++) {
    const y = 58 + tooth * 11;
    points.push([cuts[tooth], y], [cuts[tooth], y + 5], [11, y + 8]);
  }
  points.push([11, 117], [5, 125], [-7, 125], [-9, 121], [-9, 29], [-8, 22.63]);
  const radii = Array(points.length).fill(1);
  return fillet(points, radii).concat(bow(24));
}

function projectKey(P, angle, z, point) {
  const cosine = Math.cos(rad(angle));
  const sine = Math.sin(rad(angle));
  return P(point[0] * cosine - point[1] * sine, point[0] * sine + point[1] * cosine, z);
}

function keyAngle(index, spread) {
  return index === 0 ? -spread - 12 : spread - 12;
}

function keyPath(P, angle, z, points) {
  return poly(points.map(projectKey.bind(null, P, angle, z)));
}

function makeKey(svg, index) {
  const group = mk('g', {}, svg);
  const back = mk('path', { class: 'lo' }, group);
  const face = mk('path', { class: index === 1 ? 'sil hi' : 'sil' }, group);
  const engraving = mk('path', { class: 'nf lo' }, group);
  const groove = mk('path', { class: 'nf' }, group);
  return { index, shape: outline(index), back, face, engraving, groove };
}

function drawKey(state, key) {
  const angle = keyAngle(key.index, state.spread.x);
  const z = 3 + key.index * 3;
  const projection = projectKey.bind(null, state.P, angle, z);
  key.back.setAttribute('d', keyPath(state.P, angle, z - 2.2, key.shape));
  key.face.setAttribute('d', keyPath(state.P, angle, z, key.shape));
  let marks = open(bow(19).map(projection));
  for (let mark = 0; mark < 3; mark++) {
    marks += seg(projection([-11 + mark * 4, 10]), projection([-11 + mark * 4, 14]));
  }
  key.engraving.setAttribute('d', marks);
  const channel = [
    [-5, 30],
    [-5, 116],
    [-2, 119],
    [0, 116],
    [0, 32],
  ];
  key.groove.setAttribute('d', open(channel.map(projection)));
}

function tick(state, dt) {
  const moving = stepS(state.spread, dt);
  if (state.drawn !== state.spread.x) {
    for (const key of state.keys) drawKey(state, key);
    state.drawn = state.spread.x;
  }
  return moving;
}

function move(state, point) {
  state.spread.t = REST + clamp((point[0] - 80) / 240, 0, 1) * state.maximum;
  state.read.textContent = 'key pair';
  state.loop.wake();
}

function leave(state) {
  state.spread.t = REST;
  state.read.textContent = 'rest';
  state.loop.wake();
}

function set(state, maximum) {
  const fraction = (state.spread.t - REST) / state.maximum;
  state.maximum = maximum;
  state.spread.t = REST + fraction * maximum;
  state.loop.wake();
}

function pivot(svg, P) {
  const washer = rrect(-8, -8, 8, 8, 8, 12);
  mk('path', { d: poly(ringAt(P, washer, 6.3)), class: 'lo' }, svg);
  mk('path', { d: poly(ringAt(P, washer, 8)), class: 'sil' }, svg);
  const head = rrect(-5.5, -5.5, 5.5, 5.5, 5.5, 12);
  mk('path', { d: poly(ringAt(P, head, 8.4)), class: 'nf lo' }, svg);
  mk('path', { d: seg(P(-3, 0, 8.5), P(3, 0, 8.5)), class: 'nf' }, svg);
}

function worldPoint(x, y, z) {
  return [x, y, z];
}

function cameraBounds(keys) {
  const bounds = [];
  for (const key of keys) {
    for (const spread of [REST, 26, 38, 48]) {
      const angle = keyAngle(key.index, spread);
      bounds.push(...key.shape.map(projectKey.bind(null, worldPoint, angle, 3)));
    }
  }
  return bounds;
}

function mount({ stage, svg, read }, maximum) {
  const C = Cam(45, 0.5, 1.95);
  const keys = [makeKey(svg, 0), makeKey(svg, 1)];
  fit(C, cameraBounds(keys), 200, 166);
  const P = proj(C);
  pivot(svg, P);
  const state = { P, keys, read, maximum, spread: spring(REST), drawn: null, loop: null };
  state.loop = register(stage, tick.bind(null, state));
  read.textContent = 'rest';
  const bag = disposer();
  bag.add(state.loop.unregister);
  bag.add(pointer(stage, { move: move.bind(null, state), leave: leave.bind(null, state) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'scoped-credentials',
  means: 'Two keys on one pivot: move across to fan them apart and reveal their distinct cuts.',
  rules: [1, 3, 6, 8, 9],
  range: [14, 24, 34],
  mount,
});
