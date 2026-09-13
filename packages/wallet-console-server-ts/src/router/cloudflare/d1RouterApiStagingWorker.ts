import { requireStripeBillingProviderAdaptersFromEnv } from '@seams-internal/console-server/billing/stripeProvider';
import {
  type CfExecutionContext,
  type CfScheduledEvent,
  type D1DatabaseLike,
  type FetchHandler,
  readEnvironmentCsv,
  readEnvironmentString,
  requireEnvironmentString,
  runRouterAbPrewarmScheduledV1,
} from '@seams/wallet-server/cloud-host';
import {
  createHostedWalletGatewayCompositionV1,
  handleSplitGatewayRequest,
  handleSplitGatewayWalletRuntimeRequest,
  readStagingHostedWalletOrigins,
  stagingSigningSessionSealOptions,
  type CloudflareD1GatewayEnv,
  type HostedWalletGatewayDependenciesV1,
} from '@seams/wallet-server/hosted-wallet-gateway';

import { resolveEmailOtpDeliveryProviderFromEnv } from '../../email/otp/emailOtpProviders';
import {
  resolveSponsoredEvmCallConfigFromWorkerEnv,
  resolveSponsoredEvmWorkerExecutionAdapter,
} from '../../sponsorship/evmWorkerExecutionAdapter';
import { resolveSponsoredExecutionPricingFromEnv } from '../../sponsorship/pricing';
import { createHostedWalletConsoleRouter } from '../consoleComposition';
import { HostedConsoleAuthHandler } from '../hostedConsoleAuth';
import type { RouterApiCloudflareConsoleWorkerEnv } from './cloudflareConsole.types';
import {
  consoleCoreServicesFromBundle,
  createCloudflareD1ConsoleServiceBundle,
  createConsoleWebhookSecretCipherFromEnv,
  walletConsoleServicesFromBundle,
} from './d1ConsoleServices';
import {
  createConsoleSessionAuthAdapter,
  createHmacSessionAdapterFromEnv,
} from './d1StagingSession';
import { createCloudflareCron, resolveCloudflareConsoleEmailDispatchCronOptions } from './cron';

export {
  handleSplitGatewayRequest,
  handleSplitGatewayWalletRuntimeRequest,
  readStagingHostedWalletOrigins,
  stagingSigningSessionSealOptions,
};
export type { CloudflareD1GatewayEnv };

export async function dispatchHostedGatewayRequest(
  consoleHandler: FetchHandler,
  routerApiHandler: FetchHandler,
  request: Request,
  env?: object,
  ctx?: CfExecutionContext,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const handler =
    pathname === '/console' || pathname.startsWith('/console/') ? consoleHandler : routerApiHandler;
  return await handler(request, env, ctx);
}

type CloudflareD1RouterApiStagingEnv = CloudflareD1GatewayEnv &
  RouterApiCloudflareConsoleWorkerEnv & {
    readonly CONSOLE_DB: D1DatabaseLike;
    readonly SPONSORED_EVM_EXECUTORS_JSON?: string;
    readonly SPONSORED_EXECUTION_REAL_PRICING_JSON?: string;
    readonly SPONSORED_EXECUTION_STATIC_PRICING_JSON?: string;
    readonly STRIPE_API_SK?: string;
    readonly STRIPE_WEBHOOK_SECRET?: string;
    readonly STRIPE_API_BASE_URL?: string;
    readonly STRIPE_API_TIMEOUT_MS?: string;
    readonly CONSOLE_PLATFORM_SUPPORT_EMAILS?: string;
    readonly CONSOLE_BASE_URL?: string;
    readonly CONSOLE_SESSION_HMAC_SECRET: string;
    readonly CONSOLE_SESSION_COOKIE_NAME: string;
    readonly CONSOLE_SESSION_ISSUER: string;
    readonly CONSOLE_SESSION_AUDIENCE: string;
    readonly GOOGLE_OIDC_CLIENT_ID?: string;
    readonly GITHUB_OAUTH_CLIENT_ID?: string;
    readonly GITHUB_OAUTH_CLIENT_SECRET?: string;
    readonly GITHUB_OAUTH_CALLBACK_URL?: string;
  };

type ReadyRow = { readonly table_count?: unknown };

const CONSOLE_READY_TABLES = Object.freeze([
  'organizations',
  'projects',
  'environments',
  'organization_memberships',
  'organization_admin_permissions',
  'organization_invitations',
  'project_member_access',
  'organization_owner_events',
  'api_keys',
  'billing_accounts',
  'billing_ledger_entries',
  'billing_ledger_postings',
  'billing_credit_purchases',
  'billing_refunds',
  'billing_prepaid_reservations',
  'stripe_webhook_events',
  'billing_stripe_post_processing_outbox',
  'sponsorship_spend_cap_reservations',
  'sponsorship_pricing_rules',
  'sponsored_call_records',
  'console_email_outbox',
  'console_email_deliveries',
]);

async function fetch(
  request: Request,
  env: CloudflareD1RouterApiStagingEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== '/console' && !pathname.startsWith('/console/')) {
    return await handleSplitGatewayRequest(request, env, ctx, gatewayDependencies(env));
  }
  const consoleHandler = await createConsoleHandler(env);
  return await consoleHandler(request, env, ctx);
}

async function createConsoleHandler(env: CloudflareD1RouterApiStagingEnv): Promise<FetchHandler> {
  const namespace = requireEnvironmentString(env, 'SEAMS_TENANT_STORAGE_NAMESPACE');
  const sponsoredEvmCallConfig = await resolveSponsoredEvmCallConfigFromWorkerEnv(env);
  const bundle = await createCloudflareD1ConsoleServiceBundle({
    bindings: {
      consoleDatabase: env.CONSOLE_DB,
      signerMetadataDatabase: env.SIGNER_DB,
    },
    route: { namespace },
    adapters: {
      ensureSchema: false,
      billingProviders: requireStripeBillingProviderAdaptersFromEnv(env),
      billingEmailConsoleBaseUrl: requireEnvironmentString(env, 'CONSOLE_BASE_URL'),
      ...(readEnvironmentString(env, 'CONSOLE_DOCS_BASE_URL')
        ? {
            onboardingEmail: {
              consoleBaseUrl: requireEnvironmentString(env, 'CONSOLE_BASE_URL'),
              docsBaseUrl: requireEnvironmentString(env, 'CONSOLE_DOCS_BASE_URL'),
            },
          }
        : {}),
      sponsoredEvmCallConfig,
      resolveSponsoredEvmExecutionAdapter: resolveSponsoredEvmWorkerExecutionAdapter,
      sponsorshipPricing: resolveSponsoredExecutionPricingFromEnv(env),
      webhookSecretCipher: createConsoleWebhookSecretCipherFromEnv(env),
    },
  });
  const wallet = await createHostedWalletGatewayCompositionV1(env, gatewayDependencies(env));
  const session = createHmacSessionAdapterFromEnv({
    env,
    secretName: 'CONSOLE_SESSION_HMAC_SECRET',
    cookieName: requireEnvironmentString(env, 'CONSOLE_SESSION_COOKIE_NAME'),
    issuer: requireEnvironmentString(env, 'CONSOLE_SESSION_ISSUER'),
    audience: requireEnvironmentString(env, 'CONSOLE_SESSION_AUDIENCE'),
  });
  const auth = createConsoleSessionAuthAdapter({
    session,
    organizationAccess: bundle.organizationAccess,
    platformSupportEmails: readEnvironmentString(env, 'CONSOLE_PLATFORM_SUPPORT_EMAILS'),
  });
  const consoleRouter = createHostedWalletConsoleRouter({
    core: consoleCoreServicesFromBundle(bundle),
    walletConsole: walletConsoleServicesFromBundle(bundle),
    tenantStorage: {
      resolver: bundle.tenantStorageRouteResolver,
      namespace: bundle.tenantStorageNamespace,
    },
    corsOrigins: readEnvironmentCsv(env.RELAY_CORS_ORIGINS),
    auth,
    session,
    readyCheck: createConsoleReadyCheck(env),
    billingStripeWebhookSigningSecret: readEnvironmentString(env, 'STRIPE_WEBHOOK_SECRET'),
  });
  const hosted = new HostedConsoleAuthHandler({
    handler: consoleRouter,
    identity: wallet.service.identity,
    providers: consoleProviderOptions(env),
    session,
    account: bundle.account,
    orgProjectEnv: bundle.orgProjectEnv,
    corsOrigins: readEnvironmentCsv(env.RELAY_CORS_ORIGINS),
  });
  return hosted.fetch.bind(hosted);
}

function consoleProviderOptions(
  env: CloudflareD1RouterApiStagingEnv,
): import('../hostedConsoleAuth').HostedConsoleProviderOptions {
  const googleClientId = readEnvironmentString(env, 'GOOGLE_OIDC_CLIENT_ID');
  const githubClientId = readEnvironmentString(env, 'GITHUB_OAUTH_CLIENT_ID');
  const githubClientSecret = readEnvironmentString(env, 'GITHUB_OAUTH_CLIENT_SECRET');
  const githubCallbackUrl = readEnvironmentString(env, 'GITHUB_OAUTH_CALLBACK_URL');
  return {
    google: googleClientId ? { configured: true, clientId: googleClientId } : { configured: false },
    github:
      githubClientId && githubClientSecret && githubCallbackUrl
        ? {
            configured: true,
            clientId: githubClientId,
            callbackUrl: githubCallbackUrl,
          }
        : { configured: false },
  };
}

function gatewayDependencies(
  env: CloudflareD1RouterApiStagingEnv,
): HostedWalletGatewayDependenciesV1 {
  return { emailOtpDeliveryProvider: resolveEmailOtpDeliveryProviderFromEnv(env) };
}

function createConsoleReadyCheck(env: CloudflareD1RouterApiStagingEnv): () => Promise<void> {
  return assertD1Tables.bind(undefined, env.CONSOLE_DB, 'CONSOLE_DB', CONSOLE_READY_TABLES);
}

async function assertD1Tables(
  database: D1DatabaseLike,
  label: string,
  tables: readonly string[],
): Promise<void> {
  const names = tables.map(d1StringLiteral).join(', ');
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS table_count
         FROM sqlite_master
        WHERE type = 'table'
          AND name IN (${names})`,
    )
    .first<ReadyRow>();
  const count = Number(row?.table_count || 0);
  if (count !== tables.length) {
    throw new Error(`${label} migration has created ${count} of ${tables.length} ready tables`);
  }
}

function d1StringLiteral(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`invalid D1 table name ${value}`);
  return `'${value}'`;
}

function gatewayScheduledHandler(env: CloudflareD1RouterApiStagingEnv) {
  const runtimeProfile = readEnvironmentString(env, 'CONSOLE_EMAIL_RUNTIME_PROFILE');
  if (!runtimeProfile) return createCloudflareCron({});
  return createCloudflareCron({
    consoleEmailDispatch: resolveCloudflareConsoleEmailDispatchCronOptions({
      env,
      database: env.CONSOLE_DB,
      namespace: requireEnvironmentString(env, 'SEAMS_TENANT_STORAGE_NAMESPACE'),
      ensureSchema: false,
      invitationDelivery: { kind: 'DISABLED' },
    }),
  });
}

async function scheduled(
  event: CfScheduledEvent,
  env: CloudflareD1RouterApiStagingEnv,
  ctx: CfExecutionContext,
): Promise<void> {
  await Promise.all([
    gatewayScheduledHandler(env)(event, env, ctx),
    runRouterAbPrewarmScheduledV1(event, env),
  ]);
}

export default { fetch, scheduled };
