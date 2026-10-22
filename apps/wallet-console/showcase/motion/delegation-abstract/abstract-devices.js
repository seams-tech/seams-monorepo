/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// The linked phones of delegation/device-linking.js, reduced to two flat
// screens: the same camera and choreography, without bezels or buttons.
const DURATION = 1900;
const OFFSET_Y = 28;
const FACE = HL.rrect(-21, 4, 21, 92, 8, 16);
// Three finder squares and a few modules: a code, not a real QR.
// u, v pairs on the face.
const FINDERS = [-11, 54, 4, 54, -11, 39];
const MODULES = [5, 40, 8, 44, 4, 47, 9, 49, 0, 42];
const ALIGN_EASE = HL.bezier(0.77, 0, 0.175, 1);

function square(at, u, v, size) {
  return HL.poly([at(u, v), at(u + size, v), at(u + size, v + size), at(u, v + size)]);
}

function brackets(at) {
  let d = '';
  for (const [u, v, du, dv] of [
    [-13, 63, 1, -1],
    [13, 63, -1, -1],
    [-13, 37, 1, 1],
    [13, 37, -1, 1],
  ]) {
    d += HL.open([at(u, v + 4 * dv), at(u, v), at(u + 4 * du, v)]);
  }
  return d;
}

function arc(at, progress) {
  if (progress <= 0) return '';
  const points = [];
  const steps = Math.max(1, Math.ceil(progress * 48));
  for (let step = 0; step <= steps; step++) {
    const angle = Math.PI / 2 - (step / steps) * progress * Math.PI * 2;
    points.push(at(7 * Math.cos(angle), 50 + 7 * Math.sin(angle)));
  }
  return HL.open(points);
}

function phone(svg, P, center) {
  const group = HL.mk('g', {}, svg);
  const at = (u, v) => P(0, center + u, v);
  const face = HL.poly(FACE.map((point) => at(point.u, point.v)));
  const outline = HL.mk('path', { d: face, class: 'sil' }, group);
  const code = HL.mk('g', {}, group);
  let finders = '';
  let modules = '';
  for (let index = 0; index < FINDERS.length; index += 2) {
    const [u, v] = FINDERS.slice(index, index + 2);
    finders += square(at, u, v, 7);
    modules += square(at, u + 2, v + 2, 3);
  }
  for (let index = 0; index < MODULES.length; index += 2) {
    modules += square(at, MODULES[index], MODULES[index + 1], 2);
  }
  HL.mk('path', { d: finders, class: 'lo nf' }, code);
  HL.mk('path', { d: modules, class: 'dot m' }, code);
  const frame = HL.mk('path', { d: brackets(at), class: 'lo nf' }, group);
  const sweep = HL.mk('path', { class: 'sil nf' }, group);
  const mark = HL.mk('path', { class: 'sil nf' }, group);
  return { group, at, restX: at(0, 50)[0], outline, code, frame, sweep, mark };
}

function shift(state, amount) {
  const origin = state.P(0, 0, 0);
  const point = state.P((state.distance / 2) * amount, OFFSET_Y * amount, 0);
  return [point[0] - origin[0], point[1] - origin[1]];
}

// Phase bounds in ms, mapped through the tween's ease (rule 08).
function phase(progress, start, end) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / DURATION));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const move = phase(progress, 0, 450);
  const scan = phase(progress, 600, 1250);
  const link = phase(progress, 1350, 1850);
  const [dx, dy] = shift(state, ALIGN_EASE(move));
  state.scanner.group.setAttribute('transform', `translate(${dx} ${dy})`);
  state.receiver.group.setAttribute('transform', `translate(${-dx} ${-dy})`);
  const from = state.receiver.at(0, 50);
  const to = state.scanner.at(0, 50);
  state.link.setAttribute('d', HL.seg([from[0] - dx, from[1] - dy], [to[0] + dx, to[1] + dy]));
  state.receiver.code.setAttribute('display', link > 0 ? 'none' : 'inline');
  state.scanner.frame.setAttribute('display', link > 0 ? 'none' : 'inline');
  const at = state.scanner.at;
  const height = 62 - 24 * scan;
  state.scanner.sweep.setAttribute(
    'd',
    scan > 0 && scan < 1 ? HL.seg(at(-12, height), at(12, height)) : '',
  );
  for (const device of [state.receiver, state.scanner]) {
    device.mark.setAttribute('d', arc(device.at, link));
  }
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
  state.scanner.outline.classList.toggle('hi', device === state.scanner);
  state.receiver.outline.classList.toggle('hi', device === state.receiver);
}

// The phone whose rest centre is nearest the pointer takes the accent (rule 01).
function move(state, point) {
  const { scanner, receiver } = state;
  const nearer = Math.abs(point[0] - scanner.restX) <= Math.abs(point[0] - receiver.restX);
  highlight(state, nearer ? scanner : receiver);
  select(state, true);
}

function leave(state) {
  highlight(state, state.scanner);
  select(state, false);
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
  let axes = HL.seg(P(0, -60, 0), P(0, 60, 0));
  axes += HL.seg(P(-34, 0, 0), P(34, 0, 0));
  HL.mk('path', { d: axes, class: 'nf lo dash' }, svg);
  const link = HL.mk('path', { class: 'nf lo dash' }, svg);
  const receiver = phone(svg, P, 28);
  const scanner = phone(svg, P, -28);
  receiver.frame.remove();
  scanner.code.remove();
  const state = {
    P,
    receiver,
    scanner,
    link,
    read,
    distance,
    motion: HL.tween(0, DURATION),
    drawn: NaN,
    active: false,
    loop: null,
  };
  highlight(state, scanner);
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
    'Two phones as flat screens. Hover to align them, scan the code, and show one mark on both.',
  rules: [1, 4, 6, 8],
  range: [40, 44, 48],
  mount,
});
