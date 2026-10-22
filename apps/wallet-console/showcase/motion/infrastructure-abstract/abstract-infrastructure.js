/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// The server racks of infrastructure-array/infrastructure-array.js, reduced
// to one opaque block of unit cells. Any unit slides straight out of the
// block's front face along a dashed rail: nothing is locked in.
const UNIT = 20;
const COLUMNS = 3;
const ROWS = 4;
const DEPTH = 3 * UNIT;
const WIDTH = COLUMNS * UNIT;
const HEIGHT = ROWS * UNIT;
const GAP = 1.4;
const SIZE = UNIT - 2 * GAP;
const REST = { column: 0, row: 2 };
const ROUND = 1.4;

function block(svg, P, front) {
  HL.put(HL.solid(svg), HL.prism(P, front, ...HL.rings(0, 0, WIDTH, DEPTH, ROUND, 0.8), 0, HEIGHT));
  // The front face carries the cell grid; its row lines run on along the
  // side, so each row reads as one shelf through the block's depth.
  let grid = '';
  for (let column = 1; column < COLUMNS; column++) {
    const x = column * UNIT;
    grid += HL.seg(P(x, DEPTH, 0), P(x, DEPTH, HEIGHT));
  }
  for (let row = 1; row < ROWS; row++) {
    const z = row * UNIT;
    grid += HL.seg(P(ROUND, DEPTH, z), P(WIDTH, DEPTH, z));
    grid += HL.seg(P(WIDTH, DEPTH, z), P(WIDTH, ROUND, z));
  }
  HL.mk('path', { d: grid, class: 'nf lo' }, svg);
}

function corners(unit) {
  const x0 = unit.column * UNIT + GAP;
  const z0 = unit.row * UNIT + GAP;
  return { x0, x1: x0 + SIZE, z0, z1: z0 + SIZE };
}

// Painted after the block and before the cubes: rails and holes lie in front
// of the face, behind any cube that leaves it.
function makeUnit(guides, cubes, column, row) {
  return {
    column,
    row,
    hole: HL.mk('path', { class: 'nf lo dash' }, guides),
    solid: HL.solid(HL.mk('g', {}, cubes)),
    slide: HL.tween(0),
    drawn: NaN,
  };
}

function drawUnit(state, unit, slide) {
  if (slide === unit.drawn) return;
  unit.drawn = slide;
  const out = slide > 0.4;
  const { x0, x1, z0, z1 } = corners(unit);
  const P = state.P;
  const face = [P(x0, DEPTH, z0), P(x1, DEPTH, z0), P(x1, DEPTH, z1), P(x0, DEPTH, z1)];
  unit.hole.setAttribute('d', out ? HL.poly(face) : '');
  if (!out) {
    unit.solid.sil.setAttribute('d', '');
    unit.solid.cr.setAttribute('d', '');
    return;
  }
  // Only the part outside the face is drawn; the rest is inside the block.
  const y1 = DEPTH + slide;
  const y0 = Math.max(DEPTH, y1 - SIZE);
  const ring = HL.rings(x0, y0, x1, y1, 1, Math.min(0.6, (y1 - y0) / 4));
  HL.put(unit.solid, HL.prism(P, state.front, ...ring, z0, z1));
}

function tick(state, _dt, now) {
  let moving = false;
  for (const unit of state.units) {
    drawUnit(state, unit, HL.tval(unit.slide, now));
    if (!HL.tdone(unit.slide, now)) moving = true;
  }
  return moving;
}

function retarget(state) {
  const pick = state.over ?? REST;
  const reach = state.over ? state.reach : state.reach / 2;
  const now = performance.now();
  for (const unit of state.units) {
    const chosen = unit.column === pick.column && unit.row === pick.row;
    HL.tset(unit.slide, chosen ? reach : 0, now, 0);
    unit.solid.sil.classList.toggle('hi', chosen);
  }
  const { x0, x1, z0 } = corners(pick);
  const end = DEPTH + state.reach + 12;
  const P = state.P;
  state.rail.setAttribute(
    'd',
    HL.seg(P(x0, DEPTH, z0), P(x0, end, z0)) + HL.seg(P(x1, DEPTH, z0), P(x1, end, z0)),
  );
  state.read.textContent = state.over ? `unit ${pick.column + 1}·${ROWS - pick.row}` : 'rest';
  state.loop.wake();
}

// Pick on the fixed front-face plane, never on a moving cube (rule 01).
function move(state, point) {
  const origin = state.P(0, DEPTH, 0);
  const across = state.P(1, DEPTH, 0);
  const up = state.P(0, DEPTH, 1);
  const x = (point[0] - origin[0]) / (across[0] - origin[0]);
  const z = (point[1] - origin[1] - x * (across[1] - origin[1])) / (up[1] - origin[1]);
  const column = Math.floor(x / UNIT);
  const row = Math.floor(z / UNIT);
  const inside = column >= 0 && column < COLUMNS && row >= 0 && row < ROWS;
  const over = inside ? { column, row } : null;
  if (over?.column === state.over?.column && over?.row === state.over?.row) return;
  state.over = over;
  retarget(state);
}

function leave(state) {
  state.over = null;
  retarget(state);
}

function set(state, reach) {
  state.reach = reach;
  retarget(state);
}

function mount({ stage, svg, read }, reach) {
  const C = HL.Cam(45, 0.5, 2.11);
  HL.fit(
    C,
    [
      [0, 0, HEIGHT],
      [WIDTH, 0, 0],
      [0, DEPTH + 14, 0],
      [WIDTH, DEPTH, 0],
    ],
    199,
    160,
  );
  const P = HL.proj(C);
  const front = HL.facing(C);
  block(svg, P, front);
  const guides = HL.mk('g', {}, svg);
  const rail = HL.mk('path', { class: 'nf lo dash' }, guides);
  const cubes = HL.mk('g', {}, svg);
  // Nearer cells, larger column + row, paint later.
  const cells = [];
  for (let column = 0; column < COLUMNS; column++) {
    for (let row = 0; row < ROWS; row++) cells.push({ column, row });
  }
  cells.sort((a, b) => a.column + a.row - (b.column + b.row));
  const units = cells.map((cell) => makeUnit(guides, cubes, cell.column, cell.row));
  const state = { P, front, units, rail, read, reach, over: null, loop: null };
  state.loop = HL.register(stage, tick.bind(null, state));
  retarget(state);
  const bag = HL.disposer();
  bag.add(state.loop.unregister);
  bag.add(HL.pointer(stage, { move: move.bind(null, state), leave: leave.bind(null, state) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'abstract-infrastructure',
  means:
    'One block of unit cells. Hover a cell to slide its unit straight out of the block: nothing is locked in.',
  rules: [1, 4, 5, 6, 8, 9],
  range: [20, 28, 36],
  mount,
});
