import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

const regions = ['US', 'WEUR', 'APAC', 'OC'];

export async function createRegionalRealGateway({
  root,
  candidate,
  localRoot,
  output,
  lostAcknowledgements,
  databaseState,
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
        export { TracedD1Database } from ${JSON.stringify(resolve(publicRoot, 'tests/r150-hosted/gateway/d1Trace.ts'))};
        export { encodeRouterAbEd25519YaoProductRegistrationStateV1, parseRouterAbEd25519YaoProductRegistrationStateJsonV1 } from ${JSON.stringify(resolve(candidate, 'src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPersistence.ts'))};
        export { parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1 } from ${JSON.stringify(resolve(candidate, 'src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore.ts'))};
        export { parseRouterAbEd25519YaoRecoveryAdmissionRequestV1, parseRouterAbEd25519YaoRegistrationAdmissionRequestV1 } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/utils/routerAbEd25519Yao.ts'))};
        export { CloudflareD1AuthorizationStore } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts'))};
        export { parseEmailOtpRegistrationVerificationReceiptV1 } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/emailOtp/d1EmailOtpRecords.ts'))};
        export { LocalIntendedLinkExecuteFaultControllerV1 } from ${JSON.stringify(resolve(candidate, 'src/localIntendedLinkExecuteFault.ts'))};
        export { parseLinkedDeviceRequestProofV1 } from ${JSON.stringify(resolve(candidate, 'src/core/deviceLinking/requestProof.ts'))};
        export { handleSplitGatewayRequest } from ${JSON.stringify(resolve(candidate, 'src/hosted-wallet-gateway.ts'))};
        export { createStaticWalletConsoleBindingV1, parseStaticWalletConsoleBindingConfigV1 } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/runtime/staticWalletConsoleBinding.ts'))};
        export { ConsoleRegistrationHomeAdmission } from './packages/wallet-console-server-ts/src/walletPlacement/registrationAdmission';
        export { WalletHomeCatalog } from './packages/wallet-console-server-ts/src/walletPlacement/home';
        export { dispatchKnownWalletHome, resolveLocalRegistrationContinuation, WalletRegionalDispatch, ConsoleRegistrationSetupDispatcher } from './packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
        export { resolveGatewayDeployment, gatewaySessionResponse, GATEWAY_SESSION_PATH } from './packages/wallet-console-server-ts/src/walletPlacement/gatewaySession';
        export { fourRegionBinding, regionalResourceProof } from './tests/helpers/tenantDeploymentFixtures';
        export { D1RegionalDeploymentAdmission } from './packages/wallet-console-server-ts/src/tenantDeployment/regionalAdmission';
        export { DeploymentFencedDatabase } from './packages/wallet-console-server-ts/src/tenantDeployment/fencedDatabase';
        export { TenantDeploymentD1ResourceIdentityV1 } from './packages/wallet-console-server-ts/src/tenantDeployment/deploymentResource';
        export { handleWalletHomeServiceRequest } from './packages/wallet-console-server-ts/src/walletPlacement/service';
        export { parseTenantRuntimeWriterV1 } from './packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
      `,
    },
  });
  const api = await import(pathToFileURL(bundlePath));
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null, {status: 404}); } };',
    d1Databases: { CONSOLE_DB: 'console', US: 'us', WEUR: 'weur', APAC: 'apac', OC: 'oc' },
    compatibilityDate: '2026-06-12',
    d1Persist: databaseState?.directory,
  });
  try {
    const consoleDatabase = await runtime.getD1Database('CONSOLE_DB');
    if (databaseState?.mode !== 'reopen') {
      await migrate(
        consoleDatabase,
        resolve(root, 'packages/wallet-console-server-ts/migrations/d1-console'),
      );
    }
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
      { region: 'OC', accountId, databaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    ]);
    const consoleService = new RealHomeConsole(
      api,
      consoleDatabase,
      scope,
      catalog,
      config.deployment.environmentKey,
    );
    consoleService.binding = await api.fourRegionBinding(Date.now(), 'test', scope);
    const router = new LocalRoleTransport('http://127.0.0.1:4102');
    const routerFault = new api.LocalIntendedLinkExecuteFaultControllerV1(
      router.fetch.bind(router),
    );
    const environment = {
      ...variables,
      ...secrets,
      WALLET_CONSOLE: new ObservableConsoleTransport(api.createStaticWalletConsoleBindingV1(config), consoleService),
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
      if (databaseState?.mode !== 'reopen') {
        await migrate(database, resolve(candidate, 'migrations/d1-signer'));
      }
      const home = catalog.select(region);
      const localAdmission = new api.D1RegionalDeploymentAdmission(
        database,
        api.TenantDeploymentD1ResourceIdentityV1.parse({
          namespace: scope.namespace,
          accountId: home.accountId,
          databaseId: home.databaseId,
        }),
      );
      if (databaseState?.mode !== 'reopen') {
        const admission = {
          binding: consoleService.binding,
          activationSequence: 1,
          resourceVerificationsJson: JSON.stringify(
            regionalDeploymentProofs(api, consoleService.binding),
          ),
        };
        await localAdmission.prepare(admission);
        await localAdmission.activate(admission);
      }
      const gateway = new RealRegionalGateway({
        localAdmission,
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

function regionalDeploymentProofs(api, binding) {
  const proofs = [];
  for (const resource of binding.resources) {
    proofs.push(
      api.regionalResourceProof(
        binding,
        resource.databaseId,
        resource.databaseId,
        randomUUID(),
        Date.now(),
      ),
    );
  }
  return proofs;
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

class ObservableConsoleTransport {
  constructor(delegate, control) {
    this.delegate = delegate;
    this.control = control;
  }
  fetch(input, init) {
    const request = new Request(input, init);
    this.control.requests.push(new URL(request.url).pathname);
    if (!this.control.available) return Promise.resolve(new Response(null, { status: 503 }));
    return this.delegate.fetch(request);
  }
}

class RealHomeConsole {
  available = true;
  requests = [];
  constructor(api, database, scope, catalog, environmentKey) {
    this.environmentKey = environmentKey;
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
    this.requests.push(new URL(request.url).pathname);
    if (!this.available) return Promise.resolve(new Response(null, { status: 503 }));
    if (new URL(request.url).pathname === this.api.GATEWAY_SESSION_PATH) {
      return this.api.gatewaySessionResponse(request, this.binding, this.database, this.catalogJson);
    }
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
      environmentKey: this.environmentKey,
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
    if (isRecoveryFinalizationPath(new URL(request.url()).pathname)) {
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
    assert.ok(isRecoveryFinalizationPath(new URL(request.url()).pathname));
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
    const writer = this.api.parseTenantRuntimeWriterV1('gateway', home.databaseId, resource);
    const binding = await this.localAdmission.resolveRuntimeBinding('test', writer);
    if (!binding) {
      return Response.json({ ok: false, code: 'tenant_deployment_unavailable' }, { status: 503 });
    }
    const fencedDatabase = new this.api.DeploymentFencedDatabase(this.database, binding, writer);
    const authority = new this.api.ConsoleRegistrationHomeAdmission({
      environmentKey: this.environmentKey,
      service: this.consoleService,
      scope: this.scope,
      writer,
      localResource: resource,
      catalogJson: this.consoleService.catalogJson,
      ingressRegion: this.region,
    });
    const transport = new this.api.WalletRegionalDispatch(this.bindings);
    const resolution = await this.api.resolveGatewayDeployment({
      request,
      database: fencedDatabase,
      binding,
      writer,
      deploymentLane: 'test',
      service: this.consoleService,
      catalogJson: this.consoleService.catalogJson,
      timingHeaders: new Headers(),
    });
    let forwarded = null;
    if (resolution.kind === 'forward') {
      forwarded = await transport.forward(resolution.home, request);
    } else if (resolution.kind === 'rejected') {
      forwarded = resolution.response;
    } else {
      const continuation = await this.api.resolveLocalRegistrationContinuation({
        request, database: fencedDatabase, tenant: this.scope, session: resolution.session,
      });
      if (continuation.kind === 'rejected') forwarded = continuation.response;
      else if (continuation.kind === 'absent') {
        forwarded = await this.api.dispatchKnownWalletHome(
          request, authority, transport, this.environment.GOOGLE_OIDC_CLIENT_ID, resolution.session,
        );
      }
    }
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
    const database = new this.api.TracedD1Database(fencedDatabase);
    const response = database.response(
      await this.api.handleSplitGatewayRequest(
        request,
        { ...this.environment, SIGNER_DB: database },
        this,
        {
          signerWasm: this.signerWasm,
          sessionRouting: authority,
          lifecycleRouting: authority,
          recoveryRouting: authority,
          registrationAuthority: authority,
          registrationSetupDispatcher:
            new URL(request.url).pathname === '/wallets/register/setup'
              ? new this.api.ConsoleRegistrationSetupDispatcher(
                  authority,
                  transport,
                  request.clone(),
                )
              : undefined,
          identityStore,
          credentialClaims: identityStore,
          emailOtpRateLimitCounter: identityStore.rateLimitCounter(),
          syncChallenges: identityStore.syncChallenges(),
          linkedDeviceBootstrap: identityStore.linkedDeviceBootstrap(),
          linkedDeviceProofNonces: identityStore.linkedDeviceProofNonces(),
          googleRegistrationAttempts: authority.registrationOffers(),
        },
      ),
    );
    if (response.status >= 500) {
      let code = 'non_json_error';
      try {
        const body = await response.clone().json();
        code = typeof body?.code === 'string' ? body.code : 'missing_error_code';
      } catch {}
      console.error('regional-home-error', {
        region: this.region,
        path: new URL(request.url).pathname,
        status: response.status,
        code,
      });
    }
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

  beginConsoleOutage() {
    this.consoleService.requests.length = 0;
    this.consoleService.available = false;
    for (const gateway of this.gateways.values()) gateway.requests.length = 0;
  }

  async consoleOutageRequests() {
    assert.equal(this.consoleService.available, false, 'Console must remain unavailable');
    for (const gateway of this.gateways.values()) await Promise.all(gateway.pending);
    assert.deepEqual(this.consoleService.requests, [], 'Established signing contacted Console');
    return [...this.gateways.values()].flatMap(gatewayRequests);
  }

  async verifyConsoleOutage(curve) {
    const requests = await this.consoleOutageRequests();
    const signingPath = curve === 'ecdsa' ? '/router-ab/ecdsa-derivation/sign' : '/router-ab/ed25519/sign';
    assert.equal(requests.filter(isSuccessfulPrepare.bind(null, signingPath)).length, 3);
    assert.equal(requests.filter(isSuccessfulFinalize.bind(null, signingPath)).length, 3);
    if (curve === 'ecdsa') assert.ok(requests.some(isSuccessfulRefill));
    await writeFile(resolve(this.output, 'console-outage.json'), JSON.stringify({
      consoleRequests: this.consoleService.requests,
      requests,
    }, null, 2));
  }

  async verifyStepUpConsoleOutage() {
    const requests = await this.consoleOutageRequests();
    for (const [path, count] of [
      ['/router-ab/ed25519/sign', 2],
      ['/router-ab/ecdsa-derivation/sign', 3],
    ]) {
      assert.equal(requests.filter(isSuccessfulPrepare.bind(null, path)).length, count);
      assert.equal(requests.filter(isSuccessfulFinalize.bind(null, path)).length, count);
    }
    const placement = await this.consoleService.database
      .prepare('SELECT wallet_id, region FROM wallet_homes')
      .first();
    assert.ok(placement);
    assert.equal(placement.region, 'US');
    const ownership = {};
    for (const [region, gateway] of this.gateways) {
      ownership[region] = await verifyOperationOwnership(
        gateway, gateway.scope, placement.wallet_id, region === placement.region,
      );
    }
    assert.equal(ownership.US.authorization_grant, 3);
    assert.equal(ownership.US.verified_step_up, 2);
    await writeFile(resolve(this.output, 'step-up-outage.json'), JSON.stringify({
      consoleRequests: this.consoleService.requests,
      home: placement.region,
      ownership,
      requests,
    }, null, 2));
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
        .prepare(
          `
          SELECT kind, status, wallet_authority_id FROM wallet_auth_methods
          WHERE wallet_id = ? ORDER BY kind
        `,
        )
        .bind(placement.wallet_id)
        .all();
      const { results: authorities } = await gateway.database
        .prepare(
          `
          SELECT authority_id, provenance_kind, lifecycle_state FROM wallet_authorities
          WHERE wallet_id = ?
        `,
        )
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
      gateway.requests.some(
        isSuccessfulForward.bind(undefined, '/wallet/email-otp/dev/otp-outbox'),
      ),
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
      JSON.stringify(
        { home, ingress, placement, stores, replay, requests: gateway.requests },
        null,
        2,
      ),
    );
  }

  async verifyGoogleRecovery(home, ingress, foundingMethod) {
    assert.ok(foundingMethod === 'passkey' || foundingMethod === 'email_otp');
    const { results: placements } = await this.consoleService.database
      .prepare('SELECT wallet_id, region, state FROM wallet_homes')
      .all();
    assert.equal(placements.length, 1);
    const placement = placements[0];
    assert.equal(placement.region, home);
    assert.equal(placement.state, 'established');
    const { results: registrationOffers } = await this.consoleService.database
      .prepare('SELECT wallet_id, state FROM email_otp_registration_attempts')
      .all();
    assert.deepEqual(
      registrationOffers,
      foundingMethod === 'email_otp' ? [{ wallet_id: placement.wallet_id, state: 'active' }] : [],
    );
    const stores = [];
    for (const [region, gateway] of this.gateways) {
      const { results: methods } = await gateway.database
        .prepare(
          `
          SELECT method.kind, method.status, authority.provenance_kind, authority.lifecycle_state
          FROM wallet_auth_methods method JOIN wallet_authorities authority
            ON method.namespace = authority.namespace AND method.org_id = authority.org_id
            AND method.project_id = authority.project_id AND method.env_id = authority.env_id
            AND method.wallet_authority_id = authority.authority_id
          WHERE method.wallet_id = ? ORDER BY method.kind, authority.provenance_kind
        `,
        )
        .bind(placement.wallet_id)
        .all();
      assert.deepEqual(
        methods,
        region === home
          ? [
              {
                kind: 'email_otp',
                status: 'active',
                provenance_kind: 'wallet_recovery',
                lifecycle_state: 'active',
              },
              {
                kind: foundingMethod,
                status: 'active',
                provenance_kind: 'wallet_registration',
                lifecycle_state: 'active',
              },
            ]
          : [],
      );
      const tables = {};
      for (const table of ['wallets', 'wallet_signers', 'wallet_authorities']) {
        const row = await gateway.database
          .prepare(`SELECT count(*) AS count FROM ${table} WHERE wallet_id = ?`)
          .bind(placement.wallet_id)
          .first();
        tables[table] = row.count;
      }
      assert.deepEqual(
        tables,
        region === home
          ? { wallets: 1, wallet_signers: 3, wallet_authorities: 2 }
          : { wallets: 0, wallet_signers: 0, wallet_authorities: 0 },
      );
      const identities = await gateway.database
        .prepare('SELECT count(*) AS count FROM identity_links')
        .first();
      assert.equal(identities.count, 0);
      const ceremonyOwnership = await verifyCeremonyOwnership(
        gateway.database,
        placement.wallet_id,
        region === home,
        gateway.api,
      );
      const emailOtpOwnership = await verifyEmailOtpOwnership(
        gateway.database,
        placement.wallet_id,
        region === home,
      );
      const yaoOwnership = await verifyYaoOwnership(gateway, placement.wallet_id, region === home);
      const operationOwnership = await verifyOperationOwnership(
        gateway,
        gateway.scope,
        placement.wallet_id,
        region === home,
      );
      if (region === home) assert.ok(operationOwnership.verified_step_up > 0);
      stores.push({
        region,
        methods,
        tables,
        identities: identities.count,
        ceremonyOwnership,
        emailOtpOwnership,
        yaoOwnership,
        operationOwnership,
      });
    }
    const sharedIdentity = await this.consoleService.database
      .prepare('SELECT count(*) AS count FROM identity_links WHERE user_id = ?')
      .bind(placement.wallet_id)
      .first();
    assert.equal(sharedIdentity.count, 1, 'Recovered Google identity must have one shared locator');
    const gateway = this.gateways.get(ingress);
    assert.deepEqual(gateway.recoveryFinalizationStatuses, [200, 200]);
    for (const path of [
      '/wallets/recovery/prepare',
      '/wallets/recovery/google/verify',
      '/wallets/recovery/email-otp/verify',
      '/wallets/recovery/email-otp/release',
      '/wallets/recovery/google-email-otp/finalize',
    ]) {
      assert.ok(gateway.requests.some(isSuccessfulForward.bind(undefined, path)), path);
    }
    const consumedCode = await gateway.verifyRecoveryCodeSpent();
    await writeFile(
      resolve(this.output, 'recovery-evidence.json'),
      JSON.stringify(
        {
          home,
          ingress,
          foundingMethod,
          registrationOffers,
          placement,
          stores,
          sharedIdentities: sharedIdentity.count,
          finalizationStatuses: gateway.recoveryFinalizationStatuses,
          consumedCode,
          requests: gateway.requests,
        },
        null,
        2,
      ),
    );
  }

  async verifyHome(home, routerReplays) {
    const placement = await this.consoleService.database
      .prepare('SELECT wallet_id FROM wallet_homes WHERE region = ?')
      .bind(home)
      .first();
    assert.ok(placement);
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
      const operationOwnership = await verifyOperationOwnership(
        gateway,
        gateway.scope,
        placement.wallet_id,
        region === home,
      );
      if (region === home) assert.ok(operationOwnership.linked > 0);
      const cleanup = await verifySignerCleanup(gateway.database, region, home);
      const acknowledgement = gateway.acknowledgementFault.verify();
      const activation = gateway.activationFault.verify();
      if (acknowledgement.attempts > 0 || activation.attempts > 0) assert.notEqual(region, home);
      evidence.push({
        region,
        tables,
        operationOwnership,
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
    const [routerReplay, ...afterRestart] = routerReplays;
    assert.deepEqual(routerReplay, { kind: 'proved', proof: 'replay_answered_same_reservation' });
    for (const outcome of afterRestart) {
      assert.deepEqual(
        outcome,
        { kind: 'violated', violation: 'router_execute_not_observed' },
        'Activation and acknowledgement replay must not execute Router material again',
      );
    }
    const shared = await verifySharedLinkState(this.consoleService, this.gateways, home);
    await writeFile(
      resolve(this.output, 'regional-real-evidence.json'),
      JSON.stringify(
        {
          scope:
            'Real browser registration, linked-device installation and signing; four isolated signer databases; one shared local Router role stack.',
          home,
          shared,
          routerReplay,
          routerReplayAfterRestarts: afterRestart,
          evidence,
        },
        null,
        2,
      ),
    );
  }

  async verifyMixedHomes(wallets, registrations) {
    assert.equal(registrations.length, regions.length);
    assert.deepEqual(registrations.map(registrationHome).sort(), [...regions].sort());
    const latestStart = Math.max(...registrations.map(registrationStart));
    const earliestCompletion = Math.min(...registrations.map(registrationCompletion));
    assert.ok(latestStart < earliestCompletion, 'All regional registration calls must overlap');
    assert.equal(wallets.length, regions.length);
    assert.equal(new Set(wallets.map(walletIdentity)).size, regions.length);
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
    assert.equal(
      placements.length,
      regions.length,
      'All placements must share the exact tenant scope',
    );
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
            'Three real wallets registered concurrently in one tenant namespace; locked page reload, passkey unlock, both-family key export, fresh-browser passkey recovery with lost finalization response and client runtime reset, and signing through foreign ingress after all registrations; one shared local Router stack.',
          registrations,
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
  assert.equal(acknowledgedProofs, regions.length);
  return {
    claimedBootstrap: 1,
    linkedRouteHome: home,
    retainedAcknowledgementProofs: acknowledgedProofs,
  };
}

function walletIdentity(wallet) {
  return wallet.walletId;
}

function registrationHome(registration) {
  return registration.home;
}

function registrationStart(registration) {
  return registration.startedAtMs;
}

function registrationCompletion(registration) {
  return registration.completedAtMs;
}

function matchesWallet(walletId, placement) {
  return placement.wallet_id === walletId;
}

function isSuccessfulForward(path, request) {
  return request.path === path && request.forwarded === true && request.status === 200;
}

function isRecoveryFinalizationPath(path) {
  return (
    path === '/wallets/recovery/finalize' || path === '/wallets/recovery/google-email-otp/finalize'
  );
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

async function verifyCeremonyOwnership(database, walletId, isHome, api) {
  const { results: records } = await database
    .prepare('SELECT record_scope, record_id, record_json FROM registration_ceremony_records')
    .all();
  if (!isHome) assert.equal(records.length, 0, 'Remote home must contain no ceremony state');
  else assert.ok(records.length > 0, 'Lifecycle must retain registration ownership evidence');
  const counts = {};
  for (const row of records) {
    if (row.record_scope !== 'email-otp-registration-verification-v1') {
      assert.ok(row.record_id.startsWith('gateway-registration:'));
    }
    const record = JSON.parse(row.record_json);
    let owner;
    switch (row.record_scope) {
      case 'email-otp-registration-verification-v1': {
        const receipt = api.parseEmailOtpRegistrationVerificationReceiptV1(record);
        assert.ok(receipt, 'Verification receipt must satisfy its production parser');
        assert.equal(row.record_id, receipt.verified.challengeId);
        owner = receipt.verified.walletId;
        const consumed = await database
          .prepare('SELECT count(*) AS count FROM email_otp_challenges WHERE challenge_id = ?')
          .bind(row.record_id)
          .first();
        assert.equal(consumed.count, 0, 'Receipt must survive challenge consumption');
        break;
      }
      case 'setup-ceremony':
      case 'ceremony':
      case 'add-signer-intent':
      case 'add-auth-method-intent':
      case 'add-signer':
      case 'add-auth-method':
        owner = record.intent.walletId;
        break;
      case 'add-signer-finalize-replay':
      case 'add-signer-finalize-claim':
      case 'add-auth-method-finalize-replay':
        owner = record.response.walletId;
        break;
      default:
        assert.fail(`Unaccounted ceremony scope: ${row.record_scope}`);
    }
    assert.equal(owner, walletId, `Wrong ceremony owner in ${row.record_scope}`);
    counts[row.record_scope] = (counts[row.record_scope] ?? 0) + 1;
  }
  return counts;
}

async function verifyEmailOtpOwnership(database, walletId, isHome) {
  const counts = {};
  for (const table of [
    'email_otp_challenges',
    'email_otp_grants',
    'email_otp_unlock_challenges',
    'email_otp_auth_states',
    'email_otp_wallet_enrollments',
  ]) {
    const { results } = await database.prepare(`SELECT wallet_id, record_json FROM ${table}`).all();
    if (!isHome) assert.equal(results.length, 0, `Remote home contains ${table}`);
    for (const row of results) {
      assert.equal(row.wallet_id, walletId, `Wrong wallet in ${table}`);
      assert.equal(JSON.parse(row.record_json).walletId, row.wallet_id);
    }
    counts[table] = results.length;
  }
  if (isHome) assert.equal(counts.email_otp_wallet_enrollments, 1);
  return counts;
}

async function verifyYaoOwnership(gateway, walletId, isHome) {
  const { results } = await gateway.database
    .prepare(
      "SELECT record_key, record_json FROM router_ab_yao_versioned_json_records WHERE substr(record_key, 1, length('router-ab-yao:')) = 'router-ab-yao:'",
    )
    .all();
  if (!isHome) assert.equal(results.length, 0, 'Remote home contains Yao lifecycle state');
  const counts = {
    records: results.length,
    capabilities: 0,
    recoverySessions: 0,
    exportNonces: 0,
    uncertainExports: 0,
    registrationStates: 0,
    registrationClaims: 0,
    registrationAuthorities: 0,
    recoveryStates: 0,
    exportStates: 0,
  };
  for (const row of results) {
    const record = gateway.api.parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(
      JSON.parse(row.record_json),
    );
    assert.ok(record, 'Yao record must satisfy its production codec');
    const state = record.value;
    switch (record.kind) {
      case 'router_ab_ed25519_yao_product_registration_shared_record_v1':
        assert.equal(row.record_key, 'router-ab-yao:router-ab-ed25519-yao:shared');
        for (const capability of state.recoveryCapabilities.values()) {
          assert.equal(capability.identity.applicationBinding.wallet_id, walletId);
          assert.equal(capability.identity.activationBinding.lifecycle.account_id, walletId);
          counts.capabilities += 1;
        }
        for (const [identity, capabilityKey] of state.recoveryIdentityCapabilities) {
          assert.equal(JSON.parse(identity).accountId, walletId);
          assert.ok(state.recoveryCapabilities.has(capabilityKey));
        }
        for (const requestJson of state.recoverySessions.values()) {
          const request = gateway.api.parseRouterAbEd25519YaoRecoveryAdmissionRequestV1(
            JSON.parse(requestJson),
          );
          assert.ok(request.ok, 'Recovery replay key must decode as its admission request');
          assert.equal(request.value.scope.account_id, walletId);
          counts.recoverySessions += 1;
        }
        for (const owner of state.exportAuthorizationNonceOwners.values()) {
          assert.equal(owner, walletId);
          counts.exportNonces += 1;
        }
        for (const owner of state.exportAuthorizationUncertainOwners.values()) {
          assert.equal(owner, walletId);
          counts.uncertainExports += 1;
        }
        break;
      case 'router_ab_ed25519_yao_product_registration_ceremony_record_v1':
        assert.equal(row.record_key, `router-ab-yao:${record.lifecycleId}`);
        for (const entry of state.registration.states.values()) {
          assert.equal(entry.admissionRequest.scope.account_id, walletId);
          counts.registrationStates += 1;
        }
        for (const claim of state.registration.admissionClaims.values()) {
          const request = gateway.api.parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(
            JSON.parse(claim.admissionFingerprint),
          );
          assert.ok(request.ok, 'Pending admission fingerprint must retain its request');
          assert.equal(request.value.scope.account_id, walletId);
          counts.registrationClaims += 1;
        }
        for (const authority of state.authorization.authorities) {
          assert.equal(authority.admissionRequest.scope.account_id, walletId);
          counts.registrationAuthorities += 1;
        }
        for (const entry of state.recovery.recoveries.values()) {
          assert.equal(entry.context.admissionRequest.scope.account_id, walletId);
          counts.recoveryStates += 1;
        }
        for (const entry of state.export.exports.values()) {
          assert.equal(entry.request.scope.account_id, walletId);
          counts.exportStates += 1;
        }
        break;
      default:
        assert.fail(`Unaccounted Yao partition: ${record.kind}`);
    }
  }
  if (isHome) {
    assert.ok(counts.registrationStates > 0, 'Expected retained Yao registration state');
    counts.rejectedRootContaminationCases = verifyYaoRootIsolation(gateway.api, results);
  }
  return counts;
}

function verifyYaoRootIsolation(api, rows) {
  let root;
  let ceremonyRecord;
  let sharedRecord;
  for (const row of rows) {
    const raw = JSON.parse(row.record_json);
    if (raw.recordKind === 'router_ab_ed25519_yao_product_registration_shared_record_v1') {
      sharedRecord = raw;
      continue;
    }
    const state = api.parseRouterAbEd25519YaoProductRegistrationStateJsonV1(raw.state);
    assert.ok(state);
    if (state.registration.dispatchRoots.size > 0) {
      root = state.registration.dispatchRoots.values().next().value;
      ceremonyRecord = raw;
    }
  }
  assert.ok(root, 'The admitted tenant-root context must remain persisted');
  assert.ok(ceremonyRecord);
  assert.ok(sharedRecord);
  for (const raw of [ceremonyRecord, sharedRecord]) {
    const state = api.parseRouterAbEd25519YaoProductRegistrationStateJsonV1(raw.state);
    assert.ok(state);
    state.registration.dispatchRoots.set('unrelated-lifecycle', root);
    raw.state = api.encodeRouterAbEd25519YaoProductRegistrationStateV1(state);
    assert.equal(
      api.parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(raw),
      null,
      'A partition must reject misplaced dispatch-root context',
    );
  }
  return 2;
}

async function verifyOperationOwnership(gateway, scope, walletId, isHome) {
  const { database, api } = gateway;
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: {
      namespace: scope.namespace,
      orgId: scope.organizationId,
      projectId: scope.projectId,
      envId: scope.environmentId,
    },
  });
  const { results: operations } = await database
    .prepare(
      `
    SELECT operation.authorization_source_kind, authority.provenance_kind,
      authority.wallet_id AS authority_wallet_id,
      operation.tenant_id, operation.authorized_operation_id,
      session.wallet_id AS session_wallet_id, evidence.wallet_id AS evidence_wallet_id,
      audit.authorized_operation_id AS audit_operation_id
    FROM authorized_operations operation
    LEFT JOIN wallet_session_authorizations_v2 session
      ON operation.authorization_source_kind = 'authorization_grant'
      AND session.namespace = operation.namespace AND session.tenant_id = operation.tenant_id
      AND session.authorization_id = operation.authorization_id
      AND session.org_id = operation.owner_scope_org_id
      AND session.project_id = operation.owner_scope_project_id
      AND session.env_id = operation.owner_scope_env_id
    LEFT JOIN wallet_authorities authority
      ON authority.namespace = session.namespace AND authority.org_id = session.org_id
      AND authority.project_id = session.project_id AND authority.env_id = session.env_id
      AND authority.authority_id = session.authority_id
      AND authority.wallet_id = session.wallet_id
    LEFT JOIN verified_wallet_operation_evidence_sets evidence
      ON operation.authorization_source_kind = 'verified_step_up'
      AND evidence.namespace = operation.namespace AND evidence.tenant_id = operation.tenant_id
      AND evidence.evidence_set_digest = operation.evidence_set_digest
    LEFT JOIN authorized_operation_audit_events audit
      ON audit.namespace = operation.namespace AND audit.tenant_id = operation.tenant_id
      AND audit.authorized_operation_id = operation.authorized_operation_id
  `,
    )
    .all();
  const counts = {};
  assert.equal(
    operations.length > 0,
    isHome,
    'Signing operations must exist only at the wallet home',
  );
  for (const operation of operations) {
    const owner =
      operation.authorization_source_kind === 'authorization_grant'
        ? operation.session_wallet_id
        : operation.evidence_wallet_id;
    assert.equal(owner, walletId, 'Operation must retain an exact wallet owner after recovery');
    if (operation.authorization_source_kind === 'authorization_grant') {
      assert.equal(operation.authority_wallet_id, walletId);
      if (operation.provenance_kind === 'device_link') counts.linked = (counts.linked ?? 0) + 1;
    }
    assert.ok(operation.audit_operation_id, 'Operation must retain its audit record');
    const committed = await store.readAuthorizedOperationById({
      tenantId: operation.tenant_id,
      authorizedOperationId: operation.authorized_operation_id,
    });
    assert.ok(committed);
    await store.readPinnedOwnerWalletScope({ operation: committed, walletId });
    await assert.rejects(
      store.readPinnedOwnerWalletScope({ operation: committed, walletId: randomUUID() }),
      /scope is unavailable|step-up operation is not claimed/,
      'A committed operation must reject a different wallet owner',
    );
    counts[operation.authorization_source_kind] =
      (counts[operation.authorization_source_kind] ?? 0) + 1;
  }
  return counts;
}

function gatewayRequests(gateway) {
  return gateway.requests.map(requestWithRegion.bind(null, gateway.region));
}

function isSuccessfulPrepare(signingPath, request) {
  return !request.forwarded && request.path === `${signingPath}/prepare` && request.status === 200;
}
function isSuccessfulFinalize(signingPath, request) {
  return !request.forwarded && request.path === signingPath && request.status === 200;
}
function isSuccessfulRefill(request) {
  return request.path === '/router-ab/ecdsa-derivation/presignature-pool/fill/step' && request.status === 200;
}

function requestWithRegion(region, request) {
  return { ...request, region };
}
