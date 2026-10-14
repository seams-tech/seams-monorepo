import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const artifacts = '.artifacts/wallet-showcase-playback';
const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet';
function positionGallery(gallery) {
  window.scrollTo({
    top: scrollY + gallery.getBoundingClientRect().top - 100,
    behavior: 'instant',
  });
}
async function selection(gallery, name) {
  await expect(
    gallery
      .getByRole('radiogroup', { name: 'Components', exact: true })
      .getByRole('radio', { name, exact: true }),
  ).toBeChecked({ timeout: 45000 });
}
async function resume(page, gallery) {
  await gallery.getByRole('button', { name: 'Play playback', exact: true }).click();
  await page.mouse.move(5, 5);
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
  await gallery.evaluate(positionGallery);
  await page.mouse.move(5, 5);
  await expect(gallery.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await selection(gallery, 'Transactions');
  const transaction = gallery.frameLocator('iframe[title="Transaction modal"]');
  await expect(transaction.getByRole('status')).toContainText('Signing transaction', {
    timeout: 15000,
  });
  await gallery.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await page.waitForTimeout(2500);
  await expect(transaction.getByRole('status')).toContainText('Signing transaction');
  await page.screenshot({ path: `${artifacts}/paused-transaction.png` });
  await resume(page, gallery);
  await expect(transaction.getByRole('status')).toContainText('Transaction complete', {
    timeout: 10000,
  });
  await selection(gallery, 'Custom Components');
  const market = gallery.frameLocator('iframe[title="Prediction market"]');
  await expect(market.getByRole('heading', { name: 'Review purchase' })).toBeVisible({
    timeout: 15000,
  });
  await gallery.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await page.waitForTimeout(200);
  const quote = market.getByRole('progressbar', { name: 'Quote time remaining' });
  const remaining = await quote.getAttribute('value');
  await page.waitForTimeout(2200);
  await expect(quote).toHaveAttribute('value', remaining);
  await resume(page, gallery);
  await expect(market.frameLocator('iframe').getByRole('status')).toContainText(
    'Transaction complete',
    { timeout: 20000 },
  );
  await selection(gallery, 'Link & recover');
  const access = gallery.frameLocator('iframe[title="Link and recover"]');
  await expect(access.getByRole('img', { name: 'QR code to link this device' })).toBeVisible();
  await gallery.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await page.waitForTimeout(4500);
  await expect(access.getByRole('img', { name: 'QR code to link this device' })).toBeVisible();
  await resume(page, gallery);
  await expect(access.getByRole('heading', { name: 'Device linked' })).toBeVisible({
    timeout: 15000,
  });
  await expect(access.getByLabel('Recovery code', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(access.getByRole('heading', { name: 'Wallet recovered' })).toBeVisible({
    timeout: 20000,
  });
  await selection(gallery, 'Account management');
  await expect(gallery.getByText('Your wallet is now available on this device.')).toBeVisible({
    timeout: 15000,
  });
  await selection(gallery, 'Authentication');
  await expect(
    gallery.frameLocator('iframe[title="Authentication"]').getByRole('status'),
  ).toHaveText("You're logged in.", { timeout: 15000 });
  await selection(gallery, 'Transactions');

  // A visitor takes control; Play restarts this component so the cursor has a known starting point.
  await transaction.getByRole('button', { name: 'Confirm with passkey' }).click();
  await expect(gallery.getByRole('button', { name: 'Play playback', exact: true })).toBeVisible();
  await expect(transaction.getByRole('status')).toContainText('Transaction complete', {
    timeout: 10000,
  });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(4000);
  await selection(gallery, 'Transactions');
  await resume(page, gallery);
  await expect(transaction.getByRole('button', { name: 'Confirm with passkey' })).toBeVisible();
  await gallery.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await page.screenshot({ path: `${artifacts}/playback-control.png` });
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        automaticFullCarousel: true,
        pausedReceiptClock: true,
        pausedLinkApproval: true,
        manualTakeover: true,
        restartedOnPlay: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed full carousel playback, pause/resume, timer suspension, wraparound, and manual takeover.',
  );
} catch (error) {
  await context.pages()[0]?.screenshot({ path: `${artifacts}/failure.png` });
  throw error;
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
