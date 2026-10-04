import { setTimeout as delay } from 'node:timers/promises';
import type { APIRequestContext, Browser, BrowserContext, Route, TestInfo } from '@playwright/test';
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

type ProbeIdentity = {
  bootId: string;
  source: string;
  applicationId: string;
  instanceId: string;
  location: string;
  region: string;
  country: string;
};

type RequestTiming = {
  region: Region;
  identity: ProbeIdentity;
  path: string;
  method: string;
  status: number;
  regionalHeadersMs: number;
  regionalCompletedMs: number;
  localRoundtripMs: number;
  gatewayRay: string | null;
  failureCode: string | null;
};

type RegionalClient = {
  region: Region;
  context: BrowserContext;
  probe: RegionalGatewayProbe;
  harness: InstanceType<typeof IntendedBehaviourHarness>;
  registration: { started: number; completed: number; walletId: string } | null;
};

class RegionalGatewayProbe {
  region: Region;
  readonly records: RequestTiming[] = [];
  readonly identityReads: { region: Region; status: number }[] = [];
  private readonly identities = new Map<Region, ProbeIdentity>();

  constructor(
    region: Region,
    private readonly url: string,
    private readonly token: string,
  ) {
    this.region = region;
  }

  async initialize(): Promise<void> {
    await this.selectRegion(this.region);
  }

  async selectRegion(region: Region): Promise<void> {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(`${this.url}/${region}/identity`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(200_000),
      });
      this.identityReads.push({ region, status: response.status });
      if (response.ok || response.status < 500) break;
      await response.body?.cancel();
      await delay((attempt + 1) * 1_000);
    }
    if (!response?.ok) throw new Error(`Probe ${region} identity: HTTP ${response?.status}`);
    const identity = await response.json();
    if (!identity.bootId || !identity.location || identity.region !== region.toUpperCase()) {
      throw new Error(`Probe ${region} omitted or mismatched its physical identity`);
    }
    this.identities.set(region, identity);
    this.region = region;
  }

  async forward(route: Route): Promise<void> {
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
      failureCode: responseFailureCode(result.status, result.bodyBase64),
    });
    await route.fulfill({
      status: result.status,
      headers: result.headers,
      body: Buffer.from(result.bodyBase64, 'base64'),
    });
  }
}

async function registerRegionalWallet(client: RegionalClient): Promise<void> {
  await client.harness.initialize();
  const started = performance.now();
  await client.harness.registerPasskeyWallet();
  await client.harness.awaitNearReady();
  client.registration = { started, completed: performance.now(), walletId: client.harness.walletId };
}

for (const home of ['weur', 'apac'] as const) {
  test(`${home} home: hosted concurrent regional registration and same-wallet travel`,
    async ({ browser, request }, testInfo) => {
      await verifyRegionalTravel(home, { browser, request }, testInfo);
    });
}

async function verifyRegionalTravel(
  home: Region,
  { browser, request }: { browser: Browser; request: APIRequestContext },
  testInfo: TestInfo,
): Promise<void> {
  test.skip(!process.env.SEAMS_HOSTED_PROBE, 'A deployed regional probe is required');
  test.setTimeout(600_000);
  const config = JSON.parse(await readFile(process.env.SEAMS_HOSTED_PROBE!, 'utf8'));
  const clients: RegionalClient[] = [];
  const unlocks: { region: Region; elapsedMs: number; requests: RequestTiming[] }[] = [];
  const samples: { region: Region; index: number; elapsedMs: number; requests: RequestTiming[] }[] = [];
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
    const primary = clients.find(clientHasRegion.bind(undefined, home));
    if (!primary) throw new Error(`${home} client is missing`);
    const sequence: Region[] = [home, home === 'weur' ? 'apac' : 'weur', 'enam', home];
    for (const region of sequence) {
      await primary.probe.selectRegion(region);
      const unlockStart = performance.now();
      const unlockFirstRecord = primary.probe.records.length;
      await primary.harness.unlockPasskeyWallet();
      unlocks.push({ region, elapsedMs: performance.now() - unlockStart,
        requests: primary.probe.records.slice(unlockFirstRecord) });
      for (let index = 0; index < 3; index += 1) {
        const start = performance.now();
        const firstRecord = primary.probe.records.length;
        await primary.harness.signTempoTransaction('post_unlock');
        samples.push({ region, index, elapsedMs: performance.now() - start,
          requests: primary.probe.records.slice(firstRecord) });
      }
    }
    await primary.harness.unlockPasskeyWallet();
    await primary.harness.signNearTransaction('post_unlock');
    await primary.harness.signTempoAndArcEvmConcurrently('post_unlock');
  } finally {
    const output = path.resolve(process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/r152/hosted-product');
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, `regional-travel-${home}.json`), JSON.stringify({
      scope: 'One local browser; Gateway traffic forwarded through physically regional Containers. Regional request timing excludes the local-to-probe hop; browser elapsed includes it.',
      home,
      registrations: clients.map(regionalRegistrationEvidence),
      unlocks,
      samples,
    }, null, 2), { mode: 0o600 });
    for (const client of clients) {
      await client.harness.attachTrace(testInfo, `${client.region}-trace.json`);
      await client.context.close();
    }
  }
}

function regionalRegistrationEvidence(client: RegionalClient) {
  return { region: client.region, registration: client.registration,
    identityReads: client.probe.identityReads, requests: client.probe.records };
}

function clientHasRegion(region: Region, client: RegionalClient): boolean {
  return client.region === region;
}

function responseFailureCode(status: number, bodyBase64: string): string | null {
  if (status < 400) return null;
  try {
    const body: unknown = JSON.parse(Buffer.from(bodyBase64, 'base64').toString('utf8'));
    if (!body || typeof body !== 'object') return null;
    if ('code' in body && typeof body.code === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(body.code)) {
      return body.code;
    }
    if ('error' in body && typeof body.error === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(body.error)) {
      return body.error;
    }
    return null;
  } catch {
    return null;
  }
}
