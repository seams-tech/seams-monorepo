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
  readonly signingRequests = new Map<string, Request>();

  record(request: Request): void {
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === 'POST' &&
      (pathname === '/router-ab/ecdsa-derivation/sign/prepare' ||
        pathname === '/router-ab/ecdsa-derivation/sign') &&
      !this.signingRequests.has(pathname)
    ) {
      this.signingRequests.set(pathname, request);
    }
    if (this.request) return;
    if (pathname.endsWith('/presignature-pool/fill/step')) {
      this.request = request;
    }
  }

  observed(): boolean {
    return this.request !== null;
  }
}

test('retired session cannot refill, prepare or finalize while its replacement signs', async ({
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
    await harness.unlockPasskeyWallet();
    await harness.signTempoTransaction('post_unlock');
    expect(capture.signingRequests.size).toBe(2);
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
    const rejectedSigningRequests = [];
    for (const [pathname, signingRequest] of capture.signingRequests) {
      const replay = await request.post(signingRequest.url(), {
        headers: await signingRequest.allHeaders(),
        data: signingRequest.postDataBuffer(),
      });
      const replayBody = await replay.json();
      rejectedSigningRequests.push({
        path: pathname,
        status: replay.status(),
        code: replayBody.code,
      });
      await writeFile(
        path.join(output, 'retired-signing-requests.json'),
        JSON.stringify(rejectedSigningRequests, null, 2),
      );
      expect(replay.status()).toBe(401);
      expect(replayBody.code).toBe('wallet_session_invalid');
    }
    await harness.signTempoTransaction('post_unlock');
    await writeFile(
      path.join(output, 'replacement-session-signing.json'),
      JSON.stringify(
        {
          retiredSessionRejected: true,
          rejectedSigningRequests,
          replacementSignatureVerified: true,
        },
        null,
        2,
      ),
    );
  } finally {
    context.off('request', record);
    await harness.attachTrace(testInfo);
  }
});
