/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// The linked phones of delegation/device-linking.js as two plain planes. Hover
// turns them face to face and projects the nested rings of one onto the other.
const DURATION = 1900;
const FACE = HL.rrect(-21, 4, 21, 88, 3, 6);
// Corner points on the rounded outline, joined plane to plane while linking.
const CORNERS = [-20.1, 4.9, 20.1, 4.9, 20.1, 87.1, -20.1, 87.1];
const RINGS = [18, 14, 10, 6];
const BASE = 28;
// World x, y and turn of each plane at rest: apart and out of line.
const REST = { code: [12, -38, -8], scanner: [-10, 40, 14] };
const ALIGN_EASE = HL.bezier(0.77, 0, 0.175, 1);

function ring(at, radius, progress = 1) {
  if (progress <= 0) return '';
  const points = [];
  const steps = Math.max(1, Math.ceil(progress * 48));
  for (let step = 0; step <= steps; step++) {
    const angle = Math.PI / 2 - (step / steps) * progress * Math.PI * 2;
    points.push(at(radius * Math.cos(angle), BASE + radius + radius * Math.sin(angle)));
  }
  return progress < 1 ? HL.open(points) : HL.poly(points.slice(0, -1));
}

// Each ring starts a beat after the next larger one: outside in (rule 02).
const RING_LAG = 0.12;
function rings(at, progress) {
  const span = 1 - RING_LAG * (RINGS.length - 1);
  const part = (index) => HL.clamp((progress - index * RING_LAG) / span, 0, 1);
  return RINGS.map((radius, index) => ring(at, radius, part(index))).join('');
}

function plane(svg) {
  const group = HL.mk('g', {}, svg);
  const face = HL.mk('path', { class: 'sil' }, group);
  const mark = HL.mk('path', { class: 'nf sil' }, group);
  return { group, face, mark };
}

// A plane's surface: u across it, v up it, at world x, y, turned by yaw degrees.
function surface(P, [x, y, yaw]) {
  const [s, c] = [Math.sin(HL.rad(yaw)), Math.cos(HL.rad(yaw))];
  return (u, v) => P(x + u * s, y + u * c, v);
}

// Phase bounds in ms, mapped through the tween's ease (rule 08).
function phase(progress, start, end) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / DURATION));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

// Paint the farther plane, then the guides, then the nearer plane (rule 06).
function order(state, code, scanner) {
  const scannerNearer = scanner[0] + scanner[1] > code[0] + code[1];
  if (scannerNearer === state.scannerNearer) return;
  state.scannerNearer = scannerNearer;
  const { code: a, scanner: b, guides } = state;
  state.svg.append(...(scannerNearer ? [a.group, guides, b.group] : [b.group, guides, a.group]));
}

// Once the planes are parallel, the rings on one are the rings on the other
// moved by one screen offset, so the two lines tangent to both run along that
// offset from the outer ring's extreme points across it.
function guides(codeAt, scannerAt, reach, corners) {
  const segment = (a, b) => HL.seg(a, [HL.lerp(a[0], b[0], reach), HL.lerp(a[1], b[1], reach)]);
  let d = '';
  for (let index = 0; corners && index < CORNERS.length; index += 2) {
    const [u, v] = CORNERS.slice(index, index + 2);
    d += segment(codeAt(u, v), scannerAt(u, v));
  }
  const outer = RINGS[0];
  const from = [];
  for (let step = 0; step < 64; step++) {
    const angle = (step / 64) * Math.PI * 2;
    from.push([outer * Math.cos(angle), BASE + outer + outer * Math.sin(angle)]);
  }
  const [o, t] = [codeAt(0, BASE), scannerAt(0, BASE)];
  const normal = [o[1] - t[1], t[0] - o[0]];
  const side = from.map(([u, v]) => {
    const p = codeAt(u, v);
    return p[0] * normal[0] + p[1] * normal[1];
  });
  for (const extreme of [Math.max(...side), Math.min(...side)]) {
    const [u, v] = from[side.indexOf(extreme)];
    d += segment(codeAt(u, v), scannerAt(u, v));
  }
  return d;
}

function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const move = ALIGN_EASE(phase(progress, 0, 500));
  const scan = phase(progress, 600, 1250);
  const link = phase(progress, 1350, 1850);
  const half = state.separation / 2;
  const pose = (rest, x) => [HL.lerp(rest[0], x, move), rest[1] * (1 - move), rest[2] * (1 - move)];
  const code = pose(REST.code, half);
  const scanner = pose(REST.scanner, -half);
  order(state, code, scanner);
  const codeAt = surface(state.P, code);
  const scannerAt = surface(state.P, scanner);
  state.code.face.setAttribute('d', HL.poly(FACE.map((p) => codeAt(p.u, p.v))));
  state.scanner.face.setAttribute('d', HL.poly(FACE.map((p) => scannerAt(p.u, p.v))));
  state.code.mark.setAttribute('d', rings(codeAt, 1));
  state.scanner.mark.setAttribute('d', rings(scannerAt, link));
  // The corners guide the scan; once linked, only the rings' tangents remain.
  const lines = scan > 0 ? guides(codeAt, scannerAt, scan, link < 1) : '';
  state.guides.setAttribute('d', lines);
  const step = [move < 1, scan < 1, link < 1].indexOf(true);
  const text = ['aligning', 'scanning', 'linking'][step] ?? 'linked';
  state.read.textContent = state.active ? text : 'rest';
  return !HL.tdone(state.motion, now);
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

function highlight(state, target) {
  state.code.face.classList.toggle('hi', target === state.code);
  state.scanner.face.classList.toggle('hi', target === state.scanner);
}

// The plane whose rest centre is nearest the pointer takes the accent (rule 01).
function move(state, point) {
  const codeX = state.P(REST.code[0], REST.code[1], 46)[0];
  const scannerX = state.P(REST.scanner[0], REST.scanner[1], 46)[0];
  const nearer = Math.abs(point[0] - codeX) <= Math.abs(point[0] - scannerX);
  highlight(state, nearer ? state.code : state.scanner);
  select(state, true);
}

function leave(state) {
  highlight(state, state.code);
  select(state, false);
}

function set(state, separation) {
  state.separation = separation;
  state.drawn = NaN;
  state.loop.wake();
}

function mount({ stage, svg, read }, separation) {
  const C = HL.Cam(45, 0.5, 2.15);
  const corners = [];
  for (const rest of Object.values(REST)) {
    const at = surface((x, y, z) => [x, y, z], rest);
    for (const v of [4, 88]) corners.push(at(-21, v), at(21, v));
  }
  HL.fit(C, corners, 200, 160);
  const project = HL.proj(C);
  // The mirrored view of the current figure.
  const P = (x, y, z) => [400 - project(x, y, z)[0], project(x, y, z)[1]];
  let axes = HL.seg(P(0, -54, 0), P(0, 44, 0));
  axes += HL.seg(P(-44, 0, 0), P(44, 0, 0));
  HL.mk('path', { d: axes, class: 'nf lo dash' }, svg);
  const state = {
    svg,
    P,
    guides: HL.mk('path', { class: 'nf lo dash' }, svg),
    code: plane(svg),
    scanner: plane(svg),
    read,
    separation,
    scannerNearer: null,
    motion: HL.tween(0, DURATION),
    drawn: NaN,
    active: false,
    loop: null,
  };
  highlight(state, state.code);
  state.loop = HL.register(stage, tick.bind(null, state));
  state.loop.wake();
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: leave.bind(null, state) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'plane-devices',
  means:
    'Two plain planes. Hover to turn them face to face and project the rings of one onto the other.',
  rules: [1, 4, 6, 8],
  range: [56, 68, 80],
  mount,
});
