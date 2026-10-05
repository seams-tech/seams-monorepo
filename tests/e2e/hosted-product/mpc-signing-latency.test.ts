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

test('hosted full MPC signing latency with verified signatures and concurrent signing', async ({
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
  let concurrent = null;
  try {
    await harness.initialize();
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    for (let batch = 0; batch < 3; batch += 1) {
      await harness.unlockPasskeyWallet();
      for (let index = 0; index < 3; index += 1) {
        const startedAt = performance.now();
        await harness.signTempoTransaction('post_unlock');
        const endedAt = performance.now();
        samples.push({
          batch,
          index,
          verified: true,
          client: timing.window(startedAt, endedAt),
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
    expect(samples).toHaveLength(9);
  } finally {
    const output = path.resolve(process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/mpc-signing');
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'mpc-signing.json'),
      JSON.stringify(
        {
          scope:
            'Native local browser to hosted Gateway, Console and custody. Full public SDK call includes automated confirmation and ends with a signed transaction. Signatures are independently verified; no broadcast or blockchain confirmation is timed.',
          walletId: harness.walletId,
          gatewayOrigin,
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
