/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
// Share the tween's easing without restarting its velocity at stage boundaries.
const INPUT_END = HL.EASE_LIFT(0.38);
const POLICY_END = HL.EASE_LIFT(0.5);
const OUTPUT_END = HL.EASE_LIFT(0.72);
function path(parent, d, classes = 'lo nf') {
  return HL.mk('path', { d, class: classes }, parent);
}
function local(P, origin, x, y, z) {
  return P(origin[0] + x, origin[1] + y, z);
}
function point(P, vertex) {
  return P(...vertex);
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
      'font-size': 5.8,
      'letter-spacing': 0.55,
      fill: 'var(--muted)',
      stroke: 'none',
    },
    svg,
  );
  el.textContent = text;
}
function port(svg, P) {
  const points = [];
  for (let step = 0; step < 32; step++) {
    const angle = (step * Math.PI) / 16;
    const offset = 0.8 * Math.cos(angle);
    points.push(P(33.05, offset, 1.3 + 0.8 * Math.sin(angle)));
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
function classicKey(parent, P, front) {
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
  path(parent, HL.poly(HL.ringAt(holeP, hole, 2.6)));
  const face = path(parent, HL.poly(top) + HL.poly(HL.ringAt(holeP, hole, 4.6)), 'sil');
  face.setAttribute('fill-rule', 'evenodd');
  const groove = HL.rrect(-6, -1.5, 20, -0.6, 0.4, 8);
  path(parent, HL.poly(HL.ringAt(P, groove, 4.6)));
  embossedRing(parent, local.bind(null, P, [-15, 0]), front, 7.6, 7.1, 4.95);
  embossedRing(parent, holeP, front, 2.75, 2.1, 5.2);
}
function slab(svg, P, front) {
  const body = HL.solid(svg);
  const outline = HL.rrect(-33, -17, 33, 17, 3, 12);
  HL.put(body, {
    sil: HL.poly(HL.hull(HL.ringAt(P, outline, 0).concat(HL.ringAt(P, outline, 2.6)))),
    crease: HL.open(HL.ringAt(P, HL.run(outline, front), 2.6)),
  });
  const engravings =
    HL.seg(P(-25, 11, 2.6), P(-17, 11, 2.6)) + HL.seg(P(-25, 13, 2.6), P(-20, 13, 2.6));
  path(body.g, engravings);
  classicKey(body.g, P, front);
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
    const radius = Math.min(8, incoming / 2, outgoing / 2);
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
function shield(svg, P) {
  const outline = [
    [-14, -12],
    [0, -18],
    [14, -12],
    [14, 1],
    [10, 11],
    [0, 18],
    [-10, 11],
    [-14, 1],
  ];
  const face = [],
    back = [];
  for (const [x, y] of HL.fillet(outline, [1, 0.6, 1, 3, 3, 1, 3, 3], 8)) {
    face.push(P(x, y, 4));
    back.push(P(x, y, 2));
  }
  const body = HL.solid(svg);
  HL.put(body, { sil: HL.poly(HL.hull(face.concat(back))), crease: HL.poly(face) });
  const mark = trace(body.g, [P(-6, 0, 4.1), P(-1, 5, 4.1), P(7, -7, 4.1)], 'check');
  return { body, mark };
}
function transaction(svg, P, front) {
  const body = HL.solid(svg);
  HL.put(body, HL.prism(P, front, ...HL.rings(-29, -21, 29, 21, 4, 0.8), 0, 3.5));
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
  return { body, mark: trace(body.g, signature, 'signature') };
}
function select(state, active) {
  if (active === state.active) return;
  state.active = active;
  HL.tset(state.motion, Number(active), performance.now(), 0);
  state.loop.wake();
}
function keyboard(state, event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select(state, !state.active);
}
function tick(state, _dt, now) {
  const motion = HL.tval(state.motion, now);
  const input = HL.clamp(motion / INPUT_END, 0, 1);
  const policy = HL.clamp((motion - INPUT_END) / (POLICY_END - INPUT_END), 0, 1);
  const output = HL.clamp((motion - POLICY_END) / (OUTPUT_END - POLICY_END), 0, 1);
  const signed = HL.clamp((motion - OUTPUT_END) / (1 - OUTPUT_END), 0, 1);
  const pose = [motion, state.lag].join();
  if (pose !== state.pose) {
    state.pose = pose;
    const progress = [
      HL.clamp(input / (1 - state.lag), 0, 1),
      HL.clamp((input - state.lag) / (1 - state.lag), 0, 1),
      output,
    ];
    for (let index = 0; index < state.routes.length; index++) {
      const route = state.routes[index];
      HL.place(route.dot, setTrace(route.trail, progress[index]));
      route.dot.setAttribute(
        'visibility',
        progress[index] > 0 && progress[index] < 1 ? 'visible' : 'hidden',
      );
    }
    setTrace(state.gate.mark, policy);
    setTrace(state.result.mark, signed);
    state.gate.mark.el.setAttribute('class', signed === 1 ? 'sil nf' : 'hi nf');
    state.result.body.sil.setAttribute('class', signed === 1 ? 'hi' : 'sil');
  }
  state.read.textContent = 'rest';
  if (state.active) {
    if (input < 1) state.read.textContent = 'two shares';
    else if (policy < 1) state.read.textContent = 'policy check';
    else if (output < 1) state.read.textContent = 'authorized';
    else if (signed < 1) state.read.textContent = 'signing';
    else state.read.textContent = 'signed';
  }
  state.stage.setAttribute('aria-pressed', String(state.active));
  return !HL.tdone(state.motion, now);
}
function set(state, lag) {
  state.lag = lag;
  state.loop.wake();
}
function mount({ stage, svg, read }, lag) {
  const C = HL.Cam(45, 0.5, 1.45);
  HL.fit(
    C,
    [
      [-133, -32, 0],
      [114, -56, 0],
      [-38, 97, 0],
    ],
    200,
    162,
  );
  const P = HL.proj(C),
    front = HL.facing(C);
  const sourceOrigins = [
    [-100, -15],
    [-5, 80],
  ];
  const gateP = local.bind(null, P, [15, 10]);
  const resultP = local.bind(null, P, [55, -85]);
  const routes = [];
  for (const vertices of [
    [
      [-67, -15, 1.3],
      [-12, -15, 1.3],
      [-12, 4, 1.3],
      [1, 4, 1.3],
    ],
    [
      [-5, 63, 1.3],
      [-5, 10, 1.3],
      [1, 10, 1.3],
    ],
    [
      [15, -7.5, 1.3],
      [15, -85, 1.3],
      [26, -85, 1.3],
    ],
  ]) {
    const routeName = ['device', 'infrastructure', 'transaction'][routes.length];
    const group = HL.mk('g', { 'data-route': routeName }, svg);
    const points = wirePoints(vertices.map(point.bind(null, P)));
    const d = HL.open(points);
    path(group, d);
    routes.push({
      group,
      trail: trace(group, points, 'signal'),
      dot: HL.mk('circle', { r: 1.4, class: 'hi', visibility: 'hidden' }, group),
    });
    routes[routes.length - 1].trail.el.setAttribute('class', 'sil nf');
  }
  for (let index = 0; index < sourceOrigins.length; index++) {
    const T = local.bind(null, P, sourceOrigins[index]);
    slab(svg, T, front);
    const at = T(0, 0, 0);
    label(svg, [at[0], at[1] - 37], index === 0 ? 'USER’S DEVICE' : 'YOUR INFRASTRUCTURE');
  }
  // The first wire leaves a visible front wall; the second enters behind its slab.
  svg.append(routes[0].group);
  port(svg, local.bind(null, P, sourceOrigins[0]));
  const gate = shield(svg, gateP);
  const result = transaction(svg, resultP, front);
  const gateAt = gateP(0, 0, 0),
    resultAt = resultP(0, 0, 0);
  const captionY = Math.max(gateAt[1] + 29, resultAt[1] + 36);
  label(svg, [gateAt[0], captionY], 'Policy check');
  label(svg, [resultAt[0], captionY], 'Signed transaction');
  label(svg, [200, 281], '2-of-2 threshold · neither share signs alone');
  const state = {
    stage,
    read,
    routes,
    gate,
    result,
    lag,
    motion: HL.tween(0, 1800),
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
    'Two separate key shares pass a policy check, then authorize one signed transaction. Hover or press Enter to animate.',
  rules: [1, 3, 4, 6, 7, 8, 9],
  range: [0, 0.15, 0.3],
  mount,
});
