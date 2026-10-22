/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// "No lock-in" as flat geometry: a square boundary on the ground with one side
// open, and a coin standing inside it. Hover traces a dashed path out through
// the gap; the coin rolls along it and comes to rest outside.
const HALF = 46;
const INSET = 6;
const CORNER = 10;
const GAP = 14;
const COIN = 26;
const RINGS = [26, 19.5, 13, 6.5];
// The rings share one rim point, so the coin's roll shows as they turn.
const SHARED = HL.rad(-90);
const REST_X = -10;
const OUT_X = HALF + COIN + 4;
const DURATION = 2000;
const TRACE = [0, 500];
const ROLL = [550, 1900];
const ROLL_EASE = HL.bezier(0.65, 0, 0.35, 1);

function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / DURATION));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

function quarter(cx, cy, r, from) {
  return Array.from({ length: 9 }, (_, i) => {
    const a = HL.rad(from + (90 * i) / 8);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

// A rounded square outline open at x = half, |y| < GAP, split where it crosses
// y = 0 at the far side: the half in front of the coin's plane and the half
// behind it.
function frame(half, r) {
  const c = half - r;
  return {
    front: [[half, GAP], ...quarter(c, c, r, 0), ...quarter(-c, c, r, 90), [-half, 0]],
    back: [[-half, 0], ...quarter(-c, -c, r, 180), ...quarter(c, -c, r, 270), [half, -GAP]],
  };
}

// One ring of the coin in its own plane: u along x, v up, about its centre.
function ring(radius, steps = 64) {
  const [ou, ov] = [(COIN - radius) * Math.cos(SHARED), (COIN - radius) * Math.sin(SHARED)];
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [ou + radius * Math.cos(a), ov + radius * Math.sin(a)];
  });
}
const COIN_RINGS = RINGS.map((radius) => ring(radius));

// The coin plane is x-z at y = 0, centred at x, turned by angle about its centre.
function coinAt(P, x, angle) {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return ([u, v]) => P(x + u * c - v * s, 0, COIN + u * s + v * c);
}

function ground(P, points) {
  return HL.open(points.map(([x, y]) => P(x, y, 0)));
}

function draw(state, t) {
  const { P } = state;
  const trace = phase(t, TRACE);
  const roll = ROLL_EASE(phase(t, ROLL));
  const x = HL.lerp(REST_X, OUT_X, roll);
  const end = HL.lerp(REST_X, OUT_X, trace);
  state.path.setAttribute('d', trace > 0 ? HL.seg(P(REST_X, 0, 0), P(end, 0, 0)) : '');
  // Where the coin stood, its outline traces in dashes as it rolls away.
  const echo = COIN_RINGS[0].slice(0, Math.round(roll * COIN_RINGS[0].length));
  const rest = coinAt(P, REST_X, 0);
  state.echo.setAttribute('d', echo.length > 1 ? HL.open(echo.map(rest)) : '');
  const at = coinAt(P, x, -(x - REST_X) / COIN);
  state.face.setAttribute('d', HL.poly(COIN_RINGS[0].map(at)));
  state.rings.setAttribute(
    'd',
    COIN_RINGS.slice(1)
      .map((r) => HL.poly(r.map(at)))
      .join(''),
  );
}

function tick(state, _dt, now) {
  const t = HL.tval(state.motion, now);
  if (t !== state.drawn) {
    state.drawn = t;
    draw(state, t);
  }
  state.read.textContent = t === 1 ? 'outside' : state.active && t > 0 ? 'leaving' : 'rest';
  return !HL.tdone(state.motion, now);
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

function mount({ stage, svg, read }) {
  const C = HL.Cam(45, 0.5, 2.07);
  const bounds = [
    [-HALF, -HALF, 0],
    [HALF, HALF, 0],
    [-HALF, HALF, 0],
    [HALF, -HALF, 0],
    [REST_X, 0, 2 * COIN],
    [OUT_X + COIN, 0, 0],
    [OUT_X, 0, 2 * COIN],
  ];
  HL.fit(C, bounds, 207, 166);
  const P = HL.proj(C);
  // Construction first (rule 06): the axis across the gap's side and the gap.
  let guides = HL.seg(P(0, -HALF - 18, 0), P(0, HALF + 18, 0));
  guides += HL.seg(P(HALF, -GAP, 0), P(HALF, GAP, 0));
  HL.mk('path', { d: guides, class: 'nf lo dash' }, svg);
  const path = HL.mk('path', { class: 'nf lo dash' }, svg);
  const echo = HL.mk('path', { class: 'nf lo dash' }, svg);
  const [outer, inner] = [frame(HALF, CORNER), frame(HALF - INSET, CORNER - INSET)];
  // The far halves sit behind the coin's plane, the near halves in front of it.
  HL.mk('path', { d: ground(P, outer.back), class: 'nf sil' }, svg);
  HL.mk('path', { d: ground(P, inner.back), class: 'nf lo' }, svg);
  const face = HL.mk('path', { class: 'sil hi' }, svg);
  const rings = HL.mk('path', { class: 'nf lo' }, svg);
  HL.mk('path', { d: ground(P, outer.front), class: 'nf sil' }, svg);
  HL.mk('path', { d: ground(P, inner.front), class: 'nf lo' }, svg);
  const state = { P, read, path, echo, face, rings, motion: HL.tween(0, DURATION) };
  Object.assign(state, { drawn: NaN, active: false, loop: null });
  state.loop = HL.register(stage, tick.bind(null, state));
  draw(state, 0);
  state.read.textContent = 'rest';
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const pointer = { move: select.bind(null, state, true), leave: select.bind(null, state, false) };
  bag.add(HL.pointer(stage, pointer));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: () => {}, destroy: bag.dispose };
}

hairline({
  name: 'open-boundary',
  means:
    'A coin inside a square boundary with one open side. Hover to roll it out through the gap.',
  rules: [4, 5, 6, 8],
  range: [0, 0.5, 1],
  mount,
});
