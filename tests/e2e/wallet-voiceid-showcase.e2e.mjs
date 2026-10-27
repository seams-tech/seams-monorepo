import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet/';
const artifacts = '.artifacts/wallet-voiceid-showcase';
const errors = [];
const modelRequests = [];

function recordError(error) {
  errors.push(error.message);
}

function recordRequest(request) {
  if (/\.onnx(?:$|\?)|ort-wasm/.test(request.url())) {
    modelRequests.push(request.url());
  }
}

function getLayout(gallery) {
  const viewport = gallery.querySelector('.component-showcase__viewport').getBoundingClientRect();
  return {
    viewport: viewport.toJSON(),
    pageFits: document.documentElement.scrollWidth <= innerWidth,
  };
}

async function capture(gallery, name) {
  const layout = await gallery.evaluate(getLayout);
  const card = await gallery
    .frameLocator('iframe[title="VoiceID"]')
    .locator('.seams-confirmation-modal--hosted')
    .boundingBox();
  assert.ok(card);
  assert.ok(
    card.x >= layout.viewport.left && card.x + card.width <= layout.viewport.right,
    JSON.stringify({ card, layout }),
  );
  assert.ok(
    card.y >= layout.viewport.top && card.y + card.height <= layout.viewport.bottom,
    JSON.stringify({ card, layout }),
  );
  assert.equal(layout.pageFits, true);
  await gallery.screenshot({ path: `${artifacts}/${name}.png` });
  return { card, ...layout };
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: 'reduce',
});
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  page.on('pageerror', recordError);
  page.on('request', recordRequest);
  await page.goto(origin);
  const gallery = page.getByRole('region', {
    name: 'Use built-in wallet components, or use your own.',
    exact: true,
  });
  await gallery.getByRole('radio', { name: 'VoiceID', exact: true }).locator('..').click();
  const voiceId = gallery.frameLocator('iframe[title="VoiceID"]');
  const confirm = voiceId.getByRole('button', { name: 'Confirm with VoiceID', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(voiceId.getByText('Approve this transfer at once.', { exact: true })).toBeVisible();
  await expect(voiceId.getByRole('status')).toHaveText('Listening');
  await capture(gallery, 'desktop-prompt');
  await expect(voiceId.getByRole('status')).toHaveText('Checking your voice…', { timeout: 10000 });
  await expect(voiceId.getByRole('status')).toContainText('Transaction complete', {
    timeout: 15000,
  });
  await capture(gallery, 'desktop-receipt');
  await voiceId.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(confirm).toBeVisible();

  const layouts = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect(confirm).toBeVisible();
    layouts.push({ width, ...(await capture(gallery, `mobile-${width}-review`)) });
    await confirm.click();
    await expect(
      voiceId.getByText('Approve this transfer at once.', { exact: true }),
    ).toBeVisible();
    await capture(gallery, `mobile-${width}-prompt`);
    await expect(voiceId.getByRole('status')).toContainText('Transaction complete', {
      timeout: 15000,
    });
    await capture(gallery, `mobile-${width}-receipt`);
    await voiceId.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(confirm).toBeVisible();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(modelRequests, []);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        origin,
        voiceIdApprovalToReceipt: true,
        layouts,
        errors,
        modelRequests,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Passed VoiceID approval, receipts, mobile layouts, and zero model downloads.');
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
