import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const site = process.env.SEAMS_SITE_ORIGIN || 'http://localhost:4001';
const wallet = process.env.SEAMS_WALLET_SITE_ORIGIN || `${site}/wallet`;
const docs = new URL(process.env.SEAMS_DOCS_ORIGIN || 'https://docs.localhost:4003/docs/');
const artifacts = 'output/playwright/site-documentation-links';
const destinations = new Set();
const results = [];

function documentationLinks(links, docsOrigin) {
  const urls = [];
  for (const link of links) {
    const url = new URL(link.href);
    if (url.origin === docsOrigin) urls.push(url.href);
  }
  return urls;
}

async function checkDocs(page, source) {
  const title = page.locator('.seams-doc-header__title');
  await expect(title).toBeVisible();
  await expect(title).not.toHaveText('404');
  const heading = await title.innerText();
  await page.reload();
  await expect(title).toHaveText(heading);
  await page.screenshot({ path: `${artifacts}/${source}.png` });
  results.push({ source, url: page.url(), heading, refreshMatches: true });
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  try {
    for (const surface of [site, wallet, `${wallet}/pricing/`, `${site}/company`]) {
      await page.goto(surface);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const links = await page.locator('a[href]').evaluateAll(documentationLinks, docs.origin);
      assert.ok(links.length > 0, `${surface} exposes documentation links`);
      for (const href of links) {
        const url = new URL(href);
        assert.ok(url.pathname.startsWith(docs.pathname), `${surface} links to ${href}`);
        destinations.add(href);
      }
    }
    for (const href of destinations) {
      const response = await context.request.get(href);
      assert.equal(response.status(), 200, href);
      assert.match(await response.text(), /<meta name="generator" content="VitePress/);
    }

    await page.goto(wallet);
    await page.getByRole('button', { name: 'Documentation', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Tools and Guides/ }).click();
    await checkDocs(page, 'wallet-guides');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(site);
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'Documentation', exact: true }).click();
    const useCases = page.getByRole('link', { name: /^Use cases Mandates/ });
    await useCases.focus();
    await useCases.press('Enter');
    await checkDocs(page, 'homepage-mobile-use-cases');

    await writeFile(
      `${artifacts}/result.json`,
      JSON.stringify({ passed: true, destinations: [...destinations], results }, null, 2),
    );
    console.log(
      `Passed ${destinations.size} documentation destinations, desktop and mobile links, and refresh.`,
    );
  } finally {
    await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  }
} finally {
  await browser.close();
}
