/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const RACK_WIDTH = 40;
const RACK_COUNT = 5;
function block(parent, P, front, x0, y0, x1, y1, low, high, radius = 1) {
  const inset = Math.min(0.6, (x1 - x0) / 4, (y1 - y0) / 4);
  HL.put(
    HL.solid(parent),
    HL.prism(P, front, ...HL.rings(x0, y0, x1, y1, radius, inset), low, high),
  );
}
function facePoint(P, x, point) {
  return P(x, point.u, point.v);
}
function face(parent, P, x, y0, z0, y1, z1, radius, classes = 'lo nf') {
  const ring = HL.rrect(y0, z0, y1, z1, radius, 8);
  return HL.mk(
    'path',
    { d: HL.poly(ring.map(facePoint.bind(null, P, x))), class: classes },
    parent,
  );
}
function post(parent, P, front, y) {
  block(parent, P, front, 10, y - 1, 13, y + 1, 5, 80, 0.5);
  for (let z = 9; z < 79; z += 6) face(parent, P, 13.1, y - 0.3, z, y + 0.3, z + 1, 0.15);
}
function server(parent, P, front, rack, bay) {
  const y = RACK_WIDTH / 2 + rack * RACK_WIDTH,
    z = 7 + bay * 12;
  const group = HL.mk('g', { 'data-bay': bay }, parent);
  for (const rail of [-16.8, 16.8])
    block(group, P, front, -17, y + rail - 0.4, 12, y + rail + 0.4, z + 1, z + 2, 0.3);
  block(group, P, front, -19, y - 16, 12, y + 16, z, z + 10.8, 1);
  const panel = face(group, P, 12.1, y - 16, z, y + 16, z + 10.8, 0.9, 'sil');
  face(group, P, 12.2, y - 11, z + 4.3, y - 2, z + 6.2, 0.8);
  for (const dz of [3, 5, 7]) face(group, P, 12.2, y + 8, z + dz, y + 13, z + dz + 0.6, 0.3);
  for (const edge of [-14.5, 14.5])
    face(group, P, 12.2, y + edge - 0.3, z + 8.5, y + edge + 0.3, z + 9.1, 0.3);
  const lamp = face(group, P, 12.3, y + 2, z + 6, y + 3, z + 7, 0.5, 'dot m');
  return { rack, bay, y, z: z + 5.4, group, panel, lamp, slide: HL.tween(0, 180), drawn: NaN };
}
function doorPoint(P, hinge, angle, depth, point) {
  return P(
    14.5 + depth * Math.cos(angle) - point.u * Math.sin(angle),
    hinge + depth * Math.sin(angle) + point.u * Math.cos(angle),
    point.v,
  );
}
function door(parent, rack) {
  const group = HL.mk('g', { 'data-door': rack }, parent);
  const glass = HL.mk('path', { class: 'fo', opacity: 0.12 }, group);
  const frame = HL.mk('path', { class: 'sil', 'fill-rule': 'evenodd' }, group);
  const crease = HL.mk('path', { class: 'lo nf' }, group);
  const reflection = HL.mk('path', { class: 'lo nf', opacity: 0.6 }, group);
  const handle = HL.mk('path', { class: 'sil' }, group);
  return { group, glass, frame, crease, reflection, handle, motion: HL.tween(0, 260), drawn: NaN };
}
function drawDoor(P, rack, progress) {
  const angle = (-progress * Math.PI) / 2;
  const project = doorPoint.bind(null, P, rack.index * RACK_WIDTH + 2, angle);
  const outer = HL.rrect(0, 5, 36, 79, 1, 8);
  const inner = HL.rrect(1.4, 6.4, 34.6, 77.6, 0.6, 8);
  const front = outer.map(project.bind(null, 0.8));
  const back = outer.map(project.bind(null, 0));
  const pane = inner.map(project.bind(null, 0.8));
  rack.door.frame.setAttribute('d', HL.poly(HL.hull(front.concat(back))) + HL.poly(pane));
  rack.door.crease.setAttribute('d', HL.poly(front));
  rack.door.glass.setAttribute('d', HL.poly(pane));
  rack.door.handle.setAttribute(
    'd',
    HL.poly(HL.rrect(31.2, 36, 32.5, 48, 0.5, 6).map(project.bind(null, 1.3))),
  );
  let reflection = '';
  for (const offset of [0, 3]) {
    reflection += HL.seg(
      project(0.9, { u: 7 + offset, v: 70 }),
      project(0.9, { u: 13 + offset, v: 61 }),
    );
  }
  rack.door.reflection.setAttribute('d', reflection);
  // Past the edge-on pose, the far-hinged door sits behind the server units.
  const parent = rack.door.group.parentNode;
  if (progress >= 0.5) parent.insertBefore(rack.door.group, rack.modules[0].group);
  else parent.appendChild(rack.door.group);
  rack.door.group.setAttribute('data-open', progress);
}
function tick(state, _dt, now) {
  let moving = false;
  let othersExtended = false;
  const origin = state.P(0, 0, 0);
  for (const rack of state.racks) {
    if (rack.index === state.over?.rack) continue;
    for (const module of rack.modules) {
      if (HL.tval(module.slide, now) > 0.04) othersExtended = true;
    }
  }
  for (const rack of state.racks) {
    const selected = rack.index === state.over?.rack;
    let stowed = true;
    const open = HL.tval(rack.door.motion, now);
    for (const module of rack.modules) {
      let target = 0;
      if (selected && open >= 0.99 && !othersExtended) {
        target = 22 * Math.exp(-(((module.z - state.over.z) / state.radius) ** 2));
      }
      HL.tset(module.slide, target, now, 0);
      const slide = HL.tval(module.slide, now);
      if (slide > 0.04) stowed = false;
      if (!HL.tdone(module.slide, now)) moving = true;
      if (slide === module.drawn) continue;
      module.drawn = slide;
      const position = state.P(slide, 0, 0);
      module.group.setAttribute(
        'transform',
        `translate(${position[0] - origin[0]} ${position[1] - origin[1]})`,
      );
      module.group.setAttribute('data-slide', slide);
    }
    HL.tset(rack.door.motion, selected || !stowed ? 1 : 0, now, 0);
    const doorOpen = HL.tval(rack.door.motion, now);
    if (selected && doorOpen >= 0.99 && (open < 0.99 || othersExtended)) moving = true;
    if (!HL.tdone(rack.door.motion, now)) moving = true;
    if (doorOpen !== rack.door.drawn) {
      rack.door.drawn = doorOpen;
      drawDoor(state.P, rack, doorOpen);
    }
  }
  return moving;
}
function retarget(state) {
  let nearest = null;
  let distance = Infinity;
  for (const rack of state.racks) {
    for (const module of rack.modules) {
      if (rack.index !== state.over?.rack) continue;
      const delta = Math.abs(module.z - state.over.z);
      if (delta < distance) {
        nearest = module;
        distance = delta;
      }
    }
  }
  for (const rack of state.racks) {
    for (const module of rack.modules) {
      module.panel.setAttribute('class', module === nearest ? 'hi' : 'sil');
      module.lamp.setAttribute('class', module === nearest ? 'dot' : 'dot m');
    }
  }
  state.read.textContent = nearest ? `rack ${nearest.rack + 1} · bay ${nearest.bay + 1}` : 'rest';
  state.loop.wake();
}
function move(state, point) {
  // Select against the fixed cabinet face, never the moving door or server fronts.
  const origin = state.P(14.5, 0, 0),
    across = state.P(14.5, 1, 0),
    up = state.P(14.5, 0, 1);
  const y = (point[0] - origin[0]) / (across[0] - origin[0]);
  const z = (point[1] - origin[1] - y * (across[1] - origin[1])) / (up[1] - origin[1]);
  state.over =
    y >= 0 && y < RACK_WIDTH * RACK_COUNT && z >= 5 && z <= 80
      ? { rack: Math.floor(y / RACK_WIDTH), z }
      : null;
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
function view(P, x, y, z) {
  const point = P(x, y, z);
  return [400 - point[0], point[1]];
}
function mount({ stage, svg, read }, radius) {
  const C = HL.Cam(45, 0.5, 1.5);
  HL.fit(
    C,
    [
      [-22, 0, 84],
      [55, 200, 0],
      [-22, 200, 84],
      [55, 0, 0],
    ],
    200,
    164,
  );
  const P = view.bind(null, HL.proj(C)),
    front = HL.facing(C);
  const racks = [];
  for (let index = 0; index < RACK_COUNT; index++) {
    const y = index * RACK_WIDTH;
    const group = HL.mk('g', { 'data-rack': index }, svg);
    block(group, P, front, -22, y, 14, y + RACK_WIDTH, 0, 5, 1.4);
    block(group, P, front, -22, y + 1, -20, y + 39, 5, 80, 0.7);
    block(group, P, front, -20, y, 11, y + 2, 5, 80, 0.7);
    post(group, P, front, y + 2);
    const modules = [];
    for (let bay = 0; bay < 6; bay++) modules.push(server(group, P, front, index, bay));
    block(group, P, front, -20, y + 38, 11, y + RACK_WIDTH, 5, 80, 0.7);
    post(group, P, front, y + 38);
    block(group, P, front, -22, y, 14, y + RACK_WIDTH, 80, 84, 1.4);
    for (const z of [13, 41, 69])
      face(group, P, 14.6, y + 1.2, z - 1.8, y + 2.8, z + 1.8, 0.3, 'sil');
    racks.push({ index, modules, door: door(group, index) });
  }
  const state = { P, racks, read, radius, over: null, loop: null };
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
    'Hover a cabinet to open its glass door and extend nearby servers. Leaving retracts the servers, then closes the door.',
  rules: [1, 3, 4, 5, 6, 7, 8, 9],
  range: [18, 30, 44],
  mount,
});
