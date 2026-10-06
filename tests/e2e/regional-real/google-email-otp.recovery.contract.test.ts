import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test';
import { RegionalEmailMailbox } from '../../helpers/regional-email-mailbox.mjs';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRestartingRegionalGateway } from '../../helpers/restarting-regional-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { intendedTest: test, IntendedBehaviourHarness } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);

for (const foundingMethod of ['passkey', 'email_otp'] as const) {
  for (const { home, ingress } of [
    { home: 'US', ingress: 'APAC' },
    { home: 'WEUR', ingress: 'US' },
    { home: 'APAC', ingress: 'WEUR' },
    { home: 'OC', ingress: 'APAC' },
  ]) {
    test(`a ${home} ${foundingMethod}-founded wallet survives interrupted Google Email OTP recovery and Gateway restart through ${ingress}`, async ({
      context,
      page,
      request,
    }, testInfo) => {
      const scenario = await createRestartingRegionalGateway({
        root,
        candidate,
        lostAcknowledgements: 0,
        localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
        output: path.resolve(
          root,
          process.env.SEAMS_TEST_ARTIFACT_DIR ?? '.artifacts/r152/regional-real',
          `google-recovery-${foundingMethod}-${home}`,
        ),
      });
      const harness = new IntendedBehaviourHarness({
        context,
        page,
        request: scenario.requestsFor(ingress, request),
        flow: 'email_otp.recovery',
        networkMode: 'managed_local',
      });
      try {
        await harness.initialize();
        await scenario.routeContext(context, home);
        if (foundingMethod === 'passkey') await harness.registerPasskeyWallet();
        else await harness.registerEmailOtpWallet();
        await harness.awaitNearReady();
        await harness.signTempoTransaction('post_registration');
        await scenario.routeContext(context, ingress);
        await harness.recoverGoogleEmailOtpWalletAfterLostFinalizationResponse(
          scenario.finalizationCommitter(ingress),
        );
        await harness.assertRecoveryAuthorityIsAdditive('google_email_otp');
        await harness.unlockWithAddedEmailOtp();
        await harness.signNearTransaction('post_unlock');
        await harness.signTempoAndArcEvmConcurrently('post_unlock');
        await harness.exportEd25519Key();
        await harness.exportEcdsaKey();
        await scenario.verifyGoogleRecovery(home, ingress, foundingMethod);
        harness.assertNoLifecycleViolations();
        harness.assertNoWrongAuthPath();
      } finally {
        await harness.attachTrace(testInfo);
        await scenario.close();
      }
    });
  }
}

async function verifyEmailOtpBudgetAndStepUp(
  { context, page, request }: { context: BrowserContext; page: Page; request: APIRequestContext },
  testInfo: TestInfo,
) {
  const emailDelivery = new RegionalEmailMailbox();
  const scenario = await createRegionalRealGateway({
    emailDelivery,
    root,
    candidate,
    lostAcknowledgements: 0,
    localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
    output: path.resolve(root, '.artifacts/r155b/console-outage/email-otp-budget-step-up'),
  });
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request: scenario.requestsFor('US', request),
    flow: 'email_otp.recovery',
    networkMode: 'managed_local',
  });
  try {
    await harness.initialize();
    await scenario.routeContext(context, 'US');
    await harness.registerEmailOtpWallet();
    await harness.awaitNearReady();
    await harness.unlockEmailOtpWallet();
    scenario.beginConsoleOutage();
    await scenario.routeContext(context, 'WEUR');
    await harness.signNearTransaction('post_unlock');
    await harness.signTempoAndArcEvmConcurrently('post_unlock');
    await scenario.routeContext(context, 'APAC');
    await harness.signNearTransaction('step_up_required');
    await scenario.routeContext(context, 'OC');
    await harness.signTempoTransaction('step_up_required');
    await scenario.verifyStepUpConsoleOutage();
    harness.assertNoLifecycleViolations();
  } finally {
    await testInfo.attach('email-delivery-evidence.json', {
      body: Buffer.from(JSON.stringify(emailDelivery.evidence())),
      contentType: 'application/json',
    });
    await testInfo.attach('email-otp-console-dependencies.json', {
      body: Buffer.from(JSON.stringify({ consoleRequests: scenario.consoleService.requests })),
      contentType: 'application/json',
    });
    await harness.attachTrace(testInfo);
    await scenario.close();
  }
}

test('Email OTP budget exhaustion and both signing step-ups work while Console is unavailable', verifyEmailOtpBudgetAndStepUp);
