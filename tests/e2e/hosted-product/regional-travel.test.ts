import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

type Region = 'weur' | 'enam' | 'apac';
const regions: Region[] = ['weur', 'enam', 'apac'];

class RegionalGatewayProbe {
  region: Region;
  readonly records: object[] = [];
  private readonly identities = new Map<Region, { bootId: string; location: string; region: string }>();

  constructor(
    region: Region,
    private readonly url: string,
    private readonly token: string,
  ) {
    this.region = region;
  }

  async initialize(): Promise<void> {
    for (const region of regions) {
      const response = await fetch(`${this.url}/${region}/identity`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(200_000),
      });
      if (!response.ok) throw new Error(`Probe ${region} identity: HTTP ${response.status}`);
      const identity = await response.json();
      if (!identity.bootId || !identity.location || !identity.region) {
        throw new Error(`Probe ${region} omitted its physical identity`);
      }
      this.identities.set(region, identity);
    }
  }

  async forward(route): Promise<void> {
    const request = route.request();
    const region = this.region;
    const identity = this.identities.get(region);
    if (!identity) throw new Error(`Probe ${region} is not initialized`);
    const started = performance.now();
    const response = await fetch(`${this.url}/${region}/forward`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        bootId: identity.bootId,
        url: request.url(),
        method: request.method(),
        headers: await request.allHeaders(),
        bodyBase64: request.postDataBuffer()?.toString('base64') ?? '',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Probe ${region}: ${result.error ?? response.status}`);
    expect(result.identity.bootId).toBe(identity.bootId);
    this.records.push({
      region,
      identity: result.identity,
      path: new URL(request.url()).pathname,
      method: request.method(),
      status: result.status,
      regionalHeadersMs: result.headersMs,
      regionalCompletedMs: result.completedMs,
      localRoundtripMs: performance.now() - started,
      gatewayRay: result.headers['cf-ray'] ?? null,
    });
    await route.fulfill({
      status: result.status,
      headers: result.headers,
      body: Buffer.from(result.bodyBase64, 'base64'),
    });
  }
}

async function registerRegionalWallet(client): Promise<void> {
  await client.harness.initialize();
  const started = performance.now();
  await client.harness.registerPasskeyWallet();
  await client.harness.awaitNearReady();
  client.registration = { started, completed: performance.now(), walletId: client.harness.walletId };
}

test('hosted concurrent regional registration and same-wallet travel', async ({ browser, request }, testInfo) => {
  test.skip(!process.env.SEAMS_HOSTED_PROBE, 'A deployed regional probe is required');
  test.setTimeout(600_000);
  const config = JSON.parse(await readFile(process.env.SEAMS_HOSTED_PROBE!, 'utf8'));
  const clients = [];
  const samples = [];
  try {
    for (const region of regions) {
      const context = await browser.newContext();
      await installCandidateAssets(context);
      const probe = new RegionalGatewayProbe(region, config.workerUrl, config.accessToken);
      await probe.initialize();
      await context.route(`${process.env.SEAMS_INTENDED_ROUTER_URL}/**`, probe.forward.bind(probe));
      const page = await context.newPage();
      const harness = new IntendedBehaviourHarness({
        context, page, request, flow: 'passkey.registration', networkMode: 'hosted_product',
      });
      clients.push({ region, context, probe, harness, registration: null });
    }
    await Promise.all(clients.map(registerRegionalWallet));
    const primary = clients[0];
    for (const region of ['weur', 'apac', 'enam', 'weur'] as const) {
      primary.probe.region = region;
      for (let index = 0; index < 3; index += 1) {
        const start = performance.now();
        const firstRecord = primary.probe.records.length;
        await primary.harness.signTempoTransaction('post_registration');
        samples.push({ region, index, elapsedMs: performance.now() - start,
          requests: primary.probe.records.slice(firstRecord) });
      }
    }
    await primary.harness.signTempoAndArcEvmConcurrently('post_registration');
  } finally {
    const output = path.resolve(process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/r152/hosted-product');
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'regional-travel.json'), JSON.stringify({
      scope: 'One local browser; Gateway traffic forwarded through physically regional Containers. Regional request timing excludes the local-to-probe hop; browser elapsed includes it.',
      registrations: clients.map(regionalRegistrationEvidence),
      samples,
    }, null, 2), { mode: 0o600 });
    for (const client of clients) {
      await client.harness.attachTrace(testInfo, `${client.region}-trace.json`);
      await client.context.close();
    }
  }
});

function regionalRegistrationEvidence(client) {
  return { region: client.region, registration: client.registration, requests: client.probe.records };
}
