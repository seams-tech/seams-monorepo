import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = process.env.SEAMS_SITE_ORIGIN || 'http://localhost:4001';
const artifacts = '.artifacts/wallet-marketing-unavailable';

async function unavailableDiscovery(route) {
  await route.fulfill({ status: 500, contentType: 'text/plain', body: 'Deployment unavailable' });
}

function hasOverflow() {
  return document.documentElement.scrollWidth > innerWidth;
}

function recordRequest(request) {
  return request.url().includes('/.well-known/seams-tenant-deployment.json');
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
  });
  // A failed live demo must leave the public page, navigation, and figures usable.
  await page.route('**/.well-known/seams-tenant-deployment.json', unavailableDiscovery);
  const discovery = page.waitForRequest(recordRequest);
  await page.goto(`${origin}/wallet`);
  await discovery;
  await page.getByRole('heading', { level: 1, name: /Non.custodial wallets/ }).waitFor();
  const unavailable = page
    .getByRole('status')
    .filter({ hasText: 'The live demo is temporarily unavailable.' });
  await unavailable.waitFor();
  assert.equal(await page.getByRole('link', { name: 'Start building', exact: true }).count(), 1);
  const section = page.locator('#wallet-security');
  await section.scrollIntoViewIfNeeded();
  assert.equal(await section.locator('iframe:visible').count(), 4);
  const devices = page.frameLocator('iframe[data-figure="devices"]');
  await devices.locator('#stage').focus();
  await page.keyboard.press('Enter');
  await devices.locator('#read').filter({ hasText: 'linked' }).waitFor();
  await section.screenshot({ path: `${artifacts}/desktop-capabilities.png` });
  await page.getByRole('button', { name: 'Next custody view' }).click();
  const signing = page.frameLocator('iframe[data-figure="signing"]');
  await signing.locator('#stage').focus();
  await page.keyboard.press('Enter');
  await signing.locator('#read').filter({ hasText: 'signed' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(hasOverflow), false);
  await section.screenshot({ path: `${artifacts}/mobile-signing.png` });
  await page.getByRole('button', { name: 'Reload page', exact: true }).click();
  await unavailable.waitFor();
  await page.getByRole('heading', { level: 1, name: /Non.custodial wallets/ }).waitFor();
  assert.equal(await page.evaluate(hasOverflow), false);
  await page.screenshot({ path: `${artifacts}/mobile-unavailable.png`, fullPage: true });
  // Also exercise the real local discovery response, without intercepting it.
  await page.unroute('**/.well-known/seams-tenant-deployment.json', unavailableDiscovery);
  await page.reload();
  await page.getByRole('heading', { level: 1, name: /Non.custodial wallets/ }).waitFor();
  await page.locator('#wallet-security').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifacts}/live-local-page.png`, fullPage: true });
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        deploymentFailureContained: true,
        keyboardAnimations: ['devices', 'signing'],
        mobileOverflow: false,
        reloadDuringOutage: true,
        liveLocalPageRendered: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed unavailable discovery, public page rendering, keyboard animations, mobile layout, reload, and real local page.',
  );
} finally {
  await browser.close();
}
