import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet/';
const artifacts = '.artifacts/wallet-voiceid-showcase';
const errors = [];
const modelRequests = [];
const apiRequests = [];
let microphoneRequests = 0;
const pastelDarkTheme = {
  id: 'pastel-dark',
  label: 'Pastel Dark',
  mode: 'dark',
  background: 'rgb(31, 28, 31)',
  text: 'rgb(238, 233, 238)',
};
const themes = [
  {
    id: 'paper',
    label: 'Paper',
    mode: 'light',
    background: 'rgb(255, 255, 255)',
    text: 'rgb(0, 0, 0)',
  },
  {
    id: 'carbon',
    label: 'Carbon',
    mode: 'dark',
    background: 'rgb(18, 23, 26)',
    text: 'rgb(244, 245, 246)',
  },
  {
    id: 'pastel',
    label: 'Pastel',
    mode: 'light',
    background: 'rgb(255, 254, 253)',
    text: 'rgb(47, 42, 56)',
  },
  pastelDarkTheme,
];

function blockDemoMicrophone() {
  if (location.pathname.includes('/showcase/voiceid/')) {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: window.reportVoiceDemoMicrophoneRequest,
    });
  }
}

function recordMicrophoneRequest() {
  microphoneRequests += 1;
  throw new Error('The canvas preview must not request the microphone.');
}

function recordError(error) {
  errors.push(error.message);
}

function recordRequest(request) {
  if (/\.onnx(?:$|\?)|ort-wasm/.test(request.url())) {
    modelRequests.push(request.url());
  }
  if (
    request.frame().url().includes('/showcase/voiceid/') &&
    (request.resourceType() === 'fetch' ||
      request.resourceType() === 'xhr' ||
      request.method() !== 'GET')
  ) {
    apiRequests.push(request.url());
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

async function checkTheme(voiceId, theme) {
  await expect(voiceId.locator('.seams-confirmation-surface')).toHaveAttribute(
    'data-theme',
    theme.mode,
  );
  await expect(voiceId.locator('.modal-container-root')).toHaveCSS(
    'background-color',
    theme.background,
  );
}

async function approve(gallery, name, theme) {
  const voiceId = gallery.frameLocator('iframe[title="VoiceID"]');
  const confirm = voiceId.getByRole('button', { name: 'Confirm with VoiceID', exact: true });
  await expect(confirm).toBeVisible();
  await checkTheme(voiceId, theme);
  await expect(voiceId.locator('.seams-review-eyebrow')).toHaveText('Sell NEAR for USDC');
  await expect(
    voiceId.getByRole('heading', { name: 'Review your trade', exact: true }),
  ).toBeVisible();
  await expect(voiceId.locator('.seams-review-amount')).toHaveText('10 NEAR');
  await expect(
    voiceId.getByText(/Concept preview · Example quote: receive at least 28.40 USDC/),
  ).toBeVisible();
  await expect(voiceId.locator('.seams-review-account')).toContainText('alex.near');
  await expect(
    voiceId.locator('.seams-review-fields').getByText('NEAR', { exact: true }),
  ).toBeVisible();
  await expect(voiceId.getByText('0.00005 NEAR', { exact: true })).toBeVisible();
  const review = await capture(gallery, `${name}-review`);
  await confirm.click();
  await expect(voiceId.getByRole('status')).toHaveText('Preparing confirmation…');
  await expect(
    voiceId.getByText('Sell 10 NEAR for USDC at market price.', { exact: true }),
  ).toBeVisible();
  await capture(gallery, `${name}-preparation`);
  const phrase = voiceId.locator('[data-voiceid-phrase]');
  await expect(phrase).toBeVisible();
  await expect(phrase).toHaveCSS('color', theme.text);
  const phraseText = await phrase.textContent();
  assert.equal(phraseText, 'Sell ten NEAR.');
  await expect(voiceId.getByRole('status')).toHaveText('Listening');
  await checkTheme(voiceId, theme);
  await capture(gallery, `${name}-prompt`);
  await expect(voiceId.getByRole('status')).toHaveText('Checking your voice…', { timeout: 10000 });
  await expect(voiceId.getByRole('status')).toContainText('Transaction complete', {
    timeout: 15000,
  });
  await checkTheme(voiceId, theme);
  await expect(voiceId.locator('.seams-review-amount')).toHaveText('10 NEAR');
  await expect(voiceId.getByRole('link', { name: 'View transaction' })).toHaveAttribute(
    'href',
    'https://nearblocks.io/',
  );
  await voiceId.getByText('Receipt details', { exact: true }).click();
  const transactionId = await voiceId.locator('.seams-review-hash').getAttribute('title');
  assert.match(transactionId, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  await expect(voiceId.getByText('alex.near', { exact: true })).toBeVisible();
  await voiceId.getByText('Receipt details', { exact: true }).click();
  await capture(gallery, `${name}-receipt`);
  await voiceId.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(confirm).toBeVisible();
  return { phrase: phraseText, ...review };
}

async function cancelAttempt(page, gallery, phase) {
  const voiceId = gallery.frameLocator('iframe[title="VoiceID"]');
  const confirm = voiceId.getByRole('button', { name: 'Confirm with VoiceID', exact: true });
  await confirm.click();
  await expect(voiceId.locator('.seams-voiceid-prompt')).toHaveAttribute('data-trade-stage', phase);
  await voiceId.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toBeVisible();
  // An old callback must not publish a receipt after its attempt was cancelled.
  await page.waitForTimeout(6500);
  await expect(confirm).toBeVisible();
  await expect(voiceId.locator('.seams-voiceid-prompt')).toHaveCount(0);
  await expect(voiceId.getByRole('status').filter({ hasText: 'Transaction complete' })).toHaveCount(
    0,
  );
}

async function checkPlaybackPause(page, gallery) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await gallery.getByRole('button', { name: 'Play playback', exact: true }).click();
  await page.mouse.move(5, 5);
  const voiceId = gallery.frameLocator('iframe[title="VoiceID"]');
  await expect(voiceId.getByRole('status')).toHaveText('Preparing confirmation…');
  await gallery.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await expect(voiceId.locator('html')).toHaveAttribute('data-showcase-clock', 'paused');
  await page.waitForTimeout(1800);
  await expect(voiceId.getByRole('status')).toHaveText('Preparing confirmation…');
  await gallery.getByRole('button', { name: 'Play playback', exact: true }).click();
  await page.mouse.move(5, 5);
  await expect(voiceId.getByText('Sell ten NEAR.', { exact: true })).toBeVisible();
  await expect(voiceId.getByRole('status')).toContainText('Transaction complete', {
    timeout: 15000,
  });
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: 'reduce',
});
await context.exposeBinding('reportVoiceDemoMicrophoneRequest', recordMicrophoneRequest);
await context.addInitScript(blockDemoMicrophone);
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
  const themedApprovals = [];
  for (const theme of themes) {
    await page
      .getByRole('group', { name: 'Preview theme', exact: true })
      .getByRole('button', { name: theme.label, exact: true })
      .click();
    await gallery.scrollIntoViewIfNeeded();
    await expect(gallery.locator('iframe[title="VoiceID"]')).toHaveAttribute(
      'src',
      new RegExp(`theme=${theme.id}$`),
    );
    const approval = await approve(gallery, `desktop-${theme.id}`, theme);
    themedApprovals.push({ theme: theme.id, ...approval });
  }

  await cancelAttempt(page, gallery, 'preparing');
  await cancelAttempt(page, gallery, 'listening');

  const layouts = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await gallery.scrollIntoViewIfNeeded();
    const approval = await approve(gallery, `mobile-${width}`, pastelDarkTheme);
    layouts.push({ width, ...approval });
  }
  await checkPlaybackPause(page, gallery);
  assert.deepEqual(errors, []);
  assert.deepEqual(modelRequests, []);
  assert.deepEqual(apiRequests, []);
  assert.equal(microphoneRequests, 0);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        origin,
        voiceIdApprovalToReceipt: true,
        trade: {
          network: 'NEAR',
          sell: '10 NEAR',
          receive: 'USDC',
          minimumReceived: '28.40 USDC',
          signer: 'alex.near',
        },
        themedApprovals,
        cancelledDuringPreparationAndCapture: true,
        playbackPauseAndResume: true,
        layouts,
        errors,
        modelRequests,
        apiRequests,
        microphoneRequests,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Passed transaction-specific VoiceID preview, cancellation, playback, themes, and mobile layouts without model or microphone use.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
