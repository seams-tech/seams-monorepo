import type { D1AccountServiceAccess } from '@seams-internal/console-server/accountPlatform/serviceAccess';
import type { D1AccountMembershipFacade } from '@seams-internal/console-server/accountPlatform/membershipFacade';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '@seams-internal/wallet-console-shared/apiKeyScopes';
import { WALLET_CONSOLE_WEBHOOK_EVENT_CATEGORY_VALIDATION } from '@seams-internal/wallet-console-shared/webhookEventCategories';
import {
  createWalletRegistrationContextResolver,
  normalizeLogger,
  type Logger,
  type WalletRegistrationContextResolver,
} from '@seams/wallet-server/cloud-host';
import type { ConsoleCoreRouterServices, WalletConsoleRouterServices } from '../consoleComposition';
import { createCloudflareD1AccountServiceBundle } from '@seams-internal/console-server/router/cloudflare/d1AccountServices';
import type { D1AccountPlatformService } from '@seams-internal/console-server/accountPlatform/d1';
import type { AccountServiceProvisioningAdapterV1 } from '@seams-internal/console-server/accountPlatform/provisioning';
import { WalletServiceProvisioningAdapter } from '../../accountPlatform/provisioning';
import type { AccountOrganizationDeletionPort } from '@seams-internal/console-server/account/service';
import { ConsoleAccountError } from '@seams-internal/console-server/account/errors';
import { queryD1One } from '@seams-internal/console-server/boundary/d1';
import type { ConsoleOrgProjectService } from '@seams-internal/console-server/orgProjectEnv/service';
import type { ConsoleAccountService } from '@seams-internal/console-server/account/service';
import { createD1ConsoleApiKeyService } from '@seams-internal/wallet-console-server/apiKeys/d1';
import type {
  ConsoleApiKeysContext,
  ConsoleApiKeyService,
} from '@seams-internal/wallet-console-server/apiKeys/service';
import type {
  CreateConsoleApiKeyRequest,
  CreateConsoleApiKeyResult,
} from '@seams-internal/wallet-console-server/apiKeys/types';
import { createD1ConsoleApprovalService } from '@seams-internal/wallet-console-server/approvals/d1';
import type { ConsoleApprovalService } from '@seams-internal/wallet-console-server/approvals/service';
import type { ConsoleAuditService } from '@seams-internal/console-server/audit/service';
import {
  WALLET_CONSOLE_AUDIT_CATEGORIES,
  WALLET_CONSOLE_AUDIT_EVIDENCE_REFERENCE_KINDS,
} from '../../audit';
import type { BillingProviderAdapters } from '@seams-internal/console-server/billing/providers';
import type { ConsoleBillingService } from '@seams-internal/console-server/billing/service';
import type { ConsoleBillingPrepaidReservationService } from '@seams-internal/console-server/billingPrepaidReservations/service';
import type { D1BillingUsageService } from '@seams-internal/console-server/billing/usage';
import { WalletExecutionFunds } from '../../sponsorship/funds';
import { WalletMonthlyUsageAdapter } from '../../billing/usage';
import { createD1ConsoleKeyExportService } from '@seams-internal/wallet-console-server/keyExports/d1';
import type { ConsoleKeyExportService } from '@seams-internal/wallet-console-server/keyExports/service';
import {
  createAesGcmConsoleWebhookSecretCipher,
  createD1ConsoleWebhookService,
  type ConsoleWebhookSecretCipher,
} from '@seams-internal/console-server/webhooks/d1';
import { base64UrlDecode } from '@seams/wallet-server/cloud-host';
import type {
  ConsoleWebhookService,
  WebhookDispatchAdapter,
} from '@seams-internal/console-server/webhooks/service';
import {
  createD1ConsoleWalletEnvironmentService,
  type ConsoleWalletEnvironmentService,
} from '../../environments';
import {
  createD1ConsoleObservabilityIngestionService,
  createD1ConsoleObservabilityService,
} from '@seams-internal/console-server/observability/d1';
import type { ConsoleObservabilityIngestionService } from '@seams-internal/console-server/observability/ingestionService';
import type { ConsoleObservabilityService } from '@seams-internal/console-server/observability/service';
import type { ConsoleObservabilityMetadataRedactionPolicy } from '@seams-internal/console-server/observability/types';
import { CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES } from '@seams-internal/console-server/observability/policy';
import {
  WALLET_CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES,
  WALLET_CONSOLE_OBSERVABILITY_SOURCES,
} from '../../observability';
import type { ConsoleOnboardingService } from '@seams-internal/console-server/onboarding/service';
import { createD1ConsolePolicyService } from '@seams-internal/wallet-console-server/policies/d1';
import type { ConsolePolicyService } from '@seams-internal/wallet-console-server/policies/service';
import { createD1ConsoleSponsoredCallService } from '@seams-internal/wallet-console-server/sponsoredCalls/d1';
import type { ConsoleSponsoredCallService } from '@seams-internal/wallet-console-server/sponsoredCalls/service';
import {
  createD1ConsoleSponsorshipPricingService,
  ensureConsoleSponsorshipPricingD1Schema,
  seedD1ConsoleStaticEvmSponsorshipPricingRule,
} from '@seams-internal/wallet-console-server/sponsorshipPricing/d1';
import { createD1ConsoleSponsorshipSpendCapService } from '@seams-internal/wallet-console-server/sponsorshipSpendCaps/d1';
import type { ConsoleSponsorshipSpendCapService } from '@seams-internal/wallet-console-server/sponsorshipSpendCaps/service';
import type { D1ConsoleOrganizationEmailOptions } from '@seams-internal/console-server/teamRbac/d1';
import type { ConsoleOrganizationAccessService } from '@seams-internal/console-server/teamRbac/service';
import { createD1ConsoleWalletService } from '@seams-internal/wallet-console-server/wallets/d1';
import type { ConsoleWalletService } from '@seams-internal/wallet-console-server/wallets/service';
import type { D1ConsoleWalletBalanceReaderOptions } from '@seams-internal/wallet-console-server/wallets/balances';
import { createD1ConsoleRuntimeSnapshotService } from '@seams-internal/wallet-console-server/runtimeSnapshots/d1';
import type { ConsoleRuntimeSnapshotService } from '@seams-internal/wallet-console-server/runtimeSnapshots/service';
import type { CloudflareD1RouterApiAuthService } from '@seams/wallet-server/cloud-host';
import {
  DEFAULT_TEMPO_ONBOARDING_CONTRACT,
  TEMPO_TESTNET_CHAIN_ID,
} from '@seams-internal/wallet-console-server/gasSponsorship/onboarding';
import {
  createConsoleWalletEnvironmentServiceWithTempoOnboardingSponsorship,
  ensureTempoOnboardingSponsorshipForExistingEnvironments,
} from '@seams-internal/wallet-console-server/gasSponsorship/seeding';
import type { ConsoleGasSponsorshipPolicyProjection } from '@seams-internal/wallet-console-server/gasSponsorship/types';
import type {
  RouterApiKeyAuthAdapter,
  RouterApiPublishableKeyAuthAdapter,
  RouterApiOptions,
  RouterApiProjectEnvironmentResolver,
  RouterApiUsageMeterAdapter,
} from '@seams/wallet-server/cloud-host';
import { createWalletProjectEnvironmentResolver } from '../projectEnvironmentAdapter';
import type { ConsoleRouterOptions } from '@seams-internal/wallet-console-server/router/console';
import {
  createRouterApiKeyAuthAdapter,
  createRouterApiWalletRegistrationProjectionAdapter,
  createRouterApiPublishableKeyAuthAdapter,
} from '@seams-internal/wallet-console-server/router/routerApiKeyAuth';
import {
  createConsoleRouterApiRouteExtensions,
  DEFAULT_SIGNED_DELEGATE_ROUTE,
} from '@seams-internal/wallet-console-server/router/routeExtensions';
import type { RouterAbNormalSigningAdmissionAdapter } from '@seams/wallet-server/cloud-host';
import {
  createCloudflareD1RouterAbNormalSigningAdmissionStore,
  createRouterAbNormalSigningAdmissionAdapter,
} from '@seams/wallet-server/cloud-host';
import type {
  SponsoredEvmCallExecutorConfig,
  SponsoredEvmExecutionAdapterResolver,
} from '@seams-internal/wallet-console-server/sponsorship/evmExecutorTypes';
import type { SponsorshipSpendPricingService } from '@seams-internal/wallet-console-server/sponsorship/spendCaps';
import { createChainFamilySponsoredExecutionPricingService } from '@seams-internal/wallet-console-server/sponsorship/pricing';
import type {
  CloudflareTenantTopology,
  D1BindingName,
  D1DatabaseLike,
  D1DatabaseName,
  TenantDataJurisdiction,
} from '@seams/wallet-server/cloud-host';
import {
  createStaticCloudflareTenantStorageRouteResolverFromBindings,
  type TenantStorageRouteResolver,
} from './tenantStorageRoute';

const DEFAULT_CONSOLE_D1_BINDING_NAME = 'CONSOLE_DB';
const DEFAULT_CONSOLE_D1_DATABASE_NAME = 'seams-console';
const DEFAULT_SIGNER_D1_BINDING_NAME = 'SIGNER_DB';
const DEFAULT_SIGNER_D1_DATABASE_NAME = 'seams-signer';
const DEFAULT_ROUTE_VERSION = 1;
const DEFAULT_TOPOLOGY: CloudflareTenantTopology = 'shared';
const DEFAULT_JURISDICTION: TenantDataJurisdiction = 'automatic';

export interface CloudflareD1ConsoleStorageBindings {
  readonly consoleDatabase: D1DatabaseLike;
  readonly signerMetadataDatabase: D1DatabaseLike;
}

export interface CloudflareD1ConsoleOnlyStorageBindings {
  readonly consoleDatabase: D1DatabaseLike;
}

export interface CloudflareD1ConsoleStorageBindingNames {
  readonly consoleBindingName?: D1BindingName;
  readonly consoleDatabaseName?: D1DatabaseName;
  readonly signerMetadataBindingName?: D1BindingName;
  readonly signerMetadataDatabaseName?: D1DatabaseName;
}

export interface CloudflareD1ConsoleRouteOptions {
  readonly namespace: string;
  readonly deploymentId: string;
  readonly routeVersion?: number;
  readonly topology?: CloudflareTenantTopology;
  readonly jurisdiction?: TenantDataJurisdiction;
}

export interface CloudflareD1ConsoleAdapterOptions {
  readonly ensureSchema?: boolean;
  readonly now?: () => Date;
  readonly logger?: Logger | null;
  readonly organizationEmail?: D1ConsoleOrganizationEmailOptions;
  readonly billingProviders?: Partial<BillingProviderAdapters>;
  readonly billingEmailConsoleBaseUrl?: string;
  readonly onboardingEmail?: {
    readonly consoleBaseUrl: string;
    readonly docsBaseUrl: string;
  };
  readonly webhookSecretCipher?: ConsoleWebhookSecretCipher;
  readonly webhookDispatcher?: WebhookDispatchAdapter;
  readonly webhookEndpointDegradedThreshold?: number;
  readonly observabilityRedactionPolicy?: ConsoleObservabilityMetadataRedactionPolicy;
  readonly observabilityMaxBatchSize?: number;
  readonly observabilityMaxEventsPerMinute?: number;
  readonly observabilityQueryMaxWindowMs?: number;
  readonly runtimeSnapshotRetentionTtlMs?: number;
  readonly runtimeSnapshotRetentionPruneIntervalMs?: number;
  readonly runtimeSnapshotRetentionBatchSize?: number;
  readonly sponsorshipPricing?: SponsorshipSpendPricingService | null;
  readonly sponsoredEvmCallConfig?: SponsoredEvmCallExecutorConfig | null;
  readonly resolveSponsoredEvmExecutionAdapter?: SponsoredEvmExecutionAdapterResolver | null;
  readonly walletBalanceReader?: D1ConsoleWalletBalanceReaderOptions | null;
}

export interface CloudflareD1ConsoleServiceBundleOptions {
  readonly bindings: CloudflareD1ConsoleStorageBindings;
  readonly route: CloudflareD1ConsoleRouteOptions;
  readonly bindingNames?: CloudflareD1ConsoleStorageBindingNames;
  readonly adapters?: CloudflareD1ConsoleAdapterOptions;
}

export interface CloudflareD1ConsoleOnlyServiceBundleOptions {
  readonly bindings: CloudflareD1ConsoleOnlyStorageBindings;
  readonly route: Pick<CloudflareD1ConsoleRouteOptions, 'namespace' | 'deploymentId'>;
  readonly adapters?: CloudflareD1ConsoleAdapterOptions;
}

export interface CloudflareD1ConsoleRouterStorageOptions {
  readonly tenantStorageRouteResolver: TenantStorageRouteResolver;
  readonly tenantStorageNamespace: string;
  readonly orgProjects: ConsoleOrgProjectService;
  readonly accountPlatform: D1AccountPlatformService;
  readonly walletProvisioning: AccountServiceProvisioningAdapterV1;
  readonly satyrProvisioning: AccountServiceProvisioningAdapterV1 | null;
  readonly walletEnvironments: ConsoleWalletEnvironmentService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly account: ConsoleAccountService;
  readonly policies: ConsolePolicyService;
  readonly wallets: ConsoleWalletService;
  readonly apiKeys: ConsoleApiKeyService;
  readonly approvals: ConsoleApprovalService;
  readonly keyExports: ConsoleKeyExportService;
  readonly webhooks?: ConsoleWebhookService | null;
  readonly observability: ConsoleObservabilityService;
  readonly observabilityIngestion: ConsoleObservabilityIngestionService;
  readonly onboarding: ConsoleOnboardingService;
  readonly audit: ConsoleAuditService;
  readonly billing: ConsoleBillingService;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billingUsage: D1BillingUsageService;
  readonly sponsoredCalls: ConsoleSponsoredCallService;
  readonly runtimeSnapshots: ConsoleRuntimeSnapshotService;
}

export interface CloudflareD1RouterApiStorageOptions {
  readonly apiKeyAuth: RouterApiKeyAuthAdapter;
  readonly publishableKeyAuth: RouterApiPublishableKeyAuthAdapter;
  readonly registrationContext: WalletRegistrationContextResolver;
  readonly apiKeyUsageMeter: RouterApiUsageMeterAdapter;
  readonly orgProjectEnv: RouterApiProjectEnvironmentResolver;
  readonly routeExtensions: NonNullable<RouterApiOptions['routeExtensions']>;
  readonly routerAbNormalSigningAdmission: RouterAbNormalSigningAdmissionAdapter;
}

export interface CloudflareD1ConsoleServiceBundle {
  readonly tenantStorageRouteResolver: TenantStorageRouteResolver;
  readonly tenantStorageNamespace: string;
  readonly orgProjects: ConsoleOrgProjectService;
  readonly accountPlatform: D1AccountPlatformService;
  readonly serviceAccess: D1AccountServiceAccess;
  readonly serviceMemberships: D1AccountMembershipFacade;
  readonly walletProvisioning: AccountServiceProvisioningAdapterV1;
  readonly walletEnvironments: ConsoleWalletEnvironmentService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly account: ConsoleAccountService;
  readonly policies: ConsolePolicyService;
  readonly wallets: ConsoleWalletService;
  readonly apiKeys: ConsoleApiKeyService;
  readonly approvals: ConsoleApprovalService;
  readonly keyExports: ConsoleKeyExportService;
  readonly webhooks: ConsoleWebhookService | null;
  readonly observability: ConsoleObservabilityService;
  readonly observabilityIngestion: ConsoleObservabilityIngestionService;
  readonly onboarding: ConsoleOnboardingService;
  readonly audit: ConsoleAuditService;
  readonly billing: ConsoleBillingService;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billingUsage: D1BillingUsageService;
  readonly executionFunds: WalletExecutionFunds;
  readonly walletMonthlyUsage: WalletMonthlyUsageAdapter;
  readonly spendCaps: ConsoleSponsorshipSpendCapService;
  readonly sponsorshipPricing: SponsorshipSpendPricingService | null;
  readonly sponsoredCalls: ConsoleSponsoredCallService;
  readonly runtimeSnapshots: ConsoleRuntimeSnapshotService;
  readonly consoleRouterOptions: CloudflareD1ConsoleRouterStorageOptions;
  readonly routerApiRouterOptions: CloudflareD1RouterApiStorageOptions;
}

export type CloudflareD1ConsoleOnlyServiceBundle = Omit<
  CloudflareD1ConsoleServiceBundle,
  'tenantStorageRouteResolver' | 'routerApiRouterOptions' | 'consoleRouterOptions'
> & {
  readonly consoleRouterOptions: ConsoleRouterOptions;
};

type ConsoleBranchServiceFields = Pick<
  CloudflareD1ConsoleServiceBundle,
  keyof ConsoleCoreRouterServices | keyof WalletConsoleRouterServices
>;

export function consoleCoreServicesFromBundle(
  bundle: ConsoleBranchServiceFields,
): ConsoleCoreRouterServices {
  return {
    orgProjects: bundle.orgProjects,
    accountPlatform: bundle.accountPlatform,
    organizationAccess: bundle.organizationAccess,
    account: bundle.account,
    audit: bundle.audit,
    billing: bundle.billing,
    funds: bundle.funds,
    billingUsage: bundle.billingUsage,
    webhooks: bundle.webhooks,
    observability: bundle.observability,
    observabilityIngestion: bundle.observabilityIngestion,
    onboarding: bundle.onboarding,
  };
}

export function walletConsoleServicesFromBundle(
  bundle: ConsoleBranchServiceFields,
): WalletConsoleRouterServices {
  return {
    apiKeys: bundle.apiKeys,
    executionFunds: bundle.executionFunds,
    walletEnvironments: bundle.walletEnvironments,
    policies: bundle.policies,
    wallets: bundle.wallets,
    approvals: bundle.approvals,
    keyExports: bundle.keyExports,
    sponsoredCalls: bundle.sponsoredCalls,
    runtimeSnapshots: bundle.runtimeSnapshots,
  };
}

export function createCloudflareD1RouterApiRouteExtensions(
  bundle: CloudflareD1ConsoleServiceBundle,
  authService: CloudflareD1RouterApiAuthService,
): NonNullable<CloudflareD1RouterApiStorageOptions['routeExtensions']> {
  return [
    ...bundle.routerApiRouterOptions.routeExtensions,
    ...createConsoleRouterApiRouteExtensions({
      signedDelegate: {
        route: DEFAULT_SIGNED_DELEGATE_ROUTE,
        authService: {
          executeSignedDelegate: authService.executeSignedDelegate.bind(authService),
          getRelayerAccount: authService.router.getRelayerAccount.bind(authService.router),
        },
        billing: bundle.billing,
        ledger: bundle.sponsoredCalls,
        runtimeSnapshots: bundle.runtimeSnapshots,
        publishableKeyAuth: bundle.routerApiRouterOptions.publishableKeyAuth,
        observabilityIngestion: bundle.observabilityIngestion,
        executionFunds: bundle.executionFunds,
        pricing: bundle.sponsorshipPricing,
        spendCaps: bundle.spendCaps,
        webhooks: bundle.webhooks,
      },
    }),
  ];
}

interface NormalizedCloudflareD1ConsoleCommonOptions {
  readonly consoleDatabase: D1DatabaseLike;
  readonly signerMetadataDatabase?: D1DatabaseLike;
  readonly namespace: string;
  readonly deploymentId: string;
  readonly ensureSchema: boolean;
  readonly now?: () => Date;
  readonly logger?: Logger | null;
  readonly organizationEmail?: D1ConsoleOrganizationEmailOptions;
  readonly billingProviders?: Partial<BillingProviderAdapters>;
  readonly billingEmailConsoleBaseUrl?: string;
  readonly onboardingEmail?: {
    readonly consoleBaseUrl: string;
    readonly docsBaseUrl: string;
  };
  readonly webhookSecretCipher?: ConsoleWebhookSecretCipher;
  readonly webhookDispatcher?: WebhookDispatchAdapter;
  readonly webhookEndpointDegradedThreshold?: number;
  readonly observabilityRedactionPolicy?: ConsoleObservabilityMetadataRedactionPolicy;
  readonly observabilityMaxBatchSize?: number;
  readonly observabilityMaxEventsPerMinute?: number;
  readonly observabilityQueryMaxWindowMs?: number;
  readonly runtimeSnapshotRetentionTtlMs?: number;
  readonly runtimeSnapshotRetentionPruneIntervalMs?: number;
  readonly runtimeSnapshotRetentionBatchSize?: number;
  readonly sponsorshipPricing?: SponsorshipSpendPricingService | null;
  readonly sponsoredEvmCallConfig?: SponsoredEvmCallExecutorConfig | null;
  readonly resolveSponsoredEvmExecutionAdapter?: SponsoredEvmExecutionAdapterResolver | null;
  readonly walletBalanceReader?: D1ConsoleWalletBalanceReaderOptions | null;
}

interface NormalizedCloudflareD1ConsoleServiceBundleOptions extends NormalizedCloudflareD1ConsoleCommonOptions {
  readonly signerMetadataDatabase: D1DatabaseLike;
  readonly routeVersion: number;
  readonly topology: CloudflareTenantTopology;
  readonly jurisdiction: TenantDataJurisdiction;
  readonly consoleBindingName: D1BindingName;
  readonly consoleDatabaseName: D1DatabaseName;
  readonly signerMetadataBindingName: D1BindingName;
  readonly signerMetadataDatabaseName: D1DatabaseName;
}

interface CloudflareD1ConsoleCommonServices {
  readonly orgProjects: ConsoleOrgProjectService;
  readonly accountPlatform: D1AccountPlatformService;
  readonly serviceAccess: D1AccountServiceAccess;
  readonly serviceMemberships: D1AccountMembershipFacade;
  readonly walletProvisioning: AccountServiceProvisioningAdapterV1;
  readonly walletEnvironments: ConsoleWalletEnvironmentService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly account: ConsoleAccountService;
  readonly policies: ConsolePolicyService;
  readonly wallets: ConsoleWalletService;
  readonly apiKeys: ConsoleApiKeyService;
  readonly approvals: ConsoleApprovalService;
  readonly keyExports: ConsoleKeyExportService;
  readonly webhooks: ConsoleWebhookService | null;
  readonly observability: ConsoleObservabilityService;
  readonly observabilityIngestion: ConsoleObservabilityIngestionService;
  readonly onboarding: ConsoleOnboardingService;
  readonly audit: ConsoleAuditService;
  readonly billing: ConsoleBillingService;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billingUsage: D1BillingUsageService;
  readonly executionFunds: WalletExecutionFunds;
  readonly walletMonthlyUsage: WalletMonthlyUsageAdapter;
  readonly sponsoredCalls: ConsoleSponsoredCallService;
  readonly runtimeSnapshots: ConsoleRuntimeSnapshotService;
}

type TempoStaticSponsorshipPricingSeed = {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly now?: () => Date;
};

const TEMPO_STATIC_SPONSORSHIP_PRICING_VERSION_PREFIX = 'tempo-testnet-static-v1';
const TEMPO_STATIC_SPONSORSHIP_ESTIMATE_FEE_PER_GAS_WEI = 40_000_000_000n;
const TEMPO_STATIC_SPONSORSHIP_MINOR_PER_WEI_NUMERATOR = 1n;
const TEMPO_STATIC_SPONSORSHIP_MINOR_PER_WEI_DENOMINATOR = 1_000_000_000_000_000n;

class D1WalletOrganizationDeletion implements AccountOrganizationDeletionPort {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly namespace: string,
  ) {}

  async assertOrganizationCanBeDeleted(ctx: {
    readonly orgId: string;
    readonly actorUserId: string;
  }): Promise<void> {
    const wallet = await queryD1One(
      this.database,
      `SELECT 1 AS retained FROM wallet_index WHERE namespace = ?1 AND org_id = ?2
       UNION ALL SELECT 1 FROM billing_funds_reservations WHERE namespace = ?1 AND org_id = ?2 LIMIT 1`,
      [this.namespace, ctx.orgId],
    );
    if (wallet) {
      throw new ConsoleAccountError(
        'organization_delete_has_wallet_records',
        409,
        'Wallet records retain this organization',
      );
    }
  }
}

class TempoOnboardingApiKeyService implements ConsoleApiKeyService {
  constructor(
    private readonly base: ConsoleApiKeyService,
    private readonly walletEnvironments: ConsoleWalletEnvironmentService,
    private readonly policies: ConsolePolicyService,
    private readonly runtimeSnapshots: ConsoleRuntimeSnapshotService,
    private readonly pricingSeed: TempoStaticSponsorshipPricingSeed | null,
  ) {}

  async listApiKeys(ctx: ConsoleApiKeysContext) {
    return await this.base.listApiKeys(ctx);
  }

  async createApiKey(
    ctx: ConsoleApiKeysContext,
    request: CreateConsoleApiKeyRequest,
  ): Promise<CreateConsoleApiKeyResult> {
    if (request.kind === 'publishable_key') {
      await this.ensureTempoSnapshot(ctx, request.environmentId);
    }
    return await this.base.createApiKey(ctx, request);
  }

  async revokeApiKey(
    ctx: ConsoleApiKeysContext,
    apiKeyId: string,
    request?: Parameters<ConsoleApiKeyService['revokeApiKey']>[2],
  ) {
    return await this.base.revokeApiKey(ctx, apiKeyId, request);
  }

  async deleteApiKey(ctx: ConsoleApiKeysContext, apiKeyId: string) {
    return await this.base.deleteApiKey(ctx, apiKeyId);
  }

  async rotateApiKey(
    ctx: ConsoleApiKeysContext,
    apiKeyId: string,
    request?: Parameters<ConsoleApiKeyService['rotateApiKey']>[2],
  ) {
    return await this.base.rotateApiKey(ctx, apiKeyId, request);
  }

  async updateApiKey(
    ctx: ConsoleApiKeysContext,
    apiKeyId: string,
    request: Parameters<ConsoleApiKeyService['updateApiKey']>[2],
  ) {
    return await this.base.updateApiKey(ctx, apiKeyId, request);
  }

  async authenticatePublishableKey(
    request: Parameters<NonNullable<ConsoleApiKeyService['authenticatePublishableKey']>>[0],
  ) {
    return (
      (await this.base.authenticatePublishableKey?.(request)) ?? {
        ok: false,
        status: 401,
        code: 'publishable_key_invalid',
        message: 'Publishable key auth is not configured',
      }
    );
  }

  async authenticateApiKey(
    request: Parameters<NonNullable<ConsoleApiKeyService['authenticateApiKey']>>[0],
  ) {
    return (
      (await this.base.authenticateApiKey?.(request)) ?? {
        ok: false,
        status: 401,
        code: 'secret_key_invalid',
        message: 'Secret key auth is not configured',
      }
    );
  }

  private async ensureTempoSnapshot(
    ctx: ConsoleApiKeysContext,
    environmentId: string,
  ): Promise<void> {
    const walletEnvironmentsCtx = {
      orgId: ctx.orgId,
      actorUserId: ctx.actorUserId,
    };
    const environments = await this.walletEnvironments.listEnvironments(walletEnvironmentsCtx);
    const environment = environments.find((entry) => entry.id === environmentId);
    if (!environment) return;
    const seededPolicies = await ensureTempoOnboardingSponsorshipForExistingEnvironments({
      walletEnvironments: this.walletEnvironments,
      policies: this.policies,
      runtimeSnapshots: this.runtimeSnapshots,
      ctx: walletEnvironmentsCtx,
      faucetContractAddress: DEFAULT_TEMPO_ONBOARDING_CONTRACT,
      projectId: environment.projectId,
    });
    for (const policy of seededPolicies) {
      await this.seedTempoPricingForPolicy(ctx, environment, policy);
    }
  }

  private async seedTempoPricingForPolicy(
    ctx: ConsoleApiKeysContext,
    environment: { readonly id: string; readonly projectId: string },
    policy: ConsoleGasSponsorshipPolicyProjection,
  ): Promise<void> {
    if (!this.pricingSeed || policy.kind !== 'evm_call') return;
    await seedD1ConsoleStaticEvmSponsorshipPricingRule({
      database: this.pricingSeed.database,
      namespace: this.pricingSeed.namespace,
      orgId: ctx.orgId,
      projectId: environment.projectId,
      environmentId: environment.id,
      policyId: policy.id,
      chainId: TEMPO_TESTNET_CHAIN_ID,
      pricingVersion: `${TEMPO_STATIC_SPONSORSHIP_PRICING_VERSION_PREFIX}:${policy.id}`,
      estimateFeePerGasWei: TEMPO_STATIC_SPONSORSHIP_ESTIMATE_FEE_PER_GAS_WEI,
      minorPerWeiNumerator: TEMPO_STATIC_SPONSORSHIP_MINOR_PER_WEI_NUMERATOR,
      minorPerWeiDenominator: TEMPO_STATIC_SPONSORSHIP_MINOR_PER_WEI_DENOMINATOR,
      minSpendMinor: 1,
      createdBy: ctx.actorUserId,
      now: this.pricingSeed.now,
    });
  }
}

function createTempoOnboardingApiKeyService(input: {
  readonly apiKeys: ConsoleApiKeyService;
  readonly walletEnvironments: ConsoleWalletEnvironmentService;
  readonly policies: ConsolePolicyService;
  readonly runtimeSnapshots: ConsoleRuntimeSnapshotService;
  readonly pricingSeed: TempoStaticSponsorshipPricingSeed | null;
}): ConsoleApiKeyService {
  return new TempoOnboardingApiKeyService(
    input.apiKeys,
    input.walletEnvironments,
    input.policies,
    input.runtimeSnapshots,
    input.pricingSeed,
  );
}

function normalizeRequiredString(
  input: string | undefined,
  fallback: string,
  field: string,
): string {
  const value = String(input || fallback).trim();
  if (!value) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function normalizeNamespace(input: string): string {
  const namespace = String(input || '').trim();
  if (!namespace) {
    throw new Error('D1 console storage namespace is required');
  }
  return namespace;
}

function normalizeRouteVersion(input: number | undefined): number {
  const routeVersion = Number(input || DEFAULT_ROUTE_VERSION);
  if (!Number.isInteger(routeVersion) || routeVersion < 1) {
    throw new Error('D1 console storage routeVersion must be a positive integer');
  }
  return routeVersion;
}

function normalizeTopology(input: CloudflareTenantTopology | undefined): CloudflareTenantTopology {
  return input || DEFAULT_TOPOLOGY;
}

function normalizeJurisdiction(input: TenantDataJurisdiction | undefined): TenantDataJurisdiction {
  return input || DEFAULT_JURISDICTION;
}

function normalizeCloudflareD1ConsoleServiceBundleOptions(
  options: CloudflareD1ConsoleServiceBundleOptions,
): NormalizedCloudflareD1ConsoleServiceBundleOptions {
  return {
    consoleDatabase: options.bindings.consoleDatabase,
    signerMetadataDatabase: options.bindings.signerMetadataDatabase,
    namespace: normalizeNamespace(options.route.namespace),
    deploymentId: normalizeNamespace(options.route.deploymentId),
    routeVersion: normalizeRouteVersion(options.route.routeVersion),
    topology: normalizeTopology(options.route.topology),
    jurisdiction: normalizeJurisdiction(options.route.jurisdiction),
    consoleBindingName: normalizeRequiredString(
      options.bindingNames?.consoleBindingName,
      DEFAULT_CONSOLE_D1_BINDING_NAME,
      'consoleBindingName',
    ),
    consoleDatabaseName: normalizeRequiredString(
      options.bindingNames?.consoleDatabaseName,
      DEFAULT_CONSOLE_D1_DATABASE_NAME,
      'consoleDatabaseName',
    ),
    signerMetadataBindingName: normalizeRequiredString(
      options.bindingNames?.signerMetadataBindingName,
      DEFAULT_SIGNER_D1_BINDING_NAME,
      'signerMetadataBindingName',
    ),
    signerMetadataDatabaseName: normalizeRequiredString(
      options.bindingNames?.signerMetadataDatabaseName,
      DEFAULT_SIGNER_D1_DATABASE_NAME,
      'signerMetadataDatabaseName',
    ),
    ensureSchema: options.adapters?.ensureSchema !== false,
    now: options.adapters?.now,
    logger: options.adapters?.logger,
    organizationEmail: options.adapters?.organizationEmail,
    billingProviders: options.adapters?.billingProviders,
    billingEmailConsoleBaseUrl: options.adapters?.billingEmailConsoleBaseUrl,
    onboardingEmail: options.adapters?.onboardingEmail,
    webhookSecretCipher: options.adapters?.webhookSecretCipher,
    webhookDispatcher: options.adapters?.webhookDispatcher,
    webhookEndpointDegradedThreshold: options.adapters?.webhookEndpointDegradedThreshold,
    observabilityRedactionPolicy: options.adapters?.observabilityRedactionPolicy,
    observabilityMaxBatchSize: options.adapters?.observabilityMaxBatchSize,
    observabilityMaxEventsPerMinute: options.adapters?.observabilityMaxEventsPerMinute,
    observabilityQueryMaxWindowMs: options.adapters?.observabilityQueryMaxWindowMs,
    runtimeSnapshotRetentionTtlMs: options.adapters?.runtimeSnapshotRetentionTtlMs,
    runtimeSnapshotRetentionPruneIntervalMs:
      options.adapters?.runtimeSnapshotRetentionPruneIntervalMs,
    runtimeSnapshotRetentionBatchSize: options.adapters?.runtimeSnapshotRetentionBatchSize,
    sponsorshipPricing: options.adapters?.sponsorshipPricing,
    sponsoredEvmCallConfig: options.adapters?.sponsoredEvmCallConfig,
    resolveSponsoredEvmExecutionAdapter: options.adapters?.resolveSponsoredEvmExecutionAdapter,
    walletBalanceReader: options.adapters?.walletBalanceReader,
  };
}

function normalizeCloudflareD1ConsoleOnlyServiceBundleOptions(
  options: CloudflareD1ConsoleOnlyServiceBundleOptions,
): NormalizedCloudflareD1ConsoleCommonOptions {
  return {
    consoleDatabase: options.bindings.consoleDatabase,
    namespace: normalizeNamespace(options.route.namespace),
    deploymentId: normalizeNamespace(options.route.deploymentId),
    ensureSchema: options.adapters?.ensureSchema !== false,
    now: options.adapters?.now,
    logger: options.adapters?.logger,
    organizationEmail: options.adapters?.organizationEmail,
    billingProviders: options.adapters?.billingProviders,
    billingEmailConsoleBaseUrl: options.adapters?.billingEmailConsoleBaseUrl,
    onboardingEmail: options.adapters?.onboardingEmail,
    webhookSecretCipher: options.adapters?.webhookSecretCipher,
    webhookDispatcher: options.adapters?.webhookDispatcher,
    webhookEndpointDegradedThreshold: options.adapters?.webhookEndpointDegradedThreshold,
    observabilityRedactionPolicy: options.adapters?.observabilityRedactionPolicy,
    observabilityMaxBatchSize: options.adapters?.observabilityMaxBatchSize,
    observabilityMaxEventsPerMinute: options.adapters?.observabilityMaxEventsPerMinute,
    observabilityQueryMaxWindowMs: options.adapters?.observabilityQueryMaxWindowMs,
    runtimeSnapshotRetentionTtlMs: options.adapters?.runtimeSnapshotRetentionTtlMs,
    runtimeSnapshotRetentionPruneIntervalMs:
      options.adapters?.runtimeSnapshotRetentionPruneIntervalMs,
    runtimeSnapshotRetentionBatchSize: options.adapters?.runtimeSnapshotRetentionBatchSize,
    sponsorshipPricing: options.adapters?.sponsorshipPricing,
    sponsoredEvmCallConfig: options.adapters?.sponsoredEvmCallConfig,
    resolveSponsoredEvmExecutionAdapter: options.adapters?.resolveSponsoredEvmExecutionAdapter,
    walletBalanceReader: options.adapters?.walletBalanceReader,
  };
}

function createCloudflareD1TenantRouteResolver(
  options: NormalizedCloudflareD1ConsoleServiceBundleOptions,
): TenantStorageRouteResolver {
  return createStaticCloudflareTenantStorageRouteResolverFromBindings({
    routeVersion: options.routeVersion,
    topology: options.topology,
    jurisdiction: options.jurisdiction,
    consoleBindingName: options.consoleBindingName,
    consoleDatabaseName: options.consoleDatabaseName,
    consoleDatabase: options.consoleDatabase,
    signerMetadataBindingName: options.signerMetadataBindingName,
    signerMetadataDatabaseName: options.signerMetadataDatabaseName,
    signerMetadataDatabase: options.signerMetadataDatabase,
  });
}

async function createCloudflareD1Policies(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsolePolicyService> {
  return await createD1ConsolePolicyService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
  });
}

async function createCloudflareD1Wallets(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsoleWalletService> {
  return await createD1ConsoleWalletService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
    balanceReader: options.walletBalanceReader || null,
  });
}

async function createCloudflareD1ApiKeys(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsoleApiKeyService> {
  return await createD1ConsoleApiKeyService({
    deploymentId: options.deploymentId,
    scopeValidation: WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
  });
}

async function createCloudflareD1Approvals(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsoleApprovalService> {
  return await createD1ConsoleApprovalService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
  });
}

async function createCloudflareD1KeyExports(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsoleKeyExportService> {
  return await createD1ConsoleKeyExportService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
  });
}

async function createCloudflareD1Observability(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsoleObservabilityService> {
  return await createD1ConsoleObservabilityService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
    queryMaxWindowMs: options.observabilityQueryMaxWindowMs,
  });
}

async function createCloudflareD1ObservabilityIngestion(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsoleObservabilityIngestionService> {
  return await createD1ConsoleObservabilityIngestionService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
    redactionPolicy: options.observabilityRedactionPolicy,
    maxBatchSize: options.observabilityMaxBatchSize,
    maxEventsPerMinute: options.observabilityMaxEventsPerMinute,
    additionalSources: WALLET_CONSOLE_OBSERVABILITY_SOURCES,
    requestMetricPolicies: [
      ...CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES,
      ...WALLET_CONSOLE_OBSERVABILITY_REQUEST_METRIC_POLICIES,
    ],
  });
}

const CONSOLE_WEBHOOK_SECRET_KEY_BYTES = 32;

/**
 * Build the webhook signing-secret cipher from worker env.
 *
 * `createCloudflareD1Webhooks` silently returns null without a cipher, which
 * makes every /console/webhooks route answer 501 webhooks_not_configured. A
 * hosted console must therefore fail loudly at construction rather than boot
 * into a permanently disabled feature, so both keys are required here.
 */
export function createConsoleWebhookSecretCipherFromEnv(
  env: Readonly<Record<string, unknown>>,
): ConsoleWebhookSecretCipher {
  const keyId = requireConsoleWebhookEnv(env, 'CONSOLE_WEBHOOK_SECRET_KEY_ID');
  const keyBytes = decodeConsoleWebhookSecretKey(
    requireConsoleWebhookEnv(env, 'CONSOLE_WEBHOOK_SECRET_KEY_B64U'),
  );
  try {
    return createAesGcmConsoleWebhookSecretCipher({ keyId, keyBytes });
  } finally {
    // The cipher copies the key, so the decoded buffer must not outlive this.
    keyBytes.fill(0);
  }
}

function requireConsoleWebhookEnv(env: Readonly<Record<string, unknown>>, name: string): string {
  const value = typeof env[name] === 'string' ? (env[name] as string).trim() : '';
  if (!value) throw new Error(`${name} is required to enable console webhooks`);
  return value;
}

function decodeConsoleWebhookSecretKey(value: string): Uint8Array {
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(value);
  } catch {
    throw new Error('CONSOLE_WEBHOOK_SECRET_KEY_B64U must be valid base64url');
  }
  if (decoded.byteLength !== CONSOLE_WEBHOOK_SECRET_KEY_BYTES) {
    decoded.fill(0);
    throw new Error(
      `CONSOLE_WEBHOOK_SECRET_KEY_B64U must decode to ${CONSOLE_WEBHOOK_SECRET_KEY_BYTES} bytes`,
    );
  }
  return decoded;
}

async function createCloudflareD1Webhooks(input: {
  readonly options: NormalizedCloudflareD1ConsoleCommonOptions;
  readonly observabilityIngestion: ConsoleObservabilityIngestionService;
}): Promise<ConsoleWebhookService | null> {
  const options = input.options;
  if (!options.webhookSecretCipher) return null;
  const logger = normalizeLogger(options.logger);
  return await createD1ConsoleWebhookService({
    categoryValidation: WALLET_CONSOLE_WEBHOOK_EVENT_CATEGORY_VALIDATION,
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
    dispatcher: options.webhookDispatcher,
    secretCipher: options.webhookSecretCipher,
    observabilityIngestion: input.observabilityIngestion,
    observabilityLogger: logger,
    endpointDegradedThreshold: options.webhookEndpointDegradedThreshold,
  });
}

async function createCloudflareD1SponsoredCalls(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsoleSponsoredCallService> {
  return await createD1ConsoleSponsoredCallService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    now: options.now,
  });
}

async function ensureCloudflareD1SponsorshipPricingSchema(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<void> {
  if (!options.ensureSchema) return;
  await ensureConsoleSponsorshipPricingD1Schema({
    database: options.consoleDatabase,
  });
}

async function createCloudflareD1SpendCaps(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsoleSponsorshipSpendCapService> {
  return await createD1ConsoleSponsorshipSpendCapService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
  });
}

async function createCloudflareD1RuntimeSnapshots(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<ConsoleRuntimeSnapshotService> {
  return await createD1ConsoleRuntimeSnapshotService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
    logger: options.logger,
    retentionTtlMs: options.runtimeSnapshotRetentionTtlMs,
    retentionPruneIntervalMs: options.runtimeSnapshotRetentionPruneIntervalMs,
    retentionBatchSize: options.runtimeSnapshotRetentionBatchSize,
  });
}

async function createCloudflareD1ConsoleCommonServices(
  normalized: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<CloudflareD1ConsoleCommonServices> {
  const core = await createCloudflareD1AccountServiceBundle({
    database: normalized.consoleDatabase,
    namespace: normalized.namespace,
    ensureSchema: normalized.ensureSchema,
    now: normalized.now,
    logger: normalized.logger,
    organizationEmail: normalized.organizationEmail,
    billingProviders: normalized.billingProviders,
    billingEmailConsoleBaseUrl: normalized.billingEmailConsoleBaseUrl,
    onboardingEmail: normalized.onboardingEmail,
    auditCategories: WALLET_CONSOLE_AUDIT_CATEGORIES,
    auditEvidenceReferenceKinds: WALLET_CONSOLE_AUDIT_EVIDENCE_REFERENCE_KINDS,
    externalDeletionGuard: new D1WalletOrganizationDeletion(
      normalized.consoleDatabase,
      normalized.namespace,
    ),
  });
  const baseWalletEnvironments = await createD1ConsoleWalletEnvironmentService({
    database: normalized.consoleDatabase,
    namespace: normalized.namespace,
    ensureSchema: normalized.ensureSchema,
    now: normalized.now,
  });
  const policies = await createCloudflareD1Policies(normalized);
  const wallets = await createCloudflareD1Wallets(normalized);
  const apiKeys = await createCloudflareD1ApiKeys(normalized);
  const approvals = await createCloudflareD1Approvals(normalized);
  const keyExports = await createCloudflareD1KeyExports(normalized);
  const observability = await createCloudflareD1Observability(normalized);
  const observabilityIngestion = await createCloudflareD1ObservabilityIngestion(normalized);
  const webhooks = await createCloudflareD1Webhooks({
    options: normalized,
    observabilityIngestion,
  });
  const sponsoredCalls = await createCloudflareD1SponsoredCalls(normalized);
  await ensureCloudflareD1SponsorshipPricingSchema(normalized);
  const runtimeSnapshots = await createCloudflareD1RuntimeSnapshots(normalized);
  const walletEnvironments = normalized.sponsoredEvmCallConfig
    ? createConsoleWalletEnvironmentServiceWithTempoOnboardingSponsorship({
        base: baseWalletEnvironments,
        policies,
        runtimeSnapshots,
        faucetContractAddress: DEFAULT_TEMPO_ONBOARDING_CONTRACT,
      })
    : baseWalletEnvironments;
  const executionFunds = new WalletExecutionFunds({
    database: normalized.consoleDatabase,
    namespace: normalized.namespace,
    deploymentId: normalized.deploymentId,
    platform: core.accountPlatform,
    reservations: core.funds,
    usage: core.billingUsage,
  });
  const walletMonthlyUsage = new WalletMonthlyUsageAdapter({
    database: normalized.consoleDatabase,
    namespace: normalized.namespace,
    deploymentId: normalized.deploymentId,
    platform: core.accountPlatform,
    usage: core.billingUsage,
  });
  if (normalized.ensureSchema) await walletMonthlyUsage.ensureSchema();
  const walletProvisioning = new WalletServiceProvisioningAdapter({
    deploymentId: normalized.deploymentId,
    namespace: normalized.namespace,
    environments: walletEnvironments,
    orgProjects: core.orgProjects,
    billing: core.billing,
  });
  return {
    ...core,
    walletProvisioning,
    walletEnvironments,
    policies,
    wallets,
    apiKeys,
    approvals,
    keyExports,
    webhooks,
    observability,
    observabilityIngestion,
    executionFunds,
    walletMonthlyUsage,
    sponsoredCalls,
    runtimeSnapshots,
  };
}

function createCloudflareD1ConsoleRouterStorageOptions(input: {
  readonly tenantStorageRouteResolver: TenantStorageRouteResolver;
  readonly tenantStorageNamespace: string;
  readonly orgProjects: ConsoleOrgProjectService;
  readonly accountPlatform: D1AccountPlatformService;
  readonly walletProvisioning: AccountServiceProvisioningAdapterV1;
  readonly walletEnvironments: ConsoleWalletEnvironmentService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly account: ConsoleAccountService;
  readonly policies: ConsolePolicyService;
  readonly wallets: ConsoleWalletService;
  readonly apiKeys: ConsoleApiKeyService;
  readonly approvals: ConsoleApprovalService;
  readonly keyExports: ConsoleKeyExportService;
  readonly webhooks: ConsoleWebhookService | null;
  readonly observability: ConsoleObservabilityService;
  readonly observabilityIngestion: ConsoleObservabilityIngestionService;
  readonly onboarding: ConsoleOnboardingService;
  readonly audit: ConsoleAuditService;
  readonly billing: ConsoleBillingService;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billingUsage: D1BillingUsageService;
  readonly sponsoredCalls: ConsoleSponsoredCallService;
  readonly runtimeSnapshots: ConsoleRuntimeSnapshotService;
}): CloudflareD1ConsoleRouterStorageOptions {
  return {
    tenantStorageRouteResolver: input.tenantStorageRouteResolver,
    tenantStorageNamespace: input.tenantStorageNamespace,
    orgProjects: input.orgProjects,
    accountPlatform: input.accountPlatform,
    walletProvisioning: input.walletProvisioning,
    satyrProvisioning: null,
    walletEnvironments: input.walletEnvironments,
    organizationAccess: input.organizationAccess,
    account: input.account,
    policies: input.policies,
    wallets: input.wallets,
    apiKeys: input.apiKeys,
    approvals: input.approvals,
    keyExports: input.keyExports,
    webhooks: input.webhooks,
    observability: input.observability,
    observabilityIngestion: input.observabilityIngestion,
    onboarding: input.onboarding,
    audit: input.audit,
    billing: input.billing,
    funds: input.funds,
    billingUsage: input.billingUsage,
    sponsoredCalls: input.sponsoredCalls,
    runtimeSnapshots: input.runtimeSnapshots,
  };
}

function createCloudflareD1RouterApiStorageOptions(input: {
  readonly options: NormalizedCloudflareD1ConsoleServiceBundleOptions;
  readonly accountPlatform: D1AccountPlatformService;
  readonly walletProvisioning: AccountServiceProvisioningAdapterV1;
  readonly sponsorshipPricing: SponsorshipSpendPricingService | null;
  readonly walletEnvironments: ConsoleWalletEnvironmentService;
  readonly wallets: ConsoleWalletService;
  readonly apiKeys: ConsoleApiKeyService;
  readonly billing: ConsoleBillingService;
  readonly executionFunds: WalletExecutionFunds;
  readonly spendCaps: ConsoleSponsorshipSpendCapService;
  readonly sponsoredCalls: ConsoleSponsoredCallService;
  readonly runtimeSnapshots: ConsoleRuntimeSnapshotService;
  readonly observabilityIngestion: ConsoleObservabilityIngestionService;
  readonly webhooks: ConsoleWebhookService | null;
}): CloudflareD1RouterApiStorageOptions {
  const { options } = input;
  const admissionStore = createCloudflareD1RouterAbNormalSigningAdmissionStore({
    database: options.signerMetadataDatabase,
    storageNamespace: options.namespace,
  });
  const sponsoredEvmCallConfig = options.sponsoredEvmCallConfig || null;
  const apiKeyAuth = createRouterApiKeyAuthAdapter(input.apiKeys);
  const publishableKeyAuth = createRouterApiPublishableKeyAuthAdapter(input.apiKeys);
  const walletEnvironments = createWalletProjectEnvironmentResolver({
    database: options.consoleDatabase,
    namespace: options.namespace,
    deploymentId: options.deploymentId,
  });
  return {
    apiKeyAuth,
    publishableKeyAuth,
    registrationContext: createWalletRegistrationContextResolver(
      publishableKeyAuth,
      walletEnvironments,
    ),
    apiKeyUsageMeter: createRouterApiWalletRegistrationProjectionAdapter({
      walletEnvironments: input.walletEnvironments,
      wallets: input.wallets,
    }),
    orgProjectEnv: walletEnvironments,
    routeExtensions: createConsoleRouterApiRouteExtensions({
      apiKeyAuth,
      ...(sponsoredEvmCallConfig
        ? {
            sponsoredEvmCall: {
              publishableKeyAuth,
              billing: input.billing,
              ledger: input.sponsoredCalls,
              runtimeSnapshots: input.runtimeSnapshots,
              config: sponsoredEvmCallConfig,
              resolveExecutionAdapter: options.resolveSponsoredEvmExecutionAdapter || null,
              observabilityIngestion: input.observabilityIngestion,
              executionFunds: input.executionFunds,
              pricing: input.sponsorshipPricing,
              spendCaps: input.spendCaps,
              webhooks: input.webhooks,
            },
          }
        : {}),
      wallets: input.wallets,
    }),
    routerAbNormalSigningAdmission: createRouterAbNormalSigningAdmissionAdapter(admissionStore),
  };
}

async function createCloudflareD1RouterApiSponsorshipPricing(
  options: NormalizedCloudflareD1ConsoleCommonOptions,
): Promise<SponsorshipSpendPricingService | null> {
  if (options.sponsorshipPricing === null) return null;
  if (!options.sponsoredEvmCallConfig) return options.sponsorshipPricing || null;
  const evmPricing = await createD1ConsoleSponsorshipPricingService({
    database: options.consoleDatabase,
    namespace: options.namespace,
    ensureSchema: false,
    now: options.now,
  });
  if (!options.sponsorshipPricing) return evmPricing;
  return createChainFamilySponsoredExecutionPricingService({
    evm: evmPricing,
    near: options.sponsorshipPricing,
  });
}

export async function createCloudflareD1ConsoleServiceBundle(
  options: CloudflareD1ConsoleServiceBundleOptions,
): Promise<CloudflareD1ConsoleServiceBundle> {
  const normalized = normalizeCloudflareD1ConsoleServiceBundleOptions(options);
  const tenantStorageRouteResolver = createCloudflareD1TenantRouteResolver(normalized);
  const services = await createCloudflareD1ConsoleCommonServices(normalized);
  const apiKeys = normalized.sponsoredEvmCallConfig
    ? createTempoOnboardingApiKeyService({
        apiKeys: services.apiKeys,
        walletEnvironments: services.walletEnvironments,
        policies: services.policies,
        runtimeSnapshots: services.runtimeSnapshots,
        pricingSeed: {
          database: normalized.consoleDatabase,
          namespace: normalized.namespace,
          now: normalized.now,
        },
      })
    : services.apiKeys;
  const servicesWithApiKeys = {
    ...services,
    apiKeys,
  };
  const spendCaps = await createCloudflareD1SpendCaps(normalized);
  const sponsorshipPricing = await createCloudflareD1RouterApiSponsorshipPricing(normalized);
  const consoleRouterOptions = createCloudflareD1ConsoleRouterStorageOptions({
    tenantStorageRouteResolver,
    tenantStorageNamespace: normalized.namespace,
    ...servicesWithApiKeys,
  });
  const routerApiRouterOptions = createCloudflareD1RouterApiStorageOptions({
    options: normalized,
    accountPlatform: servicesWithApiKeys.accountPlatform,
    walletProvisioning: servicesWithApiKeys.walletProvisioning,
    sponsorshipPricing,
    walletEnvironments: servicesWithApiKeys.walletEnvironments,
    wallets: servicesWithApiKeys.wallets,
    apiKeys: servicesWithApiKeys.apiKeys,
    billing: servicesWithApiKeys.billing,
    executionFunds: servicesWithApiKeys.executionFunds,
    spendCaps,
    sponsoredCalls: servicesWithApiKeys.sponsoredCalls,
    runtimeSnapshots: servicesWithApiKeys.runtimeSnapshots,
    observabilityIngestion: servicesWithApiKeys.observabilityIngestion,
    webhooks: servicesWithApiKeys.webhooks,
  });
  return {
    tenantStorageRouteResolver,
    tenantStorageNamespace: normalized.namespace,
    ...servicesWithApiKeys,
    spendCaps,
    sponsorshipPricing,
    consoleRouterOptions,
    routerApiRouterOptions,
  };
}

export async function createCloudflareD1ConsoleOnlyServiceBundle(
  options: CloudflareD1ConsoleOnlyServiceBundleOptions,
): Promise<CloudflareD1ConsoleOnlyServiceBundle> {
  const normalized = normalizeCloudflareD1ConsoleOnlyServiceBundleOptions(options);
  const services = await createCloudflareD1ConsoleCommonServices(normalized);
  const apiKeys = normalized.sponsoredEvmCallConfig
    ? createTempoOnboardingApiKeyService({
        apiKeys: services.apiKeys,
        walletEnvironments: services.walletEnvironments,
        policies: services.policies,
        runtimeSnapshots: services.runtimeSnapshots,
        pricingSeed: {
          database: normalized.consoleDatabase,
          namespace: normalized.namespace,
          now: normalized.now,
        },
      })
    : services.apiKeys;
  const servicesWithApiKeys = {
    ...services,
    apiKeys,
  };
  const spendCaps = await createCloudflareD1SpendCaps(normalized);
  const sponsorshipPricing = await createCloudflareD1RouterApiSponsorshipPricing(normalized);
  return {
    tenantStorageNamespace: normalized.namespace,
    ...servicesWithApiKeys,
    spendCaps,
    sponsorshipPricing,
    consoleRouterOptions: {
      ...servicesWithApiKeys,
      satyrProvisioning: null,
    },
  };
}

export function asConsoleRouterOptions(
  input: CloudflareD1ConsoleRouterStorageOptions,
): CloudflareD1ConsoleRouterStorageOptions {
  return input;
}

export function asRouterApiOptions(
  input: CloudflareD1RouterApiStorageOptions,
): CloudflareD1RouterApiStorageOptions {
  return input;
}
