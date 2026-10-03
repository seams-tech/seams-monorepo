import assert from 'node:assert/strict';
import { buildPasskeyCredentialBindingFixture } from '../helpers/regional-authentication.fixtures.mjs';

class UnusedManifestSource {
  getEd25519KeyManifestBySlot() {
    throw new Error('Challenge creation must not read the signer manifest');
  }
}
class PasskeyHome {
  constructor(api, region, store, service) {
    this.api = api;
    this.region = region;
    this.store = store;
    this.service = service;
  }
  async handle(request) {
    const path = new URL(request.url).pathname;
    if (path === '/sync-account/options') {
      return this.api.handleSyncAccount({
        method: 'POST',
        pathname: path,
        request,
        service: { webAuthn: this.service },
      });
    }
    if (path === '/sync-account/verify') {
      const body = await request.json();
      const challenge = await this.store.consumeSyncChallenge(body.challengeId);
      return Response.json(
        { region: this.region, consumed: Boolean(challenge) },
        { status: challenge ? 200 : 401 },
      );
    }
    if (path.startsWith('/auth/') && path !== '/auth/passkey/verify') {
      const response = await this.api.handleAuth({
        method: 'POST',
        pathname: path,
        request,
        service: { webAuthn: this.service },
      });
      return response ?? new Response(null, { status: 404 });
    }
    const body = await request.json();
    if (path === '/wallet/unlock/challenge' && body.unlockBackend === 'passkey') {
      const response = await this.api.handleWalletUnlockChallengeRoute({
        body,
        service: this.service,
      });
      return Response.json(response.body, { status: response.status });
    }
    if (
      path === '/auth/passkey/verify' ||
      (path === '/wallet/unlock/verify' && body.unlockBackend === 'passkey')
    ) {
      const challenge = await this.store.consumeLoginChallenge(body.challengeId);
      return Response.json(
        { region: this.region, consumed: Boolean(challenge) },
        { status: challenge ? 200 : 401 },
      );
    }
    return Response.json(
      { region: this.region, code: 'fixture_email_otp_execution_disabled' },
      { status: 422 },
    );
  }
}

export async function verifyRegionalAuthenticationRouting({
  api,
  runtime,
  bridges,
  consoleBridge,
  signerScope,
  authorityDatabase,
}) {
  const observations = [];
  for (const [region, bridge] of bridges) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    await database.batch([
      api.prepareD1WebAuthnCredentialBindingPutStatement({
        database,
        scope: signerScope,
        record: buildPasskeyCredentialBindingFixture(bridge.authMethod, Date.now()),
      }),
    ]);
    const store = new api.CloudflareD1WebAuthnStore({ database, ...signerScope });
    const service = new api.CloudflareD1WebAuthnAuthService({
      webAuthnStore: store,
      walletAuthMethodStore: new api.D1WalletAuthMethodStore({
        database,
        ...signerScope,
        ensureSchema: false,
      }),
      walletManifestSource: new UnusedManifestSource(),
      lifecycleRouting: bridge.publisher,
    });
    bridge.passkey = new PasskeyHome(api, region, store, service);
  }
  for (const [region, bridge] of bridges) {
    const ingress = await runtime.getWorker(region === 'US' ? 'APAC' : 'US');
    const traveler = await runtime.getWorker(region === 'WEUR' ? 'APAC' : 'WEUR');
    const foreign = bridges.get(region === 'US' ? 'WEUR' : 'US');
    for (const family of ['auth', 'unlock', 'sync']) {
      const optionsPath = {
        auth: '/auth/passkey/options',
        unlock: '/wallet/unlock/challenge',
        sync: '/sync-account/options',
      }[family];
      const verifyPath = {
        auth: '/auth/passkey/verify',
        unlock: '/wallet/unlock/verify',
        sync: '/sync-account/verify',
      }[family];
      const options = challengeOptions(family, bridge);
      const response = await ingress.fetch(`https://wallet.test${optionsPath}`, post(options));
      assert.equal(response.status, 200);
      const challenge = await response.json();
      assert.deepEqual(challenge.credentialIds, [bridge.authMethod.credentialIdB64u]);
      const routes = await authorityDatabase
        .prepare("SELECT value FROM wallet_routes WHERE kind = 'passkey_challenge'")
        .all();
      assert.ok(!JSON.stringify(routes.results).includes(challenge.challengeB64u));
      const verify =
        family !== 'unlock'
          ? { challengeId: challenge.challengeId }
          : { unlockBackend: 'passkey', challengeId: challenge.challengeId };
      const conflict = await traveler.fetch(
        `https://wallet.test${verifyPath}`,
        post(verify, foreign.issued.operationCredential.token),
      );
      assert.equal(conflict.status, 403);
      const wrongBody = await traveler.fetch(
        `https://wallet.test${verifyPath}`,
        post({ ...verify, walletId: foreign.issued.session.walletId }),
      );
      assert.equal(wrongBody.status, 403);
      consoleBridge.available = false;
      try {
        const unavailable = await traveler.fetch(`https://wallet.test${verifyPath}`, post(verify));
        assert.equal(unavailable.status, 503);
        // Exercise the actual home handler's publication failure after ingress resolution.
        const localFailure = await bridge.passkey.handle(
          new Request(`https://wallet.test${optionsPath}`, post(options)),
        );
        assert.equal(localFailure.status, 503);
      } finally {
        consoleBridge.available = true;
      }
      const attempts = await Promise.all([
        traveler.fetch(`https://wallet.test${verifyPath}`, post(verify)),
        ingress.fetch(`https://wallet.test${verifyPath}`, post(verify)),
      ]);
      assert.deepEqual(attempts.map(responseStatus).sort(), [200, 401]);
      for (const attempt of attempts) assert.equal((await attempt.json()).region, region);
      observations.push({ region, family, challengeId: challenge.challengeId });
    }
    const discovery = await ingress.fetch(
      'https://wallet.test/sync-account/options',
      post({ rp_id: bridge.authMethod.rpId }),
    );
    assert.equal(discovery.status, 503);
    assert.equal((await discovery.json()).code, 'wallet_discovery_unavailable');
    for (const path of ['/auth/passkey/options/', '/auth//passkey/options']) {
      const alias = await ingress.fetch(
        `https://wallet.test${path}`,
        post({ user_id: bridge.issued.session.walletId, rp_id: bridge.authMethod.rpId }),
      );
      assert.equal(alias.status, 404);
    }
    for (const path of [
      '/wallet/unlock/challenge',
      '/wallet/unlock/verify',
      '/wallet/email-otp/challenge',
      '/wallet/email-otp/factor-release',
    ]) {
      const response = await ingress.fetch(
        `https://wallet.test${path}`,
        post({ unlockBackend: 'email_otp', walletId: bridge.issued.session.walletId }),
      );
      assert.equal(response.status, 422);
      assert.equal((await response.json()).region, region);
    }
    const database = await runtime.getD1Database('SIGNER_DB', region);
    assert.equal(
      await database
        .prepare(
          "SELECT COUNT(*) AS count FROM webauthn_challenges WHERE challenge_kind IN ('login', 'sync')",
        )
        .first('count'),
      0,
    );
  }
  return {
    observations,
    challengeCreationUsesHomeBindings: true,
    travelingVerificationConsumesAtHomeOnce: true,
    failedPublicationLeavesNoLocalChallenge: true,
    conflictsAndOutagesDoNotConsumeChallenge: true,
    emailOtpWalletIdentityRoutesToHome: true,
    noncanonicalAuthPathsRejected: true,
    challengeBytesAbsentFromDirectory: true,
    scope:
      'Production passkey challenge creation handlers/service, publication/index and D1 single-use consumption through regional Worker transports. WebAuthn signature verification and Email OTP execution are controlled; no full unlock ceremony or hosted latency claim.',
  };
}
function responseStatus(response) {
  return response.status;
}
function post(body, token = null) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}

function challengeOptions(family, bridge) {
  switch (family) {
    case 'auth':
      return { user_id: bridge.issued.session.walletId, rp_id: bridge.authMethod.rpId };
    case 'sync':
      return { account_id: bridge.issued.session.walletId, rp_id: bridge.authMethod.rpId };
    case 'unlock':
      return {
        unlockBackend: 'passkey',
        userId: bridge.issued.session.walletId,
        rpId: bridge.authMethod.rpId,
      };
    default:
      throw new Error('Unexpected authentication family');
  }
}
