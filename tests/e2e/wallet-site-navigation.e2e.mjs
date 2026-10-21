import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_SITE_ORIGIN || 'http://localhost:4001';
const walletUrl = process.env.SEAMS_WALLET_SITE_ORIGIN || `${origin}/wallet`;
const artifacts =
  process.env.SEAMS_NAVIGATION_ARTIFACTS || 'output/playwright/wallet-site-navigation';
const pricingTitle = 'Free to start. Pay per active user.';
const entries = [];

async function openWallet(page) {
  await page.goto(walletUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Embedded wallets without the lock-in.',
  );
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function checkWalletLanguages(page) {
  const english = new URL(walletUrl);
  const base = english.pathname.replace(/\/$/, '');
  english.pathname = `${base}/`;
  english.searchParams.set('source', 'language-check');
  english.hash = 'wallet-security';
  const japanese = new URL(english);
  japanese.pathname = `${base}/ja/`;

  const response = await page.goto(japanese.href);
  assert.equal(response.status(), 200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('所有できるウォレット。');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await page.screenshot({ path: `${artifacts}/japanese-wallet.png`, fullPage: true });

  await page.evaluate(scrollToTop);
  const navbar = page.locator('.navbar-static');
  await navbar.getByRole('combobox', { name: '言語', exact: true }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(english.href);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Embedded wallets without the lock-in.',
  );
  await page.goBack();
  await expect(page).toHaveURL(japanese.href);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  const withoutSlash = new URL(japanese);
  withoutSlash.pathname = withoutSlash.pathname.slice(0, -1);
  await page.goto(withoutSlash.href);
  await expect(page).toHaveURL(japanese.href);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('combobox', { name: '言語', exact: true }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(english.href);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  entries.push({ source: 'wallet-language', url: japanese.href, refreshMatches: true });
}

async function checkPricing(page, hash, source) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pricingTitle);
  const address = new URL(page.url());
  assert.equal(address.origin, origin);
  assert.equal(address.pathname.replace(/\/$/, ''), '/pricing');
  assert.equal(address.hash, hash);
  if (hash) await expect(page.locator(hash)).toBeInViewport();
  const linkedContent = await page.locator('main').innerText();
  await page.screenshot({ path: `${artifacts}/${source}.png` });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pricingTitle);
  if (hash) await expect(page.locator(hash)).toBeInViewport();
  assert.equal(await page.locator('main').innerText(), linkedContent);
  entries.push({ source, url: page.url(), refreshMatches: true });
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  try {
    await checkWalletLanguages(page);
    await openWallet(page);
    await page.getByRole('button', { name: 'Pricing', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Compare plans', exact: true }).click();
    await checkPricing(page, '', 'desktop-compare');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Embedded wallets without the lock-in.',
    );
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(pricingTitle);

    for (const plan of [
      { name: /^Free /, hash: '#free', source: 'desktop-free' },
      { name: /^Growth /, hash: '#growth', source: 'desktop-growth' },
      { name: /^Enterprise /, hash: '#enterprise', source: 'desktop-enterprise' },
      { name: 'Estimate your price', hash: '#calculator', source: 'desktop-calculator' },
    ]) {
      await openWallet(page);
      await page.getByRole('button', { name: 'Pricing', exact: true }).click();
      await page.getByRole('menuitem', { name: plan.name }).click();
      await checkPricing(page, plan.hash, plan.source);
      await expect(page.locator(plan.hash)).toBeInViewport();
    }

    const users = page.getByRole('slider', { name: 'Monthly active users', exact: true });
    const before = await users.getAttribute('aria-valuetext');
    await users.focus();
    await users.press('ArrowRight');
    await expect(users).not.toHaveAttribute('aria-valuetext', before);

    await openWallet(page);
    await page.getByRole('button', { name: 'About Us', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Company Who we are/ }).click();
    await expect(page.locator('main[aria-labelledby="company-title"]')).toBeVisible();
    assert.equal(new URL(page.url()).pathname.replace(/\/$/, ''), '/company');
    assert.equal(new URL(page.url()).origin, origin);

    await openWallet(page);
    await page.getByRole('link', { name: 'Pricing', exact: true }).click();
    await checkPricing(page, '', 'footer');

    await page.setViewportSize({ width: 390, height: 844 });
    await openWallet(page);
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'Pricing', exact: true }).click();
    const freePlan = page.getByRole('link', { name: /^Free Up to 300/ });
    await freePlan.focus();
    await freePlan.press('Enter');
    await checkPricing(page, '#free', 'mobile-keyboard');

    await page.goto(origin);
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'Pricing', exact: true }).click();
    await page.getByRole('link', { name: /^Growth 5,000/ }).click();
    await checkPricing(page, '#growth', 'homepage');

    await writeFile(
      `${artifacts}/result.json`,
      JSON.stringify(
        {
          passed: true,
          siteOrigin: origin,
          walletUrl,
          entries,
          history: true,
          calculatorKeyboard: true,
          companyNavigation: true,
          walletLanguageNavigation: true,
        },
        null,
        2,
      ),
    );
    console.log(
      'Passed Japanese Wallet routing, navbar/footer language switching, pricing links, plan anchors, refresh, history, and keyboard navigation.',
    );
  } finally {
    await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  }
} finally {
  await browser.close();
}
