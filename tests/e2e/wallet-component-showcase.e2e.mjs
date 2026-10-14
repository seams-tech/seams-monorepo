import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet';
const artifacts = '.artifacts/wallet-component-showcase';
const errors = [];
const views = [
  ['Authentication', 'Create wallet', 'Create your wallet'],
  ['Authentication', 'Unlock', 'Welcome back'],
  ['Authentication', 'Recovery', 'Recover your wallet'],
  ['Transactions', 'Transfer', 'Review your transfer'],
  ['Transactions', 'Contract call', 'Review contract call'],
  ['Transactions', 'Receipt', 'Transfer confirmed'],
  ['Checkout', 'Payment', 'Make it yours.'],
  ['Checkout', 'Payment method', 'Choose how to pay'],
  ['Checkout', 'Confirmation', 'Payment complete'],
  ['Account', 'Profile', 'At home, everywhere.'],
  ['Account', 'Devices', 'Your connected devices'],
  ['Account', 'Security', 'Keep your wallet yours'],
];

function recordError(error) {
  errors.push(error.message);
}

function getLayout(gallery) {
  const viewport = gallery.querySelector('.component-showcase__viewport').getBoundingClientRect();
  const active = gallery.querySelector('[data-active="true"]');
  const card = active.getBoundingClientRect();
  const rail = gallery.querySelector('.component-showcase__rail').getBoundingClientRect();
  const world = gallery.querySelector('.component-showcase__world');
  const inactive = gallery.querySelectorAll(
    '.component-showcase__position:not([data-active="true"])',
  );
  let inactiveInert = true;
  for (const element of inactive) inactiveInert = inactiveInert && element.inert;
  return {
    component: active.querySelector('article').dataset.preview,
    cardFits:
      card.left >= viewport.left &&
      card.right <= viewport.right &&
      card.top >= viewport.top &&
      card.bottom <= viewport.bottom,
    railFits: rail.left >= 0 && rail.right <= innerWidth,
    pageFits: document.documentElement.scrollWidth <= innerWidth,
    inactiveInert,
    activeInteractive: !active.inert,
    movementDuration: getComputedStyle(world).transitionDuration,
    activeOpacity: getComputedStyle(active).opacity,
  };
}

function assertLayout(layout) {
  assert.equal(layout.cardFits, true, `${layout.component} fits the canvas`);
  assert.equal(layout.railFits, true, 'The component rail fits the screen');
  assert.equal(layout.pageFits, true, 'The page has no horizontal overflow');
  assert.equal(layout.inactiveInert, true, 'Background previews cannot receive focus');
  assert.equal(layout.activeInteractive, true, 'The selected preview accepts input');
}

async function settle(gallery) {
  await expect(gallery.locator('[data-active="true"]')).toHaveCSS('opacity', '1');
  await gallery.evaluate(finishSceneMovement);
}

async function finishSceneMovement(gallery) {
  const world = gallery.querySelector('.component-showcase__world');
  const animations = world.getAnimations();
  for (const animation of animations) await animation.finished;
}

async function capture(gallery, name) {
  await settle(gallery);
  assertLayout(await gallery.evaluate(getLayout));
  await gallery.screenshot({ path: `${artifacts}/${name}.png` });
}

function cursorFrame(gallery, phase) {
  const cursor = gallery.querySelector('[data-active="true"] .showcase-preview__cursor');
  for (const animation of cursor.getAnimations({ subtree: true })) {
    const timing = animation.effect.getTiming();
    animation.pause();
    animation.currentTime = timing.delay + Number(timing.duration) * phase;
  }
  const pointer = cursor.querySelector('.showcase-preview__cursor-motion').getBoundingClientRect();
  const action = cursor.closest('button').getBoundingClientRect();
  return {
    belowAction: pointer.top > action.bottom,
    onAction:
      pointer.left >= action.left &&
      pointer.left < action.right &&
      pointer.top >= action.top &&
      pointer.top < action.bottom,
  };
}

function resumeCursor(gallery) {
  const cursor = gallery.querySelector('[data-active="true"] .showcase-preview__cursor');
  for (const animation of cursor.getAnimations({ subtree: true })) animation.play();
}

function canvasPosition(gallery) {
  const matrix = new DOMMatrixReadOnly(
    getComputedStyle(gallery.querySelector('.component-showcase__world')).transform,
  );
  return { x: matrix.e, y: matrix.f };
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.tracing.start({ screenshots: true, snapshots: true });

try {
  const page = await context.newPage();
  page.on('pageerror', recordError);
  await page.goto(origin);
  const gallery = page.getByRole('region', { name: 'Wallet component showcase' });
  await gallery.scrollIntoViewIfNeeded();
  const cursor = gallery.locator('[data-active="true"] .showcase-preview__cursor');
  const cursorMotion = cursor.locator('.showcase-preview__cursor-motion');
  await expect(cursorMotion).toHaveCSS('animation-play-state', 'running');
  await gallery.getByRole('button', { name: 'Create with passkey', exact: true }).hover();
  await expect(cursor).toHaveCSS('opacity', '0');
  await expect(cursorMotion).toHaveCSS('animation-play-state', 'paused');
  await page.mouse.move(10, 10);
  await expect(cursorMotion).toHaveCSS('animation-play-state', 'running');
  assert.equal((await gallery.evaluate(cursorFrame, 0.12)).belowAction, true);
  assert.equal((await gallery.evaluate(cursorFrame, 0.9)).onAction, true);
  await gallery.screenshot({ path: `${artifacts}/desktop-cursor-click.png` });
  await gallery.evaluate(resumeCursor);
  await expect(gallery.getByRole('heading', { name: 'Wallet created', exact: true })).toBeVisible();
  await expect(gallery.getByRole('button', { name: 'Back to preview' })).not.toBeFocused();
  await gallery.getByRole('button', { name: 'Pause demo' }).click();
  await expect(gallery.locator('.showcase-preview__result[data-source="demo"]')).toHaveCSS(
    'animation-play-state',
    'paused',
  );
  await page.waitForTimeout(2800);
  await expect(gallery.getByRole('heading', { name: 'Wallet created', exact: true })).toBeVisible();
  await gallery.screenshot({ path: `${artifacts}/desktop-autoplay-result.png` });
  await gallery.getByRole('button', { name: 'Play demo' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    gallery.getByRole('heading', { name: 'Create your wallet', exact: true }),
  ).toBeVisible();
  await expect(gallery.getByRole('heading', { name: 'Wallet created', exact: true })).toBeVisible({
    timeout: 8000,
  });
  await gallery.getByRole('button', { name: 'Pause demo' }).click();
  await gallery.getByRole('radio', { name: 'Unlock', exact: true }).check();
  await gallery.getByRole('radio', { name: 'Create wallet', exact: true }).check();
  await capture(gallery, 'desktop-authentication');

  // Native radio navigation must keep both levels of selection synchronized.
  const authentication = gallery.getByRole('radio', { name: 'Authentication', exact: true });
  await authentication.focus();
  await page.keyboard.press('Tab');
  await expect(
    gallery.getByRole('button', { name: 'Create with passkey', exact: true }),
  ).toBeFocused();
  await expect(cursor).toHaveCSS('opacity', '0');
  await expect(cursorMotion).toHaveCSS('animation-play-state', 'paused');
  await authentication.focus();
  await page.keyboard.press('ArrowRight');
  await expect(gallery.getByRole('radio', { name: 'Transactions', exact: true })).toBeChecked();
  const transfer = gallery.getByRole('radio', { name: 'Transfer', exact: true });
  await transfer.focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    gallery.getByRole('heading', { name: 'Review contract call', exact: true }),
  ).toBeVisible();
  assert.equal((await gallery.evaluate(getLayout)).movementDuration, '0s');
  await gallery.getByRole('button', { name: 'Approve contract call', exact: true }).click();
  await expect(gallery.getByRole('status')).toContainText('No transaction was signed or sent.');
  await page.waitForTimeout(2800);
  await expect(gallery.getByRole('status')).toContainText('No transaction was signed or sent.');
  await expect(gallery.getByRole('button', { name: 'Back to preview' })).toBeFocused();
  await capture(gallery, 'desktop-contract-result');
  await page.keyboard.press('Enter');
  await expect(
    gallery.getByRole('button', { name: 'Approve contract call', exact: true }),
  ).toBeFocused();
  await expect(
    gallery.getByRole('link', { name: 'Explore transaction components' }),
  ).toHaveAttribute('href', /\/showcase\/transaction\/$/);

  const beforeCategory = await gallery.evaluate(canvasPosition);

  // Interrupt the moving scene several times; the last choice owns both rails and the active card.
  for (const category of ['Account', 'Checkout', 'Authentication', 'Transactions']) {
    await gallery.getByRole('radio', { name: category, exact: true }).check();
  }
  await settle(gallery);
  const afterCategory = await gallery.evaluate(canvasPosition);
  assert.notEqual(beforeCategory.x, afterCategory.x, 'Category movement changes x');
  assert.notEqual(beforeCategory.y, afterCategory.y, 'Category movement changes y');
  await gallery.getByRole('radio', { name: 'Receipt', exact: true }).check();
  await expect(
    gallery.getByRole('heading', { name: 'Transfer confirmed', exact: true }),
  ).toBeVisible();
  await capture(gallery, 'desktop-receipt');
  const afterComponent = await gallery.evaluate(canvasPosition);
  assert.notEqual(afterCategory.x, afterComponent.x, 'Rail movement changes x');
  assert.notEqual(afterCategory.y, afterComponent.y, 'Rail movement changes y');
  await expect(cursor).toHaveCount(0);

  await gallery.getByRole('radio', { name: 'Checkout', exact: true }).check();
  await gallery.getByRole('combobox', { name: 'Pay with' }).selectOption('ethereum');
  await gallery.getByRole('button', { name: 'Pay $24.00', exact: true }).click();
  await expect(gallery.getByRole('status')).toContainText('No payment was made.');
  await gallery.getByRole('radio', { name: 'Payment method', exact: true }).check();
  await gallery.getByRole('radio', { name: 'Payment', exact: true }).check();
  await expect(gallery.getByRole('button', { name: 'Pay $24.00', exact: true })).toBeVisible();
  await capture(gallery, 'desktop-checkout');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(cursor).toBeHidden();
  const checked = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [category, component, title] of views) {
      await gallery.getByRole('radio', { name: category, exact: true }).check();
      await gallery.getByRole('radio', { name: component, exact: true }).check();
      await expect(gallery.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await settle(gallery);
      const layout = await gallery.evaluate(getLayout);
      assertLayout(layout);
      assert.equal(layout.movementDuration, '0s');
      checked.push({ width, category, component, ...layout });
    }
    await capture(gallery, `mobile-${width}-security`);
    await gallery.getByRole('radio', { name: 'Checkout', exact: true }).check();
    await capture(gallery, `mobile-${width}-checkout`);
  }
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 1000 },
    isMobile: true,
    hasTouch: true,
  });
  const touchPage = await touchContext.newPage();
  touchPage.on('pageerror', recordError);
  await touchPage.goto(origin);
  const touchGallery = touchPage.getByRole('region', { name: 'Wallet component showcase' });
  await touchGallery.scrollIntoViewIfNeeded();
  await expect(touchGallery.locator('[data-active="true"] .showcase-preview__cursor')).toBeHidden();
  await touchGallery.getByRole('radio', { name: 'Checkout', exact: true }).tap();
  await touchGallery.getByRole('button', { name: 'Pay $24.00', exact: true }).tap();
  await expect(touchGallery.getByRole('status')).toContainText('No payment was made.');
  await capture(touchGallery, 'touch-payment-result');
  await touchContext.close();
  assert.deepEqual(errors, []);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        cursor: 'action, result, pause, reset, replay, keyboard, reduced motion, touch',
        diagonalMovement: true,
        checked,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed automatic action/reset/replay, pause, diagonal navigation, manual actions, keyboard access, and 24 mobile views.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
