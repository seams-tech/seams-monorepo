import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

const root = resolve(import.meta.dirname, '../..');
const wallet = resolve(root, '../seams-wallet');
const output = resolve(root, '.artifacts/r155b/local-session-routing');
await mkdir(output, { recursive: true });
const { seedExecutionGeneration } = await import(
  pathToFileURL(resolve(wallet, 'tests/e2e/execution-generation.scenario.mjs'))
);
const bundle = await build({
  absWorkingDir: wallet,
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  tsconfig: resolve(wallet, 'packages/wallet-server/tsconfig.json'),
  loader: { '.wasm': 'binary' },
  alias: { '@': resolve(wallet, 'packages/wallet/src') },
  stdin: {
    resolveDir: wallet,
    contents: `
    export { findLocalSessionWallet } from '${root}/packages/wallet-console-server-ts/src/walletPlacement/localSessionRouting';
    export { resolveGatewayDeployment } from '${root}/packages/wallet-console-server-ts/src/walletPlacement/gatewaySession';
    export { WalletRegionalDispatch, resolveLocalRegistrationContinuation } from '${root}/packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
    export { WalletOwnershipKey } from '${root}/packages/wallet-console-server-ts/src/walletPlacement/home';
    export { SessionLocator } from '${root}/packages/wallet-console-server-ts/src/walletPlacement/sessionLocators';
    export { fourRegionBinding } from '${root}/tests/helpers/tenantDeploymentFixtures';
    export { lifecycleWriteFenceStatements } from './packages/wallet-server/src/router/cloudflare/d1/ed25519Yao/d1Ed25519YaoStateWriteFence';
    export { D1WalletExecutionAuthority } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
    export { withCors } from './packages/wallet-server/src/router/framework/http';
    export { buildPMRedeemHostedWalletSeamsSessionPayload, parsePMRedeemHostedWalletSeamsSessionPayload } from './packages/wallet/src/SeamsWeb/walletIframe/shared/messages';
    export { projectActiveWalletSession } from './packages/wallet-server/src/authorization/domain';
    export { toStoredExactWalletSessionAuthorizationRowV6, parseStoredExactWalletSessionAuthorizationRowV6 } from './packages/wallet/src/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
    export { buildWalletSessionAuthorizationHeaders } from './packages/wallet/src/core/rpcClients/relayer/relayerHttp';
    export { AuthorizationService } from './packages/wallet-server/src/authorization/service';
    export { capabilityPolicyPort } from './packages/wallet-server/src/authorization/capabilityPolicy';
    export { parseSessionOrigin } from './packages/wallet-server/src/authorization/domain';
    export { CloudflareD1AuthorizationStore } from './packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
    export { prepareD1WalletAuthorityPutStatement } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
    export { prepareD1WalletAuthMethodV2PutStatement } from './packages/wallet-server/src/core/d1WalletAuthMethodStore';
    export { buildLinkedDeviceManagementAuthorityFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
    export { buildFullOwnerPermissionsV1 } from './packages/shared-ts/src/authorization/delegatedAuthority';
  `,
  },
});
const bundleFile = resolve(output, 'production.mjs');
await writeFile(bundleFile, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundleFile));
const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response(); } };',
  compatibilityDate: '2026-04-17',
  d1Databases: { SIGNER_DB: 'local-session-routing' },
});
class UnavailableConsole {
  calls = 0;
  async fetch() {
    this.calls += 1;
    return new Response(null, { status: 503 });
  }
}
class UnavailableRegistrationAuthority {
  calls = 0;
  async admitHome() {
    this.calls += 1;
    throw new Error('Registration directory unavailable');
  }
}

class UncertainRegistrationCompletion {
  calls = 0;
  loseReply = true;
  async admitHome() {
    return { ok: true, purpose: 'registration', ownershipGeneration: 1 };
  }
  async complete() {
    this.calls += 1;
    if (this.loseReply) throw new Error('Registration completion reply lost');
    return { ok: true };
  }
}

async function verifyRegistrationTerminalDecision(database, scope, fixture, outcome) {
  const walletId = fixture.authority.walletId;
  const directory = new UncertainRegistrationCompletion();
  const authority = new api.D1WalletExecutionAuthority(database, scope, directory);
  const identity = { walletId, ceremonyId: `wrc_${digest(outcome)}` };
  assert.equal((await authority.admitHome(identity)).ok, true);
  const tenant = {
    namespace: scope.namespace,
    organizationId: scope.orgId,
    projectId: scope.projectId,
    environmentId: scope.envId,
  };
  const request = new Request('https://gateway.test/wallets/register/respond', {
    method: 'POST',
    body: JSON.stringify({ registrationCeremonyId: identity.ceremonyId }),
  });
  const routing = { request, database, tenant, session: { kind: 'absent' } };
  assert.deepEqual(await api.resolveLocalRegistrationContinuation(routing), { kind: 'local' });
  assert.deepEqual(
    await api.resolveLocalRegistrationContinuation({
      ...routing,
      tenant: { ...tenant, namespace: `${tenant.namespace}-wrong` },
    }),
    { kind: 'absent' },
  );
  const mismatch = await api.resolveLocalRegistrationContinuation({
    ...routing,
    session: { kind: 'local', wallet: api.WalletOwnershipKey.parse({ ...tenant, walletId: 'wallet:wrong' }) },
  });
  assert.equal(mismatch.kind, 'rejected');
  assert.equal(mismatch.response.status, 403);

  const insertCeremony = database.prepare(
    `INSERT INTO registration_ceremony_records
      (namespace, org_id, project_id, env_id, record_scope, record_id, version, record_json, expires_at_ms)
     SELECT namespace, org_id, project_id, env_id, 'ceremony', origin_id, 1,
       json_object('registrationCeremonyId', origin_id), ?6
     FROM wallet_execution_generations
     WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5`,
  ).bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId, Date.now() + 60_000);
  await insertCeremony.run();
  await assert.rejects(authority.complete({ ...identity, outcome }), /reply lost/u);
  if (outcome === 'cancelled') {
    await assert.rejects(database.prepare(
      `UPDATE registration_ceremony_records SET version = version + 1
       WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND record_id = ?5`,
    ).bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, identity.ceremonyId).run(), /registration_cancelled/u);
    await database.prepare(
      `DELETE FROM registration_ceremony_records
       WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND record_id = ?5`,
    ).bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, identity.ceremonyId).run();
    await assert.rejects(insertCeremony.run(), /registration_cancelled/u);
    await assert.rejects(database.batch(api.lifecycleWriteFenceStatements(
      { database, scope }, new Set([walletId]),
    )), /cas_guard/u);
    await verifyCancelledSessionPublication(database, scope, fixture);

  }

  const row = await database
    .prepare(
      `SELECT state, registration_completion FROM wallet_execution_generations
     WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ? AND wallet_id = ?`,
    )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId)
    .first();
  assert.equal(row.registration_completion, outcome);
  assert.equal(row.state, outcome === 'cancelled' ? 'retired' : 'registering');
  assert.equal((await authority.admitEstablishedHome({ walletId })).ok, false);
  const conflict = outcome === 'cancelled' ? 'established' : 'cancelled';
  await assert.rejects(authority.complete({ ...identity, outcome: conflict }));
  assert.equal(directory.calls, 1);
  directory.loseReply = false;
  assert.deepEqual(await authority.complete({ ...identity, outcome }), { ok: true });
  assert.equal(directory.calls, 2);
  assert.equal((await authority.admitEstablishedHome({ walletId })).ok, outcome === 'established');
}

async function verifyCancelledSessionPublication(database, scope, fixture) {
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const service = new api.AuthorizationService({
    policy: api.capabilityPolicyPort,
    sessions: store,
    grants: store,
    evidence: store,
    authorizedOperations: store,
    audit: {},
  });
  await assert.rejects(service.issueDirectWalletSessionAuthorizationV2({
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId: fixture.authority.walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: fixture.issuedSession.session.mintId,
    remainingUses: 3,
    issuedAtMs: Date.now(),
    expiresAtMs: fixture.issuedSession.session.expiresAtMs,
  }), /registration_cancelled/u);
  const row = await database.prepare(
    `SELECT COUNT(*) AS count FROM wallet_session_authorizations_v2
     WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ? AND wallet_id = ?`,
  ).bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, fixture.authority.walletId).first();
  assert.equal(row.count, 0);
}

class RegionalSessionPublication {
  home() {
    return { kind: 'regional', region: 'US' };
  }
  async publish() {}
}

class RegionalDestination {
  calls = 0;
  constructor(routing) {
    this.routing = routing;
  }
  async fetch(request) {
    this.calls += 1;
    assert.equal(request.headers.get('x-seams-wallet-forwarded'), '1');
    assert.equal(request.headers.has('x-seams-wallet-region'), false);
    const result = await api.resolveGatewayDeployment({ ...this.routing, request });
    assert.equal(result.kind, 'ready');
    assert.equal(result.session.kind, 'local');
    return Response.json({ walletId: result.session.wallet.walletId });
  }
}
function digest(value) {
  return createHash('sha256').update(value).digest('base64url');
}
try {
  const database = await runtime.getD1Database('SIGNER_DB');
  const directory = resolve(wallet, 'packages/wallet-server/migrations/d1-signer');
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    for (const sql of unstable_splitSqlQuery(await readFile(resolve(directory, name), 'utf8'))) {
      await database.prepare(sql).run();
    }
  }
  const binding = await api.fourRegionBinding(Date.now(), 'session-routing');
  const tenant = binding.tenant;
  const scope = {
    namespace: tenant.namespace,
    orgId: tenant.organizationId,
    projectId: tenant.projectId,
    envId: tenant.environmentId,
  };
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'local-route',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    keyFamily: 'ecdsa_secp256k1',
    tenantId: scope.orgId,
    expiresAtMs: Date.now() + 3_600_000,
  });
  for (const outcome of ['established', 'cancelled']) {
    const terminalFixture = await api.buildLinkedDeviceManagementAuthorityFixture({
      label: `terminal-${outcome}`,
      permissions: api.buildFullOwnerPermissionsV1(),
      provenance: 'wallet_registration',
      keyFamily: 'ecdsa_secp256k1',
      tenantId: scope.orgId,
      expiresAtMs: Date.now() + 3_600_000,
    });
    await verifyRegistrationTerminalDecision(
      database,
      { ...scope, namespace: `${scope.namespace}-${outcome}` },
      terminalFixture,
      outcome,
    );
  }
  await seedExecutionGeneration({ api, database, scope, walletId: fixture.authority.walletId });
  const registrationDirectory = new UnavailableRegistrationAuthority();
  const localRegistration = new api.D1WalletExecutionAuthority(database, scope, registrationDirectory);
  assert.deepEqual(await localRegistration.admitHome({
    walletId: fixture.authority.walletId,
    ceremonyId: 'fixture-execution-registration',
  }), { ok: true, purpose: 'ordinary', ownershipGeneration: 1 });
  assert.equal(registrationDirectory.calls, 0);
  await assert.rejects(localRegistration.admitHome({
    walletId: fixture.authority.walletId,
    ceremonyId: 'different-registration',
  }), /Registration directory unavailable/u);
  assert.equal(registrationDirectory.calls, 1);
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const service = new api.AuthorizationService({
    sessionRouting: new RegionalSessionPublication(),
    policy: api.capabilityPolicyPort,
    sessions: store,
    grants: store,
    evidence: store,
    authorizedOperations: store,
    audit: {},
  });
  const nowMs = Date.now();
  const issued = await service.issueDirectWalletSessionAuthorizationV2({
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId: fixture.authority.walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: fixture.issuedSession.session.mintId,
    remainingUses: 3,
    issuedAtMs: nowMs,
    expiresAtMs: fixture.issuedSession.session.expiresAtMs,
  });
  assert.equal(issued.kind, 'issued');
  assert.deepEqual(issued.operationCredential.home, { kind: 'regional', region: 'US' });
  const stored = api.toStoredExactWalletSessionAuthorizationRowV6(
    api.projectActiveWalletSession(issued), issued.operationCredential,
  );
  const restored = api.parseStoredExactWalletSessionAuthorizationRowV6(JSON.parse(JSON.stringify(stored)));
  assert.ok(restored);
  assert.deepEqual(restored.operationCredential.home, issued.operationCredential.home);
  assert.equal(api.buildWalletSessionAuthorizationHeaders(restored.operationCredential)['X-Seams-Wallet-Region'], 'US');
  const consoleService = new UnavailableConsole();
  const routing = {
    database,
    binding,
    writer: { role: 'gateway', versionId: crypto.randomUUID(), resource: binding.resources[0] },
    deploymentLane: binding.deploymentLane,
    service: consoleService,
    catalogJson: JSON.stringify(
      binding.resources.map((resource, index) => ({
        ...resource,
        region: ['US', 'WEUR', 'APAC', 'OC'][index],
      })),
    ),
    timingHeaders: new Headers(),
  };
  const request = new Request('https://gateway.test/router-ab/ecdsa-derivation/sign/prepare', {
    method: 'POST',
    headers: { Authorization: `Bearer ${issued.operationCredential.token}` },
  });
  assert.equal((await api.resolveGatewayDeployment({ ...routing, request })).session.kind, 'local');
  const credential = {
    tenantId: issued.session.tenantId,
    token: issued.operationCredential.token,
    nowMs: nowMs + 1,
  };
  const admitted =
    await service.readWalletSessionAdmissionSnapshotByOperationCredential(credential);
  assert.equal(admitted.kind, 'active');
  assert.equal(admitted.authorization.quota.remainingUses, 3);
  const appOrigin = api.parseSessionOrigin('https://app.test');
  const walletOrigin = api.parseSessionOrigin('https://wallet.test');
  const exchange = await service.mintHostedWalletSeamsSessionExchange({
    authorization: issued,
    appOrigin,
    walletOrigin,
    issuedAtMs: nowMs,
    expiresAtMs: issued.session.expiresAtMs,
  });
  assert.deepEqual(exchange.home, issued.operationCredential.home);
  const exchangePayload = api.buildPMRedeemHostedWalletSeamsSessionPayload({
    home: exchange.home,
    exchangeCode: exchange.exchangeCode,
    nonce: exchange.nonce,
    appOrigin: exchange.appOrigin,
    walletOrigin: exchange.walletOrigin,
    relayUrl: 'https://gateway.test',
  });
  assert.deepEqual(
    api.parsePMRedeemHostedWalletSeamsSessionPayload(JSON.parse(JSON.stringify(exchangePayload))).home,
    issued.operationCredential.home,
  );
  assert.equal(
    (
      await api.findLocalSessionWallet(
        database,
        tenant,
        api.SessionLocator.exchange(digest(exchange.exchangeCode)),
      )
    ).walletId,
    issued.session.walletId,
  );
  const hosted = await service.redeemHostedWalletSeamsSessionExchange({
    exchangeCode: exchange.exchangeCode,
    nonce: exchange.nonce,
    appOrigin,
    walletOrigin,
    redeemedAtMs: nowMs + 1,
  });
  assert.equal(hosted.kind, 'redeemed');
  assert.deepEqual(hosted.operationCredential.home, issued.operationCredential.home);
  assert.equal(
    (
      await api.findLocalSessionWallet(
        database,
        tenant,
        api.SessionLocator.credential(digest(hosted.operationCredential.token)),
      )
    ).walletId,
    issued.session.walletId,
  );
  assert.equal(
    await api.findLocalSessionWallet(
      database,
      { ...tenant, environmentId: 'other' },
      api.SessionLocator.credential(digest(issued.operationCredential.token)),
    ),
    null,
  );
  await service.retireWalletSessionAuthorizationsForAuthMethod({
    tenantId: issued.session.tenantId,
    walletId: issued.session.walletId,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    nowMs: nowMs + 2,
  });
  assert.equal((await api.resolveGatewayDeployment({ ...routing, request })).session.kind, 'local');
  await assert.rejects(
    service.readWalletSessionAdmissionSnapshotByOperationCredential({
      ...credential,
      nowMs: nowMs + 3,
    }),
    /retired/u,
  );
  assert.equal(consoleService.calls, 0);
  const unknown = new Request(request, {
    headers: { Authorization: `Bearer wst_${'B'.repeat(43)}` },
  });
  assert.equal(
    (await api.resolveGatewayDeployment({ ...routing, request: unknown })).kind,
    'rejected',
  );
  assert.equal(consoleService.calls, 1);
  const hinted = new Request(request, {
    headers: {
      Authorization: `Bearer ${issued.operationCredential.token}`,
      'x-seams-wallet-region': 'WEUR',
    },
  });
  const travel = await api.resolveGatewayDeployment({ ...routing, request: hinted });
  assert.equal(travel.kind, 'forward');
  assert.equal(travel.home.region, 'WEUR');
  const continuation = new Request('https://gateway.test/wallets/register/activate', {
    method: 'POST', headers: { 'X-Seams-Wallet-Region': 'WEUR' },
  });
  assert.equal((await api.resolveGatewayDeployment({ ...routing, request: continuation })).kind, 'forward');
  const destination = new RegionalDestination(routing);
  const transport = new api.WalletRegionalDispatch({
    WALLET_GATEWAY_US: destination,
    WALLET_GATEWAY_WEUR: destination,
    WALLET_GATEWAY_APAC: destination,
    WALLET_GATEWAY_OC: destination,
  });
  const forwarded = await transport.forward(travel.home, hinted);
  assert.equal(forwarded.status, 200);
  assert.equal((await forwarded.json()).walletId, issued.session.walletId);
  assert.equal(destination.calls, 1);
  const loop = new Request(hinted, {
    headers: {
      ...Object.fromEntries(hinted.headers),
      'x-seams-wallet-forwarded': '1',
    },
  });
  assert.equal(
    (await api.resolveGatewayDeployment({ ...routing, request: loop })).response.status,
    409,
  );
  const missingAtHome = new Request(unknown, {
    headers: {
      ...Object.fromEntries(unknown.headers),
      'x-seams-wallet-region': 'US',
    },
  });
  const missing = await api.resolveGatewayDeployment({ ...routing, request: missingAtHome });
  assert.equal(missing.response.status, 409);
  assert.equal((await missing.response.json()).code, 'wallet_home_discovery_required');
  const invalidHint = new Request(request, {
    headers: {
      ...Object.fromEntries(request.headers),
      'x-seams-wallet-region': 'https://untrusted.test',
    },
  });
  assert.equal(
    (await api.resolveGatewayDeployment({ ...routing, request: invalidHint })).response.status,
    400,
  );
  assert.equal(consoleService.calls, 1);
  const corsHeaders = new Headers({ 'X-Seams-Wallet-Region': 'US' });
  api.withCors(corsHeaders, { corsOrigins: ['https://app.test'] }, new Request(request, {
    method: 'OPTIONS', headers: { Origin: 'https://app.test' },
  }));
  assert.ok(corsHeaders.get('Access-Control-Allow-Headers').includes('X-Seams-Wallet-Region'));
  assert.ok(corsHeaders.get('Access-Control-Expose-Headers').includes('X-Seams-Wallet-Region'));
  const evidence = {
    kind: 'local_session_routing_evidence_v1',
    productionBundleSha256: createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'),
    localCredentialConsoleCalls: 0,
    directAndHostedCredentialsFound: true,
    exchangeFound: true,
    wrongTenantRejected: true,
    retiredCredentialStillHandledLocally: true,
    retiredCredentialAuthorizationRejected: true,
    quotaPreserved: 3,
    unknownCredentialDiscoveryCalls: 1,
    hintedTravelConsoleCalls: 0,
    forwardingLoopRejected: true,
    destinationHandlesForwardedCredentialLocally: true,
    missingHintedCredentialRequiresExplicitDiscovery: true,
    arbitraryRoutingTargetRejected: true,
    browserRoutingMetadataAllowedAndExposed: true,
    issuedAndHostedCredentialsRetainRegionalHome: true,
    restoredSdkCredentialEmitsRegionalHint: true,
    exchangeIframePayloadRetainsHome: true,
    completedRegistrationAdmissionUsesLocalState: true,
    registrationTerminalDecisionSurvivesLostReply: true,
    localRegistrationContinuationRouting: true,
    cancelledRegistrationRejectsLateWritesAndRecreation: true,
    cancelledRegistrationRejectsLifecycleWritesAndSessionPublication: true,
    conflictingRegistrationCompletionRejectedBeforeConsole: true,
    sessionlessContinuationHintUsesBoundedForwarding: true,
  };
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Local session routing passed: ${resolve(output, 'evidence.json')}`);
} finally {
  await runtime.dispose();
}
