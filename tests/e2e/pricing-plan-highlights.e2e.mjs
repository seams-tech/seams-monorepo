import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_SITE_ORIGIN || 'http://localhost:4001';
const wallet = process.env.SEAMS_WALLET_SITE_ORIGIN || `${origin}/wallet`;
const artifacts = 'output/playwright/pricing-plan-highlights';
const plans = [
  { id: 'free', menuName: /^Free / },
  { id: 'growth', menuName: /^Growth / },
  { id: 'enterprise', menuName: /^Enterprise / },
];
const results = [];

async function expectGradient(page, id, lit) {
  await expect(page.locator(`#${id} .grain-field`)).toHaveCSS('opacity', lit ? '1' : '0');
}

async function expectSelection(page, id) {
  await expect(page).toHaveURL(new RegExp(`/pricing/?#${id}$`));
  await page.mouse.move(0, 0);
  assert.equal(new URL(page.url()).hash, `#${id}`);
  for (const plan of plans) await expectGradient(page, plan.id, plan.id === id);
}

function planBounds() {
  const bounds = [];
  for (const plan of document.querySelectorAll('.pricing-plan')) {
    const rect = plan.getBoundingClientRect();
    bounds.push({ id: plan.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
  return bounds;
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
    await page.goto(wallet);
    for (const plan of plans) {
      await page.mouse.wheel(0, -3000);
      await page.getByRole('button', { name: 'Pricing', exact: true }).click();
      await page.getByRole('menuitem', { name: plan.menuName }).click();
      await expect(page.locator(`#${plan.id}`)).toBeInViewport();
      await expectSelection(page, plan.id);
      await page
        .locator('.pricing-plans')
        .screenshot({ path: `${artifacts}/selected-${plan.id}.png` });
      await page.reload();
      await expectSelection(page, plan.id);
      results.push({ selected: plan.id, refreshPreserved: true });
    }
    await page.goBack();
    await expectSelection(page, 'growth');
    await page.goForward();
    await expectSelection(page, 'enterprise');

    const colors = new Set();
    for (const plan of plans) {
      const selected = plan.id === 'free' ? 'enterprise' : 'free';
      await page.goto(`${origin}/pricing/#${selected}`);
      await expectSelection(page, selected);
      await expect(page.locator(`#${plan.id}`)).toBeInViewport();
      const before = await page.evaluate(planBounds);
      const card = page.locator(`#${plan.id}`);
      await card.hover();
      await expectGradient(page, plan.id, true);
      await expectGradient(page, selected, true);
      assert.deepEqual(await page.evaluate(planBounds), before, 'Hover preserves card positions');
      colors.add(await card.locator('canvas').evaluate(readBackgroundColor));
      await card.screenshot({ path: `${artifacts}/hover-${plan.id}.png` });
      await page.mouse.move(0, 0);
      await expectGradient(page, plan.id, false);
      await card.getByRole('link').focus();
      await expectGradient(page, plan.id, true);
      await page.locator('#pricing-title').click();
    }
    assert.equal(colors.size, 3, 'Each plan has a distinct gradient palette');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${origin}/pricing/#free`);
    await expectSelection(page, 'free');
    await expect(page.locator('#free canvas')).toHaveCSS('transition-duration', '0s');

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      ignoreHTTPSErrors: true,
    });
    await mobile.goto(wallet);
    await mobile.getByRole('button', { name: 'Open menu', exact: true }).click();
    await mobile.getByRole('button', { name: 'Pricing', exact: true }).click();
    await mobile.getByRole('link', { name: /^Free Up to 300/ }).click();
    await expectSelection(mobile, 'free');
    await mobile.locator('#free').screenshot({ path: `${artifacts}/mobile-free.png` });
    await mobile.locator('#enterprise').tap();
    await expectGradient(mobile, 'enterprise', false);
    await expectGradient(mobile, 'free', true);

    await writeFile(
      `${artifacts}/result.json`,
      JSON.stringify(
        {
          passed: true,
          results,
          hover: true,
          focus: true,
          history: true,
          touch: true,
          reducedMotion: true,
        },
        null,
        2,
      ),
    );
    console.log(
      'Passed plan menu selection, distinct gradients, hover, focus, refresh, history, touch, and reduced motion.',
    );
  } finally {
    await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  }
} finally {
  await browser.close();
}

function readBackgroundColor(element) {
  return getComputedStyle(element).backgroundColor;
}
