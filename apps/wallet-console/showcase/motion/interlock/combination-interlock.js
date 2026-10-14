/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const KEY_TRAVEL = 76;
const KEY_HALF_THICKNESS = 1.6;
const SLOT_HALF_WIDTH = 2.6;
const SLOT_BEVEL = 0.65;
const INSERT_END = HL.EASE_LIFT(0.45);
const TURN_ANGLE = -60;
const KEY_PROFILE = keyProfile();
function keyProfile() {
  const neckAngle = Math.asin(3 / 24.2);
  const neck = bowPoint(-neckAngle)[0];
  const outline = [
    [neck, 3],
    [-17.8, 3],
    [-17.8, 17.5],
    [-11.2, 17.5],
    [-11.2, 3],
    [9.2, 3],
    [9.2, 17.5],
    [15.8, 17.5],
    [15.8, 3],
    [36.2, 3],
    [36.2, 17.5],
    [42.8, 17.5],
    [42.8, 3],
    [49, 3],
    [51, 1],
    [51, -3],
    [neck, -3],
  ];
  for (let step = 1; step < 64; step++) {
    const angle = HL.lerp(-neckAngle, -Math.PI * 2 + neckAngle, step / 64);
    outline.push(bowPoint(angle));
  }
  return HL.fillet(outline, Array(outline.length).fill(0.5), 4);
}
function bowPoint(angle) {
  const scallop = 1 + 0.1 * Math.cos(4 * angle);
  return [-68 + 16 * scallop * Math.cos(angle), 22 * scallop * Math.sin(angle)];
}
function path(parent, classes) {
  return HL.mk('path', { class: classes }, parent);
}
function circle(radius, start = 0, end = Math.PI * 2) {
  const points = [];
  for (let i = 0; i <= 72; i++) {
    const angle = HL.lerp(start, end, i / 72);
    points.push([radius * Math.sin(angle), radius * Math.cos(angle)]);
  }
  return points;
}
function project(P, x, center, angle, point) {
  const y = point[0] * Math.cos(angle) + point[1] * Math.sin(angle);
  const z = point[1] * Math.cos(angle) - point[0] * Math.sin(angle);
  return P(x, y, z + center);
}
function body(svg, x, depth, profile, center = 43, hole = [], mouth = []) {
  const wall = path(svg, 'fo');
  const back = path(svg, 'sil nf');
  const frontWall = path(svg, 'fo');
  const face = path(svg, 'sil');
  const detail = path(svg, 'lo nf');
  return { x, depth, profile, hole, mouth, center, wall, back, frontWall, face, detail };
}
function drawBody(P, part, angle, detail = '') {
  let farFaces = '';
  let nearFaces = '';
  let walls = '';
  let edges = '';
  let frontWalls = '';
  let frontEdges = '';
  for (const profile of [part.profile, part.hole]) {
    if (profile.length === 0) continue;
    const bevelled = profile === part.hole && part.mouth.length > 0;
    const nearX = part.x + part.depth;
    const far = profile.map(project.bind(null, P, part.x, part.center, angle));
    const near = profile.map(
      project.bind(null, P, nearX - (bevelled ? SLOT_BEVEL : 0), part.center, angle),
    );
    farFaces += HL.poly(far);
    if (bevelled) {
      const mouth = part.mouth.map(project.bind(null, P, nearX, part.center, angle));
      nearFaces += HL.poly(mouth);
      frontWalls += HL.poly(mouth) + HL.poly(near.slice().reverse());
      detail += HL.poly(near);
    } else {
      nearFaces += HL.poly(near);
    }
    const direction = [near[0][0] - far[0][0], near[0][1] - far[0][1]];
    for (let i = 0; i < far.length; i++) {
      const next = (i + 1) % far.length;
      const before = (i + far.length - 1) % far.length;
      const visible = sideVisible(far[i], far[next], direction);
      const wall = HL.poly([far[i], far[next], near[next], near[i]]);
      const inSlot =
        profile === part.hole ||
        (Math.abs(profile[i][0]) <= SLOT_HALF_WIDTH + 0.001 && profile[i][1] >= 0);
      if (visible) walls += wall;
      if (visible && !inSlot) frontWalls += wall;
      let edge = visible ? HL.seg(far[i], far[next]) : '';
      if (visible !== sideVisible(far[before], far[i], direction)) edge += HL.seg(far[i], near[i]);
      if (inSlot) edges += edge;
      else frontEdges += edge;
    }
  }
  part.wall.setAttribute('d', farFaces + walls);
  part.back.setAttribute('d', edges);
  part.frontWall.setAttribute('d', frontWalls);
  part.face.setAttribute('d', nearFaces + frontEdges);
  part.detail.setAttribute('d', detail);
}
function sideVisible(a, b, direction) {
  return (b[0] - a[0]) * direction[1] - (b[1] - a[1]) * direction[0] < 0;
}
function slottedRing(outerRadius, innerRadius) {
  const outerAngle = Math.asin(SLOT_HALF_WIDTH / outerRadius);
  const innerAngle = Math.asin(SLOT_HALF_WIDTH / innerRadius);
  const contour = circle(outerRadius, outerAngle, Math.PI * 2 - outerAngle);
  contour.push(...circle(innerRadius, Math.PI * 2 - innerAngle, innerAngle));
  return contour;
}
function discKeyway(bevel) {
  const width = SLOT_HALF_WIDTH + bevel;
  const radius = 6 + bevel;
  const angle = Math.asin(width / radius);
  const contour = [
    [-width, 18.5 + bevel],
    ...circle(radius, Math.PI * 2 - angle, angle),
    [width, 18.5 + bevel],
  ];
  return HL.fillet(contour, Array(contour.length).fill(0.45 + bevel), 4);
}
function discDetail(P, disc, angle) {
  const map = project.bind(null, P, disc.x + disc.depth, 43, angle);
  let d = HL.poly(circle(26).map(map));
  for (let i = 1; i < 24; i++) {
    const theta = (i * Math.PI) / 12;
    d += HL.seg(
      map([27.5 * Math.sin(theta), 27.5 * Math.cos(theta)]),
      map([29.5 * Math.sin(theta), 29.5 * Math.cos(theta)]),
    );
  }
  return d;
}
function keySection(svg, low, high, cover) {
  const surface = path(svg, 'fo');
  const edge = path(svg, 'sil nf');
  const bore = path(svg, 'lo');
  const crease = path(svg, 'lo nf');
  if (cover) svg.append(cover.frontWall, cover.face, cover.detail);
  return { low, high, surface, edge, bore, crease };
}
function clipProfile(profile, boundary, keepRight) {
  const result = [];
  for (let index = 0; index < profile.length; index++) {
    const a = profile[index];
    const b = profile[(index + 1) % profile.length];
    const aInside = keepRight ? a[0] >= boundary : a[0] <= boundary;
    const bInside = keepRight ? b[0] >= boundary : b[0] <= boundary;
    if (aInside) result.push(a);
    if (aInside !== bInside) {
      const fraction = (boundary - a[0]) / (b[0] - a[0]);
      result.push([boundary, HL.lerp(a[1], b[1], fraction)]);
    }
  }
  return result;
}
function keyPoint(P, offset, angle, thickness, point) {
  return project(P, point[0] + offset, 43, angle, [thickness, point[1]]);
}
function holePoint(point) {
  return [point[0] * (9 / 8.5) - 68, point[1] * (14 / 8.5)];
}
function drawKey(P, part, offset, angle) {
  const low = part.low - offset;
  const high = part.high - offset;
  const profile = clipProfile(clipProfile(KEY_PROFILE, low, true), high, false);
  const mapFar = keyPoint.bind(null, P, offset, angle, -KEY_HALF_THICKNESS);
  const mapNear = keyPoint.bind(null, P, offset, angle, KEY_HALF_THICKNESS);
  const far = profile.map(mapFar);
  const near = profile.map(mapNear);
  let walls = '';
  let edges = '';
  let detail = '';
  let bore = '';
  if (profile.length > 0) {
    const direction = [near[0][0] - far[0][0], near[0][1] - far[0][1]];
    for (let index = 0; index < profile.length; index++) {
      const next = (index + 1) % profile.length;
      const clipped =
        profile[index][0] === profile[next][0] &&
        (profile[index][0] === low || profile[index][0] === high);
      if (!clipped) edges += HL.seg(near[index], near[next]);
      const visible = !sideVisible(far[index], far[next], direction);
      const previous = (index + profile.length - 1) % profile.length;
      if (visible) {
        walls += HL.poly([far[index], far[next], near[next], near[index]]);
        if (!clipped) edges += HL.seg(far[index], far[next]);
      }
      if (!clipped && visible !== !sideVisible(far[previous], far[index], direction)) {
        edges += HL.seg(far[index], near[index]);
      }
    }
    if (low < -78 && high > -58) {
      const hole = circle(8.5).map(holePoint);
      bore = HL.poly(hole.map(mapNear));
    }
    const grooveStart = Math.max(low, -46);
    const grooveEnd = Math.min(high, 45);
    if (grooveEnd > grooveStart) {
      detail += HL.seg(mapNear([grooveStart, 1.3]), mapNear([grooveEnd, 1.3]));
    }
  }
  part.surface.setAttribute('d', profile.length ? walls + HL.poly(near) : '');
  part.edge.setAttribute('d', edges);
  part.bore.setAttribute('d', bore);
  part.crease.setAttribute('d', detail);
}
function pedestal(svg, P, x, entry = false) {
  const outline = [
    [-13, 9],
    [-13, 53],
  ];
  if (entry) {
    const angle = Math.asin(SLOT_HALF_WIDTH / 7);
    outline.push([-SLOT_HALF_WIDTH, 53]);
    for (const point of circle(7, Math.PI * 2 - angle, angle)) {
      outline.push([point[0], point[1] + 43]);
    }
    outline.push([SLOT_HALF_WIDTH, 53]);
  }
  outline.push([13, 53], [13, 9]);
  const part = body(svg, x, 8, HL.fillet(outline, Array(outline.length).fill(0.4), 5), 0);
  drawBody(
    P,
    part,
    0,
    HL.open(circle(9, 0.85, Math.PI * 2 - 0.85).map(project.bind(null, P, x + 8, 43, 0))),
  );
  return part;
}
function base(svg, P, front) {
  HL.put(HL.solid(svg), HL.prism(P, front, ...HL.rings(-60, -38, 66, 38, 6, 1.5), 3, 9));
  for (const x of [-51, 57]) {
    for (const y of [-29, 29]) {
      const screw = HL.rrect(x - 2.8, y - 2.8, x + 2.8, y + 2.8, 2.8, 10);
      path(svg, 'lo nf').setAttribute('d', HL.poly(HL.ringAt(P, screw, 9)));
    }
  }
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const insertion = HL.clamp(progress / INSERT_END, 0, 1);
  const turn = HL.clamp((progress - INSERT_END) / (1 - INSERT_END), 0, 1);
  const angle = HL.rad(TURN_ANGLE * turn);
  // Both phases share one reversible clock: turn back fully before withdrawal.
  for (const sleeve of state.sleeves) drawBody(state.P, sleeve, angle);
  for (const disc of state.discs) {
    drawBody(state.P, disc, angle, discDetail(state.P, disc, angle));
  }
  for (const part of state.keys) drawKey(state.P, part, KEY_TRAVEL * (insertion - 1), angle);
  state.svg.dataset.insertion = insertion;
  state.svg.dataset.turn = turn;
  state.read.textContent = 'rest';
  if (progress > 0 && insertion < 1)
    state.read.textContent = state.active ? 'inserting' : 'withdrawing';
  if (insertion === 1 && turn < 1) state.read.textContent = state.active ? 'turning' : 'returning';
  if (turn === 1) state.read.textContent = '3 engaged · turned';
  return !HL.tdone(state.motion, now);
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  state.stage.setAttribute('aria-pressed', String(active));
  HL.tset(state.motion, active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
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
  const C = HL.Cam(45, 0.5, 1.5);
  HL.fit(
    C,
    [
      [-164, -KEY_HALF_THICKNESS, 67.2],
      [66, -38, 3],
      [-60, 38, 9],
      [66, 38, 9],
    ],
    200,
    166,
  );
  const P = HL.proj(C);
  base(svg, P, HL.facing(C));
  const keys = [keySection(svg, -180, -36, pedestal(svg, P, -44, true))];
  const discs = [];
  const sleeves = [];
  let previous = -36;
  for (const x of [-18, 9, 36]) {
    sleeves.push(body(svg, previous, x - previous, slottedRing(8, 7)));
    const disc = body(svg, x, 7, circle(31), 43, discKeyway(0), discKeyway(SLOT_BEVEL));
    keys.push(keySection(svg, x === -18 ? -36 : x - 20, x + 7, disc));
    discs.push(disc);
    previous = x + 7;
  }
  sleeves.push(body(svg, 43, 11, slottedRing(8, 7)));
  keys.push(keySection(svg, 43, 52));
  pedestal(svg, P, 54);
  drawBody(P, body(svg, 62, 2, circle(7)), 0, HL.seg(P(64, -3, 40), P(64, 3, 46)));
  const motion = HL.tween(0, duration);
  const state = {
    P,
    svg,
    read,
    stage,
    keys,
    discs,
    sleeves,
    motion,
    drawn: NaN,
    active: false,
    loop: null,
  };
  state.loop = HL.register(stage, tick.bind(null, state));
  for (const part of keys) part.edge.classList.add('hi');
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const move = select.bind(null, state, true);
  const leave = select.bind(null, state, false);
  bag.add(HL.pointer(stage, { move, leave }));
  stage.tabIndex = 0;
  stage.setAttribute('role', 'button');
  stage.setAttribute('aria-label', 'Insert and turn the interlock key');
  stage.setAttribute('aria-pressed', 'false');
  bag.on(stage, 'keydown', keydown.bind(null, state));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}
hairline({
  name: 'interlock',
  means:
    'Hover to insert the key, then turn it with all three discs. Leave to turn back before withdrawing.',
  rules: [1, 4, 6, 7, 8, 9],
  range: [900, 1200, 1500],
  mount,
});
