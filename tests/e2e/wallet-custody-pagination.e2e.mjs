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
  const animation = element.getAnimations()[0];
  animation.currentTime = animation.effect.getComputedTiming().duration - 100;
}

function activeBullet() {
  return document.querySelector('#wallet-security .h2-security__item.is-active h3')?.textContent;
}

function bulletIsActive(name) {
  const bullet = document.querySelector('#wallet-security .h2-security__item.is-active h3');
  return bullet?.textContent === name;
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

  // Start a fresh features view, so a slow page load cannot use up the first turn.
  const nextView = section.getByRole('button', { name: 'Next custody view' });
  if ((await section.getAttribute('data-view')) === 'features') await nextView.click();
  await nextView.click();
  await page.evaluate(clearFocus);
  await page.mouse.move(0, 0);

  // Each capability's figure plays in turn, with its bullet and label lit.
  assert.equal(await page.evaluate(activeBullet), 'Non-custodial');
  assert.equal(
    await section.locator('.h2-security__cell.is-active span').textContent(),
    'Keys you control',
  );
  const keychain = page.frameLocator('iframe[data-figure="keychain"]').locator('#read');
  await keychain.filter({ hasText: /^key 0/ }).waitFor({ timeout: 3000 });

  // Observe a complete real timer turn, including the progress-line movement.
  const initial = await progress.evaluate(progressState);
  await page.waitForTimeout(400);
  const advancing = await progress.evaluate(progressState);
  assert.ok(advancing.time > initial.time);
  assert.notEqual(advancing.transform, initial.transform);
  await page.waitForFunction(bulletIsActive, 'Permissions', { timeout: 4500 });
  assert.ok((await progress.evaluate(progressState)).time < 1500, 'Each figure starts a new timer');
  const interlock = page.frameLocator('iframe[data-figure="interlock"]').locator('#read');
  await interlock.filter({ hasText: /picking|aligning|pin|unlocked/ }).waitFor({ timeout: 2000 });
  await keychain.filter({ hasText: /^rest$/ }).waitFor({ timeout: 2000 });
  for (const bullet of ['Multiple devices', 'Self-hosted']) {
    await progress.evaluate(approachCompletion);
    await page.waitForFunction(bulletIsActive, bullet, { timeout: 2000 });
  }
  await progress.evaluate(approachCompletion);
  await page.locator('#wallet-security[data-view="signing"]').waitFor({ timeout: 2000 });
  assert.ok((await progress.evaluate(progressState)).time < 1500, 'Each view starts a new timer');
  assert.equal(await page.evaluate(activeBullet), undefined, 'The signing view lights no bullet');
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

  // Hovering a figure hands it the turn and holds the timer.
  await section.locator('iframe[data-figure="devices"]').hover();
  await page.waitForFunction(bulletIsActive, 'Multiple devices', { timeout: 1000 });
  const hovered = await progress.evaluate(progressState);
  assert.equal(hovered.state, 'paused');
  await page.waitForTimeout(300);
  assert.equal((await progress.evaluate(progressState)).time, hovered.time);
  await section.screenshot({ path: `${artifacts}/desktop-features.png` });
  await page.mouse.move(0, 0);
  await page.locator('#wallet-security[data-paused="false"]').waitFor({ timeout: 1000 });
  assert.equal(
    (await progress.evaluate(progressState)).state,
    'running',
    'Leaving resumes the turn',
  );

  // Reduced motion disables timed changes; keyboard pagination still works on mobile.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  assert.equal((await progress.evaluate(progressState)).state, 'none');
  assert.equal(await page.evaluate(activeBullet), undefined, 'Reduced motion lights no bullet');
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
        figureTurns: true,
        hoverTurn: true,
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
    'Passed figure turns, timed cycling, progress, arrows, hover turns, interaction pause, persistent pause, reduced motion, and mobile keyboard navigation.',
  );
} finally {
  await browser.close();
}
