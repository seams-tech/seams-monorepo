/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const AXIS_HEIGHT = 45;
const RING_RADIUS = 31;
const GATE = { halfWidth: 3, floor: 18.8 };
const DISK_DEPTH = 4;
const PIN_ORBIT = 26.75;
const PIN_HALF_ANGLE = 6;
const PIN_RADIUS = PIN_ORBIT * Math.sin(HL.rad(PIN_HALF_ANGLE));
const CONTACT_ANGLE = 2 * PIN_HALF_ANGLE;
const PIVOT_Y = -40;
const PIVOT_Z = 65.5;
const LEVER_REACH = 40;
const LEVER_REST_ANGLE = -Math.asin((79 - PIVOT_Z) / LEVER_REACH);
const REAR_RING = { x: -40, restAngle: -135, frontPin: 30, rearPin: null };
const MIDDLE_RING = { x: -12, restAngle: 105, frontPin: 150, rearPin: 270 };
const FRONT_RING = { x: 16, restAngle: -165, frontPin: null, rearPin: 270 };
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
// Swap the kernel lift curve's coordinates to recover its uneased clock.
const CLOCK_TIME = HL.bezier(0.72, 0.32, 1, 0);
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
function offsetView(P, dy, dz, x, y, z) {
  return P(x, y + dy, z + dz);
}
function rodPoint(P, x, y, z, point) {
  return P(x, y + point[0], z + point[1]);
}
function rod(parent, low, high, radius, name) {
  const group = HL.mk('g', { 'data-part': name }, parent);
  const surface = path(group, 'fo');
  const edge = path(group, 'sil nf');
  return { group, low, high, profile: circle(radius), surface, edge };
}
function drawRod(P, part, y, z) {
  const far = part.profile.map(rodPoint.bind(null, P, part.low, y, z));
  const near = part.profile.map(rodPoint.bind(null, P, part.high, y, z));
  const direction = [near[0][0] - far[0][0], near[0][1] - far[0][1]];
  let edges = '';
  for (let index = 0; index < far.length; index++) {
    const next = (index + 1) % far.length;
    const previous = (index + far.length - 1) % far.length;
    if (
      sideVisible(far[index], far[next], direction) !==
      sideVisible(far[previous], far[index], direction)
    ) {
      edges += HL.seg(far[index], near[index]);
    }
  }
  part.surface.setAttribute('d', HL.poly(HL.hull(far.concat(near))));
  // Interior depth cuts have no end-cap edges: adjacent sections form one continuous rod.
  part.edge.setAttribute('d', edges);
}
function plate(parent, x, depth, profile, hole = [], center = AXIS_HEIGHT, gate = null) {
  const back = path(parent, 'fo');
  const wall = path(parent, 'fo');
  const edge = path(parent, 'sil nf');
  const frontWall = path(parent, 'fo');
  const frontEdge = path(parent, 'sil nf');
  const face = path(parent, 'sil');
  const detail = path(parent);
  return {
    x,
    depth,
    profile,
    hole,
    center,
    gate,
    back,
    wall,
    edge,
    frontWall,
    frontEdge,
    face,
    detail,
  };
}
function sideVisible(a, b, direction) {
  return (b[0] - a[0]) * direction[1] - (b[1] - a[1]) * direction[0] < 0;
}
function drawPlate(P, part, angle, detail = '') {
  let back = '';
  let face = '';
  let walls = '';
  let edges = '';
  let frontWalls = '';
  let frontEdges = '';
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
      const insideGate =
        part.gate !== null &&
        Math.abs(contour[index][0]) <= part.gate.halfWidth + 0.001 &&
        contour[index][1] >= part.gate.floor - 0.001;
      const interior = contour === part.hole || insideGate;
      if (visible) {
        const wall = HL.poly([far[index], far[next], near[next], near[index]]);
        if (interior) walls += wall;
        else frontWalls += wall;
      }
      let edge = visible ? HL.seg(far[index], far[next]) : '';
      if (visible !== sideVisible(far[previous], far[index], direction)) {
        edge += HL.seg(far[index], near[index]);
      }
      if (interior) edges += edge;
      else frontEdges += edge;
    }
  }
  part.back.setAttribute('d', back);
  part.wall.setAttribute('d', walls);
  part.edge.setAttribute('d', edges);
  part.frontWall.setAttribute('d', frontWalls);
  part.frontEdge.setAttribute('d', frontEdges);
  part.face.setAttribute('d', face);
  part.detail.setAttribute('d', detail);
}
function gateProfile() {
  const angle = Math.asin(GATE.halfWidth / RING_RADIUS);
  const points = circle(RING_RADIUS, angle, Math.PI * 2 - angle);
  points.push([-GATE.halfWidth, GATE.floor], [GATE.halfWidth, GATE.floor]);
  return HL.fillet(points, Array(points.length).fill(0.45), 4);
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
  block(parent, P, front, -62, -52, 80, 37, 3, 8, 5);
  for (const x of [-53, 71]) {
    for (const y of [-43, 28]) {
      const screw = HL.rrect(x - 2.1, y - 2.1, x + 2.1, y + 2.1, 2.1, 12);
      path(parent).setAttribute('d', HL.poly(HL.ringAt(P, screw, 8)));
    }
  }
}
function bearing(parent, P, x) {
  const shape = roundedProfile(-9, 8, 9, AXIS_HEIGHT + 6, 3);
  const opening = circle(4.5).reverse();
  for (const point of opening) point[1] += AXIS_HEIGHT;
  const support = plate(parent, x, 5, shape, opening, 0);
  drawPlate(P, support, 0);
  const collar = plate(parent, x + 5, 2, circle(7), circle(4.5).reverse());
  drawPlate(P, collar, 0);
  return { support, collar };
}
function pivotSupport(parent, P, x) {
  const support = plate(parent, x, 5, roundedProfile(-9, 8, 9, PIVOT_Z + 6, 3), [], 0);
  drawPlate(P, support, 0);
}
function polarPoint(radius, degrees) {
  const angle = HL.rad(degrees);
  return [radius * Math.sin(angle), radius * Math.cos(angle)];
}
function offsetCircle(radius, center) {
  const points = circle(radius);
  for (const point of points) {
    point[0] += center[0];
    point[1] += center[1];
  }
  return points;
}
function drivePin(parent, faceX, tipX, phase) {
  const group = HL.mk('g', { 'data-part': 'drive-pin' }, parent);
  const collarGroup = HL.mk('g', { 'data-part': 'pin-collar' }, group);
  const bodyGroup = HL.mk('g', { 'data-part': 'pin-body' }, group);
  const center = polarPoint(PIN_ORBIT, phase);
  const forward = tipX > faceX;
  const collarX = forward ? faceX : faceX - 1.2;
  const bodyX = forward ? faceX + 1.2 : tipX;
  const collar = plate(collarGroup, collarX, 1.2, offsetCircle(3.8, center));
  const body = plate(
    bodyGroup,
    bodyX,
    Math.abs(tipX - faceX) - 1.2,
    offsetCircle(PIN_RADIUS, center),
  );
  if (!forward) collarGroup.before(bodyGroup);
  const bevel = forward ? offsetCircle(PIN_RADIUS - 0.6, center) : [];
  return { body, collar, bevel };
}
function wheel(parent, P, settings, index, axleStart, pinStart) {
  const group = HL.mk('g', { 'data-ring': index + 1 }, parent);
  const pins = [];
  if (settings.rearPin !== null)
    pins.push(drivePin(group, settings.x, settings.x - 12.5, settings.rearPin));
  const faceX = settings.x + DISK_DEPTH;
  const ring = plate(
    group,
    settings.x,
    DISK_DEPTH,
    gateProfile(),
    circle(4.5).reverse(),
    AXIS_HEIGHT,
    GATE,
  );
  ring.face.setAttribute('data-part', 'disk-face');
  ring.frontWall.setAttribute('data-part', 'disk-edge');
  const axleGap = rod(group, axleStart, settings.x, 4.3, 'axle-gap');
  const axleBore = rod(group, settings.x, faceX, 4.3, 'axle-bore');
  drawRod(P, axleGap, 0, AXIS_HEIGHT);
  drawRod(P, axleBore, 0, AXIS_HEIGHT);
  const pinGap = rod(group, pinStart, settings.x, 1, 'locking-pin-section');
  const pinBore = rod(group, settings.x, faceX, 1, 'locking-pin-section');
  // Open spans sit behind the whole disk. Interior spans stay behind its rim and front face.
  ring.back.before(axleGap.group, pinGap.group);
  ring.frontWall.before(axleBore.group, pinBore.group);
  const hub = plate(group, faceX, 1.4, circle(7), circle(4.5).reverse());
  const bore = rod(group, faceX, faceX + 1.4, 4.3, 'axle-collar');
  drawRod(P, bore, 0, AXIS_HEIGHT);
  hub.frontWall.before(bore.group);
  if (settings.frontPin !== null)
    pins.push(drivePin(group, faceX, faceX + 13.5, settings.frontPin));
  const hitArea = HL.hull(
    circle(RING_RADIUS)
      .map(project.bind(null, P, settings.x, AXIS_HEIGHT, 0))
      .concat(circle(RING_RADIUS).map(project.bind(null, P, faceX, AXIS_HEIGHT, 0))),
  );
  return {
    group,
    ring,
    hub,
    pins,
    pinSections: [pinGap, pinBore],
    hitArea,
    outline: [ring.face],
    drawn: NaN,
  };
}
function drawWheel(state, wheel, rotation) {
  if (wheel.drawn === rotation) return;
  wheel.drawn = rotation;
  const angle = HL.rad(rotation);
  drawPlate(
    state.P,
    wheel.ring,
    angle,
    rimDetail(state.P, wheel.ring.x + wheel.ring.depth, RING_RADIUS, angle, GATE),
  );
  drawPlate(state.P, wheel.hub, angle);
  for (const pin of wheel.pins) {
    const map = project.bind(null, state.P, pin.body.x + pin.body.depth, AXIS_HEIGHT, angle);
    drawPlate(state.P, pin.collar, angle);
    drawPlate(state.P, pin.body, angle, HL.poly(pin.bevel.map(map)));
  }
  wheel.group.dataset.rotation = rotation;
}
function lever(parent, P, x) {
  const arm = plate(
    parent,
    x,
    3.5,
    roundedProfile(-7, -7, LEVER_REACH + 7, 7, 7),
    circle(4.5).reverse(),
    0,
  );
  arm.face.setAttribute('data-part', 'pivot-arm');
  const shaft = rod(parent, x, x + arm.depth, 4.3, 'pivot-bore');
  drawRod(P, shaft, PIVOT_Y, PIVOT_Z);
  arm.frontWall.before(shaft.group);
  return arm;
}
function drawFence(state, drop) {
  const fence = state.fence;
  if (fence.drawn === drop) return;
  fence.drawn = drop;
  const angle = LEVER_REST_ANGLE * (1 - drop);
  const y = PIVOT_Y + LEVER_REACH * Math.cos(angle);
  const z = PIVOT_Z - LEVER_REACH * Math.sin(angle);
  const armP = offsetView.bind(null, state.P, PIVOT_Y, PIVOT_Z);
  for (const arm of fence.arms) {
    const socket = offsetCircle(1.8, [LEVER_REACH, 0]);
    const map = project.bind(null, armP, arm.x + arm.depth, 0, angle);
    drawPlate(armP, arm, angle, HL.poly(socket.map(map)));
  }
  for (const section of fence.sections) drawRod(state.P, section, y, z);
  state.svg.dataset.pinDrop = drop;
}
function dial(parent, P) {
  const group = HL.mk('g', { 'data-part': 'dial' }, parent);
  const rim = plate(group, 52, 6, circle(28));
  const knob = plate(group, 58, 9, circle(11.5));
  const grip = plate(group, 67, 2, roundedProfile(-3, -9, 3, 9, 2));
  const hitArea = HL.hull(
    circle(28)
      .map(project.bind(null, P, 52, AXIS_HEIGHT, 0))
      .concat(circle(28).map(project.bind(null, P, 69, AXIS_HEIGHT, 0))),
  );
  return { group, rim, knob, grip, hitArea, outline: [rim.face, knob.face], drawn: NaN };
}
function rimDetail(P, x, radius, angle, gate) {
  const map = project.bind(null, P, x, AXIS_HEIGHT, angle);
  const inset = radius - 4.5;
  const start = gate === null ? 0 : Math.asin((gate.halfWidth + 0.45) / inset);
  let detail = HL.open(circle(inset, start, Math.PI * 2 - start).map(map));
  for (let index = 0; index < 36; index++) {
    const degrees = index * 10;
    const outer = polarPoint(radius - 1.2, degrees);
    if (gate !== null && Math.abs(outer[0]) <= gate.halfWidth + 0.45 && outer[1] > gate.floor)
      continue;
    const inner = radius - (index % 3 === 0 ? 3.8 : 2.7);
    detail += HL.seg(map(polarPoint(inner, degrees)), map(outer));
  }
  return detail;
}
function drawDial(state, rotation) {
  const dial = state.dial;
  if (dial.drawn === rotation) return;
  dial.drawn = rotation;
  const angle = HL.rad(rotation);
  drawPlate(
    state.P,
    dial.rim,
    angle,
    rimDetail(state.P, dial.rim.x + dial.rim.depth, 28, angle, null),
  );
  drawPlate(
    state.P,
    dial.knob,
    angle,
    HL.poly(
      circle(9.5).map(
        project.bind(null, state.P, dial.knob.x + dial.knob.depth, AXIS_HEIGHT, angle),
      ),
    ),
  );
  drawPlate(state.P, dial.grip, angle);
  dial.group.dataset.rotation = rotation;
}
function phaseProgress(progress, start, end) {
  return DRIVE_EASE(HL.clamp((progress - start) / (end - start), 0, 1));
}
function sequencePosition(state, now) {
  const motion = state.motion;
  return HL.lerp(motion.from, motion.to, CLOCK_TIME(HL.tval(motion.clock, now)));
}
function retarget(state, target, now) {
  const from = sequencePosition(state, now);
  const clock = HL.tween(0, state.duration * Math.abs(target - from));
  HL.tset(clock, 1, now, 0);
  state.motion = { from, to: target, clock };
}
function tick(state, _dt, now) {
  const progress = sequencePosition(state, now);
  if (progress === state.drawn) return !HL.tdone(state.motion.clock, now);
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
  return !HL.tdone(state.motion.clock, now);
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
  retarget(state, active ? 1 : 0, performance.now());
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
  state.duration = duration;
  retarget(state, state.active ? 1 : 0, performance.now());
  state.loop.wake();
}
function mount({ stage, svg, read }, duration) {
  const camera = HL.Cam(45, 0.5, 1.75);
  HL.fit(
    camera,
    [
      [-62, -52, 3],
      [-62, 37, 87],
      [80, -52, 87],
      [80, 37, 3],
    ],
    200,
    166,
  );
  const P = HL.proj(camera);
  const front = HL.facing(camera);
  chassis(svg, P, front);
  const pivotP = offsetView.bind(null, P, PIVOT_Y, 0);
  pivotSupport(svg, pivotP, -54);
  bearing(svg, P, -54);
  drawRod(P, rod(svg, -49, -47, 4.3, 'pivot-shaft'), PIVOT_Y, PIVOT_Z);
  const lockingPin = { arms: [lever(svg, P, -47)], sections: [], drawn: NaN };
  drawRod(P, rod(svg, -43.5, 33, 4.3, 'pivot-shaft'), PIVOT_Y, PIVOT_Z);
  const wheels = [];
  let axleStart = -47;
  let pinStart = -43.5;
  for (let index = 0; index < RING_SETTINGS.length; index++) {
    const disk = wheel(svg, P, RING_SETTINGS[index], index, axleStart, pinStart);
    wheels.push(disk);
    lockingPin.sections.push(...disk.pinSections);
    axleStart = disk.hub.x + disk.hub.depth;
    pinStart = disk.ring.x + disk.ring.depth;
  }
  lockingPin.sections.push(rod(svg, pinStart, 33, 1, 'locking-pin-section'));
  lockingPin.arms.push(lever(svg, P, 33));
  drawRod(P, rod(svg, 36.5, 38, 4.3, 'pivot-shaft'), PIVOT_Y, PIVOT_Z);
  pivotSupport(svg, pivotP, 38);
  const frontBearing = bearing(svg, P, 43);
  const bearingGap = rod(svg, axleStart, 43, 4.3, 'axle-gap');
  drawRod(P, bearingGap, 0, AXIS_HEIGHT);
  frontBearing.support.back.before(bearingGap.group);
  const throughBearing = rod(svg, 43, 48, 4.3, 'axle-bore');
  drawRod(P, throughBearing, 0, AXIS_HEIGHT);
  frontBearing.support.frontWall.before(throughBearing.group);
  const throughCollar = rod(svg, 48, 50, 4.3, 'axle-collar');
  drawRod(P, throughCollar, 0, AXIS_HEIGHT);
  frontBearing.collar.frontWall.before(throughCollar.group);
  drawRod(P, rod(svg, 50, 58, 4.3, 'axle-tail'), 0, AXIS_HEIGHT);
  const control = dial(svg, P);
  const state = {
    P,
    stage,
    svg,
    read,
    wheels,
    fence: lockingPin,
    dial: control,
    targets: [...wheels, control],
    duration,
    motion: { from: 0, to: 0, clock: HL.tween(1, duration) },
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
