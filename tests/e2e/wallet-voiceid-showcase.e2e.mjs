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
    background: 'rgb(37, 47, 55)',
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
  if (/\/showcase\/voiceid\//.test(location.pathname)) {
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
    /\/showcase\/voiceid\//.test(request.frame().url()) &&
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

function pageLayout() {
  return {
    viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
    pageFits: document.documentElement.scrollWidth <= innerWidth,
  };
}

/** The gallery frame on the wallet page, or the showcase page opened on its own. */
function galleryView(gallery) {
  return {
    root: gallery.frameLocator('iframe[title="VoiceID"]'),
    layout: () => gallery.evaluate(getLayout),
    screenshot: (path) => gallery.screenshot({ path }),
  };
}

function pageView(page) {
  return {
    root: page,
    layout: () => page.evaluate(pageLayout),
    screenshot: (path) => page.screenshot({ path }),
  };
}

async function capture(view, name, selector = '.seams-confirmation-modal--hosted') {
  const layout = await view.layout();
  const card = await view.root.locator(selector).boundingBox();
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
  await view.screenshot(`${artifacts}/${name}.png`);
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

async function checkVoiceTheme(voiceId, theme) {
  await checkTheme(voiceId, theme);
  await expect(voiceId.locator('[data-voiceid-phrase]')).toHaveCSS('color', theme.text);
}

async function checkReview(view, name, theme) {
  const voiceId = view.root;
  await checkTheme(voiceId, theme);
  await expect(voiceId.locator('.seams-review-eyebrow')).toHaveText('Swap NEAR for USDC');
  await expect(
    voiceId.getByRole('heading', { name: 'Review your trade', exact: true }),
  ).toBeVisible();
  await expect(voiceId.locator('.seams-review-amount')).toHaveText('10 NEAR');
  await expect(voiceId.locator('.seams-review-account')).toContainText('alex.near');
  await expect(
    voiceId.locator('.seams-review-fields').getByText('NEAR', { exact: true }),
  ).toBeVisible();
  await expect(voiceId.getByText('0.00005 NEAR', { exact: true })).toBeVisible();
  // No voice check runs before the visitor confirms the trade.
  await expect(voiceId.locator('.seams-voiceid-prompt')).toHaveCount(0);
  return capture(view, `${name}-review`);
}

// The demo's VoiceID session has run out, so Confirm with VoiceID steps it up inside the
// confirm card, and the receipt then takes over the same card.
async function confirmWithVoice(view, name, theme) {
  const voiceId = view.root;
  const confirm = voiceId.getByRole('button', { name: 'Confirm with VoiceID', exact: true });
  await expect(confirm).toBeVisible({ timeout: 10000 });
  const review = await checkReview(view, name, theme);
  await confirm.click();
  const stepUp = voiceId.locator('.seams-confirmation-modal .seams-voiceid-prompt');
  await expect(stepUp).toBeVisible();
  await expect(voiceId.getByText('Read aloud', { exact: true })).toBeVisible();
  await expect(voiceId.getByText('shop.example.com', { exact: true })).toBeVisible();
  const phrase = voiceId.locator('[data-voiceid-phrase]');
  await expect(phrase).toHaveText('The market is open.');
  const spoken = await phrase.textContent();
  await expect(voiceId.getByRole('status')).toHaveText('Listening');
  await checkVoiceTheme(voiceId, theme);
  await capture(view, `${name}-voice`);
  await expect(voiceId.getByRole('status')).toHaveText('Checking your voice…', { timeout: 10000 });
  await expect(voiceId.getByRole('status')).toContainText('Transaction complete', {
    timeout: 15000,
  });
  await expect(stepUp).toHaveCount(0);
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
  await capture(view, `${name}-receipt`);
  await voiceId.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(confirm).toBeVisible();
  return { phrase: spoken, ...review };
}

async function cancelVoice(page, gallery) {
  const voiceId = gallery.frameLocator('iframe[title="VoiceID"]');
  const confirm = voiceId.getByRole('button', { name: 'Confirm with VoiceID', exact: true });
  for (const phase of ['listening', 'checking']) {
    await confirm.click();
    await expect(voiceId.locator('.seams-voiceid-prompt')).toHaveAttribute(
      'data-trade-stage',
      phase,
      { timeout: 10000 },
    );
    await voiceId.locator('.seams-review-toolbar button').last().click();
    // Closing the card during the voice check returns to the review and leaves the trade unsigned.
    await expect(confirm).toBeVisible();
    await page.waitForTimeout(5000);
    await expect(voiceId.locator('.seams-voiceid-prompt')).toHaveCount(0);
    await expect(
      voiceId.getByRole('status').filter({ hasText: 'Transaction complete' }),
    ).toHaveCount(0);
  }
  // Closing the review opens a fresh one.
  await voiceId.locator('.seams-review-toolbar button').last().click();
  await expect(confirm).toBeVisible();
  await expect(voiceId.locator('.seams-voiceid-prompt')).toHaveCount(0);
}

async function checkPlaybackPause(page, gallery) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  // The canvas clock runs only while 30% of its viewport is visible, and the resize can move it out.
  const canvas = gallery.locator('.component-showcase__viewport');
  await canvas.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(canvas).toHaveAttribute('data-in-view', 'true');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await gallery.getByRole('button', { name: 'Play playback', exact: true }).click();
  await page.mouse.move(5, 5);
  const voiceId = gallery.frameLocator('iframe[title="VoiceID"]');
  // Playback presses Confirm with VoiceID first; the voice check follows in the card.
  await expect(voiceId.getByRole('status')).toHaveText('Listening', { timeout: 10000 });
  await gallery.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await expect(voiceId.locator('html')).toHaveAttribute('data-showcase-clock', 'paused');
  await page.waitForTimeout(1800);
  await expect(voiceId.getByRole('status')).toHaveText('Listening');
  await gallery.getByRole('button', { name: 'Play playback', exact: true }).click();
  await page.mouse.move(5, 5);
  await expect(voiceId.getByText('The market is open.', { exact: true })).toBeVisible();
  await expect(voiceId.getByRole('status')).toContainText('Transaction complete', {
    timeout: 20000,
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
  const view = galleryView(gallery);
  await gallery.scrollIntoViewIfNeeded();
  const source = await gallery.locator('iframe[title="VoiceID"]').getAttribute('src');
  const showcaseUrl = new URL(source, origin);
  const galleryTheme =
    themes.find((theme) => theme.id === showcaseUrl.searchParams.get('theme')) ?? themes[0];
  const galleryRun = await confirmWithVoice(view, `gallery-${galleryTheme.id}`, galleryTheme);

  await cancelVoice(page, gallery);

  const layouts = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await gallery.scrollIntoViewIfNeeded();
    const run = await confirmWithVoice(view, `mobile-${width}`, galleryTheme);
    layouts.push({ width, ...run });
  }
  await checkPlaybackPause(page, gallery);

  // Each theme on the showcase page that the gallery frames.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  const themedRuns = [];
  for (const theme of themes) {
    showcaseUrl.searchParams.set('theme', theme.id);
    await page.goto(showcaseUrl.href);
    themedRuns.push({
      theme: theme.id,
      ...(await confirmWithVoice(pageView(page), `page-${theme.id}`, theme)),
    });
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(showcaseUrl.href);
    themedRuns.push({
      width,
      ...(await confirmWithVoice(pageView(page), `page-${width}`, pastelDarkTheme)),
    });
  }
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
        reviewThenInCardVoiceStepUpToReceipt: true,
        voiceStepUpOnlyForExpiredSession: true,
        trade: {
          network: 'NEAR',
          sell: '10 NEAR',
          receive: 'USDC',
          minimumReceived: '28.40 USDC',
          signer: 'alex.near',
        },
        galleryRun,
        themedRuns,
        cancelledDuringCaptureAndChecking: true,
        voiceCancelReturnsToReview: true,
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
    'Passed the trade review, the in-card VoiceID step-up after Confirm, the receipt hand-over, cancellation, playback, themes, and mobile layouts without model or microphone use.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
