import { installCandidateAssets } from './candidate-assets';
import type { Request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
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

class RefillRequestCapture {
  request: Request | null = null;

  record(request: Request): void {
    if (this.request) return;
    if (new URL(request.url()).pathname.endsWith('/presignature-pool/fill/step')) {
      this.request = request;
    }
  }

  observed(): boolean {
    return this.request !== null;
  }
}

test('retired refill session is rejected after unlock while new session signs', async ({
  context,
  page,
  request,
}, testInfo) => {
  await installCandidateAssets(context);
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'hosted_product',
  });
  const capture = new RefillRequestCapture();
  const record = capture.record.bind(capture);
  context.on('request', record);
  try {
    await harness.initialize();
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    await expect.poll(capture.observed.bind(capture), { timeout: 30_000 }).toBe(true);
    const oldRequest = capture.request;
    if (!oldRequest) throw new Error('No refill request captured');
    await harness.assertLockedPageReloadStaysLocked();
    await harness.unlockPasskeyWallet();
    const response = await request.post(oldRequest.url(), {
      headers: await oldRequest.allHeaders(),
      data: oldRequest.postDataBuffer(),
    });
    const body = await response.json();
    const output = path.resolve(
      process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/r152/refill-session',
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'retired-refill.json'),
      JSON.stringify({ status: response.status(), code: body.code }, null, 2),
    );
    expect(response.status()).toBe(401);
    expect(body.code).toBe('wallet_session_invalid');
    await harness.signTempoTransaction('post_unlock');
  } finally {
    context.off('request', record);
    await harness.attachTrace(testInfo);
  }
});
