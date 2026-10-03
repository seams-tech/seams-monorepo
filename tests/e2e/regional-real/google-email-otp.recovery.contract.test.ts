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

for (const { home, ingress } of [
  { home: 'US', ingress: 'APAC' },
  { home: 'WEUR', ingress: 'US' },
  { home: 'APAC', ingress: 'WEUR' },
]) {
  test(`a ${home} passkey wallet survives interrupted Google Email OTP recovery and Gateway restart through ${ingress}`, async ({
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
        `google-recovery-${home}`,
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
      await harness.registerPasskeyWallet();
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
      await scenario.verifyGoogleRecovery(home, ingress);
      harness.assertNoLifecycleViolations();
      harness.assertNoWrongAuthPath();
    } finally {
      await harness.attachTrace(testInfo);
      await scenario.close();
    }
  });
}
