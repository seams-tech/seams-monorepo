import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skill =
  process.env.ANATOMY_SKILL_DIR ||
  join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills/anatomy');
const k = await import(pathToFileURL(join(skill, 'kit/iso-kit.mjs')));
const A = await import(pathToFileURL(join(skill, 'kit/audit.mjs')));
const G = await import(pathToFileURL(join(skill, 'kit/lathe.mjs')));
const { kitScript } = await import(pathToFileURL(join(skill, 'scripts/inline-kit.mjs')));
const base = { x: -154, y: -112, w: 308, d: 222, r: 10 };
const projection = k.fitProjection(
  [
    ...k.boxCorners(base, -18, 0),
    ...k.boxCorners({ x: -58, y: -14, w: 116, d: 26 }, 103, 114),
    ...k.boxCorners({ x: -20, y: -103, w: 130, d: 47 }, 5, 44),
  ],
  860,
  570,
  {
    pad: 36,
    azimuth: 38,
    elevation: 32,
  },
);
const recorder = A.recorder(projection, {
  order: ['press'],
  spring: { stagger: 0, stiffness: 80, damping: 18, substeps: 4 },
});
const stroke = [0, 0, -38];

function outline(plan, z) {
  return k.lineSvg(k.planOutline(k.insetPlan(plan, 2.5), z, projection), { tone: 'faint' });
}

function drawSlab(name, plan, z, height, group = 'structure', detail = '', moving = false) {
  const shape = recorder.solid(A.slab(plan, z, height, { name }));
  recorder.put({
    name,
    piece: moving ? 'press' : group,
    move: moving ? stroke : [0, 0, 0],
    at: [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2],
    group,
    svg: k.solidSvg(k.slabOf(plan, z, height, projection, 8), {
      tone: group === 'base' ? 'lo' : 'mid',
      inner: detail,
    }),
    shapes: [shape],
  });
}

function drawRound(name, x, y, radius, z, height, group, detail = '') {
  const shape = recorder.solid(A.cylinder(x, y, radius, z, height, { name }));
  recorder.put({
    name,
    piece: group,
    move: [0, 0, 0],
    group,
    at: [x, y, z + height / 2],
    svg: k.solidSvg(k.cylinder(x, y, radius, z, height, projection, 48), {
      tone: 'mid',
      inner: detail,
    }),
    shapes: [shape],
  });
}

function fastener(name, x, y, z, group) {
  const detail = k.lineSvg(k.lineOnTop([x - 1.8, y], [x + 1.8, y], z + 0.9, projection), {
    tone: 'mid',
  });
  drawRound(name, x, y, 1.8, z, 0.9, group, detail);
}

function linkage(name, start, end, radius, group) {
  const frame = G.frameAlong([start, 0, 20], [1, 0, 0]);
  recorder.put({
    name,
    piece: group,
    group,
    move: [0, 0, 0],
    at: [(start + end) / 2, 0, 20],
    svg: k.solidSvg(G.disc(0, end - start, radius, frame, projection), { tone: 'mid' }),
    shapes: [recorder.solid(A.disc(frame, 0, end - start, radius, { name }))],
  });
}

function holder(x, group) {
  const mount = { x, y: -10, w: 48, d: 60, r: 4 };
  const body = { x: x + 4, y: -6, w: 40, d: 52, r: 4 };
  drawSlab(`${group}.mount`, mount, 0, 4, group, outline(mount, 4));
  drawSlab(
    `${group}.body`,
    body,
    4,
    28,
    group,
    k.lineSvg(k.sideSeam(body, 24, projection, 8), { tone: 'faint' }),
  );
  drawSlab(`${group}.lid`, body, 32, 3, group, outline(body, 35));
  drawSlab(`${group}.seat`, { x: x + 10, y: 1, w: 28, d: 21, r: 2 }, 35, 2, group);
  const cartridge = { x: x + 14, y: 4, w: 20, d: 15, r: 1 };
  drawSlab(`${group}.share`, cartridge, 37, 4, group, outline(cartridge, 41));
  drawRound(`${group}.collar`, x + 24, 34, 7, 35, 2, group);
  drawRound(
    `${group}.knob`,
    x + 24,
    34,
    5.5,
    37,
    6,
    group,
    k.lineSvg(k.knurl(x + 24, 34, 5.5, 37, 43, 24, projection), { tone: 'lo' }),
  );
  fastener(`${group}.screw-left`, x + 8, 40, 35, group);
  fastener(`${group}.screw-right`, x + 40, 40, 35, group);
}

function provisioning(x, group) {
  const plan = { x, y: -97, w: 34, d: 35, r: 3 };
  drawSlab(
    `${group}.body`,
    plan,
    5,
    25,
    group,
    k.lineSvg(k.sideSeam(plan, 24, projection, 8), { tone: 'faint' }),
  );
  drawSlab(`${group}.lid`, plan, 30, 3, group, outline(plan, 33));
  drawSlab(`${group}.seat`, { x: x + 6, y: -91, w: 22, d: 22, r: 2 }, 33, 2, group);
  drawSlab(`${group}.root-share`, { x: x + 9, y: -88, w: 16, d: 16, r: 1 }, 35, 6, group);
  drawSlab(`${group}.retainer`, { x: x + 9, y: -84, w: 16, d: 3, r: 0.5 }, 41, 2, group);
  fastener(`${group}.screw-left`, x + 3, -66, 33, group);
  fastener(`${group}.screw-right`, x + 31, -66, 33, group);
}

for (const [x, y] of k.corners(base, 22)) {
  drawRound(`stand.foot-${x}-${y}`, x, y, 8, -18, 6, 'base');
}
drawSlab('base.plate', base, -12, 12, 'base', outline(base, 0));
for (const [x, y] of k.corners(base, 11)) {
  fastener(`base.screw-${x}-${y}`, x, y, 0, 'base');
}
drawSlab('derivers.platform', { x: -20, y: -103, w: 130, d: 47, r: 5 }, 0, 5, 'derivers');
provisioning(-8, 'deriver-a');
provisioning(64, 'deriver-b');
holder(-132, 'client');
holder(84, 'worker');
linkage('client.outer-collar', -88, -86, 5, 'client');
linkage('client.linkage', -86, -56, 2.8, 'client');
linkage('client.inner-collar', -56, -54, 5, 'client');
linkage('worker.inner-collar', 54, 56, 5, 'worker');
linkage('worker.linkage', 56, 86, 2.8, 'worker');
linkage('worker.outer-collar', 86, 88, 5, 'worker');

for (const x of [-54, 42]) {
  drawSlab(`press.foot-${x}`, { x: x - 4, y: -15, w: 20, d: 28, r: 3 }, 0, 5);
  drawSlab(`press.column-${x}`, { x, y: -10, w: 12, d: 18, r: 2 }, 5, 98);
  fastener(`press.mount-screw-${x}`, x + 6, 10, 5, 'structure');
}
const crosshead = { x: -58, y: -14, w: 116, d: 26, r: 4 };
drawSlab('press.crosshead', crosshead, 103, 10, 'structure', outline(crosshead, 113));
fastener('press.top-left', -49, -1, 113, 'structure');
fastener('press.top-right', 49, -1, 113, 'structure');
drawRound('press.cylinder', 0, -1, 12, 83, 20, 'structure');

const rodFrame = G.frameAlong([0, -1, 83], [0, 0, -1]);
const rod = G.rodOut(rodFrame, 0, 22, 3.5, projection, { stroke: 38 });
recorder.put({
  name: 'press.rod',
  piece: 'press',
  group: 'press',
  move: stroke,
  at: [0, -1, 72],
  svg: `<clipPath id="rod-clip"><path data-hold d="${rod.clip}"/></clipPath><g clip-path="url(#rod-clip)">${k.solidSvg(rod.paths, { tone: 'hi' })}</g>`,
  shapes: [recorder.solid(A.slide(rodFrame, 0, 22, 3.5, { name: 'press.rod' }))],
});
drawSlab('press.platen', { x: -31, y: -17, w: 62, d: 35, r: 3 }, 55, 6, 'press', '', true);
drawSlab('press.die', { x: -14, y: -12, w: 28, d: 22, r: 2 }, 51, 4, 'press', '', true);
drawSlab('bed', { x: -34, y: -30, w: 68, d: 88, r: 4 }, 0, 10, 'bed');
const sheet = { x: -27, y: -22, w: 54, d: 74, r: 0.8 };
const seal = `<g id="signature-seal" opacity="0">${k.lineSvg(k.ring(0, -1, 8, 13, projection, 48), { tone: 'hi' })}${k.lineSvg(k.ring(0, -1, 6, 13, projection, 48), { tone: 'mid' })}</g>`;
drawSlab('message', sheet, 10, 3, 'message', outline(sheet, 13) + seal);

for (const x of [-36, 28]) {
  drawSlab(`gate.mount-${x}`, { x: x - 3, y: 66, w: 14, d: 18, r: 2 }, 0, 3, 'gateway');
  drawSlab(`gate.post-${x}`, { x, y: 69, w: 8, d: 12, r: 1 }, 3, 25, 'gateway');
  fastener(`gate.screw-${x}`, x + 4, 67.5, 3, 'gateway');
}
drawSlab('gate.crossbar', { x: -36, y: 69, w: 72, d: 12, r: 1 }, 28, 5, 'gateway');
drawSlab('gate.latch', { x: -8, y: 71, w: 16, d: 8, r: 1 }, 33, 3, 'gateway');
drawSlab('pool.tray', { x: 68, y: 65, w: 60, d: 25, r: 3 }, 0, 3, 'pool');
for (let index = 0; index < 3; index += 1) {
  drawSlab(`pool.token-${index}`, { x: 72 + index * 18, y: 69, w: 14, d: 17, r: 1 }, 3, 3, 'pool');
}
drawSlab('pool.terminal', { x: 73, y: 93, w: 48, d: 9, r: 2 }, 0, 3, 'pool');

A.settle(recorder, projection);
function compareDepth(left, right) {
  return left.key - right.key;
}
recorder.items.sort(compareDepth);

function renderItem(item) {
  const move = item.move || [0, 0, 0];
  return `<g class="machine-part" data-name="${item.name}" data-group="${item.group}" data-move="${move.join(',')}" data-key="${item.key}">${item.svg}</g>`;
}

const svg = k.figureSvg({
  width: 860,
  height: 570,
  label:
    'A two-party signing press. Separate client and SigningWorker cartridges drive one press. Two smaller Deriver housings sit behind it. An admission gate sits in front.',
  body: `<path class="iso-halo" d="${k.haloOf(base, -18, 12, projection)}"/><g id="machine">${recorder.items.map(renderItem).join('')}</g>`,
});
const figure = k.plateHtml({
  fig: 'FIG. 01 / SEAMS',
  title: 'The two-party press',
  hint: 'Step through the mechanism',
  readout: 'Provisioning · two roles',
  body: `<div class="iso-stage">${svg}</div>`,
});
const body = readFileSync(join(here, 'page.html'), 'utf8').replace('<!-- FIGURE -->', figure);
const style = readFileSync(join(here, 'style.css'), 'utf8');
const live = readFileSync(join(here, 'live.js'), 'utf8');
const license = readFileSync(join(skill, 'LICENSE'), 'utf8');
const script = `${kitScript()}\nconst PROJECTION = ${JSON.stringify(projection)};\n${live}`;
for (const theme of ['light', 'dark']) {
  const html = k
    .pageHtml({ title: 'How Seams threshold signing works', theme, width: 1100, body, script })
    .replace('</head>', `<style>${style}</style></head>`)
    .replace('<html lang="en">', `<html lang="en"><!-- Anatomy drawing kit: ${license} -->`);
  writeFileSync(join(here, theme === 'light' ? 'index.html' : 'dark.html'), html);
}
console.log(`Built both themes with ${recorder.solids.length} recorded solids.`);
A.auditOrExit(recorder, projection);
