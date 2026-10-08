/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function keyView(P, x0, y0, angle, x, y, z) {
  return P(
    x0 + x * Math.cos(angle) - y * Math.sin(angle),
    y0 + x * Math.sin(angle) + y * Math.cos(angle),
    z,
  );
}
function bladePoint(P, y, height, point) {
  return P(point[0], y, height + point[1]);
}
function exposedBlade(shape, floor) {
  const points = [];
  for (let index = 0; index < shape.length; index++) {
    const a = shape[index],
      b = shape[(index + 1) % shape.length];
    if (a[1] >= floor) points.push(a);
    if (a[1] >= floor !== b[1] >= floor) {
      points.push([HL.lerp(a[0], b[0], (floor - a[1]) / (b[1] - a[1])), floor]);
    }
  }
  return points;
}
function blade(P, angle, height, shape) {
  const nearY = Math.cos(angle) - Math.sin(angle) > 0 ? 2 : -2;
  const near = shape.map(bladePoint.bind(null, P, nearY, height));
  const far = shape.map(bladePoint.bind(null, P, -nearY, height));
  let sides = '';
  for (let index = 0; index < shape.length; index++) {
    const next = (index + 1) % shape.length;
    const normal = (shape[next][1] - shape[index][1]) * (Math.cos(angle) + Math.sin(angle));
    if (normal > 0) sides += HL.poly([near[index], far[index], far[next], near[next]]);
  }
  return { sides, face: HL.poly(near) };
}
function drawKey(state, key, progress) {
  const active = key.index < 2;
  const insertion = active ? HL.clamp((progress - key.index * 0.05) / 0.4, 0, 1) : 0;
  const rotation = active ? HL.clamp((progress - 0.54 - key.index * 0.04) / 0.28, 0, 1) : 0;
  const angle = HL.rad(key.restAngle + rotation * 90);
  const height = 42 - insertion * state.travel;
  const P = keyView.bind(null, state.P, key.x, key.y, angle);
  const front = HL.facing(HL.Cam(45 - (angle * 180) / Math.PI, 0.5, 1));
  const geometry = blade(P, angle, height, exposedBlade(key.shape, 31.1 - height));
  key.sides.setAttribute('d', geometry.sides);
  key.face.setAttribute('d', geometry.face);
  HL.put(
    key.head,
    HL.prism(P, front, ...HL.rings(-10, -4, 10, 4, 2, 0.7), height + 14, height + 28),
  );
  let detail = '';
  const nearY = Math.cos(angle) - Math.sin(angle) > 0 ? 4.1 : -4.1;
  for (const z of [19, 22]) detail += HL.seg(P(-6, nearY, height + z), P(6, nearY, height + z));
  key.grip.setAttribute('d', detail);
  let marks = '';
  for (let index = 0; index <= key.index; index++) {
    marks += HL.poly(
      HL.ringAt(P, HL.rrect(-4 + index * 4, -0.6, -2.8 + index * 4, 0.6, 0.6, 8), height + 28.1),
    );
  }
  key.marks.setAttribute('d', marks);
  // The plug and its opening rotate with the inserted key inside the fixed housing.
  key.slot.setAttribute('d', HL.poly(HL.ringAt(P, HL.rrect(-5, -2.4, 5, 2.4, 0.8, 8), 31.1)));
  key.head.sil.setAttribute('class', 'sil');
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  for (const key of state.keys) drawKey(state, key, progress);
  const lift = 6 * HL.clamp((progress - 0.9) / 0.1, 0, 1);
  HL.put(state.seal, HL.prism(state.P, state.front, HL.circ(9, 48), HL.circ(8, 48), 10, 12 + lift));
  state.seal.sil.setAttribute('class', 'hi');
  state.read.textContent = state.active ? 'inserting' : 'rest';
  if (state.active && progress >= 0.54) state.read.textContent = 'turning';
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
function socket(parent, P, front, x, y) {
  const Q = keyView.bind(null, P, x, y, 0);
  HL.put(HL.solid(parent), HL.prism(Q, front, HL.circ(12, 48), HL.circ(11, 48), 7, 10));
  HL.put(HL.solid(parent), HL.prism(Q, front, HL.circ(10, 48), HL.circ(9.3, 48), 10, 30));
  HL.put(HL.solid(parent), HL.prism(Q, front, HL.circ(7.6, 48), HL.circ(7, 48), 30, 31));
  return path(parent, '', 'sil');
}
function mount({ stage, svg, read }, travel) {
  const C = HL.Cam(45, 0.5, 1.85);
  HL.fit(
    C,
    [
      [-65, -65, 0],
      [65, 65, 0],
      [-28, -20, 72],
      [30, 25, 72],
    ],
    200,
    166,
  );
  const P = HL.proj(C),
    front = HL.facing(C);
  HL.put(HL.solid(svg), HL.prism(P, front, HL.circ(65, 96), HL.circ(63.5, 96), 0, 7));
  let ticks = '';
  for (let index = 0; index < 36; index++) {
    const angle = (index * Math.PI) / 18;
    ticks += HL.seg(
      P(59 * Math.cos(angle), 59 * Math.sin(angle), 7.1),
      P(62 * Math.cos(angle), 62 * Math.sin(angle), 7.1),
    );
  }
  path(svg, ticks);
  const keys = [];
  const locations = [
    [-27, -20, -20],
    [27, -19, 15],
    [0, 33, -12],
  ];
  let seal;
  for (let index = 0; index < 3; index++) {
    if (index === 2) {
      HL.put(HL.solid(svg), HL.prism(P, front, HL.circ(15, 48), HL.circ(14, 48), 7, 10));
      seal = HL.solid(svg);
    }
    const [x, y, restAngle] = locations[index];
    const group = HL.mk('g', {}, svg);
    const slot = socket(group, P, front, x, y);
    const notch = 4 + index * 2;
    const corners = [
      [-3, 0],
      [3, 0],
      [3, notch],
      [5, notch],
      [5, notch + 3],
      [3, notch + 3],
      [3, 14],
      [-3, 14],
    ];
    const shape = HL.fillet(corners, [0.7, 0.7, 0.4, 0.4, 0.4, 0.4, 0.5, 0.5]);
    keys.push({
      index,
      x,
      y,
      restAngle,
      shape,
      slot,
      sides: path(group, '', 'lo'),
      face: path(group, '', 'sil'),
      head: HL.solid(group),
      grip: path(group, ''),
      marks: path(group, '', 'dot m'),
    });
  }
  const state = {
    P,
    front,
    read,
    keys,
    seal,
    travel,
    motion: HL.tween(0, 2000),
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
    'Two block keys slide into their sockets and turn together to complete the signing assembly.',
  rules: [1, 3, 4, 5, 6, 7, 8, 9],
  range: [22, 23, 24],
  mount,
});
