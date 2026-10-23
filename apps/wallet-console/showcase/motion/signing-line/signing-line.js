/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// Threshold signing in line only. Two plates each hold half of one circle; the
// half a plate lacks is a dashed outline. Hover traces both paths, slides the
// halves along them until they meet as one circle, turns a stack of four
// upright policy plates until their off-centre holes line up on the path,
// passes the circle through the holes edge-on, and lands it on the last plate,
// where hatching fills it in: the signature. Drawn in x-ray, in place of rule
// 06: nothing is opaque, and a line that a plate hides is dashed.
const DURATION = 2400;
// Every flat plate and every path lies at height Z; the circle has radius R.
const [Z, R] = [6, 10];
const [PLATE_X, PLATE_Y] = [26, 18];
const SHARES = [-50, 50];
const [MERGE, CLEAR, RESULT] = [86, 156, 220];
// The policy plates: the permissions figure's stack laid on its side, along the
// path. Each is a square of half side GATE with a round hole off its centre;
// HOLE is the hole's place in the plate and its radius, wide enough for the
// circle to pass edge-on. The stack's axis runs through the plates' centres,
// beside the path, so turning a plate about it moves its hole off the path.
const GATES = [102, 114, 126, 138];
const GATE = 25;
const HOLE = [10, -7, 11];
// At rest each plate is turned a little further than the one before.
const TURNED = [12, 24, 36, 48];
// Phases on one play head, in ms: the solid trace, the halves gathering, the
// checks, the way out, then the signature.
const TRACE = [0, 520];
const GATHER = [220, 1000];
const CHECK = [1000, 1520];
const OUT = [1520, 1950];
const SIGN = [1950, DURATION];
// The plates turn into place one after another, towards the result, before the
// joined circle reaches the first of them.
const [TURN_AT, TURN_STEP, TURN_MS] = [150, 120, 480];
const EASE = HL.bezier(0.65, 0, 0.35, 1);
const text = (key, english) => window.walletFigureText?.(key) ?? english;
const span = (t, [a, b]) => HL.clamp((t - a) / (b - a), 0, 1);
// Towards the camera: a step along it keeps a point's place on screen.
const VIEW = [Math.SQRT1_2, Math.SQRT1_2, 0.5 / Math.sqrt(0.75)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => a.map((value, i) => value - b[i]);
const [X, Y, UP] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

// Whether a plate nearer the camera covers the world point w.
function hidden(state, w) {
  for (const p of state.plates) {
    const t = dot(sub(p.c, w), p.n) / dot(VIEW, p.n);
    if (t < 0.01) continue;
    const q = sub(
      w.map((value, i) => value + t * VIEW[i]),
      p.c,
    );
    const [a, b] = [dot(q, p.u), dot(q, p.v)];
    const inHole = p.hole && Math.hypot(a - p.hole[0], b - p.hole[1]) < p.hole[2];
    if (Math.abs(a) < p.hu && Math.abs(b) < p.hv && !inHole) return true;
  }
  return false;
}
// A world polyline in x-ray, as [solid, dashed] path strings. Each run ends
// exactly where a plate's edge crosses it, found by bisecting the step between
// the last sample on one side and the first on the other.
function xray(state, points) {
  const flags = points.map((w) => hidden(state, w));
  const out = ['', ''];
  const close = (run, flag) => (out[flag ? 1 : 0] += HL.open(run.map((w) => state.P(...w))));
  let run = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (flags[i] !== flags[i - 1]) {
      let [a, b] = [points[i - 1], points[i]];
      for (let step = 0; step < 10; step++) {
        const middle = a.map((value, k) => (value + b[k]) / 2);
        if (hidden(state, middle) === flags[i - 1]) a = middle;
        else b = middle;
      }
      const crossing = a.map((value, k) => (value + b[k]) / 2);
      close([...run, crossing], flags[i - 1]);
      run = [crossing];
    }
    run.push(points[i]);
  }
  close(run, flags.at(-1));
  return out;
}
function pair(parent, cls = 'nf sil') {
  return [HL.mk('path', { class: cls }, parent), HL.mk('path', { class: 'nf lo dash' }, parent)];
}
function draw([solid, dashed], [d0, d1]) {
  solid.setAttribute('d', d0);
  dashed.setAttribute('d', d1);
}
function edge(a, b, n = 24) {
  return Array.from({ length: n + 1 }, (_, i) => a.map((value, k) => HL.lerp(value, b[k], i / n)));
}
// A closed outline through corners, sampled along each side.
const outlineOf = (corners) =>
  corners.flatMap((a, i) => edge(a, corners[(i + 1) % corners.length]).slice(i ? 1 : 0));
// A flat plate at height Z, or an upright one across the path at x, turned by
// angle degrees in its own plane about the stack's axis.
function flat(cx, cy) {
  const corners = [-1, 1, 1, -1].map((a, i) => [
    cx + a * PLATE_X,
    cy + (i < 2 ? -1 : 1) * PLATE_Y,
    Z,
  ]);
  return { c: [cx, cy, Z], n: UP, u: X, v: Y, hu: PLATE_X, hv: PLATE_Y, hole: null, corners };
}
function upright(x, angle = 0) {
  const [cos, sin] = [Math.cos(HL.rad(angle)), Math.sin(HL.rad(angle))];
  // Unturned, the hole's centre sits on the path at (x, 0, Z).
  const c = [x, -HOLE[0], Z - HOLE[1]];
  const p = { c, n: X, u: [0, cos, sin], v: [0, -sin, cos], hu: GATE, hv: GATE, hole: HOLE };
  p.corners = box(p, GATE, GATE);
  return p;
}
// The corners of a rectangle round a plate's centre, in the plate's plane.
const box = (p, a, b) =>
  [-1, 1, 1, -1].map((sa, i) => {
    const sb = i < 2 ? -1 : 1;
    return p.c.map((value, k) => value + sa * a * p.u[k] + sb * b * p.v[k]);
  });
// A circle in a plate's plane, round the local point (a, b).
function circle(p, a, b, r, from = 0, to = 360, n = 72) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const angle = HL.rad(HL.lerp(from, to, i / n));
    const [la, lb] = [a + r * Math.cos(angle), b + r * Math.sin(angle)];
    return p.c.map((value, k) => value + la * p.u[k] + lb * p.v[k]);
  });
}
// Half the circle as a closed D round (x, y); side -1 is the half towards -y.
function half(x, y, side) {
  const [from, plane] = [side < 0 ? 180 : 0, { c: [x, y, Z], u: X, v: Y }];
  const arc = circle(plane, 0, 0, R, from, from + 180, 36);
  return [...arc, ...edge(arc.at(-1), arc[0]).slice(1)];
}

// A path through world points, measured so part of it can be drawn or walked.
function route(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(...sub(points[i], points[i - 1])));
  return { points, lengths, total: lengths.at(-1) };
}
function walk(path, part) {
  const d = part * path.total;
  let i = 1;
  while (i < path.points.length - 1 && path.lengths[i] < d) i++;
  const f = HL.clamp((d - path.lengths[i - 1]) / (path.lengths[i] - path.lengths[i - 1]), 0, 1);
  const tip = path.points[i - 1].map((value, k) => HL.lerp(value, path.points[i][k], f));
  return { tip, upto: [...path.points.slice(0, i), tip] };
}
// From a source plate's centre out along x, then an S-bend into the merge.
function sharePath(y) {
  const [a, b, c, d] = [
    [44, y],
    [70, y],
    [64, 0],
    [MERGE, 0],
  ];
  const bend = Array.from({ length: 25 }, (_, i) => {
    const [t, s] = [i / 24, 1 - i / 24];
    const k = [s ** 3, 3 * s * s * t, 3 * s * t * t, t ** 3];
    return [0, 1].map((n) => k[0] * a[n] + k[1] * b[n] + k[2] * c[n] + k[3] * d[n]).concat(Z);
  });
  return route([...edge([0, y, Z], [44, y, Z], 8).slice(0, -1), ...bend]);
}
// Hatching inside the landed circle at 45 degrees, as one line turning at the rim.
function hatch() {
  const points = [];
  for (let k = -4; k <= 4; k++) {
    const offset = k * 2.2;
    const reach = Math.sqrt(R * R - offset * offset) * 0.94;
    const ends = [-reach, reach].map((s) => [
      RESULT + (offset - s) * Math.SQRT1_2,
      (offset + s) * Math.SQRT1_2,
      Z,
    ]);
    points.push(...(k % 2 ? ends.reverse() : ends));
  }
  return route(points);
}

function frame(state, t) {
  const screen = (points) => HL.open(points.map((w) => state.P(...w)));
  const late = HL.lerp(GATHER[0], GATHER[1], state.lag);
  const gathered = [EASE(span(t, GATHER)), EASE(span(t, [late, GATHER[1]]))];
  const x =
    t < CHECK[1]
      ? HL.lerp(MERGE, CLEAR, EASE(span(t, CHECK)))
      : HL.lerp(CLEAR, RESULT, EASE(span(t, OUT)));
  const signed = t >= SIGN[0];
  // The policy plates first: every x-ray below looks through them as they turn.
  const gates = GATES.map((gx, i) => {
    const start = TURN_AT + i * TURN_STEP;
    return upright(gx, TURNED[i] * (1 - EASE(span(t, [start, start + TURN_MS]))));
  });
  state.plates = [...state.flats, ...gates];
  gates.forEach((p, i) => {
    const [outline, hole] = state.gates[i];
    draw(outline, xray(state, outlineOf(p.corners)));
    draw(hole, xray(state, circle(p, ...HOLE)));
  });
  state.shares.forEach((share, i) => {
    draw(share.trace, xray(state, walk(share.path, EASE(span(t, TRACE))).upto));
    const at = t < CHECK[0] ? walk(share.path, gathered[i]).tip : [x, 0];
    draw(share.half, xray(state, half(at[0], at[1], i ? 1 : -1)));
    // The user's half holds the highlight until the joined circle is signed.
    share.half[0].setAttribute('class', signed || i === 0 ? 'nf hi' : 'nf sil');
  });
  // The way out traces just ahead of the circle.
  const lead = Math.min(RESULT, x + 16 * span(t, [CHECK[0], CHECK[0] + 160]));
  draw(state.way, t < CHECK[0] ? ['', ''] : xray(state, edge([MERGE, 0, Z], [lead, 0, Z], 40)));
  const sign = span(t, SIGN);
  state.hatch.setAttribute('d', sign > 0 ? screen(walk(state.lines, sign).upto) : '');
  let read = text('rest', 'rest');
  if (state.active) {
    if (t < GATHER[1]) read = text('twoShares', 'two shares');
    else if (t < CHECK[1]) read = text('checkingPolicy', 'policy checks');
    else if (t < OUT[1]) read = text('authorized', 'authorized');
    else if (t < DURATION) read = text('signing', 'signing');
    else read = text('signed', 'signed');
  }
  state.read.textContent = read;
}
function tick(state, dt) {
  const goal = state.active ? DURATION : 0;
  const step = HL.reducedMotion() ? DURATION : Math.min(dt, 0.05) * 1000;
  state.t += HL.clamp(goal - state.t, -step, step);
  frame(state, state.t);
  state.stage.setAttribute('aria-pressed', String(state.active));
  return state.t !== goal;
}
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  state.loop.wake();
}
function keyboard(state, event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select(state, !state.active);
}
function label(svg, [x, y], words) {
  const attrs = { x, y, 'text-anchor': 'middle', 'font-size': 6.8, 'letter-spacing': 0.4 };
  const el = HL.mk('text', { ...attrs, fill: 'var(--muted)', stroke: 'none' }, svg);
  el.textContent = words;
  return el;
}
function resizeFigure(stage, svg, transactionLabel) {
  const compact = stage.clientWidth <= 480;
  // Reserve space for the standalone preview's name and status above the drawing.
  const top = stage.closest('main') ? -40 : 0;
  const height = 270 - top;
  svg.setAttribute('viewBox', compact ? `60 ${top} 420 ${height}` : '0 0 560 280');
  stage.style.aspectRatio = compact ? `420 / ${height}` : '2 / 1';
  svg.style.aspectRatio = compact ? `420 / ${height}` : '2 / 1';
  transactionLabel.textContent = compact
    ? text('signedShort', 'Signed')
    : text('signedTransaction', 'Signed transaction');
  for (const el of svg.querySelectorAll('text')) el.style.fontSize = compact ? '10px' : '';
}

function mount({ stage, svg, read }, lag) {
  svg.setAttribute('viewBox', '0 0 560 280');
  const preview = stage.closest('main');
  if (preview && !preview.style.maxWidth) preview.style.maxWidth = '896px';
  const C = HL.Cam(45, 0.5, 1.45);
  HL.fit(C, [[0, 0, 0]], 185, 88);
  const P = HL.proj(C);
  const [sources, last] = [SHARES.map((y) => flat(0, y)), flat(RESULT, 0)];
  // Every pose of the policy plates on the way, for the label that must clear them.
  const poses = GATES.flatMap((x, i) =>
    Array.from({ length: 9 }, (_, k) => upright(x, (TURNED[i] * k) / 8)),
  );
  const state = { stage, read, P, lag, t: 0, active: false, loop: null };
  state.flats = [...sources, last];
  state.plates = state.flats;
  // Construction first: an axis across each flat plate, and the paths, dashed.
  const guides = HL.mk('path', { class: 'nf lo dash' }, svg);
  const shape = (parent, plate) => draw(pair(parent), xray(state, outlineOf(plate.corners)));
  const slot = (parent, p, part) => {
    const d = HL.poly(circle(p, 0, 0, R).map((w) => P(...w)));
    return HL.mk('path', { class: 'nf lo dash', d, 'data-part': part }, parent);
  };
  for (const source of sources) {
    const g = HL.mk('g', {}, svg);
    shape(g, source);
    // The slot of the whole circle: the half this plate lacks reads as dashes.
    slot(g, source, 'key');
  }
  state.shares = SHARES.map((y) => ({ path: sharePath(y) }));
  const gate = HL.mk('g', {}, svg);
  state.gates = GATES.map(() => [pair(gate), pair(gate)]);
  state.gates[0][0][0].dataset.part = 'check';
  const result = HL.mk('g', {}, svg);
  shape(result, last);
  slot(result, last, 'slot');
  state.lines = hatch();
  state.hatch = HL.mk('path', { class: 'nf sil', 'data-part': 'signature' }, result);
  const axes = (p) =>
    HL.seg(P(...sub(p.c, [PLATE_X + 8, 0, 0])), P(p.c[0] + PLATE_X + 8, p.c[1], Z)) +
    HL.seg(P(...sub(p.c, [0, PLATE_Y + 8, 0])), P(p.c[0], p.c[1] + PLATE_Y + 8, Z));
  let construction = [...sources, last].map(axes).join('');
  for (const share of state.shares) construction += HL.open(share.path.points.map((w) => P(...w)));
  guides.setAttribute('d', construction + HL.seg(P(MERGE, 0, Z), P(RESULT, 0, Z)));
  const movers = HL.mk('g', {}, svg);
  state.way = pair(movers, 'nf lo');
  for (const share of state.shares) {
    share.trace = pair(movers, 'nf lo');
    share.half = pair(movers);
  }
  // The sources' names above their plates, the checks' and the result's below.
  // Placed from the projected corners, so a frame that has not laid out yet
  // still puts each name clear of its shape.
  const labels = [
    [[sources[0]], -1, text('userDevice', 'User’s device')],
    [[sources[1]], -1, text('yourInfrastructure', 'Your infrastructure')],
    [poses, 1, text('policyChecks', 'Policy checks')],
    [[last], 1, text('signedTransaction', 'Signed transaction')],
  ].map(([plates, side, words]) => {
    const ys = plates.flatMap((p) => p.corners.map((w) => P(...w)[1]));
    const x = plates.reduce((sum, p) => sum + P(...p.c)[0], 0) / plates.length;
    return label(svg, [x, side < 0 ? Math.min(...ys) - 8 : Math.max(...ys) + 15], words);
  });
  label(
    svg,
    [280, 260],
    text('thresholdExplanation', '2-of-2 threshold · neither share signs alone'),
  );
  stage.setAttribute('tabindex', '0');
  stage.setAttribute('role', 'button');
  stage.setAttribute(
    'aria-label',
    'Animate two independent key shares authorizing one signed transaction',
  );
  state.loop = HL.register(stage, tick.bind(null, state));
  frame(state, 0);
  const bag = HL.disposer();
  const resize = new ResizeObserver(resizeFigure.bind(null, stage, svg, labels[3]));
  resizeFigure(stage, svg, labels[3]);
  resize.observe(stage);
  bag.add(resize.disconnect.bind(resize));
  bag.add(state.loop.unregister);
  const pointer = { move: select.bind(null, state, true), leave: select.bind(null, state, false) };
  bag.add(HL.pointer(stage, pointer));
  bag.on(stage, 'keydown', keyboard.bind(null, state));
  bag.on(stage, 'blur', select.bind(null, state, false));
  bag.add(svg.replaceChildren.bind(svg));
  const set = (value) => ((state.lag = value), state.loop.wake());
  return { set, destroy: bag.dispose };
}

hairline({
  name: 'threshold-signing',
  means:
    'Two plates each hold half of one circle. Hover: the halves meet, pass three policy plates, and are signed.',
  rules: [1, 3, 4, 7, 8],
  range: [0, 0.15, 0.3],
  mount,
});
