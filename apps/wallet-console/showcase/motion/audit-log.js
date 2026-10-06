/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// The wallet's stacked Audit log sheets, built on the unchanged Hairline kernel.
const {
  Cam,
  clamp,
  fillet,
  fit,
  poly,
  proj,
  unproj,
  seg,
  spring,
  stepS,
  mk,
  flatDot,
  place,
  pointer,
  register,
  disposer,
} = HL;
const WIDTH = 100;
const DEPTH = 124;
const COUNT = 4;
const REST = 0.28;
const OUTLINE = fillet(
  [
    [0, 0],
    [80, 0],
    [100, 20],
    [100, 124],
    [0, 124],
  ],
  [3, 1, 1, 3, 3],
);
const FOLD = fillet(
  [
    [80, 0],
    [80, 20],
    [100, 20],
  ],
  [0.6, 1.8, 0.6],
);

function sheetPoint(P, index, z, point) {
  return P(point[0] + index * 2, point[1] - index * 2, z);
}

function height(index, gap) {
  return 52 + (index - (COUNT - 1) / 2) * gap;
}

function line(P, index, z, x0, y0, x1, y1) {
  return seg(sheetPoint(P, index, z, [x0, y0]), sheetPoint(P, index, z, [x1, y1]));
}

function createSheet(parent, C, index) {
  const group = mk('g', {}, parent);
  const back = mk('path', { class: 'lo' }, group);
  const face = mk('path', { class: 'sil' }, group);
  const rules = mk('path', { class: 'nf lo' }, group);
  const entries = mk('path', { class: 'nf' }, group);
  const fold = mk('path', { class: 'sil' }, group);
  const holes = [];
  const dots = [];
  for (let row = 0; row < 3; row++) holes.push(flatDot(group, C, 1.4, 'nf'));
  for (let row = 0; row < 7; row++) dots.push(flatDot(group, C, 0.8, 'dot off'));
  return { index, back, face, rules, entries, fold, holes, dots };
}

function drawSheet(state, sheet) {
  const { P } = state;
  const index = sheet.index;
  const z = height(index, state.gap.x);
  sheet.back.setAttribute('d', poly(OUTLINE.map(sheetPoint.bind(null, P, index, z - 1.2))));
  sheet.face.setAttribute('d', poly(OUTLINE.map(sheetPoint.bind(null, P, index, z))));
  sheet.fold.setAttribute('d', poly(FOLD.map(sheetPoint.bind(null, P, index, z))));
  let rules = line(P, index, z, 13, 10, 13, 113);
  rules += line(P, index, z, 18, 29, 88, 29);
  rules += line(P, index, z, 18, 105, 88, 105);
  let entries = line(P, index, z, 19, 13, 46, 13);
  entries += line(P, index, z, 19, 18, 61, 18);
  entries += line(P, index, z, 19, 23, 39, 23);
  for (let row = 0; row < 7; row++) {
    const y = 37 + row * 9;
    const length = 22 + ((row * 11 + index * 7) % 18);
    entries += line(P, index, z, 26, y, 26 + length, y);
    entries += line(P, index, z, 78, y, 88, y);
    rules += line(P, index, z, 26, y + 3, 42 + (row % 3) * 7, y + 3);
    place(sheet.dots[row], sheetPoint(P, index, z, [20, y]));
  }
  // Punched binding holes, ruled entries, and a folded corner identify paper.
  for (let row = 0; row < 3; row++) {
    place(sheet.holes[row], sheetPoint(P, index, z, [7, 25 + row * 39]));
  }
  for (let dot = 0; dot <= index; dot++) {
    entries += line(P, index, z, 76 + dot * 4, 112, 76 + dot * 4, 115);
  }
  sheet.rules.setAttribute('d', rules);
  sheet.entries.setAttribute('d', entries);
}

function tick(state, dt) {
  const moving = stepS(state.gap, dt);
  if (state.drawn !== state.gap.x) {
    for (const sheet of state.sheets) drawSheet(state, sheet);
    state.drawn = state.gap.x;
  }
  return moving;
}

function select(state, index) {
  for (const sheet of state.sheets) {
    const highlighted = index < 0 ? sheet.index === COUNT - 1 : sheet.index === index;
    sheet.face.classList.toggle('hi', highlighted);
    sheet.fold.classList.toggle('hi', highlighted);
  }
  state.read.textContent = index < 0 ? 'rest' : `record 0${index + 1}`;
}

function move(state, point) {
  const strength = clamp((point[0] - 65) / 270, 0, 1);
  state.gap.t = state.maximum * (REST + (1 - REST) * strength);
  let closest = -1;
  // Test front to back against the target pose, so covered records cannot win.
  for (let index = COUNT - 1; index >= 0; index--) {
    const ground = unproj(state.C, point[0], point[1], height(index, state.gap.t));
    const x = ground[0] - index * 2;
    const y = ground[1] + index * 2;
    if (x < 0 || x > WIDTH || y < 0 || y > DEPTH || x - y > 80) continue;
    closest = index;
    break;
  }
  select(state, closest);
  state.loop.wake();
}

function leave(state) {
  state.gap.t = state.maximum * REST;
  select(state, -1);
  state.loop.wake();
}

function set(state, maximum) {
  const fraction = state.gap.t / state.maximum;
  state.maximum = maximum;
  state.gap.t = maximum * fraction;
  state.loop.wake();
}

function mount({ stage, svg, read }, maximum) {
  const bag = disposer();
  const C = Cam(45, 0.5, 1.65);
  fit(
    C,
    [
      [0, -6, 0],
      [106, 124, 0],
      [106, -6, 0],
      [0, 124, 0],
      [0, -6, 104],
    ],
    200,
    166,
  );
  const P = proj(C);
  const group = mk('g', {}, svg);
  const sheets = [];
  for (let index = 0; index < COUNT; index++) sheets.push(createSheet(group, C, index));
  const state = {
    C,
    P,
    read,
    sheets,
    maximum,
    gap: spring(maximum * REST),
    drawn: null,
    loop: null,
  };
  state.loop = register(stage, tick.bind(null, state));
  select(state, -1);
  bag.add(state.loop.unregister);
  bag.add(pointer(stage, { move: move.bind(null, state), leave: leave.bind(null, state) }));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}

hairline({
  name: 'audit-log',
  means:
    'A stack of audit records: move across to separate the sheets, and up or down to inspect a record.',
  rules: [1, 4, 6, 8, 10],
  range: [18, 26, 34],
  mount,
});
