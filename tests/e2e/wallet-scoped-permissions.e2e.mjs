import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const directory = '.artifacts/combination-interlock/ring-dial/';
const origin = process.env.SEAMS_SITE_ORIGIN || 'http://localhost:4001';
const preview = new URL('/dashboard-static/showcase/motion/interlock/', origin).href;
const report = { frames: [], errors: [], views: [], interactions: [] };
const captured = new Set();
const contactDistance = 4.8;
const pinOrbit = 17;

function recordError(error) {
  report.errors.push(error.message);
}

function snapshot() {
  const svg = document.querySelector('#stage svg');
  const bounds = svg.getBBox();
  const rotations = [];
  for (const ring of svg.querySelectorAll('[data-ring]'))
    rotations.push(Number(ring.dataset.rotation));
  return {
    rotations,
    dial: Number(svg.querySelector('[data-part="dial"]').dataset.rotation),
    pin: Number(svg.querySelector('[data-part="locking-pin"]').dataset.drop),
    read: document.querySelector('#read').textContent,
    invalid: /NaN|Infinity/.test(svg.innerHTML),
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    geometry: svg.innerHTML,
  };
}

function pinDistance(first, second) {
  const angle = ((first - second) * Math.PI) / 180;
  return Math.sqrt(2 * pinOrbit * pinOrbit * (1 - Math.cos(angle)));
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${message}: ${actual} versus ${expected}`);
}

function validate(sample) {
  assert.equal(sample.invalid, false);
  const box = sample.bounds;
  assert.ok(box.x > 0 && box.y > 0 && box.x + box.width < 400 && box.y + box.height < 320);
  const [rear, middle, front] = sample.rotations;
  near(sample.dial, front, 'The dial drives the front wheel');
  assert.ok(
    pinDistance(front + 270, middle + 150) >= contactDistance - 0.00001,
    'Front pickup pins do not intersect',
  );
  assert.ok(
    pinDistance(middle + 270, rear + 30) >= contactDistance - 0.00001,
    'Rear pickup pins do not intersect',
  );
  if (sample.pin > 0) {
    for (const rotation of sample.rotations)
      near(Math.sin((rotation * Math.PI) / 360), 0, 'All gates align before the pin descends');
  }
}

function frameRecord(sample, ms) {
  return {
    ms,
    rotations: sample.rotations,
    dial: sample.dial,
    pin: sample.pin,
    read: sample.read,
    invalid: sample.invalid,
    bounds: sample.bounds,
  };
}

function targetPoint(element) {
  const box = element.getBBox();
  const point = new DOMPoint(box.x + box.width * 0.5, box.y + box.height * 0.12);
  const screen = point.matrixTransform(element.getScreenCTM());
  return { x: screen.x, y: screen.y };
}

function highlightState() {
  const svg = document.querySelector('#stage svg');
  const rings = [];
  for (const ring of svg.querySelectorAll('[data-ring]'))
    rings.push(ring.querySelectorAll('.hi').length);
  return { rings, dial: svg.querySelector('[data-part="dial"]').querySelectorAll('.hi').length };
}

async function capture(page, name) {
  await page.locator('#stage').screenshot({ path: `${directory}${name}.png` });
}

await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', recordError);
  await page.clock.install();
  await page.goto(preview);
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.clock.runFor(100);
  const resting = await page.evaluate(snapshot);
  validate(resting);
  assert.deepEqual(resting.rotations, [-135, 105, -165]);
  await capture(page, 'rest');
  await page.locator('#stage').focus();
  await page.keyboard.press('Enter');
  let previous = resting;
  let frontOnly = false;
  let frontAndMiddle = false;
  let allWheels = false;
  let middleReverse = false;
  for (let step = 1; step <= 240; step++) {
    await page.clock.runFor(20);
    const sample = await page.evaluate(snapshot);
    validate(sample);
    const [rear, middle, front] = sample.rotations;
    const rearDelta = rear - previous.rotations[0];
    const middleDelta = middle - previous.rotations[1];
    const frontDelta = front - previous.rotations[2];
    if (
      frontDelta > 0.00001 &&
      Math.abs(middleDelta) < 0.00001 &&
      sample.read === 'picking up middle'
    )
      frontOnly = true;
    if (middleDelta > 0.00001 && Math.abs(rearDelta) < 0.00001) frontAndMiddle = true;
    if (rearDelta > 0.00001) allWheels = true;
    if (middleDelta < -0.00001 && Math.abs(rearDelta) < 0.00001) middleReverse = true;
    if (sample.read === previous.read) {
      if (Math.abs(middleDelta) > 0.00001)
        near(
          pinDistance(front + 270, middle + 150),
          contactDistance,
          'The front pin stays in contact while driving the middle wheel',
        );
      if (Math.abs(rearDelta) > 0.00001)
        near(
          pinDistance(middle + 270, rear + 30),
          contactDistance,
          'The middle pin stays in contact while driving the rear wheel',
        );
    }
    report.frames.push(frameRecord(sample, step * 20));
    if (!captured.has(sample.read)) {
      captured.add(sample.read);
      await capture(page, sample.read.replaceAll(' ', '-'));
    }
    previous = sample;
  }
  assert.ok(
    frontOnly && frontAndMiddle && allWheels && middleReverse,
    'Both pickups and the reverse middle-wheel adjustment must be observed',
  );
  const unlocked = await page.evaluate(snapshot);
  assert.equal(unlocked.read, 'unlocked');
  near(unlocked.rotations[0], 0, 'Rear gate aligned');
  near(unlocked.rotations[1], 360, 'Middle gate aligned');
  near(unlocked.rotations[2], 0, 'Front gate aligned');
  assert.equal(unlocked.pin, 1);
  await page.clock.runFor(300);
  assert.equal(
    (await page.evaluate(snapshot)).geometry,
    unlocked.geometry,
    'Unlocked pose settles',
  );
  await page.keyboard.press('Enter');
  for (let step = 0; step < 30; step++) {
    await page.clock.runFor(20);
    validate(await page.evaluate(snapshot));
  }
  await page.keyboard.press('Enter');
  await page.clock.runFor(4800);
  assert.equal(
    (await page.evaluate(snapshot)).geometry,
    unlocked.geometry,
    'Interrupted reset resumes without a jump',
  );

  for (let index = 0; index < 3; index++) {
    const point = await page.locator(`[data-ring="${index + 1}"]`).evaluate(targetPoint);
    await page.mouse.move(point.x, point.y);
    const accents = await page.evaluate(highlightState);
    assert.equal(accents.rings[index], 1);
    assert.equal(accents.rings.reduce(sum, 0), 1);
    assert.equal(accents.dial, 0);
    report.interactions.push(accents);
  }
  const dialPoint = await page.locator('[data-part="dial"]').evaluate(targetPoint);
  await page.mouse.move(dialPoint.x, dialPoint.y);
  assert.equal((await page.evaluate(highlightState)).dial, 2);
  await page.waitForTimeout(300);
  await capture(page, 'dial-highlight');
  await page.mouse.move(0, 0);
  await page.clock.runFor(4800);
  assert.equal((await page.evaluate(snapshot)).read, 'rest');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#stage').focus();
  await page.keyboard.press('Space');
  await page.clock.runFor(100);
  assert.equal((await page.evaluate(snapshot)).read, 'unlocked');

  const views = await browser.newPage({
    viewport: { width: 1000, height: 900 },
    reducedMotion: 'reduce',
  });
  views.on('pageerror', recordError);
  for (const theme of ['light', 'dark']) {
    for (const intensity of [0, 1]) {
      await views.goto(`${preview}?w=240&theme=${theme}&intensity=${intensity}&at=270,190`);
      await views.locator('#read').filter({ hasText: 'unlocked' }).waitFor();
      const sample = await views.evaluate(snapshot);
      validate(sample);
      report.views.push({ theme, intensity, bounds: sample.bounds });
      await capture(views, `${theme}-${intensity}`);
    }
  }
  let cards = '';
  const names = [
    'rest',
    'picking-up-middle',
    'picking-up-rear',
    'aligning-rear',
    'aligning-middle',
    'aligning-front',
    'pin-dropping',
    'unlocked',
  ];
  for (const name of names) {
    const data = await readFile(`${directory}${name}.png`);
    cards += `<figure><figcaption>${name.replaceAll('-', ' ')}</figcaption><img src="data:image/png;base64,${data.toString('base64')}"></figure>`;
  }
  const sheet = await browser.newPage({ viewport: { width: 1280, height: 1580 } });
  await sheet.setContent(
    `<html><style>body{margin:20px;background:#eee;font:14px monospace;display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#fff;padding:12px}figcaption{margin-bottom:8px}img{display:block;width:100%;height:320px;object-fit:contain}</style>${cards}</html>`,
  );
  await sheet.screenshot({ path: `${directory}contact-sheet.png`, fullPage: true });
  assert.deepEqual(report.errors, []);
  report.passed = true;
  await writeFile(`${directory}review.json`, JSON.stringify(report, null, 2));
  console.log(
    'Passed coupled pickups, pin clearance, reverse dialing, gate alignment, pin drop, interruption, hover, keyboard, reduced motion, themes, and bounds.',
  );
} finally {
  await browser.close();
}

function sum(total, value) {
  return total + value;
}
