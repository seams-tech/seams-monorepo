/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// No lock-in as one move: two identical platforms, each with a socket, and one
// cube on the first. Hover lifts the cube along a dashed arc into the second
// socket; it leaves whole, and leaving brings it back.
const PLATE = 24;
const PLATE_DEPTH = 4;
const CUBE = 36;
const SOCKET = CUBE / 2 + 2;
const APART = 48;
const ARC = 20;
const FROM = [-APART, 0];
const TO = [APART, 0];

function plate(svg, P, front, [x, y]) {
  const [ring, inner] = HL.rings(x - PLATE, y - PLATE, x + PLATE, y + PLATE, 5, 1.6);
  HL.put(HL.solid(svg), HL.prism(P, front, ring, inner, -PLATE_DEPTH, 0));
  const socket = HL.rrect(x - SOCKET, y - SOCKET, x + SOCKET, y + SOCKET, 2.5, 4);
  HL.mk('path', { d: HL.poly(HL.ringAt(P, socket, 0)), class: 'nf lo' }, svg);
}

// Where the cube's base centre is at progress s: on a low arc from socket to socket.
function along(s) {
  return [HL.lerp(FROM[0], TO[0], s), HL.lerp(FROM[1], TO[1], s), ARC * Math.sin(Math.PI * s)];
}

function drawCube(state, s) {
  if (s === state.drawn) return;
  state.drawn = s;
  const [x, y, z] = along(s);
  const half = CUBE / 2;
  const [ring, inner] = HL.rings(x - half, y - half, x + half, y + half, 2.5, 1.2);
  HL.put(state.cube, HL.prism(state.P, state.front, ring, inner, z, z + CUBE));
}

function tick(state, _dt, now) {
  const s = HL.tval(state.motion, now);
  drawCube(state, s);
  let text = 'moving';
  if (s === 0 && !state.active) text = 'rest';
  else if (s === 1) text = 'moved';
  else if (state.active && s < 0.2) text = 'lifting';
  state.read.textContent = text;
  return !HL.tdone(state.motion, now);
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 1.85);
  const extremes = [];
  for (const [x, y] of [FROM, TO]) {
    for (const [dx, dy] of [
      [-1, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
    ]) {
      extremes.push([x + dx * PLATE, y + dy * PLATE, -PLATE_DEPTH]);
      extremes.push([x + (dx * CUBE) / 2, y + (dy * CUBE) / 2, CUBE]);
    }
  }
  HL.fit(C, extremes, 200, 160);
  const P = HL.proj(C);
  const front = HL.facing(C);
  // The platforms' shared axis lies behind them; the travel arc lies above them.
  const axis = HL.seg(P(FROM[0] - PLATE - 14, 0, 0), P(TO[0] + PLATE + 14, 0, 0));
  HL.mk('path', { d: axis, class: 'nf lo dash' }, svg);
  plate(svg, P, front, FROM);
  plate(svg, P, front, TO);
  const arc = [];
  for (let step = 0; step <= 32; step++) arc.push(P(...along(step / 32)));
  HL.mk('path', { d: HL.open(arc), class: 'nf lo dash' }, svg);
  const cube = HL.solid(svg);
  cube.sil.classList.add('hi');
  const state = { P, front, cube, read, motion: HL.tween(0, duration), drawn: NaN };
  Object.assign(state, { active: null, loop: null });
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
  return { set: (value) => (state.motion.dur = value), destroy: bag.dispose };
}

hairline({
  name: 'move-unit',
  means:
    'One cube on the first of two platforms. Hover to lift it along the arc into the second socket.',
  rules: [3, 4, 6, 8],
  range: [1800, 1400, 1000],
  mount,
});
