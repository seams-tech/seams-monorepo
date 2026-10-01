import {
  buildTenantDeploymentBindingV1,
  type TenantDeploymentBindingBodyV1,
  type TenantDeploymentBindingV1,
  type TenantDeploymentCutoverId,
  type TenantDeploymentCutoverV1,
} from '../../packages/wallet-console-shared-ts/src/tenant-deployment';
import { NamespaceD1HomeV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/namespaceHome';
import type { TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/service';
import type {
  ActivateTenantDeploymentBindingInputV1,
  ExpectedActiveTenantDeploymentBindingV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/types';

export function developmentBindingBody(
  createdAtMs: number,
  deploymentLane: string,
): TenantDeploymentBindingBodyV1 {
  return {
    kind: 'tenant_deployment_binding_v1',
    schemaVersion: 1,
    deploymentLane,
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

export function namespaceHome(namespace: string, databaseId: string): NamespaceD1HomeV1 {
  return NamespaceD1HomeV1.parse({
    namespace,
    accountId: '0123456789abcdef0123456789abcdef',
    databaseId,
  });
}

export async function readyActivation(
  store: TenantDeploymentServiceV1,
  candidate: TenantDeploymentBindingV1,
  home: NamespaceD1HomeV1,
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
