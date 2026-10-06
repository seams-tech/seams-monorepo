import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

class CustodyBinding {
  calls = 0;
  constructor(worker) {
    this.worker = worker;
  }
  async fetch(request) {
    this.calls += 1;
    return this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    });
  }
}

class DirectoryBinding {
  requests = [];
  constructor(api, database, catalog, scope) {
    Object.assign(this, { api, database, catalog, scope });
  }
  async fetch(request) {
    this.requests.push(new URL(request.url).pathname);
    const writer = this.api.parseTenantRuntimeWriterV1(
      request.headers.get('x-seams-writer-role'),
      request.headers.get('x-seams-writer-version'),
      {
        accountId: request.headers.get('x-seams-writer-account'),
        databaseId: request.headers.get('x-seams-writer-database'),
      },
    );
    const response = await this.api.handleWalletHomeServiceRequest(request, {
      database: this.database,
      scope: this.scope,
      catalogJson: JSON.stringify([
        this.catalog.select('US'),
        this.catalog.select('WEUR'),
        this.catalog.select('APAC'),
        this.catalog.select('OC'),
      ]),
      admittedResources: this.catalog.deploymentResources(),
      environmentKey: 'test',
      deploymentLane: 'test',
      writer,
    });
    assert.ok(response, 'Every directory request must reach its production handler');
    return response;
  }
}

class RuntimeBinding {
  requests = [];
  constructor(api, database, namespace, writer, env) {
    Object.assign(this, { api, database, namespace, writer, env });
  }
  async fetch(request) {
    this.requests.push(new URL(request.url).pathname);
    const prepared = await this.api.handleRuntimeRelocationPreparation(
      request.clone(),
      this.database,
      this.namespace,
      this.writer,
    );
    if (prepared) {
      console.log('Relocation Runtime', new URL(request.url).pathname, prepared.status);
      return prepared;
    }
    const response = await this.api.handleWalletControlRequest(request, this.env);
    assert.ok(response, 'Every custody request must reach its production Runtime handler');
    await logRelocationState('Runtime', request, response);
    return response;
  }
}

class GatewayBinding {
  constructor(routes) {
    this.routes = routes;
  }
  async fetch(request) {
    const response = await this.routes.handle(request);
    assert.ok(response);
    await logRelocationState('Gateway', request, response);
    return response;
  }
}

class UnavailableRegion {
  async fetch() {
    throw new Error('This composed scenario provisions WEUR and APAC only');
  }
}

async function migrate(database, directory) {
  for (const name of (await readdir(directory)).filter(isMigration).sort()) {
    const statements = unstable_splitSqlQuery(await readFile(resolve(directory, name), 'utf8'));
    for (const statement of statements) await database.prepare(statement).run();
  }
}
function isMigration(name) {
  return name.endsWith('.sql');
}

export async function createRelocationDirectoryRuntime({ root, candidate, custody, output }) {
  await mkdir(output, { recursive: true });
  const bundlePath = resolve(output, 'directory-runtime.mjs');
  await build({
    absWorkingDir: root,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
    tsconfig: resolve(candidate, 'tsconfig.json'),
    loader: { '.wasm': 'binary' },
    alias: { '@seams/wallet-server/cloud-host': resolve(candidate, 'src/cloud-host.ts') },
    stdin: {
      resolveDir: root,
      contents: `
      export { WalletRelocationOwnerRequest } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/wallet/d1WalletRelocationOwnerRequest.ts'))};
      export { D1WalletRelocationApprovals } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/wallet/d1WalletRelocationApprovals.ts'))};
      export { D1WalletRelocationChallenges, WalletRelocationChallengeBinding } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/wallet/d1WalletRelocationChallenges.ts'))};
      export { D1WalletExecutionAuthority } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/registration/d1WalletExecutionAuthority.ts'))};
      export { AuthorizationService } from ${JSON.stringify(resolve(candidate, 'src/authorization/service.ts'))};
      export { capabilityPolicyPort } from ${JSON.stringify(resolve(candidate, 'src/authorization/capabilityPolicy.ts'))};
      export { parseSessionOrigin } from ${JSON.stringify(resolve(candidate, 'src/authorization/domain.ts'))};
      export { CloudflareD1AuthorizationStore } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts'))};
      export { prepareD1WalletAuthorityPutStatement } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/wallet/d1WalletAuthorityStore.ts'))};
      export { prepareD1WalletAuthMethodV2PutStatement } from ${JSON.stringify(resolve(candidate, 'src/core/d1WalletAuthMethodStore.ts'))};
      export { CloudflareD1WebAuthnStore } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/webauthn/d1WebAuthnStore.ts'))};
      export { buildLinkedDeviceManagementAuthorityFixture } from ${JSON.stringify(resolve(candidate, '../../tests/unit/helpers/linkedDeviceManagement.fixtures.ts'))};
      export { routerAbMpcMaterialActivationRefFromWire } from ${JSON.stringify(resolve(candidate, '../shared-ts/src/utils/routerAbNormalSigningIdentity.ts'))};
      export { buildFullOwnerPermissionsV1 } from ${JSON.stringify(resolve(candidate, '../shared-ts/src/authorization/delegatedAuthority.ts'))};
      export { handleWalletRelocationAdvance, WALLET_RELOCATION_ADVANCE_URL } from './packages/wallet-console-server-ts/src/walletPlacement/relocationService';
      export { handleWalletHomeServiceRequest } from './packages/wallet-console-server-ts/src/walletPlacement/service';
      export { WalletPlacementConsoleBinding } from './packages/wallet-console-server-ts/src/walletPlacement/consoleBinding';
      export { WalletHomeCatalog, WalletOwnershipKey, RegistrationSetupAllocation } from './packages/wallet-console-server-ts/src/walletPlacement/home';
      export { D1WalletHomeDirectory } from './packages/wallet-console-server-ts/src/walletPlacement/d1';
      export { D1WalletRelocations } from './packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
      export { WalletRelocationRequest } from './packages/wallet-console-server-ts/src/walletPlacement/relocation';
      export { WalletRegionalDispatch } from './packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
      export { parseTenantRuntimeWriterV1 } from './packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
      export { relocationWriterVersion, relocationResourceVerification } from './tests/fixtures/tenant-deployment/walletRelocationResources';
      export { handleRuntimeRelocationPreparation } from './packages/wallet-console-server-ts/src/walletPlacement/runtimePreparation';
      export { handleWalletControlRequest } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/runtime/walletControlOps.ts'))};
      export { WalletAuthorizationRelocationRoutes } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/runtime/walletAuthorizationRelocationRoutes.ts'))};
    `,
    },
  });
  const api = await import(pathToFileURL(bundlePath));
  const storage = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null, { status: 404 }); } };',
    compatibilityDate: '2026-06-12',
    d1Databases: { DIRECTORY: 'directory', WEUR: 'weur', APAC: 'apac' },
  });
  try {
    const database = await storage.getD1Database('DIRECTORY');
    await migrate(
      database,
      resolve(root, 'packages/wallet-console-server-ts/migrations/d1-console'),
    );
    const delivery = JSON.parse(custody.registration.delivery);
    const scope = {
      namespace: 'composed-relocation',
      organizationId: delivery.scope.org_id,
      projectId: delivery.scope.project_id,
      environmentId: delivery.scope.project_environment_id,
    };
    const signerScope = {
      namespace: scope.namespace,
      orgId: scope.organizationId,
      projectId: scope.projectId,
      envId: scope.environmentId,
    };
    const accountId = '0123456789abcdef0123456789abcdef';
    const catalog = api.WalletHomeCatalog.parse([
      { region: 'US', accountId, databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { region: 'OC', accountId, databaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      { region: 'WEUR', accountId, databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { region: 'APAC', accountId, databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    ]);
    const wallet = api.WalletOwnershipKey.parse({ ...scope, walletId: delivery.scope.wallet_id });
    const directory = new DirectoryBinding(api, database, catalog, scope);
    const runtimes = {};
    const gateways = {};
    const regions = new Map();
    for (const [region, router, deriverA, deriverB] of [
      ['WEUR', 'router', 'deriver-a', 'deriver-b'],
      ['APAC', 'destination-router', 'destination-deriver-a', 'destination-deriver-b'],
    ]) {
      const regionalDatabase = await storage.getD1Database(region);
      await migrate(regionalDatabase, resolve(candidate, 'migrations/d1-signer'));
      const home = catalog.select(region);
      const writer = api.parseTenantRuntimeWriterV1(
        'walletRuntime',
        api.relocationWriterVersion(home.databaseId, 'walletRuntime'),
        { accountId: home.accountId, databaseId: home.databaseId },
      );
      const gatewayWriter = api.parseTenantRuntimeWriterV1(
        'gateway',
        api.relocationWriterVersion(home.databaseId, 'gateway'),
        { accountId: home.accountId, databaseId: home.databaseId },
      );
      const runtimeDirectory = new api.WalletPlacementConsoleBinding(directory, writer);
      const gatewayDirectory = new api.WalletPlacementConsoleBinding(directory, gatewayWriter);
      const routes = new api.WalletAuthorizationRelocationRoutes({
        database: regionalDatabase,
        scope: signerScope,
        directory: gatewayDirectory,
      });
      gateways[`WALLET_GATEWAY_${region}`] = new GatewayBinding(routes);
      const env = {
        WALLET_CONSOLE: runtimeDirectory,
        CF_VERSION_METADATA: { id: writer.versionId },
        SEAMS_D1_HOME_ACCOUNT_ID: home.accountId,
        SEAMS_D1_HOME_DATABASE_ID: home.databaseId,
        MPC_ROUTER: new CustodyBinding(await custody.topology.getWorker(router)),
        DERIVER_A: new CustodyBinding(await custody.topology.getWorker(deriverA)),
        DERIVER_B: new CustodyBinding(await custody.topology.getWorker(deriverB)),
        ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: 'private-d1-integration-auth',
        ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: 'private-d1-gateway-router-auth',
      };
      runtimes[region] = new RuntimeBinding(api, regionalDatabase, scope.namespace, writer, env);
      regions.set(region, { database: regionalDatabase, home, routes });
    }
    const unavailable = new UnavailableRegion();
    const bindings = {
      gateways: new api.WalletRegionalDispatch({
        ...gateways,
        WALLET_GATEWAY_US: unavailable,
        WALLET_GATEWAY_OC: unavailable,
      }),
      runtimes: { ...runtimes, US: unavailable, OC: unavailable },
    };
    return {
      api,
      storage,
      database,
      catalog,
      wallet,
      directory,
      scope,
      signerScope,
      registration: custody.registration,
      regions,
      bindings,
    };
  } catch (error) {
    await storage.dispose();
    throw error;
  }
}

async function logRelocationState(role, request, response) {
  const value = await response.clone().json();
  console.log(
    'Relocation',
    role,
    new URL(request.url).pathname,
    response.status,
    JSON.stringify({
      state: value.state,
      kind: value.kind,
      pendingEffects: value.pending_effects,
      pendingRounds: value.pending_rounds,
      pendingPairs: value.pending_pairs,
      pendingLinkedSessions: value.pending_linked_sessions,
      unsettledLifecycles: value.unsettled_lifecycles?.length,
    }),
  );
}
