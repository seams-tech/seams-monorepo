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
  stdin: {
    resolveDir: wallet,
    contents: `
    export { findLocalSessionWallet } from '${root}/packages/wallet-console-server-ts/src/walletPlacement/localSessionRouting';
    export { resolveGatewayDeployment } from '${root}/packages/wallet-console-server-ts/src/walletPlacement/gatewaySession';
    export { SessionLocator } from '${root}/packages/wallet-console-server-ts/src/walletPlacement/sessionLocators';
    export { fourRegionBinding } from '${root}/tests/helpers/tenantDeploymentFixtures';
    export { D1WalletExecutionAuthority } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
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
  await seedExecutionGeneration({ api, database, scope, walletId: fixture.authority.walletId });
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
  const consoleService = new UnavailableConsole();
  const routing = {
    database,
    binding,
    writer: { role: 'gateway', versionId: crypto.randomUUID(), resource: binding.resources[0] },
    deploymentLane: binding.deploymentLane,
    service: consoleService,
    catalogJson: '{}',
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
  };
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Local session routing passed: ${resolve(output, 'evidence.json')}`);
} finally {
  await runtime.dispose();
}
