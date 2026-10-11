import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const artifactDirectory = resolve('.artifacts/threshold-signing-anatomy');
const pagePath = resolve('docs/explainers/threshold-signing/index.html');
const browserErrors = [];
const remoteRequests = [];

function recordError(error) {
  browserErrors.push(error.message);
}

function recordRequest(request) {
  if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
}

function hasOverflow() {
  return document.documentElement.scrollWidth > innerWidth;
}

async function next(page, count) {
  for (let index = 0; index < count; index += 1) {
    await page.locator('#next').click();
  }
}

await mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.on('pageerror', recordError);
  page.on('request', recordRequest);
  await page.goto(pathToFileURL(pagePath).href);
  await page.getByRole('button', { name: 'ECDSA EVM family' }).click();
  await next(page, 4);
  await expect(page.locator('#fact-value')).toHaveText('Reserved for this request');
  await expect(page.locator('[data-name="pool.token-0"]')).toBeVisible();
  const raisedTransform = await page
    .locator('[data-name="press.platen"]')
    .getAttribute('transform');
  await next(page, 1);
  await expect(page.locator('#fact-value')).toHaveText('Consumed · terminal');
  await expect(page.locator('[data-name="pool.token-0"]')).toBeHidden();
  await expect(page.locator('[data-name="press.platen"]')).not.toHaveAttribute(
    'transform',
    raisedTransform,
  );
  await next(page, 1);
  await expect(page.locator('#signature-seal')).toHaveAttribute('opacity', '1');
  await page.screenshot({ path: `${artifactDirectory}/ecdsa-complete.png`, fullPage: true });

  // Follow the user-visible loss and retry flow. The spent entry stays unavailable.
  await page.locator('#scenario').selectOption('lost-response');
  await next(page, 3);
  await expect(page.locator('#fact-value')).toHaveText('Consumed · cannot be reused');
  await expect(page.locator('#signature-seal')).toHaveAttribute('opacity', '0');
  await page.getByRole('button', { name: 'Try the same presignature again' }).click();
  await expect(page.locator('#fact-value')).toHaveText('Refused');
  await expect(page.locator('[data-name="pool.token-0"]')).toBeHidden();
  await expect(page.locator('#reuse')).toBeDisabled();
  await page.screenshot({
    path: `${artifactDirectory}/lost-response-reuse-refused.png`,
    fullPage: true,
  });

  await page.locator('#scenario').selectOption('worker-offline');
  await next(page, 1);
  await expect(page.locator('#fact-value')).toHaveText('1 of 2 · stopped');
  await expect(page.locator('#next')).toHaveText('Replay explanation ↺');
  await expect(page.locator('#signature-seal')).toHaveAttribute('opacity', '0');
  await page.locator('#scenario').selectOption('denied');
  await expect(page.locator('#fact-value')).toHaveText('Refused');
  await expect(page.locator('#next')).toHaveText('Replay explanation ↺');

  // Switch protocol, use the keyboard, then inspect the mobile reduced-motion view.
  await page.getByRole('button', { name: 'Ed25519 NEAR' }).click();
  await page.locator('#next').focus();
  await page.keyboard.press('Enter');
  await next(page, 3);
  await expect(page.locator('#fact-value')).toHaveText('FROST · two participants');
  await expect(page.locator('[data-name="deriver-a.body"]')).toHaveAttribute('data-muted', 'true');
  await expect(page.locator('[data-name="pool.tray"]')).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await next(page, 2);
  await expect(page.locator('#signature-seal')).toHaveAttribute('opacity', '1');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(hasOverflow), false);
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await page.screenshot({ path: `${artifactDirectory}/mobile-ed25519-dark.png`, fullPage: true });
  assert.deepEqual(browserErrors, []);
  assert.deepEqual(remoteRequests, []);

  const html = await readFile(pagePath);
  await writeFile(
    `${artifactDirectory}/result.json`,
    JSON.stringify(
      {
        passed: true,
        artifactSha256: createHash('sha256').update(html).digest('hex'),
        walletSourceCommit: '235a37ae',
        scenarios: [
          'ecdsa-success',
          'response-loss-then-reuse',
          'worker-unavailable',
          'authorization-refused',
          'ed25519-keyboard',
        ],
        mobileWidth: 390,
        reducedMotion: true,
        browserErrors,
        remoteRequests,
      },
      null,
      2,
    ),
  );
  console.log(`Passed. Evidence: ${artifactDirectory}/result.json`);
} finally {
  await browser.close();
}
