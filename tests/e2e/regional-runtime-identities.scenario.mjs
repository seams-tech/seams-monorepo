import assert from 'node:assert/strict';

export async function verifyRegionalRuntimeIdentities({
  api,
  runtime,
  bridges,
  directory,
  scope,
  consoleBridge,
}) {
  const bindings = {};
  for (const region of bridges.keys()) {
    const fixture = new RuntimeIdentityFixture(api, region, scope, bridges.get(region));
    bridges.get(region).runtimeIdentities = fixture;
    bindings[region] = new RuntimeBinding(await runtime.getWorker(region));
  }
  const resolver = new api.RegionalWalletIdentities(scope.namespace, directory, bindings);
  const request = {
    orgId: scope.organizationId,
    wallets: ['APAC', 'US', 'OC', 'WEUR', 'APAC'].map(selector.bind(undefined, scope)),
  };
  const result = await resolver.read(request);
  assert.deepEqual(result.identities.map(walletId), request.wallets.map(walletId));
  for (const region of bridges.keys()) {
    assert.deepEqual(bridges.get(region).runtimeIdentities.requests, [
      { orgId: scope.organizationId, wallets: [selector(scope, region)] },
    ]);
  }
  await assert.rejects(
    resolver.read({ orgId: scope.organizationId, wallets: [selector(scope, 'missing')] }),
    /home is unavailable/u,
  );
  const us = bridges.get('US').runtimeIdentities;
  const readsBefore = us.requests.length;
  const cases = [
    { body: request, status: 409 },
    {
      body: {
        orgId: scope.organizationId,
        wallets: [selector(scope, 'US'), selector(scope, 'WEUR')],
      },
      status: 409,
    },
    { body: { orgId: scope.organizationId, wallets: [selector(scope, 'missing')] }, status: 404 },
    { body: { orgId: 'other-org', wallets: [selector(scope, 'US')] }, status: 403 },
    { body: { orgId: scope.organizationId, wallets: [] }, status: 400 },
  ];
  for (const item of cases) {
    const response = await sendIdentity(bindings.US, item.body);
    assert.equal(response.status, item.status, await response.clone().text());
  }
  consoleBridge.available = false;
  try {
    const response = await sendIdentity(bindings.US, {
      orgId: scope.organizationId,
      wallets: [selector(scope, 'US')],
    });
    assert.equal(response.status, 503);
  } finally {
    consoleBridge.available = true;
  }
  assert.equal(
    us.requests.length,
    readsBefore,
    'rejected batches must never reach the local reader',
  );
  bridges.get('WEUR').runtimeIdentities.mode = 'unavailable';
  await assert.rejects(resolver.read(request), /HTTP 500/u);
  bridges.get('WEUR').runtimeIdentities.mode = 'foreign';
  await assert.rejects(resolver.read(request), /unexpected or duplicate/u);
  bridges.get('WEUR').runtimeIdentities.mode = 'duplicate';
  await assert.rejects(resolver.read(request), /unexpected or duplicate/u);
  bridges.get('WEUR').runtimeIdentities.mode = 'incomplete';
  const incomplete = await resolver.read(request);
  assert.deepEqual(incomplete.identities.map(walletId), [
    'wallet:APAC',
    'wallet:US',
    'wallet:OC',
    'wallet:APAC',
  ]);
  for (const bridge of bridges.values()) bridge.runtimeIdentities = null;
  return {
    directRuntimeHomeGuard: true,
    rejectedBatchesNeverReadLocally: true,
    mixedHomeBatch: true,
    duplicateSelectorsDeduplicatedPerHome: true,
    requestOrderPreserved: true,
    missingHomeRejected: true,
    unavailableRegionRejected: true,
    unexpectedAndDuplicateResponsesRejected: true,
    incompleteWalletContractPreserved: true,
    scope:
      'Production Console directory, regional resolver and HTTP client through four Worker transports; regional identity payloads are controlled fixtures. Production Runtime identity home guard rejects wrong-home and cross-tenant batches before reading. Identity payloads remain controlled; relocation fencing and other Runtime operations remain open.',
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
  constructor(api, region, scope, bridge) {
    this.api = api;
    this.bridge = bridge;
    this.region = region;
    this.scope = scope;
  }
  handle(request) {
    return this.api.handleRuntimeIdentityHomeRequest(request, {
      scope: this.scope,
      localResource: this.bridge.localResource,
      directory: this.bridge.runtimeHomeDirectory,
      readIdentities: this.read.bind(this),
    });
  }
  async read(body) {
    this.requests.push(body);
    assert.deepEqual(body, {
      orgId: this.scope.organizationId,
      wallets: [selector(this.scope, this.region)],
    });
    if (this.mode === 'unavailable') throw new Error('Controlled runtime read failure');
    if (this.mode === 'incomplete') return { identities: [] };
    const identity = {
      walletId: this.mode === 'foreign' ? 'wallet:unrequested' : `wallet:${this.region}`,
      projectId: this.scope.projectId,
      envId: this.scope.environmentId,
      nearAccountId: `${this.region.toLowerCase()}.testnet`,
      evmAddress: `0x${'1'.repeat(40)}`,
    };
    return {
      identities: this.mode === 'duplicate' ? [identity, identity] : [identity],
    };
  }
}

async function sendIdentity(binding, body) {
  return binding.fetch(
    'https://wallet-runtime.internal/internal/wallet-runtime/v1/wallet-identities',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
