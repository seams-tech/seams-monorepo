/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// The linked phones as two plain planes on one module. Hover registers them
// face to face, traces the corner lines between them, then traces the nested
// rings of one onto the other, dashed and then solid, outside in.
const UNIT = 6;
const DURATION = 2200;
const [W, H] = [8 * UNIT, 14 * UNIT];
// Phone-like corners, about 15% of the width; corner lines leave each rounded
// corner at its 45° point.
const RADIUS = 7;
const FACE = HL.rrect(-W / 2, 0, W / 2, H, RADIUS, 10);
const IN = RADIUS * (1 - Math.SQRT1_2);
const CORNERS = [-W / 2 + IN, IN, W / 2 - IN, IN, W / 2 - IN, H - IN, -W / 2 + IN, H - IN];
// Four rings, one quarter of a ring apart, sharing their lowest point.
const RINGS = [4, 3, 2, 1].map((step) => step * 0.75 * UNIT);
const BASE = H / 2 - RINGS[0];
// At rest the planes stand at right angles, an open corner: the scanner's end
// sits one unit short of the code plane and one unit past its end. Both planes
// then move apart symmetrically, so rest and linked share one centre.
const GAP = UNIT;
const CORNER_SHIFT = (GAP + W / 2) / 2;
const CODE_REST = [CORNER_SHIFT, -CORNER_SHIFT, 0];
const SCANNER_REST = [-CORNER_SHIFT, CORNER_SHIFT, 90];
const WIDEST = 64;
const ALIGN_EASE = HL.bezier(0.77, 0, 0.175, 1);
const [ALIGN, CORNER, DASHED, SOLID] = [
  [0, 500],
  [550, 950],
  [950, 1500],
  [1500, 2150],
];
const RING_LAG = 0.12;

function ring(at, radius, progress) {
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
function rings(at, progress) {
  const span = 1 - RING_LAG * (RINGS.length - 1);
  const part = (index) => HL.clamp((progress - index * RING_LAG) / span, 0, 1);
  return RINGS.map((radius, index) => ring(at, radius, part(index))).join('');
}

function plane(svg) {
  const group = HL.mk('g', {}, svg);
  const face = HL.mk('path', { class: 'sil' }, group);
  const traced = HL.mk('path', { class: 'nf lo dash' }, group);
  const mark = HL.mk('path', { class: 'nf sil' }, group);
  return { group, face, traced, mark };
}

// A plane's surface: u across it, v up it, at world x, y, turned by yaw degrees.
function surface(P, [x, y, yaw]) {
  const [s, c] = [Math.sin(HL.rad(yaw)), Math.cos(HL.rad(yaw))];
  return (u, v) => P(x + u * s, y + u * c, v);
}

// Phase bounds in ms, mapped through the tween's ease (rule 08).
function phase(progress, [start, end]) {
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

// The four corner lines from one plane to the other, each as far as reach.
function corners(codeAt, scannerAt, reach) {
  let d = '';
  for (let index = 0; reach > 0 && index < CORNERS.length; index += 2) {
    const [a, b] = [
      codeAt(CORNERS[index], CORNERS[index + 1]),
      scannerAt(CORNERS[index], CORNERS[index + 1]),
    ];
    d += HL.seg(a, [HL.lerp(a[0], b[0], reach), HL.lerp(a[1], b[1], reach)]);
  }
  return d;
}

function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const move = ALIGN_EASE(phase(progress, ALIGN));
  const [reach, dashed, solid] = [CORNER, DASHED, SOLID].map((span) => phase(progress, span));
  const half = state.separation / 2;
  const toward = (rest, end) => rest.map((value, index) => HL.lerp(value, end[index], move));
  const [code, scanner] = [toward(CODE_REST, [half, 0, 0]), toward(SCANNER_REST, [-half, 0, 0])];
  order(state, code, scanner);
  const codeAt = surface(state.P, code);
  const scannerAt = surface(state.P, scanner);
  state.code.face.setAttribute('d', HL.poly(FACE.map((p) => codeAt(p.u, p.v))));
  state.scanner.face.setAttribute('d', HL.poly(FACE.map((p) => scannerAt(p.u, p.v))));
  state.code.mark.setAttribute('d', rings(codeAt, 1));
  // The dashed rings and the corner lines are construction: the solid trace
  // replaces them, and once it closes only the two ring sets remain.
  state.scanner.traced.setAttribute('d', solid < 1 ? rings(scannerAt, dashed) : '');
  state.scanner.mark.setAttribute('d', rings(scannerAt, solid));
  state.guides.setAttribute('d', solid < 1 ? corners(codeAt, scannerAt, reach) : '');
  const step = [move < 1, dashed < 1, solid < 1].indexOf(true);
  const text = ['aligning', 'scanning', 'linking'][step] ?? 'linked';
  state.read.textContent = state.active ? text : 'rest';
  return !HL.tdone(state.motion, now);
}

// The receiving plane takes the accent while the pointer is in (rule 04).
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  state.code.face.classList.toggle('hi', !active);
  state.scanner.face.classList.toggle('hi', active);
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

function set(state, separation) {
  state.separation = separation;
  state.drawn = NaN;
  state.loop.wake();
}

function mount({ stage, svg, read }, separation) {
  const C = HL.Cam(45, 0.5, 2.21);
  const extremes = [];
  const half = WIDEST / 2;
  for (const pose of [[half, 0, 0], [-half, 0, 0], CODE_REST, SCANNER_REST]) {
    const at = surface((x, y, z) => [x, y, z], pose);
    for (const u of [-W / 2, W / 2]) extremes.push(at(u, 0), at(u, H));
  }
  HL.fit(C, extremes, 200, 160);
  const project = HL.proj(C);
  // The mirrored view of the live figure.
  const P = (x, y, z) => [400 - project(x, y, z)[0], project(x, y, z)[1]];
  let axes = HL.seg(P(-48, 0, 0), P(48, 0, 0));
  axes += HL.seg(P(0, -42, 0), P(0, 42, 0));
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
  name: 'edge-devices',
  means:
    'Two plain planes on one module. Hover to register them face to face and trace the rings of one onto the other.',
  rules: [2, 4, 6, 8],
  range: [48, 56, 64],
  mount,
});
