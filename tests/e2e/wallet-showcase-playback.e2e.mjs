import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const artifacts = '.artifacts/wallet-showcase-playback';
const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet';
const states = [
  'Signing transaction',
  'Broadcasting transaction',
  'Waiting for confirmation',
  'Transaction complete',
];

function positionGallery(gallery) {
  window.scrollTo({
    top: scrollY + gallery.getBoundingClientRect().top - 100,
    behavior: 'instant',
  });
}

async function select(page, gallery, name) {
  await gallery
    .getByRole('radiogroup', { name: 'Components', exact: true })
    .getByRole('radio', { name, exact: true })
    .locator('..')
    .click();
  await gallery.evaluate(positionGallery);
  await page.mouse.move(5, 5);
}

async function receipt(frame) {
  for (const state of states) {
    await expect(frame.getByRole('status').filter({ hasText: state })).toBeVisible({
      timeout: 15000,
    });
  }
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
context.setDefaultTimeout(15000);
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  await page.goto(origin);
  const gallery = page.getByRole('region', { name: 'Wallet component showcase' });
  await select(page, gallery, 'Transactions');
  const transaction = gallery.frameLocator('iframe[title="Transaction modal"]');
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await expect(transaction.locator('[data-playback-cursor]')).toBeVisible();
    await receipt(transaction);
    await page.screenshot({ path: `${artifacts}/transfer-${cycle}.png` });
    await expect(transaction.getByRole('button', { name: 'Confirm with passkey' })).toBeVisible({
      timeout: 10000,
    });
  }

  await select(page, gallery, 'Custom Components');
  const market = gallery.frameLocator('iframe[title="Prediction market"]');
  const wallet = market.frameLocator('iframe');
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await expect(market.getByRole('heading', { name: 'Review purchase' })).toBeVisible({
      timeout: 15000,
    });
    await expect(wallet.getByRole('heading', { name: 'Approve purchase' })).toBeVisible({
      timeout: 15000,
    });
    await receipt(wallet);
    await page.screenshot({ path: `${artifacts}/purchase-${cycle}.png` });
    await expect(market.getByRole('button', { name: 'Buy Yes', exact: true })).toBeEnabled({
      timeout: 10000,
    });
  }

  console.log('Completed two automatic cycles for both components.');
  // Real input takes ownership. Automation must not submit a visitor's review.
  await market.getByRole('button', { name: 'Buy Yes', exact: true }).click();
  await page.mouse.move(5, 5);
  await expect(market.getByRole('heading', { name: 'Review purchase' })).toBeVisible();
  await page.waitForTimeout(5000);
  await expect(market.getByRole('heading', { name: 'Review purchase' })).toBeVisible();
  await expect(market.locator('[data-playback-cursor]')).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await select(page, gallery, 'Transactions');
  await page.waitForTimeout(4500);
  await expect(transaction.getByRole('button', { name: 'Confirm with passkey' })).toBeVisible();
  await expect(transaction.locator('[data-playback-cursor]')).toHaveCount(0);
  assert.equal(await transaction.getByRole('status').count(), 0);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      { passed: true, cyclesPerComponent: 2, states, manualTakeover: true, reducedMotion: true },
      null,
      2,
    ),
  );
  console.log(
    'Passed transaction and purchase playback, reset, replay, manual takeover, and reduced motion.',
  );
} catch (error) {
  await context.pages()[0]?.screenshot({ path: `${artifacts}/failure.png` });
  throw error;
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
