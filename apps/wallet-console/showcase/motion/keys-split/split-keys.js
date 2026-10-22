/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// "Nobody signs alone" as flat geometry: a key cut into two halves, one held
// above a square frame and one below it. Hover brings them together in the
// frame's opening, the top half first, where they close into one block.
const [OUTER, INNER, RIM] = [34, 22, 12];
// The block's half width; each half is HALF tall, so the joined block is a cube.
const HALF = 14;
// The halves join level with the frame's top: one half in the hole, one above.
// At rest the top half's base and the bottom half's top stand clear of the frame.
const JOINT = RIM;
const [TOP_REST, BOTTOM_REST] = [36, -16];
// Phases as fractions of the tween: the top half travels first, the bottom
// half follows. Reversing the tween runs them back in mirror order.
const TOP = [0, 0.7];
const BOTTOM = [0.3, 1];
const GLIDE = HL.bezier(0.65, 0, 0.35, 1);

const [OUTER_RING, OUTER_CREASE] = HL.rings(-OUTER, -OUTER, OUTER, OUTER, 3, 1.5);
const HOLE = HL.rrect(-INNER, -INNER, INNER, INNER, 2);
const [BLOCK, BLOCK_CREASE] = HL.rings(-HALF, -HALF, HALF, HALF, 2.5, 1.5);

function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((fraction) => HL.EASE_LIFT(fraction));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

// The frame has a hole, so it is drawn in two pieces: the far piece (the far
// half of the top, and the inner walls seen through the hole) goes under the
// halves; the near piece (the near half of the top, and the outer walls) over them.
function framePieces(svg, P, front) {
  const near = (ring) => HL.run(ring, front);
  const far = (ring) => HL.run(ring, (sample) => !front(sample));
  const at = (run, z) => HL.ringAt(P, run, z);
  const between = (a, za, b, zb) => HL.poly(at(a, za).concat(at(b, zb).reverse()));
  const path = (d, cls) => HL.mk('path', { d, class: cls }, svg);
  const back = [
    path(between(far(OUTER_RING), RIM, far(HOLE), RIM), 'fo'),
    path(between(far(HOLE), RIM, far(HOLE), 0), 'fo'),
    path(HL.open(at(far(OUTER_RING), RIM)), 'nf sil'),
    path(HL.open(at(far(HOLE), RIM)) + HL.open(at(far(HOLE), 0)), 'nf lo'),
  ];
  const nearMarks = () => {
    const [top, base] = [at(near(OUTER_RING), RIM), at(near(OUTER_RING), 0)];
    path(between(near(OUTER_RING), RIM, near(HOLE), RIM), 'fo');
    path(between(near(OUTER_RING), RIM, near(OUTER_RING), 0), 'fo');
    path(HL.open([top[0], ...base, top[top.length - 1]]), 'nf sil');
    path(HL.open(at(near(OUTER_CREASE), RIM)) + HL.open(at(near(HOLE), RIM)), 'nf lo');
  };
  return { back, nearMarks };
}

function draw(state, t) {
  const { P, front, top, bottom } = state;
  const up = 1 - GLIDE(phase(t, TOP));
  const down = 1 - GLIDE(phase(t, BOTTOM));
  const joined = up === 0 && down === 0;
  const topBase = HL.lerp(JOINT, TOP_REST, up);
  const bottomTop = HL.lerp(JOINT, BOTTOM_REST, down);
  if (joined) {
    HL.put(top, HL.prism(P, front, BLOCK, BLOCK_CREASE, JOINT - HALF, JOINT + HALF));
    HL.put(bottom, { sil: '', crease: '' });
    state.seam.setAttribute('d', HL.open(HL.ringAt(P, HL.run(BLOCK_CREASE, front), JOINT)));
  } else {
    HL.put(top, HL.prism(P, front, BLOCK, BLOCK_CREASE, topBase, topBase + HALF));
    HL.put(bottom, HL.prism(P, front, BLOCK, BLOCK_CREASE, bottomTop - HALF, bottomTop));
    state.seam.setAttribute('d', '');
  }
  // Below the frame's base the bottom half is behind the whole frame; once it
  // rises into the hole it is in front of the far piece (rule 06).
  const below = bottomTop <= 0;
  if (below !== state.below) {
    state.below = below;
    if (below) state.back[0].before(bottom.g);
    else state.back[state.back.length - 1].after(bottom.g);
  }
  state.joined = joined;
}

function tick(state, _dt, now) {
  const t = HL.tval(state.motion, now);
  if (t !== state.drawn) {
    state.drawn = t;
    draw(state, t);
  }
  let read = 'rest';
  if (state.joined) read = 'one key';
  else if (t > 0) read = state.active ? 'joining' : 'splitting';
  state.read.textContent = read;
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

function mount({ stage, svg, read }, duration) {
  const C = HL.Cam(45, 0.5, 2.35);
  const bounds = [];
  for (const x of [-OUTER, OUTER])
    for (const y of [-OUTER, OUTER]) bounds.push([x, y, 0], [x, y, RIM]);
  for (const z of [TOP_REST + HALF, BOTTOM_REST - HALF])
    for (const x of [-HALF, HALF]) for (const y of [-HALF, HALF]) bounds.push([x, y, z]);
  HL.fit(C, bounds, 200, 160);
  const P = HL.proj(C);
  const front = HL.facing(C);
  // Construction first (rule 06): the block the halves will make, in dashes.
  const ghost = HL.hull(
    HL.ringAt(P, BLOCK, JOINT - HALF).concat(HL.ringAt(P, BLOCK, JOINT + HALF)),
  );
  const edges = HL.open(HL.ringAt(P, HL.run(BLOCK, front), JOINT + HALF));
  HL.mk('path', { d: HL.poly(ghost) + edges, class: 'nf lo dash' }, svg);
  const bottom = HL.solid(svg);
  const { back, nearMarks } = framePieces(svg, P, front);
  const top = HL.solid(svg);
  top.sil.classList.add('hi');
  const seam = HL.mk('path', { class: 'nf lo' }, top.g);
  nearMarks();
  const state = { P, front, read, top, bottom, seam, back, motion: HL.tween(0, duration) };
  Object.assign(state, { drawn: NaN, active: false, joined: false, below: true, loop: null });
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
  means:
    'A key in two halves, above and below a frame. Hover to bring them together into one block.',
  rules: [4, 5, 6, 8],
  range: [1500, 1100, 800],
  mount,
});
