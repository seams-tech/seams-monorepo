/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// No lock-in as a box that opens flat: the lid splits into two flaps, then the
// walls fold out on their hinges into a cross on the ground, and the small cube
// the box held stands in the open.
const SIDE = 40;
const HALF = SIDE / 2;
const INNER = 17;
// The four walls, by their outward direction on the ground. The ±x walls carry
// the lid's two flaps.
const WALLS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
// Toward the viewer at the default camera: a larger score is nearer (rule 06).
const NEAR = [0.612, 0.612, 0.5];

function depth(points) {
  let sum = 0;
  for (const [x, y, z] of points) sum += x * NEAR[0] + y * NEAR[1] + z * NEAR[2];
  return sum / points.length;
}

// A point on a wall: u along its hinge, w up from it, the wall at phi from the ground.
function wallPoint([dx, dy], u, w, phi) {
  const out = HALF + w * Math.cos(phi);
  return [dx * out - dy * u, dy * out + dx * u, w * Math.sin(phi)];
}

// A point on a flap, hinged to its wall's top edge and turned psi past the wall.
function flapPoint([dx, dy], u, w, phi, psi) {
  const out = HALF + SIDE * Math.cos(phi) + w * Math.cos(phi + psi);
  const z = SIDE * Math.sin(phi) + w * Math.sin(phi + psi);
  return [dx * out - dy * u, dy * out + dx * u, z];
}

function plate(svg, corners, wall) {
  const group = HL.mk('g', {}, svg);
  return { group, path: HL.mk('path', { class: 'sil' }, group), corners, wall, depth: 0 };
}

function wallCorners(wall) {
  return (phi) => [
    wallPoint(wall, -HALF, 0, phi),
    wallPoint(wall, HALF, 0, phi),
    wallPoint(wall, HALF, SIDE, phi),
    wallPoint(wall, -HALF, SIDE, phi),
  ];
}

function flapCorners(wall) {
  return (phi, psi) => [
    flapPoint(wall, -HALF, 0, phi, psi),
    flapPoint(wall, HALF, 0, phi, psi),
    flapPoint(wall, HALF, HALF, phi, psi),
    flapPoint(wall, -HALF, HALF, phi, psi),
  ];
}

function draw(state, flaps, wallsX, wallsY) {
  const psi = (Math.PI / 2) * (1 - flaps);
  for (const item of state.plates) {
    const open = item.wall && item.wall[0] ? wallsX : wallsY;
    const world = item.corners((Math.PI / 2) * (1 - open), psi);
    const screen = world.map((point) => state.P(...point));
    item.path.setAttribute('d', HL.poly(HL.fillet(screen, [1.6, 1.6, 1.6, 1.6])));
    item.depth = depth(world);
  }
  // Paint back to front; move the groups only when the order changes (rule 06).
  const order = [...state.items].sort((a, b) => a.depth - b.depth);
  if (order.some((item, index) => item !== state.order[index])) {
    state.order = order;
    state.svg.append(...order.map((item) => item.group));
  }
}

function tick(state, _dt, now) {
  const tweens = [state.flaps, state.wallsX, state.wallsY];
  const values = tweens.map((tween) => HL.tval(tween, now));
  const key = values.join(',');
  if (key !== state.drawn) {
    state.drawn = key;
    draw(state, ...values);
  }
  const moving = !tweens.every((tween) => HL.tdone(tween, now));
  state.read.textContent = !state.active ? 'rest' : moving ? 'opening' : 'open';
  return moving;
}

// Opening runs outward from the lid: flaps, then the walls that carry them, then
// the other two. Closing runs the same order back (rule 02).
function select(state, active) {
  if (state.active === active) return;
  state.active = active;
  const now = performance.now();
  const order = [state.flaps, state.wallsX, state.wallsY];
  if (!active) order.reverse();
  for (const [index, tween] of order.entries()) {
    HL.tset(tween, Number(active), now, index * state.step);
  }
  for (const flap of state.lid) flap.path.classList.toggle('hi', !active);
  state.inner.sil.classList.toggle('hi', active);
  state.loop.wake();
}

function mount({ stage, svg, read }, step) {
  const C = HL.Cam(45, 0.5, 2.2);
  const cube = [];
  for (const x of [-HALF, HALF]) {
    for (const y of [-HALF, HALF]) cube.push([x, y, 0], [x, y, SIDE]);
  }
  HL.fit(C, cube, 200, 160);
  const P = HL.proj(C);
  let arcs = '';
  for (const wall of WALLS) {
    const arc = [];
    for (let index = 0; index <= 24; index++) {
      arc.push(P(...wallPoint(wall, 0, SIDE, (Math.PI / 2) * (index / 24))));
    }
    arcs += HL.open(arc);
  }
  HL.mk('path', { d: arcs, class: 'nf lo dash' }, svg);
  const floor = [
    [-HALF, -HALF, 0],
    [HALF, -HALF, 0],
    [HALF, HALF, 0],
    [-HALF, HALF, 0],
  ];
  const base = plate(svg, () => floor, null);
  const walls = WALLS.map((wall) => plate(svg, wallCorners(wall), wall));
  const lid = [WALLS[0], WALLS[2]].map((wall) => plate(svg, flapCorners(wall), wall));
  const group = HL.mk('g', {}, svg);
  const [ring, inner] = HL.rings(-INNER / 2, -INNER / 2, INNER / 2, INNER / 2, 2, 1.2);
  const solid = HL.solid(group);
  HL.put(solid, HL.prism(P, HL.facing(C), ring, inner, 0, INNER));
  const cubeItem = { group, depth: (INNER / 2) * NEAR[2] };
  const plates = [base, ...walls, ...lid];
  const state = { svg, P, read, step, plates, lid, inner: solid, items: [...plates, cubeItem] };
  Object.assign(state, { order: [], drawn: '', active: null, loop: null });
  Object.assign(state, { flaps: HL.tween(0), wallsX: HL.tween(0), wallsY: HL.tween(0) });
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
  return { set: (value) => (state.step = value), destroy: bag.dispose };
}

hairline({
  name: 'unfold-box',
  means:
    'A closed box. Hover to split its lid and fold its walls flat, showing the small cube it held.',
  rules: [2, 4, 5, 6, 8],
  range: [80, 140, 200],
  mount,
});
