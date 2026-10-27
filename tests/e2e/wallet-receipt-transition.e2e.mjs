import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SEAMS_WALLET_SITE_ORIGIN || 'http://localhost:4001/wallet/';
const artifacts = '.artifacts/wallet-receipt-transition';
const examples = [
  { choice: 'VoiceID', frame: 'VoiceID', confirm: 'Confirm with VoiceID' },
  { choice: 'Transactions', frame: 'Transaction modal', confirm: 'Confirm with passkey' },
];

function positionGallery(gallery) {
  const viewport = gallery.querySelector('.component-showcase__viewport');
  scrollTo({ top: scrollY + viewport.getBoundingClientRect().top - 120, behavior: 'instant' });
}

async function settleCard(card) {
  for (const animation of card.getAnimations({ subtree: true })) {
    if (animation.effect.getTiming().iterations === Infinity || animation.playState === 'paused')
      continue;
    try {
      await animation.finished;
    } catch {}
  }
}

async function inspectTransition(surface, direction) {
  const selectors = [
    '.seams-review-amount',
    '.seams-receipt-steps',
    '.seams-receipt-primary',
    '.seams-receipt-footer',
    '.seams-transaction-toast-text',
  ];
  const source = surface.querySelector('.modal-container-root');
  const sourceTitle = document.createRange();
  sourceTitle.selectNodeContents(source.querySelector('[role="status"]'));
  const beforeTitle = sourceTitle.getBoundingClientRect().toJSON();
  const before = {};
  for (const selector of selectors) {
    const element = source.querySelector(selector);
    if (element) before[selector] = element.getBoundingClientRect().toJSON();
  }
  const marker = document.createElement('span');
  marker.style.cssText = 'position:fixed;pointer-events:none;opacity:0';
  surface.append(marker);
  const unrelated = marker.animate([{ opacity: 0 }, { opacity: 0 }], {
    duration: 1000,
    fill: 'both',
  });
  unrelated.pause();
  await unrelated.ready;
  surface
    .querySelector(
      direction === 'minimize' ? '[aria-label="Minimize transaction"]' : '.seams-receipt-open',
    )
    .click();
  const overlay = surface.querySelector('.showcase-receipt-overlay');
  const animations = overlay.getAnimations({ subtree: true });
  const motion = [];
  for (const animation of animations) {
    await animation.ready;
    animation.pause();
    await animation.ready;
    animation.currentTime = 0;
    motion.push({
      timing: animation.effect.getTiming(),
      keyframes: animation.effect.getKeyframes(),
    });
  }
  const [outgoing, incoming] = overlay.querySelectorAll('.showcase-receipt-content');
  const sharedTitle = document.createRange();
  sharedTitle.selectNodeContents(overlay.querySelector('.showcase-receipt-anchor[role="status"]'));
  const copiedTitleStart = sharedTitle.getBoundingClientRect().toJSON();
  const copiedStart = {};
  for (const selector of selectors) {
    const element = outgoing.querySelector(selector);
    if (element) copiedStart[selector] = element.getBoundingClientRect().toJSON();
  }
  for (const animation of animations) animation.currentTime = 239.999;
  const actual = surface.querySelector(
    '.seams-confirmation-modal:not(.showcase-receipt-overlay) .modal-container-root',
  );
  const end = {};
  const copiedEnd = {};
  const targetTitle = document.createRange();
  targetTitle.selectNodeContents(actual.querySelector('[role="status"]'));
  const endTitle = targetTitle.getBoundingClientRect().toJSON();
  const copiedTitleEnd = sharedTitle.getBoundingClientRect().toJSON();
  for (const selector of selectors) {
    const element = actual.querySelector(selector);
    const copy = incoming.querySelector(selector);
    if (element && copy) {
      end[selector] = element.getBoundingClientRect().toJSON();
      copiedEnd[selector] = copy.getBoundingClientRect().toJSON();
    }
  }
  for (const animation of animations) animation.currentTime = 96;
  const anchors = overlay.querySelectorAll('.showcase-receipt-anchor[role="status"]');
  const result = {
    beforeTitle,
    copiedTitleStart,
    endTitle,
    copiedTitleEnd,
    before,
    copiedStart,
    end,
    copiedEnd,
    motion,
    titleCount: anchors.length,
    unrelatedRate: unrelated.playbackRate,
    unrelatedState: unrelated.playState,
  };
  unrelated.cancel();
  marker.remove();
  return result;
}

function finishTransition(surface) {
  for (const animation of surface
    .querySelector('.showcase-receipt-overlay')
    .getAnimations({ subtree: true }))
    animation.finish();
}

async function reverseTransition(surface) {
  surface.querySelector('[aria-label="Minimize transaction"]').click();
  const overlay = surface.querySelector('.showcase-receipt-overlay');
  const animations = overlay.getAnimations({ subtree: true });
  for (const animation of animations) {
    await animation.ready;
    animation.pause();
    await animation.ready;
    animation.currentTime = 96;
  }
  const shape = overlay.querySelector('.showcase-receipt-background');
  const before = getComputedStyle(shape).clipPath;
  surface.querySelector('.seams-receipt-open').click();
  const after = getComputedStyle(shape).clipPath;
  return {
    before,
    after,
    reusedOverlay: surface.querySelector('.showcase-receipt-overlay') === overlay,
  };
}

function assertSameLayout(actual, copied) {
  assert.deepEqual(Object.keys(copied), Object.keys(actual));
  for (const selector of Object.keys(actual)) {
    for (const property of ['x', 'y', 'width', 'height']) {
      assert.ok(
        Math.abs(actual[selector][property] - copied[selector][property]) < 0.2,
        `${selector} ${property}: ${actual[selector][property]} versus ${copied[selector][property]}`,
      );
    }
  }
}

function assertMotion(result) {
  assertSameLayout(result.before, result.copiedStart);
  assertSameLayout(result.end, result.copiedEnd);
  assert.equal(result.titleCount, 1);
  assert.equal(result.unrelatedRate, 1);
  assert.equal(result.unrelatedState, 'paused');
  for (const property of ['x', 'y', 'width', 'height']) {
    assert.ok(
      Math.abs(result.beforeTitle[property] - result.copiedTitleStart[property]) < 1,
      `Title start ${property}: ${result.beforeTitle[property]} versus ${result.copiedTitleStart[property]}`,
    );
    assert.ok(
      Math.abs(result.endTitle[property] - result.copiedTitleEnd[property]) < 1,
      `Title end ${property}`,
    );
  }
  assert.ok(result.motion.length > 0);
  for (const animation of result.motion) {
    assert.equal(animation.timing.duration, 240);
    for (const keyframe of animation.keyframes) {
      for (const property of Object.keys(keyframe)) {
        assert.ok(
          [
            'offset',
            'computedOffset',
            'easing',
            'composite',
            'transform',
            'clipPath',
            'opacity',
          ].includes(property),
          `Unexpected animated property: ${property}`,
        );
      }
    }
  }
}

function canvasBounds(gallery) {
  return gallery.querySelector('.component-showcase__viewport').getBoundingClientRect().toJSON();
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: 'no-preference',
});
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  await page.goto(origin);
  await page
    .getByRole('group', { name: 'Preview theme', exact: true })
    .getByRole('button', { name: 'Carbon', exact: true })
    .click();
  const gallery = page.getByRole('region', {
    name: 'Use built-in wallet components, or use your own.',
    exact: true,
  });
  const results = [];
  for (const example of examples) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await gallery.getByRole('radio', { name: example.choice, exact: true }).locator('..').click();
    await gallery.evaluate(positionGallery);
    const frame = gallery.frameLocator(`iframe[title="${example.frame}"]`);
    await expect(frame.locator('html')).toHaveAttribute('data-showcase-autoplay', /true|false/);
    await frame.getByRole('button', { name: example.confirm, exact: true }).click();
    await expect(gallery).toHaveAttribute('data-pause-reason', 'interaction');
    await expect(frame.getByRole('status')).toHaveText('Transaction complete', { timeout: 20000 });
    const surface = frame.locator('.seams-confirmation-surface');
    const card = frame.locator(
      '.seams-confirmation-modal:not(.showcase-receipt-overlay) .modal-container-root',
    );
    await card.evaluate(settleCard);
    const directions = [];
    for (const direction of ['minimize', 'expand']) {
      const result = await surface.evaluate(inspectTransition, direction);
      assertMotion(result);
      await gallery.screenshot({ path: `${artifacts}/${example.choice}-${direction}-96ms.png` });
      await surface.evaluate(finishTransition);
      await expect(frame.locator('.showcase-receipt-overlay')).toHaveCount(0);
      if (direction === 'minimize') {
        const toast = await card.boundingBox();
        const canvas = await gallery.evaluate(canvasBounds);
        assert.ok(toast.y + toast.height < canvas.bottom - canvas.height * 0.08);
        await gallery.screenshot({ path: `${artifacts}/${example.choice}-toast.png` });
      }
      directions.push({ direction, ...result });
    }
    const reversal = await surface.evaluate(reverseTransition);
    assert.equal(reversal.reusedOverlay, true);
    assert.equal(reversal.after, reversal.before);
    await expect(frame.locator('.showcase-receipt-overlay')).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await frame.getByRole('button', { name: 'Minimize transaction', exact: true }).click();
    await expect(frame.locator('.showcase-receipt-overlay')).toHaveCount(0);
    await frame.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(frame.locator('.showcase-receipt-overlay')).toHaveCount(0);
    results.push({ example: example.choice, directions, reversal, reducedMotion: true });
    if (example.choice === 'VoiceID') {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await gallery.evaluate(positionGallery);
        for (const direction of ['minimize', 'expand']) {
          const mobile = await surface.evaluate(inspectTransition, direction);
          assertMotion(mobile);
          await gallery.screenshot({ path: `${artifacts}/mobile-${width}-${direction}-96ms.png` });
          await surface.evaluate(finishTransition);
          await expect(frame.locator('.showcase-receipt-overlay')).toHaveCount(0);
          results.push({ example: example.choice, width, direction, ...mobile });
        }
      }
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
  }
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify({ passed: true, origin, results }, null, 2) + '\n',
  );
  console.log(
    'Passed receipt continuity, 240 ms timing, reversal, unrelated animation isolation, toast clearance, and reduced motion.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
