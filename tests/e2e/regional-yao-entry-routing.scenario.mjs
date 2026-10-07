import assert from 'node:assert/strict';

const operations = ['recovery/bootstrap', 'recovery/admit', 'recovery/status', 'export/admit'];

export async function verifyRegionalYaoEntryRouting({ runtime, bridges, consoleBridge }) {
  const observations = [];
  for (const [region, bridge] of bridges) {
    const ingressRegion = region === 'US' ? 'APAC' : 'US';
    const ingress = await runtime.getWorker(ingressRegion);
    const walletId = bridge.issued.session.walletId;
    const foreign = bridges.get(region === 'US' ? 'WEUR' : 'US');
    for (const operation of operations) {
      const url = `https://wallet.test/router-ab/ed25519/yao/${operation}`;
      const body = entryBody(operation, walletId);
      const response = await ingress.fetch(url, request(body));
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), {
        region,
        code: 'fixture_protocol_execution_disabled',
      });
      const authorized = await ingress.fetch(
        url,
        request(body, bridge.issued.operationCredential.token),
      );
      assert.equal((await authorized.json()).region, region);
      const conflict = await ingress.fetch(
        url,
        request(body, foreign.issued.operationCredential.token),
      );
      assert.equal(conflict.status, 403);
      assert.equal((await conflict.json()).code, 'wallet_session_scope_mismatch');
      const invalid = await ingress.fetch(url, request(entryBody(operation, null)));
      assert.equal(invalid.status, 400);
      const unknown = await ingress.fetch(url, request(entryBody(operation, 'wallet:unknown')));
      assert.equal(unknown.status, 404);
      consoleBridge.available = false;
      try {
        const unavailable = await ingress.fetch(url, request(body));
        assert.equal(unavailable.status, 503);
        assert.equal((await unavailable.json()).code, 'wallet_home_unavailable');
      } finally {
        consoleBridge.available = true;
      }
      observations.push({ operation, ingressRegion, homeRegion: region });
    }
  }
  return {
    observations,
    walletIdentityOverridesIngress: true,
    sessionWalletConflictsRejected: true,
    malformedAndUnknownWalletsRejected: true,
    directoryOutageFailsClosed: true,
    scope:
      'Production dispatch and Console directory through regional Worker transports. Terminal protocol handler is controlled; no Yao proof validation or execution. Execute/activate continuations remain outside this scenario.',
  };
}

function entryBody(operation, walletId) {
  switch (operation) {
    case 'recovery/bootstrap':
      return { walletId };
    case 'recovery/admit':
      return { application_binding: { wallet_id: walletId } };
    case 'recovery/status':
      return { admission: { application_binding: { wallet_id: walletId } } };
    case 'export/admit':
      return { protocol: { application_binding: { wallet_id: walletId } } };
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

function request(body, token = null) {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}
