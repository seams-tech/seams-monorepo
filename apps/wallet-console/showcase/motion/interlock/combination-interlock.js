/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
function path(parent, classes) {
  return HL.mk('path', { class: classes }, parent);
}
function circle(radius, start = 0, end = Math.PI * 2, y = 0, z = 0, steps = 72) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const angle = HL.lerp(start, end, i / steps);
    points.push([y + radius * Math.sin(angle), z + radius * Math.cos(angle)]);
  }
  return points;
}
function project(P, x, center, angle, point) {
  const y = point[0] * Math.cos(angle) + point[1] * Math.sin(angle);
  const z = point[1] * Math.cos(angle) - point[0] * Math.sin(angle);
  return P(x, y, z + center);
}
function body(svg, x, depth, profile, center = 43) {
  const wall = path(svg, 'fo');
  const back = path(svg, 'sil nf');
  const face = path(svg, 'sil');
  const detail = path(svg, 'lo nf');
  return { x, depth, profile, center, wall, back, face, detail, drawn: NaN };
}
function drawBody(P, part, angle, detail = '') {
  if (part.drawn === angle) return;
  part.drawn = angle;
  const far = part.profile.map(project.bind(null, P, part.x, part.center, angle));
  const near = part.profile.map(project.bind(null, P, part.x + part.depth, part.center, angle));
  let walls = '';
  let edges = '';
  const direction = [near[0][0] - far[0][0], near[0][1] - far[0][1]];
  for (let i = 0; i < far.length; i++) {
    const next = (i + 1) % far.length;
    const before = (i + far.length - 1) % far.length;
    const visible = sideVisible(far[i], far[next], direction);
    if (visible) walls += HL.poly([far[i], far[next], near[next], near[i]]);
    if (visible) edges += HL.seg(far[i], far[next]);
    if (visible !== sideVisible(far[before], far[i], direction)) edges += HL.seg(far[i], near[i]);
  }
  part.wall.setAttribute('d', HL.poly(far) + walls);
  part.back.setAttribute('d', edges);
  part.face.setAttribute('d', HL.poly(near));
  part.detail.setAttribute('d', detail);
}
function sideVisible(a, b, direction) {
  return (b[0] - a[0]) * direction[1] - (b[1] - a[1]) * direction[0] < 0;
}
function discProfile(radius = 31, slot = 6.5, floor = 17) {
  const opening = Math.asin(slot / radius);
  const contour = circle(radius, opening, Math.PI * 2 - opening);
  contour.push([-slot, floor], [slot, floor]);
  return HL.fillet(contour, Array(contour.length).fill(0.8), 3);
}
function discDetail(P, disc, angle) {
  const map = project.bind(null, P, disc.x + disc.depth, 43, angle);
  let d = HL.poly(discProfile(29.6, 7.8, 15.7).map(map));
  d += HL.poly(circle(11).map(map)) + HL.poly(circle(5).map(map));
  for (const degrees of [60, 180, 300]) {
    const theta = HL.rad(degrees);
    const pocket = circle(24, theta - 0.42, theta + 0.42, 0, 0, 12);
    pocket.push(...circle(19, theta + 0.42, theta - 0.42, 0, 0, 12));
    d += HL.poly(HL.fillet(pocket, Array(pocket.length).fill(0.9), 3).map(map));
    const pinAngle = theta + Math.sin(angle) * 0.2;
    const pin = circle(1.8, 0, Math.PI * 2, 21.5 * Math.sin(pinAngle), 21.5 * Math.cos(pinAngle));
    d += HL.poly(pin.map(map));
  }
  return d;
}
function bar(svg, low, high) {
  const surface = path(svg, 'fo');
  const edge = path(svg, 'sil nf');
  const crease = path(svg, 'lo nf');
  return { low, high, surface, edge, crease, drawn: NaN };
}
function drawBar(P, part, travel) {
  if (part.drawn === travel) return;
  part.drawn = travel;
  const start = Math.max(part.low, -135 + travel);
  const end = Math.min(part.high, -25 + travel);
  let fill = '';
  let edge = '';
  let crease = '';
  if (end > start) {
    const cross = HL.rrect(-4, 62, 4, 68, 1, 8);
    const a = cross.map(barPoint.bind(null, P, start));
    const b = cross.map(barPoint.bind(null, P, end));
    fill = HL.poly(HL.hull(a.concat(b)));
    edge = HL.seg(P(start, -4, 67), P(end, -4, 67)) + HL.seg(P(start, 4, 63), P(end, 4, 63));
    crease = HL.seg(P(start, 3, 68), P(end, 3, 68));
    if (end === -25 + travel) edge += HL.poly(b);
    if (start === -135 + travel)
      edge += HL.open(HL.run(cross, barFace).map(barPoint.bind(null, P, start)));
  }
  part.surface.setAttribute('d', fill);
  part.edge.setAttribute('d', edge);
  part.crease.setAttribute('d', crease);
}
function barFace(point) {
  return point.nu * Math.sqrt(0.375) + point.nv * 0.5 > 0;
}
function barPoint(P, x, point) {
  return P(x, point.u, point.v);
}
function pedestal(svg, P, x, tall) {
  const top = tall ? 77 : 53;
  const outline = [];
  outline.push([-13, 9], [-13, top]);
  if (tall) outline.push([-6.5, top], [-6.5, 60], [6.5, 60], [6.5, top]);
  outline.push([13, top], [13, 9]);
  const part = body(svg, x, 8, HL.fillet(outline, Array(outline.length).fill(2), 6), 0);
  const bearing = circle(8).map(project.bind(null, P, x + 8, 43, 0));
  const pocket = HL.rrect(-8, 15, 8, 29, 3, 8).map(barPoint.bind(null, P, x + 8));
  drawBody(P, part, 0, HL.poly(bearing) + HL.poly(pocket));
}
function base(svg, P, front) {
  const rings = HL.rings(-60, -38, 66, 38, 6, 1.5);
  HL.put(HL.solid(svg), HL.prism(P, front, rings[0], rings[1], 3, 9));
  for (const x of [-51, 57]) {
    for (const y of [-29, 29]) {
      const screw = HL.rrect(x - 2.8, y - 2.8, x + 2.8, y + 2.8, 2.8, 10);
      const slot = HL.seg(P(x - 1, y - 1, 9), P(x + 1, y + 1, 9));
      path(svg, 'lo nf').setAttribute('d', HL.poly(HL.ringAt(P, screw, 9)) + slot);
    }
  }
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  for (const [index, disc] of state.discs.entries()) {
    const delay = Math.abs(index - 1) * 0.08;
    const aligned = HL.clamp((progress - delay) / (0.58 - delay), 0, 1);
    const angle = HL.rad(disc.rest * (1 - aligned));
    drawBody(state.P, disc, angle, discDetail(state.P, disc, angle));
  }
  // One reversible timeline withdraws the bar fully before any disc can turn.
  const travel = 75 * HL.clamp((progress - 0.64) / 0.36, 0, 1);
  for (const part of state.bars) drawBar(state.P, part, travel);
  state.read.textContent = 'rest';
  if (state.active) state.read.textContent = progress < 0.64 ? 'aligning' : '3 aligned · open';
  return !HL.tdone(state.motion, now);
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  state.discs[1].face.classList.toggle('hi', !active);
  for (const part of state.bars) part.edge.classList.toggle('hi', active);
  HL.tset(state.motion, active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
}
function set(state, duration) {
  const now = performance.now();
  state.motion = HL.tween(HL.tval(state.motion, now), duration);
  HL.tset(state.motion, state.active ? 1 : 0, now, 0);
  state.loop.wake();
}
function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 1.75);
  const farCorner = [-135, -4, 68];
  const nearCorner = [104, 0, 3];
  HL.fit(C, [farCorner, nearCorner], 200, 166);
  const P = HL.proj(C);
  base(svg, P, HL.facing(C));
  const bars = [bar(svg, -135, -36)];
  pedestal(svg, P, -44, true);
  const discs = [];
  let previous = -36;
  for (const [index, x] of [-18, 9, 36].entries()) {
    drawBody(P, body(svg, previous, x + 7 - previous, circle(4)), 0);
    bars.push(bar(svg, index === 0 ? -36 : x - 20, x + 7));
    const disc = body(svg, x, 7, discProfile());
    disc.rest = [65, -48, 110][index];
    discs.push(disc);
    drawBody(P, body(svg, x + 7, 3, circle(9)), 0);
    previous = x + 10;
  }
  drawBody(P, body(svg, 46, 16, circle(4)), 0);
  bars.push(bar(svg, 43, 51));
  pedestal(svg, P, 54, false);
  const socket = circle(3, 0, Math.PI * 2, 0, 0, 6).map(project.bind(null, P, 65, 43, 0));
  drawBody(P, body(svg, 62, 3, circle(8)), 0, HL.poly(socket));
  const motion = HL.tween(0, duration);
  const state = { P, read, bars, discs, motion, active: null, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  select(state, false);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const move = select.bind(null, state, true);
  const leave = select.bind(null, state, false);
  bag.add(HL.pointer(stage, { move, leave }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}
hairline({
  name: 'interlock',
  means: 'Hover to align all three slots. Only then can the locking bar pass through.',
  rules: [1, 4, 6, 7, 8, 9],
  range: [900, 1200, 1500],
  mount,
});
