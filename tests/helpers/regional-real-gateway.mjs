import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

const regions = ['US', 'WEUR', 'APAC'];

export async function createRegionalRealGateway({ root, candidate, localRoot, output }) {
  await mkdir(output, { recursive: true });
  const publicRoot = resolve(candidate, '../..');
  await mkdir(resolve(output, 'runtime'), { recursive: true });
  await cp(resolve(candidate, 'dist/esm/wasm'), resolve(output, 'wasm'), { recursive: true });
  const bundlePath = resolve(output, 'runtime/gateway.mjs');
  await build({
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
    external: ['cloudflare:workers', 'bs58'],
    loader: { '.wasm': 'binary' },
    tsconfig: resolve(root, 'packages/wallet-console-server-ts/tsconfig.json'),
    alias: {
      '@shared': resolve(publicRoot, 'packages/shared-ts/src'),
      '@seams/wallet-server/cloud-host': resolve(candidate, 'dist/esm/cloud-host.js'),
    },
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `
        export { handleSplitGatewayRequest } from ${JSON.stringify(resolve(candidate, 'src/hosted-wallet-gateway.ts'))};
        export { createStaticWalletConsoleBindingV1, parseStaticWalletConsoleBindingConfigV1 } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/runtime/staticWalletConsoleBinding.ts'))};
        export { ConsoleRegistrationHomeAdmission } from './packages/wallet-console-server-ts/src/walletPlacement/registrationAdmission';
        export { WalletHomeCatalog } from './packages/wallet-console-server-ts/src/walletPlacement/home';
        export { dispatchKnownWalletHome, WalletRegionalDispatch, ConsoleRegistrationSetupDispatcher } from './packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
        export { handleWalletHomeServiceRequest } from './packages/wallet-console-server-ts/src/walletPlacement/service';
        export { parseTenantRuntimeWriterV1 } from './packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
      `,
    },
  });
  const api = await import(pathToFileURL(bundlePath));
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null, {status: 404}); } };',
    d1Databases: { CONSOLE_DB: 'console', US: 'us', WEUR: 'weur', APAC: 'apac' },
    compatibilityDate: '2026-06-12',
  });
  try {
    const consoleDatabase = await runtime.getD1Database('CONSOLE_DB');
    await migrate(
      consoleDatabase,
      resolve(root, 'packages/wallet-console-server-ts/migrations/d1-console'),
    );
    const secrets = dotenv.parse(
      await readFile(resolve(localRoot, '.runtime/wallet-gateway/.dev.vars.wallet-gateway')),
    );
    const template = await readFile(
      resolve(candidate, 'wrangler.local-hosted-wallet-gateway.toml'),
      'utf8',
    );
    const variables = dotenv.parse(template.split('[vars]')[1]);
    const config = api.parseStaticWalletConsoleBindingConfigV1(
      JSON.parse(secrets.WALLET_LOCAL_DEPLOYMENT_JSON),
    );
    const scope = {
      namespace: variables.SEAMS_TENANT_STORAGE_NAMESPACE,
      organizationId: config.deployment.orgId,
      projectId: config.deployment.projectId,
      environmentId: config.deployment.environmentId,
    };
    const accountId = '0123456789abcdef0123456789abcdef';
    const catalog = api.WalletHomeCatalog.parse([
      { region: 'US', accountId, databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { region: 'WEUR', accountId, databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { region: 'APAC', accountId, databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    ]);
    const consoleService = new RealHomeConsole(api, consoleDatabase, scope, catalog);
    const environment = {
      ...variables,
      ...secrets,
      WALLET_CONSOLE: api.createStaticWalletConsoleBindingV1(config),
      MPC_ROUTER: new LocalRoleTransport('http://127.0.0.1:4102'),
      SIGNING_WORKER: new LocalRoleTransport('http://127.0.0.1:4105'),
    };
    const signerWasm = await WebAssembly.compile(
      await readFile(resolve(publicRoot, 'wasm/near_signer/pkg/wasm_signer_worker_bg.wasm')),
    );
    const gateways = new Map();
    const bindings = {};
    for (const region of regions) {
      const database = await runtime.getD1Database(region);
      await migrate(database, resolve(candidate, 'migrations/d1-signer'));
      const gateway = new RealRegionalGateway({
        environmentKey: config.deployment.environmentKey,
        api,
        region,
        database,
        environment,
        consoleService,
        scope,
        catalog,
        bindings,
        signerWasm,
      });
      gateways.set(region, gateway);
      bindings[`WALLET_GATEWAY_${region}`] = { fetch: gateway.home.bind(gateway) };
    }
    return new RegionalRealScenario(runtime, gateways, output);
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

class LocalRoleTransport {
  constructor(origin) {
    this.origin = origin;
  }

  async fetch(input, init) {
    const original = new Request(input, init);
    const url = new URL(original.url);
    const target = new URL(`${url.pathname}${url.search}`, this.origin);
    return fetch(new Request(target, original));
  }
}

class RealHomeConsole {
  constructor(api, database, scope, catalog) {
    this.api = api;
    this.database = database;
    this.scope = scope;
    this.catalog = catalog;
    this.catalogJson = JSON.stringify(regions.map(this.select.bind(this)));
  }

  select(region) {
    return this.catalog.select(region);
  }

  fetch(request) {
    const writer = this.api.parseTenantRuntimeWriterV1(
      request.headers.get('x-seams-writer-role'),
      request.headers.get('x-seams-writer-version'),
      {
        accountId: request.headers.get('x-seams-writer-account'),
        databaseId: request.headers.get('x-seams-writer-database'),
      },
    );
    return this.api.handleWalletHomeServiceRequest(request, {
      database: this.database,
      scope: this.scope,
      catalogJson: this.catalogJson,
      admittedResources: this.catalog.deploymentResources(),
      deploymentLane: 'test',
      writer,
    });
  }
}

class RealRegionalGateway {
  pending = [];
  requests = [];

  constructor(options) {
    Object.assign(this, options);
  }

  home(request) {
    return this.handle(request, 'home');
  }

  async intercept(route) {
    const request = route.request();
    const response = await this.handle(
      new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postDataBuffer(),
      }),
      'ingress',
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  }

  waitUntil(promise) {
    this.pending.push(promise);
  }

  async handle(request, entry) {
    const home = this.catalog.select(this.region);
    const resource = { accountId: home.accountId, databaseId: home.databaseId };
    const authority = new this.api.ConsoleRegistrationHomeAdmission({
      environmentKey: this.environmentKey,
      service: this.consoleService,
      scope: this.scope,
      writer: this.api.parseTenantRuntimeWriterV1(
        'gateway',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        resource,
      ),
      localResource: resource,
      catalogJson: this.consoleService.catalogJson,
      ingressRegion: this.region,
    });
    const transport = new this.api.WalletRegionalDispatch(this.bindings, entry);
    const forwarded = await this.api.dispatchKnownWalletHome(
      request,
      authority,
      transport,
      undefined,
    );
    if (forwarded) {
      this.requests.push({
        path: new URL(request.url).pathname,
        status: forwarded.status,
        entry,
        forwarded: true,
      });
      return forwarded;
    }
    const identityStore = authority.identityStore();
    const response = await this.api.handleSplitGatewayRequest(
      request,
      { ...this.environment, SIGNER_DB: this.database },
      this,
      {
        signerWasm: this.signerWasm,
        sessionRouting: authority,
        lifecycleRouting: authority,
        recoveryRouting: authority,
        registrationAuthority: authority,
        registrationSetupDispatcher:
          new URL(request.url).pathname === '/wallets/register/setup'
            ? new this.api.ConsoleRegistrationSetupDispatcher(authority, transport, request.clone())
            : undefined,
        identityStore,
        credentialClaims: identityStore,
        emailOtpRateLimitCounter: identityStore.rateLimitCounter(),
        syncChallenges: identityStore.syncChallenges(),
        linkedDeviceBootstrap: identityStore.linkedDeviceBootstrap(),
        linkedDeviceProofNonces: identityStore.linkedDeviceProofNonces(),
        googleRegistrationAttempts: authority.registrationOffers(),
      },
    );
    this.requests.push({ path: new URL(request.url).pathname, status: response.status, entry });
    return response;
  }
}

class RegionalRealScenario {
  constructor(runtime, gateways, output) {
    this.runtime = runtime;
    this.gateways = gateways;
    this.output = output;
  }

  async routeContext(context, region) {
    await context.route(
      'http://127.0.0.1:4100/**',
      this.gateways.get(region).intercept.bind(this.gateways.get(region)),
    );
  }

  async verifyHome(home) {
    const evidence = [];
    for (const [region, gateway] of this.gateways) {
      const tables = {};
      for (const table of [
        'wallets',
        'wallet_signers',
        'wallet_authorities',
        'linked_device_authority_installations',
      ]) {
        const row = await gateway.database
          .prepare(`SELECT count(*) AS count FROM ${table}`)
          .first();
        tables[table] = row.count;
        if (region !== home) assert.equal(row.count, 0, `${region}/${table}`);
        else assert.ok(row.count > 0, `${region}/${table}`);
      }
      evidence.push({ region, tables, requests: gateway.requests });
    }
    await writeFile(
      resolve(this.output, 'regional-real-evidence.json'),
      JSON.stringify(
        {
          scope:
            'Real browser registration, linked-device installation and signing; three isolated signer databases; one shared local Router role stack.',
          home,
          evidence,
        },
        null,
        2,
      ),
    );
  }

  async close() {
    for (const gateway of this.gateways.values()) await Promise.allSettled(gateway.pending);
    await this.runtime.dispose();
  }
}

async function migrate(database, directory) {
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith('.sql')) continue;
    for (const sql of unstable_splitSqlQuery(
      await readFile(resolve(directory, filename), 'utf8'),
    )) {
      await database.prepare(sql).run();
    }
  }
}
