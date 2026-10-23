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
  await selected(section, 'Europe');
  const europe = await settledImage(canvas);

  // Interrupt a region transition, then finish on a different continent.
  await section.getByRole('button', { name: 'APAC', exact: true }).click();
  await section.getByRole('button', { name: 'US', exact: true }).click();
  await selected(section, 'US');
  const us = await settledImage(canvas);
  assert.notEqual(us, europe, 'Region selection must rotate the rendered globe');

  // Drag outside the canvas to exercise pointer capture and release.
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 20, bounds.y + bounds.height / 2, { steps: 10 });
  await page.mouse.up();
  const dragged = await settledImage(canvas);
  assert.notEqual(dragged, us);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  assert.equal(await canvas.evaluate(canvasImage), dragged, 'Released drag must stop rotating');

  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await canvas.evaluate(canvasImage), dragged);
  await section.getByRole('button', { name: 'Europe', exact: true }).focus();
  await page.keyboard.press('Enter');
  await selected(section, 'Europe');
  await section.screenshot({ path: `${artifacts}/desktop-europe.png` });

  // Reduced motion must render the destination immediately and remain still.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await section.getByRole('button', { name: 'APAC', exact: true }).click();
  await selected(section, 'APAC');
  const reduced = await canvas.evaluate(canvasImage);
  assert.equal(await settledImage(canvas), reduced);

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
          'interrupted rotation',
          'drag capture and release',
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
