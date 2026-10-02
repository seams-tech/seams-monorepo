import { TenantHomeVerificationV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/homeVerification';
import {
  buildTenantDeploymentBindingV1,
  encodeTenantDeploymentJsonValueV1,
  type TenantDeploymentBindingBodyV1,
  type TenantDeploymentBindingV1,
  type TenantDeploymentCutoverId,
  type TenantDeploymentCutoverV1,
} from '../../packages/wallet-console-shared-ts/src/tenant-deployment';
import { TenantDeploymentD1ResourceIdentityV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/deploymentResource';
import type { TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/service';
import type {
  ActivateTenantDeploymentBindingInputV1,
  ExpectedActiveTenantDeploymentBindingV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/types';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import type { TenantRootIdentityV1 } from '../../packages/wallet-console-shared-ts/src/tenant-root';
import { createD1TenantRootCreationGrantServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantRootCreation/d1';

export async function seedAdoptionRoot(
  database: D1DatabaseLike,
  namespace: string,
  identity: TenantRootIdentityV1,
) {
  const grants = createD1TenantRootCreationGrantServiceV1({ database, namespace });
  const identityDigestB64u = await tenantRootIdentityDigestB64uV1(identity);
  const now = Date.now();
  await grants.putOrGetGrant({
    operationId: 'adoption-fixture-root',
    identity,
    identityDigestB64u,
    custodyLineageB64u: 'adoption-lineage',
    grantNonceB64u: 'fixture-nonce',
    grantKeyId: 'fixture-key',
    grantB64u: 'fixture-grant',
    grantDigestB64u: 'fixture-digest',
    issuedAtMs: now,
    expiresAtMs: now + 60_000,
  });
  await grants.markActiveFromReady({
    operationId: 'adoption-fixture-root',
    identity,
    identityDigestB64u,
    custodyLineageB64u: 'adoption-lineage',
    ready: {
      revision: 1,
      rootCommitmentB64u: 'adoption-commitment',
      journalDigestB64u: 'fixture-journal',
      capabilityDigestB64u: 'fixture-capability',
    },
  });
  return {
    identityDigestB64u,
    custodyLineageId: 'adoption-lineage',
    signingRootId: identity.signingRootId,
    signingRootVersion: identity.signingRootVersion,
  };
}

export async function seedHistoricalActiveBinding(
  database: D1DatabaseLike,
  candidate: TenantDeploymentBindingV1,
) {
  const historical = await historicalBindingFromCandidate(candidate);
  await database
    .prepare(
      `INSERT INTO tenant_deployment_bindings (deployment_lane, revision, schema_version, binding_json, namespace, org_id, project_id, environment_id, tenant_root_identity_digest_b64u, custody_lineage_id, credential_id, runtime_policy_digest_b64u, created_at_ms) VALUES (?1,?2,1,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
    )
    .bind(
      historical.deploymentLane,
      historical.revision,
      JSON.stringify(historical),
      historical.tenant.namespace,
      historical.tenant.organizationId,
      historical.tenant.projectId,
      historical.tenant.environmentId,
      historical.tenantRoot.identityDigestB64u,
      historical.tenantRoot.custodyLineageId,
      historical.browserCredential.credentialId,
      historical.runtimePolicyDigestB64u,
      historical.createdAtMs,
    )
    .run();
  await database
    .prepare('INSERT INTO active_tenant_deployment_bindings VALUES (?1,?2,NULL,1,?3)')
    .bind(historical.deploymentLane, historical.revision, Date.now())
    .run();
  return historical;
}

export function developmentBindingBody(
  createdAtMs: number,
  deploymentLane: string,
): TenantDeploymentBindingBodyV1 {
  return {
    kind: 'tenant_deployment_binding_v1',
    schemaVersion: 1,
    deploymentLane,
    home: {
      accountId: '0123456789abcdef0123456789abcdef',
      databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    mode: { kind: 'development_testnet_v1', environment: 'development', network: 'testnet' },
    tenant: {
      namespace: 'wallet',
      organizationId: 'org_1',
      projectId: 'proj_mu3mtq24_6ni46i',
      environmentId: 'proj_mu3mtq24_6ni46i:dev',
    },
    tenantRoot: {
      identityDigestB64u: 'root-digest',
      custodyLineageId: 'lineage-1',
      signingRootId: 'signing-root-1',
      signingRootVersion: '1',
    },
    browserCredential: {
      credentialId: 'ak_dev_fixture',
      publishableKey: 'pk_dev_fixture',
      expiresAtMs: null,
      allowedOrigins: ['https://test.sign.seams.sh', 'https://wallet.seams.sh'],
      quotaPolicy: {
        rateLimitBucket: 'managed-registration',
        quotaBucket: 'included',
        riskPolicy: {},
        paymentPolicy: {},
      },
    },
    surfaces: {
      applicationOrigin: 'https://wallet.seams.sh',
      hostedWalletOrigin: 'https://test.sign.seams.sh',
      gatewayOrigin: 'https://test.api.wallet.seams.sh',
      relyingPartyId: 'test.sign.seams.sh',
    },
    runtimePolicyDigestB64u: 'policy-digest',
    createdAtMs,
  };
}

export async function binding(createdAtMs: number) {
  return bindingForLane(createdAtMs, 'live-demo');
}

export async function bindingForLane(createdAtMs: number, deploymentLane: string) {
  const result = await buildTenantDeploymentBindingV1(
    developmentBindingBody(createdAtMs, deploymentLane),
  );
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

export async function historicalBindingFixture(createdAtMs: number, deploymentLane: string) {
  return historicalBindingFromBody(developmentBindingBody(createdAtMs, deploymentLane));
}

export async function historicalBindingFromCandidate(candidate: TenantDeploymentBindingV1) {
  const { revision, ...body } = candidate;
  void revision;
  return historicalBindingFromBody(body);
}

async function historicalBindingFromBody(candidate: TenantDeploymentBindingBodyV1) {
  // Historical wire data is constructed only at this persistence-test boundary.
  const { home, ...body } = candidate;
  void home;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(encodeTenantDeploymentJsonValueV1(body)),
  );
  const revision = `tdb_${Buffer.from(digest).toString('base64url')}` as const;
  return { ...body, revision };
}

export function deploymentResource(namespace: string, databaseId: string): TenantDeploymentD1ResourceIdentityV1 {
  return TenantDeploymentD1ResourceIdentityV1.parse({
    namespace,
    accountId: '0123456789abcdef0123456789abcdef',
    databaseId,
  });
}

export async function readyActivation(
  store: TenantDeploymentServiceV1,
  candidate: TenantDeploymentBindingV1,
  home: TenantDeploymentD1ResourceIdentityV1,
  operationId: TenantDeploymentCutoverId,
  expectedActive: ExpectedActiveTenantDeploymentBindingV1 | null,
  nowMs: number,
): Promise<ActivateTenantDeploymentBindingInputV1> {
  const targetIdentity = {
    organizationId: candidate.tenant.organizationId,
    projectId: candidate.tenant.projectId,
    environmentId: candidate.tenant.environmentId,
    signingRootId: candidate.tenantRoot.signingRootId,
    signingRootVersion: candidate.tenantRoot.signingRootVersion,
  };
  const expectedActiveRevision = expectedActive?.revision ?? null;
  const planning = await store.createCutover({
    kind: 'planning',
    operationId,
    deploymentLane: candidate.deploymentLane,
    targetIdentity,
    expectedActiveRevision,
  });
  const root = await store.transitionCutover(planning, {
    kind: 'awaiting_tenant_root',
    operationId,
    deploymentLane: candidate.deploymentLane,
    targetIdentity,
    expectedActiveRevision,
  });
  const credential = await store.transitionCutover(root, {
    kind: 'awaiting_browser_credential',
    operationId,
    deploymentLane: candidate.deploymentLane,
    targetIdentity,
    expectedActiveRevision,
    activeTenantRoot: candidate.tenantRoot,
  });
  const readinessReceipt = {
    kind: 'tenant_deployment_readiness_receipt_v1' as const,
    bindingRevision: candidate.revision,
    expectedActiveRevision,
    checkedAtMs: nowMs - 1000,
    expiresAtMs: nowMs + 60_000,
    evidenceDigestB64u: 'fixture-evidence',
    durableWalletCount: 0,
    inFlightCeremonyCount: 0,
  };
  const ready = await store.transitionCutover(credential, {
    kind: 'ready',
    operationId,
    deploymentLane: candidate.deploymentLane,
    binding: candidate,
    readinessReceipt,
    expectedActiveRevision,
  });
  return {
    homeVerification: TenantHomeVerificationV1.forLocalDevelopment(
      home,
      candidate.deploymentLane,
      nowMs,
    ),
    home,
    operationId,
    expectedCutoverRecordRevision: ready.recordRevision,
    deploymentLane: candidate.deploymentLane,
    bindingRevision: candidate.revision,
    expectedActive,
    readinessReceipt,
  };
}

export function activeCutoverFixture(
  input: ActivateTenantDeploymentBindingInputV1,
  candidate: TenantDeploymentBindingV1,
  nowMs: number,
): Extract<TenantDeploymentCutoverV1, { kind: 'active' }> {
  return {
    kind: 'active',
    operationId: input.operationId,
    deploymentLane: input.deploymentLane,
    binding: candidate,
    activationReceipt: {
      kind: 'tenant_deployment_activation_receipt_v1',
      bindingRevision: candidate.revision,
      previousRevision: input.expectedActive?.revision ?? null,
      activationSequence: (input.expectedActive?.activationSequence ?? 0) + 1,
      activatedAtMs: nowMs,
    },
  };
}

export function operatorHomeCheckpoint(home: TenantDeploymentD1ResourceIdentityV1, lane: string, nowMs: number) {
  const gateway = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const walletRuntime = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let challengeId = '';
  for (const byte of bytes) challengeId += byte.toString(16).padStart(2, '0');
  return {
    kind: 'tenant_d1_resource_checkpoint_v1',
    resource: home,
    deploymentLane: lane,
    challengeId,
    checkedAtMs: nowMs - 100,
    expiresAtMs: nowMs + 299_000,
    providerCheckedBefore: new Date(nowMs - 200).toISOString(),
    providerCheckedAfter: new Date(nowMs - 50).toISOString(),
    writerVersions: { gateway, walletRuntime },
    workers: [
      {
        workerName: 'fixture-gateway',
        deploymentId: gateway,
        versions: [{ versionId: gateway, percentage: 100, databaseId: home.databaseId }],
      },
      {
        workerName: 'fixture-runtime',
        deploymentId: walletRuntime,
        versions: [{ versionId: walletRuntime, percentage: 100, databaseId: home.databaseId }],
      },
    ],
    runtimeChallengeVerified: true,
    activationAuthorized: false,
  };
}

export async function bindingForHome(nowMs: number, lane: string, home: TenantDeploymentD1ResourceIdentityV1) {
  const body = developmentBindingBody(nowMs, lane);
  const result = await buildTenantDeploymentBindingV1({
    ...body,
    home: { accountId: home.accountId, databaseId: home.databaseId },
    tenant: { ...body.tenant, namespace: home.namespace },
  });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

export async function productionBindingForHome(
  nowMs: number,
  lane: string,
  home: TenantDeploymentD1ResourceIdentityV1,
) {
  const body = developmentBindingBody(nowMs, lane);
  const result = await buildTenantDeploymentBindingV1({
    ...body,
    mode: { kind: 'production_mainnet_v1', environment: 'production', network: 'mainnet' },
    home: { accountId: home.accountId, databaseId: home.databaseId },
    tenant: {
      ...body.tenant,
      namespace: home.namespace,
      environmentId: `${body.tenant.projectId}:prod`,
    },
    browserCredential: {
      ...body.browserCredential,
      credentialId: 'ak_prod_fixture',
      publishableKey: 'pk_prod_fixture',
    },
  });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
