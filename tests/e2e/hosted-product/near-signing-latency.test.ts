import type {
  APIRequestContext,
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
  Response,
  TestInfo,
} from '@playwright/test';
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

type Timing = { at: number; event: string; stage: string | null; durationMs: number };
class NearEvidence {
  readonly timings: Timing[] = [];
  readonly assets = new Set<string>();
  readonly responses: { at: number; response: Response }[] = [];
  observeResponse(response: Response): void {
    this.responses.push({ at: performance.now(), response });
  }
  async consoleCalls(startedAt: number, endedAt: number): Promise<number | null> {
    let count = 0;
    let observed = false;
    for (const entry of this.responses) {
      if (entry.at < startedAt || entry.at > endedAt) continue;
      if (new URL(entry.response.url()).origin !== process.env.SEAMS_INTENDED_ROUTER_URL) continue;
      const value = await entry.response.headerValue('X-Benchmark-Console-Calls');
      if (value === null) return null;
      observed = true;
      count += Number(value);
    }
    return observed ? count : null;
  }
  readonly consoleRequests: string[] = [];
  observe(message: ConsoleMessage): void {
    const text = message.text();
    if (!text.startsWith('[SigningFlow][near]') && !text.startsWith('[Intended NEAR benchmark]'))
      return;
    const start = text.indexOf('{"');
    if (start < 0) return;
    let value;
    try {
      value = JSON.parse(text.slice(start));
    } catch {
      return;
    }
    if (typeof value.durationMs !== 'number' || typeof value.event !== 'string') return;
    this.timings.push({
      at: performance.now(),
      event: value.event,
      stage: value.stage ?? null,
      durationMs: value.durationMs,
    });
  }
  observeRequest(request: Request): void {
    const url = new URL(request.url());
    if (/\.(?:js|wasm)$/u.test(url.pathname)) this.assets.add(url.pathname);
    if (url.pathname.startsWith('/console/') || url.pathname.startsWith('/internal/'))
      this.consoleRequests.push(url.pathname);
  }
  window(startedAt: number, endedAt: number) {
    return this.timings.filter(inWindow.bind(null, startedAt, endedAt));
  }
}
function inWindow(startedAt: number, endedAt: number, timing: Timing): boolean {
  return timing.at >= startedAt && timing.at <= endedAt;
}
function isSdkSigning(timing: Timing): boolean {
  return timing.event === 'near_sdk_signing_timing';
}
function isOtherSigner(asset: string): boolean {
  return (
    /\/(?:ecdsa-[^/]+|email-otp)\.worker\.js$/u.test(asset) ||
    /\/(?:router_ab_ecdsa_client|tempo_signer|evm_crypto)_bg\.wasm$/u.test(asset)
  );
}

for (let sample = 1; sample <= 3; sample += 1) {
  test(
    `hosted NEAR-only sample ${sample}: registration, unlock, warm and three signatures`,
    runNearBenchmark,
  );
}
async function runNearBenchmark(
  { context, page, request }: { context: BrowserContext; page: Page; request: APIRequestContext },
  testInfo: TestInfo,
): Promise<void> {
  test.setTimeout(300_000);
  const output = process.env.SEAMS_TEST_ARTIFACT_DIR;
  if (!output) throw new Error('SEAMS_TEST_ARTIFACT_DIR is required');
  await installCandidateAssets(context);
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'hosted_product',
  });
  const observations = new NearEvidence();
  const gateway = new GatewayRequestEvidence();
  page.on('console', observations.observe.bind(observations));
  context.on('request', observations.observeRequest.bind(observations));
  context.on('response', observations.observeResponse.bind(observations));
  gateway.start(context);
  const samples = [];
  let outcome = 'failed';
  try {
    await harness.initialize();
    const registrationStartedAt = performance.now();
    await harness.registerPasskeyEd25519YaoWallet();
    samples.push(
      await measure(
        harness,
        observations,
        gateway,
        'registration_to_first_verified',
        registrationStartedAt,
        'post_registration',
      ),
    );
    for (let index = 0; index < 2; index += 1) {
      samples.push(
        await measure(
          harness,
          observations,
          gateway,
          'warm_signing',
          performance.now(),
          'post_registration',
        ),
      );
    }
    await harness.assertLockedPageReloadStaysLocked();
    const unlockStartedAt = performance.now();
    await harness.unlockPasskeyWallet();
    samples.push(
      await measure(
        harness,
        observations,
        gateway,
        'unlock_to_first_verified',
        unlockStartedAt,
        'post_unlock',
      ),
    );
    await harness.unlockPasskeyWallet();
    for (let index = 0; index < 3; index += 1) {
      samples.push(
        await measure(
          harness,
          observations,
          gateway,
          'three_consecutive',
          performance.now(),
          'post_unlock',
        ),
      );
    }
    expect(
      [...observations.assets].filter(isOtherSigner),
      'NEAR-only must not load another signer',
    ).toEqual([]);
    outcome = 'succeeded';
  } finally {
    gateway.stop(context);
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, `near-${testInfo.title.match(/sample (\d+)/u)?.[1]}.json`),
      JSON.stringify(
        {
          outcome,
          samples,
          assets: [...observations.assets],
          browserConsoleCalls: observations.consoleRequests,
          notes: [
            'Fresh browser and wallet identify client-cold runs; Worker/DO cold state is unproven.',
            'Warm signing uses an existing authorized NEAR lane. No ECDSA presignature pool is used.',
            'Gateway D1 counts are null when deployment telemetry does not expose them.',
            'Browser Console calls do not include Worker service-binding calls.',
          ],
        },
        null,
        2,
      ),
    );
  }
}
async function measure(
  harness: InstanceType<typeof IntendedBehaviourHarness>,
  observations: NearEvidence,
  gateway: InstanceType<typeof GatewayRequestEvidence>,
  workload: string,
  startedAt: number,
  stage: 'post_registration' | 'post_unlock',
) {
  const observedAt = new Date().toISOString();
  const signStartedAt = performance.now();
  await harness.signNearTransaction(stage);
  const endedAt = performance.now();
  const timings = observations.window(signStartedAt, endedAt);
  const sdk = timings.filter(isSdkSigning);
  expect(sdk, 'one SDK signing operation per sample').toHaveLength(1);
  return {
    workload,
    observedAt,
    verified: true,
    elapsedToVerifiedMs: endedAt - startedAt,
    sdkSigningMs: sdk[0].durationMs,
    timings,
    gateway: await gateway.window(startedAt, endedAt),
    gatewayConsoleCalls: await observations.consoleCalls(startedAt, endedAt),
    automation: harness.signingActionTimingEvidence(),
  };
}
