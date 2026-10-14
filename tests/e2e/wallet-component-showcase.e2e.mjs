import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet';
const artifacts = '.artifacts/wallet-component-showcase';
const errors = [];
const components = ['Authentication', 'Transactions', 'Custom Components', 'Account management'];

function recordError(error) {
  errors.push(error.message);
}

function getLayout(gallery) {
  const viewport = gallery.querySelector('.component-showcase__viewport').getBoundingClientRect();
  const active = gallery.querySelector('[data-active="true"]');
  const card = active.getBoundingClientRect();
  const rail = gallery.querySelector('.component-showcase__rail').getBoundingClientRect();
  const selector = gallery.querySelector('.component-showcase__selector').getBoundingClientRect();
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
    controlsFit:
      rail.left >= 0 &&
      rail.right <= innerWidth &&
      selector.left >= 0 &&
      selector.right <= innerWidth,
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
  await expect(
    gallery
      .getByRole('radiogroup', { name: 'Component pagination' })
      .getByRole('radio', { name, exact: true }),
  ).toBeChecked();
  await settle(gallery);
  switch (name) {
    case 'Authentication':
      await expect(
        gallery.getByRole('button', { name: 'Create with passkey', exact: true }),
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
    case 'Account management':
      await expect(gallery.getByRole('heading', { name: 'At home, everywhere.' })).toBeVisible();
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
  const pagination = gallery.getByRole('radiogroup', { name: 'Component pagination' });
  await expect(selector.getByRole('radio')).toHaveCount(4);
  await expect(pagination.getByRole('radio')).toHaveCount(4);
  await expectSelection(gallery, 'Authentication');
  await gallery.getByRole('button', { name: 'Create with passkey', exact: true }).click();
  await expect(gallery.getByRole('status')).toContainText('Your wallet is ready.');
  await gallery.getByRole('button', { name: 'Back' }).click();
  await capture(gallery, 'desktop-authentication');

  await gallery.getByRole('button', { name: 'Next component' }).click();
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

  await gallery.getByRole('button', { name: 'Next component' }).click();
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

  await gallery.getByRole('button', { name: 'Next component' }).click();
  await expectSelection(gallery, 'Account management');
  await capture(gallery, 'desktop-account');
  await gallery.getByRole('button', { name: 'Next component' }).click();
  await expectSelection(gallery, 'Authentication');
  await gallery.getByRole('button', { name: 'Previous component' }).click();
  await expectSelection(gallery, 'Account management');

  // Either selector changes the same carousel, including native arrow-key navigation.
  await selector.getByRole('radio', { name: 'Authentication', exact: true }).locator('..').click();
  await selector.getByRole('radio', { name: 'Authentication', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expectSelection(gallery, 'Transactions');
  await pagination
    .getByRole('radio', { name: 'Account management', exact: true })
    .locator('..')
    .click();
  await expectSelection(gallery, 'Account management');

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
        synchronizedSelectors: true,
        wraparound: true,
        completeTransactionLifecycles: true,
        checked,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed the four-component carousel, synchronized selectors, wraparound, full transaction lifecycles, and mobile layouts.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
