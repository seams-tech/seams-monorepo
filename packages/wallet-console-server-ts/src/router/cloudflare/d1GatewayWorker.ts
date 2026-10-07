import { TenantDeploymentStoreError } from '../../tenantDeployment/service';
import { D1RegionalDeploymentAdmission } from '../../tenantDeployment/regionalAdmission';
import { DeploymentFencedDatabase } from '../../tenantDeployment/fencedDatabase';
import { TenantDeploymentD1ResourceIdentityV1 } from '../../tenantDeployment/deploymentResource';
/// <reference types="@cloudflare/workers-types" />
import {
  dispatchKnownWalletHome,
  resolveLocalRegistrationContinuation,
  ConsoleRegistrationSetupDispatcher,
  WalletRegionalDispatch,
  type RegionalGatewayBindings,
} from '../../walletPlacement/regionalDispatch';
import { WalletPlacementConsoleBinding } from '../../walletPlacement/consoleBinding';
import { parseTenantRuntimeWriterV1 } from '../../tenantDeployment/resourceVerification';
import { ConsoleRegistrationHomeAdmission } from '../../walletPlacement/registrationAdmission';
import { resolveGatewayDeployment } from '../../walletPlacement/gatewaySession';
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
  resolveBoundTenantDeploymentRuntimeEnvironmentV1,
} from '../../tenantDeployment/runtimeBinding';
import { tenantDeploymentPublicProjectionResponseV1 } from '../../tenantDeployment/publicProjection';
import { tenantD1ResourceChallengeResponseV1 } from '../../tenantDeployment/resourceChallenge';

// The split Wallet Gateway entrypoint (R105 Phase 4). Bindings: SIGNER_DB,
// MPC_ROUTER, SIGNING_WORKER, and WALLET_CONSOLE.
// No CONSOLE_DB, no /console/* routes, no Console cron; deploying this
// entrypoint IS the gateway half of the cutover.

type TenantDeploymentGatewayEnv = CloudflareD1GatewayEnv &
  RegionalGatewayBindings & {
    readonly SEAMS_TENANT_DEPLOYMENT_LANE: string;
    readonly SEAMS_TENANT_STORAGE_NAMESPACE: string;
    readonly SEAMS_D1_HOME_ACCOUNT_ID: string;
    readonly SEAMS_D1_HOME_DATABASE_ID: string;
    readonly CF_VERSION_METADATA: { readonly id: unknown };
    readonly SEAMS_WALLET_HOME_CATALOG_JSON: string;
  };

async function handleGatewayRequest(
  request: Request,
  env: TenantDeploymentGatewayEnv,
  ctx: CfExecutionContext,
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
  const startedAt = performance.now();
  const pathname = new URL(request.url).pathname;
  const bindingTimingHeaders = new Headers();
  const writer = parseTenantRuntimeWriterV1('gateway', env.CF_VERSION_METADATA?.id, {
    accountId: env.SEAMS_D1_HOME_ACCOUNT_ID,
    databaseId: env.SEAMS_D1_HOME_DATABASE_ID,
  });
  const local = new D1RegionalDeploymentAdmission(env.SIGNER_DB,
    TenantDeploymentD1ResourceIdentityV1.parse({
      namespace: env.SEAMS_TENANT_STORAGE_NAMESPACE,
      accountId: env.SEAMS_D1_HOME_ACCOUNT_ID,
      databaseId: env.SEAMS_D1_HOME_DATABASE_ID,
    }));
  const localBinding = await local.resolveRuntimeBinding(env.SEAMS_TENANT_DEPLOYMENT_LANE, writer);
  if (!localBinding) {
    const unavailable = Response.json({ ok: false, code: 'tenant_deployment_unavailable' }, { status: 503 });
    withCors(unavailable.headers, { corsOrigins: readEnvironmentCsv(env.RELAY_CORS_ORIGINS) }, request);
    return unavailable;
  }
  const deployment = await resolveGatewayDeployment({
    binding: localBinding,
    database: new DeploymentFencedDatabase(env.SIGNER_DB, localBinding, writer),
    request,
    catalogJson: env.SEAMS_WALLET_HOME_CATALOG_JSON,
    writer,
    deploymentLane: env.SEAMS_TENANT_DEPLOYMENT_LANE,
    service: env.WALLET_CONSOLE,
    timingHeaders: bindingTimingHeaders,
  });
  if (deployment.kind === 'forward') {
    const forwarded = await new WalletRegionalDispatch(env).forward(deployment.home, request);
    const response = new Response(forwarded.body, forwarded);
    withCors(response.headers, { corsOrigins: readEnvironmentCsv(env.RELAY_CORS_ORIGINS) }, request);
    return response;
  }
  if (deployment.kind === 'rejected') {
    withCors(
      deployment.response.headers,
      { corsOrigins: readEnvironmentCsv(env.RELAY_CORS_ORIGINS) },
      request,
    );
    return deployment.response;
  }
  const { binding, session } = deployment;
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
  const boundEnv = bindTenantDeploymentToRuntimeEnvironmentV1(
    { ...env, SIGNER_DB: new DeploymentFencedDatabase(env.SIGNER_DB, binding, writer),
      WALLET_CONSOLE: new WalletPlacementConsoleBinding(env.WALLET_CONSOLE, writer) },
    binding,
  );
  const authority = new ConsoleRegistrationHomeAdmission({
    service: env.WALLET_CONSOLE,
    writer,
    scope: binding.tenant,
    environmentKey: binding.mode.environment === 'development' ? 'dev' : 'prod',
    localResource: {
      accountId: env.SEAMS_D1_HOME_ACCOUNT_ID,
      databaseId: env.SEAMS_D1_HOME_DATABASE_ID,
    },
    catalogJson: env.SEAMS_WALLET_HOME_CATALOG_JSON,
    ingressRegion: regionForRegistrationIngress(request, 'US'),
  });
  const sessionHome = authority.home();
  const transport = new WalletRegionalDispatch(env);
  const continuation = await resolveLocalRegistrationContinuation({
    request,
    database: boundEnv.SIGNER_DB,
    tenant: binding.tenant,
    session,
  });
  let forwarded: Response | null = null;
  if (continuation.kind === 'rejected') {
    forwarded = continuation.response;
  } else if (continuation.kind === 'absent') {
    forwarded = await dispatchKnownWalletHome(
      request,
      authority,
      transport,
      boundEnv.GOOGLE_OIDC_CLIENT_ID,
      session,
    );
  }
  if (forwarded) {
    const response = new Response(forwarded.body, forwarded);
    withCors(
      response.headers,
      { corsOrigins: readEnvironmentCsv(boundEnv.RELAY_CORS_ORIGINS) },
      request,
    );
    return response;
  }
  const handled = await handleSplitGatewayRequest(request, boundEnv, ctx, {
    sessionRouting: authority,
    identityStore: authority.identityStore(),
    credentialClaims: authority.identityStore(),
    syncChallenges: authority.identityStore().syncChallenges(),
    linkedDeviceBootstrap: authority.identityStore().linkedDeviceBootstrap(),
    linkedDeviceProofNonces: authority.identityStore().linkedDeviceProofNonces(),
    googleRegistrationAttempts: authority.registrationOffers(),
    recoveryRouting: authority,
    lifecycleRouting: authority,
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
  const response = new Response(handled.body, handled);
  if (!response.headers.has('X-Seams-Wallet-Region')) {
    response.headers.set('X-Seams-Wallet-Region', sessionHome.region);
  }
  withCors(response.headers, { corsOrigins: readEnvironmentCsv(boundEnv.RELAY_CORS_ORIGINS) }, request);
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
  const writer = parseTenantRuntimeWriterV1('gateway', env.CF_VERSION_METADATA?.id, {
    accountId: env.SEAMS_D1_HOME_ACCOUNT_ID,
    databaseId: env.SEAMS_D1_HOME_DATABASE_ID,
  });
  const boundEnv = await resolveBoundTenantDeploymentRuntimeEnvironmentV1(env, writer);
  if (!boundEnv) throw new Error('Active regional deployment admission is required');
  await runRouterAbPrewarmScheduledV1(event, boundEnv);
}

async function fetch(
  request: Request,
  env: TenantDeploymentGatewayEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  try {
    return await handleGatewayRequest(request, env, ctx);
  } catch (error) {
    if (!(error instanceof TenantDeploymentStoreError)) throw error;
    const response = Response.json({ ok: false, code: 'tenant_deployment_unavailable' }, {
      status: error.code === 'activation_conflict' ? 403 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
    withCors(response.headers, { corsOrigins: readEnvironmentCsv(env.RELAY_CORS_ORIGINS) }, request);
    return response;
  }
}

export default { fetch, scheduled };
