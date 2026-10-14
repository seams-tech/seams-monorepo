import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const directory = '.artifacts/threshold-signing/policy-stack';
const origin = process.env.SEAMS_SITE_ORIGIN || 'http://localhost:4001';
const preview = `${origin}/dashboard-static/showcase/motion/threshold-signing/`;
const report = { frames: [], views: [], errors: [] };

function recordError(error) {
  report.errors.push(error.message);
}

function snapshot() {
  const svg = document.querySelector('#stage svg');
  const bounds = svg.getBBox();
  const viewBox = svg.viewBox.baseVal;
  const signals = [];
  for (const name of ['device', 'infrastructure', 'transaction']) {
    const signal = svg.querySelector(`[data-route="${name}"] [data-part="signal"]`);
    signals.push(Number(signal.dataset.progress));
  }
  const checks = [];
  const layers = [];
  for (const card of svg.querySelectorAll('[data-policy]')) {
    checks.push(Number(card.querySelector('[data-part="check"]').dataset.progress));
    layers.push(Number(card.dataset.lift));
  }
  const tiles = [];
  for (const tile of svg.querySelectorAll('[data-part="share-tile"]'))
    tiles.push(Number(tile.dataset.lift));
  return {
    phase: document.querySelector('#read').textContent,
    signals,
    checks,
    layers,
    tiles,
    signature: Number(svg.querySelector('[data-part="signature"]').dataset.progress),
    resultLift: Number(svg.querySelector('[data-part="transaction-tile"]').dataset.lift),
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    viewBox: { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height },
    markup: svg.innerHTML,
  };
}

function validate(sample) {
  assert.equal(sample.checks.length, 3);
  for (let index = 0; index < sample.checks.length; index++) {
    if (sample.checks[index] === 0) continue;
    assert.deepEqual(
      sample.signals.slice(0, 2),
      [1, 1],
      'Both shares arrive before policy approval',
    );
    for (let earlier = 0; earlier < index; earlier++)
      assert.equal(sample.checks[earlier], 1, 'Policies approve in order');
  }
  if (sample.signals[2] > 0) assert.deepEqual(sample.checks, [1, 1, 1]);
  if (sample.signature > 0) assert.equal(sample.signals[2], 1);
  const b = sample.bounds;
  const v = sample.viewBox;
  assert.ok(
    b.x >= v.x && b.y >= v.y && b.x + b.width <= v.x + v.width && b.y + b.height <= v.y + v.height,
    'Raised plates and labels fit the viewport',
  );
  assert.equal(/NaN|Infinity/.test(sample.markup), false);
}

function visibleChecks() {
  const visibility = [];
  for (const check of document.querySelectorAll('[data-part="check"]')) {
    const card = check.closest('[data-policy]');
    for (const fraction of [0.2, 0.5, 0.8]) {
      const point = check.getPointAtLength(check.getTotalLength() * fraction);
      const screen = point.matrixTransform(check.getScreenCTM());
      visibility.push(
        document.elementFromPoint(screen.x, screen.y)?.closest('[data-policy]') === card,
      );
    }
  }
  return visibility;
}

function frameRecord(sample, ms) {
  return {
    ms,
    phase: sample.phase,
    signals: sample.signals,
    checks: sample.checks,
    layers: sample.layers,
    tiles: sample.tiles,
    signature: sample.signature,
  };
}

await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', recordError);
  await page.clock.install();
  await page.goto(preview);
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.clock.runFor(100);
  const resting = await page.evaluate(snapshot);
  validate(resting);
  assert.deepEqual(resting.tiles, [2.6, 2.6]);
  await page.locator('#stage').screenshot({ path: `${directory}/rest.png` });
  await page.locator('#stage').hover();
  const captured = new Set();
  const partialChecks = new Set();
  let independentArrival = false;
  for (let step = 1; step <= 150; step++) {
    await page.clock.runFor(20);
    const sample = await page.evaluate(snapshot);
    validate(sample);
    if (sample.signals[0] === 1 && sample.signals[1] < 1) independentArrival = true;
    for (let index = 0; index < 3; index++) {
      if (sample.checks[index] > 0 && sample.checks[index] < 1) partialChecks.add(index);
    }
    if (!captured.has(sample.phase)) {
      captured.add(sample.phase);
      await page
        .locator('#stage')
        .screenshot({ path: `${directory}/${sample.phase.replaceAll(' ', '-')}.png` });
    }
    report.frames.push(frameRecord(sample, step * 20));
  }
  const signed = await page.evaluate(snapshot);
  assert.equal(signed.phase, 'signed');
  assert.deepEqual(signed.checks, [1, 1, 1]);
  assert.ok(independentArrival);
  assert.equal(partialChecks.size, 3, 'Every policy tick traces progressively');
  assert.ok(signed.tiles[0] > resting.tiles[0] && signed.tiles[1] > resting.tiles[1]);
  assert.ok(signed.layers[2] - signed.layers[1] > resting.layers[2] - resting.layers[1]);
  assert.ok(signed.resultLift > resting.resultLift);
  assert.ok(
    (await page.evaluate(visibleChecks)).every(Boolean),
    'All three checked faces remain visible',
  );
  await page.clock.runFor(300);
  assert.equal((await page.evaluate(snapshot)).markup, signed.markup, 'Settled figures sleep');
  await page.mouse.move(0, 0);
  for (let step = 0; step < 55; step++) {
    await page.clock.runFor(20);
    validate(await page.evaluate(snapshot));
  }
  await page.locator('#stage').hover();
  await page.clock.runFor(3000);
  assert.equal((await page.evaluate(snapshot)).markup, signed.markup);
  await page.mouse.move(0, 0);
  await page.clock.runFor(3000);
  assert.equal((await page.evaluate(snapshot)).markup, resting.markup);
  await page.locator('#stage').focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(3000);
  assert.equal((await page.evaluate(snapshot)).signature, 1);
  await page.keyboard.press('Space');
  await page.clock.runFor(3000);
  assert.equal((await page.evaluate(snapshot)).signature, 0);

  const compact = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    reducedMotion: 'reduce',
  });
  compact.on('pageerror', recordError);
  for (const theme of ['light', 'dark']) {
    for (const intensity of [0, 1]) {
      await compact.goto(`${preview}?w=240&theme=${theme}&intensity=${intensity}&at=200,150`);
      await compact.locator('[data-part="signature"][data-progress="1"]').waitFor();
      const sample = await compact.evaluate(snapshot);
      validate(sample);
      report.views.push({ theme, intensity, bounds: sample.bounds });
      await compact
        .locator('#stage')
        .screenshot({ path: `${directory}/${theme}-${intensity}.png` });
    }
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${directory}/review.json`, JSON.stringify({ passed: true, ...report }, null, 2));
  console.log(
    'Passed raised tiles, three sequential policy approvals, visible checks, share arrival order, signature, interrupted reversal, keyboard, reduced motion, themes, and bounds.',
  );
} finally {
  await browser.close();
}
