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
        export { walletObjectIdentity, walletObjectIdentityHeaders } from './packages/wallet-server/src/router/cloudflare/runtime/walletObjectAddresses';
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
    const destination = name.startsWith('destination-');
    const identity = { ...this.identity, ownershipGeneration: destination ? 2 : 1 };
    const binding = new this.api.WalletHomeCustodyBinding(
      new CustodyBinding(await this.topology.getWorker(name)),
      destination ? 'APAC' : 'WEUR',
      destination ? this.destinationDatabase : this.sourceDatabase,
      'composed-relocation',
      null,
    );
    return new StoredWalletWorker(binding, this.api.walletObjectIdentityHeaders(identity));
  }

  getDurableObjectNamespace(binding, name) {
    return this.topology.getDurableObjectNamespace(binding, name);
  }

  getD1Database(binding, name) {
    return this.topology.getD1Database(binding, name);
  }

  dispose() {
    return this.topology.dispose();
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
