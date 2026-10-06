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

for (const curve of ['ecdsa', 'ed25519']) {
  test(`${curve} signs three times while Console is unavailable`, async ({ harness, context }) => {
    const scenario = await createRegionalRealGateway({
      root,
      candidate,
      lostAcknowledgements: 0,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
      output: path.resolve(root, '.artifacts/r155b/console-outage', curve),
    });
    try {
      await scenario.routeContext(context, 'US');
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      scenario.beginConsoleOutage();
      for (let index = 0; index < 3; index += 1) {
        if (curve === 'ecdsa') await harness.signTempoTransaction('post_registration');
        else await harness.signNearTransaction('post_registration');
      }
      await scenario.verifyConsoleOutage(curve);
    } finally {
      await scenario.close();
    }
  });
}
