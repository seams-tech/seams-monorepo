import type { D1BillingUsageService } from '@seams-internal/console-server/billing/usage';
import type { WalletExecutionFunds } from '@seams-internal/wallet-console-server/sponsorship/funds';
import type { ConsoleWalletEnvironmentService } from '../environments';
import type { D1AccountPlatformService } from '@seams-internal/console-server/accountPlatform/d1';
import type { AccountServiceProvisioningAdapterV1 } from '@seams-internal/console-server/accountPlatform/provisioning';
import type { ConsoleAccountService } from '@seams-internal/console-server/account/index';
import type { ConsoleApiKeyService } from '@seams-internal/wallet-console-server/apiKeys/index';
import type { ConsoleApprovalService } from '@seams-internal/wallet-console-server/approvals/index';
import type { ConsoleAuditService } from '@seams-internal/console-server/audit/index';
import type { ConsoleBillingService } from '@seams-internal/console-server/billing/index';
import type { ConsoleBillingPrepaidReservationService } from '@seams-internal/console-server/billingPrepaidReservations/index';
import type {
  ConsoleObservabilityIngestionService,
  ConsoleObservabilityService,
} from '@seams-internal/console-server/observability/index';
import type { ConsoleOnboardingService } from '@seams-internal/console-server/onboarding/index';
import type { ConsoleOrgProjectService } from '@seams-internal/console-server/orgProjectEnv/index';
import type { ConsolePolicyService } from '@seams-internal/wallet-console-server/policies/index';
import type { ConsoleKeyExportService } from '@seams-internal/wallet-console-server/keyExports/index';
import type { ConsoleRuntimeSnapshotService } from '@seams-internal/wallet-console-server/runtimeSnapshots/index';
import type { ConsoleSponsoredCallService } from '@seams-internal/wallet-console-server/sponsoredCalls/index';
import type { ConsoleOrganizationAccessService } from '@seams-internal/console-server/teamRbac/index';
import type { ConsoleWalletService } from '@seams-internal/wallet-console-server/wallets/index';
import type { ConsoleWebhookService } from '@seams-internal/console-server/webhooks/index';
import type { SessionAdapter } from '@seams-internal/console-server/boundary/index';
import type { ConsoleRouterOptions } from './console';
import type { ConsoleAuthAdapter } from '@seams-internal/console-server/router/consoleAuth';
import { createCloudflareConsoleRouter } from './cloudflare/createCloudflareConsoleRouter';
import type { TenantStorageRouteResolver } from './cloudflare/tenantStorageRoute';

// Exact branch compositions for the production Console router. Every service a
// branch serves is a required input here; the broad optional ConsoleRouterOptions
// bag remains only as the internal assembly format these builders produce.
// The core/walletConsole grouping is the R105 Phase 2 package split.

export interface ConsoleCoreRouterServices {
  readonly orgProjects: ConsoleOrgProjectService;
  readonly accountPlatform: D1AccountPlatformService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly account: ConsoleAccountService;
  readonly audit: ConsoleAuditService;
  readonly billing: ConsoleBillingService;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billingUsage: D1BillingUsageService;
  readonly webhooks: ConsoleWebhookService | null;
  readonly observability: ConsoleObservabilityService;
  readonly observabilityIngestion: ConsoleObservabilityIngestionService;
  readonly onboarding: ConsoleOnboardingService;
}

export interface WalletConsoleRouterServices {
  readonly apiKeys: ConsoleApiKeyService;
  readonly executionFunds: WalletExecutionFunds;
  readonly walletEnvironments: ConsoleWalletEnvironmentService;
  readonly policies: ConsolePolicyService;
  readonly wallets: ConsoleWalletService;
  readonly approvals: ConsoleApprovalService;
  readonly keyExports: ConsoleKeyExportService;
  readonly sponsoredCalls: ConsoleSponsoredCallService;
  readonly runtimeSnapshots: ConsoleRuntimeSnapshotService;
}

export interface ConsoleOnlyRouterComposition {
  readonly walletProvisioning: AccountServiceProvisioningAdapterV1 | null;
  readonly satyrProvisioning: AccountServiceProvisioningAdapterV1 | null;
  readonly corsOrigins?: string[];
  readonly core: ConsoleCoreRouterServices;
  readonly walletConsole: WalletConsoleRouterServices;
  readonly auth: ConsoleAuthAdapter;
  readonly session: SessionAdapter;
  readonly readyCheck: () => Promise<void> | void;
  readonly billingStripeWebhookSigningSecret: string;
}

export interface HostedConsoleRouterComposition {
  readonly walletProvisioning: AccountServiceProvisioningAdapterV1 | null;
  readonly satyrProvisioning: AccountServiceProvisioningAdapterV1 | null;
  readonly core: ConsoleCoreRouterServices;
  readonly walletConsole: WalletConsoleRouterServices;
  readonly tenantStorage: {
    readonly resolver: TenantStorageRouteResolver;
    readonly namespace: string;
  };
  readonly auth: ConsoleAuthAdapter;
  readonly session: SessionAdapter;
  readonly corsOrigins: Array<string | undefined>;
  readonly readyCheck: () => Promise<void> | void;
  readonly billingStripeWebhookSigningSecret: string | undefined;
}

function spreadBranchServices(
  core: ConsoleCoreRouterServices,
  walletConsole: WalletConsoleRouterServices,
) {
  return {
    orgProjects: core.orgProjects,
    accountPlatform: core.accountPlatform,
    walletEnvironments: walletConsole.walletEnvironments,
    organizationAccess: core.organizationAccess,
    account: core.account,
    apiKeys: walletConsole.apiKeys,
    audit: core.audit,
    billing: core.billing,
    funds: core.funds,
    billingUsage: core.billingUsage,
    executionFunds: walletConsole.executionFunds,
    webhooks: core.webhooks,
    observability: core.observability,
    observabilityIngestion: core.observabilityIngestion,
    onboarding: core.onboarding,
    policies: walletConsole.policies,
    wallets: walletConsole.wallets,
    approvals: walletConsole.approvals,
    keyExports: walletConsole.keyExports,
    sponsoredCalls: walletConsole.sponsoredCalls,
    runtimeSnapshots: walletConsole.runtimeSnapshots,
  };
}

/**
 * The Wallet Console router: Console core plus the Wallet Console service set,
 * every input required. This is the only production mount point; the optional
 * ConsoleRouterOptions bag stays internal to the route assembly.
 */
export function createWalletConsoleRouter(
  input: ConsoleOnlyRouterComposition,
): ReturnType<typeof createCloudflareConsoleRouter> {
  return createCloudflareConsoleRouter(composeConsoleOnlyRouterOptions(input));
}

export function createHostedWalletConsoleRouter(
  input: HostedConsoleRouterComposition,
): ReturnType<typeof createCloudflareConsoleRouter> {
  return createCloudflareConsoleRouter(composeHostedConsoleRouterOptions(input));
}

export function composeConsoleOnlyRouterOptions(
  input: ConsoleOnlyRouterComposition,
): ConsoleRouterOptions {
  return {
    ...spreadBranchServices(input.core, input.walletConsole),
    walletProvisioning: input.walletProvisioning,
    satyrProvisioning: input.satyrProvisioning,
    healthz: true,
    readyz: true,
    auth: input.auth,
    session: input.session,
    readyCheck: input.readyCheck,
    corsOrigins: input.corsOrigins,
    billingStripeWebhookSigningSecret: input.billingStripeWebhookSigningSecret,
  };
}

export function composeHostedConsoleRouterOptions(
  input: HostedConsoleRouterComposition,
): ConsoleRouterOptions {
  return {
    ...spreadBranchServices(input.core, input.walletConsole),
    walletProvisioning: input.walletProvisioning,
    satyrProvisioning: input.satyrProvisioning,
    tenantStorageRouteResolver: input.tenantStorage.resolver,
    tenantStorageNamespace: input.tenantStorage.namespace,
    healthz: true,
    readyz: true,
    corsOrigins: input.corsOrigins,
    auth: input.auth,
    session: input.session,
    readyCheck: input.readyCheck,
    billingStripeWebhookSigningSecret: input.billingStripeWebhookSigningSecret,
  };
}
