import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const target = process.env.SEAMS_SEO_TARGET;
assert.ok(
  ['artifact-production', 'artifact-staging', 'production', 'staging'].includes(target),
  'Set SEAMS_SEO_TARGET to artifact-production, artifact-staging, production, or staging',
);
assert.ok(process.env.SEAMS_WALLET_SITE_ORIGIN, 'Set SEAMS_WALLET_SITE_ORIGIN');
assert.match(
  process.env.SEAMS_WALLET_DOCS_REVISION || '',
  /^[0-9a-f]{40}$/,
  'Set SEAMS_WALLET_DOCS_REVISION to the selected public docs commit',
);
const origin = new URL(process.env.SEAMS_WALLET_SITE_ORIGIN).origin;
const canonicalOrigin = new URL(process.env.SEAMS_WALLET_CANONICAL_ORIGIN || origin).origin;
const noindex = target.endsWith('staging');
const artifacts = fileURLToPath(
  new URL(`../../output/playwright/wallet-marketing-seo/${target}/`, import.meta.url),
);
const paths = ['/', '/ja/', '/pricing/', '/ja/pricing/', '/features/', '/ja/features/'];
const responses = [];
const browserErrors = [];
const metrics = [];
let passed = false;
let failure = null;

async function saveResponse(response, name) {
  assert.ok(response, name);
  const body = await response.text();
  await writeFile(`${artifacts}/${name}.txt`, body);
  responses.push({ url: response.url(), status: response.status(), headers: response.headers() });
  return body;
}

function assertIndexing(response, excluded) {
  const directive = response.headers()['x-robots-tag'] || '';
  assert.equal(/\bnoindex\b/.test(directive), excluded, `${response.url()}: ${directive}`);
}

async function inspectPage(page, path, sitemap) {
  const response = await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
  const html = await saveResponse(response, `page-${path.replaceAll('/', '_')}`);
  assert.equal(response.status(), 200, path);
  assertIndexing(response, noindex);
  assert.ok(html.includes('data-rendered="true"'), `${path}: missing build-rendered content`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  assert.ok(
    (await page.locator('#root').innerText()).length > 1000,
    `${path}: missing product content`,
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${canonicalOrigin}${path}`,
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
  await expect(page.locator('html')).toHaveAttribute('lang', path.startsWith('/ja/') ? 'ja' : 'en');
  assert.ok(sitemap.includes(`<loc>${canonicalOrigin}${path}</loc>`), path);
  const englishPath = path.replace(/^\/ja\//, '/');
  await expect(page.locator('link[hreflang="en"]')).toHaveAttribute(
    'href',
    `${canonicalOrigin}${englishPath}`,
  );
  await expect(page.locator('link[hreflang="ja"]')).toHaveAttribute(
    'href',
    `${canonicalOrigin}/ja${englishPath}`,
  );
  await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute(
    'href',
    `${canonicalOrigin}${englishPath}`,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    `${canonicalOrigin}/wallet-social.png`,
  );
  const data = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  assert.equal(data['@type'], 'WebPage');
  assert.equal(data.url, `${canonicalOrigin}${path}`);
  assert.equal(data.name, await page.title());
  await expect(page.locator('footer a[href*="/docs/"]:visible').first()).toBeVisible();
}

function recordPageError(error) {
  browserErrors.push(error.message);
}

function recordConsoleError(message) {
  if (
    message.type() === 'error' &&
    /hydrat|Minified React error|didn't match/i.test(message.text())
  ) {
    browserErrors.push(message.text());
  }
}

async function unavailableDiscovery(route) {
  await route.fulfill({
    status: 503,
    contentType: 'text/plain',
    body: 'Acceptance: Wallet service unavailable',
  });
}

function hasOverflow() {
  return document.documentElement.scrollWidth > window.innerWidth;
}

function collectPerformance() {
  const navigation = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource');
  let transferredBytes = 0;
  for (const resource of resources) transferredBytes += resource.transferSize;
  return {
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight },
    domContentLoadedMs: navigation.domContentLoadedEventEnd,
    transferredBytes: transferredBytes,
    resourceCount: resources.length,
  };
}

async function checkInteractions(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(20000);
  const page = await context.newPage();
  page.on('pageerror', recordPageError);
  page.on('console', recordConsoleError);
  await page.route('**/.well-known/seams-tenant-deployment.json', unavailableDiscovery);
  try {
    for (const path of paths) {
      await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.locator('footer').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(hasOverflow), false, `${path}: mobile overflow`);
    }
    await page.goto(`${origin}/pricing/`);
    const slider = page.getByRole('slider').first();
    await slider.scrollIntoViewIfNeeded();
    const before = await slider.inputValue();
    await slider.focus();
    await slider.press('ArrowRight');
    assert.notEqual(await slider.inputValue(), before, 'Calculator must react after hydration');
    await page.locator('#calculator').screenshot({ path: `${artifacts}/calculator-mobile.png` });
    const contact = page
      .locator('#calculator')
      .getByRole('link', { name: 'Contact sales', exact: true });
    await contact.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.locator('footer').getByRole('combobox', { name: 'Language' }).click();
    await page.getByRole('option', { name: /日本語/ }).click();
    await expect(page).toHaveURL(/\/ja\/pricing\//);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(hasOverflow), false, 'Japanese pricing: 320px overflow');
    await page.screenshot({ path: `${artifacts}/pricing-mobile.png`, fullPage: true });
    metrics.push(await page.evaluate(collectPerformance));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/`);
    await expect(
      page.getByRole('status').filter({ hasText: 'The live demo is temporarily unavailable.' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.locator('#wallet-security').scrollIntoViewIfNeeded();
    await expect(page.locator('#wallet-security iframe[data-figure="signing"]')).toBeVisible();
    await page.screenshot({ path: `${artifacts}/home-outage.png`, fullPage: true });
    assert.deepEqual(browserErrors, [], 'Hydration and browser errors');
  } finally {
    await context.tracing.stop({ path: `${artifacts}/interactions-trace.zip` });
    await context.close();
  }
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CI ? 'chromium' : 'chrome' });
const context = await browser.newContext({ javaScriptEnabled: false });
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(20000);
  const page = await context.newPage();
  const sitemapResponse = await context.request.get(`${origin}/sitemap.xml`);
  const sitemap = await saveResponse(sitemapResponse, 'sitemap');
  assert.equal(sitemapResponse.status(), 200);
  const robotsResponse = await context.request.get(`${origin}/robots.txt`);
  const robots = await saveResponse(robotsResponse, 'robots');
  assert.equal(robotsResponse.status(), 200);
  assert.match(robotsResponse.headers()['content-type'] || '', /text\/plain/);
  assert.ok(robots.includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`));
  assert.ok(robots.includes(`Sitemap: ${canonicalOrigin}/docs/sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow:\s*\//);
  for (const path of paths) {
    console.log('Inspect original HTML:', path);
    await inspectPage(page, path, sitemap);
  }
  await page.goto(`${origin}/ja/pricing/`);
  await expect(page.getByRole('heading', { name: 'Growth', exact: true })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/pricing-no-javascript.png`, fullPage: true });
  await page.getByRole('link', { name: 'English', exact: true }).first().click();
  await expect(page).toHaveURL(`${origin}/pricing/`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const docsLink = await page
    .locator('footer a[href*="/docs/"]:visible')
    .first()
    .getAttribute('href');
  const docs = await context.request.get(
    new URL(docsLink, origin).pathname.startsWith('/docs/')
      ? `${origin}${new URL(docsLink, origin).pathname}`
      : `${origin}/docs/`,
  );
  assert.equal(docs.status(), 200);
  assertIndexing(docs, noindex);
  const receiptResponse = await context.request.get(
    `${origin}/docs/seams-wallet-docs-artifact.json`,
  );
  const receipt = JSON.parse(await saveResponse(receiptResponse, 'docs-receipt'));
  assert.equal(receipt.repository, 'seams-tech/seams-wallet');
  assert.equal(receipt.revision, process.env.SEAMS_WALLET_DOCS_REVISION);
  const docsSitemap = await context.request.get(`${origin}/docs/sitemap.xml`);
  assert.equal(docsSitemap.status(), 200);
  assert.match(await docsSitemap.text(), /<urlset\b/);
  const worker = await context.request.get(`${origin}/sdk/workers/near-signer.worker.js`);
  assert.equal(worker.status(), 200);
  assert.match(worker.headers()['content-type'] || '', /javascript/);
  const social = await context.request.get(`${origin}/wallet-social.png`);
  assert.equal(social.status(), 200);
  assert.match(social.headers()['content-type'] || '', /image\/png/);
  for (const path of ['/ja', '/pricing', '/ja/pricing', '/features', '/ja/features']) {
    const redirect = await context.request.get(`${origin}${path}`, { maxRedirects: 0 });
    await saveResponse(redirect, `redirect-${path.replaceAll('/', '_')}`);
    assert.ok([301, 308].includes(redirect.status()), path);
    assert.equal(new URL(redirect.headers().location, origin).href, `${origin}${path}/`);
  }
  await page.goto(`${origin}/ja/pricing/?utm_source=seo-acceptance`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${canonicalOrigin}/ja/pricing/`,
  );
  const missing = await page.goto(`${origin}/seo-acceptance-missing-page`);
  await saveResponse(missing, 'missing');
  assert.equal(missing.status(), 404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  for (const path of ['/showcase/account/', '/wallet-service/index.html']) {
    const response = await context.request.get(`${origin}${path}`);
    assert.equal(response.status(), 200, path);
    assertIndexing(response, true);
  }
  await checkInteractions(browser);
  passed = true;
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
  console.error(failure);
} finally {
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        target,
        origin,
        canonicalOrigin,
        noindex,
        passed,
        failure,
        checkedAt: new Date().toISOString(),
        command: 'pnpm -C tests exec node e2e/wallet-marketing-seo.e2e.mjs',
        sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sourceDirty:
          execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
            encoding: 'utf8',
          }).trim() !== '',
        docsRevision: process.env.SEAMS_WALLET_DOCS_REVISION,
        responses,
        browserErrors,
        metrics,
        searchConsole: 'not configured; indexing, query, and field performance data unavailable',
      },
      null,
      2,
    ),
  );
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
