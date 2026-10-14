import assert from 'node:assert/strict';
import { CustodyBinding } from './relocation-directory-runtime.mjs';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadWalletAddressApi(publicRoot) {
  const output = resolve(publicRoot, '.artifacts/stored-relocation-addresses');
  await mkdir(output, { recursive: true });
  const modulePath = resolve(output, 'addresses.mjs');
  await build({
    stdin: {
      resolveDir: publicRoot,
      contents: `
        export { D1WalletObjectAddresses } from './packages/wallet-server/src/router/cloudflare/d1/walletObjectAddresses';
        export { WalletHomeCustodyBinding } from './packages/wallet-server/src/router/cloudflare/runtime/routerAbServiceBindings';
        export { walletObjectIdentity, walletObjectIdentityHeaders, walletObjectIdentityFromWireScope } from './packages/wallet-server/src/router/cloudflare/runtime/walletObjectAddresses';
      `,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: modulePath,
  });
  return import(pathToFileURL(modulePath));
}

export class StoredWalletTopology {
  constructor(topology, api, identity, sourceDatabase, destinationDatabase) {
    Object.assign(this, { topology, api, identity, sourceDatabase, destinationDatabase });
  }

  async getWorker(name) {
    return this.scopedWorker(await this.topology.getWorker(name), name);
  }

  scopedWorker(worker, name) {
    const destination = name.startsWith('destination-');
    const identity = { ...this.identity, ownershipGeneration: destination ? 2 : 1 };
    const binding = new this.api.WalletHomeCustodyBinding(
      new CustodyBinding(worker),
      destination ? 'APAC' : 'WEUR',
      destination ? this.destinationDatabase : this.sourceDatabase,
      'composed-relocation',
      null,
    );
    return new StoredWalletWorker(binding, this.api.walletObjectIdentityHeaders(identity));
  }

  async getDurableObjectNamespace(binding, name) {
    const namespace = await this.topology.getDurableObjectNamespace(binding, name);
    return new StoredWalletNamespace(this, namespace, name);
  }

  async evictWalletObject(name, scope, generation) {
    const identity = this.api.walletObjectIdentityFromWireScope(scope, generation);
    const database = name.startsWith('destination-')
      ? this.destinationDatabase
      : this.sourceDatabase;
    const store = new this.api.D1WalletObjectAddresses(database, {
      namespace: 'composed-relocation',
      orgId: identity.orgId,
      projectId: identity.projectId,
      envId: identity.envId,
    });
    const addresses = await store.read(identity);
    assert.ok(addresses, 'The transferred wallet must have stored object addresses');
    const objectClass = 'RouterAbSigningWorkerWalletDurableObject';
    const ids = await this.topology.listDurableObjectIds(objectClass, name);
    assert.ok(
      ids.includes(addresses.signing_worker),
      'The stored wallet object must exist before eviction',
    );
    await this.topology.unsafeEvictDurableObject(name, objectClass, {
      id: addresses.signing_worker,
    });
    return addresses.signing_worker;
  }

  getD1Database(binding, name) {
    return this.topology.getD1Database(binding, name);
  }

  dispose() {
    return this.topology.dispose();
  }
}

class StoredWalletNamespace {
  constructor(topology, namespace, name) {
    Object.assign(this, { topology, namespace, name });
  }

  idFromName(name) {
    return this.namespace.idFromName(name);
  }

  idFromString(id) {
    return this.namespace.idFromString(id);
  }

  get(id) {
    return this.topology.scopedWorker(this.namespace.get(id), this.name);
  }
}

class StoredWalletWorker {
  constructor(binding, headers) {
    Object.assign(this, { binding, headers });
  }

  fetch(input, init) {
    const request = new Request(input, init);
    for (const [name, value] of Object.entries(this.headers)) request.headers.set(name, value);
    return this.binding.fetch(request);
  }
}
