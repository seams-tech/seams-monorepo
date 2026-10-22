/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// "Permissions" as a maze in line only: three thin rings, each two arcs with two gaps
// out of line, round a target of nested circles. Edges a solid would hide are dashed
// (x-ray), so nothing is opaque. Hover turns the rings, alternating, until the gaps
// line up; the request's path traces in dashes, then solid, and a cube slides in.
const HEIGHT = 6;
const CHANNEL = 11;
// Each ring's radius and rest turn in degrees. At rest no gap ends near a ring's left
// or right edge, where two ends would stack.
const RADII = [11.5, 23.5, 37];
const RESTS = [90, -135, 130];
const TARGET = [6, 4.2, 2.4];
const CUBE = 3; // half the cube's side
const START = RADII[2] + 4 + CUBE * Math.SQRT2;
// The channel runs from the centre straight towards the viewer (+x +y).
const AIM = 45;
// The play as fractions of its length: the rings turn outer first, the path traces,
// then the cube slides.
const turnSlot = (index) => [(2 - index) * 0.12, (2 - index) * 0.12 + 0.4];
const DASHED = [0.25, 0.5];
const SOLID = [0.4, 0.65];
const SLIDE = [0.6, 1];
const EASE = HL.bezier(0.65, 0, 0.35, 1);

const phase = (head, [a, b]) => EASE(HL.clamp((head - a) / (b - a), 0, 1));
const ring = (r, a, z) => [r * Math.cos(HL.rad(a)), r * Math.sin(HL.rad(a)), z];
const arcAt = (P, r, [a0, a1], z) => {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 4));
  return Array.from({ length: n + 1 }, (_, i) => P(...ring(r, HL.lerp(a0, a1, i / n), z)));
};
// Half a gap in degrees: the channel's width at the ring, and a little more.
const gapHalf = (r) => (Math.asin(CHANNEL / 2 / r) * 180) / Math.PI + 6;

// A ring's two walls as arcs in world degrees, for a turn from 0 (rest) to 1.
function walls(index, turn) {
  const [g, shift] = [gapHalf(RADII[index]), AIM + RESTS[index] * (1 - turn)];
  return [g, 180 + g].map((a) => [a + shift, a + shift + 180 - 2 * g]);
}

// Cuts an arc where the ring turns from its near half (-45° to 135°) to its far half.
function halves([a0, a1]) {
  const s = ((((a0 + 45) % 360) + 360) % 360) - 45;
  const e = s + a1 - a0;
  return [-45, 135, 315].flatMap((lo) => {
    const [from, to] = [Math.max(s, lo), Math.min(e, lo + 180)];
    return to > from ? [{ arc: [from, to], near: lo !== 135, fold: s < lo ? from : null }] : [];
  });
}

// One wall as lines: its top, its foot (dashed on the far half, where a closed ring's
// own near side would hide it), a vertical at each end and where the ring turns away.
function wall(P, r, arc) {
  const up = (a) => HL.seg(P(...ring(r, a, 0)), P(...ring(r, a, HEIGHT)));
  let [seen, hidden] = [HL.open(arcAt(P, r, arc, HEIGHT)) + up(arc[0]) + up(arc[1]), ''];
  for (const { arc: part, near, fold } of halves(arc)) {
    const foot = HL.open(arcAt(P, r, part, 0));
    if (near) seen += foot;
    else hidden += foot;
    if (fold !== null) seen += up(fold);
  }
  return [seen, hidden];
}

// The cube, square to the ground's axes: its outline and the three edges at its
// nearest top corner seen, the three at its farthest foot corner dashed.
function cube(P, x, y) {
  const at = (dx, dy, z) => P(x + dx * CUBE, y + dy * CUBE, z * CUBE);
  const hull = HL.hull(
    [...Array(8).keys()].map((i) => at((i & 1) * 2 - 1, (i & 2) - 1, i & 4 ? 2 : 0)),
  );
  const spokes = (o, ends) => ends.map((end) => HL.seg(o, end)).join('');
  const seen = spokes(at(1, 1, 2), [at(1, 1, 0), at(-1, 1, 2), at(1, -1, 2)]);
  const hidden = spokes(at(-1, -1, 0), [at(1, -1, 0), at(-1, 1, 0), at(-1, -1, 2)]);
  return { hull, seen: HL.poly(hull) + seen, hidden };
}

// The open polyline as far as part of its edges.
function partial(points, part) {
  const out = [points[0]];
  for (let i = 1, left = part * (points.length - 1); i < points.length && left > 0; i++, left--)
    out.push(points[i - 1].map((v, k) => HL.lerp(v, points[i][k], Math.min(1, left))));
  return out;
}

function draw(state, head) {
  const { P, el } = state;
  const lines = RADII.flatMap((r, i) =>
    walls(i, phase(head, turnSlot(i))).map((a) => wall(P, r, a)),
  );
  el.rings.setAttribute('d', lines.map((l) => l[0]).join(''));
  el.ringsHidden.setAttribute('d', lines.map((l) => l[1]).join(''));
  const moved = phase(head, SLIDE);
  const shape = cube(P, ...ring(HL.lerp(START, 0, moved), AIM, 0));
  el.cube.setAttribute('d', shape.seen);
  el.cubeHidden.setAttribute('d', shape.hidden);
  const from = P(...ring(START, AIM, 0));
  const reach = (p) => (p > 0 ? HL.seg(from, P(...ring(HL.lerp(START, 0, p), AIM, 0))) : '');
  const solid = phase(head, SOLID);
  el.dashed.setAttribute('d', solid < 1 ? reach(phase(head, DASHED)) : '');
  el.solid.setAttribute('d', reach(solid));
  // Where the cube stood, its outline traces in dashes as it slides away.
  el.echo.setAttribute('d', moved > 0 ? HL.open(partial(state.home, moved)) : '');
  state.docked = head === 1;
  el.cube.classList.toggle('hi', state.docked);
  el.target.classList.toggle('hi', !state.docked);
}

// The play head runs forward while active and back while not, so a leave mid-play
// reverses from where it is; each part eases within its own slot of the play.
function tick(state, dt) {
  const target = state.active ? 1 : 0;
  const step = HL.reducedMotion() ? 1 : (dt * 1000) / state.duration;
  const head = HL.clamp(state.head + (target ? step : -step), 0, 1);
  if (head !== state.head || state.drawn !== head) {
    state.head = state.drawn = head;
    draw(state, head);
  }
  state.read.textContent = state.docked ? 'allowed' : head > 0 ? 'aligning' : 'rest';
  return head !== target;
}

const select = (state, active) => ((state.active = active), state.loop.wake());
const path = (svg, cls, d = '') => HL.mk('path', { d, class: cls }, svg);

function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 3.05);
  const outer = RADII[2];
  const bounds = [];
  for (let a = 0; a < 360; a += 15) bounds.push(ring(outer, a, 0), ring(outer, a, HEIGHT));
  const [sx, sy] = ring(START, AIM, 0);
  for (const d of [-1, 1])
    bounds.push([sx + d * CUBE, sy - d * CUBE, 0], [sx + CUBE, sy + CUBE, 0]);
  // Centred a little low: the cube at rest stands below the rings, docked it does not.
  HL.fit(C, bounds, 200, 164);
  const P = HL.proj(C);
  // Construction, sparse: the ground's two axes, the request's path, and the echo.
  const axis = (a) => HL.seg(P(...ring(outer + 3, a, 0)), P(...ring(outer + 3, a + 180, 0)));
  path(svg, 'nf lo dash', axis(0) + axis(90));
  // The target's circles share their near point, where the cube arrives.
  const circles = TARGET.map((radius) => {
    const [cx, cy] = ring(TARGET[0] - radius, AIM, 0);
    return HL.poly(HL.circ(radius, 48).map((q) => P(cx + q.u, cy + q.v, 0)));
  });
  const el = {
    echo: path(svg, 'nf lo dash'),
    dashed: path(svg, 'nf lo dash'),
    solid: path(svg, 'nf lo'),
    target: path(svg, 'nf sil', circles[0]),
    inner: path(svg, 'nf lo', circles.slice(1).join('')),
    ringsHidden: path(svg, 'nf lo dash'),
    rings: path(svg, 'nf sil'),
    cubeHidden: path(svg, 'nf lo dash'),
    cube: path(svg, 'nf sil'),
  };
  const home = cube(P, sx, sy).hull;
  const state = { P, read, el, duration, home: home.concat([home[0]]) };
  Object.assign(state, { head: 0, drawn: NaN, active: false, loop: null });
  state.loop = HL.register(stage, tick.bind(null, state));
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  // Where the pointer is does not matter: any point plays, leaving plays back.
  const pointer = { move: select.bind(null, state, true), leave: select.bind(null, state, false) };
  bag.add(HL.pointer(stage, pointer));
  bag.add(svg.replaceChildren.bind(svg));
  const set = (value) => ((state.duration = value), state.loop.wake());
  return { set, destroy: bag.dispose };
}

hairline({
  name: 'maze-interlock',
  means: 'Line rings round a target. Hover: they turn into line and a cube slides in.',
  rules: [2, 4, 5],
  range: [1900, 1500, 1200],
  mount,
});
