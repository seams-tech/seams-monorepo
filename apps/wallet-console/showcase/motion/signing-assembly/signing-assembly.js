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
  HL.put(
    solid,
    HL.prism(
      P,
      HL.facing(HL.Cam(45, 0.5, 1)),
      HL.circ(radius, 48),
      HL.circ(radius - 0.6, 48),
      low,
      high,
    ),
  );
}
function clock(duration) {
  return HL.tween(0, duration);
}
function value(now, motion) {
  return HL.tval(motion, now);
}
function advance(state, now) {
  const previous = state.phase;
  state.phase = -1;
  for (let n = 0; n < 6; n++) {
    const index = state.active ? n : 5 - n;
    if (HL.tval(state.clocks[index], now) === Number(state.active)) continue;
    state.phase = index;
    HL.tset(
      state.clocks[index],
      Number(state.active),
      now,
      state.active && index === 3 && previous === 2 ? 180 : 0,
    );
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
  const notch = height + 5 + key.index * 2;
  const levels = [
    [4.5, height, notch],
    [2.8, notch, notch + 2.5],
    [4.5, notch + 2.5, height + 20],
  ];
  for (let index = 0; index < 3; index++) {
    const [radius, low, high] = levels[index];
    key.rod[index].g.setAttribute('display', high > 31.1 ? 'inline' : 'none');
    cylinder(key.rod[index], base, radius, Math.max(31.1, low), Math.max(31.1, high));
  }
  const low = Math.max(31.1, notch),
    high = Math.max(31.1, notch + 2.5);
  key.bit.g.setAttribute('display', high > 31.1 ? 'inline' : 'none');
  const facing = HL.facing(HL.Cam(45 - (angle * 180) / Math.PI, 0.5, 1));
  HL.put(key.bit, HL.prism(rotation, facing, ...HL.rings(2.5, -1.4, 6, 1.4, 0.4, 0.3), low, high));
  if (Math.cos(angle) + Math.sin(angle) > 0) key.rod[2].g.after(key.bit.g);
  else key.rod[0].g.before(key.bit.g);
  cylinder(key.grip, base, 6.5, height + 20, height + 28);
  key.mark.setAttribute('d', HL.seg(rotation(0, 0, height + 28.1), rotation(5, 0, height + 28.1)));
  const opening = HL.ringAt(rotation, HL.circ(4.8, 48), 31.1);
  const channel = HL.ringAt(rotation, HL.rrect(3.8, -1.7, 6.2, 1.7, 0.4, 8), 31.1);
  key.slot.setAttribute('d', HL.poly(HL.hull(opening.concat(channel))));
  return { group: key.group, depth: location[1] };
}
function order(a, b) {
  return a.depth - b.depth;
}
function iris(state, lift, opening) {
  const z = 12 + lift * 12;
  cylinder(state.lift, state.baseP, 14, 7, z);
  state.well.setAttribute('d', HL.poly(HL.ringAt(state.baseP, HL.circ(10, 48), z - 4)));
  for (let blade = 0; blade < 6; blade++) {
    const points = [],
      start = (blade * Math.PI) / 3;
    for (let step = 0; step <= 8; step++) {
      const angle = start + (step * Math.PI) / 24;
      points.push(state.baseP(13.5 * Math.cos(angle), 13.5 * Math.sin(angle), z + 0.1));
    }
    for (const angle of [start + Math.PI / 3, start]) {
      points.push(
        state.baseP(
          opening * 12 * Math.cos(angle + opening * 0.3),
          opening * 12 * Math.sin(angle + opening * 0.3),
          z + 0.1,
        ),
      );
    }
    state.blades[blade].setAttribute('d', HL.poly(points));
  }
}
function output(state, lift, emit, dt, now) {
  state.float.t = emit * 54;
  const moving = HL.stepS(state.float, dt),
    floor = 12 + lift * 12;
  state.floatMoving = moving;
  const top = floor + Math.max(0, state.float.x),
    bottom = Math.max(floor, top - 18);
  if (top !== state.top) {
    state.top = top;
    state.block.g.setAttribute('display', state.float.x > 0.01 ? 'inline' : 'none');
    HL.put(
      state.block,
      HL.prism(state.baseP, state.front, ...HL.rings(-7, -7, 7, 7, 1.5, 0.6), bottom, top),
    );
    let marks = HL.poly(HL.ringAt(state.baseP, HL.rrect(-3, -3, 3, 3, 1, 8), top + 0.1));
    for (const drop of [4, 7, 10, 13]) {
      if (top - drop > floor)
        marks += HL.seg(
          state.baseP(7.1, -4.5, top - drop),
          state.baseP(7.1, drop === 10 ? 2 : 4.5, top - drop),
        );
    }
    state.inscriptions.setAttribute('d', marks);
  }
  const sway = HL.reducedMotion() ? 0 : HL.clamp((state.float.x - 38) / 16, 0, 1);
  const [cx, cy] = state.baseP(0, 0, top - 9);
  state.block.g.setAttribute(
    'transform',
    `translate(${sway * Math.sin(now / 1050)} ${sway * 2 * Math.sin(now / 730)}) rotate(${sway * 1.4 * Math.sin(now / 1200)} ${cx} ${cy})`,
  );
  return moving || (emit === 1 && !HL.reducedMotion());
}
function tick(state, dt, now) {
  while (
    state.phase >= 0 &&
    HL.tdone(state.clocks[state.phase], now) &&
    (state.active || state.phase !== 5 || !state.floatMoving)
  )
    advance(state, now);
  const values = state.clocks.map(value.bind(null, now));
  const [insert, turn, rotation, lift, opening, emit] = values;
  if (values.join() !== state.pose) {
    state.pose = values.join();
    state.angle = 70 * rotation;
    state.P = view.bind(null, state.baseP, 0, 0, HL.rad(state.angle));
    const parts = [{ group: state.center, depth: state.origin[1] }];
    for (const key of state.keys) parts.push(drawKey(state, key, insert, turn));
    parts.sort(order);
    for (const part of parts) state.objects.appendChild(part.group);
    iris(state, lift, opening);
    let ticks = '';
    for (let index = 0; index < 36; index++) {
      const angle = (index * Math.PI) / 18;
      ticks += HL.seg(
        state.P(59 * Math.cos(angle), 59 * Math.sin(angle), 7.1),
        state.P(62 * Math.cos(angle), 62 * Math.sin(angle), 7.1),
      );
    }
    state.ticks.setAttribute('d', ticks);
  }
  const floating = output(state, lift, emit, dt, now);
  const names = ['inserting', 'turning', 'rotating', 'raising', 'opening', 'issuing'];
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
  const baseP = HL.proj(C),
    front = HL.facing(C);
  cylinder(HL.solid(svg), baseP, 65, 0, 7);
  const ticks = path(svg);
  const objects = HL.mk('g', {}, svg),
    center = HL.mk('g', {}, objects);
  const lift = HL.solid(center),
    well = path(center, 'lo nf'),
    blades = [];
  for (let index = 0; index < 6; index++) blades.push(path(center, 'sil'));
  const block = HL.solid(center),
    inscriptions = path(block.g);
  block.sil.setAttribute('class', 'hi');
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
    front,
    origin: baseP(0, 0, 0),
    objects,
    ticks,
    center,
    keys,
    lift,
    well,
    blades,
    block,
    inscriptions,
    read,
    travel,
    clocks: [500, 450, 650, 400, 350, 200].map(clock),
    float: HL.spring(0, { k: 100, c: 10, m: 1, eps: 0.01 }),
    floatMoving: false,
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
  means: 'Insert, lock, rotate. The iris opens to release a signed transaction.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [22, 23, 24],
  mount,
});
