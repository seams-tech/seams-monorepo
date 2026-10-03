import assert from 'node:assert/strict';

export async function verifyRegionalRuntimeIdentities({ api, runtime, bridges, directory, scope }) {
  const bindings = {};
  for (const region of ['US', 'WEUR', 'APAC']) {
    const fixture = new RuntimeIdentityFixture(region, scope);
    bridges.get(region).runtimeIdentities = fixture;
    bindings[region] = new RuntimeBinding(await runtime.getWorker(region));
  }
  const resolver = new api.RegionalWalletIdentities(scope.namespace, directory, bindings);
  const request = {
    orgId: scope.organizationId,
    wallets: ['APAC', 'US', 'WEUR', 'APAC'].map(selector.bind(undefined, scope)),
  };
  const result = await resolver.read(request);
  assert.deepEqual(result.identities.map(walletId), request.wallets.map(walletId));
  for (const region of ['US', 'WEUR', 'APAC']) {
    assert.deepEqual(bridges.get(region).runtimeIdentities.requests, [
      { orgId: scope.organizationId, wallets: [selector(scope, region)] },
    ]);
  }
  await assert.rejects(
    resolver.read({ orgId: scope.organizationId, wallets: [selector(scope, 'missing')] }),
    /home is unavailable/u,
  );
  bridges.get('WEUR').runtimeIdentities.mode = 'unavailable';
  await assert.rejects(resolver.read(request), /HTTP 503/u);
  bridges.get('WEUR').runtimeIdentities.mode = 'foreign';
  await assert.rejects(resolver.read(request), /unexpected or duplicate/u);
  bridges.get('WEUR').runtimeIdentities.mode = 'duplicate';
  await assert.rejects(resolver.read(request), /unexpected or duplicate/u);
  bridges.get('WEUR').runtimeIdentities.mode = 'incomplete';
  const incomplete = await resolver.read(request);
  assert.deepEqual(incomplete.identities.map(walletId), [
    'wallet:APAC',
    'wallet:US',
    'wallet:APAC',
  ]);
  for (const bridge of bridges.values()) bridge.runtimeIdentities = null;
  return {
    mixedHomeBatch: true,
    duplicateSelectorsDeduplicatedPerHome: true,
    requestOrderPreserved: true,
    missingHomeRejected: true,
    unavailableRegionRejected: true,
    unexpectedAndDuplicateResponsesRejected: true,
    incompleteWalletContractPreserved: true,
    scope:
      'Production Console directory, regional resolver and HTTP client through three Worker transports; regional identity payloads are controlled fixtures. Runtime entry enforcement and relocation write fencing remain separate gates.',
  };
}

function walletId(wallet) {
  return wallet.walletId;
}

function selector(scope, region) {
  return { walletId: `wallet:${region}`, projectId: scope.projectId, envId: scope.environmentId };
}

class RuntimeBinding {
  constructor(worker) {
    this.worker = worker;
  }
  fetch(url, init) {
    return this.worker.fetch(url, init);
  }
}

class RuntimeIdentityFixture {
  mode = 'valid';
  requests = [];
  constructor(region, scope) {
    this.region = region;
    this.scope = scope;
  }
  async handle(request) {
    const body = await request.json();
    this.requests.push(body);
    assert.deepEqual(body, {
      orgId: this.scope.organizationId,
      wallets: [selector(this.scope, this.region)],
    });
    if (this.mode === 'unavailable') return new Response(null, { status: 503 });
    if (this.mode === 'incomplete') return Response.json({ identities: [] });
    const identity = {
      walletId: this.mode === 'foreign' ? 'wallet:unrequested' : `wallet:${this.region}`,
      projectId: this.scope.projectId,
      envId: this.scope.environmentId,
      nearAccountId: `${this.region.toLowerCase()}.testnet`,
      evmAddress: `0x${'1'.repeat(40)}`,
    };
    return Response.json({
      identities: this.mode === 'duplicate' ? [identity, identity] : [identity],
    });
  }
}
