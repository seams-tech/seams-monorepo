/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// The linked phones of delegation/device-linking.js, reduced to two flat
// screens. At rest they stand side by side; hovering brings the scanner face
// to face with the code, scans it along a dashed beam, and links both.
const DURATION = 1900;
const FACE = HL.rrect(-21, 4, 21, 88, 8, 16);
const SCREEN = HL.rrect(-17.5, 8, 17.5, 84, 5, 16);
// Three finder squares and a few modules: a code, not a real QR. u, v, size.
const CODE = [
  -11, 54, 7, 4, 54, 7, -11, 39, 7, -9, 56, 3, 6, 56, 3, -9, 41, 3, -1, 40, 2.5, -1, 45, 2.5, -2,
  50, 2.5, 0, 55, 2.5, 5, 40, 2.5, 9, 41, 2.5, 6, 45, 2.5, 9, 48, 2.5, 5, 49, 2.5, -9, 49, 2.5,
];
// The beam joins each corner of the code to one of the viewfinder.
const BEAM = [-11, 39, -13, 37, 11, 39, 13, 37, -11, 61, -13, 63, 11, 61, 13, 63];
// The viewfinder's corners: u, v and the direction of each arm.
const BRACKETS = [-13, 63, 1, -1, 13, 63, -1, -1, -13, 37, 1, 1, 13, 37, -1, 1];
// World [x, y] of each phone at rest: side by side, the scanner a step ahead.
const REST = { scanner: [10, -40], receiver: [-10, 40] };
const ALIGN_EASE = HL.bezier(0.77, 0, 0.175, 1);

// Joins fn(...group) for each group of n numbers in a flat list.
function each(list, n, fn) {
  let d = '';
  for (let index = 0; index < list.length; index += n) d += fn(...list.slice(index, index + n));
  return d;
}

// The code, or only the squares above the scan line once it has passed them.
function code(at, from) {
  return each(CODE, 3, (u, v, size) =>
    v + size < from
      ? ''
      : HL.poly([at(u, v), at(u + size, v), at(u + size, v + size), at(u, v + size)]),
  );
}

function brackets(at) {
  return each(BRACKETS, 4, (u, v, du, dv) =>
    HL.open([at(u, v + 4 * dv), at(u, v), at(u + 4 * du, v)]),
  );
}

function arc(at, progress) {
  if (progress <= 0) return '';
  const points = [];
  const steps = Math.max(1, Math.ceil(progress * 48));
  for (let step = 0; step <= steps; step++) {
    const angle = Math.PI / 2 - (step / steps) * progress * Math.PI * 2;
    points.push(at(8 * Math.cos(angle), 50 + 8 * Math.sin(angle)));
  }
  return HL.open(points);
}

function phone(svg) {
  const group = HL.mk('g', {}, svg);
  const classes = ['sil', 'nf lo', 'nf lo', 'nf sil', 'nf sil'];
  const [face, screen, detail, sweep, mark] = classes.map((c) =>
    HL.mk('path', { class: c }, group),
  );
  return { group, face, screen, detail, sweep, mark };
}

function surface(P, [x, y]) {
  return (u, v) => P(x, y + u, v);
}

function outline(device, at) {
  device.face.setAttribute('d', HL.poly(FACE.map((point) => at(point.u, point.v))));
  device.screen.setAttribute('d', HL.poly(SCREEN.map((point) => at(point.u, point.v))));
}

// Phase bounds in ms, mapped through the tween's ease (rule 08).
function phase(progress, start, end) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / DURATION));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

// Paint the farther phone, then the beam, then the nearer phone (rule 06).
function order(state, scanner, receiver) {
  const scannerNearer = scanner[0] + scanner[1] > receiver[0] + receiver[1];
  if (scannerNearer === state.scannerNearer) return;
  state.scannerNearer = scannerNearer;
  const { scanner: s, receiver: r, beam } = state;
  state.svg.append(...(scannerNearer ? [r.group, beam, s.group] : [s.group, beam, r.group]));
}

function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const move = ALIGN_EASE(phase(progress, 0, 500));
  const scan = phase(progress, 600, 1250);
  const link = phase(progress, 1350, 1850);
  const half = state.separation / 2;
  const scanner = [HL.lerp(REST.scanner[0], half, move), HL.lerp(REST.scanner[1], 0, move)];
  const receiver = [HL.lerp(REST.receiver[0], -half, move), HL.lerp(REST.receiver[1], 0, move)];
  order(state, scanner, receiver);
  const scannerAt = surface(state.P, scanner);
  const receiverAt = surface(state.P, receiver);
  outline(state.scanner, scannerAt);
  outline(state.receiver, receiverAt);
  const line = 63 - 26 * scan;
  const found = (scan > 0 ? code(scannerAt, line) : '') + brackets(scannerAt);
  state.scanner.detail.setAttribute('d', link > 0 ? '' : found);
  state.receiver.detail.setAttribute('d', link > 0 ? '' : code(receiverAt, -Infinity));
  const sweep = scan > 0 && scan < 1 ? HL.seg(scannerAt(-13, line), scannerAt(13, line)) : '';
  state.scanner.sweep.setAttribute('d', sweep);
  const beam = (u0, v0, u1, v1) => HL.seg(receiverAt(u0, v0), scannerAt(u1, v1));
  state.beam.setAttribute('d', scan > 0 && link < 1 ? each(BEAM, 4, beam) : '');
  state.scanner.mark.setAttribute('d', arc(scannerAt, link));
  state.receiver.mark.setAttribute('d', arc(receiverAt, link));
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

function highlight(state, device) {
  state.scanner.face.classList.toggle('hi', device === state.scanner);
  state.receiver.face.classList.toggle('hi', device === state.receiver);
}

// The phone whose rest centre is nearest the pointer takes the accent (rule 01).
function move(state, point) {
  const scannerX = state.P(...REST.scanner, 46)[0];
  const receiverX = state.P(...REST.receiver, 46)[0];
  const nearer = Math.abs(point[0] - scannerX) <= Math.abs(point[0] - receiverX);
  highlight(state, nearer ? state.scanner : state.receiver);
  select(state, true);
}

function leave(state) {
  highlight(state, state.scanner);
  select(state, false);
}

function set(state, separation) {
  state.separation = separation;
  state.drawn = NaN;
  state.loop.wake();
}

function mount({ stage, svg, read }, separation) {
  const C = HL.Cam(45, 0.5, 2.05);
  const corners = [];
  for (const [x, y] of Object.values(REST)) {
    for (const z of [4, 88]) corners.push([x, y - 21, z], [x, y + 21, z]);
  }
  HL.fit(C, corners, 200, 160);
  const project = HL.proj(C);
  // The mirrored view of the current figure.
  const P = (x, y, z) => [400 - project(x, y, z)[0], project(x, y, z)[1]];
  let axes = HL.seg(P(0, -54, 0), P(0, 54, 0));
  axes += HL.seg(P(-30, 0, 0), P(30, 0, 0));
  HL.mk('path', { d: axes, class: 'nf lo dash' }, svg);
  const beam = HL.mk('path', { class: 'nf lo dash' }, svg);
  const state = {
    svg,
    P,
    beam,
    receiver: phone(svg),
    scanner: phone(svg),
    read,
    separation,
    scannerNearer: null,
    motion: HL.tween(0, DURATION),
    drawn: NaN,
    active: false,
    loop: null,
  };
  highlight(state, state.scanner);
  state.loop = HL.register(stage, tick.bind(null, state));
  state.loop.wake();
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: leave.bind(null, state) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'abstract-devices',
  means:
    'Two phones as flat screens. Hover to bring the scanner face to face with the code, scan it, and link both.',
  rules: [1, 4, 6, 8],
  range: [56, 68, 80],
  mount,
});
