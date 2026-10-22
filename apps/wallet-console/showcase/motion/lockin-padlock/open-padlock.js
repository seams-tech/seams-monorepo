/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// A padlock as two flat planes: a body with a keyhole and a flat U shackle.
// Hover turns the key, lifts the shackle out of the body and swings it open
// about one leg along a dashed guide; leaving locks it again.
const DURATION = 2000;
const BODY = HL.rrect(-36, 0, 36, 46, 4, 6);
const RIM = HL.rrect(-33, 3, 33, 43, 2.5, 6);
const OUTER = 22;
const INNER = 15;
const LEG = 24;
const MID = (OUTER + INNER) / 2;
// The shackle's arc centre when locked, with its legs 8 units into the body.
const SEAT = 46 - 8 + LEG;
const LIFT = 9;
const KEY = [0, 19];
// The lock faces the viewer, turned 30 degrees from the camera's front.
const [UX, UY] = [Math.sin(HL.rad(30)), -Math.cos(HL.rad(30))];
const PHASES = { key: [0, 450], trace: [350, 900], lift: [700, 1150], swing: [1150, 2000] };
const EASE = HL.bezier(0.77, 0, 0.175, 1);

function arc(radius, from, to, steps) {
  const points = [];
  for (let step = 0; step <= steps; step++) {
    const t = HL.lerp(from, to, step / steps);
    points.push([radius * Math.cos(t), radius * Math.sin(t)]);
  }
  return points;
}
// The flat shackle in its own plane: a across it, b up from the arc centre.
const SHACKLE = [[-OUTER, -LEG], ...arc(OUTER, Math.PI, 0, 32), [OUTER, -LEG]].concat([
  [INNER, -LEG],
  ...arc(INNER, 0, Math.PI, 24),
  [-INNER, -LEG],
]);
const KEYHOLE = arc(6, 0, Math.PI * 2, 32).map(([u, v]) => [u + KEY[0], v + KEY[1]]);

// The lock's own plane: u across the body, v up.
function lockAt(P, u, v) {
  return P(u * UX, u * UY, v);
}

// The shackle raised by lift and swung open by angle degrees, in the body's
// plane, about the foot of its hinge leg.
function shackleAt(P, lift, angle) {
  const [c, s] = [Math.cos(HL.rad(angle)), Math.sin(HL.rad(angle))];
  return SHACKLE.map(([a, b]) => {
    const [du, dv] = [a + MID, b + LEG];
    return lockAt(P, -MID + du * c - dv * s, SEAT + lift - LEG + du * s + dv * c);
  });
}

// Phase bounds in ms, mapped through the tween's ease (rule 08).
function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / DURATION));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

// The path of the free leg's foot, as far as part of the swing.
function swingPath(P, swing, part) {
  if (part <= 0) return '';
  const points = [];
  for (let step = 0; step <= 32; step++) {
    const t = HL.rad((swing * part * step) / 32);
    points.push(lockAt(P, -MID + 2 * MID * Math.cos(t), SEAT + LIFT - LEG + 2 * MID * Math.sin(t)));
  }
  return HL.open(points);
}

function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const [key, trace, lift, swing] = ['key', 'trace', 'lift', 'swing'].map((name) =>
    phase(progress, PHASES[name]),
  );
  const { P } = state;
  state.path.setAttribute('d', swingPath(P, state.swing, trace));
  const turn = HL.rad(90 * EASE(key));
  const slot = [KEY[0] + 9 * Math.sin(turn), KEY[1] - 9 * Math.cos(turn)];
  state.slot.setAttribute('d', HL.seg(lockAt(P, ...KEY), lockAt(P, ...slot)));
  const pose = shackleAt(P, LIFT * EASE(lift), state.swing * EASE(swing));
  state.shackle.setAttribute('d', HL.poly(pose));
  const text = progress === 1 ? 'open' : 'unlocking';
  state.read.textContent = state.active ? text : 'rest';
  return !HL.tdone(state.motion, now);
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

function set(state, swing) {
  state.swing = swing;
  state.drawn = NaN;
  state.loop.wake();
}

function mount({ stage, svg, read }, swing) {
  const C = HL.Cam(45, 0.5, 2.82);
  const world = (x, y, z) => [x, y, z];
  const rest = BODY.map((p) => lockAt(world, p.u, p.v)).concat(shackleAt(world, 0, 0));
  HL.fit(C, rest, 200, 163);
  const P = HL.proj(C);
  let axes = HL.seg(lockAt(P, -MID, 40), lockAt(P, -MID, SEAT + LIFT + 6));
  axes +=
    HL.seg(lockAt(P, -46, 0), lockAt(P, 46, 0)) +
    HL.seg(P(-16 * UY, 16 * UX, 0), P(16 * UY, -16 * UX, 0));
  HL.mk('path', { d: axes, class: 'nf lo dash' }, svg);
  const path = HL.mk('path', { class: 'nf lo dash' }, svg);
  // The shackle never leaves the body's plane, so it always paints behind the body.
  const shackle = HL.mk('path', { class: 'sil hi' }, svg);
  const body = HL.mk('g', {}, svg);
  HL.mk('path', { d: HL.poly(BODY.map((p) => lockAt(P, p.u, p.v))), class: 'sil' }, body);
  HL.mk('path', { d: HL.poly(RIM.map((p) => lockAt(P, p.u, p.v))), class: 'nf lo' }, body);
  HL.mk('path', { d: HL.poly(KEYHOLE.map(([u, v]) => lockAt(P, u, v))), class: 'nf sil' }, body);
  const slot = HL.mk('path', { class: 'nf sil' }, body);
  const state = { P, path, shackle, slot, read, swing, drawn: NaN };
  Object.assign(state, { motion: HL.tween(0, DURATION), active: false, loop: null });
  state.loop = HL.register(stage, tick.bind(null, state));
  state.loop.wake();
  read.textContent = 'rest';
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
  name: 'open-padlock',
  means: 'A flat padlock. Hover to turn the key, lift the shackle and swing it open about one leg.',
  rules: [4, 5, 6, 8],
  range: [55, 70, 85],
  mount,
});
