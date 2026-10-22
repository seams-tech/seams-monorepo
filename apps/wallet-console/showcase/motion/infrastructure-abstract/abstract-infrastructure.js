/* @license MIT License — Copyright (c) 2026 Lucas Marques
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/* global HL, hairline */
// The server-rack wall of infrastructure-array/infrastructure-array.js,
// reduced to three plain cabinets with ruled server slots. One thin plate per
// server slides out of its slot along dashed floor rails.
const RACK_WIDTH = 40;
const RACK_COUNT = 3;
const BAYS = 6;
const FRONT = 14;
const REST = { rack: 1, bay: 3 };

function bayBottom(bay) {
  return 6 + bay * 12;
}

function block(parent, P, front, x0, y0, x1, y1, low, high, radius) {
  const inset = Math.min(0.6, (x1 - x0) / 4, (y1 - y0) / 4);
  const solid = HL.solid(parent);
  HL.put(solid, HL.prism(P, front, ...HL.rings(x0, y0, x1, y1, radius, inset), low, high));
  return solid;
}

function cabinet(svg, P, front, index) {
  const y = index * RACK_WIDTH;
  const group = HL.mk('g', {}, svg);
  block(group, P, front, -22, y + 1, FRONT, y + RACK_WIDTH - 1, 0, 80, 1.4);
  let rules = '';
  for (let bay = 0; bay <= BAYS; bay++) {
    const z = bayBottom(bay);
    rules += HL.seg(P(FRONT + 0.05, y + 4, z), P(FRONT + 0.05, y + RACK_WIDTH - 4, z));
  }
  HL.mk('path', { d: rules, class: 'lo nf' }, group);
}

function guides(svg, P) {
  let d = '';
  for (let index = 0; index < RACK_COUNT; index++) {
    const y = index * RACK_WIDTH;
    for (const rail of [y + 4, y + RACK_WIDTH - 4]) {
      d += HL.seg(P(FRONT, rail, 0), P(FRONT + 42, rail, 0));
    }
  }
  HL.mk('path', { d, class: 'nf lo dash' }, svg);
}

function isRest(rack, bay) {
  return rack === REST.rack && bay === REST.bay;
}

function makeServer(svg, rack, bay, reach) {
  return {
    rack,
    bay,
    solid: HL.solid(HL.mk('g', {}, svg)),
    slide: HL.tween(isRest(rack, bay) ? reach / 2 : 0),
    drawn: NaN,
  };
}

function drawServer(state, server, slide) {
  if (slide === server.drawn) return;
  server.drawn = slide;
  if (slide < 0.3) {
    server.solid.sil.setAttribute('d', '');
    server.solid.cr.setAttribute('d', '');
    return;
  }
  const y = server.rack * RACK_WIDTH;
  const z = bayBottom(server.bay) + 4.8;
  const ring = HL.rings(
    FRONT,
    y + 4,
    FRONT + slide,
    y + RACK_WIDTH - 4,
    1,
    Math.min(0.6, slide / 4),
  );
  HL.put(server.solid, HL.prism(state.P, state.front, ...ring, z, z + 2.4));
}

function tick(state, _dt, now) {
  let moving = false;
  for (const server of state.servers) {
    drawServer(state, server, HL.tval(server.slide, now));
    if (!HL.tdone(server.slide, now)) moving = true;
  }
  return moving;
}

// Over a cabinet, the server nearest the pointer slides out; anywhere else,
// the rest server sits half out.
function retarget(state) {
  let pick = { ...REST, reach: state.reach / 2 };
  if (state.over) {
    const bay = HL.clamp(Math.round((state.over.z - 12) / 12), 0, BAYS - 1);
    pick = { rack: state.over.rack, bay, reach: state.reach };
  }
  const now = performance.now();
  for (const server of state.servers) {
    const chosen = server.rack === pick.rack && server.bay === pick.bay;
    HL.tset(server.slide, chosen ? pick.reach : 0, now, 0);
    server.solid.sil.classList.toggle('hi', chosen);
  }
  state.read.textContent = state.over ? `rack ${pick.rack + 1} · ${pick.bay + 1}` : 'rest';
  state.loop.wake();
}

function move(state, point) {
  // Select against the fixed cabinet face, never the moving server plates.
  const origin = state.P(FRONT, 0, 0),
    across = state.P(FRONT, 1, 0),
    up = state.P(FRONT, 0, 1);
  const y = (point[0] - origin[0]) / (across[0] - origin[0]);
  const z = (point[1] - origin[1] - y * (across[1] - origin[1])) / (up[1] - origin[1]);
  // Require a two-unit crossing before switching racks at a shared boundary.
  const lower = state.nearbyRack * RACK_WIDTH - 2;
  const upper = (state.nearbyRack + 1) * RACK_WIDTH + 2;
  if (y < lower || y > upper) {
    state.nearbyRack = HL.clamp(Math.floor(y / RACK_WIDTH), 0, RACK_COUNT - 1);
  }
  state.over =
    y >= 0 && y < RACK_WIDTH * RACK_COUNT && z >= 5 && z <= 80
      ? { rack: state.nearbyRack, z }
      : null;
  retarget(state);
}

function leave(state) {
  state.nearbyRack = 0;
  state.over = null;
  retarget(state);
}

function set(state, reach) {
  state.reach = reach;
  retarget(state);
}

function view(P, x, y, z) {
  const point = P(x, y, z);
  return [400 - point[0], point[1]];
}

function mount({ stage, svg, read }, reach) {
  const C = HL.Cam(45, 0.5, 1.85);
  HL.fit(
    C,
    [
      [-22, 0, 84],
      [55, RACK_WIDTH * RACK_COUNT, 0],
      [-22, RACK_WIDTH * RACK_COUNT, 84],
      [55, 0, 0],
    ],
    200,
    164,
  );
  const P = view.bind(null, HL.proj(C)),
    front = HL.facing(C);
  guides(svg, P);
  for (let index = 0; index < RACK_COUNT; index++) cabinet(svg, P, front, index);
  const servers = [];
  for (let rack = 0; rack < RACK_COUNT; rack++) {
    for (let bay = 0; bay < BAYS; bay++) servers.push(makeServer(svg, rack, bay, reach));
  }
  const state = { P, front, servers, read, reach, nearbyRack: 0, over: null, loop: null };
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
    'Three plain cabinets with ruled server slots. Hover a cabinet to slide out the server under the pointer.',
  rules: [1, 4, 5, 6, 8, 9],
  range: [20, 28, 36],
  mount,
});
