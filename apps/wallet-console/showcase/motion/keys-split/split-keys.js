/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// "Nobody signs alone" in x-ray line: a key in two sharp halves on one dashed
// axis, above and below a thick square frame. Nothing is opaque: visible edges
// are solid, hidden edges dashed. Hover locks the halves into one cube in the
// opening, and a dashed circle on its top marks the one key.
const [OUTER, INNER, RIM] = [32, 16, 13];
// The cube's half width; each half is HALF tall. The halves join level with the
// frame's top; at rest the top half's base and the bottom half's top stand here.
const HALF = 11;
const [TOP_REST, BOTTOM_REST] = [34, -20];
// Phases as fractions of the tween: the top half travels first, the bottom
// half follows. Reversing runs them back in mirror order.
const TOP = [0, 0.65];
const BOTTOM = [0.35, 1];
const GLIDE = HL.bezier(0.65, 0, 0.35, 1);
// Towards the camera (azimuth 45°, sin(elevation) 0.5), for the hidden-line test.
const VIEW = [0.6124, 0.6124, 0.5];
const STEPS = 16;

function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((fraction) => HL.EASE_LIFT(fraction));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

// A square of half width h at height z, corners anticlockwise from (h, h).
const square = (h, z) => [h, -h, -h, h].map((x, k) => [x, k < 2 ? h : -h, z]);
const sub = (a, b) => a.map((v, k) => v - b[k]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) =>
  [0, 1, 2].map((k) => a[(k + 1) % 3] * b[(k + 2) % 3] - a[(k + 2) % 3] * b[(k + 1) % 3]);

// A solid as convex faces and edges. Each ring side gives its top and bottom
// edges, its corner, and the wall between; the frame's top and base are four
// quads each, between the outer and inner squares.
function walls(top, base, faces, edges) {
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push([top[i], top[j], base[j], base[i]]);
    edges.push([top[i], top[j]], [base[i], base[j]], [base[i], top[i]]);
  }
}
function box(z0, z1) {
  const [top, base] = [square(HALF, z1), square(HALF, z0)];
  const solid = { faces: [top, base], edges: [] };
  walls(top, base, solid.faces, solid.edges);
  return solid;
}
function frame() {
  const [ot, ob, it, ib] = [
    square(OUTER, RIM),
    square(OUTER, 0),
    square(INNER, RIM),
    square(INNER, 0),
  ];
  const solid = { faces: [], edges: [] };
  walls(ot, ob, solid.faces, solid.edges);
  walls(it, ib, solid.faces, solid.edges);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    solid.faces.push([ot[i], ot[j], it[j], it[i]], [ob[i], ob[j], ib[j], ib[i]]);
  }
  return solid;
}

// Whether a face lies between a world point and the camera.
function covers(P, face, point) {
  const normal = cross(sub(face[1], face[0]), sub(face[2], face[0]));
  const facing = dot(normal, VIEW);
  if (Math.abs(facing) < 1e-9 || dot(normal, sub(face[0], point)) / facing < 1e-4) return false;
  const [q, corners] = [P(...point), face.map((p) => P(...p))];
  const turns = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length];
    return (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
  });
  // On a shared edge both faces count, so no ray slips between two of them.
  return turns.every((t) => t > -1e-6) || turns.every((t) => t < 1e-6);
}

// Each edge in short steps: the steps no face covers draw solid, the rest dashed.
function trace(P, edges, faces) {
  let [shown, hidden] = ['', ''];
  for (const [a, b] of edges) {
    const at = (s) => a.map((v, k) => HL.lerp(v, b[k], s / STEPS));
    for (let s = 0; s < STEPS; s++) {
      const behind = faces.some((face) => covers(P, face, at(s + 0.5)));
      const d = HL.seg(P(...at(s)), P(...at(s + 1)));
      if (behind) hidden += d;
      else shown += d;
    }
  }
  return [shown, hidden];
}

function draw(state, t) {
  const { P } = state;
  const [up, down] = [GLIDE(phase(t, TOP)), GLIDE(phase(t, BOTTOM))];
  const joined = up === 1 && down === 1;
  const [topBase, bottomTop] = [HL.lerp(TOP_REST, RIM, up), HL.lerp(BOTTOM_REST, RIM, down)];
  const halves = joined
    ? [box(RIM - HALF, RIM + HALF)]
    : [box(topBase, topBase + HALF), box(bottomTop - HALF, bottomTop)];
  const faces = [state.frame, ...halves].flatMap((solid) => solid.faces);
  const parts = [state.frame, ...halves].map((solid) => trace(P, solid.edges, faces));
  state.paths.frame.setAttribute('d', parts[0][0]);
  state.paths.top.setAttribute('d', parts[1][0]);
  state.paths.bottom.setAttribute('d', joined ? '' : parts[2][0]);
  state.paths.hidden.setAttribute('d', parts.map((part) => part[1]).join(''));
  state.paths.sign.setAttribute('d', joined ? state.sign : '');
  state.joined = joined;
}

function tick(state, _dt, now) {
  const t = HL.tval(state.motion, now);
  if (t !== state.drawn) {
    state.drawn = t;
    draw(state, t);
  }
  const moving = state.active ? 'joining' : 'splitting';
  state.read.textContent = state.joined ? 'one key' : t > 0 ? moving : 'rest';
  return !HL.tdone(state.motion, now);
}

// Any point plays the join; leaving plays it back from wherever it is.
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

// The slider sets how long the whole join takes, from where it is now.
function set(state, duration) {
  const now = performance.now();
  state.motion = HL.tween(HL.tval(state.motion, now), duration);
  HL.tset(state.motion, Number(state.active), now, 0);
  state.loop.wake();
}

// A dashed circle of radius r lying flat at height z, round the column.
function circle(P, r, z) {
  const ring = HL.circ(r, 48).map((p) => P(p.u, p.v, z));
  return HL.poly(ring);
}

function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 2.45);
  const bounds = [...square(OUTER, 0), ...square(OUTER, RIM)];
  bounds.push(...square(HALF, TOP_REST + HALF), ...square(HALF, BOTTOM_REST - HALF));
  HL.fit(C, bounds, 200, 160);
  const P = HL.proj(C);
  // Construction (rule 06 gives way to x-ray here): the column's axis and the
  // circle inscribed in the opening, at the frame's top.
  let guides = HL.seg(P(0, 0, BOTTOM_REST - HALF - 3), P(0, 0, TOP_REST + HALF + 3));
  guides += circle(P, INNER, RIM);
  HL.mk('path', { d: guides, class: 'nf lo dash' }, svg);
  const mk = (cls) => HL.mk('path', { class: cls }, svg);
  const paths = { hidden: mk('nf lo dash'), sign: mk('nf lo dash') };
  Object.assign(paths, { frame: mk('nf sil'), bottom: mk('nf sil'), top: mk('nf sil hi') });
  const state = { P, read, paths, frame: frame(), sign: circle(P, HALF, RIM + HALF) };
  Object.assign(state, { motion: HL.tween(0, duration), drawn: NaN, active: false });
  Object.assign(state, { joined: false, loop: null });
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
  name: 'split-keys',
  means: 'A key in two halves, above and below a square frame. Hover to lock them into one cube.',
  rules: [4, 5, 8],
  range: [1500, 1100, 800],
  mount,
});
