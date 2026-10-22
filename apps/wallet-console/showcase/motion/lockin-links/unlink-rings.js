/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// Two flat rings linked like chain links: one upright with a gap, one lying
// level through it. Hover turns the gap to meet the level ring, then the rings
// slide apart through it along the dashed axis and rest unlinked, side by side.
const R = 40;
const BAND = 7;
const GAP = HL.rad(30);
const DURATION = 1700;
const TURN = [0, 700];
const APART = [800, 1700];
// The camera's depth toward the viewer, for painting segments back to front.
const DEPTH_Y = Math.sqrt(0.75) / Math.SQRT2;
const DEPTH_Z = 0.5;

function phase(progress, [start, end]) {
  const [a, b] = [start, end].map((ms) => HL.EASE_LIFT(ms / DURATION));
  return HL.clamp((progress - a) / (b - a), 0, 1);
}

// The upright ring stands in the x–z plane, the level ring lies in the x–y plane.
function upright(cx, t, r) {
  return [cx + r * Math.cos(t), 0, r * Math.sin(t)];
}
function level(cx, t, r) {
  return [cx + r * Math.cos(t), r * Math.sin(t), 0];
}

function makeRing(svg, count) {
  return Array.from({ length: count }, () => {
    const g = HL.mk('g', {}, svg);
    const fill = HL.mk('path', { class: 'fo' }, g);
    return { g, fill, edge: HL.mk('path', { class: 'nf sil' }, g), depth: 0 };
  });
}

// Each segment of a band fills its own patch and strokes only its arcs, so the
// segments sort by depth with no seams; a gapped band caps its two ends.
function drawRing(P, segments, at, t0, t1, capped) {
  const step = (t1 - t0) / segments.length;
  for (const [i, seg] of segments.entries()) {
    const ts = [0, 0.5, 1].map((f) => t0 + (i + f) * step);
    const outer = ts.map((t) => P(...at(t, R)));
    const inner = ts.map((t) => P(...at(t, R - BAND)));
    seg.fill.setAttribute('d', HL.poly(outer.concat([...inner].reverse())));
    let d = HL.open(outer) + HL.open(inner);
    if (capped && i === 0) d += HL.seg(outer[0], inner[0]);
    if (capped && i === segments.length - 1) d += HL.seg(outer[2], inner[2]);
    seg.edge.setAttribute('d', d);
    const [x, y, z] = at(ts[1], R - BAND / 2);
    seg.depth = (x + y) * DEPTH_Y + z * DEPTH_Z;
  }
}

function tick(state, _dt, now) {
  const progress = HL.tval(state.motion, now);
  if (progress === state.drawn) return !HL.tdone(state.motion, now);
  state.drawn = progress;
  const gap = HL.lerp(Math.PI / 2, 0, phase(progress, TURN));
  const apart = (phase(progress, APART) * state.separation) / 2;
  const from = gap + GAP / 2;
  drawRing(
    state.P,
    state.upright,
    upright.bind(null, -apart),
    from,
    from + Math.PI * 2 - GAP,
    true,
  );
  drawRing(state.P, state.level, level.bind(null, R + apart), 0, Math.PI * 2, false);
  const order = [...state.upright, ...state.level].sort((a, b) => a.depth - b.depth);
  state.svg.append(...order.map((seg) => seg.g));
  const done = HL.tdone(state.motion, now);
  state.read.textContent = !state.active ? 'rest' : done ? 'unlinked' : 'turning';
  return !done;
}

function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}

function set(state, separation) {
  state.separation = separation;
  state.drawn = NaN;
  state.loop.wake();
}

function mount({ stage, svg, read }, separation) {
  const C = HL.Cam(45, 0.5, 2.1);
  // Fit both rest and the widest end pose (rule 03).
  const extremes = [];
  for (const apart of [0, 31]) {
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      extremes.push(upright(-apart, t, R), level(R + apart, t, R));
    }
  }
  HL.fit(C, extremes, 200, 160);
  const P = HL.proj(C);
  const axis = HL.seg(P(-R - 35, 0, 0), P(2 * R + 35, 0, 0));
  HL.mk('path', { d: axis, class: 'nf lo dash' }, svg);
  const state = { svg, P, read, separation, drawn: NaN, active: false, loop: null };
  Object.assign(state, { upright: makeRing(svg, 40), level: makeRing(svg, 48) });
  state.motion = HL.tween(0, DURATION);
  for (const seg of state.upright) seg.edge.classList.add('hi');
  state.loop = HL.register(stage, tick.bind(null, state));
  state.loop.wake();
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
  name: 'unlink-rings',
  means:
    'Two flat rings linked like chain links. Hover to turn the gap to the other ring and slide them apart.',
  rules: [4, 5, 6, 8],
  range: [50, 56, 62],
  mount,
});
