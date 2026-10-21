import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet';
const artifacts = '.artifacts/wallet-component-showcase';
const errors = [];
const components = [
  'Authentication',
  'Transactions',
  'Custom Components',
  'Recover and Link Devices',
];

function recordError(error) {
  errors.push(error.message);
}

function getLayout(gallery) {
  const viewport = gallery.querySelector('.component-showcase__viewport').getBoundingClientRect();
  const active = gallery.querySelector('[data-active="true"]');
  const card = active.getBoundingClientRect();
  const controls = gallery.querySelector('.component-showcase__controls').getBoundingClientRect();
  let inactiveInert = true;
  for (const element of gallery.querySelectorAll(
    '.component-showcase__position:not([data-active="true"])',
  )) {
    inactiveInert = inactiveInert && element.inert;
  }
  return {
    component: active.querySelector('[data-preview]').dataset.preview,
    centered: Math.abs((card.left + card.right) / 2 - (viewport.left + viewport.right) / 2) < 1,
    cardFits:
      card.left >= viewport.left &&
      card.right <= viewport.right &&
      card.top >= viewport.top &&
      card.bottom <= viewport.bottom,
    controlsFit: controls.left >= 0 && controls.right <= innerWidth,
    pageFits: document.documentElement.scrollWidth <= innerWidth,
    inactiveInert,
    activeInteractive: !active.inert,
  };
}

async function finishSceneMovement(gallery) {
  for (const animation of gallery.querySelector('.component-showcase__world').getAnimations()) {
    await animation.finished;
  }
}

async function settle(gallery) {
  await expect(gallery.locator('[data-active="true"]')).toHaveCSS('opacity', '1');
  await gallery.evaluate(finishSceneMovement);
}

function positionForCapture(gallery) {
  window.scrollTo({
    top: window.scrollY + gallery.getBoundingClientRect().top - 120,
    behavior: 'instant',
  });
}

async function capture(gallery, name) {
  await settle(gallery);
  const layout = await gallery.evaluate(getLayout);
  assert.equal(layout.centered, true);
  assert.equal(layout.cardFits, true);
  assert.equal(layout.controlsFit, true);
  assert.equal(layout.pageFits, true);
  assert.equal(layout.inactiveInert, true);
  assert.equal(layout.activeInteractive, true);
  await gallery.evaluate(positionForCapture);
  const bounds = await gallery.boundingBox();
  assert.ok(bounds);
  await gallery.page().screenshot({
    path: `${artifacts}/${name}.png`,
    clip: { x: bounds.x, y: bounds.y - 55, width: bounds.width, height: bounds.height + 80 },
  });
  return layout;
}

async function expectSelection(gallery, name) {
  await expect(
    gallery
      .getByRole('radiogroup', { name: 'Components', exact: true })
      .getByRole('radio', { name, exact: true }),
  ).toBeChecked();
  await settle(gallery);
  switch (name) {
    case 'Authentication':
      await expect(
        gallery
          .frameLocator('iframe[title="Authentication"]')
          .getByRole('button', { name: 'Create wallet with passkey', exact: true }),
      ).toBeVisible();
      break;
    case 'Transactions':
      await expect(
        gallery
          .frameLocator('iframe[title="Transaction modal"]')
          .getByRole('button', { name: 'Confirm with passkey' }),
      ).toBeVisible();
      break;
    case 'Custom Components':
      await expect(
        gallery
          .frameLocator('iframe[title="Prediction market"]')
          .getByRole('button', { name: 'Buy Yes', exact: true }),
      ).toBeVisible();
      break;
    case 'Recover and Link Devices':
      await expect(
        gallery
          .frameLocator('iframe[title="Recover and Link Devices"]')
          .getByRole('button', { name: 'Accounts', exact: true }),
      ).toBeVisible();
      break;
    default:
      throw new Error(`Unknown showcase component: ${name}`);
  }
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
  const selector = gallery.getByRole('radiogroup', { name: 'Components', exact: true });
  await expect(selector.getByRole('radio')).toHaveCount(4);
  // The playback control sits in the same pill as the component choices.
  await expect(
    gallery
      .locator('.component-showcase__controls')
      .getByRole('button', { name: 'Pause playback' }),
  ).toBeVisible();
  await expectSelection(gallery, 'Transactions');
  await selector.getByRole('radio', { name: 'Authentication', exact: true }).locator('..').click();
  await expectSelection(gallery, 'Authentication');
  await gallery.evaluate(positionForCapture);
  await gallery
    .frameLocator('iframe[title="Authentication"]')
    .getByRole('button', { name: 'Create wallet with passkey', exact: true })
    .click();
  await expect(
    gallery.frameLocator('iframe[title="Authentication"]').locator('.seams-spinner'),
  ).toBeVisible();
  await expect(
    gallery.frameLocator('iframe[title="Authentication"]').getByRole('status'),
  ).toContainText("You're logged in.");
  await expect(
    gallery
      .frameLocator('iframe[title="Authentication"]')
      .getByRole('button', { name: 'Next', exact: true }),
  ).toBeVisible();
  await gallery
    .frameLocator('iframe[title="Authentication"]')
    .getByRole('button', { name: 'Start over', exact: true })
    .click();
  await gallery.evaluate(positionForCapture);
  const authentication = gallery.frameLocator('iframe[title="Authentication"]');
  await authentication.getByRole('button', { name: 'Unlock wallet', exact: true }).press('Enter');
  await expect(
    authentication.getByRole('button', { name: 'Unlock with passkey', exact: true }),
  ).toBeVisible();
  await authentication.getByRole('button', { name: 'Create a wallet', exact: true }).press('Enter');
  await expect(
    authentication.getByRole('button', { name: 'Create wallet with passkey', exact: true }),
  ).toBeVisible();
  await capture(gallery, 'desktop-authentication');

  await selector.getByRole('radio', { name: 'Transactions', exact: true }).locator('..').click();
  await expectSelection(gallery, 'Transactions');
  const modal = gallery.frameLocator('iframe[title="Transaction modal"]');
  await modal.getByRole('button', { name: 'Confirm with passkey' }).click();
  for (const status of [
    'Signing transaction',
    'Broadcasting transaction',
    'Waiting for confirmation',
    'Transaction complete',
  ]) {
    await expect(modal.getByRole('status').filter({ hasText: status })).toBeVisible();
  }
  await capture(gallery, 'desktop-transaction-receipt');

  await selector
    .getByRole('radio', { name: 'Custom Components', exact: true })
    .locator('..')
    .click();
  await expectSelection(gallery, 'Custom Components');
  const market = gallery.frameLocator('iframe[title="Prediction market"]');
  await market.getByRole('button', { name: 'Buy Yes', exact: true }).click();
  await expect(market.getByRole('heading', { name: 'Review purchase' })).toBeVisible();
  await capture(gallery, 'desktop-prediction-review');
  await market.getByRole('button', { name: 'Confirm in wallet' }).click();
  const wallet = market.frameLocator('iframe');
  await expect(wallet.locator('.seams-confirmation-modal--hosted')).toBeFocused();
  await wallet.getByRole('button', { name: 'Confirm with passkey' }).click();
  await expect(wallet.getByRole('status').filter({ hasText: 'Transaction complete' })).toBeVisible({
    timeout: 10000,
  });

  await selector
    .getByRole('radio', { name: 'Recover and Link Devices', exact: true })
    .locator('..')
    .click();
  await expectSelection(gallery, 'Recover and Link Devices');
  await capture(gallery, 'desktop-account');

  // The selector supports native arrow-key navigation.
  await selector.getByRole('radio', { name: 'Authentication', exact: true }).locator('..').click();
  await selector.getByRole('radio', { name: 'Authentication', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expectSelection(gallery, 'Transactions');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const checked = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const name of components) {
      await selector.getByRole('radio', { name, exact: true }).locator('..').click();
      await expectSelection(gallery, name);
      checked.push({
        width,
        name,
        ...(await capture(gallery, `mobile-${width}-${name.toLowerCase().replaceAll(' ', '-')}`)),
      });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        components,
        completeTransactionLifecycles: true,
        checked,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed the four-component carousel, full transaction lifecycles, and mobile layouts.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
