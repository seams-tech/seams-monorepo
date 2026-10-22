/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// "No lock-in" as flat geometry: two square platforms on the ground whose open
// sides face each other, and a coin standing on the first. Hover rolls the
// coin at once out of one opening and into the other, behind a dashed path
// that traces ahead of it, and the coin settles on the second platform.
const HALF = 30;
const INSET = 5;
const CORNER = 8;
const GAP = 13;
// The platforms' centres sit at x = ∓APART on the coin's line, y = 0.
const APART = 48;
const COIN = 22;
const RINGS = [22, 16.5, 11, 5.5];
// The rings share one rim point, so the coin's roll shows as they turn.
const SHARED = HL.rad(-90);
// Phases as fractions of the tween: the roll starts at once, and the dashed
// path traces ahead of the coin.
const TRACE = [0, 0.12];
const ROLL = [0, 0.95];
const ROLL_EASE = HL.bezier(0.4, 0, 0.35, 1);

function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((fraction) => HL.EASE_LIFT(fraction));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

function quarter(cx, cy, r, from) {
  return Array.from({ length: 9 }, (_, i) => {
    const a = HL.rad(from + (90 * i) / 8);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

// A rounded square outline open at x = half, |y| < GAP, split where it crosses
// y = 0 on the far side: the half in front of the coin's plane, and the half
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

// Platform A opens towards +x and platform B, its mirror, towards -x.
function platforms(P, part) {
  const place = (points, side) => points.map(([x, y]) => P(side * (x - APART), y, 0));
  return [frame(HALF, CORNER), frame(HALF - INSET, CORNER - INSET)]
    .map((outline) => [-1, 1].map((side) => HL.open(place(outline[part], -side))).join(''))
    .map((d, index) => ({ d, class: index === 0 ? 'nf sil' : 'nf lo' }));
}

function draw(state, t) {
  const { P } = state;
  const [from, to] = [-APART, APART];
  const trace = phase(t, TRACE);
  const x = HL.lerp(from, to, ROLL_EASE(phase(t, ROLL)));
  const reach = HL.lerp(from, to, trace);
  state.path.setAttribute('d', trace > 0 ? HL.seg(P(from, 0, 0), P(reach, 0, 0)) : '');
  // Where the coin stood, its outline traces in dashes as it rolls away.
  const left = (x - from) / (to - from);
  const echo = COIN_RINGS[0].slice(0, Math.round(left * COIN_RINGS[0].length));
  const start = coinAt(P, from, 0);
  state.echo.setAttribute('d', echo.length > 1 ? HL.open(echo.map(start)) : '');
  const at = coinAt(P, x, -(x - from) / COIN);
  state.face.setAttribute('d', HL.poly(COIN_RINGS[0].map(at)));
  state.rings.setAttribute(
    'd',
    COIN_RINGS.slice(1)
      .map((r) => HL.poly(r.map(at)))
      .join(''),
  );
  state.moved = x === to;
}

function tick(state, _dt, now) {
  const t = HL.tval(state.motion, now);
  if (t !== state.drawn) {
    state.drawn = t;
    draw(state, t);
  }
  state.read.textContent = state.moved ? 'moved' : state.active && t > 0 ? 'leaving' : 'rest';
  return !HL.tdone(state.motion, now);
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

// The slider sets how long the whole move takes, from where it is now.
function set(state, duration) {
  const now = performance.now();
  state.motion = HL.tween(HL.tval(state.motion, now), duration);
  HL.tset(state.motion, Number(state.active), now, 0);
  state.loop.wake();
}

function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 1.77);
  const bounds = [];
  for (const cx of [-APART, APART]) {
    for (const [dx, dy] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      bounds.push([cx + dx * HALF, dy * HALF, 0]);
    }
    bounds.push([cx, 0, 2 * COIN]);
  }
  HL.fit(C, bounds, 200, 160);
  const P = HL.proj(C);
  // Construction first (rule 06): an axis across each platform, and the gaps.
  let guides = '';
  for (const side of [-1, 1]) {
    const [cx, edge] = [side * APART, side * (APART - HALF)];
    guides += HL.seg(P(cx, -HALF - 10, 0), P(cx, HALF + 10, 0));
    guides += HL.seg(P(edge, -GAP, 0), P(edge, GAP, 0));
  }
  HL.mk('path', { d: guides, class: 'nf lo dash' }, svg);
  const path = HL.mk('path', { class: 'nf lo dash' }, svg);
  const echo = HL.mk('path', { class: 'nf lo dash' }, svg);
  // The far halves sit behind the coin's plane, the near halves in front of it.
  for (const attrs of platforms(P, 'back')) HL.mk('path', attrs, svg);
  const face = HL.mk('path', { class: 'sil hi' }, svg);
  const rings = HL.mk('path', { class: 'nf lo' }, svg);
  for (const attrs of platforms(P, 'front')) HL.mk('path', attrs, svg);
  const state = { P, read, path, echo, face, rings, motion: HL.tween(0, duration) };
  Object.assign(state, { drawn: NaN, active: false, moved: false, loop: null });
  state.loop = HL.register(stage, tick.bind(null, state));
  draw(state, 0);
  state.read.textContent = 'rest';
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const pointer = { move: select.bind(null, state, true), leave: select.bind(null, state, false) };
  bag.add(HL.pointer(stage, pointer));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'open-boundary',
  means: 'Two open platforms and a coin. Hover to roll the coin out of one and into the other.',
  rules: [4, 5, 6, 8],
  range: [2600, 2000, 1500],
  mount,
});
