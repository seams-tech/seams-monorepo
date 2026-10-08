/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const MOVE_END = HL.EASE_LIFT(0.32);
const CODE_END = HL.EASE_LIFT(0.45);
const SCAN_END = HL.EASE_LIFT(0.75);
const QR_CELLS = [
  [6, 0],
  [6, 1],
  [6, 3],
  [0, 6],
  [2, 6],
  [3, 6],
  [5, 6],
  [6, 5],
  [6, 7],
  [8, 6],
  [10, 6],
  [12, 6],
  [5, 9],
  [6, 10],
  [8, 8],
  [9, 8],
  [11, 8],
  [8, 9],
  [11, 10],
  [12, 10],
  [6, 12],
  [8, 11],
  [9, 12],
  [11, 12],
];
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function screenPoint(P, center, point) {
  return P(3.1, center + point.u, point.v);
}
function screenPath(parent, P, center, ring, classes = 'lo nf') {
  return path(parent, HL.poly(ring.map(screenPoint.bind(null, P, center))), classes);
}
function screenLayer(parent, P, center) {
  const origin = P(3.1, center, 46);
  const u = P(3.1, center + 1, 46);
  const v = P(3.1, center, 45);
  const matrix = [
    u[0] - origin[0],
    u[1] - origin[1],
    v[0] - origin[0],
    v[1] - origin[1],
    ...origin,
  ];
  return HL.mk('g', { transform: `matrix(${matrix.join(' ')})` }, parent);
}
function phone(parent, P, center, name) {
  const group = HL.mk('g', { 'data-device': name }, parent);
  const ring = HL.rrect(-21, 4, 21, 88, 5, 12);
  const front = ring.map(screenPoint.bind(null, P, center));
  const back = [];
  for (const point of ring) back.push(P(-3, center + point.u, point.v));
  path(group, HL.poly(HL.hull(back.concat(front))), 'sil');
  path(group, HL.poly(front), name === 'scanner' ? 'hi' : 'sil');
  screenPath(group, P, center, HL.rrect(-18.5, 7, 18.5, 85, 3.8, 12));
  screenPath(group, P, center, HL.rrect(-4, 80, 4, 81.3, 0.65, 8));
  screenPath(group, P, center, HL.rrect(-5, 10, 5, 10.8, 0.4, 8));
  const screen = screenLayer(group, P, center);
  const content = HL.mk('g', { 'data-part': 'scan-content' }, screen);
  const qr = qrCode(content);
  const brackets = 'M-9 -15H-15V-9 M9 -15H15V-9 M15 9V15H9 M-9 15H-15V9';
  path(content, brackets, name === 'scanner' ? 'sil nf' : 'lo nf');
  const sweep = path(content, '', 'hi nf');
  sweep.setAttribute('data-part', 'scan-line');
  const success = HL.mk('g', { opacity: 0, 'data-part': 'success' }, screen);
  path(success, HL.poly(HL.ringAt(identity, HL.circ(10, 64), 0)), 'lo nf');
  const check = path(success, '', 'hi nf');
  return { group, content, qr, sweep, success, check };
}
function identity(x, y) {
  return [x, y];
}
function cell(x, y, size) {
  const pitch = 1.7;
  const left = (x - 6.5) * pitch;
  const top = (y - 6.5) * pitch;
  return HL.poly([
    [left, top],
    [left + size * pitch, top],
    [left + size * pitch, top + size * pitch],
    [left, top + size * pitch],
  ]);
}
function qrCode(parent) {
  const group = HL.mk('g', { 'data-part': 'qr-code' }, parent);
  let anchors = '';
  for (const [x, y] of [
    [0, 0],
    [8, 0],
    [0, 8],
  ]) {
    anchors += cell(x, y, 5) + cell(x + 1, y + 1, 3) + cell(x + 2, y + 2, 1);
  }
  const finders = path(group, anchors, 'dot m');
  finders.setAttribute('fill-rule', 'evenodd');
  const rows = [];
  for (let row = 0; row < 13; row++) {
    let modules = '';
    for (const [x, y] of QR_CELLS) {
      if (y === row) modules += cell(x, y, 1);
    }
    rows.push(path(group, modules, 'dot m'));
  }
  return { group, finders, rows };
}
function progressBetween(value, start, end) {
  return HL.clamp((value - start) / (end - start), 0, 1);
}
function drawScreen(device, code, scan, success, scanner) {
  device.content.setAttribute('opacity', 1 - progressBetween(success, 0, 0.2));
  device.qr.group.setAttribute('opacity', scanner ? code * 0.65 : 1);
  device.qr.finders.setAttribute('opacity', 0.35 + code * 0.65);
  for (let row = 0; row < device.qr.rows.length; row++) {
    const revealed = HL.clamp(code * 15 - row, 0, 1);
    device.qr.rows[row].setAttribute('opacity', revealed);
  }
  const sweepY = HL.lerp(-13, 13, scan);
  device.sweep.setAttribute('d', HL.seg([-13, sweepY], [13, sweepY]));
  device.sweep.setAttribute('opacity', Math.sin(Math.PI * scan));
  device.success.setAttribute('opacity', progressBetween(success, 0.12, 0.38));
  device.success.setAttribute('transform', `scale(${HL.lerp(0.94, 1, success)})`);
  const ink = progressBetween(success, 0.18, 0.85);
  const start = [-5, 0],
    corner = [-1, 4],
    end = [6, -5];
  const firstLength = Math.hypot(4, 4);
  const secondLength = Math.hypot(7, 9);
  const distance = ink * (firstLength + secondLength);
  const points = [start];
  if (distance <= firstLength) {
    points.push([
      HL.lerp(start[0], corner[0], distance / firstLength),
      HL.lerp(start[1], corner[1], distance / firstLength),
    ]);
  } else {
    const tail = (distance - firstLength) / secondLength;
    points.push(corner, [HL.lerp(corner[0], end[0], tail), HL.lerp(corner[1], end[1], tail)]);
  }
  device.check.setAttribute('d', ink > 0 ? HL.open(points) : '');
  device.success.setAttribute('data-progress', ink);
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const move = progressBetween(progress, 0, MOVE_END);
  const code = progressBetween(progress, MOVE_END, CODE_END);
  const scan = progressBetween(progress, CODE_END, SCAN_END);
  const success = progressBetween(progress, SCAN_END, 1);
  const origin = state.P(0, 0, 0);
  const offset = state.P(state.distance * move, 56 * move, 0);
  state.scanner.group.setAttribute(
    'transform',
    `translate(${offset[0] - origin[0]} ${offset[1] - origin[1]})`,
  );
  state.stage.setAttribute('data-move', move);
  state.stage.setAttribute('data-code', code);
  state.stage.setAttribute('data-scan', scan);
  state.stage.setAttribute('data-success', success);
  drawScreen(state.receiver, code, scan, success, false);
  drawScreen(state.scanner, code, scan, success, true);
  state.read.textContent = 'rest';
  if (state.active) {
    if (move < 1) state.read.textContent = 'aligning';
    else if (code < 1) state.read.textContent = 'pairing code';
    else if (scan < 1) state.read.textContent = 'scanning';
    else if (success < 1) state.read.textContent = 'confirming';
    else state.read.textContent = 'linked';
  }
  state.stage.setAttribute('aria-pressed', String(state.active));
  return !HL.tdone(state.motion, now);
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}
function keyboard(state, event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select(state, !state.active);
}
function set(state, distance) {
  state.distance = distance;
  state.drawn = NaN;
  state.loop.wake();
}
function view(P, x, y, z) {
  const point = P(x, y, z);
  return [400 - point[0], point[1]];
}
function mount({ stage, svg, read }, distance) {
  const C = HL.Cam(45, 0.5, 2.05);
  HL.fit(
    C,
    [
      [-3, -49, 88],
      [51, 49, 4],
      [-3, 49, 88],
      [51, -49, 4],
    ],
    230,
    160,
  );
  const P = view.bind(null, HL.proj(C));
  const receiver = phone(svg, P, 28, 'receiver');
  const scanner = phone(svg, P, -28, 'scanner');
  const state = {
    P,
    receiver,
    scanner,
    stage,
    read,
    distance,
    motion: HL.tween(0, 2200),
    drawn: NaN,
    active: false,
    loop: null,
  };
  stage.setAttribute('tabindex', '0');
  stage.setAttribute('role', 'button');
  stage.setAttribute(
    'aria-label',
    'Pair two devices by scanning a code. Hover or press Enter to animate.',
  );
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
  bag.on(stage, 'keydown', keyboard.bind(null, state));
  bag.on(stage, 'blur', select.bind(null, state, false));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}
hairline({
  name: 'device-linking',
  means:
    'Bring one phone forward to scan the other device’s pairing code, then confirm on both screens. Hover or press Enter.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [40, 44, 48],
  mount,
});
