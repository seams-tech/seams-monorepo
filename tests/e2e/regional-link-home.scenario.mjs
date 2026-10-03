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
    const store = new api.D1LinkedDeviceSessionStoreV1({
      database: await runtime.getD1Database('SIGNER_DB', region),
      scope: signerScope,
    });
    const authorization = new RegionalLinkOwnerAuthorizationFixture();
    const service = new api.LinkedDeviceSessionServiceV1({
      store,
      authorization,
      lifecycleRouting: bridge.publisher,
    });
    homes.push({
      region,
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
    consoleBridge.dropNextLifecycleReply = true;
    assert.equal((await claim(home, payload)).outcome, 'home_unavailable');
    assert.equal(
      (await home.store.getSessionV1(payload.linkSessionId)).state.state,
      'displaying_qr',
    );
    assert.equal((await claim(home, payload)).outcome, 'applied');
    assert.equal((await claim(home, payload)).outcome, 'replayed');
    assert.equal(await isolatedIdentity.findRoute(locator), null);
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
    if ((await home.store.getSessionV1(payload.linkSessionId)).state.state === 'claimed')
      persistedClaims++;
  }
  assert.equal(persistedClaims, 1);
  return {
    observations,
    competingOwners: 3,
    committedClaims: persistedClaims,
    scope:
      'Production claim service, local D1 session/transcript CAS and shared immutable home directory. Owner authorization is controlled and QR records are seeded locally. Device action execution is controlled; shared unclaimed QR creation/polling and full linking installation remain open.',
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
