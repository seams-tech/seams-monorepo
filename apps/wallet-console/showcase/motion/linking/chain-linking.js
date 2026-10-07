/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const VIEW = [1.5, 0.288675, 1];
function add(a, b, scale = 1) {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return add([0, 0, 0], c, 1 / Math.hypot(...c));
}
function ellipse(x, y, vertical, length = 22) {
  const points = [];
  for (let i = 0; i <= 80; i++) {
    const angle = (i / 80) * Math.PI * 2;
    points.push([
      x + length * Math.cos(angle),
      y + (vertical ? 0 : 11 * Math.sin(angle)),
      vertical ? 11 * Math.sin(angle) : 0,
    ]);
  }
  return points;
}
function bodyPoints() {
  const curves = [
    [28, -23, 65, -27, 62, 35, 31, 30],
    [31, 30, 8, 27, -21, 22, -35, 15],
    [-35, 15, -58, 3, -50, -16, -26, -15],
  ];
  const points = [];
  for (const [ax, ay, bx, by, cx, cy, dx, dy] of curves) {
    for (let i = 0; i < 40; i++) {
      const t = i / 40,
        u = 1 - t;
      points.push([
        u ** 3 * ax + 3 * u ** 2 * t * bx + 3 * u * t ** 2 * cx + t ** 3 * dx,
        u ** 3 * ay + 3 * u ** 2 * t * by + 3 * u * t ** 2 * cy + t ** 3 * dy,
        0,
      ]);
    }
  }
  points.push([-26, -15, 0]);
  return points;
}
function upright(P, x, y, z) {
  return P(y * 0.866025 + x * 0.5, z, x * 0.866025 - y * 0.5);
}
function surface(center, normal, binormal, radius, angle) {
  return add(add(center, normal, radius * Math.cos(angle)), binormal, radius * Math.sin(angle));
}
function section(P, points, normal, index, radius) {
  const center = points[index];
  const tangent = add(
    points[Math.min(index + 1, points.length - 1)],
    points[Math.max(0, index - 1)],
    -1,
  );
  const binormal = cross(tangent, normal);
  const angle = Math.atan2(-dot(normal, VIEW), dot(binormal, VIEW));
  const ring = [];
  for (let j = 0; j < 16; j++)
    ring.push(P(...surface(center, normal, binormal, radius - 0.12, (j / 16) * Math.PI * 2)));
  const a = P(...surface(center, normal, binormal, radius, angle));
  const b = P(...surface(center, normal, binormal, radius, angle + Math.PI));
  return { center, ring, a, b };
}
function tube(state, points, normal, radius, accent = false, capped = false) {
  const start = state.used;
  state.used += points.length - 1;
  const signature = `${points[0]}:${points.at(-1)}:${radius}`;
  if (state.cache[start] === signature) return;
  state.cache[start] = signature;
  let previous = section(state.P, points, normal, 0, radius);
  for (let index = 1; index < points.length; index++) {
    const next = section(state.P, points, normal, index, radius);
    const part = state.parts[start + index - 1];
    part.fill.setAttribute('d', HL.poly(HL.hull(previous.ring.concat(next.ring))));
    let edge = HL.seg(previous.a, next.a) + HL.seg(previous.b, next.b);
    if (capped && index === 1) edge += HL.poly(previous.ring);
    if (capped && index === points.length - 1) edge += HL.poly(next.ring);
    part.edge.setAttribute('d', edge);
    part.edge.setAttribute('class', accent ? 'nf hi' : 'nf sil');
    part.depth = dot(add(previous.center, next.center), VIEW) / 2;
    previous = next;
  }
}
function gatePoint(angle, distance) {
  return [-26 + distance * Math.cos(angle), -15 + distance * Math.sin(angle), 0];
}
function gate(state, opening, lock) {
  const angle = Math.atan2(-8, 54) + HL.rad(48 * opening);
  const points = [];
  for (let i = 0; i <= 24; i++) points.push(gatePoint(angle, (Math.hypot(54, 8) * i) / 24));
  tube(state, points, [0, 0, 1], 2.8, false, true);
  // prettier-ignore
  const hinge = [[-26, -15, -4], [-26, -15, 4]];
  tube(state, hinge, [1, 0, 0], 3.6, false, true);
  const center = 24 + lock * 24;
  const sleeve = [];
  for (let i = 0; i <= 16; i++) sleeve.push(gatePoint(angle, center - 7 + (14 * i) / 16));
  tube(state, sleeve, [0, 0, 1], 5, true, true);
  for (let rib = 0; rib < 12; rib++) {
    const rotation = (rib / 12) * Math.PI * 2 + lock * Math.PI * 4;
    const radial = [
      Math.sin(angle) * Math.sin(rotation),
      -Math.cos(angle) * Math.sin(rotation),
      Math.cos(rotation),
    ];
    const a = add(gatePoint(angle, center - 5.5), radial, 5.1);
    const b = add(gatePoint(angle, center + 5.5), radial, 5.1);
    tube(state, [a, b], [0, 0, 1], 0.18);
  }
}
function order(a, b) {
  return a.depth - b.depth;
}
function groupOf(part) {
  return part.group;
}
function phase(progress, start, end) {
  return HL.clamp((progress - start) / (end - start), 0, 1);
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  state.used = 0;
  const opening = phase(progress, 0, 0.14) * (1 - phase(progress, 0.66, 0.76));
  const inserted = phase(progress, 0.16, 0.48);
  const seated = phase(progress, 0.48, 0.64);
  const x = HL.lerp(39, 76, seated);
  const y = HL.lerp(-66, 4, inserted);
  tube(state, ellipse(-61, 0, true), [0, 1, 0], 2.7);
  tube(state, ellipse(-95, 0, false), [0, 0, 1], 2.7);
  tube(state, bodyPoints(), [0, 0, 1], 4.5, false, true);
  tube(state, ellipse(x, y, true, 32), [0, 1, 0], 2.7);
  tube(state, ellipse(x + 46, y, false), [0, 0, 1], 2.7);
  gate(state, opening, phase(progress, 0.78, 1));
  state.svg.append(...state.parts.slice().sort(order).map(groupOf));
  state.read.textContent = state.active ? 'linking' : 'rest';
  if (state.active && progress >= 0.78) state.read.textContent = 'locking';
  if (state.active && progress === 1) state.read.textContent = 'linked';
  return !HL.tdone(state.motion, now);
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
}
function set(state, duration) {
  state.motion = HL.tween(HL.tval(state.motion, performance.now()), duration);
  HL.tset(state.motion, state.active ? 1 : 0, performance.now(), 0);
  state.loop.wake();
}
function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 1.3);
  const farCorner = [-132, 15, -69];
  HL.fit(C, [farCorner, [105, -15, 107]], 200, 160);
  const parts = [];
  for (let index = 0; index < 493; index++) {
    const group = HL.mk('g', {}, svg);
    const fill = HL.mk('path', { class: 'fo' }, group);
    const edge = HL.mk('path', { class: 'nf sil' }, group);
    parts.push({ group, fill, edge, depth: 0 });
  }
  const state = {
    svg,
    P: upright.bind(null, HL.proj(C)),
    parts,
    cache: [],
    used: 0,
    read,
    motion: HL.tween(0, duration),
    drawn: NaN,
    active: null,
    loop: null,
  };
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
  name: 'chain-linking',
  means: 'Hover to join the chains: the gate captures the link, then the sleeve screws shut.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [1800, 2200, 2600],
  mount,
});
