import type { BrowserContext } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRestartingRegionalGateway } from '../../helpers/restarting-regional-gateway.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { intendedTest: test, IntendedBehaviourHarness } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/harness.ts')).href
);
const { GatewayRequestEvidence } = await import(
  pathToFileURL(path.join(publicRoot, 'tests/e2e/intended-behaviours/gateway-request-evidence.ts'))
    .href
);

async function measureLifecycleCalls(
  evidence: InstanceType<typeof GatewayRequestEvidence>,
  home: string,
  operation: string,
  action: () => Promise<unknown>,
) {
  const started = performance.now();
  await action();
  return { home, operation, ...(await evidence.window(started, performance.now())) };
}

for (const { home, ingress } of [
  { home: 'US', ingress: 'WEUR' },
  { home: 'WEUR', ingress: 'APAC' },
  { home: 'APAC', ingress: 'US' },
  { home: 'OC', ingress: 'APAC' },
]) {
  test(`real ${home} registration and ${ingress} linked signing survive lost execution, activation and cleanup replies with Gateway restarts`, async ({
    harness,
    context,
    browser,
  }) => {
    const scenario = await createRestartingRegionalGateway({
      root,
      candidate,
      lostAcknowledgements: 2,
      localRoot: process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
      output: path.resolve(
        root,
        process.env.SEAMS_TEST_ARTIFACT_DIR ?? '.artifacts/r152/regional-real',
        home,
      ),
    });
    try {
      await scenario.routeContext(context, home);
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      const previous = browser.contexts();
      const device = await harness.openLinkedDevice(browser);
      const opened = browser.contexts().filter(isNewContext.bind(undefined, previous));
      if (opened.length !== 1) throw new Error('Expected one linked browser context');
      await scenario.routeContext(opened[0], ingress);
      await harness.linkDeviceWithPasskey(device);
      await device.signNearTransaction('post_device_link');
      await device.signTempoTransaction('post_device_link');
      await scenario.verifyHome(home, ingress);
    } finally {
      await scenario.close();
    }
  });
}

test('four real wallets register concurrently and retain distinct homes through travel, interrupted recovery and Gateway restarts', async ({
  browser,
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
      'mixed-homes',
    ),
  });
  const owners = [];
  const measurements = [];
  try {
    for (const { home, travel } of [
      { home: 'US', travel: 'APAC' },
      { home: 'WEUR', travel: 'US' },
      { home: 'APAC', travel: 'WEUR' },
      { home: 'OC', travel: 'APAC' },
    ]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const harness = new IntendedBehaviourHarness({
        context,
        page,
        request: scenario.requestsFor(travel, request),
        flow: 'passkey.registration',
        networkMode: 'managed_local',
      });
      owners.push({ home, travel, context, harness, page });
      await harness.initialize();
      await scenario.routeContext(context, home);
    }
    const registrations = await Promise.all(owners.map(registerOwner));
    const wallets = [];
    for (const owner of owners) {
      const evidence = new GatewayRequestEvidence();
      evidence.start(owner.context);
      await scenario.routeContext(owner.context, owner.travel);
      await owner.harness.assertLockedPageReloadStaysLocked();
      measurements.push(
        await measureLifecycleCalls(
          evidence,
          owner.home,
          'unlock',
          owner.harness.unlockPasskeyWallet.bind(owner.harness),
        ),
      );
      measurements.push(
        await measureLifecycleCalls(
          evidence,
          owner.home,
          'export_ed25519',
          owner.harness.exportEd25519Key.bind(owner.harness),
        ),
      );
      measurements.push(
        await measureLifecycleCalls(
          evidence,
          owner.home,
          'export_ecdsa',
          owner.harness.exportEcdsaKey.bind(owner.harness),
        ),
      );
      await owner.harness.signNearTransaction('post_unlock');
      measurements.push(
        await measureLifecycleCalls(
          evidence,
          owner.home,
          'sign_tempo',
          owner.harness.signTempoTransaction.bind(owner.harness, 'post_unlock'),
        ),
      );
      const walletId = await owner.page
        .getByTestId('intended-e2e-page')
        .getAttribute('data-login-wallet-id');
      if (!walletId) throw new Error('Registered owner must retain its wallet identity');
      measurements.push(
        await measureLifecycleCalls(
          evidence,
          owner.home,
          'recovery_with_lost_reply',
          owner.harness.recoverPasskeyWalletAfterLostFinalizationResponse.bind(
            owner.harness,
            scenario.finalizationCommitter(owner.travel),
          ),
        ),
      );
      evidence.stop(owner.context);
      await owner.harness.assertRecoveryAuthorityIsAdditive('passkey');
      wallets.push({ home: owner.home, travel: owner.travel, walletId });
    }
    for (const owner of owners) {
      await owner.harness.unlockPasskeyWallet();
      await owner.harness.signNearTransaction('post_unlock');
      await owner.harness.signTempoTransaction('post_unlock');
    }
    await scenario.verifyMixedHomes(wallets, registrations);
    for (const owner of owners) {
      await owner.harness.attachTrace(testInfo, `${owner.home}-owner-trace.json`);
      owner.harness.assertNoLifecycleViolations();
      owner.harness.assertNoWrongAuthPath();
    }
  } finally {
    const output = path.resolve(
      root,
      process.env.SEAMS_TEST_ARTIFACT_DIR ?? '.artifacts/r152/regional-real',
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'lifecycle-d1-calls.json'),
      JSON.stringify(
        {
          scope:
            'Browser Gateway POSTs; home handleSplitGatewayRequest SIGNER_DB calls only. Console, role-private storage and fixture API requests excluded. Local emulator timings are not regional network measurements.',
          measurements,
        },
        null,
        2,
      ),
    );
    for (const owner of owners) await owner.context.close();
    await scenario.close();
  }
});

function isNewContext(previous: BrowserContext[], context: BrowserContext) {
  return !previous.includes(context);
}

async function registerOwner(owner: {
  home: string;
  harness: {
    registerPasskeyWallet(): Promise<void>;
    awaitNearReady(): Promise<void>;
  };
}) {
  const startedAtMs = Date.now();
  await owner.harness.registerPasskeyWallet();
  const completedAtMs = Date.now();
  await owner.harness.awaitNearReady();
  return { home: owner.home, startedAtMs, completedAtMs };
}
