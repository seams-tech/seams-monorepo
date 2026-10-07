import type { APIRequestContext, BrowserContext, Page, Response, TestInfo } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installCandidateAssets } from './candidate-assets';
import type { WalletMoveId, WalletMoveRequest, WalletMoveStatusResult } from '@seams/wallet';

declare global {
  interface Window {
    __seamsIntendedE2EMoveWallet?: (request: WalletMoveRequest) => Promise<WalletMoveStatusResult>;
    __seamsIntendedE2EReadWalletMove?: (moveId: string) => Promise<WalletMoveStatusResult>;
  }
}

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const { parseWalletMoveRequest } = await import(
  pathToFileURL(path.join(publicRoot, 'packages/wallet/src/SeamsWeb/publicApi/placement.ts')).href
);
const { test, expect } = await import(
  pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href
);
const { IntendedBehaviourHarness } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);
const { SigningTimingEvidence } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/signing-timing-evidence.ts'))
    .href
);

class GatewayObservations {
  readonly responses: Response[] = [];

  observe(response: Response): void {
    if (new URL(response.url()).origin === process.env.SEAMS_INTENDED_ROUTER_URL) {
      this.responses.push(response);
    }
  }

  async records() {
    const records = [];
    for (const response of this.responses) {
      records.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
        home: await response.headerValue('x-seams-wallet-region'),
        ray: await response.headerValue('cf-ray'),
        serverTiming: await response.headerValue('server-timing'),
      });
    }
    return records;
  }
}

test('hosted relocation preserves signing and records the pause and refill', runRelocation);

async function runRelocation(
  { context, page, request }: { context: BrowserContext; page: Page; request: APIRequestContext },
  testInfo: TestInfo,
): Promise<void> {
  test.setTimeout(900_000);
  const output = process.env.SEAMS_TEST_ARTIFACT_DIR;
  if (!output) throw new Error('SEAMS_TEST_ARTIFACT_DIR is required');
  await mkdir(output, { recursive: true });
  await installCandidateAssets(context);
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'hosted_product',
  });
  const timing = new SigningTimingEvidence();
  const gateway = new GatewayObservations();
  page.on('console', timing.record.bind(timing));
  context.on('response', gateway.observe.bind(gateway));
  const samples = [];
  const progress = [];
  let outcome = 'failed';
  try {
    await harness.initialize();
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    await harness.unlockPasskeyWallet();
    for (let index = 0; index < 2; index += 1) {
      samples.push(await measureSigning(harness, timing, `before_${index}`));
    }
    const walletId = await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id');
    if (!walletId) throw new Error('Registered wallet identity is missing');
    const moveId = `wmove_${randomBytes(32).toString('base64url')}`;
    const admittedAt = Date.now();
    const intent = parseWalletMoveRequest({
      walletId,
      moveId,
      destinationRegion: 'US',
      expectedGeneration: 1,
    });
    let result = await page.evaluate(admitMove, intent);
    progress.push({ observedAt: Date.now(), result });
    await writeFile(
      path.join(output, 'relocation-progress.json'),
      JSON.stringify(progress, null, 2),
    );
    if (!result.ok) {
      samples.push(await measureSigning(harness, timing, 'source_after_rejected_admission'));
    }
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(`Move admission failed: ${result.code}`);
    while (result.status.state !== 'completed') {
      if (result.status.move.progress.execution.state === 'blocked') {
        throw new Error(`Relocation blocked: ${result.status.move.progress.execution.code}`);
      }
      await page.waitForTimeout(5_000);
      result = await page.evaluate(readMove, intent.moveId);
      progress.push({ observedAt: Date.now(), result });
      await writeFile(
        path.join(output, 'relocation-progress.json'),
        JSON.stringify(progress, null, 2),
      );
      if (!result.ok) throw new Error(`Move progress failed: ${result.code}`);
    }
    expect(result.status.destinationRegion).toBe('US');
    expect(result.status.destinationGeneration).toBe(2);
    samples.push({ stage: 'admission_through_cleanup', elapsedMs: Date.now() - admittedAt });
    await harness.unlockPasskeyWallet();
    for (let index = 0; index < 3; index += 1) {
      samples.push(
        await measureSigning(
          harness,
          timing,
          index === 0 ? 'first_after' : `steady_after_${index}`,
        ),
      );
    }
    await harness.signNearTransactionAfterRefresh();
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
    outcome = 'passed';
  } finally {
    await writeFile(
      path.join(output, 'relocation.json'),
      JSON.stringify(
        {
          outcome,
          scope:
            'One local browser, real hosted services, APAC to US. Signing timings include automated UI confirmation. Gateway ingress is not proof of durable resource placement.',
          samples,
          progress,
          refillResults: timing.refillResults,
          gateway: await gateway.records(),
        },
        null,
        2,
      ),
    );
    await harness.attachTrace(testInfo);
  }
}

async function measureSigning(
  harness: InstanceType<typeof IntendedBehaviourHarness>,
  timing: InstanceType<typeof SigningTimingEvidence>,
  stage: string,
) {
  const startedAt = performance.now();
  await harness.signTempoTransaction('post_unlock');
  const endedAt = performance.now();
  return {
    stage,
    elapsedMs: endedAt - startedAt,
    client: timing.window(startedAt, endedAt),
    automation: harness.signingActionTimingEvidence(),
  };
}

async function admitMove(request: WalletMoveRequest) {
  if (!window.__seamsIntendedE2EMoveWallet) throw new Error('SDK move helper is unavailable');
  return window.__seamsIntendedE2EMoveWallet(request);
}

async function readMove(moveId: WalletMoveId) {
  if (!window.__seamsIntendedE2EReadWalletMove)
    throw new Error('SDK progress helper is unavailable');
  return window.__seamsIntendedE2EReadWalletMove(moveId);
}
