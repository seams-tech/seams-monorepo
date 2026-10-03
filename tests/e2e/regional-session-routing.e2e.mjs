import { verifyRegionalLinkHttp } from './regional-link-http.scenario.mjs';
import { verifyRegionalLinkHomes } from './regional-link-home.scenario.mjs';
import { verifyRegionalDeviceProofs } from './regional-device-proof.scenario.mjs';
import { verifyRegionalPasskeyClaims } from './regional-passkey-claims.scenario.mjs';
import { verifyRegionalRateLimits } from './regional-rate-limits.scenario.mjs';
import { verifyRegionalSharedIdentity } from './regional-shared-identity.scenario.mjs';
import { verifyRegionalGoogleLogin } from './regional-google-login.scenario.mjs';
import {
  verifyRegionalAuthenticationRouting,
  verifyRevokedDiscovery,
} from './regional-authentication-routing.scenario.mjs';
import { verifyRegionalLifecycleRouting } from './regional-lifecycle-routing.scenario.mjs';
import { verifyRegionalRecoveryRouting } from './regional-recovery-routing.scenario.mjs';
import { verifyRegionalYaoEntryRouting } from './regional-yao-entry-routing.scenario.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

class WorkerTransport {
  constructor(worker) {
    this.worker = worker;
  }
  async fetch(request) {
    return this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      redirect: 'manual',
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
    });
  }
}

async function nativeRequest(request) {
  return new Request(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    redirect: 'manual',
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer(),
  });
}

class ConsoleBridge {
  constructor(tenantScope) {
    this.tenantScope = tenantScope;
  }
  database = null;
  available = true;
  dropNextNonceReply = false;
  dropNextBootstrapClaimReply = false;
  async fetch(request) {
    if (!this.available) return new Response(null, { status: 503 });
    const writer = api.parseTenantRuntimeWriterV1(
      request.headers.get('x-seams-writer-role'),
      request.headers.get('x-seams-writer-version'),
      {
        accountId: request.headers.get('x-seams-writer-account'),
        databaseId: request.headers.get('x-seams-writer-database'),
      },
    );
    const dropBootstrapReply =
      this.dropNextBootstrapClaimReply &&
      new URL(request.url).pathname.endsWith('/device-bootstrap') &&
      (await request.clone().json()).operation === 'claim';
    const response = await api.handleWalletHomeServiceRequest(request, {
      database: this.database,
      catalogJson,
      admittedResources: catalog.deploymentResources(),
      scope: this.tenantScope,
      deploymentLane: 'test',
      writer,
    });
    if (this.dropNextNonceReply && new URL(request.url).pathname.endsWith('/device-proof-nonce')) {
      this.dropNextNonceReply = false;
      return new Response(null, { status: 503 });
    }
    if (dropBootstrapReply) {
      this.dropNextBootstrapClaimReply = false;
      return new Response(null, { status: 503 });
    }
    return response;
  }
}
class GatewayBridge {
  constructor(region) {
    this.region = region;
  }
  ingress(request) {
    return this.handle(request, 'ingress');
  }
  home(request) {
    return this.handle(request, 'home');
  }
  async handle(request, entry) {
    request = await nativeRequest(request);
    const response = await api.dispatchKnownWalletHome(
      request,
      this.authority,
      new api.WalletRegionalDispatch(this.bindings, entry),
      'regional-google-test',
    );
    if (response) return response;
    const pathname = new URL(request.url).pathname;
    if (this.linkRoutes && pathname.startsWith('/wallet/device-linking/')) {
      const response = await api.handleDeviceLinking({
        method: request.method,
        pathname,
        request,
        service: { deviceLinking: this.linkRoutes },
      });
      response.headers.set('x-test-region', this.region);
      return response;
    }
    if (
      pathname.startsWith('/wallet/device-linking/v1/sessions/') ||
      pathname.startsWith('/router-ab/ed25519/yao/')
    ) {
      return Response.json(
        { region: this.region, code: 'fixture_protocol_execution_disabled' },
        { status: 422 },
      );
    }
    if (pathname === '/auth/google/verify') return this.google.handle(request);
    if (
      pathname.startsWith('/sync-account/') ||
      pathname.startsWith('/auth/') ||
      pathname.startsWith('/wallet/unlock/') ||
      pathname.startsWith('/wallet/email-otp/')
    )
      return this.passkey.handle(request);
    if (pathname.startsWith('/wallets/recovery/')) return this.recovery.handle(request);
    if (pathname === '/wallet/session/exchange/redeem') {
      const body = await request.json();
      const result = await this.service.redeemHostedWalletSeamsSessionExchange({
        exchangeCode: body.exchangeCode,
        nonce: body.nonce,
        appOrigin: body.appOrigin,
        walletOrigin: body.walletOrigin,
        redeemedAtMs: Date.now(),
      });
      return Response.json({ region: this.region, result });
    }
    const token = request.headers.get('authorization').slice(7);
    try {
      const active = token.startsWith('wsh_')
        ? await this.service.readHostedWalletSessionOperationCredentialV2({
            tenantId: this.tenantId,
            token,
            requestOrigin: api.parseSessionOrigin('https://wallet.test'),
            nowMs: Date.now(),
          })
        : await this.service.readWalletSessionAdmissionSnapshotByOperationCredential({
            tenantId: this.tenantId,
            token,
            nowMs: Date.now(),
          });
      return Response.json(
        { region: this.region, active: Boolean(active) },
        { status: active ? 200 : 401 },
      );
    } catch {
      return Response.json({ region: this.region, active: false }, { status: 401 });
    }
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = resolve(candidate, '../..');
const output = resolve(
  root,
  process.env.SEAMS_TEST_ARTIFACT_DIR ?? '.artifacts/r152/session-routing-20261003',
);
await mkdir(output, { recursive: true });
const bundle = await build({
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['*.wasm', 'cloudflare:workers'],
  tsconfig: resolve(root, 'packages/wallet-console-server-ts/tsconfig.json'),
  alias: {
    '@shared': resolve(publicRoot, 'packages/shared-ts/src'),
    '@seams/wallet-server/cloud-host': resolve(candidate, 'dist/esm/cloud-host.js'),
  },
  stdin: {
    resolveDir: root,
    loader: 'ts',
    contents: `
      export { createD1IdentityStore, createD1GoogleRegistrationAttempts, createD1EmailOtpRateLimits } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/auth/d1AuthorizationAssembly.ts'))};
      export { parseEmailOtpWalletEnrollmentRow } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/emailOtp/d1EmailOtpRecords.ts'))};
      export { parseGoogleLoginVerifyRequest } from ${JSON.stringify(resolve(candidate, 'src/router/auth/authRequestValidation.ts'))};
      export { prepareD1TenantStatement } from ${JSON.stringify(resolve(candidate, 'src/core/d1TenantStore.ts'))};
      export { verifyGoogleOidcToken } from '@seams/wallet-server/cloud-host';
      export { abandonedGoogleEmailOtpRegistrationAttemptRecord } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/emailOtp/d1GoogleEmailOtpRegistrationRecords.ts'))};
      export { D1IdentityStore } from ${JSON.stringify(resolve(candidate, 'src/core/d1IdentityStore.ts'))};
      export { CloudflareD1EmailOtpEnrollmentStore } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/emailOtp/d1EmailOtpEnrollmentStore.ts'))};
      export { CloudflareD1GoogleEmailOtpRegistrationAttemptStore } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/emailOtp/d1GoogleEmailOtpRegistrationAttemptStore.ts'))};
      export { CloudflareD1GoogleEmailOtpSessionResolver } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/emailOtp/d1GoogleEmailOtpSessionResolver.ts'))};
      export { D1LinkedDeviceSessionStoreV1 } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceSessionStore.ts'))};
      export { LinkedDeviceSessionServiceV1 } from ${JSON.stringify(resolve(candidate, 'src/core/deviceLinking/linkedDeviceSession.ts'))};
      export { WalletRouteLocator } from './packages/wallet-console-server-ts/src/walletPlacement/walletRouteLocators';
      export { createD1LinkedDeviceRouteServiceV1 } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceRouteService.ts'))};
      export { computeLinkedDevicePublicKeyDigestV1, encodeLinkedDeviceRequestProofV1, parseLinkedDeviceRequestProofV1, LINKED_DEVICE_REQUEST_PROOF_HEADER_V1 } from ${JSON.stringify(resolve(candidate, 'src/core/deviceLinking/requestProof.ts'))};
      export { handleDeviceLinking } from ${JSON.stringify(resolve(candidate, 'src/router/transport/fetch/routes/deviceLinking.ts'))};
      export { parseQrLinkedDeviceSessionPayloadV5 } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/device-linking/parsers.ts'))};
      export { handleSyncAccount } from ${JSON.stringify(resolve(candidate, 'src/router/transport/fetch/routes/syncAccount.ts'))};
      export { handleAuth } from ${JSON.stringify(resolve(candidate, 'src/router/transport/fetch/routes/auth.ts'))};
      export { handleWalletUnlockChallengeRoute } from ${JSON.stringify(resolve(candidate, 'src/router/domains/walletUnlock/walletUnlockRouteHandlers.ts'))};
      export { prepareD1WebAuthnCredentialBindingPutStatement } from ${JSON.stringify(resolve(candidate, 'src/core/WebAuthnCredentialBindingStore.ts'))};
      export { buildWalletAuthMethodRecordV2 } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/utils/walletAuthMethodRecord.ts'))};
      export { D1WalletAuthMethodStore } from ${JSON.stringify(resolve(candidate, 'src/core/d1WalletAuthMethodStore.ts'))};
      export { CloudflareD1WebAuthnStore, prepareD1WebAuthnAuthenticatorPutStatement } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/webauthn/d1WebAuthnStore.ts'))};
      export { CloudflareD1WebAuthnAuthService } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/webauthn/d1WebAuthnAuthService.ts'))};
      export { publishWalletLifecycleHome } from ${JSON.stringify(resolve(candidate, 'src/authorization/lifecycleRouting.ts'))};
      export { buildWalletRecoveryEnvelopeSetRecord, parseWalletRecoveryEnvelopeSetRecord, buildWalletRecoveryManifestKekWrap, buildWalletCustodySeedRecoveryEntry } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/wallet-recovery/walletRecoveryEnvelopeSet.ts'))};
      export { buildWalletRecoveryBackupAcknowledgementV1 } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/wallet-recovery/backupAcknowledgement.ts'))};
      export { buildPasskeyCustodyEnvelopeRecord, buildMethodBoundEnvelopeOwnership, buildEmailOtpEnvelopeFactor, buildActiveEnvelopeLifecycle } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/passkey-custody/custodyEnvelope.ts'))};
      export { parsePasskeyCustodySecretBinding } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/passkey-custody/custodySecretBinding.ts'))};
      export { parseEnvelopeNonceB64u, parseEnvelopeCiphertextB64u, parseEnvelopeRevision } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/passkey-custody/primitives.ts'))};
      export { parsePasskeyEnvelopeId } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/utils/domainIds.ts'))};
      export { EMAIL_OTP_RECOVERY_KEY_COUNT } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/utils/emailOtpRecoveryKey.ts'))};
      export { CloudflareD1WalletCustodyCommitStore } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/passkeyCustody/d1WalletCustodyCommitStore.ts'))};
      export { EMAIL_OTP_RECOVERY_KEY_BYTE_LENGTH } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/utils/emailOtpRecoveryKey.ts'))};
      export { deriveRecoveryCodeLocatorV1FromBytes } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/wallet-recovery/recoveryCodeLocator.ts'))};
      export { deriveWalletRecoveryKeyIdFromBytes } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/wallet-recovery/recoveryKeyId.ts'))};
      export { base64UrlDecode, base64UrlEncode } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/utils/encoders.ts'))};
      export { AuthorizationService, digestOpaqueValue } from ${JSON.stringify(resolve(candidate, 'src/authorization/service.ts'))};
      export { capabilityPolicyPort } from ${JSON.stringify(resolve(candidate, 'src/authorization/capabilityPolicy.ts'))};
      export { parseSessionOrigin } from ${JSON.stringify(resolve(candidate, 'src/authorization/domain.ts'))};
      export { CloudflareD1AuthorizationStore } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts'))};
      export { prepareD1WalletAuthorityPutStatement } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/wallet/d1WalletAuthorityStore.ts'))};
      export { prepareD1WalletAuthMethodV2PutStatement } from ${JSON.stringify(resolve(candidate, 'src/core/d1WalletAuthMethodStore.ts'))};
      export { buildLinkedDeviceManagementAuthorityFixture } from ${JSON.stringify(resolve(publicRoot, 'tests/unit/helpers/linkedDeviceManagement.fixtures.ts'))};
      export { buildLinkedDeviceTargetPreparationV1, buildLinkedDeviceApprovalV1, buildWalletSessionLinkedDeviceOwnerAuthorizationV1 } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/device-linking/parsers.ts'))};
      export { buildExactAdministeredSignerManifestV1 } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/device-linking/delegatedActivationPlan.ts'))};
      export { D1LinkedDeviceTargetCredentialProviderV1 } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceTargetCredentialProvider.ts'))};
      export { computeLinkedDevicePasskeyTargetConfigurationDigestV1 } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/device-linking/digests.ts'))};
      export { createD1LinkedDeviceOwnerAuthorizationProviderV1 } from ${JSON.stringify(resolve(candidate, 'src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceOwnerAuthorizationProvider.ts'))};
      export { buildFullOwnerPermissionsV1, buildFullOwnerDelegatedWalletAuthorityV1 } from ${JSON.stringify(resolve(publicRoot, 'packages/shared-ts/src/authorization/delegatedAuthority.ts'))};
      export { WalletHomeCatalog, WalletOwnershipKey, RegistrationSetupAllocation } from './packages/wallet-console-server-ts/src/walletPlacement/home';
      export { D1WalletHomeDirectory } from './packages/wallet-console-server-ts/src/walletPlacement/d1';
      export { handleWalletHomeServiceRequest } from './packages/wallet-console-server-ts/src/walletPlacement/service';
      export { WalletHomeServiceClient } from './packages/wallet-console-server-ts/src/walletPlacement/serviceClient';
      export { ConsoleRegistrationHomeAdmission } from './packages/wallet-console-server-ts/src/walletPlacement/registrationAdmission';
      export { WalletRegionalDispatch, dispatchKnownWalletHome } from './packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
      export { parseTenantRuntimeWriterV1 } from './packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const accountId = '0123456789abcdef0123456789abcdef';
const catalog = api.WalletHomeCatalog.parse([
  { region: 'US', accountId, databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  { region: 'WEUR', accountId, databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  { region: 'APAC', accountId, databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
]);
const catalogJson = JSON.stringify(['US', 'WEUR', 'APAC'].map(selectHome));
const scope = {
  namespace: 'session-routing',
  organizationId: 'owner',
  projectId: 'project',
  environmentId: 'test',
};
const signerScope = {
  namespace: scope.namespace,
  orgId: scope.organizationId,
  projectId: scope.projectId,
  envId: scope.environmentId,
};
const bridges = new Map();
const workers = [];
for (const region of ['US', 'WEUR', 'APAC']) {
  const bridge = new GatewayBridge(region);
  bridges.set(region, bridge);
  workers.push({
    name: region,
    modules: true,
    script: `import { WorkerEntrypoint } from 'cloudflare:workers';
    export class WalletHomeGateway extends WorkerEntrypoint { fetch(request) { return this.env.HOME.fetch(request); } }
    export default { fetch(request, env) { return env.INGRESS.fetch(request); } };`,
    serviceBindings: { INGRESS: bridge.ingress.bind(bridge), HOME: bridge.home.bind(bridge) },
    d1Databases: { SIGNER_DB: region },
    compatibilityDate: '2026-06-12',
  });
  workers.push({
    name: `home-${region}`,
    modules: true,
    script: 'export default { fetch(request, env) { return env.TARGET.fetch(request); } };',
    serviceBindings: { TARGET: { name: region, entrypoint: 'WalletHomeGateway' } },
    compatibilityDate: '2026-06-12',
  });
}
const consoleBridge = new ConsoleBridge(scope);
workers.push({
  name: 'console',
  modules: true,
  script: 'export default { fetch(request, env) { return env.HANDLER.fetch(request); } };',
  serviceBindings: { HANDLER: consoleBridge.fetch.bind(consoleBridge) },
  d1Databases: { CONSOLE_DB: 'console' },
  compatibilityDate: '2026-06-12',
});
const runtime = new Miniflare({ workers, port: 0 });
try {
  const authorityDatabase = await runtime.getD1Database('CONSOLE_DB', 'console');
  await migrate(
    authorityDatabase,
    resolve(root, 'packages/wallet-console-server-ts/migrations/d1-console'),
  );
  consoleBridge.database = authorityDatabase;
  const consoleService = new WorkerTransport(await runtime.getWorker('console'));
  const directory = new api.D1WalletHomeDirectory(authorityDatabase, catalog);
  const regionalBindings = {};
  for (const region of bridges.keys()) {
    regionalBindings[`WALLET_GATEWAY_${region}`] = new WorkerTransport(
      await runtime.getWorker(`home-${region}`),
    );
  }
  const observations = [];
  for (const [region, bridge] of bridges) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    await migrate(database, resolve(candidate, 'migrations/d1-signer'));
    const writer = api.parseTenantRuntimeWriterV1(
      'gateway',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      { accountId, databaseId: catalog.select(region).databaseId },
    );
    const publisher = new api.WalletHomeServiceClient(consoleService, writer, scope, catalog);
    const store = new api.CloudflareD1AuthorizationStore({
      database,
      namespace: scope.namespace,
      walletSignerScope: signerScope,
    });
    const service = new api.AuthorizationService({
      policy: api.capabilityPolicyPort,
      sessions: store,
      grants: store,
      evidence: store,
      authorizedOperations: store,
      audit: {},
      sessionRouting: publisher,
    });
    bridge.authority = new api.ConsoleRegistrationHomeAdmission({
      service: consoleService,
      writer,
      scope,
      localResource: catalog.select(region),
      catalogJson,
      ingressRegion: region,
    });
    bridge.bindings = regionalBindings;
    bridge.service = service;
    const now = Date.now();
    const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
      label: `regional-session-${region}`,
      identity: {
        walletId: `wallet:${region}`,
        credentialIdB64u: Buffer.from(`passkey-${region}`).toString('base64url'),
      },
      permissions: api.buildFullOwnerPermissionsV1(),
      provenance: 'wallet_registration',
      expiresAtMs: now + 3_600_000,
    });
    const wallet = api.WalletOwnershipKey.parse({ ...scope, walletId: fixture.authority.walletId });
    bridge.ceremonyId = `wrc_${region.charAt(0).repeat(43)}`;
    const reservation = await directory.reserve({
      allocation: 'provided',
      wallet,
      proposedHome: catalog.select(region),
      registrationId: `registration-${region}`,
      deploymentLane: 'test',
      requestDigest: 'a'.repeat(64),
      proposedRegistrationAllocation: api.RegistrationSetupAllocation.parse({
        ceremonyId: bridge.ceremonyId,
        preparationId: `regprep_${region}`,
        walletAuthorityId: `wallet-authority:${region}`,
        deviceId: `device:${region}`,
        walletAuthMethodId: `wallet-auth-method:${region}`,
      }),
      nowMs: now,
    });
    assert.equal(reservation.ok, true);
    await directory.complete({
      wallet,
      home: catalog.select(region),
      registrationId: `registration-${region}`,
      requestDigest: 'a'.repeat(64),
      outcome: 'established',
      nowMs: now + 1,
    });
    await database.batch([
      api.prepareD1WalletAuthorityPutStatement({
        database,
        scope: signerScope,
        authority: fixture.authority,
      }),
      api.prepareD1WalletAuthMethodV2PutStatement({
        database,
        scope: signerScope,
        record: fixture.authMethod,
      }),
    ]);
    const issued = await service.issueDirectWalletSessionAuthorizationV2({
      tenantId: fixture.issuedSession.session.tenantId,
      principalId: fixture.issuedSession.session.principalId,
      walletId: fixture.authority.walletId,
      authority: fixture.authority,
      walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
      mintId: fixture.issuedSession.session.mintId,
      remainingUses: 7,
      issuedAtMs: now,
      expiresAtMs: now + 3_600_000,
    });
    assert.equal(issued.kind, 'issued');
    bridge.tenantId = issued.session.tenantId;
    bridge.issued = issued;
    bridge.publisher = publisher;
    bridge.authMethod = fixture.authMethod;
    bridge.ownerAuthority = fixture.authority;
    const linked = await api.buildLinkedDeviceManagementAuthorityFixture({
      label: `regional-linked-${region}`,
      permissions: api.buildFullOwnerPermissionsV1(),
      provenance: 'device_link',
      sourceAuthorityId: fixture.authority.authorityId,
      expiresAtMs: now + 3_600_000,
      identity: {
        walletId: fixture.authority.walletId,
        authorityId: `authority:linked-${region}`,
        walletAuthMethodId: `auth-method:linked-${region}`,
        rpId: fixture.authMethod.rpId,
        credentialIdB64u: Buffer.from(`linked-device-${region}`.padEnd(32, 'x')).toString(
          'base64url',
        ),
      },
    });
    await database.batch([
      api.prepareD1WalletAuthorityPutStatement({
        database,
        scope: signerScope,
        authority: linked.authority,
      }),
      api.prepareD1WalletAuthMethodV2PutStatement({
        database,
        scope: signerScope,
        record: linked.authMethod,
      }),
    ]);
    const prepared = await service.prepareWalletSessionAuthorizationV2({
      tenantId: linked.issuedSession.session.tenantId,
      principalId: linked.issuedSession.session.principalId,
      walletId: linked.authority.walletId,
      authority: linked.authority,
      walletAuthMethodId: linked.authMethod.walletAuthMethodId,
      mintId: linked.issuedSession.session.mintId,
      remainingUses: 7,
      issuedAtMs: now,
      expiresAtMs: now + 3_600_000,
    });
    const linkedCredential = await service.prepareDirectWalletSessionCredential(prepared);
    await database.batch(
      store.prepareDirectWalletSessionAuthorizationV2Statements(linkedCredential.persisted),
    );
    bridge.linkedCredential = linkedCredential.operationCredential.token;

    observations.push({ region, walletId: wallet.walletId });
  }
  const yaoEntryRouting = await verifyRegionalYaoEntryRouting({ runtime, bridges, consoleBridge });
  const lifecycleRouting = await verifyRegionalLifecycleRouting({
    api,
    runtime,
    bridges,
    consoleBridge,
    authorityDatabase,
  });
  const isolatedScope = { ...scope, projectId: 'isolated-project' };
  const isolatedBridge = new ConsoleBridge(isolatedScope);
  isolatedBridge.database = authorityDatabase;
  const isolatedWriter = api.parseTenantRuntimeWriterV1(
    'gateway',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    { accountId, databaseId: catalog.select('US').databaseId },
  );
  const isolatedIdentity = new api.WalletHomeServiceClient(
    isolatedBridge,
    isolatedWriter,
    isolatedScope,
    catalog,
  );
  const linkHomes = await verifyRegionalLinkHomes({
    api,
    runtime,
    bridges,
    consoleBridge,
    signerScope,
    isolatedIdentity,
  });
  const deviceProofs = await verifyRegionalDeviceProofs({
    api,
    runtime,
    bridges,
    consoleBridge,
    isolatedIdentity,
    signerScope,
    authorityDatabase,
  });
  const linkHttp = await verifyRegionalLinkHttp({ api, runtime, bridges, signerScope });
  const authenticationRouting = await verifyRegionalAuthenticationRouting({
    isolatedIdentity,
    authorityDatabase,
    api,
    runtime,
    bridges,
    consoleBridge,
    signerScope,
  });
  const recovery = await verifyRegionalRecoveryRouting({
    api,
    runtime,
    bridges,
    consoleBridge,
    authorityDatabase,
    signerScope,
  });
  const sharedIdentity = await verifyRegionalSharedIdentity({
    isolatedIdentity,
    runtime,
    bridges,
    consoleBridge,
    authorityDatabase,
  });
  const passkeyClaims = await verifyRegionalPasskeyClaims({
    api,
    runtime,
    bridges,
    consoleBridge,
    signerScope,
    directory,
    catalog,
  });
  const rateLimits = await verifyRegionalRateLimits({
    api,
    bridges,
    isolatedIdentity,
    consoleBridge,
    runtime,
  });
  const googleLogin = await verifyRegionalGoogleLogin({
    api,
    directory,
    catalog,
    runtime,
    bridges,
    signerScope,
    consoleBridge,
  });
  for (const [region, bridge] of bridges) {
    const ingress = await runtime.getWorker(region === 'US' ? 'APAC' : 'US');
    const token = bridge.issued.operationCredential.token;
    const response = await ingress.fetch(
      'https://wallet.test/wallet/session/status',
      requestOptions({ token, body: {} }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { region, active: true });
    const otherWallet = bridges.get(region === 'US' ? 'WEUR' : 'US').issued.session.walletId;
    const mismatch = await ingress.fetch(
      `https://wallet.test/wallets/${encodeURIComponent(otherWallet)}/custody/credentials`,
      requestOptions({ token, body: {} }),
    );
    assert.equal(mismatch.status, 403);
    const otherCeremony = bridges.get(region === 'US' ? 'WEUR' : 'US').ceremonyId;
    for (const continuation of [
      { operation: 'admit', body: { scope: { lifecycle_id: otherCeremony } } },
      { operation: 'execute', body: { binding: { lifecycle: { lifecycle_id: otherCeremony } } } },
    ]) {
      const rejected = await ingress.fetch(
        `https://wallet.test/router-ab/ed25519/yao/registration/${continuation.operation}`,
        requestOptions({ token, body: continuation.body }),
      );
      assert.equal(rejected.status, 403);
      assert.equal((await rejected.json()).code, 'wallet_session_scope_mismatch');
    }
    const exchangeCountBefore = await (await runtime.getD1Database('SIGNER_DB', region))
      .prepare('SELECT COUNT(*) AS count FROM wallet_session_hosted_exchange_codes_v2')
      .first('count');
    consoleBridge.available = false;
    await assert.rejects(
      bridge.service.mintHostedWalletSeamsSessionExchange({
        authorization: { session: bridge.issued.session, quota: bridge.issued.quota },
        appOrigin: api.parseSessionOrigin('https://app.test'),
        walletOrigin: api.parseSessionOrigin('https://wallet.test'),
        issuedAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
      }),
    );
    consoleBridge.available = true;
    assert.equal(
      await (await runtime.getD1Database('SIGNER_DB', region))
        .prepare('SELECT COUNT(*) AS count FROM wallet_session_hosted_exchange_codes_v2')
        .first('count'),
      exchangeCountBefore,
    );
    const exchange = await bridge.service.mintHostedWalletSeamsSessionExchange({
      authorization: { session: bridge.issued.session, quota: bridge.issued.quota },
      appOrigin: api.parseSessionOrigin('https://app.test'),
      walletOrigin: api.parseSessionOrigin('https://wallet.test'),
      issuedAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
    });
    const exchangeRequest = requestOptions({ token: null, body: exchange });
    const attempts = await Promise.all([
      ingress.fetch('https://wallet.test/wallet/session/exchange/redeem', exchangeRequest),
      ingress.fetch('https://wallet.test/wallet/session/exchange/redeem', exchangeRequest),
    ]);
    const results = [];
    for (const response of attempts) results.push(await response.json());
    const winners = results.filter(redeemed);
    assert.equal(winners.length, 1);
    const child = winners[0].result.operationCredential.token;
    const hosted = await ingress.fetch(
      'https://wallet.test/wallet/session/status',
      requestOptions({ token: child, body: {} }),
    );
    assert.deepEqual(await hosted.json(), { region, active: true });
    const linkedResponse = await ingress.fetch(
      'https://wallet.test/wallet/session/status',
      requestOptions({ token: bridge.linkedCredential, body: {} }),
    );
    assert.deepEqual(await linkedResponse.json(), { region, active: true });
    const wrong = bridges.get(region === 'US' ? 'WEUR' : 'US');
    await assert.rejects(
      wrong.publisher.publish({
        kind: 'credential',
        digest: await api.digestOpaqueValue(`wst_${'x'.repeat(43)}`),
        walletId: bridge.issued.session.walletId,
        expiresAtMs: bridge.issued.session.expiresAtMs,
      }),
      /HTTP 409/u,
    );
    await bridge.service.retireWalletSessionAuthorizationsForAuthMethod({
      tenantId: bridge.tenantId,
      walletId: bridge.issued.session.walletId,
      walletAuthMethodId: bridge.issued.session.walletAuthMethodId,
      nowMs: Date.now(),
    });
    for (const credential of [token, child]) {
      const retired = await ingress.fetch(
        'https://wallet.test/wallet/session/status',
        requestOptions({ token: credential, body: {} }),
      );
      assert.equal(retired.status, 401);
    }
  }
  for (const [region, bridge] of bridges) {
    const travelingDevice = await runtime.getWorker(region === 'APAC' ? 'WEUR' : 'APAC');
    const response = await travelingDevice.fetch(
      'https://wallet.test/wallet/session/status',
      requestOptions({ token: bridge.linkedCredential, body: {} }),
    );
    assert.deepEqual(await response.json(), { region, active: true });
  }
  const ingress = await runtime.getWorker('US');
  const unknown = await ingress.fetch(
    'https://wallet.test/wallet/session/status',
    requestOptions({ token: `wst_${'z'.repeat(43)}`, body: {} }),
  );
  assert.equal(unknown.status, 401);
  consoleBridge.available = false;
  const unavailable = await ingress.fetch(
    'https://wallet.test/wallet/session/status',
    requestOptions({ token: bridges.get('WEUR').issued.operationCredential.token, body: {} }),
  );
  assert.equal(unavailable.status, 503);
  consoleBridge.available = true;
  const rows = await authorityDatabase
    .prepare('SELECT kind, digest, wallet_id, expires_at_ms FROM wallet_session_locators')
    .all();
  assert.equal(rows.results.length, 12);
  const serialized = JSON.stringify(rows.results);
  for (const bridge of bridges.values())
    assert.ok(!serialized.includes(bridge.issued.operationCredential.token));
  const revokedDiscovery = await verifyRevokedDiscovery({ api, runtime, bridges, signerScope });
  const evidence = {
    revokedDiscovery,
    kind: 'regional_session_routing_e2e_v1',
    deviceProofs,
    linkHomes,
    linkHttp,
    recovery,
    yaoEntryRouting,
    lifecycleRouting,
    authenticationRouting,
    googleLogin,
    sharedIdentity,
    rateLimits,
    passkeyClaims,
    recordedAt: new Date().toISOString(),
    productionBundleSha256: createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'),
    observations,
    locatorCount: rows.results.length,
    opaqueCredentialsRoutedAcrossRegions: true,
    concurrentExchangeHasOneWinner: true,
    wrongHomePublicationRejected: true,
    walletTokenDisagreementRejected: true,
    directRegistrationSessionDisagreementRejected: true,
    failedPublicationPreventsExchangeCommit: true,
    retiredPrimaryAndChildRejected: true,
    linkedDeviceCredentialUsesSameHomeAndSurvivesOtherDeviceRetirement: true,
    unknownCredentialRejected: true,
    directoryOutageReturns503: true,
    plaintextAbsentFromDirectory: true,
    scope:
      'Local Worker transports, production routing/authorization services and four D1 databases; tenant writer admission is controlled. No browser, signing execution, hosted provider, or geographic latency measurement.',
  };
  await writeFile(
    resolve(output, 'regional-session-routing-evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(`Regional session routing passed: ${output}`);
} finally {
  await runtime.dispose();
}

function selectHome(region) {
  return catalog.select(region);
}
function redeemed(value) {
  return value.result?.kind === 'redeemed';
}
function requestOptions({ token, body }) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}
async function migrate(database, directory) {
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith('.sql')) continue;
    for (const sql of unstable_splitSqlQuery(await readFile(resolve(directory, filename), 'utf8')))
      await database.prepare(sql).run();
  }
}
