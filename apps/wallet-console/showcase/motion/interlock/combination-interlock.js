/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const AXIS_HEIGHT = 45;
const RING_RADIUS = 31;
const PIN_RADIUS = 2.4;
const PIN_ORBIT = 17;
const CONTACT_ANGLE = (2 * Math.asin(PIN_RADIUS / PIN_ORBIT) * 180) / Math.PI;
const REAR_RING = { x: -42, restAngle: -135, frontPin: 30, rearPin: null };
const MIDDLE_RING = { x: -10, restAngle: 105, frontPin: 150, rearPin: 270 };
const FRONT_RING = { x: 22, restAngle: -165, frontPin: null, rearPin: 270 };
const RING_SETTINGS = [REAR_RING, MIDDLE_RING, FRONT_RING];
const MIDDLE_PICKUP = pickupTravel(
  FRONT_RING.restAngle + FRONT_RING.rearPin,
  MIDDLE_RING.restAngle + MIDDLE_RING.frontPin,
);
const REAR_PICKUP = pickupTravel(
  MIDDLE_RING.restAngle + MIDDLE_RING.rearPin,
  REAR_RING.restAngle + REAR_RING.frontPin,
);
const FIRST_TRAVEL = MIDDLE_PICKUP + REAR_PICKUP - REAR_RING.restAngle;
const MIDDLE_STOP = MIDDLE_RING.restAngle + REAR_PICKUP - REAR_RING.restAngle;
const REVERSE_PICKUP = 360 - 2 * CONTACT_ANGLE;
const REVERSE_TRAVEL = REVERSE_PICKUP + MIDDLE_STOP - 360;
const FINAL_TRAVEL = -(FRONT_RING.restAngle + FIRST_TRAVEL - REVERSE_TRAVEL);
const DRIVE_EASE = HL.bezier(0.65, 0, 0.35, 1);
function pickupTravel(driver, follower) {
  return ((((follower - driver) % 360) + 360) % 360) - CONTACT_ANGLE;
}
function path(parent, classes = 'lo nf') {
  return HL.mk('path', { class: classes }, parent);
}
function circle(radius, start = 0, end = Math.PI * 2) {
  const points = [];
  for (let index = 0; index <= 72; index++) {
    const angle = HL.lerp(start, end, index / 72);
    points.push([radius * Math.sin(angle), radius * Math.cos(angle)]);
  }
  return points;
}
function project(P, x, center, angle, point) {
  const y = point[0] * Math.cos(angle) + point[1] * Math.sin(angle);
  const z = point[1] * Math.cos(angle) - point[0] * Math.sin(angle);
  return P(x, y, center + z);
}
function plate(parent, x, depth, profile, hole = [], center = AXIS_HEIGHT) {
  const back = path(parent, 'fo');
  const wall = path(parent, 'fo');
  const edge = path(parent, 'sil nf');
  const face = path(parent, 'sil');
  const detail = path(parent);
  return { x, depth, profile, hole, center, back, wall, edge, face, detail };
}
function sideVisible(a, b, direction) {
  return (b[0] - a[0]) * direction[1] - (b[1] - a[1]) * direction[0] < 0;
}
function drawPlate(P, part, angle, detail = '') {
  let back = '';
  let face = '';
  let walls = '';
  let edges = '';
  for (const contour of [part.profile, part.hole]) {
    if (contour.length === 0) continue;
    const far = contour.map(project.bind(null, P, part.x, part.center, angle));
    const near = contour.map(project.bind(null, P, part.x + part.depth, part.center, angle));
    back += HL.poly(far);
    face += HL.poly(near);
    const direction = [near[0][0] - far[0][0], near[0][1] - far[0][1]];
    for (let index = 0; index < contour.length; index++) {
      const next = (index + 1) % contour.length;
      const previous = (index + contour.length - 1) % contour.length;
      const visible = sideVisible(far[index], far[next], direction);
      if (visible) {
        walls += HL.poly([far[index], far[next], near[next], near[index]]);
        edges += HL.seg(far[index], far[next]);
      }
      if (visible !== sideVisible(far[previous], far[index], direction)) {
        edges += HL.seg(far[index], near[index]);
      }
    }
  }
  part.back.setAttribute('d', back);
  part.wall.setAttribute('d', walls);
  part.edge.setAttribute('d', edges);
  part.face.setAttribute('d', face);
  part.detail.setAttribute('d', detail);
}
function gateProfile() {
  const angle = Math.asin(3.8 / RING_RADIUS);
  const points = circle(RING_RADIUS, angle, Math.PI * 2 - angle);
  points.push([-3.8, 24.5], [3.8, 24.5]);
  return HL.fillet(points, Array(points.length).fill(0.65), 4);
}
function roundedProfile(left, bottom, right, top, radius) {
  return HL.fillet(
    [
      [left, bottom],
      [left, top],
      [right, top],
      [right, bottom],
    ],
    [radius, radius, radius, radius],
    8,
  );
}
function block(parent, P, front, x0, y0, x1, y1, low, high, radius = 1) {
  const solid = HL.solid(parent);
  HL.put(solid, HL.prism(P, front, ...HL.rings(x0, y0, x1, y1, radius, 0.5), low, high));
  return solid;
}
function chassis(parent, P, front) {
  block(parent, P, front, -67, -37, 91, 37, 3, 8, 5);
  for (const x of [-58, 82]) {
    for (const y of [-28, 28]) {
      const screw = HL.rrect(x - 2.1, y - 2.1, x + 2.1, y + 2.1, 2.1, 12);
      path(parent).setAttribute('d', HL.poly(HL.ringAt(P, screw, 8)));
    }
  }
  for (const x of [-56, 53]) block(parent, P, front, x, -12, x + 4, -8, 8, 86);
  block(parent, P, front, -56, -12, 57, -8, 82, 86);
}
function bearing(parent, P, x) {
  const shape = roundedProfile(-11, 8, 11, 51, 3);
  const support = plate(parent, x, 5, shape, [], 0);
  drawPlate(P, support, 0);
  const collar = plate(parent, x + 5, 2, circle(8.5), circle(4.5).reverse());
  drawPlate(P, collar, 0);
}
function ringDetail(P, ring, angle) {
  const map = project.bind(null, P, ring.x + ring.depth, AXIS_HEIGHT, angle);
  const opening = Math.asin(4.5 / 27.5);
  let detail = HL.open(circle(27.5, opening, Math.PI * 2 - opening).map(map));
  for (let index = 1; index < 24; index++) {
    const theta = (index * Math.PI) / 12;
    detail += HL.seg(
      map([28.7 * Math.sin(theta), 28.7 * Math.cos(theta)]),
      map([30 * Math.sin(theta), 30 * Math.cos(theta)]),
    );
  }
  return detail;
}
function drivePin(parent, x, depth, phase) {
  const angle = HL.rad(phase);
  const profile = [];
  for (const point of circle(PIN_RADIUS)) {
    profile.push([point[0] + PIN_ORBIT * Math.sin(angle), point[1] + PIN_ORBIT * Math.cos(angle)]);
  }
  return plate(parent, x, depth, profile);
}
function wheel(parent, P, settings, index) {
  const group = HL.mk('g', { 'data-ring': index + 1 }, parent);
  const pins = [];
  if (settings.rearPin !== null) pins.push(drivePin(group, settings.x - 13, 13, settings.rearPin));
  const ring = plate(group, settings.x, 6, gateProfile(), circle(4.5).reverse());
  const hub = plate(group, settings.x + 6, 1.4, circle(8.5), circle(4.5).reverse());
  if (settings.frontPin !== null) pins.push(drivePin(group, settings.x + 6, 15, settings.frontPin));
  const hitArea = HL.hull(
    circle(RING_RADIUS)
      .map(project.bind(null, P, settings.x, AXIS_HEIGHT, 0))
      .concat(circle(RING_RADIUS).map(project.bind(null, P, settings.x + 6, AXIS_HEIGHT, 0))),
  );
  return { group, ring, hub, pins, hitArea, outline: [ring.face], drawn: NaN };
}
function drawWheel(state, wheel, rotation) {
  if (wheel.drawn === rotation) return;
  wheel.drawn = rotation;
  const angle = HL.rad(rotation);
  drawPlate(state.P, wheel.ring, angle, ringDetail(state.P, wheel.ring, angle));
  drawPlate(state.P, wheel.hub, angle);
  for (const pin of wheel.pins) drawPlate(state.P, pin, angle);
  wheel.group.dataset.rotation = rotation;
}
function fence(parent, P, front) {
  const group = HL.mk('g', { 'data-part': 'locking-pin' }, parent);
  const beam = HL.solid(group);
  const left = HL.solid(group);
  const right = HL.solid(group);
  for (const x of [-50, 30]) block(group, P, front, x, -11, x + 7, 4, 82, 86, 1.2);
  return { group, beam, left, right, drawn: NaN };
}
function drawFence(state, drop) {
  const fence = state.fence;
  if (fence.drawn === drop) return;
  fence.drawn = drop;
  const low = 78 - 7.5 * drop;
  HL.put(
    fence.beam,
    HL.prism(state.P, state.front, ...HL.rings(-48, -2.6, 35, 2.6, 0.7, 0.5), low, low + 4),
  );
  HL.put(
    fence.left,
    HL.prism(state.P, state.front, ...HL.rings(-49, -2.6, -45, 2.6, 0.7, 0.5), low, 83),
  );
  HL.put(
    fence.right,
    HL.prism(state.P, state.front, ...HL.rings(31, -2.6, 35, 2.6, 0.7, 0.5), low, 83),
  );
  fence.group.dataset.drop = drop;
}
function dial(parent, P) {
  const group = HL.mk('g', { 'data-part': 'dial' }, parent);
  const rim = plate(group, 64, 7, circle(28));
  const knob = plate(group, 71, 10, circle(11.5));
  const grip = plate(group, 81, 2, roundedProfile(-3, -9, 3, 9, 2));
  const hitArea = HL.hull(
    circle(28)
      .map(project.bind(null, P, 64, AXIS_HEIGHT, 0))
      .concat(circle(28).map(project.bind(null, P, 83, AXIS_HEIGHT, 0))),
  );
  return { group, rim, knob, grip, hitArea, outline: [rim.face, knob.face], drawn: NaN };
}
function drawDial(state, rotation) {
  const dial = state.dial;
  if (dial.drawn === rotation) return;
  dial.drawn = rotation;
  const angle = HL.rad(rotation);
  const map = project.bind(null, state.P, dial.rim.x + 7, AXIS_HEIGHT, angle);
  let detail = HL.poly(circle(23.5).map(map));
  for (let index = 0; index < 36; index++) {
    const theta = (index * Math.PI) / 18;
    const inner = index % 3 === 0 ? 24.2 : 25.3;
    detail += HL.seg(
      map([inner * Math.sin(theta), inner * Math.cos(theta)]),
      map([26.8 * Math.sin(theta), 26.8 * Math.cos(theta)]),
    );
  }
  drawPlate(state.P, dial.rim, angle, detail);
  drawPlate(
    state.P,
    dial.knob,
    angle,
    HL.poly(circle(9.5).map(project.bind(null, state.P, dial.knob.x + 10, AXIS_HEIGHT, angle))),
  );
  drawPlate(state.P, dial.grip, angle);
  dial.group.dataset.rotation = rotation;
}
function phaseProgress(progress, start, end) {
  const from = HL.EASE_LIFT(start);
  const to = HL.EASE_LIFT(end);
  return DRIVE_EASE(HL.clamp((progress - from) / (to - from), 0, 1));
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const forward = FIRST_TRAVEL * phaseProgress(progress, 0, 0.42);
  const reverse = REVERSE_TRAVEL * phaseProgress(progress, 0.42, 0.76);
  const finish = FINAL_TRAVEL * phaseProgress(progress, 0.76, 0.88);
  const drop = phaseProgress(progress, 0.88, 1);
  const rear = REAR_RING.restAngle + Math.max(0, forward - MIDDLE_PICKUP - REAR_PICKUP);
  const middle =
    MIDDLE_RING.restAngle +
    Math.max(0, forward - MIDDLE_PICKUP) -
    Math.max(0, reverse - REVERSE_PICKUP);
  const front = FRONT_RING.restAngle + forward - reverse + finish;
  drawWheel(state, state.wheels[0], rear);
  drawWheel(state, state.wheels[1], middle);
  drawWheel(state, state.wheels[2], front);
  drawDial(state, front);
  drawFence(state, drop);
  let phase = 'rest';
  if (forward > 0) phase = 'picking up middle';
  if (forward > MIDDLE_PICKUP) phase = 'picking up rear';
  if (forward > MIDDLE_PICKUP + REAR_PICKUP) phase = 'aligning rear';
  if (reverse > 0) phase = 'aligning middle';
  if (finish > 0) phase = 'aligning front';
  if (drop > 0) phase = 'pin dropping';
  if (drop === 1) phase = 'unlocked';
  if (!state.active && progress > 0) phase = 'resetting';
  state.read.textContent = phase;
  return !HL.tdone(state.motion, now);
}
function containsPoint(polygon, point) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a[1] > point[1] === b[1] > point[1]) continue;
    const x = ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (point[0] < x) inside = !inside;
  }
  return inside;
}
function highlight(state, outline) {
  if (state.highlight === outline) return;
  for (const edge of state.highlight) edge.classList.remove('hi');
  for (const edge of outline) edge.classList.add('hi');
  state.highlight = outline;
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  state.stage.setAttribute('aria-pressed', String(active));
  HL.tset(state.motion, active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
}
function move(state, point) {
  for (let index = state.targets.length - 1; index >= 0; index--) {
    const target = state.targets[index];
    if (containsPoint(target.hitArea, point)) {
      highlight(state, target.outline);
      select(state, true);
      return;
    }
  }
  highlight(state, state.noOutline);
  select(state, true);
}
function leave(state) {
  highlight(state, state.dial.outline);
  select(state, false);
}
function keydown(state, event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select(state, !state.active);
}
function set(state, duration) {
  const now = performance.now();
  state.motion = HL.tween(HL.tval(state.motion, now), duration);
  HL.tset(state.motion, state.active ? 1 : 0, now, 0);
  state.loop.wake();
}
function mount({ stage, svg, read }, duration) {
  const camera = HL.Cam(45, 0.5, 1.75);
  HL.fit(
    camera,
    [
      [-67, -37, 3],
      [-67, 37, 86],
      [91, -37, 86],
      [91, 37, 3],
    ],
    200,
    166,
  );
  const P = HL.proj(camera);
  const front = HL.facing(camera);
  chassis(svg, P, front);
  bearing(svg, P, -58);
  drawPlate(P, plate(svg, -51, 121, circle(4.3)), 0);
  const wheels = [];
  for (let index = 0; index < RING_SETTINGS.length; index++) {
    wheels.push(wheel(svg, P, RING_SETTINGS[index], index));
  }
  const lockingPin = fence(svg, P, front);
  bearing(svg, P, 53);
  const control = dial(svg, P);
  const state = {
    P,
    front,
    stage,
    svg,
    read,
    wheels,
    fence: lockingPin,
    dial: control,
    targets: [...wheels, control],
    motion: HL.tween(0, duration),
    drawn: NaN,
    active: false,
    highlight: [],
    noOutline: [],
    loop: null,
  };
  state.loop = HL.register(stage, tick.bind(null, state));
  highlight(state, control.outline);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: leave.bind(null, state) }));
  stage.tabIndex = 0;
  stage.setAttribute('role', 'button');
  stage.setAttribute(
    'aria-label',
    'Turn the dial to engage and align three wheels, then release the locking pin',
  );
  stage.setAttribute('aria-pressed', 'false');
  bag.on(stage, 'keydown', keydown.bind(null, state));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}
hairline({
  name: 'interlock',
  means:
    'The dial picks up each wheel in turn. Aligned gates let the locking pin drop. Hover or press Enter.',
  rules: [1, 4, 5, 6, 7, 8, 9],
  range: [3400, 4400, 5600],
  mount,
});
