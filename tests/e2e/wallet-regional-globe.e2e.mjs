import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Run against the wallet marketing server, including its configured asset base.
const origin = process.env.WALLET_MARKETING_ORIGIN || 'http://127.0.0.1:4008/wallet-static/';
const artifacts = 'output/playwright/wallet-regional-globe';

function canvasImage(canvas) {
  return canvas.toDataURL();
}

function hasOverflow() {
  return document.documentElement.scrollWidth > innerWidth;
}

function followsAnimations(section) {
  const animations = document.querySelector('#wallet-security');
  return Boolean(
    animations && animations.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

async function selected(section, name) {
  const button = section.getByRole('button', { name, exact: true });
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  assert.equal(await section.locator('button[aria-pressed="true"]').count(), 1);
}

async function settledImage(canvas) {
  let previous = await canvas.evaluate(canvasImage);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await canvas.page().waitForTimeout(100);
    const current = await canvas.evaluate(canvasImage);
    if (current === previous) return current;
    previous = current;
  }
  throw new Error('Globe did not settle within three seconds');
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(origin);
  const section = page.locator('.wallet-regions');
  const canvas = section.getByRole('img');
  await section.scrollIntoViewIfNeeded();
  assert.equal(await section.evaluate(followsAnimations), true);
  await selected(section, 'APAC');
  const initial = await canvas.evaluate(canvasImage);
  await page.waitForTimeout(350);
  assert.notEqual(await canvas.evaluate(canvasImage), initial, 'Globe must rotate automatically');

  // Interrupt a region transition, then finish on a different continent.
  await section.getByRole('button', { name: 'Europe', exact: true }).click();
  await section.getByRole('button', { name: 'US', exact: true }).click();
  await selected(section, 'US');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const us = await settledImage(canvas);
  assert.notEqual(us, initial, 'Region selection must rotate the rendered globe');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Drag outside the canvas to exercise pointer capture and release.
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  const held = await canvas.evaluate(canvasImage);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 70, {
    steps: 10,
  });
  assert.equal(
    await canvas.evaluate(canvasImage),
    held,
    'Vertical dragging must not tilt the globe',
  );
  await page.mouse.move(bounds.x - 20, bounds.y + bounds.height / 2, { steps: 10 });
  const dragged = await canvas.evaluate(canvasImage);
  assert.notEqual(dragged, held, 'Horizontal dragging must rotate the globe');
  await page.mouse.up();
  await page.waitForTimeout(350);
  assert.notEqual(
    await canvas.evaluate(canvasImage),
    dragged,
    'Automatic rotation must resume after dragging',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const paused = await settledImage(canvas);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  assert.equal(
    await canvas.evaluate(canvasImage),
    paused,
    'Reduced motion must disable automatic rotation',
  );

  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await canvas.evaluate(canvasImage), paused);
  await section.getByRole('button', { name: 'APAC', exact: true }).focus();
  await page.keyboard.press('Enter');
  await selected(section, 'APAC');
  await section.screenshot({ path: `${artifacts}/desktop-apac.png` });

  // Reduced motion must render the destination immediately and remain still.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await section.getByRole('button', { name: 'Europe', exact: true }).click();
  await selected(section, 'Europe');
  const reduced = await canvas.evaluate(canvasImage);
  assert.equal(await settledImage(canvas), reduced);
  await section.getByRole('button', { name: 'APAC', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(hasOverflow), false);
  await section.screenshot({ path: `${artifacts}/mobile-apac.png` });

  await page.goto(new URL('ja/', origin).href);
  await section.scrollIntoViewIfNeeded();
  await section.getByRole('button', { name: 'アジア太平洋', exact: true }).click();
  await selected(section, 'アジア太平洋');
  assert.equal(await page.evaluate(hasOverflow), false);
  await section.screenshot({ path: `${artifacts}/mobile-japanese.png` });
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        origin,
        placement: 'after security animations',
        checked: [
          'APAC default',
          'automatic rotation',
          'interrupted rotation',
          'longitude-only dragging',
          'automatic rotation resumes after release',
          'keyboard rotation',
          'keyboard region selection',
          'reduced motion',
          'mobile layout',
          'Japanese layout',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`Regional globe E2E passed. Evidence: ${artifacts}`);
} finally {
  await browser.close();
}
