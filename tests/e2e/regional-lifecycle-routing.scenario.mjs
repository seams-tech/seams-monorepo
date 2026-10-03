import assert from 'node:assert/strict';

export async function verifyRegionalLifecycleRouting({
  api,
  runtime,
  bridges,
  consoleBridge,
  authorityDatabase,
}) {
  const observations = [];
  for (const [region, bridge] of bridges) {
    const ingress = await runtime.getWorker(region === 'US' ? 'APAC' : 'US');
    const other = bridges.get(region === 'US' ? 'WEUR' : 'US');
    for (const kind of ['yao_recovery', 'yao_export']) {
      const lifecycleId = `lifecycle-${region}-${kind}`;
      const admission = admissionIdentity(bridge, lifecycleId);
      assert.deepEqual(await api.publishWalletLifecycleHome(bridge.publisher, kind, admission), {
        ok: true,
      });
      assert.deepEqual(await api.publishWalletLifecycleHome(bridge.publisher, kind, admission), {
        ok: true,
      });
      const wrongWriter = await api.publishWalletLifecycleHome(other.publisher, kind, admission);
      assert.equal(wrongWriter.status, 409);
      for (const operation of kind === 'yao_recovery'
        ? ['recovery/execute', 'recovery/activate']
        : ['export/execute']) {
        const url = `https://wallet.test/router-ab/ed25519/yao/${operation}`;
        const body = continuationBody(kind, lifecycleId);
        const response = await ingress.fetch(url, post(body));
        assert.equal(response.status, 422);
        assert.deepEqual(await response.json(), {
          region,
          code: 'fixture_protocol_execution_disabled',
        });
        const conflict = await ingress.fetch(
          url,
          post(body, other.issued.operationCredential.token),
        );
        assert.equal(conflict.status, 403);
        const unknown = await ingress.fetch(
          url,
          post(continuationBody(kind, `${lifecycleId}-unknown`)),
        );
        assert.equal(unknown.status, 404);
        const malformed = await ingress.fetch(
          url,
          post(continuationBody(kind, 'invalid lifecycle')),
        );
        assert.equal(malformed.status, 400);
        consoleBridge.available = false;
        try {
          const unavailable = await ingress.fetch(url, post(body));
          assert.equal(unavailable.status, 503);
          const unpublished = await api.publishWalletLifecycleHome(
            bridge.publisher,
            kind,
            admissionIdentity(bridge, `${lifecycleId}-outage`),
          );
          assert.equal(unpublished.status, 503);
        } finally {
          consoleBridge.available = true;
        }
        const absent = await ingress.fetch(
          url,
          post(continuationBody(kind, `${lifecycleId}-outage`)),
        );
        assert.equal(absent.status, 404);
        observations.push({ region, operation });
      }
    }
  }
  const us = bridges.get('US');
  const weur = bridges.get('WEUR');
  const lifecycleId = 'concurrent-lifecycle';
  const claims = await Promise.all([
    api.publishWalletLifecycleHome(
      us.publisher,
      'yao_recovery',
      admissionIdentity(us, lifecycleId),
    ),
    api.publishWalletLifecycleHome(
      weur.publisher,
      'yao_recovery',
      admissionIdentity(weur, lifecycleId),
    ),
  ]);
  assert.equal(claims.filter(successful).length, 1);
  const winner = claims[0].ok ? us : weur;
  const loser = claims[0].ok ? weur : us;
  assert.equal(
    (
      await api.publishWalletLifecycleHome(
        loser.publisher,
        'yao_recovery',
        admissionIdentity(loser, lifecycleId),
      )
    ).status,
    409,
  );
  assert.deepEqual(
    await api.publishWalletLifecycleHome(
      winner.publisher,
      'yao_recovery',
      admissionIdentity(winner, lifecycleId),
    ),
    { ok: true },
  );
  // Operation kinds have independent ID spaces.
  assert.deepEqual(
    await api.publishWalletLifecycleHome(
      loser.publisher,
      'yao_export',
      admissionIdentity(loser, lifecycleId),
    ),
    { ok: true },
  );
  const ingress = await runtime.getWorker('APAC');
  for (const [kind, home] of [
    ['yao_recovery', winner],
    ['yao_export', loser],
  ]) {
    const path = kind === 'yao_recovery' ? 'recovery/execute' : 'export/execute';
    const result = await ingress.fetch(
      `https://wallet.test/router-ab/ed25519/yao/${path}`,
      post(continuationBody(kind, lifecycleId)),
    );
    assert.equal((await result.json()).region, home.region);
  }
  assert.equal(
    await authorityDatabase
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'wallet_recovery_routes'")
      .first('count'),
    0,
  );
  const rows = await authorityDatabase
    .prepare(
      "SELECT kind, value, wallet_id FROM wallet_routes WHERE kind IN ('yao_recovery', 'yao_export')",
    )
    .all();
  assert.equal(rows.results.length, 8);
  await assert.rejects(
    authorityDatabase
      .prepare("UPDATE wallet_routes SET wallet_id = ? WHERE kind = 'yao_recovery' AND value = ?")
      .bind(loser.issued.session.walletId, lifecycleId)
      .run(),
  );
  return {
    observations,
    lifecycleClaims: rows.results,
    concurrentClaimHasOneWinner: true,
    publicationRetriesPreserveHome: true,
    wrongWriterAndConflictingSessionRejected: true,
    outagePublicationAndLookupFailClosed: true,
    kindsHaveIndependentIdentity: true,
    oldTableRemoved: true,
    scope:
      'Production publication helper, Console service/index and Gateway dispatch across three regional Worker transports. Admission authorization and terminal Yao execution are controlled; no cryptographic execution or hosted latency claim.',
  };
}

function successful(result) {
  return result.ok;
}
function admissionIdentity(bridge, lifecycleId) {
  return {
    scope: { lifecycle_id: lifecycleId },
    application_binding: { wallet_id: bridge.issued.session.walletId },
  };
}
function continuationBody(kind, lifecycleId) {
  if (kind === 'yao_export')
    return { protocol: { binding: { ceremony: { lifecycle: { lifecycle_id: lifecycleId } } } } };
  return { binding: { lifecycle: { lifecycle_id: lifecycleId } } };
}
function post(body, token = null) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}
