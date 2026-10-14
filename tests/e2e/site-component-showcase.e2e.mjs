import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_SITE_ORIGIN || 'http://127.0.0.1:4004';
const artifacts = '.artifacts/component-showcase';
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
  await gallery.screenshot({ path: `${artifacts}/${name}.png`, animations: 'disabled' });
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
  await capture(gallery, 'desktop-authentication');

  // Native radio navigation must keep both levels of selection synchronized.
  const authentication = gallery.getByRole('radio', { name: 'Authentication', exact: true });
  await authentication.focus();
  await page.keyboard.press('Tab');
  await expect(
    gallery.getByRole('button', { name: 'Create with passkey', exact: true }),
  ).toBeFocused();
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
  await expect(gallery.getByRole('button', { name: 'Back to preview' })).toBeFocused();
  await capture(gallery, 'desktop-contract-result');
  await page.keyboard.press('Enter');
  await expect(
    gallery.getByRole('button', { name: 'Approve contract call', exact: true }),
  ).toBeFocused();
  await expect(
    gallery.getByRole('link', { name: 'Explore transaction components' }),
  ).toHaveAttribute('href', '/transaction-mocks/');

  // Interrupt the moving scene several times; the last choice owns both rails and the active card.
  for (const category of ['Account', 'Checkout', 'Authentication', 'Transactions']) {
    await gallery.getByRole('radio', { name: category, exact: true }).check();
  }
  await gallery.getByRole('radio', { name: 'Receipt', exact: true }).check();
  await expect(
    gallery.getByRole('heading', { name: 'Transfer confirmed', exact: true }),
  ).toBeVisible();
  await capture(gallery, 'desktop-receipt');

  await gallery.getByRole('radio', { name: 'Checkout', exact: true }).check();
  await gallery.getByRole('combobox', { name: 'Pay with' }).selectOption('ethereum');
  await gallery.getByRole('button', { name: 'Pay $24.00', exact: true }).click();
  await expect(gallery.getByRole('status')).toContainText('No payment was made.');
  await gallery.getByRole('radio', { name: 'Payment method', exact: true }).check();
  await gallery.getByRole('radio', { name: 'Payment', exact: true }).check();
  await expect(gallery.getByRole('button', { name: 'Pay $24.00', exact: true })).toBeVisible();
  await capture(gallery, 'desktop-checkout');

  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  assert.deepEqual(errors, []);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify({ passed: true, checked, errors }, null, 2),
  );
  console.log(
    'Passed category and rail navigation, demo actions, interrupted motion, keyboard access, and 24 mobile views.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
