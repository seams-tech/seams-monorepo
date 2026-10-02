/// <reference types="@cloudflare/workers-types" />
import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  dispatchKnownWalletHome,
  ConsoleRegistrationSetupDispatcher,
  WalletRegionalDispatch,
  type RegionalGatewayBindings,
} from '../../walletPlacement/regionalDispatch';
import { parseTenantRuntimeWriterV1 } from '../../tenantDeployment/homeVerification';
import { ConsoleRegistrationHomeAdmission } from '../../walletPlacement/registrationAdmission';
import { regionForRegistrationIngress } from '../../walletPlacement/home';
import type { CfExecutionContext, CfScheduledEvent } from '@seams/wallet-server/cloud-host';
import {
  handleSplitGatewayRequest,
  type CloudflareD1GatewayEnv,
} from '@seams/wallet-server/hosted-wallet-gateway';
import {
  runRouterAbPrewarmScheduledV1,
  readEnvironmentCsv,
  withCors,
} from '@seams/wallet-server/cloud-host';
import { resolveEmailOtpDeliveryProviderFromEnv } from '../../email/otp/emailOtpProviders';
import {
  bindTenantDeploymentToRuntimeEnvironmentV1,
  resolveActiveTenantDeploymentFromServiceV1,
} from '../../tenantDeployment/runtimeBinding';
import { tenantDeploymentPublicProjectionResponseV1 } from '../../tenantDeployment/publicProjection';
import { tenantD1HomeChallengeResponseV1 } from '../../tenantDeployment/homeChallenge';

// The split Wallet Gateway entrypoint (R105 Phase 4). Bindings: SIGNER_DB,
// MPC_ROUTER, SIGNING_WORKER, and the private WALLET_CONSOLE service binding.
// No CONSOLE_DB, no /console/* routes, no Console cron; deploying this
// entrypoint IS the gateway half of the cutover.

type TenantDeploymentGatewayEnv = CloudflareD1GatewayEnv &
  RegionalGatewayBindings & {
    readonly SEAMS_TENANT_DEPLOYMENT_LANE: string;
    readonly SEAMS_D1_HOME_ACCOUNT_ID: string;
    readonly SEAMS_D1_HOME_DATABASE_ID: string;
    readonly CF_VERSION_METADATA: { readonly id: unknown };
    readonly SEAMS_WALLET_HOME_CATALOG_JSON: string;
  };

async function handleGatewayRequest(
  request: Request,
  env: TenantDeploymentGatewayEnv,
  ctx: CfExecutionContext,
  entry: 'ingress' | 'home',
): Promise<Response> {
  const challenge = await tenantD1HomeChallengeResponseV1(
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
  const startedAt = performance.now();
  const pathname = new URL(request.url).pathname;
  const bindingTimingHeaders = new Headers();
  const binding = await resolveActiveTenantDeploymentFromServiceV1({
    writer: parseTenantRuntimeWriterV1('gateway', env.CF_VERSION_METADATA?.id),
    deploymentLane: env.SEAMS_TENANT_DEPLOYMENT_LANE,
    service: env.WALLET_CONSOLE,
    timingHeaders: bindingTimingHeaders,
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
  const authority = new ConsoleRegistrationHomeAdmission({
    service: env.WALLET_CONSOLE,
    writer: parseTenantRuntimeWriterV1('gateway', env.CF_VERSION_METADATA.id),
    scope: binding.tenant,
    localResource: binding.home,
    catalogJson: env.SEAMS_WALLET_HOME_CATALOG_JSON,
    ingressRegion: regionForRegistrationIngress(request, 'US'),
  });
  const transport = new WalletRegionalDispatch(env, entry);
  const forwarded = await dispatchKnownWalletHome(request, authority, transport);
  if (forwarded) {
    const response = new Response(forwarded.body, forwarded);
    withCors(
      response.headers,
      { corsOrigins: readEnvironmentCsv(boundEnv.RELAY_CORS_ORIGINS) },
      request,
    );
    return response;
  }
  const response = await handleSplitGatewayRequest(request, boundEnv, ctx, {
    registrationAuthority: authority,
    registrationSetupDispatcher:
      pathname === '/wallets/register/setup'
        ? new ConsoleRegistrationSetupDispatcher(
            authority,
            transport,
            new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: request.clone().body,
              redirect: 'manual',
            }),
          )
        : undefined,
    emailOtpDeliveryProvider: resolveEmailOtpDeliveryProviderFromEnv(boundEnv),
  });
  if (!pathname.startsWith('/router-ab/ecdsa-derivation/') && pathname !== '/wallet/session/status')
    return response;
  const result = new Response(response.body, response);
  const consoleTiming = bindingTimingHeaders.get('Server-Timing');
  if (consoleTiming) result.headers.append('Server-Timing', consoleTiming);
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
    writer: parseTenantRuntimeWriterV1('gateway', env.CF_VERSION_METADATA?.id),
    deploymentLane: env.SEAMS_TENANT_DEPLOYMENT_LANE,
    service: env.WALLET_CONSOLE,
  });
  if (!binding) throw new Error('active tenant deployment binding is required');
  const boundEnv = bindTenantDeploymentToRuntimeEnvironmentV1(env, binding);
  await runRouterAbPrewarmScheduledV1(event, boundEnv);
}

async function fetch(
  request: Request,
  env: TenantDeploymentGatewayEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  return handleGatewayRequest(request, env, ctx, 'ingress');
}

export class WalletHomeGateway extends WorkerEntrypoint<TenantDeploymentGatewayEnv> {
  override fetch(request: Request): Promise<Response> {
    return handleGatewayRequest(request, this.env, this.ctx, 'home');
  }
}

export default { fetch, scheduled };
