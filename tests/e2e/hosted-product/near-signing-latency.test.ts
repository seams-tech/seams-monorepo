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
  readonly accessKeyRequests: number[] = [];
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
    if (
      !text.startsWith('[SigningFlow][near]') &&
      !text.startsWith('[Intended NEAR benchmark]') &&
      !text.startsWith('[Registration] NEAR timing')
    )
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
    if (request.method() !== 'POST') return;
    try {
      const body: unknown = request.postDataJSON();
      if (isAccessKeyQuery(body)) this.accessKeyRequests.push(performance.now());
    } catch {
      // Non-JSON requests do not contribute to the NEAR RPC count.
    }
  }
  accessKeyCalls(startedAt: number, endedAt: number): number {
    let count = 0;
    for (const at of this.accessKeyRequests) {
      if (at >= startedAt && at <= endedAt) count += 1;
    }
    return count;
  }
  window(startedAt: number, endedAt: number) {
    return this.timings.filter(inWindow.bind(null, startedAt, endedAt));
  }
}
function isAccessKeyQuery(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || !('method' in body) || body.method !== 'query')
    return false;
  if (!('params' in body) || typeof body.params !== 'object' || body.params === null) return false;
  return 'request_type' in body.params && body.params.request_type === 'view_access_key';
}
function inWindow(startedAt: number, endedAt: number, timing: Timing): boolean {
  return timing.at >= startedAt && timing.at <= endedAt;
}
function isSdkSigning(timing: Timing): boolean {
  return timing.event === 'near_sdk_signing_timing';
}
function durationOf(timings: readonly Timing[], event: string, stage: string | null): number | null {
  for (const timing of timings) {
    if (timing.event === event && timing.stage === stage) return timing.durationMs;
  }
  return null;
}
/**
 * Splits the registration-to-signature flow into the time the SDK spent, the
 * user's two interactions, and the time this test's automation added. The
 * latency target applies to the SDK time without the interactions.
 */
function registrationMeasurement(timings: readonly Timing[], registrationToVerifiedMs: number | null) {
  const sdkRegistrationMs = durationOf(timings, 'near_sdk_registration_timing', null);
  const sdkMessageSigningMs = durationOf(timings, 'near_sdk_message_signing_timing', null);
  const webAuthnMs = durationOf(timings, 'near_registration_timing', 'near_only.authentication');
  const confirmationMs = durationOf(timings, 'ed25519_signing_timing', 'confirmation');
  if (
    sdkRegistrationMs === null ||
    sdkMessageSigningMs === null ||
    webAuthnMs === null ||
    confirmationMs === null ||
    registrationToVerifiedMs === null
  )
    return null;
  const sdkFlowMs = sdkRegistrationMs + sdkMessageSigningMs;
  return {
    sdkRegistrationMs,
    sdkMessageSigningMs,
    sdkFlowMs,
    webAuthnMs,
    confirmationMs,
    sdkFlowWithoutInteractionMs: sdkFlowMs - webAuthnMs - confirmationMs,
    harnessMs: registrationToVerifiedMs - sdkFlowMs,
  };
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
  test(
    `hosted NEAR implicit registration sample ${sample}: first verified message without funding`,
    runNearRegistrationBenchmark,
  );
}

async function runNearRegistrationBenchmark(
  { context, page, request }: { context: BrowserContext; page: Page; request: APIRequestContext },
  testInfo: TestInfo,
): Promise<void> {
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
  let outcome = 'failed';
  let startedAt = performance.now();
  let registrationMs: number | null = null;
  let registrationToVerifiedMs: number | null = null;
  let message: Awaited<ReturnType<typeof harness.signNearMessage>> | null = null;
  try {
    await harness.initialize();
    startedAt = performance.now();
    await harness.registerPasskeyEd25519YaoWallet();
    registrationMs = performance.now() - startedAt;
    message = await harness.signNearMessage('Verify this new implicit NEAR wallet before funding');
    registrationToVerifiedMs = performance.now() - startedAt;
    expect(message.accountId).toMatch(/^[0-9a-f]{64}$/u);
    expect([...observations.assets].filter(isOtherSigner)).toEqual([]);
    const requests = await gateway.window(startedAt, performance.now());
    expect(requests.requests.filter(isFundingRequest)).toEqual([]);
    outcome = 'succeeded';
  } finally {
    const endedAt = performance.now();
    gateway.stop(context);
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, `registration-${testInfo.title.match(/sample (\d+)/u)?.[1]}.json`),
      JSON.stringify(
        {
          outcome,
          registrationMs,
          registrationToVerifiedMs,
          measurement: registrationMeasurement(
            observations.window(startedAt, endedAt),
            registrationToVerifiedMs,
          ),
          message,
          sdkTimings: observations.window(startedAt, endedAt),
          nearAccessKeyCalls: observations.accessKeyCalls(startedAt, endedAt),
          gateway: await gateway.window(startedAt, endedAt),
          registrationResponses: await registrationResponseEvidence(observations),
          assets: [...observations.assets],
          notes: [
            'Fresh implicit account. NEP-413 signature verified against its registered key; changed message rejected.',
            'Message signing needs no funding or transaction context. Background prefetch may query the chain.',
            'This workload is distinct from the funded transaction benchmark.',
            'Elapsed time includes browser automation. Worker and Durable Object cold state is unproven.',
          ],
        },
        null,
        2,
      ),
    );
  }
}

function isFundingRequest(request: { path: string }): boolean {
  return request.path.endsWith('/implicit-account/fund');
}

async function registrationResponseEvidence(observations: NearEvidence) {
  const responses = [];
  for (const entry of observations.responses) {
    const pathname = new URL(entry.response.url()).pathname;
    if (!pathname.startsWith('/wallets/register/')) continue;
    const body = await entry.response.json();
    responses.push({
      path: pathname,
      status: entry.response.status(),
      serverTiming: await entry.response.headerValue('Server-Timing'),
      accountProvisioning: body.accountProvisioning ?? null,
      resolvedAccountKind: body.resolvedAccount?.kind ?? null,
      diagnostics: body.registrationDiagnostics ?? null,
    });
  }
  return responses;
}

test('hosted NEAR-only post-idle sample 4: same wallet and signing grant', runNearIdleBenchmark);

async function runNearIdleBenchmark(
  { context, page, request }: { context: BrowserContext; page: Page; request: APIRequestContext },
  testInfo: TestInfo,
): Promise<void> {
  await runNearBenchmark({ context, page, request }, testInfo, 65_000);
}

async function runNearBenchmark(
  { context, page, request }: { context: BrowserContext; page: Page; request: APIRequestContext },
  testInfo: TestInfo,
  idleMs = 0,
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
  const lifecycleActions = [];
  let outcome = 'failed';
  try {
    await harness.initialize();
    const registrationStartedAt = performance.now();
    await harness.registerPasskeyEd25519YaoWallet();
    lifecycleActions.push({
      action: 'registration',
      elapsedMs: performance.now() - registrationStartedAt,
      automation: harness.signingActionTimingEvidence(),
      sdkTimings: observations.window(registrationStartedAt, performance.now()),
    });
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
    lifecycleActions.push({
      action: 'unlock',
      elapsedMs: performance.now() - unlockStartedAt,
      automation: harness.signingActionTimingEvidence(),
      sdkTimings: observations.window(unlockStartedAt, performance.now()),
    });
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
    if (idleMs > 0) {
      // Use the same fresh grant for both samples so budget step-up does not
      // become part of the idle comparison.
      await harness.unlockPasskeyWallet();
      samples.push(
        await measure(
          harness,
          observations,
          gateway,
          'idle_control',
          performance.now(),
          'post_unlock',
        ),
      );
      await page.waitForTimeout(idleMs);
      samples.push(
        await measure(
          harness,
          observations,
          gateway,
          'post_idle',
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
          lifecycleActions,
          idleMs,
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
    nearAccessKeyCalls: observations.accessKeyCalls(signStartedAt, endedAt),
    timings,
    gateway: await gateway.window(startedAt, endedAt),
    gatewayConsoleCalls: await observations.consoleCalls(startedAt, endedAt),
    automation: harness.signingActionTimingEvidence(),
  };
}
