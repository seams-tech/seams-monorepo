/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// No lock-in as an open ring: a flat disc stands inside a flat ring whose gap
// faces the viewer. Hover slides the disc out through the gap; nothing holds it
// in. Both are planes with no depth, so the ring on the ground never hides the
// standing disc, and the disc always paints after it.
const OUTER = 56;
const INNER = 42;
const COIN = 17;
const RIM = 3;
const GAP = Math.PI / 4;
const GAP_HALF = HL.rad(34);
const WIDEN = HL.rad(6);
const DURATION = 1600;
const MID = (OUTER + INNER) / 2;
const CAP = (OUTER - INNER) / 2;

// The ring's footprint: outer arc round the back, a round end at the gap, the
// inner arc back, and the other round end.
function footprint(half) {
  const [from, to] = [GAP + half, GAP + Math.PI * 2 - half];
  const points = [];
  const arc = (radius, a, b) => {
    for (let step = 0; step <= 60; step++) {
      const angle = HL.lerp(a, b, step / 60);
      points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    }
  };
  const end = (angle, turn) => {
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    for (let step = 1; step < 12; step++) {
      const t = (step / 12) * Math.PI;
      const [out, along] = [CAP * Math.cos(t) * turn, CAP * Math.sin(t)];
      points.push([MID * c + out * c - along * s * turn, MID * s + out * s + along * c * turn]);
    }
  };
  arc(OUTER, from, to);
  end(to, 1);
  arc(INNER, to, from);
  end(from, -1);
  return points;
}

function circle(at, cy, cz, radius) {
  const points = [];
  for (let step = 0; step < 48; step++) {
    const a = (step / 48) * Math.PI * 2;
    points.push(at(cy + radius * Math.sin(a), cz + radius * Math.cos(a)));
  }
  return HL.poly(points);
}

// The disc stands face on to the viewer, across the gap's direction, and
// slides along that direction: u runs across its face and z up it. An inset
// rim makes it a coin.
function drawCoin(state, distance) {
  const [c, s] = [Math.cos(GAP), Math.sin(GAP)];
  const at = (u, z) => state.P(distance * c - u * s, distance * s + u * c, z);
  state.coin.setAttribute('d', circle(at, 0, COIN, COIN));
  state.rim.setAttribute('d', circle(at, 0, COIN, COIN - RIM));
}

function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress !== state.drawn) {
    state.drawn = progress;
    const distance = state.reach * progress;
    const crossing = HL.clamp((distance - INNER + 2) / (OUTER - INNER + 4), 0, 1);
    const half = GAP_HALF + WIDEN * Math.sin(Math.PI * crossing);
    if (half !== state.half) {
      state.half = half;
      const ground = footprint(half).map(([x, y]) => state.P(x, y, 0));
      state.ring.setAttribute('d', HL.poly(ground));
    }
    drawCoin(state, distance);
  }
  state.read.textContent = state.active ? (progress >= 1 ? 'free' : 'leaving') : 'rest';
  return !HL.tdone(state.motion, now);
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

function set(state, reach) {
  state.reach = reach;
  state.drawn = NaN;
  state.loop.wake();
}

// The rest pose: the ring and the standing disc.
function restPoints() {
  const points = [];
  for (let step = 0; step < 32; step++) {
    const a = (step / 32) * Math.PI * 2;
    points.push([OUTER * Math.cos(a), OUTER * Math.sin(a), 0]);
    const u = COIN * Math.sin(a);
    points.push([-u * Math.sin(GAP), u * Math.cos(GAP), COIN + COIN * Math.cos(a)]);
  }
  return points;
}

function mount({ stage, svg, read }, reach) {
  const C = HL.Cam(45, 0.5, 2.4);
  // The fit counts the whole circle; the drawn ring is open at the front.
  HL.fit(C, restPoints(), 204, 165);
  const P = HL.proj(C);
  const ground = (x, y) => P(x, y, 0);
  const span = OUTER;
  const [c, s] = [Math.cos(GAP), Math.sin(GAP)];
  let d = HL.seg(ground(-span * c, -span * s), ground((reach + 12) * c, (reach + 12) * s));
  const gap = [];
  for (let step = 0; step <= 12; step++) {
    const a = GAP + HL.lerp(-GAP_HALF, GAP_HALF, step / 12);
    gap.push(ground(OUTER * Math.cos(a), OUTER * Math.sin(a)));
  }
  HL.mk('path', { d: d + HL.open(gap), class: 'nf lo dash' }, svg);
  const state = { P, read, reach, drawn: NaN, half: NaN, active: false };
  state.ring = HL.mk('path', { class: 'sil' }, svg);
  state.coin = HL.mk('path', { class: 'sil hi' }, svg);
  state.rim = HL.mk('path', { class: 'nf lo' }, svg);
  state.motion = HL.tween(0, DURATION);
  state.loop = HL.register(stage, tick.bind(null, state));
  state.loop.wake();
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  const pointer = { move: select.bind(null, state, true), leave: select.bind(null, state, false) };
  bag.add(HL.pointer(stage, pointer));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'open-ring',
  means:
    'A disc inside a ring that is open at the front. Hover to slide the disc out: nothing holds it in.',
  rules: [3, 5, 6, 8],
  range: [60, 66, 72],
  mount,
});
