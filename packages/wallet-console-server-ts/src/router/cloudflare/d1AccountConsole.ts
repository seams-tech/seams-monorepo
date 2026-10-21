import {
  createCloudflareD1AccountServiceBundle,
  type CloudflareD1AccountServiceBundleOptions,
} from '@seams-internal/console-server/router/cloudflare/d1AccountServices';
import {
  createAccountConsoleRouter,
  type AccountConsoleRouterOptions,
} from '@seams-internal/console-server/router/cloudflare/createAccountConsoleRouter';
import {
  createConsoleRouteDefinitions,
  findConsoleRouteDefinitionForRequest,
} from '@seams-internal/console-server/router/consoleRouteDefinitions';
import type { SessionAdapter } from '@seams-internal/console-server/boundary/session';
import { normalizeConsoleEmailList } from '@seams-internal/console-server/router/consoleAppSessionAuth';
import type { ConsoleWebhookService } from '@seams-internal/console-server/webhooks/service';
import { normalizeLogger } from '@seams-internal/console-server/boundary';
import { createD1ConsoleObservabilityIngestionService } from '@seams-internal/console-server/observability/d1';
import { CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES } from '@seams-internal/console-server/observability/policy';
import {
  createD1ConsoleWebhookService,
  type ConsoleWebhookSecretCipher,
} from '@seams-internal/console-server/webhooks/d1';
import {
  satyrProvisioningForConsoleRoute,
  type SatyrProvisioningEnvironment,
} from '@seams-internal/console-server/accountPlatform/satyrProvisioningEnvironment';
import { createConsoleSessionAuthAdapter } from './d1StagingSession';
import { createWalletBillingRouteHooks, observeWalletAccountRequest } from './walletBillingHooks';
import { createD1ConsoleSponsoredCallService } from '../../sponsoredCalls/d1';
import { D1WalletOrganizationDeletion } from './d1ConsoleServices';
import {
  WALLET_CONSOLE_AUDIT_CATEGORIES,
  WALLET_CONSOLE_AUDIT_EVIDENCE_REFERENCE_KINDS,
} from '../../audit';
import {
  WALLET_CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES,
  WALLET_CONSOLE_OBSERVABILITY_SOURCES,
} from '../../observability';
import { WALLET_CONSOLE_WEBHOOK_EVENT_CATEGORY_VALIDATION } from '@seams-internal/wallet-console-shared/webhookEventCategories';
import { WalletServiceProvisioningAdapter } from '../../accountPlatform/provisioning';
import { createD1ConsoleWalletEnvironmentService } from '../../environments/d1';

const ACCOUNT_ROUTE_DEFINITIONS = createConsoleRouteDefinitions();

export function isAccountConsoleRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  if (
    pathname.startsWith('/console/billing/sponsored-executions') ||
    pathname === '/console/billing/usage/monthly-active-wallets'
  )
    return false;
  if (
    pathname.startsWith('/console/auth/') ||
    pathname.startsWith('/console/billing/') ||
    pathname.startsWith('/console/platform/billing/') ||
    pathname === '/console/healthz' ||
    pathname === '/console/readyz'
  )
    return true;
  if (!pathname.startsWith('/console/')) return false;
  if (/^\/console\/projects\/[^/]+\/services\/wallet\/(?:enable|disable|archive)$/.test(pathname))
    return false;
  if (
    pathname.startsWith('/console/webhooks') ||
    pathname.startsWith('/console/isolation') ||
    pathname.startsWith('/console/audit/exports')
  )
    return false;
  for (const route of ACCOUNT_ROUTE_DEFINITIONS) {
    if (findConsoleRouteDefinitionForRequest([route], route.method, pathname)) return true;
  }
  return false;
}

export interface D1AccountConsoleCompositionOptions extends Omit<
  CloudflareD1AccountServiceBundleOptions,
  'externalDeletionGuard'
> {
  readonly session: SessionAdapter;
  readonly platformSupportEmails: string | undefined;
  readonly walletDeploymentId: string | null;
  readonly satyrEnvironment: SatyrProvisioningEnvironment;
  readonly webhookSecretCipher: ConsoleWebhookSecretCipher | null;
  readonly billingStripeWebhookSigningSecret: string | null;
  readonly corsOrigins: readonly string[];
  readonly readyCheck: () => Promise<void>;
  readonly waitUntil: (work: Promise<unknown>) => void;
}

/** Both Worker entrypoints compose account requests without constructing the Wallet runtime. */
export async function createD1AccountConsoleComposition(
  request: Request,
  options: D1AccountConsoleCompositionOptions,
) {
  const services = await createCloudflareD1AccountServiceBundle({
    ...options,
    externalDeletionGuard: new D1WalletOrganizationDeletion(options.database, options.namespace),
    // the platform support addresses hear about each new Console sign-up
    teamSignupAlertRecipients: normalizeConsoleEmailList(options.platformSupportEmails ?? []),
    auditCategories: WALLET_CONSOLE_AUDIT_CATEGORIES,
    auditEvidenceReferenceKinds: WALLET_CONSOLE_AUDIT_EVIDENCE_REFERENCE_KINDS,
  });
  const auth = createConsoleSessionAuthAdapter({
    session: options.session,
    organizationAccess: services.organizationAccess,
    platformSupportEmails: options.platformSupportEmails,
  });
  const pathname = new URL(request.url).pathname;
  let walletProvisioning: WalletServiceProvisioningAdapter | null = null;
  if (
    /^\/console\/projects\/[^/]+\/services$/.test(pathname) &&
    options.walletDeploymentId !== null
  ) {
    const environments = await createD1ConsoleWalletEnvironmentService({
      database: options.database,
      namespace: options.namespace,
      ensureSchema: false,
    });
    walletProvisioning = new WalletServiceProvisioningAdapter({
      deploymentId: options.walletDeploymentId,
      namespace: options.namespace,
      environments,
      orgProjects: services.orgProjects,
      billing: services.billing,
    });
  }
  let billingHooks;
  let requestCompleted: AccountConsoleRouterOptions['requestCompleted'];
  let webhooks: ConsoleWebhookService | null = services.webhooks;
  if (
    pathname.startsWith('/console/billing/') ||
    pathname.startsWith('/console/platform/billing/')
  ) {
    const observabilityIngestion = await createD1ConsoleObservabilityIngestionService({
      database: options.database,
      namespace: options.namespace,
      ensureSchema: false,
      additionalSources: WALLET_CONSOLE_OBSERVABILITY_SOURCES,
      requestMetricPolicies: [
        ...CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES,
        ...WALLET_CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES,
      ],
    });
    const billingWebhooks =
      options.webhookSecretCipher === null
        ? null
        : await createD1ConsoleWebhookService({
            database: options.database,
            namespace: options.namespace,
            ensureSchema: false,
            categoryValidation: WALLET_CONSOLE_WEBHOOK_EVENT_CATEGORY_VALIDATION,
            secretCipher: options.webhookSecretCipher,
            observabilityIngestion,
          });
    const sponsoredCalls = await createD1ConsoleSponsoredCallService({
      database: options.database,
      namespace: options.namespace,
    });
    billingHooks = createWalletBillingRouteHooks({
      request,
      billing: services.billing,
      sponsoredCalls,
      webhooks: billingWebhooks,
      observabilityIngestion,
      logger: normalizeLogger(options.logger),
    });
    webhooks = billingWebhooks;
    requestCompleted = observeWalletAccountRequest.bind(null, {
      observabilityIngestion,
      logger: normalizeLogger(options.logger),
    });
  }
  const handler = createAccountConsoleRouter({
    services: { ...services, webhooks },
    auth,
    session: options.session,
    walletProvisioning,
    satyrProvisioning: satyrProvisioningForConsoleRoute(
      pathname,
      options.satyrEnvironment,
      services.serviceAccess,
      globalThis.fetch.bind(globalThis),
    ),
    readyCheck: options.readyCheck,
    billingStripeWebhookSigningSecret: options.billingStripeWebhookSigningSecret,
    billingHooks,
    requestCompleted,
    corsOrigins: options.corsOrigins,
    waitUntil: options.waitUntil,
  });
  return { handler, services };
}
