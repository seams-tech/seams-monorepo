import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Miniflare } from 'miniflare';

// Tenant root authority stays shared. Wallet objects and SigningWorker stores
// have separate source and destination namespaces.
export async function createRelocationCustodyWorkers(publicRoot) {
  const scripts = resolve(publicRoot, 'crates/router-ab-cloudflare/scripts');
  const api = await import(pathToFileURL(resolve(scripts, 'test-private-d1.mjs')));
  const fixture = api.loadFixture();
  const sourceRouter = api.routerWorker(fixture);
  const sourceA = api.deriverAWorker(fixture);
  const sourceB = api.deriverBWorker(fixture);
  const destinationRouter = {
    ...sourceRouter,
    name: 'destination-router',
    durableObjects: {
      ROUTER_TENANT_ROOT_CREATION_DO: {
        ...sourceRouter.durableObjects.ROUTER_TENANT_ROOT_CREATION_DO,
        scriptName: 'router',
      },
      ROUTER_WALLET_DO: sourceRouter.durableObjects.ROUTER_WALLET_DO,
    },
    serviceBindings: {
      DERIVER_A: 'destination-deriver-a',
      DERIVER_B: 'destination-deriver-b',
      SIGNING_WORKER: 'destination-signing-worker',
      TENANT_ROOT_CONTROL_PLANE: 'tenant-root-control-plane',
    },
  };
  const topology = new Miniflare({
    rootPath: publicRoot,
    workers: [
      sourceRouter,
      sourceA,
      sourceB,
      api.tenantRootControlPlaneWorker(fixture),
      api.signingWorker('fixture-signing-worker', 'source-signing-worker', fixture),
      destinationRouter,
      {
        ...sourceA,
        name: 'destination-deriver-a',
        serviceBindings: { DERIVER_B: 'destination-deriver-b' },
      },
      { ...sourceB, name: 'destination-deriver-b' },
      api.signingWorker('destination-signing-worker', 'destination-signing-worker', fixture),
    ],
  });
  try {
    await topology.ready;
    const releaseFaultProbe =
      process.env.ROUTER_AB_WORKER_BUILD_PROFILE === 'release'
        ? await verifyReleaseFaultUnavailable(topology)
        : { kind: 'not_checked', reason: 'development_profile' };
    const migrations = resolve(publicRoot, 'crates/router-ab-cloudflare/migrations');
    const deriverA = await api.applyMigrations(
      topology,
      'DERIVER_ROLE_PRIVATE_DB',
      'deriver-a',
      resolve(migrations, 'deriver-a'),
    );
    const deriverB = await api.applyMigrations(
      topology,
      'DERIVER_ROLE_PRIVATE_DB',
      'deriver-b',
      resolve(migrations, 'deriver-b'),
    );
    await api.applyMigrations(
      topology,
      'SIGNING_WORKER_PRIVATE_DB',
      'fixture-signing-worker',
      resolve(migrations, 'signing-worker'),
    );
    await api.applyMigrations(
      topology,
      'SIGNING_WORKER_PRIVATE_DB',
      'destination-signing-worker',
      resolve(migrations, 'signing-worker'),
    );
    const roots = await api.testTenantRootCreationOperatingPath(topology, fixture, {
      deriverA,
      deriverB,
    });
    const registration = await api.captureValidActivationDelivery(
      topology,
      fixture,
      roots.tenantRoot,
    );
    await acknowledgeRegistration(topology, registration);
    const objects = [];
    for (const [binding, source, destination] of [
      ['ROUTER_WALLET_DO', 'router', 'destination-router'],
      ['DERIVER_A_WALLET_DO', 'deriver-a', 'destination-deriver-a'],
      ['DERIVER_B_WALLET_DO', 'deriver-b', 'destination-deriver-b'],
      ['SIGNING_WORKER_WALLET_DO', 'fixture-signing-worker', 'destination-signing-worker'],
      ['SIGNING_WORKER_PRESIGN_SESSION_DO', 'fixture-signing-worker', 'destination-signing-worker'],
    ]) {
      const from = await topology.getDurableObjectNamespace(binding, source);
      const to = await topology.getDurableObjectNamespace(binding, destination);
      assert.notEqual(
        from.idFromName('same-wallet').toString(),
        to.idFromName('same-wallet').toString(),
      );
      objects.push({ binding, source, destination, independentNamespaces: true });
    }
    return { topology, fixture, roots, registration, objects, releaseFaultProbe };
  } catch (error) {
    await topology.dispose();
    throw error;
  }
}

async function acknowledgeRegistration(topology, registration) {
  const binding = registration.envelope.target.binding;
  const router = await topology.getWorker('router');
  const response = await router.fetch(
    'https://mpc-router.router-ab.internal/router-ab/router/ed25519-yao/registration/consume',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-router-ab-internal-service-auth': 'private-d1-gateway-router-auth',
      },
      body: JSON.stringify({
        ownership_generation: 1,
        tenant_root: registration.envelope.tenant_root,
        wallet_id: binding.lifecycle.account_id,
        lifecycle_id: binding.lifecycle.lifecycle_id,
        session_id: binding.session_id,
        consumer_binding: 'composed-registration-finalization',
      }),
    },
  );
  assert.equal(response.status, 200, await response.text());
}

async function verifyReleaseFaultUnavailable(topology) {
  const statuses = [];
  for (const worker of ['fixture-signing-worker', 'destination-signing-worker']) {
    const namespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_WALLET_DO', worker);
    const object = namespace.get(namespace.idFromName('release-fault-route-probe'));
    const response = await object.fetch(
      'https://router-ab-do.internal/router-ab/internal/signing-worker/wallet/harness-activation-fault',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    assert.equal(
      response.status,
      404,
      'Release custody must not expose the activation-fault handler',
    );
    statuses.push({ worker, status: response.status });
  }
  return { kind: 'verified', statuses };
}
