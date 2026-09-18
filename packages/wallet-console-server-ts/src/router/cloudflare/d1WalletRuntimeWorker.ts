import type { CfExecutionContext } from '@seams/wallet-server/cloud-host';
import {
  handleSplitGatewayWalletRuntimeRequest,
  type CloudflareD1GatewayEnv,
} from '@seams/wallet-server/hosted-wallet-gateway';
import type { WalletControlRuntimeBindings } from '@seams/wallet-server/cloud-host';
import { resolveEmailOtpDeliveryProviderFromEnv } from '../../email/otp/emailOtpProviders';
import {
  resolveBoundTenantDeploymentRuntimeEnvironmentV1,
  resolveTenantDeploymentSetupAdmissionFromServiceV1,
} from '../../tenantDeployment/runtimeBinding';
import { createTenantDeploymentRuntimeInspectionHandlerV1 } from '../../tenantDeployment/runtimeInspection';

type CloudflareWalletRuntimeEnv = CloudflareD1GatewayEnv &
  WalletControlRuntimeBindings & {
    readonly SEAMS_TENANT_DEPLOYMENT_LANE: string;
  };

async function fetch(
  request: Request,
  env: CloudflareWalletRuntimeEnv,
  _ctx: CfExecutionContext,
): Promise<Response> {
  const inspectionResponse = await createTenantDeploymentRuntimeInspectionHandlerV1({
    database: env.SIGNER_DB,
  })(request);
  if (inspectionResponse) return inspectionResponse;
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
  const boundEnv = await resolveBoundTenantDeploymentRuntimeEnvironmentV1(env);
  if (!boundEnv) {
    return Response.json(
      { ok: false, code: 'tenant_deployment_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const response = await handleSplitGatewayWalletRuntimeRequest(request, boundEnv, {
    emailOtpDeliveryProvider: resolveEmailOtpDeliveryProviderFromEnv(boundEnv),
  });
  return response ?? new Response('Not found', { status: 404 });
}

export default { fetch };
