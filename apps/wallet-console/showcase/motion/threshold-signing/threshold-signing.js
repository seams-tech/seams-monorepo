/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
const DURATION = 2800;
const CLOCK_TIME = HL.bezier(0.72, 0.32, 1, 0);
const TILE_EASE = HL.bezier(0.65, 0, 0.35, 1);
const SIGNATURE_EASE = HL.bezier(0.23, 1, 0.32, 1);
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function local(P, origin, x, y, z) {
  return P(origin[0] + x, origin[1] + y, z);
}
function screenY(point) {
  return point[1];
}
function curvePoint(points, t) {
  const [a, b, c, d] = points;
  const s = 1 - t;
  return [
    s ** 3 * a[0] + 3 * s * s * t * b[0] + 3 * s * t * t * c[0] + t ** 3 * d[0],
    s ** 3 * a[1] + 3 * s * s * t * b[1] + 3 * s * t * t * c[1] + t ** 3 * d[1],
  ];
}
function label(svg, location, text) {
  const el = HL.mk(
    'text',
    {
      x: location[0],
      y: location[1],
      'text-anchor': 'middle',
      'font-size': 6.8,
      'letter-spacing': 0.4,
      fill: 'var(--muted)',
      stroke: 'none',
    },
    svg,
  );
  el.textContent = text;
  return el;
}
function farSide(front, sample) {
  return !front(sample);
}
function port(svg, P, center) {
  const points = [];
  for (let step = 0; step < 32; step++) {
    const angle = (step * Math.PI) / 16;
    const offset = 0.8 * Math.cos(angle);
    points.push(P(35.05, center + offset, 1.3 + 0.8 * Math.sin(angle)));
  }
  path(svg, HL.poly(points), 'sil');
}
function embossedRing(parent, P, front, outerRadius, innerRadius, height) {
  const outer = HL.circ(outerRadius, 64);
  const inner = HL.circ(innerRadius, 64);
  const visible = HL.run(outer, front);
  const bottom = HL.ringAt(P, visible, 4.6);
  const top = HL.ringAt(P, visible, height);
  path(parent, HL.poly(bottom.concat(top.slice().reverse())), 'fo');
  path(parent, HL.open(bottom));
  const face = path(
    parent,
    HL.poly(HL.ringAt(P, outer, height)) + HL.poly(HL.ringAt(P, inner, height)),
    'lo',
  );
  face.setAttribute('fill-rule', 'evenodd');
}
function classicKey(slab, P, front) {
  const parent = HL.mk('g', { 'data-part': 'key' }, slab);
  const radius = 8.5;
  const neckAngle = Math.asin(3 / radius);
  const neck = -15 + Math.sqrt(radius ** 2 - 3 ** 2);
  const profile = [
    [neck, -3],
    [20, -3],
    [23, -1],
    [23, 1],
    [21, 3],
    [19, 3],
    [18, 1.5],
    [16, 1.5],
    [15, 3],
    [13, 3],
    [12, 2],
    [10, 2],
    [9, 3],
    [7, 3],
    [6, 1.3],
    [4, 1.3],
    [3, 3],
    [1, 3],
    [0, 2],
    [-2, 2],
    [-3, 3],
    [neck, 3],
  ];
  const radii = Array(profile.length).fill(0.18);
  radii[0] = 0;
  radii[radii.length - 1] = 0;
  const outline = HL.fillet(profile, radii, 3);
  // The head and blade share one continuous silhouette.
  for (let step = 0; step <= 64; step++) {
    const angle = neckAngle + ((2 * Math.PI - 2 * neckAngle) * step) / 64;
    outline.push([-15 + radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  const top = [];
  const bottom = [];
  const visible = [];
  for (let index = 0; index < outline.length; index++) {
    const [x, y] = outline[index];
    const next = outline[(index + 1) % outline.length];
    top.push(P(x, y, 4.6));
    bottom.push(P(x, y, 2.6));
    // At 45 degrees, visible side faces have an outward normal with positive x + y.
    visible.push(next[1] - y > next[0] - x);
  }
  let walls = '';
  let edges = '';
  for (let index = 0; index < outline.length; index++) {
    if (!visible[index]) continue;
    const next = (index + 1) % outline.length;
    const previous = (index + outline.length - 1) % outline.length;
    walls += HL.poly([bottom[index], bottom[next], top[next], top[index]]);
    edges += HL.seg(bottom[index], bottom[next]);
    if (!visible[previous]) edges += HL.seg(bottom[index], top[index]);
    if (!visible[next]) edges += HL.seg(bottom[next], top[next]);
  }
  path(parent, walls, 'fo');
  path(parent, edges, 'sil nf');
  const holeP = local.bind(null, P, [-19, 0]);
  const hole = HL.circ(2.1, 48);
  const innerWall = HL.run(hole, farSide.bind(null, front));
  path(parent, HL.open(HL.ringAt(holeP, innerWall, 2.6)));
  const face = path(parent, HL.poly(top) + HL.poly(HL.ringAt(holeP, hole, 4.6)), 'sil');
  face.setAttribute('fill-rule', 'evenodd');
  const groove = HL.rrect(-6, -1.5, 20, -0.6, 0.4, 8);
  path(parent, HL.poly(HL.ringAt(P, groove, 4.6)));
  embossedRing(parent, local.bind(null, P, [-15, 0]), front, 7.6, 7.1, 4.95);
  path(parent, HL.poly(HL.ringAt(holeP, HL.circ(2.75, 48), 4.6)));
  for (const line of parent.querySelectorAll('path')) {
    line.style.strokeWidth = line.classList.contains('lo') ? '0.5px' : '0.65px';
  }
}
function slab(svg, P, front) {
  const base = HL.solid(svg);
  HL.put(base, HL.prism(P, front, ...HL.rings(-35, -19, 35, 19, 4, 1.2), 0, 2.6));
  const body = HL.solid(svg);
  body.g.setAttribute('data-part', 'share-tile');
  body.sil.style.strokeWidth = '1px';
  const outline = HL.rrect(-33, -17, 33, 17, 3, 12);
  const top = HL.ringAt(P, outline, 2.6);
  HL.put(body, {
    sil: HL.poly(HL.hull(HL.ringAt(P, outline, 0).concat(top))),
    crease: HL.open(HL.ringAt(P, HL.run(outline, front), 2.6)),
  });
  const engravings =
    HL.seg(P(-25, 11, 2.6), P(-17, 11, 2.6)) + HL.seg(P(-25, 13, 2.6), P(-20, 13, 2.6));
  path(body.g, engravings);
  classicKey(body.g, P, front);
  const liftVector = liftDirection(P);
  return { body, liftVector, labelTop: Math.min(...top.map(screenY)) + liftVector[1] * 10.6 };
}
function liftDirection(P) {
  const ground = P(0, 0, 0);
  const raised = P(0, 0, 1);
  return [raised[0] - ground[0], raised[1] - ground[1]];
}
function liftTile(tile, height) {
  tile.body.g.setAttribute(
    'transform',
    `translate(${tile.liftVector[0] * height} ${tile.liftVector[1] * height})`,
  );
  tile.body.g.dataset.lift = height;
}
function curvePoints(points) {
  const samples = [];
  for (let step = 0; step <= 48; step++) samples.push(curvePoint(points, step / 48));
  return samples;
}
function wirePoints(vertices) {
  const samples = [vertices[0]];
  for (let index = 1; index < vertices.length - 1; index++) {
    const previous = vertices[index - 1];
    const corner = vertices[index];
    const next = vertices[index + 1];
    const incoming = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
    const outgoing = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const radius = Math.min(12, incoming / 2, outgoing / 2);
    const entry = [],
      exit = [];
    for (let axis = 0; axis < 2; axis++) {
      entry.push(HL.lerp(corner[axis], previous[axis], radius / incoming));
      exit.push(HL.lerp(corner[axis], next[axis], radius / outgoing));
    }
    samples.push(...curvePoints([entry, corner, corner, exit]));
  }
  samples.push(vertices[vertices.length - 1]);
  return samples;
}
function trace(svg, points, name) {
  const distances = [0];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    distances.push(
      distances[index - 1] + Math.hypot(current[0] - previous[0], current[1] - previous[1]),
    );
  }
  return { points, distances, el: HL.mk('path', { class: 'hi nf', 'data-part': name }, svg) };
}
function setTrace(trace, progress) {
  const distance = progress * trace.distances[trace.distances.length - 1];
  let index = 0;
  while (index < trace.points.length - 2 && trace.distances[index + 1] < distance) index++;
  const span = trace.distances[index + 1] - trace.distances[index];
  const fraction = span > 0 ? (distance - trace.distances[index]) / span : 0;
  const a = trace.points[index];
  const b = trace.points[index + 1];
  const tip = [HL.lerp(a[0], b[0], fraction), HL.lerp(a[1], b[1], fraction)];
  const vertices = trace.points.slice(0, index + 1);
  vertices.push(tip);
  trace.el.setAttribute('d', progress > 0 ? HL.open(vertices) : '');
  trace.el.setAttribute('data-progress', progress);
  return tip;
}
function policyCheck(parent, P) {
  const check = [P(-3, 7, 2.3), P(0, 12, 2.3), P(7, 2, 2.3)];
  path(parent, HL.open(check));
  return trace(parent, check, 'check');
}
function policyStack(svg, P, front) {
  const group = HL.mk('g', { 'data-part': 'policy-stack' }, svg);
  const base = HL.solid(group);
  const [footprint, inset] = HL.rings(-25, -20, 25, 20, 4, 1.2);
  HL.put(base, HL.prism(P, front, footprint, inset, 0, 2.6));
  const cards = [];
  for (let index = 0; index < 3; index++) {
    const body = HL.solid(group);
    body.g.setAttribute('data-policy', index + 1);
    const [outline, inner] = HL.rings(-22, -17, 22, 17, 3, 1.2);
    HL.put(body, HL.prism(P, front, outline, inner, 0, 2.2));
    path(body.g, HL.seg(P(-13, -9, 2.3), P(12, -9, 2.3)) + HL.seg(P(-13, -5, 2.3), P(5, -5, 2.3)));
    cards.push({ body, mark: policyCheck(body.g, P), liftVector: liftDirection(P) });
  }
  return {
    group,
    cards,
    labelBottom: Math.max(...HL.ringAt(P, footprint, 0).map(screenY)),
    inlet: P(-24.8, 0, 1.3),
    outlet: P(24.8, 0, 1.3),
  };
}
function transaction(svg, P, front) {
  const base = HL.solid(svg);
  HL.put(base, HL.prism(P, front, ...HL.rings(-31, -23, 31, 23, 5, 1.2), 0, 2.6));
  const body = HL.solid(svg);
  body.g.setAttribute('data-part', 'transaction-tile');
  body.sil.style.strokeWidth = '1px';
  const [outline, inset] = HL.rings(-29, -21, 29, 21, 4, 0.8);
  HL.put(body, HL.prism(P, front, outline, inset, 0, 3.5));
  let lines = '';
  for (let row = 0; row < 3; row++) {
    lines += HL.seg(P(-20, -12 + row * 4, 3.6), P(20 - row * 4, -12 + row * 4, 3.6));
  }
  path(body.g, lines);
  const signature = [];
  for (const segment of [
    [
      [-21, 12],
      [-10, -5],
      [-7, -1],
      [-16, 12],
    ],
    [
      [-16, 12],
      [0, -4],
      [0, 4],
      [-5, 10],
    ],
    [
      [-5, 10],
      [7, -1],
      [1, 15],
      [11, 8],
    ],
    [
      [11, 8],
      [16, 5],
      [14, 10],
      [22, 7],
    ],
  ]) {
    const vertices = [];
    for (const [x, y] of segment) vertices.push(P(x, y, 3.6));
    const samples = curvePoints(vertices);
    signature.push(...(signature.length ? samples.slice(1) : samples));
  }
  return {
    body,
    liftVector: liftDirection(P),
    mark: trace(body.g, signature, 'signature'),
    labelBottom: Math.max(...HL.ringAt(P, outline, 0).map(screenY)),
  };
}
function select(state, active) {
  if (active === state.active) return;
  state.active = active;
  const now = performance.now();
  const from = sequencePosition(state.motion, now);
  const to = Number(active);
  const clock = HL.tween(0, DURATION * Math.abs(to - from));
  HL.tset(clock, 1, now, 0);
  state.motion = { from, to, clock };
  state.loop.wake();
}
function keyboard(state, event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select(state, !state.active);
}
function sequencePosition(motion, now) {
  return HL.lerp(motion.from, motion.to, CLOCK_TIME(HL.tval(motion.clock, now)));
}
function phase(motion, from, to) {
  return HL.clamp((motion - from) / (to - from), 0, 1);
}
function tick(state, _dt, now) {
  const motion = sequencePosition(state.motion, now);
  const input = TILE_EASE(phase(motion, 0.14, 0.42));
  const policy = phase(motion, 0.42, 0.68);
  const output = TILE_EASE(phase(motion, 0.68, 0.84));
  const signed = phase(motion, 0.84, 1);
  const pose = [motion, state.lag].join();
  if (pose !== state.pose) {
    state.pose = pose;
    for (let index = 0; index < state.tiles.length; index++) {
      const tile = state.tiles[index];
      liftTile(tile, 2.6 + 8 * TILE_EASE(phase(motion, index * 0.03, 0.14 + index * 0.03)));
      tile.body.sil.classList.toggle('hi', index === 0 && input === 0);
    }
    const spread = TILE_EASE(phase(motion, 0.26, 0.42));
    for (let index = 0; index < state.gate.cards.length; index++) {
      const card = state.gate.cards[index];
      const checked = HL.clamp(policy * 3 - index, 0, 1);
      liftTile(card, 4 + index * (4 + 10 * spread));
      setTrace(card.mark, SIGNATURE_EASE(checked));
      card.mark.el.setAttribute('class', checked > 0 && checked < 1 ? 'hi nf' : 'sil nf');
    }
    liftTile(state.result, 2.6 + 6 * TILE_EASE(phase(motion, 0.72, 0.84)));
    const progress = [
      HL.clamp(input / (1 - state.lag), 0, 1),
      HL.clamp((input - state.lag) / (1 - state.lag), 0, 1),
      output,
    ];
    for (let index = 0; index < state.routes.length; index++) {
      const route = state.routes[index];
      let tip = setTrace(route.trail, progress[index]);
      const end = route.trail.points.at(-1);
      if (index < 2 && Math.hypot(tip[0] - end[0], tip[1] - end[1]) < 4) {
        tip = route.arrival;
      }
      HL.place(route.dot, tip);
      // Keep completed connections quiet while the accent follows the active signal.
      const accented = index === 2 || (progress[0] < 1 ? index === 0 : index === 1);
      route.dot.setAttribute('class', accented ? 'hi' : 'sil');
      route.dot.setAttribute(
        'visibility',
        progress[index] > 0 && (progress[index] < 1 || (index < 2 && input < 1))
          ? 'visible'
          : 'hidden',
      );
    }
    setTrace(state.result.mark, SIGNATURE_EASE(signed));
  }
  state.read.textContent = 'rest';
  if (state.active) {
    if (input < 1) state.read.textContent = 'two shares';
    else if (policy < 1) state.read.textContent = 'policy checks';
    else if (output < 1) state.read.textContent = 'authorized';
    else if (signed < 1) state.read.textContent = 'signing';
    else state.read.textContent = 'signed';
  }
  state.stage.setAttribute('aria-pressed', String(state.active));
  return !HL.tdone(state.motion.clock, now);
}
function set(state, lag) {
  state.lag = lag;
  state.loop.wake();
}
function resizeFigure(stage, svg, transactionLabel) {
  const compact = stage.clientWidth <= 480;
  // Reserve space for the standalone preview's name and status above the drawing.
  const top = stage.closest('main') ? -40 : 0;
  const height = 270 - top;
  svg.setAttribute('viewBox', compact ? `60 ${top} 420 ${height}` : '0 0 560 280');
  stage.style.aspectRatio = compact ? `420 / ${height}` : '2 / 1';
  svg.style.aspectRatio = compact ? `420 / ${height}` : '2 / 1';
  transactionLabel.textContent = compact ? 'Signed' : 'Signed transaction';
  for (const text of svg.querySelectorAll('text')) {
    text.style.fontSize = compact ? '10px' : '';
  }
}
function mount({ stage, svg, read }, lag) {
  svg.setAttribute('viewBox', '0 0 560 280');
  stage.style.aspectRatio = '2 / 1';
  svg.style.aspectRatio = '2 / 1';
  const preview = stage.closest('main');
  if (preview && !preview.style.maxWidth) preview.style.maxWidth = '896px';
  const C = HL.Cam(45, 0.5, 1.45);
  HL.fit(C, [[0, 0, 0]], 185, 88);
  const P = HL.proj(C),
    front = HL.facing(C);
  // The source tiles share one x position; policies and result follow their centre axis.
  const sourceCenters = [
    [0, -50],
    [0, 50],
  ];
  const sources = [];
  for (const center of sourceCenters) sources.push(local.bind(null, P, center));
  const gateP = local.bind(null, P, [110, 0]);
  const resultP = local.bind(null, P, [220, 0]);
  const gate = policyStack(svg, gateP, front);
  const wireBase = HL.mk('g', {}, svg);
  const paths = [];
  const inlet = HL.unproj(C, gate.inlet[0], gate.inlet[1], 0);
  const junction = [inlet[0] - 24, inlet[1]];
  const merge = P(junction[0] + 12, junction[1], 0);
  for (const source of sources) {
    const start = source(35.05, 0, 1.3);
    const from = HL.unproj(C, start[0], start[1], 0);
    const side = Math.sign(from[1] - junction[1]);
    const entry = P(junction[0], junction[1] + side * 12, 0);
    const points = wirePoints([start, P(junction[0], from[1], 0), entry]);
    const bend = curvePoints([
      entry,
      P(junction[0], junction[1] + side * 4, 0),
      P(junction[0] + 4, junction[1], 0),
      merge,
    ]);
    points.push(...bend.slice(1), gate.inlet);
    paths.push(points);
  }
  paths.push([gate.outlet, resultP(-30.8, 0, 1.3)]);
  const routes = [];
  let wiring = '';
  for (const points of paths) {
    const routeName = ['device', 'infrastructure', 'transaction'][routes.length];
    const group = HL.mk('g', { 'data-route': routeName }, svg);
    if (routes.length < 2) {
      wiring += HL.open(points.slice(0, -1));
      // Both rounded branches meet the same tangent. Draw their shared stem once.
      if (routes.length === 0) wiring += HL.seg(points.at(-2), points.at(-1));
    } else {
      wiring += HL.open(points);
    }
    const end = points.at(-1);
    const previous = points.at(-2);
    const arrivalOffset = 4 / Math.hypot(end[0] - previous[0], end[1] - previous[1]);
    routes.push({
      group,
      trail: trace(group, points, 'signal'),
      arrival: [
        HL.lerp(end[0], previous[0], arrivalOffset),
        HL.lerp(end[1], previous[1], arrivalOffset),
      ],
      dot: HL.mk('circle', { r: 1.4, class: 'hi', visibility: 'hidden' }, group),
    });
    routes[routes.length - 1].trail.el.setAttribute('class', 'lo nf');
  }
  path(wireBase, wiring);
  const tiles = [];
  for (let index = 0; index < sources.length; index++) {
    const source = slab(svg, sources[index], front);
    tiles.push(source);
    const center = sources[index](0, 0, 0);
    label(
      svg,
      [center[0], source.labelTop - 8],
      index === 0 ? 'User’s device' : 'Your infrastructure',
    );
  }
  // Keep shared wires beneath every signal and the policy stack above the join.
  svg.append(wireBase);
  for (const route of routes) svg.append(route.group);
  for (const source of sources) port(svg, source, 0);
  svg.append(gate.group);
  const result = transaction(svg, resultP, front);
  const gateCenter = gateP(0, 0, 0);
  const resultCenter = resultP(0, 0, 0);
  label(svg, [gateCenter[0], gate.labelBottom + 15], 'Policy checks');
  const transactionLabel = label(
    svg,
    [resultCenter[0], result.labelBottom + 15],
    'Signed transaction',
  );
  label(svg, [280, 260], '2-of-2 threshold · neither share signs alone');
  const state = {
    stage,
    read,
    routes,
    tiles,
    gate,
    result,
    lag,
    motion: { from: 0, to: 0, clock: HL.tween(1, DURATION) },
    active: false,
    pose: '',
    loop: null,
  };
  stage.setAttribute('tabindex', '0');
  stage.setAttribute('role', 'button');
  stage.setAttribute(
    'aria-label',
    'Animate two independent key shares authorizing one signed transaction',
  );
  state.loop = HL.register(stage, tick.bind(null, state));
  state.loop.wake();
  const bag = HL.disposer();
  const resize = new ResizeObserver(resizeFigure.bind(null, stage, svg, transactionLabel));
  resizeFigure(stage, svg, transactionLabel);
  resize.observe(stage);
  bag.add(resize.disconnect.bind(resize));
  bag.add(state.loop.unregister);
  bag.add(
    HL.pointer(stage, {
      move: select.bind(null, state, true),
      leave: select.bind(null, state, false),
    }),
  );
  bag.on(stage, 'keydown', keyboard.bind(null, state));
  bag.on(stage, 'blur', select.bind(null, state, false));
  bag.add(svg.replaceChildren.bind(svg));
  return { set: set.bind(null, state), destroy: bag.dispose };
}
hairline({
  name: 'threshold-signing',
  means:
    'Two key shares rise from their bases. Three policies approve one signed transaction. Hover or press Enter to animate.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [0, 0.15, 0.3],
  mount,
});
