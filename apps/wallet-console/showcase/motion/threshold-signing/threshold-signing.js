/* @license MIT License — Copyright (c) 2026 Lucas Marques. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
/* global HL, hairline */
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
function curve(points) {
  return `M${points[0]} C${points[1]} ${points[2]} ${points[3]}`;
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
function rear(sample) {
  return sample.nu + sample.nv < 0;
}
function port(svg, P) {
  const points = [];
  for (let step = 0; step < 32; step++) {
    const angle = (step * Math.PI) / 16;
    const offset = 1.1 * Math.cos(angle);
    points.push(P(33.05, offset, 3 + 1.1 * Math.sin(angle)));
  }
  path(svg, HL.poly(points), 'sil');
}
function headPoint(K, sign, point, edge) {
  const scale = edge ? 8.5 / Math.hypot(...point) : 1;
  return K(point[0] * scale, point[1] * scale * sign, 4.6);
}
function keyBlade(parent, P) {
  const profile = [
    [-9, -2.6],
    [22, -2.6],
    [25, -0.4],
    [25, 1.4],
    [22, 3.6],
    [19, 3.6],
    [18, 1.1],
    [15, 1.1],
    [14, 3.6],
    [11, 3.6],
    [10, 1.8],
    [7, 1.8],
    [6, 3.6],
    [3, 3.6],
    [2, 0.8],
    [-1, 0.8],
    [-2, 3.6],
    [-9, 3.6],
  ];
  const outline = HL.fillet(profile, Array(profile.length).fill(0.3), 4);
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
  path(parent, HL.poly(top), 'sil');
  const groove = HL.rrect(-6, -1.5, 20, -0.6, 0.4, 8);
  path(parent, HL.poly(HL.ringAt(P, groove, 4.6)));
}
function tray(svg, P, front, mirrored) {
  const body = HL.solid(svg);
  const outer = HL.rrect(-33, -17, 33, 17, 5, 12);
  HL.put(body, {
    sil: HL.poly(HL.hull(HL.ringAt(P, outer, 0).concat(HL.ringAt(P, outer, 6)))),
    crease: HL.open(HL.ringAt(P, HL.run(outer, front), 6)),
  });
  const inner = HL.rrect(-29, -13, 29, 13, 3.5, 12);
  const opening = HL.poly(HL.ringAt(P, inner, 6));
  const clipId = mirrored ? 'infrastructure-tray-opening' : 'device-tray-opening';
  const clip = HL.mk('clipPath', { id: clipId }, HL.mk('defs', {}, body.g));
  HL.mk('path', { d: opening }, clip);
  const contents = HL.mk('g', { 'clip-path': `url(#${clipId})` }, body.g);
  path(contents, HL.open(HL.ringAt(P, HL.run(inner, rear), 2.5)));
  // The shaft enters beneath the head. The opening masks everything behind the rim.
  keyBlade(contents, P);
  const K = local.bind(null, P, [-15, 0]);
  const head = HL.solid(contents);
  const ring = HL.circ(8.5, 48);
  HL.put(head, {
    sil: HL.poly(HL.hull(HL.ringAt(K, ring, 2.6).concat(HL.ringAt(K, ring, 4.6)))),
    crease: HL.poly(HL.ringAt(K, ring, 4.6)),
  });
  const sign = mirrored ? -1 : 1;
  let seams = '';
  for (const arc of [
    [
      [-7.2, 4.5],
      [-6.5, -3],
      [1, -6.5],
      [7.8, -3.4],
    ],
    [
      [-2.9, 8],
      [-3, 2.8],
      [2.8, -1],
      [8.3, 1.8],
    ],
  ]) {
    const vertices = [];
    for (let index = 0; index < arc.length; index++) {
      vertices.push(headPoint(K, sign, arc[index], index === 0 || index === arc.length - 1));
    }
    seams += curve(vertices);
  }
  path(head.g, seams, 'sil nf');
  path(body.g, opening, 'sil nf');
}
function curvePoints(points) {
  const samples = [];
  for (let step = 0; step <= 48; step++) samples.push(curvePoint(points, step / 48));
  return samples;
}
function wirePoints(vertices) {
  const samples = [vertices[0]];
  for (let index = 1; index < vertices.length; index++) {
    const a = vertices[index - 1];
    const b = vertices[index];
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
    for (let step = 1; step <= steps; step++) {
      samples.push([HL.lerp(a[0], b[0], step / steps), HL.lerp(a[1], b[1], step / steps)]);
    }
  }
  return samples;
}
function tracePoint(points, progress) {
  const position = progress * (points.length - 1);
  const index = Math.floor(position);
  const a = points[index];
  const b = points[Math.min(index + 1, points.length - 1)];
  return [HL.lerp(a[0], b[0], position - index), HL.lerp(a[1], b[1], position - index)];
}
function trace(svg, points, name) {
  return { points, el: HL.mk('path', { class: 'hi nf', 'data-part': name }, svg) };
}
function setTrace(trace, progress) {
  const position = progress * (trace.points.length - 1);
  const index = Math.floor(position);
  const vertices = trace.points.slice(0, index + 1);
  if (index < trace.points.length - 1) {
    vertices.push(tracePoint(trace.points, progress));
  }
  trace.el.setAttribute('d', progress > 0 ? HL.open(vertices) : '');
  trace.el.setAttribute('data-progress', progress);
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
function advance(state, now) {
  state.phase = -1;
  for (let n = 0; n < state.clocks.length; n++) {
    const index = state.active ? n : state.clocks.length - 1 - n;
    if (HL.tval(state.clocks[index], now) === Number(state.active)) continue;
    state.phase = index;
    HL.tset(state.clocks[index], Number(state.active), now, 0);
    break;
  }
}
function select(state, active) {
  if (active === state.active) return;
  const now = performance.now();
  if (state.phase >= 0) {
    const motion = state.clocks[state.phase];
    HL.tset(motion, HL.tval(motion, now), now, 0);
  }
  state.active = active;
  advance(state, now);
  state.loop.wake();
}
function keyboard(state, event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select(state, !state.active);
}
function timing(duration) {
  return HL.tween(0, duration);
}
function tick(state, dt, now) {
  while (state.phase >= 0 && HL.tdone(state.clocks[state.phase], now)) advance(state, now);
  const input = HL.tval(state.clocks[0], now);
  const policy = HL.tval(state.clocks[1], now);
  const output = HL.tval(state.clocks[2], now);
  const signed = HL.tval(state.clocks[3], now);
  const pose = [input, policy, output, signed, state.lag].join();
  if (pose !== state.pose) {
    state.pose = pose;
    const progress = [
      HL.clamp(input / (1 - state.lag), 0, 1),
      HL.clamp((input - state.lag) / (1 - state.lag), 0, 1),
      output,
    ];
    for (let index = 0; index < state.routes.length; index++) {
      const route = state.routes[index];
      setTrace(route.trail, progress[index]);
      HL.place(route.dot, tracePoint(route.points, progress[index]));
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
  const phases = ['two shares', 'policy check', 'authorized', 'signing'];
  state.read.textContent = state.active
    ? state.phase < 0
      ? 'signed'
      : phases[state.phase]
    : 'rest';
  state.stage.setAttribute('aria-pressed', String(state.active));
  return state.phase >= 0;
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
      [-67, -15, 3],
      [-12, -15, 3],
      [-12, 4, 3],
      [1, 4, 3],
    ],
    [
      [-5, 63, 3],
      [-5, 10, 3],
      [1, 10, 3],
    ],
    [
      [15, -7.5, 3],
      [15, -85, 3],
      [26, -85, 3],
    ],
  ]) {
    const routeName = ['device', 'infrastructure', 'transaction'][routes.length];
    const group = HL.mk('g', { 'data-route': routeName }, svg);
    const points = wirePoints(vertices.map(point.bind(null, P)));
    const d = HL.open(points);
    path(group, d);
    routes.push({
      group,
      points,
      trail: trace(group, points, 'signal'),
      dot: HL.mk('circle', { r: 1.4, class: 'hi', visibility: 'hidden' }, group),
    });
    routes[routes.length - 1].trail.el.setAttribute('class', 'sil nf');
  }
  for (let index = 0; index < sourceOrigins.length; index++) {
    const T = local.bind(null, P, sourceOrigins[index]);
    tray(svg, T, front, index === 1);
    const at = T(0, 0, 0);
    label(svg, [at[0], at[1] - 37], index === 0 ? 'USER’S DEVICE' : 'YOUR INFRASTRUCTURE');
  }
  // The first wire leaves a visible front wall; the second enters behind its tray.
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
    clocks: [600, 250, 280, 450].map(timing),
    phase: -1,
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
