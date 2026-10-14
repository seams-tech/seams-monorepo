import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const artifacts = '.artifacts/wallet-access-showcase';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
context.setDefaultTimeout(15000);
await context.tracing.start({ screenshots: true, snapshots: true });
function position(gallery) {
  window.scrollTo({
    top: scrollY + gallery.getBoundingClientRect().top - 120,
    behavior: 'instant',
  });
}
try {
  const page = await context.newPage();
  await page.goto(process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet');
  const gallery = page.getByRole('region', { name: 'Wallet component showcase' });
  await gallery
    .getByRole('radiogroup', { name: 'Components', exact: true })
    .getByRole('radio', { name: 'Link & recover', exact: true })
    .locator('..')
    .click();
  await gallery.evaluate(position);
  await page.mouse.move(5, 5);
  const access = gallery.frameLocator('iframe[title="Link and recover"]');
  for (let cycle = 0; cycle < 2; cycle += 1) {
    for (const state of [
      'scan',
      'approve',
      'passkey',
      'complete',
      'recovery',
      'passkey',
      'complete',
      'choose',
    ]) {
      await expect(access.locator('.access-card')).toHaveAttribute('data-access-state', state, {
        timeout: 15000,
      });
    }
  }
  // Manual input stops playback, including after validation failure and back navigation.
  await access.getByRole('button', { name: 'Recover your wallet', exact: false }).click();
  await access.getByLabel('Recovery code', { exact: true }).fill('1234');
  await access.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(access.getByRole('alert')).toContainText('Check your recovery code');
  await access.getByLabel('Recovery code', { exact: true }).fill('4821-7396-2058-1643');
  await access.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(access.getByRole('heading', { name: 'Create a new passkey' })).toBeVisible();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(4000);
  await expect(access.getByRole('heading', { name: 'Create a new passkey' })).toBeVisible();
  await access.getByRole('button', { name: 'Create passkey', exact: true }).click();
  await expect(access.getByRole('heading', { name: 'Wallet recovered' })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/recovered.png` });
  await access.getByRole('button', { name: 'Done', exact: true }).click();
  await access.getByRole('button', { name: 'Link a device', exact: false }).click();
  await access.getByRole('button', { name: 'Back to link and recover', exact: true }).click();
  await expect(
    access.getByRole('button', { name: 'Recover your wallet', exact: false }),
  ).toBeVisible();
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        replayCycles: 2,
        invalidRecoveryCode: true,
        manualTakeover: true,
        backNavigation: true,
      },
      null,
      2,
    ),
  );
  console.log('Passed combined link/recovery playback, validation, manual takeover, and reset.');
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
