import { recoveryTrustResponse } from '../../tenantRootSecurity/recoveryTrustRoute';
import { createRestoreAccessRoute } from '../../tenantRootSecurity/restoreAccessRoute';
import { withCors } from '@seams/wallet-server/cloud-host';
import { TenantRootCustodyWorkerRouteV1 } from '../../tenantRootSecurity/custodyWorkerRoute';
import { D1TenantRootActiveLineageResolverV1 } from '../../tenantRootSecurity/activeLineageD1';
import { createTenantRootRestoreWorkerRouteV1 } from '../../tenantRootSecurity/restoreWorkerRoute';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createWalletConsoleRouter } from '../consoleComposition';
import { attachConsoleRouteSurface } from '@seams-internal/console-server/router/consoleRouteSurface';
import { resolveCompleteWalletConsoleRouteSurface } from '../walletConsoleRouteDefinitions';
import { HostedConsoleAuthHandler } from '../hostedConsoleAuth';
import { createWalletConsoleOpsHandler } from '../../serviceBinding/walletConsoleOpsHandler';
import { createWalletRuntimeOpsClient } from '../../serviceBinding/walletRuntimeOpsClient';
import type { WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import {
  createWalletControlClientBindings,
  WALLET_CONTROL_AUTH_MARKER_V1,
} from '@seams/wallet-server/cloud-host';
import { createWalletConsoleRelayHandler } from '../../serviceBinding/walletConsoleRelay';
import {
  createConsoleRouterApiRouteExtensions,
  DEFAULT_SIGNED_DELEGATE_ROUTE,
} from '../routeExtensions';
import { DEFAULT_SPONSORED_EVM_CALL_ROUTE } from '../../sponsorship/evmRoutes';
import {
  resolveSponsoredEvmCallConfigFromWorkerEnv,
  resolveSponsoredEvmWorkerExecutionAdapter,
} from '../../sponsorship/evmWorkerExecutionAdapter';
import { resolveSponsoredExecutionPricingFromEnv } from '../../sponsorship/pricing';
import { createWalletProjectEnvironmentResolver } from '../projectEnvironmentAdapter';
import {
  createRouterApiBillingUsageMeterAdapter,
  createRouterApiKeyAuthAdapter,
  createRouterApiPublishableKeyAuthAdapter,
} from '@seams-internal/wallet-console-server/router/routerApiKeyAuth';
import {
  createConsoleProviderIdentity,
  type ConsoleGithubOAuthConfig,
} from '@seams-internal/console-server/boundary/providerIdentity';
import {
  consoleCoreServicesFromBundle,
  createCloudflareD1ConsoleOnlyServiceBundle,
  createConsoleWebhookSecretCipherFromEnv,
  walletConsoleServicesFromBundle,
} from './d1ConsoleServices';
import type {
  CfExecutionContext,
  CfScheduledEvent,
  FetchHandler,
  ScheduledHandler,
} from '@seams/wallet-server/cloud-host';
import {
  createConsoleSessionAuthAdapter,
  createHmacSessionAdapterFromEnv,
  type CloudflareD1StagingSessionEnv,
} from './d1StagingSession';
import {
  readEnvironmentString as readEnvString,
  requireEnvironmentString as requireEnvString,
} from '@seams/wallet-server/cloud-host';
import { requireStripeBillingProviderAdaptersFromEnv } from '@seams-internal/console-server/billing/stripeProvider';
import {
  createCloudflareCron,
  resolveCloudflareConsoleEmailDispatchCronOptions,
  type TenantRootRefreshResumptionRunner,
} from './cron';
import type { RouterApiCloudflareConsoleWorkerEnv } from './cloudflareConsole.types';
import { createD1TenantRootCreationGrantServiceV1 } from '../../tenantRootCreation/d1';
import { createD1TenantRootStepUpStoreV1 } from '../../tenantRootSecurity/stepUpStore';
import { createD1ConsoleStepUpCredentialStoreV1 } from '../../tenantRootSecurity/stepUpCredentialStore';
import { createConsoleStepUpRouteV1 } from '../../tenantRootSecurity/stepUpRoute';
import { createConsoleWebAuthnPortV1 } from '../../tenantRootSecurity/stepUpWebAuthnAdapter';
import {
  createD1TenantRootOperationResumptionStoreV1,
  createD1TenantRootOperationStoreV1,
} from '../../tenantRootSecurity/d1';
import { createTenantRootSecurityStateReaderV1 } from '../../tenantRootSecurity/stateReader';
import { createConsoleTenantRootAuditWriterV1 } from '../../tenantRootSecurity/auditWriter';
import {
  createD1TenantRootScheduledActiveGrantReaderV1,
  createTenantRootScheduledRotationIntentV1,
} from '../../tenantRootSecurity/scheduledIntent';
import { createTenantRootSecurityConsoleRouteV1 } from '../../tenantRootSecurity/consoleRoute';
import {
  createTenantRootCreationConsoleRouteV1,
  createTenantRootRefreshConsoleRouteV1,
  dispatchTenantRootRefreshOperationV1,
} from '../../tenantRootCreation/consoleRoute';

interface CloudflareD1ConsoleStagingEnv
  extends CloudflareD1StagingSessionEnv, RouterApiCloudflareConsoleWorkerEnv {
  readonly CONSOLE_DB: D1DatabaseLike;
  readonly WALLET_RUNTIME: WalletRuntimeServiceBinding;
  readonly TENANT_ROOT_RESTORE_DESTINATION_JSON?: string;
  readonly TENANT_ROOT_RESTORE_ACCESS_JSON?: string;
  readonly TENANT_ROOT_RECOVERY_CERTIFICATES_JSON?: string;
  readonly TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID?: string;
  readonly TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED?: string;
  readonly SEAMS_TENANT_STORAGE_NAMESPACE?: string;
  // Console step-up relying party. The id and origin are required wherever the
  // refresh route is mounted, because without them no step-up can be obtained
  // and rotation is unreachable.
  readonly CONSOLE_STEP_UP_RP_ID?: string;
  readonly CONSOLE_STEP_UP_RP_NAME?: string;
  readonly CONSOLE_STEP_UP_ORIGIN?: string;
  readonly CONSOLE_BASE_URL?: string;
  readonly CONSOLE_SESSION_HMAC_SECRET?: string;
  readonly CONSOLE_SESSION_COOKIE_NAME?: string;
  readonly CONSOLE_SESSION_ISSUER?: string;
  readonly CONSOLE_SESSION_AUDIENCE?: string;
  readonly CONSOLE_PLATFORM_SUPPORT_EMAILS?: string;
  readonly STRIPE_API_SK?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_API_BASE_URL?: string;
  readonly STRIPE_API_TIMEOUT_MS?: string;
  readonly GOOGLE_OIDC_CLIENT_ID?: string;
  readonly GITHUB_OAUTH_CLIENT_ID?: string;
  readonly GITHUB_OAUTH_CLIENT_SECRET?: string;
  readonly GITHUB_OAUTH_CALLBACK_URL?: string;
  readonly CONSOLE_CORS_ORIGINS?: string;
  readonly SPONSORED_EVM_EXECUTORS_JSON?: string;
  readonly SPONSORED_EXECUTION_REAL_PRICING_JSON?: string;
  readonly SPONSORED_EXECUTION_STATIC_PRICING_JSON?: string;
}

function consoleGithubOAuthConfig(
  env: CloudflareD1ConsoleStagingEnv,
): ConsoleGithubOAuthConfig | undefined {
  const clientId = readEnvString(env, 'GITHUB_OAUTH_CLIENT_ID');
  const clientSecret = readEnvString(env, 'GITHUB_OAUTH_CLIENT_SECRET');
  const callbackUrl = readEnvString(env, 'GITHUB_OAUTH_CALLBACK_URL');
  if (!clientId || !clientSecret || !callbackUrl) return undefined;
  return { clientId, clientSecret, callbackUrl };
}

function consoleCorsOrigins(env: CloudflareD1ConsoleStagingEnv): string[] {
  return String(env.CONSOLE_CORS_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

type ConsoleReadyRow = {
  readonly table_count?: unknown;
};

const CONSOLE_STAGING_READY_TABLES = Object.freeze([
  'organizations',
  'projects',
  'environments',
  'organization_memberships',
  'organization_admin_permissions',
  'organization_invitations',
  'project_member_access',
  'organization_owner_events',
  'billing_accounts',
  'billing_prepaid_reservations',
  'billing_stripe_post_processing_outbox',
  'sponsorship_pricing_rules',
  'sponsored_call_records',
  'runtime_snapshot_outbox',
  'console_email_outbox',
  'console_email_deliveries',
  'tenant_root_creation_grants',
]);

async function createConsoleHandler(env: CloudflareD1ConsoleStagingEnv): Promise<FetchHandler> {
  const namespace = requireEnvString(env, 'SEAMS_TENANT_STORAGE_NAMESPACE');
  const walletRuntime = createWalletRuntimeOpsClient(env.WALLET_RUNTIME);
  const walletControl = createWalletControlClientBindings(env.WALLET_RUNTIME);
  const emailDispatch = resolveCloudflareConsoleEmailDispatchCronOptions({
    env,
    database: env.CONSOLE_DB,
    namespace,
    ensureSchema: false,
    invitationDelivery: { kind: 'ENABLED' },
  });
  const invitationSecretCipher = emailDispatch.invitationSecretCipher;
  if (!invitationSecretCipher) {
    throw new Error('Console invitation email cipher was not configured');
  }
  const sponsoredEvmCallConfig = await resolveSponsoredEvmCallConfigFromWorkerEnv(env);
  const bundle = await createCloudflareD1ConsoleOnlyServiceBundle({
    bindings: {
      consoleDatabase: env.CONSOLE_DB,
    },
    route: {
      namespace,
    },
    adapters: {
      ensureSchema: false,
      billingProviders: requireStripeBillingProviderAdaptersFromEnv(env),
      billingEmailConsoleBaseUrl: requireEnvString(env, 'CONSOLE_BASE_URL'),
      organizationEmail: {
        invitationSecretCipher,
        consoleBaseUrl: requireEnvString(env, 'CONSOLE_BASE_URL'),
      },
      sponsoredEvmCallConfig,
      resolveSponsoredEvmExecutionAdapter: resolveSponsoredEvmWorkerExecutionAdapter,
      sponsorshipPricing: resolveSponsoredExecutionPricingFromEnv(env),
      webhookSecretCipher: createConsoleWebhookSecretCipherFromEnv(env),
      walletBalanceReader: {
        resolveWalletIdentities: walletRuntime.getWalletIdentities,
      },
    },
  });
  const session = createHmacSessionAdapterFromEnv({
    env,
    secretName: 'CONSOLE_SESSION_HMAC_SECRET',
    cookieName: readEnvString(env, 'CONSOLE_SESSION_COOKIE_NAME'),
    issuer: readEnvString(env, 'CONSOLE_SESSION_ISSUER'),
    audience: readEnvString(env, 'CONSOLE_SESSION_AUDIENCE'),
  });
  const auth = createConsoleSessionAuthAdapter({
    session,
    organizationAccess: bundle.organizationAccess,
    platformSupportEmails: readEnvString(env, 'CONSOLE_PLATFORM_SUPPORT_EMAILS'),
  });
  const router = createWalletConsoleRouter({
    corsOrigins: consoleCorsOrigins(env),
    core: consoleCoreServicesFromBundle(bundle),
    walletConsole: walletConsoleServicesFromBundle(bundle),
    auth,
    readyCheck: createConsoleReadyCheck(env),
    billingStripeWebhookSigningSecret: requireEnvString(env, 'STRIPE_WEBHOOK_SECRET'),
  });
  const relayHandler = createWalletConsoleRelayHandler(
    createConsoleRouterApiRouteExtensions({
      apiKeyAuth: createRouterApiKeyAuthAdapter(bundle.apiKeys),
      wallets: bundle.wallets,
      signedDelegate: {
        route: DEFAULT_SIGNED_DELEGATE_ROUTE,
        authService: walletRuntime,
        billing: bundle.billing,
        ledger: bundle.sponsoredCalls,
        runtimeSnapshots: bundle.runtimeSnapshots,
        publishableKeyAuth: createRouterApiPublishableKeyAuthAdapter(bundle.apiKeys),
        observabilityIngestion: bundle.observabilityIngestion,
        prepaidReservations: bundle.prepaidReservations,
        pricing: bundle.sponsorshipPricing,
        spendCaps: bundle.spendCaps,
        webhooks: bundle.webhooks,
      },
      ...(sponsoredEvmCallConfig
        ? {
            sponsoredEvmCall: {
              route: DEFAULT_SPONSORED_EVM_CALL_ROUTE,
              publishableKeyAuth: createRouterApiPublishableKeyAuthAdapter(bundle.apiKeys),
              billing: bundle.billing,
              ledger: bundle.sponsoredCalls,
              runtimeSnapshots: bundle.runtimeSnapshots,
              config: sponsoredEvmCallConfig,
              resolveExecutionAdapter: resolveSponsoredEvmWorkerExecutionAdapter,
              observabilityIngestion: bundle.observabilityIngestion,
              prepaidReservations: bundle.prepaidReservations,
              pricing: bundle.sponsorshipPricing,
              spendCaps: bundle.spendCaps,
              webhooks: bundle.webhooks,
            },
          }
        : {}),
    }),
  );
  const tenantRootGrants = createD1TenantRootCreationGrantServiceV1({
    database: env.CONSOLE_DB,
    namespace,
  });
  const tenantRootRestoreRoute = await createTenantRootRestoreWorkerRouteV1({
    destinationJson: env.TENANT_ROOT_RESTORE_DESTINATION_JSON,
    database: env.CONSOLE_DB,
    namespace: namespace,
    router: walletControl.router,
    internalServiceAuthSecret: WALLET_CONTROL_AUTH_MARKER_V1,
    grantKeyId: requireEnvString(env, 'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID'),
    grantSigningSeedB64u: requireEnvString(env, 'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED'),
    audit: createConsoleTenantRootAuditWriterV1({ audit: bundle.audit, actorType: 'USER' }),
  });
  const tenantRootCreationRoute = createTenantRootCreationConsoleRouteV1({
    auth,
    orgProjectEnv: bundle.orgProjectEnv,
    grants: tenantRootGrants,
    router: {
      fetch: (input, init) => walletControl.router.fetch(new Request(input, init)),
    },
    internalServiceAuthSecret: WALLET_CONTROL_AUTH_MARKER_V1,
    grantAuthorityKeyId: requireEnvString(env, 'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID'),
    grantAuthoritySigningSeedB64u: requireEnvString(
      env,
      'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED',
    ),
  });
  const tenantRootStepUp = createD1TenantRootStepUpStoreV1({
    database: env.CONSOLE_DB,
    namespace,
  });
  // Mounted with the refresh route, never without it: the refresh route now
  // refuses without fresh step-up, and this is the only way to obtain it.
  const consoleStepUpRoute = createConsoleStepUpRouteV1({
    auth,
    credentials: createD1ConsoleStepUpCredentialStoreV1({
      database: env.CONSOLE_DB,
      namespace,
    }),
    stepUp: tenantRootStepUp,
    webAuthn: createConsoleWebAuthnPortV1({
      rpId: requireEnvString(env, 'CONSOLE_STEP_UP_RP_ID'),
      rpName: readEnvString(env, 'CONSOLE_STEP_UP_RP_NAME') || 'Seams Console',
      expectedOrigin: requireEnvString(env, 'CONSOLE_STEP_UP_ORIGIN'),
    }),
  });
  const tenantRootCustody = new TenantRootCustodyWorkerRouteV1({
    auth,
    orgProjectEnv: bundle.orgProjectEnv,
    stepUp: tenantRootStepUp,
    database: env.CONSOLE_DB,
    namespace: namespace,
    state: createTenantRootSecurityStateReaderV1({
      activeRoots: new D1TenantRootActiveLineageResolverV1(env.CONSOLE_DB, namespace),
      router: walletControl.router,
      internalServiceAuthSecret: WALLET_CONTROL_AUTH_MARKER_V1,
    }),
    organizationAccess: bundle.organizationAccess,
    audit: createConsoleTenantRootAuditWriterV1({ audit: bundle.audit, actorType: 'USER' }),
    internalServiceAuthSecret: WALLET_CONTROL_AUTH_MARKER_V1,
    certificatesJson: env.TENANT_ROOT_RECOVERY_CERTIFICATES_JSON,
    controlPlane: walletControl.controlPlane,
    deriverA: walletControl.deriverA,
    deriverB: walletControl.deriverB,
  });
  // Reads only: rotation is the refresh route below, and polling reads the
  // durable operation that route wrote.
  const restoreAccessRoute = await createRestoreAccessRoute(
    {
      audit: bundle.audit,
      database: env.CONSOLE_DB,
      namespace: namespace,
      isOwner: tenantRootCustody.isOrganizationOwner.bind(tenantRootCustody),
      auth,
      orgProjectEnv: bundle.orgProjectEnv,
      stepUp: tenantRootStepUp,
    },
    env.TENANT_ROOT_RESTORE_ACCESS_JSON,
  );
  const tenantRootSecurityReadRoute = createTenantRootSecurityConsoleRouteV1({
    auth,
    orgProjectEnv: bundle.orgProjectEnv,
    stepUp: tenantRootStepUp,
    state: tenantRootCustody,
    operations: (scope) =>
      createD1TenantRootOperationStoreV1({
        database: env.CONSOLE_DB,
        namespace,
        ...scope,
      }),
  });
  const tenantRootRefreshRoute = createTenantRootRefreshConsoleRouteV1({
    audit: createConsoleTenantRootAuditWriterV1({ audit: bundle.audit, actorType: 'USER' }),
    operations: (scope) =>
      createD1TenantRootOperationStoreV1({
        database: env.CONSOLE_DB,
        namespace: namespace,
        ...scope,
      }),
    auth,
    orgProjectEnv: bundle.orgProjectEnv,
    state: tenantRootCustody,
    router: {
      fetch: (input, init) => walletControl.router.fetch(new Request(input, init)),
    },
    internalServiceAuthSecret: WALLET_CONTROL_AUTH_MARKER_V1,
    stepUp: tenantRootStepUp,
  });
  // Private service-binding target: exactly the five declared Wallet Console
  // operations, served ahead of the console router.
  const opsHandler = createWalletConsoleOpsHandler({
    apiKeyAuth: createRouterApiKeyAuthAdapter(bundle.apiKeys),
    publishableKeyAuth: createRouterApiPublishableKeyAuthAdapter(bundle.apiKeys),
    usageMeter: createRouterApiBillingUsageMeterAdapter(bundle.billing, {
      orgProjectEnv: bundle.orgProjectEnv,
      wallets: bundle.wallets,
    }),
    projectEnvironments: createWalletProjectEnvironmentResolver(bundle.orgProjectEnv),
    tenantRootActiveLineage: new D1TenantRootActiveLineageResolverV1(env.CONSOLE_DB, namespace),
  });
  const routerWithOps: FetchHandler = async (request, workerEnv, ctx) => {
    const trustResponse = await recoveryTrustResponse(
      walletControl.controlPlane,
      WALLET_CONTROL_AUTH_MARKER_V1,
      requireEnvString(env, 'CONSOLE_STEP_UP_ORIGIN'),
      request,
    );
    if (trustResponse) return trustResponse;
    const accessResponse = await restoreAccessRoute(request);
    if (accessResponse) return accessResponse;
    const opsResponse = await opsHandler(request);
    if (opsResponse) return opsResponse;
    const tenantRootCustodyResponse = await tenantRootCustody.fetch(request);
    if (tenantRootCustodyResponse) return tenantRootCustodyResponse;
    const tenantRootRestoreResponse = await tenantRootRestoreRoute(request);
    if (tenantRootRestoreResponse) return tenantRootRestoreResponse;
    const tenantRootCreationResponse = await tenantRootCreationRoute(request);
    if (tenantRootCreationResponse) return tenantRootCreationResponse;
    const tenantRootRefreshResponse = await tenantRootRefreshRoute(request);
    if (tenantRootRefreshResponse) return tenantRootRefreshResponse;
    const consoleStepUpResponse = await consoleStepUpRoute(request);
    if (consoleStepUpResponse) return consoleStepUpResponse;
    const tenantRootSecurityReadResponse = await tenantRootSecurityReadRoute(request);
    if (tenantRootSecurityReadResponse) return tenantRootSecurityReadResponse;
    const relayResponse = await relayHandler(request, ctx);
    if (relayResponse) return relayResponse;
    return await router(request, workerEnv, ctx);
  };
  // The Console Worker owns /console/auth/* end-to-end: provider verification
  // is Console-owned (no signer D1, Wasm, or identity-link store involved).
  const authHandler = new HostedConsoleAuthHandler({
    handler: routerWithOps,
    identity: createConsoleProviderIdentity({
      googleOidcClientId: readEnvString(env, 'GOOGLE_OIDC_CLIENT_ID'),
      githubOAuth: consoleGithubOAuthConfig(env),
    }),
    session,
    account: bundle.account,
    orgProjectEnv: bundle.orgProjectEnv,
    corsOrigins: consoleCorsOrigins(env),
  });
  return attachConsoleRouteSurface(
    authHandler.fetch.bind(authHandler),
    resolveCompleteWalletConsoleRouteSurface(),
  );
}

function consoleHandler(env: CloudflareD1ConsoleStagingEnv): Promise<FetchHandler> {
  return createConsoleHandler(env);
}

function createConsoleReadyCheck(env: CloudflareD1ConsoleStagingEnv): () => Promise<void> {
  const check = new ConsoleStagingReadyCheck(env);
  return check.check.bind(check);
}

class ConsoleStagingReadyCheck {
  constructor(private readonly env: CloudflareD1ConsoleStagingEnv) {}

  async check(): Promise<void> {
    await assertD1Tables({
      database: this.env.CONSOLE_DB,
      label: 'CONSOLE_DB',
      tables: CONSOLE_STAGING_READY_TABLES,
    });
  }
}

async function assertD1Tables(input: {
  readonly database: D1DatabaseLike;
  readonly label: string;
  readonly tables: readonly string[];
}): Promise<void> {
  const row = await input.database
    .prepare(
      `SELECT COUNT(*) AS table_count
         FROM sqlite_master
        WHERE type = 'table'
          AND name IN (${d1StringList(input.tables)})`,
    )
    .first<ConsoleReadyRow>();
  const count = Number(row?.table_count || 0);
  if (count !== input.tables.length) {
    throw new Error(
      `${input.label} migration has created ${count} of ${input.tables.length} staging-ready tables`,
    );
  }
}

function d1StringList(values: readonly string[]): string {
  return values.map(d1StringLiteral).join(', ');
}

function d1StringLiteral(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error(`invalid D1 table name ${value}`);
  }
  return `'${value}'`;
}

async function fetch(
  request: Request,
  env: CloudflareD1ConsoleStagingEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    const response = new Response(null, { status: 204 });
    withCors(response.headers, { corsOrigins: consoleCorsOrigins(env) }, request);
    return response;
  }
  const handler = await consoleHandler(env);
  const response = await handler(request, env, ctx);
  const result = new Response(response.body, response);
  withCors(result.headers, { corsOrigins: consoleCorsOrigins(env) }, request);
  return result;
}

async function runConsoleTenantRootRefreshResumptionV1(
  env: CloudflareD1ConsoleStagingEnv,
  input: { readonly scheduledTimeMs: number | undefined },
): Promise<void> {
  const namespace = requireEnvString(env, 'SEAMS_TENANT_STORAGE_NAMESPACE');
  const walletControl = createWalletControlClientBindings(env.WALLET_RUNTIME);
  const bundle = await createCloudflareD1ConsoleOnlyServiceBundle({
    bindings: { consoleDatabase: env.CONSOLE_DB },
    route: { namespace },
    adapters: { ensureSchema: false },
  });
  const resumption = createD1TenantRootOperationResumptionStoreV1({
    database: env.CONSOLE_DB,
    namespace,
  });
  const pending = await resumption.listPending(1);
  const nowMs = input.scheduledTimeMs ?? Date.now();
  const pendingOperation = pending[0];
  if (pendingOperation) {
    const operation = pendingOperation;
    const audit = createConsoleTenantRootAuditWriterV1({
      audit: bundle.audit,
      actorType: operation.entry.triggerKind === 'scheduled' ? 'SYSTEM' : 'USER',
    });
    const operations = createD1TenantRootOperationStoreV1({
      database: env.CONSOLE_DB,
      namespace,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
    });
    await dispatchTenantRootRefreshOperationV1({
      dependencies: {
        router: {
          fetch: (request, init) => walletControl.router.fetch(new Request(request, init)),
        },
        internalServiceAuthSecret: WALLET_CONTROL_AUTH_MARKER_V1,
        audit,
        operations,
      },
      entry: operation.entry,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
      stepUpMethod: null,
      nowMs,
    });
    return;
  }

  const scheduledIntent = await createTenantRootScheduledRotationIntentV1(
    {
      grants: createD1TenantRootScheduledActiveGrantReaderV1({
        database: env.CONSOLE_DB,
        namespace,
      }),
      state: createTenantRootSecurityStateReaderV1({
        activeRoots: new D1TenantRootActiveLineageResolverV1(env.CONSOLE_DB, namespace),
        router: walletControl.router,
        internalServiceAuthSecret: WALLET_CONTROL_AUTH_MARKER_V1,
      }),
      pending: resumption,
      operations: (scope) =>
        createD1TenantRootOperationStoreV1({
          database: env.CONSOLE_DB,
          namespace,
          ...scope,
        }),
    },
    { nowMs },
  );
  if (scheduledIntent.kind === 'created' || scheduledIntent.kind === 'retry') {
    const operation = scheduledIntent.operation;
    const operations = createD1TenantRootOperationStoreV1({
      database: env.CONSOLE_DB,
      namespace,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
    });
    await dispatchTenantRootRefreshOperationV1({
      dependencies: {
        router: {
          fetch: (request, init) => walletControl.router.fetch(new Request(request, init)),
        },
        internalServiceAuthSecret: WALLET_CONTROL_AUTH_MARKER_V1,
        audit: createConsoleTenantRootAuditWriterV1({
          audit: bundle.audit,
          actorType: 'SYSTEM',
        }),
        operations,
      },
      entry: operation.entry,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
      stepUpMethod: null,
      nowMs,
    });
  }
}

function consoleScheduledHandler(env: CloudflareD1ConsoleStagingEnv): ScheduledHandler {
  const namespace = requireEnvString(env, 'SEAMS_TENANT_STORAGE_NAMESPACE');
  const tenantRootRefreshResumption: TenantRootRefreshResumptionRunner =
    runConsoleTenantRootRefreshResumptionV1.bind(undefined, env);
  return createCloudflareCron({
    tenantRootRefreshResumption: {
      runner: tenantRootRefreshResumption,
    },
    consoleEmailDispatch: resolveCloudflareConsoleEmailDispatchCronOptions({
      env,
      database: env.CONSOLE_DB,
      namespace,
      ensureSchema: false,
      invitationDelivery: { kind: 'ENABLED' },
    }),
  });
}

async function scheduled(
  event: CfScheduledEvent,
  env: CloudflareD1ConsoleStagingEnv,
  ctx: CfExecutionContext,
): Promise<void> {
  const handler = consoleScheduledHandler(env);
  await handler(event, env, ctx);
}

export default { fetch, scheduled };
