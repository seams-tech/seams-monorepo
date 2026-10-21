import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://127.0.0.1:4018';
const artifacts = 'output/playwright/wallet-marketing-i18n';
const entries = [];

async function unavailableDiscovery(route) {
  await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Demo unavailable' });
}

function hasHorizontalOverflow() {
  return document.documentElement.scrollWidth > window.innerWidth;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function selectLanguage(page, currentLabel, optionLabel) {
  const selector = page.getByRole('combobox', { name: currentLabel, exact: true });
  await selector.scrollIntoViewIfNeeded();
  await selector.focus();
  await selector.press('Enter');
  const option = page.getByRole('option', { name: optionLabel, exact: true });
  await expect(option).toBeVisible();
  await option.press('Enter');
}

async function checkJapanesePage(page, viewport) {
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('パスキーで開くウォレット');
  await expect(
    page.getByRole('status').filter({ hasText: 'ライブデモを一時的にご利用いただけません。' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'ドキュメント（英語）', exact: true }),
  ).toHaveAttribute('href', /\/docs\/concepts\/$/);
  const footer = page.getByRole('contentinfo');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('combobox', { name: '言語', exact: true })).toHaveText('日本語');
  const question = footer.getByRole('button', { name: 'デバイスを紛失した場合は？', exact: true });
  await question.focus();
  await question.press('Enter');
  await expect(question).toHaveAttribute('aria-expanded', 'true');
  const answer = footer.getByRole('region', { name: 'デバイスを紛失した場合は？', exact: true });
  await expect(answer).toBeVisible();
  await expect(answer).toContainText('ウォレットとアドレスは変わらない');
  await question.press('Escape');
  await expect(question).toBeFocused();
  assert.equal(await page.evaluate(hasHorizontalOverflow), false);
  await footer.screenshot({ path: `${artifacts}/${viewport}-ja-footer.png` });

  const selector = footer.getByRole('combobox', { name: '言語', exact: true });
  await selector.press('Enter');
  await expect(page.getByRole('option', { name: '日本語', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.screenshot({ path: `${artifacts}/${viewport}-ja-language-menu.png` });
  await page.keyboard.press('Escape');
  await expect(selector).toBeFocused();
  entries.push({ viewport, url: page.url(), japanese: true, overflow: false, keyboard: true });
}

async function checkPreviews(page) {
  const choices = page.getByRole('radiogroup', { name: 'コンポーネント', exact: true });
  await choices.scrollIntoViewIfNeeded();
  await choices.getByRole('radio', { name: '認証', exact: true }).locator('..').click();
  const authentication = page.frameLocator('iframe[data-preview="create"]');
  await expect(authentication.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(authentication.getByText('ウォレットを作成', { exact: true })).toBeVisible();
  await choices.getByRole('radio', { name: '独自のUI', exact: true }).locator('..').click();
  const checkout = page.frameLocator('iframe[data-preview="prediction-market"]');
  await expect(
    checkout.getByRole('heading', {
      name: 'AP Royal Oakはサザビーズの予想価格を上回る？',
      exact: true,
    }),
  ).toBeVisible();
  await checkout.getByRole('button', { name: '購入 はい', exact: false }).click();
  await expect(
    checkout.getByRole('heading', { name: '購入内容を確認', exact: true }),
  ).toBeVisible();
  await checkout.getByRole('button', { name: '市場に戻る', exact: true }).click();
  await expect(checkout.getByRole('status')).toHaveText('購入画面を閉じました。');

  const security = page.locator('#wallet-security');
  await security.scrollIntoViewIfNeeded();
  const signing = page.frameLocator('iframe[data-figure="signing"]');
  await expect(signing.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(signing.locator('svg')).toContainText('ユーザーのデバイス');
  await expect(signing.locator('#stage')).toHaveAttribute(
    'aria-label',
    '独立した2つの鍵シェアによる取引の認可を表示',
  );
  await page.screenshot({ path: `${artifacts}/desktop-ja-security.png` });
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    locale: 'ja-JP',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.route('**/.well-known/seams-tenant-deployment.json', unavailableDiscovery);
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/?campaign=language-test#wallet-security`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Wallets that open with a passkey',
    );
    await selectLanguage(page, 'Language', '日本語');
    await expect(page).toHaveURL(`${origin}/ja/?campaign=language-test#wallet-security`);
    await checkJapanesePage(page, 'desktop');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('パスキーで開くウォレット');
    await checkPreviews(page);
    await selectLanguage(page, '言語', 'English');
    await expect(page).toHaveURL(`${origin}/?campaign=language-test#wallet-security`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Wallets that open with a passkey',
    );
    await page.goBack();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await page.goForward();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/ja/`);
    await checkJapanesePage(page, 'mobile');
    await page.evaluate(scrollToTop);
    await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
    await expect(page.getByRole('button', { name: 'プロダクト', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'プロダクト', exact: true }).click();
    await expect(page.getByRole('link', { name: /^組み込みウォレット / })).toHaveAttribute(
      'href',
      `${origin}/ja/`,
    );
    await page.getByRole('button', { name: 'メニューを閉じる', exact: true }).click();
    await page.screenshot({ path: `${artifacts}/mobile-ja-page.png`, fullPage: true });

    await page.setViewportSize({ width: 720, height: 900 });
    assert.equal(await page.evaluate(hasHorizontalOverflow), false);
    await page.getByRole('contentinfo').screenshot({ path: `${artifacts}/zoom-ja-footer.png` });

    const japaneseResponse = await page.request.get(`${origin}/ja/`);
    const japaneseHtml = await japaneseResponse.text();
    assert.equal(japaneseResponse.status(), 200);
    assert.match(japaneseHtml, /<html lang="ja"/);
    assert.match(japaneseHtml, /パスキーで使えるウォレット/);
    assert.match(japaneseHtml, /hreflang="x-default"/);
    const sitemap = await page.request.get(`${origin}/sitemap.xml`);
    assert.match(await sitemap.text(), /\/ja\//);
    await page.goto(`${origin}/ja?campaign=direct`);
    await expect(page).toHaveURL(`${origin}/ja/?campaign=direct`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await writeFile(
      `${artifacts}/result.json`,
      JSON.stringify(
        {
          passed: true,
          origin,
          entries,
          directJapanese: true,
          queryAndAnchor: true,
          refreshAndHistory: true,
          translatedPreviews: true,
          unavailableDemo: true,
          staticMetadata: true,
          sitemap: true,
        },
        null,
        2,
      ),
    );
    console.log(
      'Passed English/Japanese routes, keyboard switching, history, previews, FAQ, mobile layout, outage, and static metadata.',
    );
  } finally {
    await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  }
} finally {
  await browser.close();
}
