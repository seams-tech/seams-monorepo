import { installCandidateAssets } from './candidate-assets';
import type { BrowserContext } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const { expect, test } = await import(
  pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href
);
const { IntendedBehaviourHarness } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);
const { GatewayRequestEvidence } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/gateway-request-evidence.ts'))
    .href
);

const { LostLinkedAcknowledgement } = await import(
  pathToFileURL(
    path.join(publicRoot, 'tests/e2e/intended-behaviours/linked-device-acknowledgement-fault.ts'),
  ).href
);

function isNewContext(previous: readonly BrowserContext[], context: BrowserContext): boolean {
  return !previous.includes(context);
}

test('hosted registration, lock, unlock, export and verified ECDSA signing', async ({
  context,
  page,
  request,
  browser,
}, testInfo) => {
  await installCandidateAssets(context);
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'hosted_product',
  });
  const evidence = new GatewayRequestEvidence();
  evidence.start(context);
  const startedAt = performance.now();
  const stages = [];
  try {
    await harness.initialize();
    let start = performance.now();
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    stages.push({ operation: 'registration', elapsedMs: performance.now() - start });
    await harness.assertLockedPageReloadStaysLocked();
    start = performance.now();
    await harness.unlockPasskeyWallet();
    stages.push({ operation: 'unlock', elapsedMs: performance.now() - start });
    start = performance.now();
    await harness.exportEcdsaKey();
    stages.push({ operation: 'export', elapsedMs: performance.now() - start });
    start = performance.now();
    await harness.signTempoTransaction('post_unlock');
    stages.push({ operation: 'signing', elapsedMs: performance.now() - start });
    const previousContexts = browser.contexts();
    const device = await harness.openLinkedDevice(browser, installCandidateAssets);
    const opened = browser.contexts().filter(isNewContext.bind(undefined, previousContexts));
    expect(opened).toHaveLength(1);
    const deviceContext = opened[0];
    evidence.start(deviceContext);
    await harness.cancelUnclaimedDeviceLink(device);
    const lostAcknowledgement = new LostLinkedAcknowledgement(deviceContext, 2);
    await lostAcknowledgement.arm();
    const lostActivation = await device.loseLinkedActivationResponseOnce();
    start = performance.now();
    try {
      await harness.linkDeviceWithPasskey(device);
    } finally {
      await lostAcknowledgement.release();
      await lostActivation.release();
    }
    lostActivation.assertReplayed();
    await lostAcknowledgement.verify(testInfo);
    stages.push({ operation: 'link_with_lost_replies', elapsedMs: performance.now() - start });
    start = performance.now();
    await device.signNearTransaction('post_device_link');
    await device.signTempoTransaction('post_device_link');
    await harness.revokeLinkedDeviceWithOwnerPasskey();
    await device.assertRevokedDeviceCannotSign();
    await harness.signTempoTransaction('post_unlock');
    stages.push({
      operation: 'linked_signing_and_revocation_verified',
      elapsedMs: performance.now() - start,
    });
    device.assertNoWrongAuthPath();
    evidence.stop(deviceContext);
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
    expect(stages).toHaveLength(6);
  } finally {
    const output = path.resolve(
      process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/r152/hosted-product',
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'lifecycle.json'),
      JSON.stringify(
        {
          scope:
            'Local candidate browser assets; real hosted Gateway, Console and custody roles; no backend stubs',
          stages,
          requests: await evidence.window(startedAt, performance.now()),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await harness.attachTrace(testInfo);
    evidence.stop(context);
    await harness.closeLinkedDevice(testInfo);
  }
});

test('hosted unlock rejects incomplete target inventory with visible retryable failure', async ({
  context,
  page,
  request,
}, testInfo) => {
  await installCandidateAssets(context);
  const previousProfile = process.env.SEAMS_INTENDED_PASSKEY_ECDSA_TARGET_PROFILE;
  process.env.SEAMS_INTENDED_PASSKEY_ECDSA_TARGET_PROFILE = 'tempo';
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'hosted_product',
  });
  process.env.SEAMS_INTENDED_PASSKEY_ECDSA_TARGET_PROFILE = previousProfile;
  try {
    await harness.initialize();
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    await harness.assertLockedPageReloadStaysLocked();
    await expect(harness.unlockPasskeyWallet()).rejects.toThrow(
      /Wallet auth menu failed: Something went wrong\./,
    );
    const frame = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
    await expect(frame.locator('.seams-auth-footer[data-state="notice"] .seams-auth-footer-text')).toBeVisible();
    const evidence = {
      registeredTargets: ['tempo:42431'],
      missingTarget: 'evm:5042002',
      visibleMessage: 'Something went wrong.',
      outcome: 'unlock rejected with retryable UI failure',
    };
    const output = path.resolve(
      process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/r152/hosted-product',
    );
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'missing-target-unlock.json'), JSON.stringify(evidence, null, 2), {
      mode: 0o600,
    });
    await testInfo.attach('missing-target-unlock.json', {
      contentType: 'application/json',
      body: JSON.stringify(evidence),
    });
  } finally {
    await harness.attachTrace(testInfo);
  }
});
