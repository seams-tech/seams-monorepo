import {
  buildTenantDeploymentBindingV1,
  type TenantDeploymentBindingBodyV1,
} from '../../packages/wallet-console-shared-ts/src/tenant-deployment';

export function developmentBindingBody(createdAtMs: number): TenantDeploymentBindingBodyV1 {
  return {
    kind: 'tenant_deployment_binding_v1',
    schemaVersion: 1,
    deploymentLane: 'live-demo',
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
  const result = await buildTenantDeploymentBindingV1(developmentBindingBody(createdAtMs));
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
