import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRegionalRealGateway } from '../../helpers/regional-real-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { intendedTest: test } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);

for (const { home, ingress } of [
  { home: 'US', ingress: 'WEUR' },
  { home: 'WEUR', ingress: 'APAC' },
  { home: 'APAC', ingress: 'US' },
  { home: 'OC', ingress: 'APAC' },
]) {
  test(`a ${home} wallet adds, uses and revokes an Email OTP method through ${ingress} despite lost commit replies`, async ({
    harness,
    context,
  }) => {
    const scenario = await createRegionalRealGateway({
      root,
      candidate,
      lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
      output: path.resolve(
        root,
        process.env.SEAMS_TEST_ARTIFACT_DIR ?? '.artifacts/r152/regional-real',
        `methods-${home}`,
      ),
    });
    try {
      await scenario.routeContext(context, home);
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      await scenario.routeContext(context, ingress);
      await harness.addEmailOtpAuthMethod();
      await harness.assertRepeatAdditionIsAlreadyConfigured('addEmailOtpAuthMethod');
      await harness.assertLockedPageReloadStaysLocked();
      await harness.unlockWithAddedEmailOtp();
      await harness.signNearTransaction('post_unlock');
      await harness.signTempoTransaction('post_unlock');
      await scenario.verifyMethodLifecycle(home, ingress, 'active');
      await harness.unlockPasskeyWallet();
      await harness.revokeSourceAuthMethod('added');
      await harness.assertRevokedEmailOtpCannotUnlock('added');
      await harness.unlockPasskeyWallet();
      await harness.signNearTransaction('post_unlock');
      await harness.signTempoTransaction('post_unlock');
      await scenario.verifyMethodLifecycle(home, ingress, 'revoked');
    } finally {
      await scenario.close();
    }
  });
}
