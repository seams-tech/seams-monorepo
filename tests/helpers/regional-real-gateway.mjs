import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

const regions = ['US', 'WEUR', 'APAC'];

export async function createRegionalRealGateway({
  root,
  candidate,
  localRoot,
  output,
  lostAcknowledgements,
}) {
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
        export { LocalIntendedLinkExecuteFaultControllerV1 } from ${JSON.stringify(resolve(candidate, 'src/localIntendedLinkExecuteFault.ts'))};
        export { parseLinkedDeviceRequestProofV1 } from ${JSON.stringify(resolve(candidate, 'src/core/deviceLinking/requestProof.ts'))};
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
    const router = new LocalRoleTransport('http://127.0.0.1:4102');
    const routerFault = new api.LocalIntendedLinkExecuteFaultControllerV1(
      router.fetch.bind(router),
    );
    const environment = {
      ...variables,
      ...secrets,
      WALLET_CONSOLE: api.createStaticWalletConsoleBindingV1(config),
      MPC_ROUTER: routerFault,
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
        acknowledgementFault: new AcknowledgementReplyLoss(lostAcknowledgements),
        activationFault: new ActivationReplyLoss(),
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
    return new RegionalRealScenario(runtime, gateways, output, consoleService, routerFault);
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
  methodFinalizeFault = new CommittedMethodReplyLoss(/\/auth-methods\/finalize$/u);
  methodRevokeFault = new CommittedMethodReplyLoss(/\/auth-methods\/[^/]+\/revoke$/u);
  recoveryPrepare = null;
  recoveryFinalizationStatuses = [];
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
    if (
      new URL(request.url()).pathname === '/wallets/recovery/prepare' &&
      response.status === 200
    ) {
      assert.equal(this.recoveryPrepare, null, 'Each ingress should prepare one owner recovery');
      this.recoveryPrepare = {
        url: request.url(),
        headers: request.headers(),
        body: request.postData(),
      };
    }
    if (new URL(request.url()).pathname === '/wallets/recovery/finalize') {
      this.recoveryFinalizationStatuses.push(response.status);
    }
    if (
      (await this.methodFinalizeFault.shouldDrop(request, response)) ||
      (await this.methodRevokeFault.shouldDrop(request, response)) ||
      (await this.activationFault.shouldDrop(request, response)) ||
      this.acknowledgementFault.shouldDrop(request, response)
    ) {
      await route.abort('connectionreset');
      return;
    }
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  }

  async commitRecoveryFinalization(route) {
    const request = route.request();
    assert.equal(new URL(request.url()).pathname, '/wallets/recovery/finalize');
    const response = await this.handle(
      new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postDataBuffer(),
      }),
      'ingress',
    );
    this.recoveryFinalizationStatuses.push(response.status);
    return response.status;
  }

  async post(url, options) {
    const response = await this.handle(
      new Request(url, {
        method: 'POST',
        headers: options.headers,
        body: typeof options.data === 'string' ? options.data : JSON.stringify(options.data),
      }),
      'ingress',
    );
    return new GatewayApiResponse(response);
  }

  async verifyRecoveryCodeSpent() {
    const prepared = this.recoveryPrepare;
    this.recoveryPrepare = null;
    assert.ok(prepared, 'Expected a successful recovery preparation through this ingress');
    const body = JSON.parse(prepared.body);
    body.reservationId = `wallet-recovery-reservation-${randomUUID().replaceAll('-', '')}`;
    const response = await this.handle(
      new Request(prepared.url, {
        method: 'POST',
        headers: prepared.headers,
        body: JSON.stringify(body),
      }),
      'ingress',
    );
    const result = await response.json();
    assert.equal(response.status, 401);
    assert.equal(result.code, 'recovery_code_used');
    return { status: response.status, code: result.code };
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
      this.environment.GOOGLE_OIDC_CLIENT_ID,
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
  constructor(runtime, gateways, output, consoleService, routerFault) {
    this.routerFault = routerFault;
    this.consoleService = consoleService;
    this.runtime = runtime;
    this.gateways = gateways;
    this.output = output;
  }

  requestsFor(region, readinessRequests) {
    const gateway = this.gateways.get(region);
    return { get: readinessRequests.get.bind(readinessRequests), post: gateway.post.bind(gateway) };
  }

  finalizationCommitter(region) {
    const gateway = this.gateways.get(region);
    return gateway.commitRecoveryFinalization.bind(gateway);
  }

  async routeContext(context, region) {
    await context.unroute('http://127.0.0.1:4100/**');
    await context.route(
      'http://127.0.0.1:4100/**',
      this.gateways.get(region).intercept.bind(this.gateways.get(region)),
    );
  }

  async verifyMethodLifecycle(home, ingress, emailState) {
    const { results: placements } = await this.consoleService.database
      .prepare('SELECT wallet_id, region, state FROM wallet_homes')
      .all();
    assert.equal(placements.length, 1);
    const placement = placements[0];
    assert.equal(placement.region, home);
    assert.equal(placement.state, 'established');
    const stores = [];
    for (const [region, gateway] of this.gateways) {
      const { results: methods } = await gateway.database
        .prepare(`
          SELECT kind, status, wallet_authority_id FROM wallet_auth_methods
          WHERE wallet_id = ? ORDER BY kind
        `)
        .bind(placement.wallet_id)
        .all();
      const { results: authorities } = await gateway.database
        .prepare(`
          SELECT authority_id, provenance_kind, lifecycle_state FROM wallet_authorities
          WHERE wallet_id = ?
        `)
        .bind(placement.wallet_id)
        .all();
      if (region === home) {
        assert.equal(authorities.length, 1);
        const authority = authorities[0];
        assert.equal(authority.provenance_kind, 'wallet_registration');
        assert.equal(authority.lifecycle_state, 'active');
        assert.deepEqual(methods, [
          { kind: 'email_otp', status: emailState, wallet_authority_id: authority.authority_id },
          { kind: 'passkey', status: 'active', wallet_authority_id: authority.authority_id },
        ]);
      } else {
        assert.deepEqual(methods, []);
        assert.deepEqual(authorities, []);
      }
      const identities = await gateway.database
        .prepare('SELECT count(*) AS count FROM identity_links')
        .first();
      assert.equal(identities.count, 0, 'Identity locators belong to Console');
      stores.push({ region, methods, authorities, identities: identities.count });
    }
    const gateway = this.gateways.get(ingress);
    const methodPath = `/wallets/${placement.wallet_id}/auth-methods/`;
    assert.ok(
      gateway.requests.some(isSuccessfulForward.bind(undefined, `${methodPath}finalize`)),
      'Method installation must commit at home',
    );
    assert.ok(
      gateway.requests.some(isSuccessfulForward.bind(undefined, '/wallet/email-otp/dev/otp-outbox')),
      'Development OTP reads must reach the home that issued the challenge',
    );
    if (emailState === 'revoked') {
      assert.ok(gateway.requests.some(isForwardedRevocation.bind(undefined, methodPath)));
    }
    const replay = {
      finalization: gateway.methodFinalizeFault.verify(2),
      revocation: gateway.methodRevokeFault.verify(emailState === 'revoked' ? 2 : 0),
    };
    await writeFile(
      resolve(this.output, `method-${emailState}-evidence.json`),
      JSON.stringify({ home, ingress, placement, stores, replay, requests: gateway.requests }, null, 2),
    );
  }

  async verifyHome(home) {
    const evidence = [];
    for (const [region, gateway] of this.gateways) {
      const tables = {};
      for (const [table, expected] of [
        ['wallets', 1],
        ['wallet_signers', 3],
        ['wallet_authorities', 2],
        ['linked_device_authority_installations', 1],
      ]) {
        const row = await gateway.database
          .prepare(`SELECT count(*) AS count FROM ${table}`)
          .first();
        tables[table] = row.count;
        if (region !== home) assert.equal(row.count, 0, `${region}/${table}`);
        else assert.equal(row.count, expected, `${region}/${table}`);
      }
      const cleanup = await verifySignerCleanup(gateway.database, region, home);
      const acknowledgement = gateway.acknowledgementFault.verify();
      const activation = gateway.activationFault.verify();
      if (acknowledgement.attempts > 0 || activation.attempts > 0) assert.notEqual(region, home);
      evidence.push({
        region,
        tables,
        cleanup,
        activation,
        acknowledgement,
        requests: gateway.requests,
      });
    }
    assert.equal(
      evidence.filter(hasAcknowledgement).length,
      1,
      'One foreign ingress must handle acknowledgement',
    );
    const routerReplay = this.routerFault.outcome();
    assert.deepEqual(routerReplay, { kind: 'proved', proof: 'replay_answered_same_reservation' });
    const shared = await verifySharedLinkState(this.consoleService, this.gateways, home);
    await writeFile(
      resolve(this.output, 'regional-real-evidence.json'),
      JSON.stringify(
        {
          scope:
            'Real browser registration, linked-device installation and signing; three isolated signer databases; one shared local Router role stack.',
          home,
          shared,
          routerReplay,
          evidence,
        },
        null,
        2,
      ),
    );
  }

  async verifyMixedHomes(wallets) {
    assert.equal(wallets.length, 3);
    assert.equal(new Set(wallets.map(walletIdentity)).size, 3);
    const { database, scope, catalog } = this.consoleService;
    const { results: placements } = await database
      .prepare(
        `
      SELECT wallet_id, region, account_id, database_id, state
      FROM wallet_homes WHERE namespace = ? AND organization_id = ?
        AND project_id = ? AND environment_id = ?
    `,
      )
      .bind(scope.namespace, scope.organizationId, scope.projectId, scope.environmentId)
      .all();
    assert.equal(placements.length, 3, 'All three placements must share the exact tenant scope');
    const evidence = [];
    for (const wallet of wallets) {
      const placement = placements.find(matchesWallet.bind(undefined, wallet.walletId));
      assert.ok(placement);
      assert.equal(placement.region, wallet.home);
      assert.equal(placement.state, 'established');
      const home = catalog.select(wallet.home);
      assert.equal(placement.account_id, home.accountId);
      assert.equal(placement.database_id, home.databaseId);
      const stores = [];
      for (const [region, gateway] of this.gateways) {
        const tables = {};
        for (const table of ['wallets', 'wallet_signers', 'wallet_authorities']) {
          const row = await gateway.database
            .prepare(`SELECT count(*) AS count FROM ${table} WHERE wallet_id = ?`)
            .bind(wallet.walletId)
            .first();
          tables[table] = row.count;
          if (region !== wallet.home) assert.equal(row.count, 0, `${region}/${table}`);
          else if (table === 'wallet_signers') assert.ok(row.count > 0);
          else if (table === 'wallet_authorities') assert.equal(row.count, 2, `${region}/${table}`);
          else assert.equal(row.count, 1, `${region}/${table}`);
        }
        const { results: authorities } = await gateway.database
          .prepare(
            `
          SELECT provenance_kind, lifecycle_state FROM wallet_authorities WHERE wallet_id = ?
          ORDER BY provenance_kind
        `,
          )
          .bind(wallet.walletId)
          .all();
        assert.deepEqual(
          authorities,
          region === wallet.home
            ? [
                { provenance_kind: 'wallet_recovery', lifecycle_state: 'active' },
                { provenance_kind: 'wallet_registration', lifecycle_state: 'active' },
              ]
            : [],
        );
        stores.push({ region, tables, authorities });
      }
      evidence.push({ ...wallet, stores });
    }
    const traffic = [];
    for (const [region, gateway] of this.gateways) {
      for (const path of [
        '/router-ab/ed25519/yao/export/execute',
        '/router-ab/ecdsa-derivation/operation-step-up',
        '/router-ab/ecdsa-derivation/export',
        '/wallets/recovery/prepare',
        '/wallets/recovery/finalize',
      ]) {
        assert.ok(
          gateway.requests.some(isSuccessfulForward.bind(undefined, path)),
          `${region} must forward ${path}`,
        );
      }
      const consumedCode = await gateway.verifyRecoveryCodeSpent();
      assert.deepEqual(
        gateway.recoveryFinalizationStatuses,
        [200, 200],
        'One commit and one durable replay',
      );
      traffic.push({
        region,
        consumedCode,
        finalizationStatuses: gateway.recoveryFinalizationStatuses,
        requests: gateway.requests,
      });
    }
    await writeFile(
      resolve(this.output, 'mixed-home-evidence.json'),
      JSON.stringify(
        {
          scope,
          description:
            'Three real wallets concurrently retained in one tenant namespace; locked page reload, passkey unlock, both-family key export, fresh-browser passkey recovery with lost finalization response and client runtime reset, and signing through foreign ingress after all registrations; one shared local Router stack.',
          wallets: evidence,
          traffic,
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

async function verifySignerCleanup(database, region, home) {
  const transient = {};
  for (const table of [
    'linked_device_request_proof_nonces',
    'linked_device_sessions',
    'linked_device_session_transcripts',
    'linked_device_target_credentials',
    'linked_device_target_commit_reservations',
    'linked_device_email_otp_grants',
    'linked_device_ed25519_export_root_transfers',
    'linked_device_authority_allocations',
  ]) {
    const row = await database.prepare(`SELECT count(*) AS count FROM ${table}`).first();
    transient[table] = row.count;
    assert.equal(row.count, 0, `${region}/${table}`);
  }
  const { results: deliveries } = await database
    .prepare(
      `
    SELECT lifecycle_kind, cleanup_state,
           sealed_envelope_json IS NULL AS envelope_removed,
           cleanup_receipt_json IS NOT NULL AS receipt_retained,
           acknowledgement_receipt_json IS NOT NULL AS acknowledgement_retained
    FROM linked_device_wallet_session_credential_deliveries_v1
  `,
    )
    .all();
  assert.equal(deliveries.length, region === home ? 1 : 0, `${region}/deliveries`);
  for (const delivery of deliveries) {
    assert.equal(delivery.lifecycle_kind, 'cleanup_complete');
    assert.equal(delivery.cleanup_state, 'complete');
    assert.equal(delivery.envelope_removed, 1);
    assert.equal(delivery.receipt_retained, 1);
    assert.equal(delivery.acknowledgement_retained, 1);
  }
  return { transient, deliveries };
}

function hasAcknowledgement(entry) {
  return entry.acknowledgement.attempts > 0;
}

class AcknowledgementReplyLoss {
  attempts = 0;
  firstBody = null;
  proofs = new Set();

  constructor(lostReplies) {
    assert.ok(lostReplies === 0 || lostReplies === 2);
    this.lostReplies = lostReplies;
  }

  shouldDrop(request, response) {
    const body = request.postData() ?? '';
    if (
      request.method() !== 'POST' ||
      !new URL(request.url()).pathname.endsWith('/receipt') ||
      !body.includes('"local_authority_activation_final_ack_v1"')
    )
      return false;
    assert.equal(response.status, 204, 'Acknowledgement must commit before its reply is lost');
    if (this.firstBody === null) this.firstBody = body;
    else assert.equal(body, this.firstBody, 'Replay must retain the exact acknowledgement');
    const proof = request.headers()['x-seams-linked-device-proof-v1'];
    assert.ok(proof, 'Acknowledgement requires a device proof');
    assert.ok(!this.proofs.has(proof), 'Each replay requires a fresh device proof');
    this.proofs.add(proof);
    this.attempts += 1;
    return this.attempts <= this.lostReplies;
  }

  verify() {
    if (this.attempts > 0) assert.equal(this.attempts, this.lostReplies + 1);
    return {
      attempts: this.attempts,
      lostReplies: this.attempts > 0 ? this.lostReplies : 0,
      successfulStatuses: Array(this.attempts).fill(204),
      distinctProofs: this.proofs.size,
    };
  }
}

class ActivationReplyLoss {
  attempts = 0;
  first = null;

  async shouldDrop(request, response) {
    const body = request.postData() ?? '';
    if (
      request.method() !== 'POST' ||
      !new URL(request.url()).pathname.endsWith('/receipt') ||
      !body.includes('"local_authority_installation_receipt_v1"')
    )
      return false;
    assert.equal(response.status, 200);
    const activation = await response.clone().json();
    assert.equal(activation.kind, 'active');
    this.attempts += 1;
    if (this.first === null) {
      this.first = { body, activation };
      return true;
    }
    assert.equal(body, this.first.body, 'Activation retry must retain its installation receipt');
    assert.deepEqual(
      activation,
      this.first.activation,
      'Activation must replay the same authority and session',
    );
    return false;
  }

  verify() {
    if (this.attempts > 0) assert.equal(this.attempts, 2);
    return { attempts: this.attempts, lostReplies: this.attempts > 0 ? 1 : 0 };
  }
}

class CommittedMethodReplyLoss {
  attempts = 0;
  first = null;

  constructor(pathPattern) {
    this.pathPattern = pathPattern;
  }

  async shouldDrop(request, response) {
    if (request.method() !== 'POST' || !this.pathPattern.test(new URL(request.url()).pathname)) {
      return false;
    }
    assert.equal(response.status, 200, 'Method mutation must commit before losing its reply');
    const body = request.postData();
    const result = await response.clone().json();
    this.attempts += 1;
    if (this.first === null) {
      this.first = { body, result };
      return true;
    }
    assert.equal(body, this.first.body, 'Method mutation must retry the same request and proof');
    assert.deepEqual(result, this.first.result, 'Method mutation must replay its committed result');
    return false;
  }

  verify(expectedAttempts) {
    assert.equal(this.attempts, expectedAttempts);
    return { attempts: this.attempts, lostReplies: this.attempts > 0 ? 1 : 0 };
  }
}

async function verifySharedLinkState(consoleService, gateways, home) {
  const { database, scope, api } = consoleService;
  const { results: bootstrap } = await database
    .prepare(
      `
    SELECT boot.state, route.wallet_id, home.region
    FROM linked_device_bootstrap boot
    JOIN wallet_routes route ON route.namespace = boot.namespace
      AND route.organization_id = boot.organization_id AND route.project_id = boot.project_id
      AND route.environment_id = boot.environment_id AND route.kind = 'linked_device'
      AND route.value = boot.link_session_id
    JOIN wallet_homes home ON home.namespace = route.namespace
      AND home.organization_id = route.organization_id AND home.project_id = route.project_id
      AND home.environment_id = route.environment_id AND home.wallet_id = route.wallet_id
  `,
    )
    .all();
  assert.equal(bootstrap.length, 1);
  assert.equal(bootstrap[0].state, 'claimed');
  assert.equal(bootstrap[0].region, home);
  let acknowledgedProofs = 0;
  for (const gateway of gateways.values()) {
    for (const encoded of gateway.acknowledgementFault.proofs) {
      const proof = api.parseLinkedDeviceRequestProofV1(
        JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
      );
      const row = await database
        .prepare(
          `
        SELECT expires_at_ms, consumed_at_ms FROM linked_device_request_proof_nonces
        WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
          AND link_session_id = ? AND request_nonce_b64u = ?
      `,
        )
        .bind(
          scope.namespace,
          scope.organizationId,
          scope.projectId,
          scope.environmentId,
          proof.linkSessionId,
          proof.requestNonceB64u,
        )
        .first();
      assert.ok(row, 'Each final acknowledgement proof must be retained in shared Console');
      assert.ok(row.expires_at_ms > row.consumed_at_ms);
      acknowledgedProofs += 1;
    }
  }
  assert.equal(acknowledgedProofs, 3);
  return {
    claimedBootstrap: 1,
    linkedRouteHome: home,
    retainedAcknowledgementProofs: acknowledgedProofs,
  };
}

function walletIdentity(wallet) {
  return wallet.walletId;
}

function matchesWallet(walletId, placement) {
  return placement.wallet_id === walletId;
}

function isSuccessfulForward(path, request) {
  return request.path === path && request.forwarded === true && request.status === 200;
}

function isForwardedRevocation(methodPath, request) {
  return (
    request.path.startsWith(methodPath) &&
    request.path.endsWith('/revoke') &&
    request.forwarded === true &&
    request.status === 200
  );
}

class GatewayApiResponse {
  constructor(response) {
    this.response = response;
  }
  status() {
    return this.response.status;
  }
  ok() {
    return this.response.ok;
  }
  text() {
    return this.response.text();
  }
  json() {
    return this.response.json();
  }
}
