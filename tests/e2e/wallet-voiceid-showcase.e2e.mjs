import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet/';
const artifacts = '.artifacts/wallet-voiceid-showcase';
const errors = [];
const modelRequests = [];
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

function seedDemoPhrases() {
  if (location.pathname.includes('/showcase/voiceid/')) {
    Math.random = Number.bind(null, 0);
  }
}

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

async function approve(gallery, name, theme, previousPhrase) {
  const voiceId = gallery.frameLocator('iframe[title="VoiceID"]');
  const confirm = voiceId.getByRole('button', { name: 'Confirm with VoiceID', exact: true });
  await expect(confirm).toBeVisible();
  await checkTheme(voiceId, theme);
  const review = await capture(gallery, `${name}-review`);
  await confirm.click();
  const phrase = voiceId.locator('[data-voiceid-phrase]');
  await expect(phrase).toBeVisible();
  await expect(phrase).toHaveCSS('color', theme.text);
  const phraseText = await phrase.textContent();
  assert.ok(phraseText.length > 0);
  assert.notEqual(phraseText, previousPhrase);
  await expect(voiceId.getByRole('status')).toHaveText('Listening');
  await checkTheme(voiceId, theme);
  await capture(gallery, `${name}-prompt`);
  await expect(voiceId.getByRole('status')).toHaveText('Checking your voice…', { timeout: 10000 });
  await expect(voiceId.getByRole('status')).toContainText('Transaction complete', {
    timeout: 15000,
  });
  await checkTheme(voiceId, theme);
  await capture(gallery, `${name}-receipt`);
  await voiceId.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(confirm).toBeVisible();
  return { phrase: phraseText, ...review };
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: 'reduce',
});
await context.addInitScript(seedDemoPhrases);
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
    const approval = await approve(gallery, `desktop-${theme.id}`, theme, null);
    assert.equal(approval.phrase, 'No crying in the casino.');
    themedApprovals.push({ theme: theme.id, ...approval });
  }

  // Cancelling a prompt returns to review; the next approval gets a new phrase.
  await confirm.click();
  const cancelledPhrase = await voiceId.locator('[data-voiceid-phrase]').textContent();
  await voiceId.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toBeVisible();

  const layouts = [];
  let previousPhrase = cancelledPhrase;
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await gallery.scrollIntoViewIfNeeded();
    const approval = await approve(gallery, `mobile-${width}`, pastelDarkTheme, previousPhrase);
    layouts.push({ width, ...approval });
    previousPhrase = approval.phrase;
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
        themedApprovals,
        cancelledPhrase,
        layouts,
        errors,
        modelRequests,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Passed VoiceID phrase changes, four SDK themes, receipts, mobile layouts, and zero model downloads.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
