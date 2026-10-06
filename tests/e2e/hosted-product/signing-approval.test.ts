import type { Request, Route } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHex, recoverTransactionAddress } from 'viem';
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

class ApprovalRequests {
  statuses = 0;
  prepares = 0;
  finalizes = 0;
  mode: 'unavailable' | 'wrong_session' | 'success' = 'success';

  record(request: Request): void {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/wallet/session/status') this.statuses += 1;
    if (pathname === '/router-ab/ecdsa-derivation/sign/prepare') this.prepares += 1;
    if (pathname === '/router-ab/ecdsa-derivation/sign') this.finalizes += 1;
  }

  async prepare(route: Route): Promise<void> {
    switch (this.mode) {
      case 'unavailable':
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
        return;
      case 'wrong_session': {
        const response = await route.fetch();
        if (!response.ok()) throw new Error(`Prepare failed: ${response.status()}`);
        const body = await response.json();
        body.session_status.walletSessionId += '-wrong-session';
        await route.fulfill({ response, json: body });
        return;
      }
      case 'success':
        await route.continue();
    }
  }
}

test('hosted signing requires fresh prepare authority before finalization', async ({
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
  const capture = new ApprovalRequests();
  const record = capture.record.bind(capture);
  const prepare = capture.prepare.bind(capture);
  const rounds = [];
  let stepUpVerified = false;
  let postStepUpBudgetStatus: string | null = null;
  try {
    await harness.initialize();
    await harness.registerPasskeyWallet();
    const registration = JSON.parse(await page.getByTestId('intended-result-json').innerText());
    const expectedAddress = registration.action.result.ecdsaTargetKeys.arcEvm.thresholdOwnerAddress;
    await harness.awaitNearReady();
    await harness.unlockPasskeyWallet();
    await harness.signTempoTransaction('post_unlock');
    await page
      .getByRole('dialog', { name: 'Transaction receipt' })
      .frameLocator('iframe')
      .getByRole('button', { name: 'Close transaction', exact: true })
      .click();
    context.on('request', record);
    await context.route('**/router-ab/ecdsa-derivation/sign/prepare', prepare);
    const result = page.getByTestId('intended-result-json');
    const actionStatus = page.getByTestId('intended-action-status');
    const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
    const confirm = wallet
      .locator('#seams-confirm-portal button.btn-confirm, #seams-confirm-portal button.confirm')
      .last();
    for (const mode of ['unavailable', 'wrong_session', 'success'] as const) {
      capture.mode = mode;
      const failure = mode !== 'success';
      capture.statuses = 0;
      capture.prepares = 0;
      capture.finalizes = 0;
      await page.getByTestId('intended-sign-arc-evm').click();
      await expect(confirm).toBeVisible({ timeout: 30_000 });
      expect(capture.statuses).toBe(0);
      expect(capture.prepares).toBe(0);
      await confirm.click();
      await expect(actionStatus).toHaveText(failure ? 'error' : 'success', {
        timeout: 60_000,
      });
      expect(capture.statuses).toBe(0);
      expect(capture.prepares).toBe(1);
      if (failure) {
        expect(capture.finalizes).toBe(0);
        await page
          .getByRole('dialog', { name: 'Transaction receipt' })
          .frameLocator('iframe')
          .getByRole('button', { name: 'Minimize transaction', exact: true })
          .click();
      } else {
        expect(capture.finalizes).toBe(1);
        const signed = JSON.parse(await result.innerText()).action.result;
        if (!isHex(signed.rawTxHex)) throw new Error('Expected a signed transaction');
        expect(
          (
            await recoverTransactionAddress({ serializedTransaction: signed.rawTxHex })
          ).toLowerCase(),
        ).toBe(expectedAddress.toLowerCase());
      }
      rounds.push({
        prepareMode: mode,
        preApprovalStatusRequests: 0,
        postApprovalStatusRequests: capture.statuses,
        signingPrepareRequests: capture.prepares,
        signingFinalizeRequests: capture.finalizes,
        verifiedSignature: !failure,
      });
    }
    await page
      .getByRole('dialog', { name: 'Transaction receipt' })
      .frameLocator('iframe')
      .getByRole('button', { name: 'Done', exact: true })
      .click({ timeout: 15_000 });
    // Exhaustion is discovered after warm approval. Fresh authorization appears
    // in the receipt frame while the original SDK operation remains pending.
    await Promise.all([
      harness.signTempoTransaction('step_up_required'),
      page
        .getByRole('dialog', { name: 'Transaction receipt' })
        .frameLocator('iframe')
        .getByRole('button', { name: 'Confirm', exact: true })
        .click({ timeout: 30_000 }),
    ]);
    stepUpVerified = true;
    const budget = await harness.readCurrentWalletSessionStatus();
    postStepUpBudgetStatus = budget.status;
    expect(budget.status).toBe('exhausted');
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
  } finally {
    context.off('request', record);
    const output = path.resolve(
      process.env.SEAMS_TEST_ARTIFACT_DIR || '.artifacts/signing-approval',
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'approval-evidence.json'),
      JSON.stringify({ rounds, stepUpVerified, postStepUpBudgetStatus }, null, 2),
    );
    await harness.attachTrace(testInfo);
  }
});
