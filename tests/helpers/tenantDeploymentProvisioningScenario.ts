import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createD1ConsoleApiKeyService } from '../../packages/console-server-ts/src/apiKeys/d1';
import { createD1ConsoleOrgProjectEnvService } from '../../packages/console-server-ts/src/orgProjectEnv/d1';
import { createD1ConsoleAuditService } from '../../packages/console-server-ts/src/audit/d1';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '../../packages/wallet-console-shared-ts/src/apiKeyScopes';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/wallet-console-shared-ts/src/tenant-root';
import { createD1ConsolePolicyService } from '../../packages/wallet-console-server-ts/src/policies/d1';
import { createD1ConsoleRuntimeSnapshotService } from '../../packages/wallet-console-server-ts/src/runtimeSnapshots/d1';
import { createTenantRootSecurityStateReaderV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stateReader';
import { D1TenantRootActiveLineageResolverV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/activeLineageD1';
import { createD1TenantRootCreationGrantServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantRootCreation/d1';
import { createD1TenantDeploymentServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { createProductionTenantDeploymentReadinessAdapterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/productionReadiness';
import { createTenantDeploymentReadinessServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/readiness';
import {
  createGatewayTenantDeploymentRegistrationCanaryV1,
  createTenantDeploymentProvisionerV1,
  type TenantDeploymentProvisionerOptionsV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/provisioning';
import type { TenantDeploymentRuntimeInspectorV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/runtimeInspection';
import { regionalBinding, seedAdoptionRoot } from './tenantDeploymentFixtures';

class RootRouter {
  available = true;
  constructor(readonly identityDigest: string) {}

  async fetch(): Promise<Response> {
    if (!this.available) return new Response('Unavailable', { status: 503 });
    return Response.json({
      identity_digest_b64u: this.identityDigest,
      custody_lineage_b64u: 'adoption-lineage',
      root_commitment_b64u: 'adoption-commitment',
      lifecycle_revision: 1,
      active_epoch: 1,
      activation_receipt_digest_b64u: 'activation-digest',
      deriver_a_status: 'healthy',
      deriver_b_status: 'healthy',
      last_refresh_completed_at_ms: null,
    });
  }
}

class RejectInteractiveAuth {
  async authenticate() {
    return { ok: false as const, status: 401 as const };
  }
}

export async function provisioningScenario(
  database: D1DatabaseLike,
  walletRuntime: TenantDeploymentRuntimeInspectorV1,
  gatewayOrigin: string,
) {
  const namespace = 'wallet';
  const deploymentLane = 'renewal';
  const context = { orgId: 'org_renewal', actorUserId: 'system:test' };
  const orgProjectEnv = await createD1ConsoleOrgProjectEnvService({ database, namespace });
  await orgProjectEnv.upsertOrganization(context, { name: 'Deployment renewal' });
  const project = await orgProjectEnv.createProject(context, {
    id: 'proj_renewal',
    name: 'Regional wallets',
  });
  const environments = await orgProjectEnv.listEnvironments(context, { projectId: project.id });
  const environment = environments.find(isDevelopmentEnvironment);
  if (!environment) throw new Error('Missing development environment');
  const parsedIdentity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: context.orgId,
    projectId: project.id,
    envId: environment.id,
    signingRootId: `${project.id}:dev`,
    signingRootVersion: environment.runtimeVersion,
  });
  if (!parsedIdentity.ok) throw new Error('Invalid provisioning fixture identity');
  const root = await seedAdoptionRoot(database, namespace, parsedIdentity.value);
  const router = new RootRouter(root.identityDigestB64u);
  const tenantRootState = createTenantRootSecurityStateReaderV1({
    activeRoots: new D1TenantRootActiveLineageResolverV1(database, namespace),
    router,
    internalServiceAuthSecret: 'fixture',
  });
  const apiKeys = await createD1ConsoleApiKeyService({
    database,
    namespace,
    ensureSchema: false,
    scopeValidation: WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
  });
  const store = createD1TenantDeploymentServiceV1({ database });
  const adapter = createProductionTenantDeploymentReadinessAdapterV1({
    namespace,
    deploymentLane,
    orgProjectEnv,
    apiKeys,
    policies: await createD1ConsolePolicyService({ database, namespace }),
    runtimeSnapshots: await createD1ConsoleRuntimeSnapshotService({ database, namespace }),
    tenantRootState,
    bindings: store,
    walletRuntime,
  });
  const reference = await regionalBinding(Date.now(), deploymentLane);
  const provisionerOptions: TenantDeploymentProvisionerOptionsV1 = {
    namespace,
    resources: reference.resources,
    deploymentLane,
    surfaces: {
      applicationOrigin: 'https://wallet.example.test',
      hostedWalletOrigin: 'https://sign.example.test',
      gatewayOrigin,
      relyingPartyId: 'sign.example.test',
    },
    orgProjectEnv,
    apiKeys,
    audit: await createD1ConsoleAuditService({ database, namespace, ensureSchema: false }),
    tenantRootCreation: {
      auth: new RejectInteractiveAuth(),
      orgProjectEnv,
      grants: createD1TenantRootCreationGrantServiceV1({ database, namespace }),
      router,
      internalServiceAuthSecret: 'fixture',
      grantAuthorityKeyId: 'fixture',
      grantAuthoritySigningSeedB64u: 'unused-existing-root',
    },
    tenantRootState,
    candidates: adapter,
    readiness: createTenantDeploymentReadinessServiceV1({ inspector: adapter }),
    store,
    canary: createGatewayTenantDeploymentRegistrationCanaryV1(),
    browserCredential: { kind: 'create_managed_publishable_key' },
  };
  const provisioner = createTenantDeploymentProvisionerV1(provisionerOptions);
  return {
    provisioner,
    provisionerOptions,
    store,
    apiKeys,
    router,
    adapter,
    reference,
    context,
    environmentId: environment.id,
  };
}

function isDevelopmentEnvironment(environment: { key: string }): boolean {
  return environment.key === 'dev';
}
