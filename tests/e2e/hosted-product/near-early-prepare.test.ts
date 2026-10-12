import type {
  APIRequestContext,
  BrowserContext,
  ConsoleMessage,
  Page,
  TestInfo,
} from '@playwright/test';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CandidateAssetServer } from './candidate-assets';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const { test, expect } = await import(
  pathToFileURL(path.join(publicRoot, 'node_modules/@playwright/test/index.mjs')).href
);
const { IntendedBehaviourHarness, autoConfirmWalletIframeUntil, enableSigningSessionDebugInFrame } =
  await import(
    pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
  );
const require = createRequire(path.join(publicRoot, 'packages/wallet/package.json'));
const base58 = require('bs58').default;
const assets = new CandidateAssetServer();
test.use({ launchOptions: { args: assets.browserArguments } });
test.beforeAll(assets.start.bind(assets));
test.afterAll(assets.stop.bind(assets));

class SigningTimings {
  events: { stage: string; durationMs: number }[] = [];
  record(message: ConsoleMessage): void {
    const prefix = '[SigningFlow][near] ';
    const text = message.text();
    if (!text.startsWith(prefix)) return;
    const event = JSON.parse(text.slice(prefix.length));
    if (event.event === 'ed25519_signing_timing') this.events.push(event);
  }
  assertEarlyPrepare(): void {
    const stages = this.events.map(stageName);
    expect(stages.filter(isPrepare), JSON.stringify(this.events)).toHaveLength(1);
    expect(stages.indexOf('prepare_sent')).toBeLessThan(stages.indexOf('confirmation'));
    expect(stages.indexOf('confirmation')).toBeLessThan(stages.indexOf('prepare'));
  }
}
function stageName(event: { stage: string }): string {
  return event.stage;
}
function isPrepare(stage: string): boolean {
  return stage === 'prepare_sent';
}
async function signDelegate(
  input: Parameters<NonNullable<Window['__seamsIntendedE2ESignDelegate']>>[0],
) {
  const sign = window.__seamsIntendedE2ESignDelegate;
  if (!sign) throw new Error('Delegate helper unavailable');
  return await sign(input);
}

for (let sample = 1; sample <= 3; sample += 1) {
  test(
    `hosted early prepare sample ${sample}: delegates and funded transactions`,
    measureEarlyPrepare,
  );
}

async function measureEarlyPrepare(
  { context, page, request }: { context: BrowserContext; page: Page; request: APIRequestContext },
  testInfo: TestInfo,
): Promise<void> {
  const output = process.env.SEAMS_TEST_ARTIFACT_DIR;
  if (!output) throw new Error('SEAMS_TEST_ARTIFACT_DIR is required');
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'hosted_product',
  });
  await context.addInitScript(enableSigningSessionDebugInFrame);
  await harness.initialize();
  await harness.registerPasskeyEd25519YaoWallet();
  const message = await harness.signNearMessage('Identify the hosted delegate key');
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(base58.decode(message.publicKey.slice(8))),
    ]),
    format: 'der',
    type: 'spki',
  });
  const proofs = [];
  for (const nonce of [1, 2]) {
    const timings = new SigningTimings();
    const listener = timings.record.bind(timings);
    page.on('console', listener);
    let result;
    const startedAt = performance.now();
    try {
      result = await autoConfirmWalletIframeUntil(
        page,
        page.evaluate(signDelegate, {
          senderId: message.accountId,
          receiverId: 'receiver.testnet',
          actions: [{ type: 'Transfer', amount: '1' }],
          nonce: String(nonce),
          maxBlockHeight: '999999999',
          publicKey: message.publicKey,
        }),
      );
    } finally {
      page.off('console', listener);
    }
    timings.assertEarlyPrepare();
    const bytes = Buffer.from(result.borshBytes);
    expect(bytes.at(-65)).toBe(0);
    const tag = Buffer.alloc(4);
    tag.writeUInt32LE(2 ** 30 + 366);
    const digest = createHash('sha256').update(tag).update(bytes.subarray(0, -65)).digest();
    expect(verify(null, digest, publicKey, bytes.subarray(-64))).toBe(true);
    const altered = Buffer.from(digest);
    altered[0] ^= 1;
    expect(verify(null, altered, publicKey, bytes.subarray(-64))).toBe(false);
    proofs.push({
      workload: 'delegate',
      elapsedMs: performance.now() - startedAt,
      result,
      timings: timings.events,
      verified: true,
    });
  }
  await harness.lockWallet();
  await harness.unlockPasskeyWallet();
  // The first transaction funds the implicit account. Measure the two funded warm calls.
  await harness.signNearTransaction('post_unlock');
  await closeTransactionReceipt(page);
  for (let index = 0; index < 2; index += 1) {
    const timings = new SigningTimings();
    const listener = timings.record.bind(timings);
    page.on('console', listener);
    const startedAt = performance.now();
    let result;
    try {
      await page.getByTestId('intended-sign-near').click({ timeout: 10_000 });
      // Model a user who keeps the review open until the chain context arrives.
      await expect
        .poll(timings.events.map.bind(timings.events, stageName))
        .toContain('prepare_sent');
      await autoConfirmWalletIframeUntil(
        page,
        expect(page.getByTestId('intended-action-status')).toHaveAttribute('data-state', 'success'),
      );
      const snapshot = JSON.parse(await page.getByTestId('intended-result-json').innerText());
      result = snapshot.action.result;
      await closeTransactionReceipt(page);
      const bytes = Buffer.from(result.signedTransactionB64, 'base64');
      expect(bytes.at(-65)).toBe(0);
      const digest = createHash('sha256').update(bytes.subarray(0, -65)).digest();
      expect(verify(null, digest, publicKey, bytes.subarray(-64))).toBe(true);
      const altered = Buffer.from(digest);
      altered[0] ^= 1;
      expect(verify(null, altered, publicKey, bytes.subarray(-64))).toBe(false);
    } finally {
      page.off('console', listener);
    }
    timings.assertEarlyPrepare();
    proofs.push({
      workload: 'funded_transaction',
      result,
      elapsedMs: performance.now() - startedAt,
      timings: timings.events,
      verified: true,
    });
  }
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, `early-${testInfo.title.match(/sample (\d+)/u)?.[1]}.json`),
    JSON.stringify({ publicKey: message.publicKey, proofs }, null, 2),
  );
}

async function closeTransactionReceipt(page: Page): Promise<void> {
  const receipt = page.getByRole('dialog', { name: 'Transaction receipt', exact: true });
  await receipt.waitFor({ state: 'visible', timeout: 5_000 });
  await receipt
    .locator('iframe')
    .contentFrame()
    .getByRole('button', {
      name: /^(Close transaction|Done)$/u,
    })
    .click({ timeout: 5_000 });
  await receipt.waitFor({ state: 'hidden', timeout: 5_000 });
}
