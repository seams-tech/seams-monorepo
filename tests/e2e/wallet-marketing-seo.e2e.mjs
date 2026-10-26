import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const target = process.env.SEAMS_WALLET_SITE_ORIGIN;
assert.ok(target, 'Set SEAMS_WALLET_SITE_ORIGIN to the deployed staging Wallet origin');
const origin = new URL(target).origin;
const artifacts = fileURLToPath(new URL('../../output/playwright/wallet-marketing-seo', import.meta.url));
const paths = ['/', '/ja/', '/pricing/', '/ja/pricing/', '/features/', '/ja/features/'];
const results = [];
let passed = false;

function requireNoindex(response) {
  assert.match(response.headers()['x-robots-tag'] || '', /\bnoindex\b/, response.url());
}

async function saveResponse(response, name) {
  const body = await response.text();
  await writeFile(`${artifacts}/${name}.html`, body);
  results.push({
    url: response.url(),
    status: response.status(),
    contentType: response.headers()['content-type'],
    robots: response.headers()['x-robots-tag'],
    location: response.headers().location,
  });
  return body;
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ javaScriptEnabled: false });
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  const sitemap = await context.request.get(`${origin}/sitemap.xml`);
  await saveResponse(sitemap, 'sitemap');
  assert.equal(sitemap.status(), 200);
  const sitemapXml = await sitemap.text();
  const robots = await context.request.get(`${origin}/robots.txt`);
  const robotsText = await saveResponse(robots, 'robots');
  assert.equal(robots.status(), 200);
  assert.ok(robotsText.includes(`Sitemap: ${origin}/sitemap.xml`));

  for (const [index, path] of paths.entries()) {
    const response = await page.goto(`${origin}${path}`);
    assert.ok(response);
    await saveResponse(response, `page-${index}`);
    assert.equal(response.status(), 200, path);
    requireNoindex(response);
    const canonical = `${origin}${path}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
    await expect(page.locator('html')).toHaveAttribute('lang', path.startsWith('/ja/') ? 'ja' : 'en');
    assert.ok(sitemapXml.includes(`<loc>${canonical}</loc>`), path);
    const englishPath = path.replace(/^\/ja\//, '/');
    await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', `${origin}${englishPath}`);
    await expect(page.locator('link[hreflang="ja"]')).toHaveAttribute('href', `${origin}/ja${englishPath}`);
    if (path === '/') await expect(page).toHaveTitle('Embedded Wallet SDK with Passkeys | Seams');
  }

  const redirect = await context.request.get(`${origin}/pricing`, { maxRedirects: 0 });
  await saveResponse(redirect, 'redirect');
  assert.ok([301, 308].includes(redirect.status()));
  assert.equal(new URL(redirect.headers().location, origin).href, `${origin}/pricing/`);

  const queryResponse = await page.goto(`${origin}/ja/pricing/?utm_source=seo-acceptance`);
  assert.ok(queryResponse);
  assert.equal(queryResponse.status(), 200);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${origin}/ja/pricing/`);

  const missing = await page.goto(`${origin}/seo-acceptance-missing-page`);
  assert.ok(missing);
  await saveResponse(missing, 'missing');
  assert.equal(missing.status(), 404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await page.screenshot({ path: `${artifacts}/404.png` });

  const showcase = await page.goto(`${origin}/showcase/account/`);
  assert.ok(showcase);
  await saveResponse(showcase, 'showcase');
  assert.equal(showcase.status(), 200);
  requireNoindex(showcase);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  passed = true;
} finally {
  await writeFile(`${artifacts}/result.json`, JSON.stringify({ origin, passed, results }, null, 2));
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
