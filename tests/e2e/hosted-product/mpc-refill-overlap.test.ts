import type { Route } from '@playwright/test';
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
const { SigningTimingEvidence } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/signing-timing-evidence.ts'))
    .href
);

type RefillEvent = {
  receivedAtMs: number;
  outcome: string;
  depth: number;
};

class RefillDuringPrepare {
  private heldAt: number | null = null;
  completedRefill: RefillEvent | null = null;

  constructor(private readonly events: readonly RefillEvent[]) {}

  private completedWhileHeld(): RefillEvent | null {
    if (this.heldAt === null) return null;
    for (const event of this.events) {
      if (event.receivedAtMs >= this.heldAt && event.outcome === 'available' && event.depth >= 2)
        return event;
    }
    return null;
  }

  async route(route: Route): Promise<void> {
    if (this.heldAt !== null) {
      await route.continue();
      return;
    }
    this.heldAt = performance.now();
    try {
      await expect.poll(this.completedWhileHeld.bind(this), { timeout: 45_000 }).not.toBeNull();
      this.completedRefill = this.completedWhileHeld();
      await route.continue();
    } catch (error) {
      await route.abort();
      throw error;
    }
  }
}

test('hosted refill supplies the next signatures while prepare is pending', async ({
  context,
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  await installCandidateAssets(context);
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'hosted_product',
  });
  const timing = new SigningTimingEvidence();
  const record = timing.record.bind(timing);
  const gate = new RefillDuringPrepare(timing.refillResults);
  const route = gate.route.bind(gate);
  const prepare = '**/router-ab/ecdsa-derivation/sign/prepare';
  let verifiedSignatures = 0;
  page.on('console', record);
  try {
    await harness.initialize();
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    await harness.unlockPasskeyWallet();
    await context.route(prepare, route);
    for (let index = 0; index < 3; index += 1) {
      await harness.signTempoTransaction('post_unlock');
      verifiedSignatures += 1;
    }
    expect(gate.completedRefill).not.toBeNull();
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
  } finally {
    page.off('console', record);
    const output = path.resolve(process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/mpc-refill');
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'refill-overlap.json'),
      JSON.stringify(
        {
          scope:
            'Hold the first prepare until background refill supplies at least two available entries; then verify three signatures with the hosted backend.',
          verifiedSignatures,
          completedWhilePreparePending: gate.completedRefill,
          refills: timing.refillResults,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await harness.attachTrace(testInfo);
    await context.unroute(prepare, route);
  }
});
