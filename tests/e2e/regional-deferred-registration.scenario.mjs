import assert from 'node:assert/strict';

export async function verifyRegionalDeferredRegistration({ runtime, bridges, consoleBridge }) {
  const observations = [];
  for (const [home, bridge] of bridges) {
    const other = bridges.get(home === 'US' ? 'WEUR' : 'US');
    for (const ingress of ['US', 'WEUR', 'APAC']) {
      const worker = await runtime.getWorker(ingress);
      for (const operation of ['near-admission', 'near-provisioning']) {
        const url = `https://wallet.test/wallets/register/${operation}`;
        const body = { registrationCeremonyId: bridge.ceremonyId };
        const response = await worker.fetch(url, post(body));
        assert.equal(response.status, 422);
        assert.deepEqual(await response.json(), {
          region: home,
          code: 'fixture_protocol_execution_disabled',
        });
        const replay = await worker.fetch(url, post(body));
        assert.deepEqual(await replay.json(), {
          region: home,
          code: 'fixture_protocol_execution_disabled',
        });
        const conflict = await worker.fetch(
          url,
          post(body, other.issued.operationCredential.token),
        );
        assert.equal(conflict.status, 403);
        observations.push({ home, ingress, operation });
      }
    }
  }
  const worker = await runtime.getWorker('APAC');
  for (const operation of ['near-admission', 'near-provisioning']) {
    const url = `https://wallet.test/wallets/register/${operation}`;
    const missing = await worker.fetch(
      url,
      post({ registrationCeremonyId: `wrc_${'Z'.repeat(43)}` }),
    );
    assert.equal(missing.status, 404);
    const malformed = await worker.fetch(url, post({ registrationCeremonyId: 'malformed' }));
    assert.equal(malformed.status, 400);
    consoleBridge.available = false;
    try {
      const unavailable = await worker.fetch(
        url,
        post({ registrationCeremonyId: bridges.get('WEUR').ceremonyId }),
      );
      assert.equal(unavailable.status, 503);
    } finally {
      consoleBridge.available = true;
    }
  }
  return {
    observations,
    stableRetryHome: true,
    conflictingWalletSessionRejected: true,
    missingMalformedAndUnavailableHomesRejected: true,
    scope:
      'Production regional dispatch and Console ceremony directory over three Workers; deferred protocol execution is disabled. This verifies continuation home selection, not provisioning effects or relocation write fencing.',
  };
}

function post(body, token = null) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}
