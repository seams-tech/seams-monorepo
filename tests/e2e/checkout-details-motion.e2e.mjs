import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const url =
  process.env.SEAMS_CHECKOUT_DEMO_URL ||
  'http://localhost:4001/dashboard-static/showcase/checkout/';
const artifacts = '.artifacts/transaction-details-jank';
const errors = [];

function recordError(error) {
  errors.push(error.message);
}

function backdropAppearance(dialog) {
  const style = getComputedStyle(dialog, '::backdrop');
  return {
    transparent:
      style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent',
    animation: style.animationName,
    modal: dialog.matches(':modal'),
  };
}

async function readBackdrop(page) {
  return page.locator('dialog[open]').evaluate(backdropAppearance);
}

function startProbe() {
  window.transactionDetailsMotion.start();
}

function probeFinished() {
  return window.transactionDetailsMotion.finished;
}

function readProbe() {
  return window.transactionDetailsMotion.samples;
}

function availableHeight(sample) {
  return sample.availableHeight;
}

function approvalGeometry(card) {
  const button = document.querySelector('button.confirm').getBoundingClientRect();
  const height = card.getBoundingClientRect().height;
  const fillsViewport = window.frameElement
    .closest('dialog')
    .classList.contains('is-viewport-fallback');
  return {
    fits: height <= innerHeight + 2 && button.bottom <= innerHeight + 2,
    settled: fillsViewport || Math.abs(height - innerHeight) <= 1,
    width: innerWidth,
    open: document.querySelector('.seams-review-technical').open,
    card: height,
    frame: innerHeight,
  };
}

async function readGeometry(wallet) {
  return wallet.locator('.modal-container-root').evaluate(approvalGeometry);
}

async function measureToggle(page, wallet, name, summary) {
  await page.evaluate(startProbe);
  await wallet.locator('summary').filter({ hasText: summary }).press('Enter');
  await page.waitForFunction(probeFinished);
  const samples = await page.evaluate(readProbe);
  await writeFile(`${artifacts}/${name}.json`, JSON.stringify(samples, null, 2));
  assert.ok(samples.length > 10, 'Measure the full transition');
  const state = summary === 'Raw data' ? 'rawOpen' : 'detailsOpen';
  assert.notEqual(samples[0][state], samples.at(-1)[state], `${name}: disclosure changes state`);
  const opening = !samples[0][state];
  let previousHeight = samples[0].availableHeight;
  for (const sample of samples) {
    // The iframe can paint one frame after its parent's contraction.
    assert.ok(
      sample.cardHeight <= Math.max(previousHeight, sample.availableHeight) + 2,
      `${name}: no late height jump`,
    );
    const visibleHeight = opening
      ? sample.availableHeight
      : Math.max(previousHeight, sample.availableHeight);
    assert.ok(
      sample.buttonBottom <= visibleHeight + 2,
      `${name}: approval stays within the frame during motion`,
    );
    previousHeight = sample.availableHeight;
  }
  assert.ok(samples.at(-1).cardHeight <= samples.at(-1).availableHeight + 2);
  if (summary === 'Raw data') {
    const heights = samples.map(availableHeight);
    assert.ok(
      Math.max(...heights) - Math.min(...heights) <= 2,
      'Nested details do not resize the host',
    );
  }
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 440, height: 620 } });
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  page.on('pageerror', recordError);
  await page.goto(url);
  await page.addScriptTag({
    path: fileURLToPath(new URL('../helpers/transactionDetailsMotionProbe.mjs', import.meta.url)),
  });
  await page.getByRole('button', { name: 'Buy Yes', exact: true }).click();
  await expect
    .poll(readBackdrop.bind(null, page))
    .toMatchObject({ transparent: false, modal: true });
  await page.getByRole('button', { name: 'Confirm in wallet' }).click();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(wallet.locator('.seams-confirmation-modal--hosted')).toBeFocused();

  // The viewport matches the actual canvas iframe, including its height cap.
  for (const size of [
    { name: 'canvas', width: 440, height: 620 },
    { name: 'mobile', width: 288, height: 620 },
    { name: 'tall-control', width: 440, height: 900 },
  ]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await expect.poll(readGeometry.bind(null, wallet)).toMatchObject({
      fits: true,
      settled: true,
      open: false,
      width: Math.min(420, size.width - 32),
    });
    await measureToggle(page, wallet, `${size.name}-expand`, 'Transaction details');
    await measureToggle(page, wallet, `${size.name}-raw-expand`, 'Raw data');
    await measureToggle(page, wallet, `${size.name}-raw-collapse`, 'Raw data');
    await page.screenshot({ path: `${artifacts}/${size.name}-expanded.png` });
    await measureToggle(page, wallet, `${size.name}-collapse`, 'Transaction details');
  }

  await measureToggle(page, wallet, 'resize-start', 'Transaction details');
  await page.setViewportSize({ width: 288, height: 620 });
  await expect
    .poll(readGeometry.bind(null, wallet))
    .toMatchObject({ fits: true, settled: true, open: true, width: 256 });
  await page.setViewportSize({ width: 440, height: 620 });
  await expect
    .poll(readGeometry.bind(null, wallet))
    .toMatchObject({ fits: true, settled: true, open: true, width: 408 });
  await measureToggle(page, wallet, 'resize-collapse', 'Transaction details');
  await measureToggle(page, wallet, 'resize-reopen', 'Transaction details');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await wallet.locator('summary').filter({ hasText: 'Transaction details' }).press('Enter');
  await expect.poll(readGeometry.bind(null, wallet)).toMatchObject({ fits: true, open: false });
  await wallet.locator('summary').filter({ hasText: 'Transaction details' }).press('Enter');
  await expect.poll(readGeometry.bind(null, wallet)).toMatchObject({ fits: true, open: true });
  await wallet.getByRole('button', { name: 'Confirm with passkey' }).click();
  await expect(wallet.getByRole('status').filter({ hasText: 'Transaction complete' })).toBeVisible({
    timeout: 10000,
  });
  await page.screenshot({ path: `${artifacts}/receipt.png` });

  // Canvas previews omit only the tint; review, approval, and dismissal stay native.
  const withoutBackdrop = new URL(url);
  withoutBackdrop.searchParams.set('backdrop', 'none');
  await page.goto(withoutBackdrop.href);
  await page.getByRole('button', { name: 'Buy Yes', exact: true }).click();
  await expect
    .poll(readBackdrop.bind(null, page))
    .toEqual({ transparent: true, animation: 'none', modal: true });
  await page.screenshot({ path: `${artifacts}/review-without-backdrop.png` });
  await page.getByRole('button', { name: 'Confirm in wallet' }).click();
  await expect(wallet.locator('.seams-confirmation-modal--hosted')).toBeFocused();
  await expect
    .poll(readBackdrop.bind(null, page))
    .toEqual({ transparent: true, animation: 'none', modal: true });
  await page.screenshot({ path: `${artifacts}/approval-without-backdrop.png` });
  await wallet.getByRole('button', { name: 'Confirm with passkey' }).click();
  await expect(wallet.getByRole('status').filter({ hasText: 'Transaction complete' })).toBeVisible({
    timeout: 10000,
  });
  await wallet.getByRole('button', { name: 'Open', exact: true }).click();
  await expect
    .poll(readBackdrop.bind(null, page))
    .toEqual({ transparent: true, animation: 'none', modal: true });
  await wallet.getByRole('button', { name: 'Done', exact: true }).press('Escape');
  await expect(page.getByRole('status')).toContainText('Purchase confirmed');
  assert.deepEqual(errors, []);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        viewportSizes: ['440x620', '288x620', '440x900'],
        checks: [
          'expand',
          'collapse',
          'reopen',
          'nested raw data',
          'resize while open',
          'reduced motion',
          'approval and receipt',
          'optional backdrop across review, approval, and receipt',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed bounded details motion, nested toggles, viewport resize, reduced motion, and approval.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
