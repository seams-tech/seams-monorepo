import assert from 'node:assert/strict';
import { RegionalDeviceProofFixture } from '../helpers/regional-device-proof.fixtures.mjs';
import {
  buildRegionalLinkOwnerFixture,
  RegionalLinkOwnerAuthorizationFixture,
} from '../helpers/regional-link-home.fixtures.mjs';

export async function verifyRegionalLinkHomes({
  api,
  runtime,
  bridges,
  consoleBridge,
  signerScope,
  isolatedIdentity,
}) {
  const homes = [];
  const fixture = new RegionalDeviceProofFixture();
  for (const [region, bridge] of bridges) {
    const database = new ImportFaultDatabase(await runtime.getD1Database('SIGNER_DB', region));
    const store = new api.D1LinkedDeviceSessionStoreV1({
      database,
      bootstrap: bridge.publisher.linkedDeviceBootstrap(),
      scope: signerScope,
    });
    const authorization = new RegionalLinkOwnerAuthorizationFixture();
    const service = new api.LinkedDeviceSessionServiceV1({
      store,
      authorization,
    });
    homes.push({
      region,
      database,
      bridge,
      store,
      authorization,
      service,
      owner: buildRegionalLinkOwnerFixture(api, bridge),
    });
  }
  const observations = [];
  for (const home of homes) {
    const request = await fixture.createRequest(api, `home-${home.region}`);
    const { payload } = await request.json();
    assert.equal(
      (await home.service.createUnclaimedSessionV1({ payload, nowMs: Date.now() })).outcome,
      'applied',
    );
    for (const reader of homes) {
      assert.equal(
        (await reader.store.getSessionV1(payload.linkSessionId)).state.state,
        'displaying_qr',
      );
      assert.equal(await localCount(reader, payload.linkSessionId), 0);
    }
    const locator = api.WalletRouteLocator.parse({
      kind: 'linked_device',
      value: payload.linkSessionId,
    });
    home.authorization.allowed = false;
    assert.equal((await claim(home, payload)).outcome, 'unauthorized');
    assert.equal(await home.bridge.publisher.findRoute(locator), null);
    home.authorization.allowed = true;
    consoleBridge.available = false;
    try {
      assert.equal((await claim(home, payload)).outcome, 'home_unavailable');
    } finally {
      consoleBridge.available = true;
    }
    assert.equal(
      (await home.store.getSessionV1(payload.linkSessionId)).state.state,
      'displaying_qr',
    );
    consoleBridge.dropNextBootstrapClaimReply = true;
    assert.equal((await claim(home, payload)).outcome, 'home_unavailable');
    assert.equal(await localCount(home, payload.linkSessionId), 0);
    assert.equal((await claim(home, payload)).outcome, 'replayed');
    assert.equal((await claim(home, payload)).outcome, 'replayed');
    assert.equal(await isolatedIdentity.findRoute(locator), null);
    assert.deepEqual(await isolatedIdentity.linkedDeviceBootstrap().read(payload.linkSessionId), {
      ok: true,
      record: null,
    });
    const ingress = await runtime.getWorker(home.region === 'US' ? 'APAC' : 'US');
    const other = homes.find(isOtherHome.bind(null, home));
    for (const action of [
      '',
      '/approval',
      '/target-preparation',
      '/credential',
      '/receipt',
      '/cancel',
      '/email-otp/challenge',
      '/email-otp/challenge/resend',
      '/email-otp/challenge/verify',
      '/source-contribution/execute',
    ]) {
      const path = `/wallet/device-linking/v1/sessions/${encodeURIComponent(payload.linkSessionId)}${action}`;
      const method = action === '' || action === '/approval' ? 'GET' : 'POST';
      const response = await ingress.fetch(`https://wallet.test${path}`, { method });
      assert.equal(response.status, 422);
      assert.equal((await response.json()).region, home.region);
      const conflict = await ingress.fetch(`https://wallet.test${path}`, {
        method,
        headers: { authorization: `Bearer ${other.bridge.issued.operationCredential.token}` },
      });
      assert.equal(conflict.status, 403);
    }
    const cancelled = await home.service.cancelSessionV1({
      linkSessionId: payload.linkSessionId,
      expectedRevision: 2,
      nowMs: Date.now(),
    });
    assert.equal(cancelled.outcome, 'applied');
    assert.equal(
      (await home.bridge.publisher.findRoute(locator)).wallet.walletId,
      home.owner.walletId,
    );
    assert.equal(
      (await other.bridge.publisher.publishLifecycle({ walletId: other.owner.walletId, locator }))
        .ok,
      false,
    );
    observations.push({
      region: home.region,
      claimedAtHome: true,
      publicationFailurePreventsLocalClaim: true,
      lostReplyRetry: true,
      cancellationRetainsHome: true,
    });
  }
  const competingRequest = await fixture.createRequest(api, 'competing-owner');
  const { payload } = await competingRequest.json();
  for (const home of homes)
    await home.service.createUnclaimedSessionV1({ payload, nowMs: Date.now() });
  const attempts = await Promise.all(homes.map(claimForPayload.bind(null, payload)));
  assert.equal(attempts.filter(applied).length, 1, JSON.stringify(attempts));
  assert.equal(attempts.filter(homeConflict).length, 2, JSON.stringify(attempts));
  let persistedClaims = 0;
  for (const home of homes) {
    persistedClaims += await localCount(home, payload.linkSessionId);
  }
  assert.equal(persistedClaims, 1);
  const atomicPayload = await newPayload(api, fixture, 'atomic-rollback');
  await homes[0].service.createUnclaimedSessionV1({ payload: atomicPayload, nowMs: Date.now() });
  await consoleBridge.database
    .prepare(
      `CREATE TRIGGER controlled_claim_failure BEFORE UPDATE ON linked_device_bootstrap
    WHEN NEW.state = 'claimed' BEGIN SELECT RAISE(ABORT, 'Controlled claim update failure'); END`,
    )
    .run();
  try {
    assert.equal((await claim(homes[0], atomicPayload)).outcome, 'home_unavailable');
    assert.equal(
      await homes[0].bridge.publisher.findRoute(
        api.WalletRouteLocator.parse({ kind: 'linked_device', value: atomicPayload.linkSessionId }),
      ),
      null,
    );
    assert.equal(
      (await homes[0].store.getSessionV1(atomicPayload.linkSessionId)).state.state,
      'displaying_qr',
    );
  } finally {
    await consoleBridge.database.prepare('DROP TRIGGER controlled_claim_failure').run();
  }
  assert.equal((await claim(homes[0], atomicPayload)).outcome, 'applied');
  const faultHome = homes[0];
  const failedImport = await newPayload(api, fixture, 'import-failure');
  await faultHome.service.createUnclaimedSessionV1({ payload: failedImport, nowMs: Date.now() });
  faultHome.database.failure = 'before';
  assert.equal((await claim(faultHome, failedImport)).outcome, 'home_unavailable');
  assert.equal(await localCount(faultHome, failedImport.linkSessionId), 0);
  assert.equal((await claim(faultHome, failedImport)).outcome, 'replayed');
  const lostImport = await newPayload(api, fixture, 'import-lost-reply');
  await faultHome.service.createUnclaimedSessionV1({ payload: lostImport, nowMs: Date.now() });
  faultHome.database.failure = 'after';
  assert.equal((await claim(faultHome, lostImport)).outcome, 'applied');
  for (const foreign of homes.slice(1)) {
    assert.deepEqual(
      await foreign.bridge.publisher.linkedDeviceBootstrap().read(lostImport.linkSessionId),
      { ok: false, code: 'home_conflict' },
    );
    assert.equal(await localCount(foreign, lostImport.linkSessionId), 0);
  }
  await faultHome.database.batch([
    faultHome.database
      .prepare('DELETE FROM linked_device_session_transcripts WHERE link_session_id = ?')
      .bind(lostImport.linkSessionId),
    faultHome.database
      .prepare('DELETE FROM linked_device_sessions WHERE link_session_id = ?')
      .bind(lostImport.linkSessionId),
  ]);
  assert.equal(await faultHome.store.getSessionV1(lostImport.linkSessionId), null);
  const cancelledPayload = await newPayload(api, fixture, 'cancel-unclaimed');
  await homes[0].service.createUnclaimedSessionV1({ payload: cancelledPayload, nowMs: Date.now() });
  assert.equal(
    (
      await homes[1].service.cancelSessionV1({
        linkSessionId: cancelledPayload.linkSessionId,
        expectedRevision: 1,
        nowMs: Date.now(),
      })
    ).outcome,
    'applied',
  );
  for (const home of homes) {
    assert.equal(
      (await home.store.getSessionV1(cancelledPayload.linkSessionId)).state.state,
      'cancelled',
    );
    assert.equal(await localCount(home, cancelledPayload.linkSessionId), 0);
  }
  assert.equal(
    await homes[0].bridge.publisher.findRoute(
      api.WalletRouteLocator.parse({
        kind: 'linked_device',
        value: cancelledPayload.linkSessionId,
      }),
    ),
    null,
  );
  const racedPayload = await newPayload(api, fixture, 'cancel-claim-race');
  await homes[0].service.createUnclaimedSessionV1({ payload: racedPayload, nowMs: Date.now() });
  await Promise.all([
    claim(homes[0], racedPayload),
    homes[1].service.cancelSessionV1({
      linkSessionId: racedPayload.linkSessionId,
      expectedRevision: 1,
      nowMs: Date.now(),
    }),
  ]);
  const raced = await homes[0].store.getSessionV1(racedPayload.linkSessionId);
  const racedRoute = await homes[0].bridge.publisher.findRoute(
    api.WalletRouteLocator.parse({ kind: 'linked_device', value: racedPayload.linkSessionId }),
  );
  assert.ok(['claimed', 'cancelled'].includes(raced.state.state));
  assert.equal(Boolean(racedRoute), raced.state.state === 'claimed');
  return {
    atomicClaimRollback: true,
    sharedQrAcrossRegions: true,
    failedImportRetry: true,
    lostImportReply: true,
    cleanupCannotResurrect: true,
    unclaimedCancellation: true,
    claimCancellationRace: raced.state.state,
    observations,
    competingOwners: 3,
    committedClaims: persistedClaims,
    scope:
      'Production shared QR authority, atomic claim/home binding, regional session/transcript import and immutable home directory. Owner authorization and device action execution are controlled; full linking installation remains open.',
  };
}
function claim(home, payload) {
  return home.service.claimSessionV1({ payload, owner: home.owner, nowMs: Date.now() });
}
function claimForPayload(payload, home) {
  return claim(home, payload);
}
function applied(result) {
  return result.outcome === 'applied';
}
function homeConflict(result) {
  return result.outcome === 'home_conflict';
}
function isOtherHome(home, other) {
  return home.region !== other.region;
}

async function localCount(home, id) {
  const row = await home.database
    .prepare('SELECT count(*) AS count FROM linked_device_sessions WHERE link_session_id = ?')
    .bind(id)
    .first();
  return row.count;
}

async function newPayload(api, fixture, label) {
  const request = await fixture.createRequest(api, label);
  return (await request.json()).payload;
}
class ImportFaultDatabase {
  failure = null;
  constructor(database) {
    this.database = database;
  }
  prepare(query) {
    return this.database.prepare(query);
  }
  async batch(statements) {
    const failure = this.failure;
    this.failure = null;
    if (failure === 'before') throw new Error('Controlled import failure');
    const result = await this.database.batch(statements);
    if (failure === 'after') throw new Error('Controlled lost import reply');
    return result;
  }
}
