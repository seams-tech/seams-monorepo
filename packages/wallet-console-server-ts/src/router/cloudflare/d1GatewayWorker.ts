import type { CfExecutionContext, CfScheduledEvent } from '@seams/wallet-server/cloud-host';
import {
  handleSplitGatewayRequest,
  type CloudflareD1GatewayEnv,
} from '@seams/wallet-server/hosted-wallet-gateway';
import { runRouterAbPrewarmScheduledV1 } from '@seams/wallet-server/cloud-host';
import { resolveEmailOtpDeliveryProviderFromEnv } from '../../email/otp/emailOtpProviders';
import {
  bindTenantDeploymentToRuntimeEnvironmentV1,
  resolveActiveTenantDeploymentFromServiceV1,
} from '../../tenantDeployment/runtimeBinding';
import { tenantDeploymentPublicProjectionResponseV1 } from '../../tenantDeployment/publicProjection';

// The split Wallet Gateway entrypoint (R105 Phase 4). Bindings: SIGNER_DB,
// MPC_ROUTER, SIGNING_WORKER, and the private WALLET_CONSOLE service binding.
// No CONSOLE_DB, no /console/* routes, no Console cron; deploying this
// entrypoint IS the gateway half of the cutover.

type TenantDeploymentGatewayEnv = CloudflareD1GatewayEnv & {
  readonly SEAMS_TENANT_DEPLOYMENT_LANE: string;
};

async function fetch(
  request: Request,
  env: TenantDeploymentGatewayEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  const startedAt = performance.now();
  const pathname = new URL(request.url).pathname;
  const binding = await resolveActiveTenantDeploymentFromServiceV1({
    deploymentLane: env.SEAMS_TENANT_DEPLOYMENT_LANE,
    service: env.WALLET_CONSOLE,
  });
  const bindingDurationMs = performance.now() - startedAt;
  if (pathname === '/.well-known/seams-tenant-deployment.json') {
    if (request.method !== 'GET') {
      return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    }
    return tenantDeploymentPublicProjectionResponseV1({
      request,
      binding,
      maxAgeSeconds: 30,
    });
  }
  if (!binding) {
    return Response.json(
      { ok: false, code: 'tenant_deployment_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const boundEnv = bindTenantDeploymentToRuntimeEnvironmentV1(env, binding);
  const response = await handleSplitGatewayRequest(request, boundEnv, ctx, {
    emailOtpDeliveryProvider: resolveEmailOtpDeliveryProviderFromEnv(boundEnv),
  });
  if (!pathname.startsWith('/router-ab/ecdsa-derivation/')) return response;
  const result = new Response(response.body, response);
  result.headers.append(
    'Server-Timing',
    `wallet_gateway_binding;dur=${bindingDurationMs.toFixed(1)}, wallet_gateway_total;dur=${(performance.now() - startedAt).toFixed(1)}`,
  );
  return result;
}

async function scheduled(
  event: CfScheduledEvent,
  env: TenantDeploymentGatewayEnv,
  _ctx: CfExecutionContext,
): Promise<void> {
  const binding = await resolveActiveTenantDeploymentFromServiceV1({
    deploymentLane: env.SEAMS_TENANT_DEPLOYMENT_LANE,
    service: env.WALLET_CONSOLE,
  });
  if (!binding) throw new Error('active tenant deployment binding is required');
  const boundEnv = bindTenantDeploymentToRuntimeEnvironmentV1(env, binding);
  await runRouterAbPrewarmScheduledV1(event, boundEnv);
}

export default { fetch, scheduled };
