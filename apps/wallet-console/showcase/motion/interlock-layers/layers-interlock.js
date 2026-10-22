/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// "Permissions" as policy layers: thin square plates, each with an off-centre
// hole, twisted out of line at rest. Hover turns them into line from the top
// down, traces the path through the holes, dashed and then solid, and drops a
// ball through the stack to rest on the ground below it. Drawn in x-ray, in
// place of rule 06: nothing is opaque; a visible line is solid, a hidden one dashed.
// N plates, HALF their half side, GAP between them; the lowest stands BASE
// above the ground.
const [N, HALF, GAP, BASE] = [4, 31, 18, 22];
const [HOLE_X, HOLE_Y, HOLE_R] = [11, 11, 7.5];
const BALL = 5;
// At rest each plate above the bottom one is turned TWIST degrees further.
const TWIST = 9;
const [START_Z, LAND_Z] = [BASE + (N - 1) * GAP + 2, BALL];
// One timeline in ms. A play head runs it forward on hover and backward on
// leave, so a reverse mirrors the play from wherever it is.
const [STEP, TURN] = [70, 520];
const DASHED = [300, 650];
const SOLID = [480, 830];
const DROP = [860, 1420];
const TOTAL = DROP[1];
const DROP_EASE = HL.bezier(0.5, 0, 0.25, 1);

const span = (t, [a, b]) => HL.clamp((t - a) / (b - a), 0, 1);
const height = (k) => BASE + k * GAP;
const restAngle = (k) => k * TWIST;
function turn([u, v], deg) {
  const [c, s] = [Math.cos(HL.rad(deg)), Math.sin(HL.rad(deg))];
  return [u * c - v * s, u * s + v * c];
}
// A plate's outline in its own frame: sharp corners, sampled along each edge.
const CORNERS = [0, 1, 2, 3].map((i) => [i % 3 ? HALF : -HALF, i < 2 ? -HALF : HALF]);
const EDGES = CORNERS.flatMap((a, i) => {
  const b = CORNERS[(i + 1) % 4];
  return Array.from({ length: 24 }, (_, s) =>
    a.map((value, axis) => HL.lerp(value, b[axis], s / 24)),
  );
});
const HOLE = HL.circ(HOLE_R, 40).map((p) => [HOLE_X + p.u, HOLE_Y + p.v]);

// Whether a screen point lies under a solid part of plate `from` or one above it.
function covered(state, from, [sx, sy]) {
  for (let j = from; j < N; j++) {
    const [u, v] = turn(HL.unproj(state.C, sx, sy, height(j)), -state.angles[j]);
    const inHole = Math.hypot(u - HOLE_X, v - HOLE_Y) < HOLE_R;
    if (Math.abs(u) < HALF && Math.abs(v) < HALF && !inHole) return true;
  }
  return false;
}
// The runs of a closed ring of screen points where keep holds, as open lines.
// Each run takes in the sample past either end, so solid and dashed runs meet.
function runs(points, keep) {
  if (keep.every(Boolean)) return HL.poly(points);
  const [n, start] = [points.length, keep.indexOf(false)];
  let [d, run] = ['', []];
  for (let s = 1; s <= n; s++) {
    const i = (start + s) % n;
    if (keep[i]) run.push(...(run.length ? [] : [points[(i + n - 1) % n]]), points[i]);
    else if (run.length) [d, run] = [d + HL.open([...run, points[i]]), []];
  }
  return d;
}
// Rings drawn in x-ray against plate `from` and those above: [solid, dashed].
function xray(state, from, rings) {
  let [solid, dashed] = ['', ''];
  for (const ring of rings) {
    const hidden = ring.map((p) => covered(state, from, p));
    solid += runs(
      ring,
      hidden.map((h) => !h),
    );
    dashed += runs(ring, hidden);
  }
  return [solid, dashed];
}

function drawPlate(state, k) {
  const at = (p) => state.P(...turn(p, state.angles[k]), height(k));
  const [solid, dashed] = xray(state, k + 1, [EDGES.map(at), HOLE.map(at)]);
  state.plates[k].edge.setAttribute('d', solid);
  state.plates[k].hidden.setAttribute('d', dashed);
}

// The traced path through the holes, from high down.
function drawPath(state, el, part, high = START_Z) {
  const low = START_Z - part * (START_Z - LAND_Z);
  const at = (z) => state.P(HOLE_X, HOLE_Y, z);
  state[el].setAttribute('d', part > 0 && low < high ? HL.seg(at(low), at(high)) : '');
}

// The ball's outline: a circle about its centre, from the top, as far as part.
function circle(state, [x, y], z, part = 1) {
  const [cx, cy] = state.P(x, y, z);
  const r = BALL * state.C.S;
  const steps = Math.round(48 * part);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = HL.rad(-90 + (360 * i) / 48);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

function draw(state, t) {
  state.angles = state.plates.map((_, k) => {
    const start = (N - 1 - k) * STEP;
    return restAngle(k) * (1 - HL.EASE_LIFT(span(t, [start, start + TURN])));
  });
  state.plates.forEach((_, k) => drawPlate(state, k));
  const [dashed, solid] = [span(t, DASHED), span(t, SOLID)];
  const drop = DROP_EASE(span(t, DROP));
  const z = HL.lerp(START_Z, LAND_Z, drop);
  // The ball follows the solid path down, and the path ends at the ball.
  drawPath(state, 'dashed', solid < 1 ? dashed : 0);
  drawPath(state, 'solid', solid, z);
  // Until it drops, the ball rides the top plate's hole as that plate turns.
  const ballAt = turn([HOLE_X, HOLE_Y], state.angles[N - 1]);
  const below = state.plates.filter((_, k) => height(k) < z).length;
  const [solidBall, dashedBall] = xray(state, below, [circle(state, ballAt, z).slice(0, -1)]);
  state.ball.setAttribute('d', solidBall);
  const equator = HL.circ(BALL, 40).map((p) => state.P(ballAt[0] + p.u, ballAt[1] + p.v, z));
  state.ballHidden.setAttribute('d', dashedBall + HL.poly(equator));
  const echo = circle(state, [HOLE_X, HOLE_Y], START_Z, HL.clamp(drop * 1.6, 0, 1));
  state.echo.setAttribute('d', echo.length > 1 ? HL.open(echo) : '');
  const landed = drop === 1;
  state.ball.classList.toggle('hi', landed);
  state.plates[N - 1].edge.classList.toggle('hi', !landed);
  state.read.textContent = ['rest', 'aligning', 'passing', 'allowed'][
    t === 0 ? 0 : landed ? 3 : drop > 0 ? 2 : 1
  ];
}

function tick(state, dt) {
  const goal = state.active ? TOTAL : 0;
  const step = HL.reducedMotion() ? TOTAL : Math.min(dt, 0.05) * 1000 * (TOTAL / state.duration);
  state.t += HL.clamp(goal - state.t, -step, step);
  if (state.t !== state.drawn) draw(state, (state.drawn = state.t));
  return state.t !== goal;
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  state.loop.wake();
}

function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 2.35);
  const bounds = [
    [HOLE_X, HOLE_Y, START_Z + BALL / 0.866],
    [HOLE_X, HOLE_Y, LAND_Z - BALL / 0.866],
  ];
  for (let k = 0; k < N; k++)
    for (const deg of [0, restAngle(k)])
      for (const corner of CORNERS) bounds.push([...turn(corner, deg), height(k)]);
  HL.fit(C, bounds, 200, 160);
  const P = HL.proj(C);
  // Construction, kept sparse: ground axes and a ring where the ball lands.
  const reach = 15;
  let axes = HL.seg(P(HOLE_X - reach, HOLE_Y, 0), P(HOLE_X + reach, HOLE_Y, 0));
  axes += HL.seg(P(HOLE_X, HOLE_Y - reach, 0), P(HOLE_X, HOLE_Y + reach, 0));
  axes += HL.poly(HL.circ(BALL + 2, 40).map((p) => P(HOLE_X + p.u, HOLE_Y + p.v, 0)));
  HL.mk('path', { d: axes, class: 'nf lo dash' }, svg);
  const plates = Array.from({ length: N }, () => ({
    hidden: HL.mk('path', { class: 'nf lo dash' }, svg),
    edge: HL.mk('path', { class: 'nf sil' }, svg),
  }));
  const [dashedPath, solidPath] = ['nf lo dash', 'nf lo'].map((c) =>
    HL.mk('path', { class: c }, svg),
  );
  const echo = HL.mk('path', { class: 'nf lo dash' }, svg);
  const ballHidden = HL.mk('path', { class: 'nf lo dash' }, svg);
  const ball = HL.mk('path', { class: 'nf sil' }, svg);
  const state = { C, P, read, plates, echo, ball, ballHidden, duration, t: 0, drawn: NaN };
  Object.assign(state, { dashed: dashedPath, solid: solidPath, active: false, angles: [] });
  state.loop = HL.register(stage, tick.bind(null, state));
  draw(state, 0);
  state.drawn = 0;
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const pointer = { move: select.bind(null, state, true), leave: select.bind(null, state, false) };
  bag.add(HL.pointer(stage, pointer));
  bag.add(svg.replaceChildren.bind(svg));
  const set = (value) => ((state.duration = value), state.loop.wake());
  return { set, destroy: bag.dispose };
}

hairline({
  name: 'layers-interlock',
  means:
    'Stacked plates with off-centre holes. Hover: they turn into line and a ball drops through.',
  rules: [2, 4, 5, 7],
  range: [1800, 1420, 1100],
  mount,
});
