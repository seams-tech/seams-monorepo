import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = process.env.SEAMS_SITE_ORIGIN || 'http://localhost:4001';
const artifacts = '.artifacts/wallet-custody-pagination';

function progressState(element) {
  const animation = element.getAnimations()[0];
  return {
    time: animation?.currentTime ?? 0,
    state: animation?.playState ?? 'none',
    transform: getComputedStyle(element).transform,
  };
}

function signingLabelsArePlaced() {
  const svg = document.querySelector('#stage svg');
  const keys = svg.querySelectorAll('[data-part="key"]');
  const shapes = [
    keys[0].parentElement,
    keys[1].parentElement,
    svg.querySelector('[data-part="check"]').parentElement,
    svg.querySelector('[data-part="signature"]').parentElement,
  ];
  const labels = svg.querySelectorAll('text');
  for (let index = 0; index < shapes.length; index++) {
    const shape = shapes[index].getBBox();
    const y = Number(labels[index].getAttribute('y'));
    if (index < 2 && y >= shape.y) return false;
    if (index >= 2 && y <= shape.y + shape.height) return false;
    const box = labels[index].getBoundingClientRect();
    if (box.top < 0 || box.left < 0 || box.bottom > innerHeight || box.right > innerWidth)
      return false;
  }
  return true;
}

function approachCompletion(element) {
  element.getAnimations()[0].currentTime = 5900;
}

function clearFocus() {
  document.activeElement?.blur();
}

function hasOverflow() {
  return document.documentElement.scrollWidth > innerWidth;
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
  });
  await page.goto(`${origin}/wallet`);
  const section = page.locator('#wallet-security');
  const progress = section.locator('.h2-security__progress-fill');
  await section.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await section.locator('iframe[data-figure="keychain"]').waitFor();
  assert.equal(await section.getByRole('button', { name: 'Wallet capabilities' }).count(), 0);
  assert.equal(await section.getByRole('button', { name: 'How signing works' }).count(), 0);

  // Observe a complete real timer cycle, including the progress-line movement.
  const initial = await progress.evaluate(progressState);
  await page.waitForTimeout(400);
  const advancing = await progress.evaluate(progressState);
  assert.ok(advancing.time > initial.time);
  assert.notEqual(advancing.transform, initial.transform);
  await page.locator('#wallet-security[data-view="signing"]').waitFor({ timeout: 7000 });
  assert.ok((await progress.evaluate(progressState)).time < 1500, 'Each view starts a new timer');
  assert.equal(await section.locator('.h2-pager__dot.is-active').count(), 1);
  const firstSigning = page.frameLocator('iframe[data-figure="signing"]');
  await firstSigning.locator('#stage svg text').first().waitFor();
  assert.equal(
    await firstSigning.locator('#stage').evaluate(signingLabelsArePlaced),
    true,
    'All labels match their shapes on first reveal',
  );
  await section.screenshot({ path: `${artifacts}/desktop-signing.png` });

  // Both arrows wrap around the two views and restart their progress.
  await section.getByRole('button', { name: 'Previous custody view' }).click();
  assert.equal(await section.getAttribute('data-view'), 'features');
  await section.getByRole('button', { name: 'Next custody view' }).click();
  assert.equal(await section.getAttribute('data-view'), 'signing');
  assert.ok((await progress.evaluate(progressState)).time < 300);

  // Focus inside an interactive illustration must prevent a timer-driven unmount.
  const signing = page.frameLocator('iframe[data-figure="signing"]');
  await signing.locator('#stage').focus();
  await page.keyboard.press('Enter');
  await signing.locator('#read').filter({ hasText: 'signed' }).waitFor();
  const focused = await progress.evaluate(progressState);
  assert.equal(focused.state, 'paused');
  await page.waitForTimeout(300);
  assert.equal((await progress.evaluate(progressState)).time, focused.time);

  // The dot pill provides a persistent pause, even after focus leaves the section.
  await section.getByRole('button', { name: 'Pause automatic cycling' }).click();
  await page.evaluate(clearFocus);
  await page.mouse.move(0, 0);
  assert.equal((await progress.evaluate(progressState)).state, 'paused');
  await section.getByRole('button', { name: 'Resume automatic cycling' }).click();
  await page.waitForTimeout(50);
  assert.equal(
    (await progress.evaluate(progressState)).state,
    'running',
    'Resume starts the timer while the control retains focus',
  );
  await page.evaluate(clearFocus);
  await page.mouse.move(0, 0);
  await progress.evaluate(approachCompletion);
  await page.locator('#wallet-security[data-view="features"]').waitFor();

  const figures = section.locator('.h2-security__visuals');
  await figures.hover();
  const hovered = await progress.evaluate(progressState);
  assert.equal(hovered.state, 'paused');
  await page.waitForTimeout(300);
  assert.equal((await progress.evaluate(progressState)).time, hovered.time);
  await section.screenshot({ path: `${artifacts}/desktop-features.png` });

  // Reduced motion disables timed changes; keyboard pagination still works on mobile.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  assert.equal((await progress.evaluate(progressState)).state, 'none');
  await page.waitForTimeout(6200);
  assert.equal(await section.getAttribute('data-view'), 'features');
  assert.equal(await page.evaluate(hasOverflow), false);
  await section.getByRole('button', { name: 'Next custody view' }).focus();
  const featuresHeight = (await section.boundingBox()).height;
  await page.keyboard.press('Enter');
  assert.equal(await section.getAttribute('data-view'), 'signing');
  assert.equal(await section.locator('iframe:visible').count(), 1);
  assert.equal(
    (await section.boundingBox()).height,
    featuresHeight,
    'Pagination must not shift the mobile layout',
  );
  await signing.locator('#stage svg text').first().waitFor();
  assert.equal(
    await signing.locator('#stage').evaluate(signingLabelsArePlaced),
    true,
    'Labels remain placed after cycling and mobile resize',
  );
  await section.screenshot({ path: `${artifacts}/mobile-signing.png` });
  await page.keyboard.press('Enter');
  assert.equal(await section.getAttribute('data-view'), 'features');
  await section.screenshot({ path: `${artifacts}/mobile-features.png` });
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        timedCycle: true,
        progressRestart: true,
        arrowWraparound: true,
        interactionPause: true,
        persistentPause: true,
        reducedMotion: true,
        mobileKeyboardNavigation: true,
        mobileOverflow: false,
        stableMobileHeight: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed timed cycling, progress, arrows, interaction pause, persistent pause, reduced motion, and mobile keyboard navigation.',
  );
} finally {
  await browser.close();
}
