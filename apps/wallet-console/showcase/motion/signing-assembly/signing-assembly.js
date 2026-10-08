/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function path(parent, classes = 'lo nf') {
  return HL.mk('path', { class: classes }, parent);
}
function view(P, x0, y0, angle, x, y, z) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return P(x0 + x * c - y * s, y0 + x * s + y * c, z);
}
function cylinder(solid, P, radius, low, high) {
  const rim = HL.circ(radius, 64);
  const top = HL.ringAt(P, rim, high);
  const bottom = HL.ringAt(P, rim, low);
  const front = [];
  for (let step = 0; step <= 32; step++) {
    const angle = -Math.PI / 4 + (step * Math.PI) / 32;
    front.push(P(radius * Math.cos(angle), radius * Math.sin(angle), high));
  }
  HL.put(solid, { sil: HL.poly(HL.hull(bottom.concat(top))), crease: HL.open(front) });
  solid.cr.setAttribute('class', 'sil nf');
}
function clock(duration) {
  return HL.tween(0, duration);
}
function value(now, motion) {
  return HL.tval(motion, now);
}
function advance(state, now) {
  state.phase = -1;
  for (let n = 0; n < state.clocks.length; n++) {
    const index = state.active ? n : state.clocks.length - 1 - n;
    if (HL.tval(state.clocks[index], now) === Number(state.active)) continue;
    state.phase = index;
    HL.tset(state.clocks[index], Number(state.active), now, 0);
    break;
  }
}
function select(state, active) {
  if (state.active === active) return;
  if (state.phase >= 0) {
    const motion = state.clocks[state.phase];
    HL.tset(motion, HL.tval(motion, performance.now()), performance.now(), 0);
  }
  state.active = active;
  advance(state, performance.now());
  state.loop.wake();
}
function set(state, travel) {
  state.travel = travel;
  state.pose = '';
  state.loop.wake();
}
function socketOpening(P) {
  const radius = 4.8;
  const halfNotch = 1.2;
  const start = Math.asin(halfNotch / radius);
  const points = [];
  for (let step = 0; step <= 64; step++) {
    const angle = start + ((Math.PI * 2 - start * 2) * step) / 64;
    points.push(P(radius * Math.cos(angle), radius * Math.sin(angle), 31.1));
  }
  points.push(P(5.9, -halfNotch, 31.1), P(5.9, halfNotch, 31.1));
  return HL.poly(points);
}
function drawKey(state, key, insert, turn) {
  const [x, y, orientation] = key.position;
  const location = state.P(x, y, 0);
  const point = state.baseP(x, y, 0);
  key.group.setAttribute(
    'transform',
    `translate(${location[0] - point[0]} ${location[1] - point[1]})`,
  );
  const base = view.bind(null, state.baseP, x, y, 0);
  const height = 42 - (key.index < 2 ? insert * state.travel : 0);
  const angle = HL.rad(orientation + (key.index < 2 ? turn * 90 : 0) + state.angle);
  const rotation = view.bind(null, base, 0, 0, angle);
  cylinder(key.housing, base, 10, 7, 30);
  cylinder(key.plug, base, 7.6, 30, 31);
  const notch = height + 10 + key.index * 2;
  const levels = [
    [3.5, height, notch],
    [2.8, notch, notch + 1.8],
    [4.5, notch + 1.8, height + 20],
  ];
  for (let index = 0; index < 3; index++) {
    const [radius, low, high] = levels[index];
    key.rod[index].g.setAttribute('display', high > 31.1 ? 'inline' : 'none');
    cylinder(key.rod[index], base, radius, Math.max(31.1, low), Math.max(31.1, high));
  }
  const low = Math.max(31.1, notch),
    high = Math.max(31.1, notch + 1.8);
  key.bit.g.setAttribute('display', high > 31.1 ? 'inline' : 'none');
  const facing = HL.facing(HL.Cam(45 - (angle * 180) / Math.PI, 0.5, 1));
  HL.put(key.bit, HL.prism(rotation, facing, ...HL.rings(2.5, -1, 5.6, 1, 0.25, 0.2), low, high));
  if (Math.cos(angle) + Math.sin(angle) > 0) key.rod[2].g.after(key.bit.g);
  else key.rod[0].g.before(key.bit.g);
  cylinder(key.grip, base, 6.5, height + 20, height + 24);
  key.mark.setAttribute('d', HL.seg(rotation(0, 0, height + 24.1), rotation(5, 0, height + 24.1)));
  key.slot.setAttribute('d', socketOpening(rotation));
  return { group: key.group, depth: location[1] };
}
function order(a, b) {
  return a.depth - b.depth;
}
function wallPoint(P, angle, point) {
  const around = angle + point.u / 14;
  return P(14 * Math.cos(around), 14 * Math.sin(around), point.v);
}
function apertureHousing(state, z) {
  const lower = Math.max(10.2, z - 10);
  const upper = z - 2.4;
  let grooves = '';
  if (upper > lower + 0.4) {
    const slot = HL.rrect(-0.55, lower, 0.55, upper, 0.55, 8);
    for (const angle of [-15, 25, 65, 105]) {
      grooves += HL.poly(slot.map(wallPoint.bind(null, state.baseP, HL.rad(angle))));
    }
  }
  state.grooves.setAttribute('d', grooves);
  const top = HL.ringAt(state.baseP, HL.circ(16, 64), z + 0.7);
  const bottom = HL.ringAt(state.baseP, HL.circ(16, 64), z - 0.5);
  const opening = HL.ringAt(state.baseP, HL.circ(14, 64), z + 0.7);
  state.bezel.setAttribute('d', HL.poly(HL.hull(bottom.concat(top))) + HL.poly(opening));
  state.rim.setAttribute('d', HL.poly(top));
  let screws = '';
  for (let index = 0; index < 6; index++) {
    const angle = (index * Math.PI) / 3;
    const P = view.bind(null, state.baseP, 15 * Math.cos(angle), 15 * Math.sin(angle), angle);
    screws += HL.poly(HL.ringAt(P, HL.circ(0.45, 16), z + 0.72));
    screws += HL.seg(P(-0.3, 0, z + 0.72), P(0.3, 0, z + 0.72));
  }
  state.screws.setAttribute('d', screws);
}
function iris(state, lift, opening) {
  const z = 12 + lift * 12;
  const rotation = opening * Math.asin((11.8 * Math.cos(Math.PI / 6)) / 14);
  const radius = (14 * Math.sin(rotation)) / Math.cos(Math.PI / 6);
  cylinder(state.lift, state.baseP, 14, 9, z);
  apertureHousing(state, z);
  const aperture = [];
  let seams = '';
  for (let blade = 0; blade < 6; blade++) {
    const anchor = (blade * Math.PI) / 3;
    const tip = anchor + rotation - Math.PI / 3;
    const vertex = state.baseP(radius * Math.cos(tip), radius * Math.sin(tip), z);
    aperture.push(vertex);
    seams += HL.seg(vertex, state.baseP(14 * Math.cos(anchor), 14 * Math.sin(anchor), z));
  }
  let face = HL.poly(HL.ringAt(state.baseP, HL.circ(14, 64), z));
  if (opening > 0) face += HL.poly(aperture);
  state.shutter.setAttribute('d', face);
  state.seams.setAttribute('d', seams);
}
function cylinderRing(radius, z) {
  const points = [];
  for (let step = 0; step < 64; step++) {
    const angle = -Math.PI / 4 + (step * Math.PI) / 32;
    points.push([radius * Math.cos(angle), radius * Math.sin(angle), z]);
  }
  return points;
}
function projectVertex(P, point) {
  return P(...point);
}
function engravedPath(P, points, floor) {
  let d = '';
  for (let index = 1; index < points.length; index++) {
    let a = points[index - 1];
    let b = points[index];
    if (a[2] < floor && b[2] < floor) continue;
    if (a[2] < floor || b[2] < floor) {
      const t = (floor - a[2]) / (b[2] - a[2]);
      const edge = [HL.lerp(a[0], b[0], t), HL.lerp(a[1], b[1], t), floor];
      if (a[2] < floor) a = edge;
      else b = edge;
    }
    d += HL.seg(P(...a), P(...b));
  }
  return d;
}
function inscriptionPoint(surface, top, point) {
  const [u, v] = point;
  if (surface === 'top') return [u, v, top + 0.01];
  const angle = Math.PI / 4 + u / 8;
  return [8.01 * Math.cos(angle), 8.01 * Math.sin(angle), top - v];
}
function inscriptionLines(P, surface, top, floor) {
  const width = surface === 'top' ? 6.2 : 13;
  const firstRow = surface === 'top' ? -3.4 : 4;
  const lengths = [1, 0.9, 0.72, 1, 0.58];
  let d = '';
  for (let row = 0; row < lengths.length; row++) {
    const v = firstRow + row * 1.6 + (row > 0 ? 0.6 : 0);
    const points = [];
    for (let step = 0; step <= 24; step++) {
      points.push([-width / 2 + (width * lengths[row] * step) / 24, v]);
    }
    d += engravedPath(P, points.map(inscriptionPoint.bind(null, surface, top)), floor);
  }
  return d;
}
function signedCylinder(state, floor, top) {
  const P = state.baseP;
  const profiles = [
    { radius: 6.9, z: top - 16 },
    { radius: 8, z: top - 14.9 },
    { radius: 8, z: top - 1.1 },
    { radius: 6.9, z: top },
  ];
  const vertices = [];
  for (let index = 0; index < profiles.length; index++) {
    const profile = profiles[index];
    if (profile.z < floor) continue;
    if (index > 0 && profiles[index - 1].z < floor) {
      const previous = profiles[index - 1];
      const t = (floor - previous.z) / (profile.z - previous.z);
      vertices.push(...cylinderRing(HL.lerp(previous.radius, profile.radius, t), floor));
    }
    vertices.push(...cylinderRing(profile.radius, profile.z));
  }
  const cap = cylinderRing(6.9, top);
  let edges = HL.poly(cap.map(projectVertex.bind(null, P)));
  // Only the near halves of the bevel rings are visible below the top face.
  edges += engravedPath(P, cylinderRing(8, top - 1.1).slice(0, 33), floor);
  edges += engravedPath(P, cylinderRing(8, top - 14.9).slice(0, 33), floor);
  HL.put(state.transaction, {
    sil: HL.poly(HL.hull(vertices.map(projectVertex.bind(null, P)))),
    crease: edges,
  });
  const border = cylinderRing(6.1, top + 0.01);
  let marks = HL.poly(border.map(projectVertex.bind(null, P)));
  for (const surface of ['top', 'wall']) {
    marks += inscriptionLines(P, surface, top, floor);
  }
  state.inscriptions.setAttribute('d', marks);
}
function output(state, lift, emit, dt, now) {
  state.float.t = emit * 54;
  const moving = HL.stepS(state.float, dt),
    floor = 12 + lift * 12;
  // Taper the exposed height to zero before the reversing iris can close.
  const height = Math.max(0, state.float.x) * HL.clamp(emit / 0.15, 0, 1);
  const top = floor + height;
  if (top !== state.top) {
    state.top = top;
    state.transaction.g.setAttribute('display', height > 0.01 ? 'inline' : 'none');
    signedCylinder(state, floor, top);
  }
  const sway = HL.reducedMotion() ? 0 : HL.clamp((height - 38) / 16, 0, 1);
  const [cx, cy] = state.baseP(0, 0, top - 8);
  state.transaction.g.setAttribute(
    'transform',
    `translate(${sway * Math.sin(now / 1050)} ${sway * 2 * Math.sin(now / 730)}) rotate(${sway * 1.4 * Math.sin(now / 1200)} ${cx} ${cy})`,
  );
  return moving || (emit === 1 && !HL.reducedMotion());
}
function tick(state, dt, now) {
  while (state.phase >= 0 && HL.tdone(state.clocks[state.phase], now)) advance(state, now);
  const values = state.clocks.map(value.bind(null, now));
  const [insert, rotation, release] = values;
  // Clear the aperture as the lift starts, then launch during the same stroke.
  const opening = HL.clamp(release / 0.72, 0, 1);
  const emit = HL.clamp((release - 0.72) / 0.28, 0, 1);
  const pose = [...values, opening].join();
  if (pose !== state.pose) {
    state.pose = pose;
    state.angle = 70 * rotation;
    state.P = view.bind(null, state.baseP, 0, 0, HL.rad(state.angle));
    const parts = [{ group: state.center, depth: state.origin[1] }];
    for (const key of state.keys) parts.push(drawKey(state, key, insert, rotation));
    parts.sort(order);
    for (const part of parts) state.objects.appendChild(part.group);
    iris(state, release, opening);
    let ticks = '';
    for (let index = 0; index < 36; index++) {
      const angle = (index * Math.PI) / 18;
      const inner = index % 3 === 0 ? 57.8 : 59.5;
      ticks += HL.seg(
        state.P(inner * Math.cos(angle), inner * Math.sin(angle), 7.1),
        state.P(62 * Math.cos(angle), 62 * Math.sin(angle), 7.1),
      );
    }
    state.ticks.setAttribute('d', ticks);
    let fasteners = '';
    for (let index = 0; index < 6; index++) {
      const angle = (index * Math.PI) / 3;
      const P = view.bind(null, state.P, 51 * Math.cos(angle), 51 * Math.sin(angle), angle);
      fasteners += HL.poly(HL.ringAt(P, HL.circ(2, 24), 7.1));
      fasteners += HL.poly(HL.ringAt(P, HL.circ(1.2, 24), 7.1));
      fasteners += HL.seg(P(-0.8, 0, 7.1), P(0.8, 0, 7.1));
    }
    state.fasteners.setAttribute('d', fasteners);
  }
  const floating = output(state, release, emit, dt, now);
  const names = ['inserting', 'turning', 'issuing'];
  state.read.textContent = state.active
    ? state.phase < 0
      ? 'signed'
      : names[state.phase]
    : 'rest';
  return state.phase >= 0 || floating;
}
function mount({ stage, svg, read }, travel) {
  const C = HL.Cam(45, 0.5, 1.8);
  HL.fit(
    C,
    [
      [-65, -65, 0],
      [65, 65, 0],
      [0, 0, 94],
    ],
    200,
    166,
  );
  const baseP = HL.proj(C);
  cylinder(HL.solid(svg), baseP, 65, 0, 7);
  const rimDetail = path(svg);
  rimDetail.setAttribute(
    'd',
    HL.poly(HL.ringAt(baseP, HL.circ(63, 64), 7.1)) +
      HL.poly(HL.ringAt(baseP, HL.circ(56, 64), 7.1)) +
      HL.open(cylinderRing(65, 2.3).slice(0, 33).map(projectVertex.bind(null, baseP))),
  );
  const fasteners = path(svg);
  const ticks = path(svg);
  const objects = HL.mk('g', {}, svg),
    center = HL.mk('g', {}, objects);
  cylinder(HL.solid(center), baseP, 16, 7, 9);
  const lift = HL.solid(center);
  const grooves = path(center);
  const shutter = HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, center);
  const seams = path(center, 'sil nf');
  const bezel = HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, center);
  const rim = path(center, 'sil nf');
  const screws = path(center);
  const transaction = HL.solid(center),
    inscriptions = path(transaction.g, 'sil nf');
  transaction.sil.setAttribute('class', 'hi');
  transaction.cr.setAttribute('class', 'hi nf');
  const keys = [],
    positions = [
      [-27, -20, -20],
      [27, -19, 15],
      [0, 33, -12],
    ];
  for (let index = 0; index < 3; index++) {
    const group = HL.mk('g', {}, objects);
    keys.push({
      index,
      position: positions[index],
      group,
      housing: HL.solid(group),
      plug: HL.solid(group),
      slot: path(group, 'sil'),
      rod: [HL.solid(group), HL.solid(group), HL.solid(group)],
      bit: HL.solid(group),
      grip: HL.solid(group),
      mark: path(group),
    });
  }
  const state = {
    baseP,
    P: baseP,
    origin: baseP(0, 0, 0),
    objects,
    ticks,
    fasteners,
    center,
    keys,
    lift,
    grooves,
    shutter,
    seams,
    bezel,
    rim,
    screws,
    transaction,
    inscriptions,
    read,
    travel,
    clocks: [350, 500, 400].map(clock),
    float: HL.spring(0, { k: 100, c: 10, m: 1, eps: 0.01 }),
    top: NaN,
    angle: 0,
    phase: -1,
    pose: '',
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
    'Keys insert, then turn with the disk. The cylinder and iris release a signed transaction together.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [22, 23, 24],
  mount,
});
