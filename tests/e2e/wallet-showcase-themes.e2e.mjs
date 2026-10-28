import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet/';
const artifacts = '.artifacts/wallet-showcase-themes';
const themes = [
  { id: 'paper', label: 'Paper', mode: 'light' },
  { id: 'carbon', label: 'Carbon', mode: 'dark' },
  { id: 'pastel', label: 'Pastel', mode: 'light' },
  { id: 'pastel-dark', label: 'Pastel Dark', mode: 'dark' },
];

function surfaceColors(element) {
  const style = getComputedStyle(element);
  return { background: style.backgroundColor, text: style.color };
}

function successColors(element) {
  const check = element.querySelector('.authentication-result__check');
  const seal = element.querySelector('.authentication-result__seal');
  const arc = element.querySelector('.authentication-result__arc');
  const icon = element.querySelector('.authentication-result__icon');
  const next = element.querySelector('[data-showcase-next]');
  const reset = element.querySelector('[data-authentication-reset]');
  const probe = document.createElement('span');
  element.append(probe);
  const tokens = {};
  for (const name of ['buttonBackground', 'textButton', 'secondaryButtonBackground', 'secondaryButtonText']) {
    probe.style.color = `var(--seams-colors-${name})`;
    tokens[name] = getComputedStyle(probe).color;
  }
  probe.remove();
  return {
    foreground: getComputedStyle(check).stroke,
    background: getComputedStyle(seal).fill,
    arc: getComputedStyle(arc).stroke,
    ripple: getComputedStyle(icon, '::after').borderTopColor,
    nextBackground: getComputedStyle(next).backgroundColor,
    nextText: getComputedStyle(next).color,
    resetBackground: getComputedStyle(reset).backgroundColor,
    resetText: getComputedStyle(reset).color,
    tokens,
  };
}

function assertSuccessTheme(success) {
  assert.equal(success.background, success.tokens.buttonBackground);
  assert.equal(success.arc, success.tokens.buttonBackground);
  assert.equal(success.ripple, success.tokens.buttonBackground);
  assert.equal(success.foreground, success.tokens.textButton);
  assert.equal(success.nextBackground, success.tokens.buttonBackground);
  assert.equal(success.nextText, success.tokens.textButton);
  assert.equal(success.resetBackground, success.tokens.secondaryButtonBackground);
  assert.equal(success.resetText, success.tokens.secondaryButtonText);
}

function progressColors(container) {
  const background = getComputedStyle(container).backgroundColor;
  const steps = [];
  for (const step of container.querySelectorAll('.seams-receipt-step')) {
    const track = step.querySelector('.seams-receipt-track');
    steps.push({
      label: step.textContent.trim(),
      state: step.dataset.state,
      text: getComputedStyle(step).color,
      bar: getComputedStyle(track, '::after').backgroundColor,
    });
  }
  return { background, steps };
}

function positionForCapture(gallery) {
  const viewport = gallery.querySelector('.component-showcase__viewport');
  window.scrollTo({
    top: scrollY + viewport.getBoundingClientRect().top - 120,
    behavior: 'instant',
  });
}

function linearChannel(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  assert.match(color, /^rgb\(/);
  const [red, green, blue] = color
    .match(/[\d.]+/g)
    .map(Number)
    .map(linearChannel);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function verifyTheme(page, gallery, theme, width) {
  await page.setViewportSize({ width, height: 1100 });
  await page
    .getByRole('group', { name: 'Preview theme', exact: true })
    .getByRole('button', { name: theme.label, exact: true })
    .click();
  await gallery.getByRole('radio', { name: 'Authentication', exact: true }).locator('..').click();
  await gallery.scrollIntoViewIfNeeded();
  const authentication = gallery.frameLocator('iframe[title="Authentication"]');
  await expect(authentication.locator('.seams-auth-menu-surface')).toHaveAttribute(
    'data-theme',
    theme.mode,
  );
  const menuColors = await authentication
    .locator('.seams-signup-menu-root')
    .evaluate(surfaceColors);
  await authentication.getByRole('button', { name: 'Create wallet with passkey' }).click();
  await expect(authentication.getByRole('heading', { name: 'Wallet created' })).toBeVisible();
  const result = authentication.locator('.authentication-result');
  assert.deepEqual(await result.evaluate(surfaceColors), menuColors);
  const success = await result.evaluate(successColors);
  assertSuccessTheme(success);
  const successContrast = contrast(success.foreground, success.background);
  assert.ok(successContrast >= 3, `Success check contrast: ${successContrast}`);
  await gallery.evaluate(positionForCapture);
  await result.screenshot({ path: `${artifacts}/${theme.id}-${width}-created.png` });

  // Reset must retain the selected theme, and Next must open a matching transaction.
  await authentication.getByRole('button', { name: 'Start over', exact: true }).click();
  assert.deepEqual(
    await authentication.locator('.seams-signup-menu-root').evaluate(surfaceColors),
    menuColors,
  );
  await authentication.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
  await authentication.getByRole('button', { name: /(?:Continue|Unlock) with passkey/ }).click();
  await expect(authentication.getByRole('heading', { name: "You're in", exact: true })).toBeVisible();
  const loginSuccess = await result.evaluate(successColors);
  assertSuccessTheme(loginSuccess);
  assert.deepEqual(loginSuccess, success);
  await result.screenshot({ path: `${artifacts}/${theme.id}-${width}-unlocked.png` });
  await authentication.getByRole('button', { name: 'Start over', exact: true }).click();
  await authentication.getByRole('button', { name: 'Create wallet with passkey' }).click();
  await authentication.getByRole('button', { name: 'Next', exact: true }).click();
  const transaction = gallery.frameLocator('iframe[title="Transaction modal"]');
  await expect(transaction.locator('.seams-confirmation-surface')).toHaveAttribute(
    'data-theme',
    theme.mode,
  );
  await transaction.getByRole('button', { name: 'Confirm with passkey', exact: true }).click();
  await expect(transaction.getByRole('status')).toContainText('Transaction complete', {
    timeout: 15000,
  });
  const symbol = transaction.locator('.seams-receipt-symbol');
  const receiptColors = await symbol.evaluate(surfaceColors);
  const receiptContrast = contrast(receiptColors.text, receiptColors.background);
  assert.ok(receiptContrast >= 3, `Receipt check contrast: ${receiptContrast}`);
  const progress = await transaction.locator('.modal-container-root').evaluate(progressColors);
  if (theme.mode === 'dark') {
    assert.deepEqual(progress.steps.map(progressLabel), ['Signed', 'Broadcast', 'Confirmed']);
    for (const step of progress.steps) {
      assert.equal(step.state, 'complete');
      assert.ok(contrast(step.text, progress.background) >= 4.5, `${step.label} label contrast`);
      assert.ok(contrast(step.bar, progress.background) >= 3, `${step.label} bar contrast`);
    }
  }
  await gallery.evaluate(positionForCapture);
  await transaction.locator('.modal-container-root').screenshot({
    path: `${artifacts}/${theme.id}-${width}-receipt.png`,
  });
  await transaction.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    transaction.getByRole('button', { name: 'Confirm with passkey', exact: true }),
  ).toBeVisible();
  return {
    theme: theme.id,
    width,
    success,
    loginSuccess,
    successContrast,
    receiptColors,
    receiptContrast,
    progress,
  };
}

function progressLabel(step) {
  return step.label;
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ reducedMotion: 'reduce' });
context.setDefaultTimeout(15000);
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  await page.goto(origin);
  const gallery = page.getByRole('region', {
    name: 'Use built-in wallet components, or use your own.',
    exact: true,
  });
  const results = [];
  for (const theme of themes) {
    results.push(await verifyTheme(page, gallery, theme, 1440));
  }
  for (const width of [390, 320]) {
    results.push(await verifyTheme(page, gallery, themes[1], width));
  }
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify({ passed: true, origin, results }, null, 2) + '\n',
  );
  console.log('Passed themed registration, reset, receipt contrast, and mobile flows.');
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
