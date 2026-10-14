/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const DURATION = 1900;
const MOVE_END = HL.EASE_LIFT(400 / DURATION);
const CODE_END = HL.EASE_LIFT(700 / DURATION);
const SCAN_END = HL.EASE_LIFT(1350 / DURATION);
// Finish the circle at 1600 ms, then draw the check over 250 ms.
const CIRCLE_END = (HL.EASE_LIFT(1600 / DURATION) - SCAN_END) / (1 - SCAN_END);
const TICK_END = (HL.EASE_LIFT(1850 / DURATION) - SCAN_END) / (1 - SCAN_END);
const ALIGN_EASE = HL.bezier(0.77, 0, 0.175, 1);
const FINISH_EASE = HL.bezier(0.23, 1, 0.32, 1);
// A compact illustrative matrix with quiet space around its three finder squares.
const QR_ROWS = [
  '00000000100000000',
  '00000000100000000',
  '00000000000000000',
  '00000000100000000',
  '00000000100000000',
  '00000000000000000',
  '00000000100000000',
  '00000000000000000',
  '11011010111010011',
  '00000000100111010',
  '00000000010100000',
  '00000000111010110',
  '00000000001100110',
  '00000000100111001',
  '00000000110101000',
  '00000000010001101',
  '00000000101100111',
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
  const origin = P(3.1, center, 48);
  const u = P(3.1, center + 1, 48);
  const v = P(3.1, center, 47);
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
  const ring = HL.rrect(-21, 4, 21, 92, 8, 16);
  const chassisRim = [];
  const back = [];
  for (const point of ring) {
    back.push(P(-1.6, center + point.u, point.v));
    chassisRim.push(P(2.7, center + point.u, point.v));
  }
  path(group, HL.poly(HL.hull(back.concat(chassisRim))), 'sil');
  path(group, HL.poly(chassisRim), 'lo nf');
  const outline = screenPath(
    group,
    P,
    center,
    HL.rrect(-20.65, 4.35, 20.65, 91.65, 7.65, 16),
    'sil',
  );
  screenPath(group, P, center, HL.rrect(-19.65, 5.35, 19.65, 90.65, 6.65, 16));
  screenPath(group, P, center, HL.rrect(-6.2, 84.2, 6.2, 87.5, 1.65, 12), 'dot m');
  screenPath(group, P, center, HL.rrect(3.7, 85.1, 5.1, 86.5, 0.7, 12), 'fo');
  screenPath(group, P, center, HL.rrect(-3.8, 90.25, 3.8, 90.6, 0.175, 8), 'dot m');
  screenPath(group, P, center, HL.rrect(-6.5, 8.1, 6.5, 8.8, 0.35, 8), 'dot m');
  sideButton(group, P, center, 55, 66, 'sil');
  sideButton(group, P, center, 26, 34, 'lo');
  for (const height of [15, 81]) {
    path(group, HL.seg(P(-1.2, center + 21, height), P(2.5, center + 21, height)));
  }
  const screen = screenLayer(group, P, center);
  const content = HL.mk('g', { 'data-part': 'scan-content' }, screen);
  const qr = qrCode(content);
  const brackets = 'M-11 -15H-15V-11 M11 -15H15V-11 M15 11V15H11 M-11 15H-15V11';
  path(content, brackets, 'lo nf');
  const sweep = path(content, '', 'sil nf');
  sweep.setAttribute('data-part', 'scan-line');
  const success = HL.mk('g', { opacity: 0, 'data-part': 'success' }, screen);
  const rim = path(success, '', 'sil nf');
  const check = path(success, '', 'sil nf');
  rim.setAttribute('data-part', 'success-circle');
  check.setAttribute('data-part', 'success-tick');
  return { group, outline, content, qr, sweep, success, rim, check };
}
function sideButton(parent, P, center, low, high, classes) {
  const points = [];
  for (const point of HL.rrect(-0.25, low, 1.25, high, 0.75, 10)) {
    points.push(P(point.u, center + 21.1, point.v));
  }
  path(parent, HL.poly(points), classes);
}
function successArc(progress) {
  const points = [];
  const segments = Math.max(1, Math.ceil(progress * 64));
  for (let step = 0; step <= segments; step++) {
    const angle = -Math.PI / 2 + (step / segments) * progress * Math.PI * 2;
    points.push([10 * Math.cos(angle), 10 * Math.sin(angle)]);
  }
  return progress > 0 ? HL.open(points) : '';
}
function cell(x, y, size) {
  const pitch = 1.35;
  const left = (x - 8.5) * pitch;
  const top = (y - 8.5) * pitch;
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
    [10, 0],
    [0, 10],
  ]) {
    anchors += cell(x, y, 7) + cell(x + 1, y + 1, 5) + cell(x + 2, y + 2, 3);
  }
  const finders = path(group, anchors, 'dot');
  finders.setAttribute('fill-rule', 'evenodd');
  const rows = [];
  for (let row = 0; row < QR_ROWS.length; row++) {
    let modules = '';
    for (let column = 0; column < QR_ROWS[row].length; column++) {
      if (QR_ROWS[row][column] === '1') modules += cell(column, row, 1);
    }
    rows.push(path(group, modules, 'dot'));
  }
  return { group, finders, rows };
}
function progressBetween(value, start, end) {
  return HL.clamp((value - start) / (end - start), 0, 1);
}
function tickStroke(ink) {
  if (ink <= 0) return '';
  const start = [-3.8, -0.1];
  const corner = [-1.1, 3];
  const end = [4.2, -4.5];
  const firstLength = Math.hypot(corner[0] - start[0], corner[1] - start[1]);
  const secondLength = Math.hypot(end[0] - corner[0], end[1] - corner[1]);
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
  return HL.open(points);
}
function drawScreen(device, code, scan, success, scanner) {
  device.content.setAttribute('opacity', 1 - progressBetween(success, 0, 0.2));
  const codeContrast = HL.lerp(0.55, 0.7, FINISH_EASE(progressBetween(scan, 0, 0.15)));
  device.qr.group.setAttribute('opacity', scanner ? code * 0.55 : codeContrast);
  device.qr.finders.setAttribute('opacity', 1);
  for (let row = 0; row < device.qr.rows.length; row++) {
    const revealed = scanner ? HL.clamp(code * (QR_ROWS.length + 1) - row, 0, 1) : 1;
    device.qr.rows[row].setAttribute('opacity', revealed);
  }
  const sweepY = HL.lerp(-13, 13, scan);
  device.sweep.setAttribute('d', HL.seg([-13, sweepY], [13, sweepY]));
  device.sweep.setAttribute('opacity', Math.sin(Math.PI * scan));
  const settle = FINISH_EASE(progressBetween(success, CIRCLE_END, 1));
  device.success.setAttribute('opacity', progressBetween(success, 0.22, 0.4));
  device.success.setAttribute('transform', `translate(0 -2) scale(${HL.lerp(0.96, 1, settle)})`);
  const circle = FINISH_EASE(progressBetween(success, 0.22, CIRCLE_END));
  device.rim.setAttribute('d', successArc(circle));
  device.rim.setAttribute('data-progress', circle);
  const ink = progressBetween(success, CIRCLE_END, TICK_END);
  device.check.setAttribute('d', tickStroke(ink));
  device.success.setAttribute('data-progress', ink);
  // Pass the single accent from the scanner's edge to its sweep, then confirmation.
  device.outline.classList.toggle('hi', scanner && scan === 0 && success === 0);
  device.sweep.classList.toggle('hi', scanner && scan > 0 && success === 0);
  device.rim.classList.toggle('hi', scanner && success > 0);
  device.check.classList.toggle('hi', scanner && success > 0);
}
function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const move = progressBetween(progress, 0, MOVE_END);
  const code = progressBetween(progress, MOVE_END, CODE_END);
  const scan = progressBetween(progress, CODE_END, SCAN_END);
  const success = progressBetween(progress, SCAN_END, 1);
  const alignment = ALIGN_EASE(move);
  const origin = state.P(0, 0, 0);
  // Share the approach equally to keep the pair centered while their screens align.
  const offset = state.P((state.distance / 2) * alignment, 28 * alignment, 0);
  const dx = offset[0] - origin[0];
  const dy = offset[1] - origin[1];
  state.scanner.group.setAttribute('transform', `translate(${dx} ${dy})`);
  state.receiver.group.setAttribute('transform', `translate(${-dx} ${-dy})`);
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
      [-3, -49, 92],
      [51, 49, 4],
      [-3, 49, 92],
      [51, -49, 4],
    ],
    230,
    152,
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
    motion: HL.tween(0, DURATION),
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
    'Align both phones to scan the pairing code, then confirm on both screens. Hover or press Enter.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [40, 44, 48],
  mount,
});
