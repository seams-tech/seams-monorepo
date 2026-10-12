import type { Response } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installCandidateAssets } from './candidate-assets';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const { test, expect } = await import(
  pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href
);
const { IntendedBehaviourHarness } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);
const { GatewayRequestEvidence } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/gateway-request-evidence.ts'))
    .href
);
const { SigningTimingEvidence } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/signing-timing-evidence.ts'))
    .href
);

class GatewayTimingHeaders {
  private readonly responses: { response: Response; receivedAt: number }[] = [];

  constructor(private readonly gatewayOrigin: string) {}

  record(response: Response): void {
    if (new URL(response.url()).origin === this.gatewayOrigin) {
      this.responses.push({ response, receivedAt: performance.now() });
    }
  }

  async window(startedAt: number, endedAt: number) {
    const records = [];
    for (const { response, receivedAt } of this.responses) {
      if (receivedAt < startedAt || receivedAt > endedAt) continue;
      records.push({
        path: new URL(response.url()).pathname,
        method: response.request().method(),
        status: response.status(),
        receivedOffsetMs: receivedAt - startedAt,
        serverTiming: await response.headerValue('server-timing'),
        placement: await response.headerValue('cf-placement'),
        ray: await response.headerValue('cf-ray'),
      });
    }
    return records;
  }
}

for (const workload of ['back_to_back', 'prefilled'] as const) {
  test(`hosted full MPC signing latency: ${workload}`, async ({
    context,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(300_000);
    await installCandidateAssets(context);
    const harness = new IntendedBehaviourHarness({
      context,
      page,
      request,
      flow: 'passkey.registration',
      networkMode: 'hosted_product',
    });
    const gateway = new GatewayRequestEvidence();
    const timing = new SigningTimingEvidence();
    const gatewayOrigin = process.env.SEAMS_INTENDED_ROUTER_URL;
    if (!gatewayOrigin) throw new Error('SEAMS_INTENDED_ROUTER_URL is required');
    const headers = new GatewayTimingHeaders(new URL(gatewayOrigin).origin);
    const recordHeaders = headers.record.bind(headers);
    const recordTiming = timing.record.bind(timing);
    context.on('response', recordHeaders);
    page.on('console', recordTiming);
    gateway.start(context);
    const samples = [];
    const prefillWaits = [];
    const batches = 3;
    const signaturesPerBatch = workload === 'prefilled' ? 2 : 3;
    let concurrent = null;
    try {
      await harness.initialize();
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      for (let batch = 0; batch < batches; batch += 1) {
        const unlockStartedAt = performance.now();
        await harness.unlockPasskeyWallet();
        if (workload === 'prefilled') {
          // Unlock prepares one item. One verified warm-up signature starts
          // the normal maintenance target before the ready-material samples.
          await harness.signTempoTransaction('post_unlock');
          const waitStartedAt = performance.now();
          await expect
            .poll(countReadyPools.bind(null, timing.refillResults, unlockStartedAt), {
              timeout: 60_000,
            })
            .toBeGreaterThanOrEqual(1);
          prefillWaits.push({ batch, elapsedMs: performance.now() - waitStartedAt });
        }
        for (let index = 0; index < signaturesPerBatch; index += 1) {
          const startedAt = performance.now();
          await harness.signTempoTransaction('post_unlock');
          const endedAt = performance.now();
          const client = timing.window(startedAt, endedAt);
          if (workload === 'prefilled') {
            expect(client.stages.some(isRefillWait)).toBe(false);
          }
          samples.push({
            batch,
            index,
            verified: true,
            client,
            automation: harness.signingActionTimingEvidence(),
            gateway: await gateway.window(startedAt, endedAt),
            headers: await headers.window(startedAt, endedAt),
          });
        }
      }
      await harness.unlockPasskeyWallet();
      // The shared concurrency scenario requires exactly two uses left.
      await harness.signNearTransaction('post_unlock');
      const startedAt = performance.now();
      await harness.signTempoAndArcEvmConcurrently('post_unlock');
      const endedAt = performance.now();
      concurrent = {
        verified: true,
        client: timing.concurrentWindow(startedAt, endedAt),
        gateway: await gateway.window(startedAt, endedAt),
        headers: await headers.window(startedAt, endedAt),
      };
      harness.assertNoLifecycleViolations();
      harness.assertNoWrongAuthPath();
      expect(samples).toHaveLength(batches * signaturesPerBatch);
    } finally {
      const output = path.resolve(process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/mpc-signing');
      await mkdir(output, { recursive: true });
      await writeFile(
        path.join(output, `mpc-signing-${workload}.json`),
        JSON.stringify(
          {
            scope:
              'Native local browser to hosted Gateway, Console and custody. Full public SDK call includes automated confirmation and ends with a signed transaction. Signatures are independently verified; no broadcast or blockchain confirmation is timed.',
            walletId: harness.walletId,
            gatewayOrigin,
            workload,
            prefillWaits,
            samples,
            concurrent,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      await harness.attachTrace(testInfo);
      gateway.stop(context);
      context.off('response', recordHeaders);
      page.off('console', recordTiming);
    }
  });
}

test('hosted first preparation: immediate registration and consecutive signing', async ({
  context, page, request,
}, testInfo) => {
  test.setTimeout(120_000);
  await installCandidateAssets(context);
  const harness = new IntendedBehaviourHarness({
    context, page, request, flow: 'passkey.registration', networkMode: 'hosted_product',
  });
  const timing = new SigningTimingEvidence();
  const gateway = new GatewayRequestEvidence();
  const gatewayOrigin = process.env.SEAMS_INTENDED_ROUTER_URL;
  if (!gatewayOrigin) throw new Error('SEAMS_INTENDED_ROUTER_URL is required');
  const headers = new GatewayTimingHeaders(new URL(gatewayOrigin).origin);
  const recordHeaders = headers.record.bind(headers);
  const recordTiming = timing.record.bind(timing);
  context.on('response', recordHeaders);
  page.on('console', recordTiming);
  gateway.start(context);
  const samples = [];
  const registrationStarted = performance.now();
  let registrationMs = null;
  try {
    await harness.initialize();
    const started = performance.now();
    await harness.registerPasskeyWallet();
    registrationMs = performance.now() - started;
    for (let index = 0; index < 3; index += 1) {
      const startedAt = performance.now();
      await harness.signTempoTransaction('post_registration');
      const endedAt = performance.now();
      samples.push({
        index, verified: true,
        client: timing.window(startedAt, endedAt),
        gateway: await gateway.window(startedAt, endedAt),
      });
    }
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
    expect(samples).toHaveLength(3);
  } finally {
    const output = path.resolve(process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/mpc-signing');
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, `first-preparation-${testInfo.repeatEachIndex}.json`), JSON.stringify({
      scope: 'Fresh registration, then three verified signatures without a readiness wait or broadcast.',
      registrationMs, samples, refillResults: timing.refillResults,
      gateway: await gateway.window(registrationStarted, performance.now()),
      headers: await headers.window(registrationStarted, performance.now()),
    }, null, 2), { mode: 0o600 });
    await harness.attachTrace(testInfo);
    gateway.stop(context);
    context.off('response', recordHeaders);
    page.off('console', recordTiming);
  }
});

test('hosted early preparation: registration, unlock and idle', async ({
  context, page, request,
}, testInfo) => {
  test.setTimeout(300_000);
  await installCandidateAssets(context);
  const harness = new IntendedBehaviourHarness({
    context, page, request, flow: 'passkey.registration', networkMode: 'hosted_product',
  });
  const timing = new SigningTimingEvidence();
  const gateway = new GatewayRequestEvidence();
  const recordTiming = timing.record.bind(timing);
  page.on('console', recordTiming);
  gateway.start(context);
  const samples = [];
  try {
    await harness.initialize();
    const registrationStarted = performance.now();
    await harness.registerPasskeyWallet();
    const registrationMs = performance.now() - registrationStarted;
    let startedAt = performance.now();
    await harness.signTempoTransaction('post_registration');
    let endedAt = performance.now();
    samples.push({
      phase: 'registration_immediate', registrationMs, verified: true,
      client: timing.window(startedAt, endedAt),
      gateway: await gateway.window(startedAt, endedAt),
    });
    await harness.awaitNearReady();
    for (const delayMs of [0, 2_000, 5_000, 15_000, 90_000]) {
      const unlockStarted = performance.now();
      await harness.unlockPasskeyWallet();
      const unlockMs = performance.now() - unlockStarted;
      // Controlled user think time is part of the workload, never a readiness poll.
      if (delayMs > 0) await page.waitForTimeout(delayMs);
      startedAt = performance.now();
      await harness.signTempoTransaction('post_unlock');
      endedAt = performance.now();
      samples.push({
        phase: 'unlock_delay', delayMs, unlockMs, verified: true,
        client: timing.window(startedAt, endedAt),
        gateway: await gateway.window(startedAt, endedAt),
      });
    }
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
    expect(samples).toHaveLength(6);
  } finally {
    const output = path.resolve(process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/mpc-signing');
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'mpc-signing-early-preparation.json'), JSON.stringify({
      scope: 'Verified full MPC signing without broadcast; registration and unlock duration are separate. Idle duration does not prove eviction.',
      walletId: harness.walletId,
      samples,
      refillResults: timing.refillResults,
    }, null, 2), { mode: 0o600 });
    await harness.attachTrace(testInfo);
    gateway.stop(context);
    page.off('console', recordTiming);
  }
});

function countReadyPools(
  events: readonly { receivedAtMs: number; outcome: string; depth: number }[],
  startedAt: number,
): number {
  let count = 0;
  for (const event of events) {
    if (event.receivedAtMs >= startedAt && event.outcome === 'available' && event.depth >= 3) {
      count += 1;
    }
  }
  return count;
}

function isRefillWait(event: { stage: string }): boolean {
  return event.stage === 'refill_wait' || event.stage === 'foreground_refill';
}
