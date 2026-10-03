import { handleRuntimeIdentityHomeRequest } from '../../serviceBinding/runtimeIdentityHome';
import { WalletHomeCatalog } from '../../walletPlacement/home';
import { WalletHomeServiceClient } from '../../walletPlacement/serviceClient';
import { parseTenantRuntimeWriterV1 } from '../../tenantDeployment/resourceVerification';
import type { CfExecutionContext } from '@seams/wallet-server/cloud-host';
import {
  handleSplitGatewayWalletRuntimeRequest,
  readWalletRuntimeIdentities,
  type CloudflareD1GatewayEnv,
} from '@seams/wallet-server/hosted-wallet-gateway';
import {
  handleWalletControlRequest,
  WALLET_RUNTIME_OP_PATHS_V1,
  type WalletControlRuntimeBindings,
} from '@seams/wallet-server/cloud-host';
import { resolveEmailOtpDeliveryProviderFromEnv } from '../../email/otp/emailOtpProviders';
import {
  resolveBoundTenantDeploymentRuntimeEnvironmentV1,
  resolveTenantDeploymentSetupAdmissionFromServiceV1,
} from '../../tenantDeployment/runtimeBinding';
import { createTenantDeploymentRuntimeInspectionHandlerV1 } from '../../tenantDeployment/runtimeInspection';
import { tenantD1ResourceChallengeResponseV1 } from '../../tenantDeployment/resourceChallenge';
import { TenantDeploymentD1ResourceIdentityV1 } from '../../tenantDeployment/deploymentResource';

type CloudflareWalletRuntimeEnv = CloudflareD1GatewayEnv &
  WalletControlRuntimeBindings & {
    readonly SEAMS_TENANT_DEPLOYMENT_LANE: string;
    readonly SEAMS_WALLET_HOME_CATALOG_JSON: string;
    readonly SEAMS_D1_HOME_ACCOUNT_ID: string;
    readonly SEAMS_D1_HOME_DATABASE_ID: string;
    readonly CF_VERSION_METADATA: { readonly id: unknown };
  };

async function fetch(
  request: Request,
  env: CloudflareWalletRuntimeEnv,
  _ctx: CfExecutionContext,
): Promise<Response> {
  const challenge = await tenantD1ResourceChallengeResponseV1(
    request,
    env.SIGNER_DB,
    {
      namespace: env.SEAMS_TENANT_STORAGE_NAMESPACE,
      accountId: env.SEAMS_D1_HOME_ACCOUNT_ID,
      databaseId: env.SEAMS_D1_HOME_DATABASE_ID,
    },
    env.CF_VERSION_METADATA,
  );
  if (challenge) return challenge;
  const inspectionResponse = await createTenantDeploymentRuntimeInspectionHandlerV1({
    database: env.SIGNER_DB,
    resource: TenantDeploymentD1ResourceIdentityV1.parse({
      namespace: env.SEAMS_TENANT_STORAGE_NAMESPACE,
      accountId: env.SEAMS_D1_HOME_ACCOUNT_ID,
      databaseId: env.SEAMS_D1_HOME_DATABASE_ID,
    }),
  })(request);
  if (inspectionResponse) return inspectionResponse;
  const controlResponse = await handleWalletControlRequest(request, env);
  if (controlResponse) return controlResponse;
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/wallets/register/setup') {
    const allowed = await resolveTenantDeploymentSetupAdmissionFromServiceV1({
      deploymentLane: env.SEAMS_TENANT_DEPLOYMENT_LANE,
      service: env.WALLET_CONSOLE,
    });
    if (!allowed) {
      return Response.json(
        {
          ok: false,
          code: 'tenant_deployment_cutover_in_progress',
          message: 'New wallet registration is temporarily paused for a tenant deployment cutover',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
      );
    }
  }
  const boundEnv = await resolveBoundTenantDeploymentRuntimeEnvironmentV1(
    env,
    parseTenantRuntimeWriterV1('walletRuntime', env.CF_VERSION_METADATA?.id, {
      accountId: env.SEAMS_D1_HOME_ACCOUNT_ID,
      databaseId: env.SEAMS_D1_HOME_DATABASE_ID,
    }),
  );
  if (!boundEnv) {
    return Response.json(
      { ok: false, code: 'tenant_deployment_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (url.pathname === WALLET_RUNTIME_OP_PATHS_V1.walletIdentities) {
    const scope = {
      namespace: boundEnv.SEAMS_TENANT_STORAGE_NAMESPACE,
      organizationId: boundEnv.SEAMS_STAGING_ORG_ID,
      projectId: boundEnv.SEAMS_STAGING_PROJECT_ID,
      environmentId: boundEnv.SEAMS_STAGING_ENV_ID,
    };
    const localResource = {
      accountId: env.SEAMS_D1_HOME_ACCOUNT_ID,
      databaseId: env.SEAMS_D1_HOME_DATABASE_ID,
    };
    const identityResponse = await handleRuntimeIdentityHomeRequest(request, {
      scope,
      localResource,
      directory: new WalletHomeServiceClient(
        env.WALLET_CONSOLE,
        parseTenantRuntimeWriterV1('walletRuntime', env.CF_VERSION_METADATA.id, localResource),
        scope,
        WalletHomeCatalog.parse(JSON.parse(env.SEAMS_WALLET_HOME_CATALOG_JSON)),
      ),
      readIdentities: readWalletRuntimeIdentities.bind(undefined, boundEnv),
    });
    if (identityResponse) return identityResponse;
  }
  const response = await handleSplitGatewayWalletRuntimeRequest(request, boundEnv, {
    emailOtpDeliveryProvider: resolveEmailOtpDeliveryProviderFromEnv(boundEnv),
  });
  return response ?? new Response('Not found', { status: 404 });
}

export default { fetch };
