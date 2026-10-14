import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const artifacts = '.artifacts/wallet-access-showcase';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: 'reduce',
});
context.setDefaultTimeout(15000);
await context.tracing.start({ screenshots: true, snapshots: true });
function position(gallery) {
  window.scrollTo({
    top: scrollY + gallery.getBoundingClientRect().top - 120,
    behavior: 'instant',
  });
}
async function settleMenu(element) {
  for (const animation of element.getAnimations({ subtree: true })) {
    if (animation.effect?.getTiming().iterations !== Infinity) await animation.finished;
  }
}
try {
  const page = await context.newPage();
  await page.goto(process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet');
  const gallery = page.getByRole('region', { name: 'Wallet component showcase' });
  await gallery.evaluate(position);
  const auth = gallery.frameLocator('iframe[title="Authentication"]');
  await auth.getByRole('button', { name: 'Link this device', exact: false }).click();
  await expect(auth.locator('.seams-auth-menu-surface')).toBeVisible();
  await expect(auth.getByRole('img', { name: 'QR code to link this device' })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/sdk-link-menu.png` });
  await auth.getByRole('button', { name: 'Back', exact: true }).press('Enter');
  await auth.locator('.seams-auth-menu-surface').evaluate(settleMenu);
  await gallery.evaluate(position);
  await page.screenshot({ path: `${artifacts}/authentication-return.png` });
  await auth.getByRole('button', { name: 'Recover wallet', exact: false }).click();
  await expect(auth.getByLabel('Recovery code', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/sdk-recovery-menu.png` });
  await auth.getByLabel('Recovery code', { exact: true }).fill('1234');
  await auth.getByRole('button', { name: 'Recover with Passkey', exact: true }).press('Enter');
  await expect(auth.getByRole('alert')).toContainText('Check your recovery code');
  await auth.getByLabel('Recovery code', { exact: true }).fill('4821-7396-2058-1643');
  await auth.getByRole('button', { name: 'Recover with Passkey', exact: true }).press('Enter');
  await auth.getByRole('button', { name: 'Create new passkey', exact: true }).press('Enter');
  await auth.getByRole('button', { name: 'Unlock with new passkey', exact: true }).press('Enter');
  await expect(auth.getByRole('heading', { name: 'Wallet recovered' })).toBeVisible();
  await auth.getByRole('button', { name: 'Back', exact: true }).press('Enter');
  await expect(auth.getByRole('button', { name: 'Create wallet with passkey' })).toBeVisible();

  await gallery
    .getByRole('radiogroup', { name: 'Components', exact: true })
    .getByRole('radio', { name: 'Link & recover', exact: true })
    .locator('..')
    .click();
  await gallery.evaluate(position);
  await page.mouse.move(5, 5);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const access = gallery.frameLocator('iframe[title="Link and recover"]');
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await expect(access.getByRole('button', { name: 'Create passkey', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(access.getByRole('heading', { name: 'Device linked' })).toBeVisible({
      timeout: 15000,
    });
    await expect(access.getByLabel('Recovery code', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      access.getByRole('button', { name: 'Create new passkey', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      access.getByRole('button', { name: 'Unlock with new passkey', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(access.getByRole('heading', { name: 'Wallet recovered' })).toBeVisible({
      timeout: 15000,
    });
    await expect(access.getByRole('img', { name: 'QR code to link this device' })).toBeVisible({
      timeout: 15000,
    });
  }
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        sdkMenus: true,
        authenticationEntryPoints: true,
        replayCycles: 2,
        invalidRecoveryCode: true,
        backNavigation: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed SDK linking/recovery menus, Authentication entry points, validation, reset, and replay.',
  );
} catch (error) {
  await context.pages()[0]?.screenshot({ path: `${artifacts}/failure.png` });
  throw error;
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
