import assert from 'node:assert/strict';

export async function verifyRegionalSourceOwner({ api, runtime, bridges, linkSessionId }) {
  const home = bridges.get('WEUR');
  const foreign = bridges.get('US');
  const service = home.linkRoutes;
  const authenticate = service.authenticateOwnerRequestV1;
  const path = `/wallet/device-linking/v1/sessions/${encodeURIComponent(linkSessionId)}`;
  const session = await service.sessionService.getSessionV1({ linkSessionId, nowMs: Date.now() });
  try {
    for (const region of bridges.keys()) {
      const ingress = await runtime.getWorker(region);
      const response = await ownerRequest(
        ingress,
        home,
        `${path}/source-contribution-preparation`,
        'GET',
      );
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('x-test-region'), 'WEUR');
      assert.deepEqual(
        await response.json(),
        JSON.parse(JSON.stringify(session.sourceContributionPreparation)),
      );
    }
    // Exercise route ownership after authentication has accepted a different wallet.
    service.authenticateOwnerRequestV1 = foreign.linkApproval.authenticateOwner.bind(
      foreign.linkApproval,
    );
    for (const region of bridges.keys()) {
      const ingress = await runtime.getWorker(region);
      for (const [suffix, method] of [
        ['source-contribution-preparation', 'GET'],
        ['source-contribution/execute', 'POST'],
      ]) {
        const response = await ownerRequest(ingress, foreign, `${path}/${suffix}`, method);
        assert.equal(response.status, 403, await response.clone().text());
        assert.equal((await response.json()).code, 'wallet_session_scope_mismatch');
        const request = new Request(`https://wallet.test${path}/${suffix}`, {
          method,
          headers: { authorization: `Bearer ${foreign.issued.operationCredential.token}` },
          ...(method === 'GET' ? {} : { body: '{}' }),
        });
        const direct = await api.handleDeviceLinking({
          method,
          pathname: new URL(request.url).pathname,
          request,
          service: { deviceLinking: service },
          routeDefinitions: api.createRouterApiRouteDefinitions(),
          opts: {},
        });
        assert.equal(direct.status, 401, await direct.clone().text());
        assert.equal((await direct.json()).code, 'unauthorized');
      }
    }
    assert.deepEqual(
      await service.sessionService.getSessionV1({ linkSessionId, nowMs: Date.now() }),
      session,
    );
  } finally {
    service.authenticateOwnerRequestV1 = authenticate;
  }
  return {
    home: 'WEUR',
    ingressRegions: [...bridges.keys()],
    preparationMatchesPersistedValue: true,
    foreignAuthenticatedWalletRejectedBeforeProtocol: true,
    sessionUnchanged: true,
    scope:
      'Production home dispatch and owner-session route authorization; owner authentication is controlled. Contribution execution and installation remain open.',
  };
}

function ownerRequest(ingress, owner, path, method) {
  return ingress.fetch(`https://wallet.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${owner.issued.operationCredential.token}`,
      'content-type': 'application/json',
    },
    ...(method === 'GET' ? {} : { body: '{}' }),
  });
}
