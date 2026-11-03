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

async function checkUnlockTheme(voiceId, theme) {
  const prompt = voiceId.locator('.seams-voiceid-prompt');
  await expect(prompt).toHaveCSS('background-color', theme.background);
  await expect(voiceId.locator('[data-voiceid-phrase]')).toHaveCSS('color', theme.text);
}

// A VoiceID unlock opens a signing session; the trade then needs only its Confirm.
async function unlockAndSign(view, name, theme) {
  const voiceId = view.root;
  const unlock = voiceId.getByRole('dialog', { name: 'Unlock with VoiceID', exact: true });
  await expect(unlock).toBeVisible();
  const phrase = voiceId.locator('[data-voiceid-phrase]');
  await expect(phrase).toHaveText('The market is open.');
  await expect(voiceId.getByRole('status')).toHaveText('Listening');
  await checkUnlockTheme(voiceId, theme);
  await capture(view, `${name}-unlock`, '.seams-voiceid-prompt');
  await expect(voiceId.getByRole('status')).toHaveText('Checking your voice…', { timeout: 10000 });
  await expect(voiceId.getByText('Your wallet is unlocked.', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  const confirm = voiceId.getByRole('button', { name: 'Confirm trade', exact: true });
  await expect(confirm).toBeVisible({ timeout: 10000 });
  await expect(unlock).toHaveCount(0);
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
  const review = await capture(view, `${name}-review`);
  await confirm.click();
  await expect(voiceId.locator('.seams-voiceid-prompt')).toHaveCount(0);
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
  await capture(view, `${name}-receipt`);
  await voiceId.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(unlock).toBeVisible();
  return { phrase: await phrase.textContent(), ...review };
}

async function cancelUnlock(page, gallery) {
  const voiceId = gallery.frameLocator('iframe[title="VoiceID"]');
  for (const phase of ['listening', 'checking']) {
    await expect(voiceId.locator('.seams-voiceid-prompt')).toHaveAttribute(
      'data-trade-stage',
      phase,
      { timeout: 10000 },
    );
    await voiceId.getByRole('button', { name: 'Cancel', exact: true }).click();
    const retry = voiceId.getByRole('button', { name: 'Try again', exact: true });
    await expect(retry).toBeVisible();
    // An old callback must not unlock after its attempt was cancelled.
    await page.waitForTimeout(5000);
    await expect(retry).toBeVisible();
    await expect(
      voiceId.getByRole('heading', { name: 'Review your trade', exact: true }),
    ).toHaveCount(0);
    await retry.click();
  }
  const confirm = voiceId.getByRole('button', { name: 'Confirm trade', exact: true });
  await expect(confirm).toBeVisible({ timeout: 10000 });
  // Cancelling the trade locks the wallet again.
  await voiceId.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(voiceId.getByRole('status')).toHaveText('Listening');
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
  await expect(voiceId.getByRole('status')).toHaveText('Listening');
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
  const galleryRun = await unlockAndSign(view, `gallery-${galleryTheme.id}`, galleryTheme);

  await cancelUnlock(page, gallery);

  const layouts = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await gallery.scrollIntoViewIfNeeded();
    const run = await unlockAndSign(view, `mobile-${width}`, galleryTheme);
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
      ...(await unlockAndSign(pageView(page), `page-${theme.id}`, theme)),
    });
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(showcaseUrl.href);
    themedRuns.push({
      width,
      ...(await unlockAndSign(pageView(page), `page-${width}`, pastelDarkTheme)),
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
        voiceIdUnlockThenConfirmToReceipt: true,
        voiceCheckPerTransaction: false,
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
        tradeCancelLocksAgain: true,
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
    'Passed the VoiceID unlock, the plain trade confirmation, cancellation, playback, themes, and mobile layouts without model or microphone use.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
