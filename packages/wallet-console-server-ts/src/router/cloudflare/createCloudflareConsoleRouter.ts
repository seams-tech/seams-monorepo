import { createWalletBillingRouteHooks } from './walletBillingHooks';
import type { D1BillingUsageService } from '@seams-internal/console-server/billing/usage';
import type { WalletExecutionFunds } from '@seams-internal/wallet-console-server/sponsorship/funds';
import {
  handleConsoleBillingRoutes,
  sendBillingError,
} from '@seams-internal/console-server/router/cloudflare/billingRoutes';
import { hasConsoleProjectAccess } from '@seams-internal/console-server/router/consoleRoutePolicy';
import { buildWalletConsoleAuthClaims } from '../walletConsoleAuth';
import { handleConsoleAuditRoutes } from '@seams-internal/console-server/router/cloudflare/auditRoutes';
import {
  authenticateWalletConsoleRequest,
  type WalletConsoleAuthClaims as ConsoleAuthClaims,
} from '../walletConsoleAuth';
import {
  resolveConsoleReturnOrigin,
  type AccountConsoleContext,
} from '@seams-internal/console-server/router/cloudflare/context';
import { handleAccountPlatformRoutes } from '@seams-internal/console-server/router/cloudflare/accountPlatformRoutes';
import {
  handleConsoleHealth,
  handleConsoleReady,
  handleConsoleSession,
  handleConsoleAccount,
  handleConsoleOnboarding,
  handleConsoleOrganizationAccess,
  handleConsoleProjects,
  requireConsoleRoutePolicy,
  sendOnboardingError,
} from '@seams-internal/console-server/router/cloudflare/accountRoutes';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '@seams-internal/wallet-console-shared/apiKeyScopes';
import { WALLET_CONSOLE_WEBHOOK_EVENT_CATEGORY_VALIDATION } from '@seams-internal/wallet-console-shared/webhookEventCategories';
import { buildCorsOrigins, normalizeCorsOrigin } from '@seams/wallet-server/cloud-host';
import type { ConsoleBillingService } from '@seams-internal/console-server/billing/service';
import {
  LIVE_ENVIRONMENT_BILLING_REQUIRED_MESSAGE,
  ensureBillingReadyForLiveEnvironment,
} from '@seams-internal/wallet-console-server/environments/readiness';
import {
  ConsoleBillingError,
  isConsoleBillingError,
} from '@seams-internal/console-server/billing/errors';
import type { ConsoleBillingPrepaidReservationService } from '@seams-internal/console-server/billingPrepaidReservations/service';
import type { ConsoleSponsoredCallService } from '@seams-internal/wallet-console-server/sponsoredCalls/service';
import { isConsoleSponsoredCallError } from '@seams-internal/wallet-console-server/sponsoredCalls/errors';
import { listConsoleSponsoredCallReconciliationPage } from '@seams-internal/wallet-console-server/sponsoredCalls/reconciliation';
import { parseListConsoleSponsoredCallRecordsRequest } from '@seams-internal/wallet-console-server/sponsoredCalls/requests';
import type { ConsoleApiKeyService } from '@seams-internal/wallet-console-server/apiKeys/service';
import type { ConsoleApiKey } from '@seams-internal/wallet-console-server/apiKeys/types';
import { isConsoleApiKeyError } from '@seams-internal/wallet-console-server/apiKeys/errors';
import {
  parseCreateConsoleApiKeyRequest,
  parseRevokeConsoleApiKeyRequest,
  parseRotateConsoleApiKeyRequest,
  parseUpdateConsoleApiKeyRequest,
} from '@seams-internal/wallet-console-server/apiKeys/requests';
import type { ConsoleOrgProjectService } from '@seams-internal/console-server/orgProjectEnv/service';
import { isConsoleOrgProjectError } from '@seams-internal/console-server/orgProjectEnv/errors';
import {
  type ConsoleWalletEnvironmentService,
  isConsoleWalletEnvironmentError,
  parseCreateConsoleWalletEnvironmentRequest,
  parseListConsoleWalletEnvironmentsRequest,
  parseUpdateConsoleWalletEnvironmentRequest,
  serializeWalletEnvironment,
} from '@seams-internal/wallet-console-server/environments';
import type { ConsoleWalletService } from '@seams-internal/wallet-console-server/wallets/service';
import { isConsoleWalletError } from '@seams-internal/wallet-console-server/wallets/errors';
import {
  parseConsoleWalletKey,
  parseListConsoleWalletsRequest,
  parseSearchConsoleWalletsRequest,
} from '@seams-internal/wallet-console-server/wallets/requests';
import {
  hasWalletBalanceRefresh,
  parseRefreshConsoleWalletBalancesRequest,
} from '@seams-internal/wallet-console-server/wallets/balances';
import type { ConsolePolicyService } from '@seams-internal/wallet-console-server/policies/service';
import type {
  ConsoleGasSponsorshipPolicyRules,
  ConsolePolicy,
  ConsolePolicyAssignment,
} from '@seams-internal/wallet-console-server/policies/types';
import { isConsolePolicyError } from '@seams-internal/wallet-console-server/policies/errors';
import {
  isConsoleGasSponsorshipPolicyRules,
  parseConsolePolicyRulesInput,
} from '@seams-internal/wallet-console-server/policies/rules';
import {
  parseCreateConsolePolicyRequest,
  parseListConsolePoliciesRequest,
  parseListConsolePolicyAssignmentsRequest,
  parseSimulateConsolePolicyRequest,
  parseUpsertConsolePolicyAssignmentRequest,
  parseUpdateConsolePolicyRequest,
} from '@seams-internal/wallet-console-server/policies/requests';
import type { ConsoleWebhookService } from '@seams-internal/console-server/webhooks/service';
import { isConsoleWebhookError } from '@seams-internal/console-server/webhooks/errors';
import {
  parseCreateConsoleWebhookEndpointRequest,
  parseListConsoleWebhookDeliveriesRequest,
  parseListConsoleWebhookAttemptsRequest,
  parseListConsoleWebhookDeadLettersRequest,
  parseReplayConsoleWebhookDeliveryRequest,
  parseUpdateConsoleWebhookEndpointRequest,
} from '@seams-internal/console-server/webhooks/requests';
import type { ConsoleKeyExportService } from '@seams-internal/wallet-console-server/keyExports/service';
import type {
  ConsoleKeyExportRequestRecord,
  ListConsoleKeyExportsRequest,
} from '@seams-internal/wallet-console-server/keyExports/types';
import { isConsoleKeyExportError } from '@seams-internal/wallet-console-server/keyExports/errors';
import {
  parseApproveConsoleKeyExportRequest,
  parseCreateConsoleKeyExportRequest,
  parseListConsoleKeyExportsRequest,
} from '@seams-internal/wallet-console-server/keyExports/requests';
import type { ConsoleRuntimeSnapshotService } from '@seams-internal/wallet-console-server/runtimeSnapshots/service';
import { isConsoleRuntimeSnapshotError } from '@seams-internal/wallet-console-server/runtimeSnapshots/errors';
import {
  parseGetLatestConsoleRuntimeSnapshotRequest,
  parseListConsoleRuntimeSnapshotsRequest,
  parsePublishCurrentConsoleRuntimeSnapshotRequest,
} from '@seams-internal/wallet-console-server/runtimeSnapshots/requests';
import type { ConsoleOrganizationAccessService } from '@seams-internal/console-server/teamRbac/index';
import type {
  ApproveConsoleApprovalRequest,
  CreateConsoleApprovalRequest,
  ConsoleApprovalRequestRecord,
  ParsedCreateConsoleApprovalRequest,
} from '@seams-internal/wallet-console-server/approvals/types';
import type { ConsoleApprovalService } from '@seams-internal/wallet-console-server/approvals/service';
import {
  ConsoleApprovalsError,
  isConsoleApprovalsError,
} from '@seams-internal/wallet-console-server/approvals/errors';
import {
  parseApproveConsoleApprovalRequest,
  parseCreateConsoleApprovalRequest,
  parseListConsoleApprovalsRequest,
  parseRejectConsoleApprovalRequest,
} from '@seams-internal/wallet-console-server/approvals/requests';
import type { ConsoleAuditService } from '@seams-internal/console-server/audit/service';
import type { ConsoleAuditEvent } from '@seams-internal/console-server/audit/types';
import { CONSOLE_AUDIT_QUERY_CATEGORIES } from '@seams-internal/console-server/audit/requests';
import { WALLET_CONSOLE_AUDIT_CATEGORIES } from '../../audit';
import type { ConsoleAuditExportsService } from '@seams-internal/console-server/auditExports/service';
import { isConsoleAuditExportsError } from '@seams-internal/console-server/auditExports/errors';
import {
  parseCreateConsoleAuditExportRequest,
  parseListConsoleAuditExportsRequest,
} from '@seams-internal/console-server/auditExports/requests';
import type { ConsoleEnterpriseIsolationService } from '@seams-internal/console-server/enterpriseIsolation/service';
import { isConsoleEnterpriseIsolationError } from '@seams-internal/console-server/enterpriseIsolation/errors';
import {
  parseGetConsoleEnterpriseIsolationRequest,
  parseTriggerConsoleEnterpriseIsolationRequest,
} from '@seams-internal/console-server/enterpriseIsolation/requests';
import type { ConsoleOnboardingService } from '@seams-internal/console-server/onboarding/service';
import { parseGetConsoleOnboardingTelemetryRequest } from '@seams-internal/console-server/onboarding/requests';
import type { ConsoleAccountService } from '@seams-internal/console-server/account/service';
import type { ConsoleObservabilityIngestionService } from '@seams-internal/console-server/observability/ingestionService';
import type { ConsoleObservabilityService } from '@seams-internal/console-server/observability/service';
import { isConsoleObservabilityError } from '@seams-internal/console-server/observability/errors';
import type { ConsoleRouterOptions } from '@seams-internal/wallet-console-server/router/console';
import {
  emitConsoleApprovalFailureObservabilityEvent,
  observeConsoleRequestMetric,
} from '../consoleObservabilityHooks';
import {
  buildConsoleExportGovernanceView,
  buildConsoleGasReadinessView,
  buildConsolePolicyCoverageView,
  resolveConsoleInsightsScope,
} from '../consoleInsights';
import {
  type ConsolePolicyPresentation,
  listConsolePolicyPresentationLookup,
  projectConsolePolicyPresentation,
} from '../policyPresentation';
import { ConsolePolicyRulesDigest } from '../../policies/reviewDigest';
import {
  buildConsolePolicyAssignmentAuditEvent,
  buildConsolePolicyAuditEvent,
  buildConsoleWebhookEndpointAuditEvent,
  buildConsoleWebhookReplayAuditEvent,
} from '../consoleAuditMetadata';
import { resolveConsoleRuntimeSnapshotPayload } from '../runtimeSnapshotPayload';
import type { NormalizedRouterLogger } from '@seams/wallet-server/cloud-host';
import { coerceRouterLogger } from '@seams/wallet-server/cloud-host';
import { buildConsoleOpsCockpitSummary } from '../opsCockpitSummary';
import { attachConsoleRouteSurface } from '@seams-internal/console-server/router/consoleRouteSurface';
import type { ConsoleRouteDefinition } from '@seams-internal/console-server/router/consoleRouteDefinitions';
import { resolveWalletConsoleRouteSurface } from '../walletConsoleRouteDefinitions';
import { handleConsoleObservabilityRoutes } from './consoleObservabilityRoutes';
import type { CfEnv, CfExecutionContext, FetchHandler } from '@seams/wallet-server/cloud-host';
import { headersToRecord, json, readJson } from '@seams/wallet-server/cloud-host';
import {
  tenantStorageRouteDiagnostic,
  type CloudflareTenantStorageRoute,
  type TenantStorageRouteResolver,
} from './tenantStorageRoute';
import type { TenantStorageRouteDiagnostic } from '@seams/wallet-server/cloud-host';
import { parseOrgId } from '@seams/wallet-server/cloud-host';
import { assertNever } from '@seams-internal/console-shared/accountPlatform/boundary';
import {
  verifyFreshStepUpForRequestV1,
  type TenantRootStepUpReaderV1,
} from '../../tenantRootSecurity/routeGuard';
import type { TenantRootStepUpProofV1 } from '../../tenantRootSecurity/stepUp';

export interface CloudflareConsoleContext extends Omit<AccountConsoleContext, 'authorizeTenant'> {
  authorizeTenant: AccountConsoleContext['authorizeTenant'];
  request: Request;
  url: URL;
  pathname: string;
  method: string;
  env?: CfEnv;
  cfCtx?: CfExecutionContext;

  opts: ConsoleRouterOptions;
  logger: NormalizedRouterLogger;
  routeDefinitions: readonly ConsoleRouteDefinition[];
  billing: ConsoleBillingService | null;
  funds: ConsoleBillingPrepaidReservationService | null;
  billingUsage: D1BillingUsageService | null;
  executionFunds: WalletExecutionFunds | null;
  sponsoredCalls: ConsoleSponsoredCallService | null;
  orgProjects: ConsoleOrgProjectService | null;
  walletEnvironments: ConsoleWalletEnvironmentService | null;
  wallets: ConsoleWalletService | null;
  policies: ConsolePolicyService | null;
  apiKeys: ConsoleApiKeyService | null;
  webhooks: ConsoleWebhookService | null;
  keyExports: ConsoleKeyExportService | null;
  runtimeSnapshots: ConsoleRuntimeSnapshotService | null;
  organizationAccess: ConsoleOrganizationAccessService | null;
  approvals: ConsoleApprovalService | null;
  stepUp: TenantRootStepUpReaderV1 | null;
  audit: ConsoleAuditService | null;
  auditExports: ConsoleAuditExportsService | null;
  enterpriseIsolation: ConsoleEnterpriseIsolationService | null;
  onboarding: ConsoleOnboardingService | null;
  account: ConsoleAccountService | null;
  observability: ConsoleObservabilityService | null;
  observabilityIngestion: ConsoleObservabilityIngestionService | null;
  tenantStorageRouteResolver: TenantStorageRouteResolver | null;
  tenantStorageNamespace: string | null;
  tenantStorageRoute?: CloudflareTenantStorageRoute;
  tenantStorageRouteDiagnostic?: TenantStorageRouteDiagnostic;
}

const CONSOLE_CORS_ALLOW_HEADERS =
  'Content-Type,Authorization,X-Console-Org-Id,X-Console-User-Id,X-Console-Roles,X-Console-Project-Id,X-Console-Environment-Id';

function withConsoleCors(headers: Headers, opts?: ConsoleRouterOptions, request?: Request): void {
  if (!opts?.corsOrigins) return;

  let allowedOrigin: string | '*' | undefined;
  const normalized = buildCorsOrigins(...(opts.corsOrigins || []));
  if (normalized === '*') {
    allowedOrigin = '*';
    headers.set('Access-Control-Allow-Origin', '*');
  } else if (Array.isArray(normalized)) {
    const originRaw = String(request?.headers.get('Origin') || '').trim();
    const originNormalized = normalizeCorsOrigin(originRaw);
    if (originRaw && originNormalized && normalized.includes(originNormalized)) {
      allowedOrigin = originRaw;
      headers.set('Access-Control-Allow-Origin', originRaw);
      headers.append('Vary', 'Origin');
    }
  }

  headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', CONSOLE_CORS_ALLOW_HEADERS);
  if (allowedOrigin && allowedOrigin !== '*') {
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
}

function readOptionalRequestHeader(request: Request, header: string): string | undefined {
  const value = String(request.headers.get(header) || '').trim();
  return value || undefined;
}

async function emitRouterTimingObservabilityEvent(
  ctx: CloudflareConsoleContext,
  startedAtMs: number,
  statusCode: number,
): Promise<void> {
  let claims: ConsoleAuthClaims | undefined;
  if (ctx.authClaims) {
    claims = buildWalletConsoleAuthClaims(
      ctx.authClaims,
      ctx.authClaims.projectId ?? null,
      ctx.request.headers.get('X-Console-Environment-Id'),
    );
  }
  await observeConsoleRequestMetric(ctx, {
    claims,
    route: ctx.pathname,
    method: ctx.method,
    statusCode,
    latencyMs: Math.max(0, Date.now() - startedAtMs),
  });
}

async function emitApprovalFailureObservabilityEvent(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  input: {
    approvalId?: string;
    operationType: string;
    resourceType?: string;
    resourceId?: string;
    error: unknown;
  },
): Promise<void> {
  await emitConsoleApprovalFailureObservabilityEvent(ctx, {
    claims,
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    operationType: input.operationType,
    ...(input.resourceType ? { resourceType: input.resourceType } : {}),
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    failureCode: isConsolePolicyError(input.error) ? input.error.code : 'internal',
    failureMessage: input.error instanceof Error ? input.error.message : String(input.error),
    readHeader: (header) => readOptionalRequestHeader(ctx.request, header),
  });
}

function sendSponsoredCallError(error: unknown): Response {
  if (isConsoleSponsoredCallError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
      },
      { status: error.status },
    );
  }
  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendApiKeyError(error: unknown): Response {
  if (isConsoleApiKeyError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendOrganizationMetadataError(error: unknown): Response {
  if (isConsoleOrgProjectError(error) || isConsoleWalletEnvironmentError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(isConsoleOrgProjectError(error) && error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendWalletError(error: unknown): Response {
  if (isConsoleWalletError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendPolicyError(error: unknown): Response {
  if (isConsolePolicyError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendWebhookError(error: unknown): Response {
  if (isConsoleWebhookError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendKeyExportError(error: unknown): Response {
  if (isConsoleKeyExportError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendRuntimeSnapshotError(error: unknown): Response {
  if (isConsoleRuntimeSnapshotError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendApprovalError(error: unknown): Response {
  if (isConsoleApprovalsError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendAuditExportsError(error: unknown): Response {
  if (isConsoleAuditExportsError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendEnterpriseIsolationError(error: unknown): Response {
  if (isConsoleEnterpriseIsolationError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function sendObservabilityError(error: unknown): Response {
  if (isConsoleObservabilityError(error)) {
    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  return json(
    {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

async function requireConsoleAuth(
  ctx: CloudflareConsoleContext,
): Promise<{ ok: true; claims: ConsoleAuthClaims } | { ok: false; response: Response }> {
  const result = await authenticateWalletConsoleRequest(
    headersToRecord(ctx.request.headers),
    ctx.auth,
  );
  if (!result.ok)
    return {
      ok: false,
      response: json(
        { ok: false, code: result.code, message: result.message },
        { status: result.status },
      ),
    };
  const policyFailure = requireConsoleRoutePolicy(ctx, result.claims);
  if (policyFailure) return { ok: false, response: policyFailure };
  const storageFailure = resolveTenantStorageRouteForConsoleRequest(ctx, result.claims);
  if (storageFailure) return { ok: false, response: storageFailure };
  ctx.authClaims = result.claims;
  return { ok: true, claims: result.claims };
}

function resolveTenantStorageRouteForConsoleRequest(
  ctx: CloudflareConsoleContext,
  claims: { readonly orgId: string },
): Response | null {
  if (!ctx.tenantStorageRouteResolver) return null;
  if (!ctx.tenantStorageNamespace) {
    return json(
      {
        ok: false,
        code: 'tenant_storage_namespace_not_configured',
        message: 'Tenant storage namespace is not configured on this server',
      },
      { status: 500 },
    );
  }
  const orgId = parseOrgId(claims.orgId);
  if (!orgId.ok) {
    return json(
      {
        ok: false,
        code: 'tenant_storage_org_id_invalid',
        message: orgId.error.message,
      },
      { status: 500 },
    );
  }
  const route = ctx.tenantStorageRouteResolver.resolveTenantStorageRoute({
    namespace: ctx.tenantStorageNamespace,
    orgId: orgId.value,
  });
  ctx.tenantStorageRouteDiagnostic = tenantStorageRouteDiagnostic(route);
  if (route.kind !== 'cloudflare_d1_do') {
    return json(
      {
        ok: false,
        code: 'tenant_storage_backend_not_supported_in_cloudflare_runtime',
        message: 'Cloudflare console runtime only accepts cloudflare_d1_do tenant routes',
        route: ctx.tenantStorageRouteDiagnostic,
      },
      { status: 500 },
    );
  }
  ctx.tenantStorageRoute = route;
  return null;
}

function requireBillingService(ctx: CloudflareConsoleContext): ConsoleBillingService | Response {
  if (ctx.billing) return ctx.billing;
  return json(
    {
      ok: false,
      code: 'billing_not_configured',
      message: 'Billing service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireSponsoredCallService(
  ctx: CloudflareConsoleContext,
): ConsoleSponsoredCallService | Response {
  if (ctx.sponsoredCalls) return ctx.sponsoredCalls;
  return json(
    {
      ok: false,
      code: 'sponsored_calls_not_configured',
      message: 'Sponsored call service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireApiKeyService(ctx: CloudflareConsoleContext): ConsoleApiKeyService | Response {
  if (ctx.apiKeys) return ctx.apiKeys;
  return json(
    {
      ok: false,
      code: 'api_keys_not_configured',
      message: 'API key service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireWalletEnvironmentService(
  ctx: CloudflareConsoleContext,
): ConsoleWalletEnvironmentService | Response {
  if (ctx.walletEnvironments) return ctx.walletEnvironments;
  return json(
    {
      ok: false,
      code: 'wallet_environments_not_configured',
      message: 'Wallet environment service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireWalletService(ctx: CloudflareConsoleContext): ConsoleWalletService | Response {
  if (ctx.wallets) return ctx.wallets;
  return json(
    {
      ok: false,
      code: 'wallets_not_configured',
      message: 'Wallet service is not configured on this server',
    },
    { status: 501 },
  );
}

function requirePolicyService(ctx: CloudflareConsoleContext): ConsolePolicyService | Response {
  if (ctx.policies) return ctx.policies;
  return json(
    {
      ok: false,
      code: 'policies_not_configured',
      message: 'Policy service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireWebhookService(ctx: CloudflareConsoleContext): ConsoleWebhookService | Response {
  if (ctx.webhooks) return ctx.webhooks;
  return json(
    {
      ok: false,
      code: 'webhooks_not_configured',
      message: 'Webhook service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireKeyExportService(
  ctx: CloudflareConsoleContext,
): ConsoleKeyExportService | Response {
  if (ctx.keyExports) return ctx.keyExports;
  return json(
    {
      ok: false,
      code: 'key_exports_not_configured',
      message: 'Key export service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireRuntimeSnapshotService(
  ctx: CloudflareConsoleContext,
): ConsoleRuntimeSnapshotService | Response {
  if (ctx.runtimeSnapshots) return ctx.runtimeSnapshots;
  return json(
    {
      ok: false,
      code: 'runtime_snapshots_not_configured',
      message: 'Runtime snapshot service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireApprovalService(ctx: CloudflareConsoleContext): ConsoleApprovalService | Response {
  if (ctx.approvals) return ctx.approvals;
  return json(
    {
      ok: false,
      code: 'approvals_not_configured',
      message: 'Approvals service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireAuditExportsService(
  ctx: CloudflareConsoleContext,
): ConsoleAuditExportsService | Response {
  if (ctx.auditExports) return ctx.auditExports;
  return json(
    {
      ok: false,
      code: 'audit_exports_not_configured',
      message: 'Audit exports service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireEnterpriseIsolationService(
  ctx: CloudflareConsoleContext,
): ConsoleEnterpriseIsolationService | Response {
  if (ctx.enterpriseIsolation) return ctx.enterpriseIsolation;
  return json(
    {
      ok: false,
      code: 'enterprise_isolation_not_configured',
      message: 'Enterprise isolation service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireObservabilityService(
  ctx: CloudflareConsoleContext,
): ConsoleObservabilityService | Response {
  if (ctx.observability) return ctx.observability;
  return json(
    {
      ok: false,
      code: 'observability_not_configured',
      message: 'Observability service is not configured on this server',
    },
    { status: 501 },
  );
}

function toBillingContext(claims: { readonly orgId: string; readonly userId: string }): {
  orgId: string;
  actorUserId: string;
} {
  return {
    orgId: claims.orgId,
    actorUserId: claims.userId,
  };
}

function toWalletEnvironmentContext(claims: ConsoleAuthClaims): {
  orgId: string;
  actorUserId: string;
  projectId?: string;
  environmentId?: string;
} {
  return {
    orgId: claims.orgId,
    actorUserId: claims.userId,
    ...(claims.projectId ? { projectId: claims.projectId } : {}),
    ...(claims.environmentId ? { environmentId: claims.environmentId } : {}),
  };
}

function toWalletContext(claims: ConsoleAuthClaims): {
  orgId: string;
  actorUserId: string;
  projectId?: string;
  environmentId?: string;
} {
  return {
    orgId: claims.orgId,
    actorUserId: claims.userId,
    ...(claims.projectId ? { projectId: claims.projectId } : {}),
    ...(claims.environmentId ? { environmentId: claims.environmentId } : {}),
  };
}

function toApprovalContext(claims: ConsoleAuthClaims): {
  orgId: string;
  actorUserId: string;
  projectId?: string;
  environmentId?: string;
} {
  return {
    orgId: claims.orgId,
    actorUserId: claims.userId,
    ...(claims.projectId ? { projectId: claims.projectId } : {}),
    ...(claims.environmentId ? { environmentId: claims.environmentId } : {}),
  };
}

interface ConsoleAuditActorScope {
  readonly orgId: string;
  readonly userId: string;
  readonly projectId?: string;
  readonly environmentId?: string | null;
}

function toAuditContext(claims: ConsoleAuditActorScope): {
  orgId: string;
  actorUserId: string;
  projectId?: string;
  environmentId?: string;
} {
  return {
    orgId: claims.orgId,
    actorUserId: claims.userId,
    ...(claims.projectId ? { projectId: claims.projectId } : {}),
    ...(claims.environmentId ? { environmentId: claims.environmentId } : {}),
  };
}

async function memberCanAccessApproval(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  approval: Pick<
    ConsoleApprovalRequestRecord,
    'operationType' | 'projectId' | 'environmentId' | 'resourceType' | 'resourceId'
  >,
  level: 'viewer' | 'editor',
): Promise<boolean> {
  const projectId = approval.projectId;
  if (!projectId || !hasConsoleProjectAccess(claims, projectId, level)) return false;
  if (approval.environmentId) {
    if (!ctx.walletEnvironments) return false;
    const environments = await ctx.walletEnvironments.listEnvironments(
      toWalletEnvironmentContext(claims),
      { projectId },
    );
    if (!environments.some((environment) => environment.id === approval.environmentId)) {
      return false;
    }
  }
  switch (approval.operationType) {
    case 'POLICY_PUBLISH': {
      if (approval.resourceType !== 'policy' || !approval.resourceId || !ctx.policies) {
        return false;
      }
      const failure = await requireMemberPolicyAccess(
        ctx,
        claims,
        ctx.policies,
        approval.resourceId,
        level,
      );
      return failure === null;
    }
    case 'KEY_EXPORT': {
      if (approval.resourceType !== 'key_export' || !approval.resourceId || !ctx.keyExports) {
        return false;
      }
      const exports = await visibleConsoleKeyExports(ctx, claims, ctx.keyExports, {}, level);
      if (exports instanceof Response) return false;
      const target = exports.find((entry) => entry.id === approval.resourceId);
      if (!target || !ctx.walletEnvironments) return false;
      if (approval.environmentId && approval.environmentId !== target.environmentId) return false;
      const environments = await ctx.walletEnvironments.listEnvironments(
        toWalletEnvironmentContext(claims),
        { projectId },
      );
      return environments.some((environment) => environment.id === target.environmentId);
    }
    default:
      return assertNever(approval.operationType);
  }
}

async function projectApprovalResponse(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  row: {
    resourceType: string | null;
    resourceId: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<typeof row & ConsolePolicyPresentation> {
  const policyPresentationLookup = await listConsolePolicyPresentationLookup(
    ctx.policies,
    toBillingContext(claims),
  );
  return {
    ...row,
    ...projectConsolePolicyPresentation({
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: row.metadata,
      policyPresentationLookup,
    }),
  };
}

async function projectApprovalResponses<
  T extends {
    resourceType: string | null;
    resourceId: string | null;
    metadata: Record<string, unknown>;
  },
>(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  rows: readonly T[],
): Promise<Array<T & ConsolePolicyPresentation>> {
  const policyPresentationLookup = await listConsolePolicyPresentationLookup(
    ctx.policies,
    toBillingContext(claims),
  );
  return rows.map((row) => ({
    ...row,
    ...projectConsolePolicyPresentation({
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: row.metadata,
      policyPresentationLookup,
    }),
  }));
}

async function enrichPolicyApprovalCreateRequest(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  request: ParsedCreateConsoleApprovalRequest,
): Promise<CreateConsoleApprovalRequest> {
  if (request.operationType !== 'POLICY_PUBLISH') return request;
  if (!ctx.policies) {
    throw new ConsoleApprovalsError(
      'policy_service_unavailable',
      503,
      'Policy service is unavailable',
    );
  }
  const policy = await ctx.policies.getPolicy(toBillingContext(claims), request.resourceId);
  if (!policy) {
    throw new ConsoleApprovalsError('policy_not_found', 404, 'Policy was not found');
  }
  const policyRulesDigest = await ConsolePolicyRulesDigest.fromRules(policy.rules);
  const metadata =
    request.metadata && typeof request.metadata === 'object' && !Array.isArray(request.metadata)
      ? { ...request.metadata }
      : {};
  metadata.policyId = policy.id;
  metadata.policyName = policy.name;
  metadata.policyKind = policy.kind;
  return {
    operationType: 'POLICY_PUBLISH',
    resourceType: 'policy',
    resourceId: request.resourceId,
    reason: request.reason,
    ...(request.id ? { id: request.id } : {}),
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.environmentId ? { environmentId: request.environmentId } : {}),
    policyRulesDigest,
    metadata,
  };
}

async function projectAuditEventResponses(
  ctx: CloudflareConsoleContext,
  claims: { readonly orgId: string; readonly userId: string },
  rows: readonly ConsoleAuditEvent[],
): Promise<Array<ConsoleAuditEvent & ConsolePolicyPresentation>> {
  const policyPresentationLookup = await listConsolePolicyPresentationLookup(
    ctx.policies,
    toBillingContext(claims),
  );
  return rows.map((row) => ({
    ...row,
    ...projectConsolePolicyPresentation({
      metadata: row.metadata,
      policyPresentationLookup,
    }),
  }));
}

async function resolveWalletPolicyPresentationByWalletId(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  walletRows: ReadonlyArray<{
    id: string;
    projectId?: string | null;
    environmentId?: string | null;
    policyId?: string | null;
  }>,
): Promise<Record<string, ConsolePolicyPresentation>> {
  if (!ctx.policies || walletRows.length === 0) return {};
  const [resolvedPolicyIds, policyPresentationLookup] = await Promise.all([
    ctx.policies.resolvePoliciesForWallets(
      toBillingContext(claims),
      walletRows.map((wallet) => ({
        walletId: wallet.id,
        projectId: wallet.projectId || undefined,
        environmentId: wallet.environmentId || undefined,
        fallbackPolicyId: wallet.policyId || null,
      })),
    ),
    listConsolePolicyPresentationLookup(ctx.policies, toBillingContext(claims)),
  ]);
  const out: Record<string, ConsolePolicyPresentation> = {};
  for (const wallet of walletRows) {
    const policyIdRaw =
      resolvedPolicyIds[wallet.id] === undefined
        ? wallet.policyId || null
        : resolvedPolicyIds[wallet.id];
    const policyId = String(policyIdRaw || '').trim() || null;
    const policy = policyId ? policyPresentationLookup[policyId] : undefined;
    out[wallet.id] = {
      policyId,
      policyName: policy?.policyName || null,
      policyKind: policy?.policyKind || null,
    };
  }
  return out;
}

function readApprovalIdFromBody(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  return String((body as Record<string, unknown>).approvalId || '').trim();
}

async function requireFreshConsoleStepUp(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
): Promise<
  | { readonly ok: true; readonly proof: TenantRootStepUpProofV1 }
  | { readonly ok: false; readonly response: Response }
> {
  if (!ctx.stepUp) {
    return {
      ok: false,
      response: json(
        { ok: false, code: 'step_up_unavailable', message: 'Console step-up is unavailable' },
        { status: 503 },
      ),
    };
  }
  const result = await verifyFreshStepUpForRequestV1({
    stepUp: ctx.stepUp,
    request: ctx.request,
    claims,
    nowMs: Date.now(),
  });
  if (!result.ok) {
    return {
      ok: false,
      response: json(
        { ok: false, code: 'step_up_required', message: 'Fresh step-up is required' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, proof: result.proof };
}

async function requireApprovedOperationApproval(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  input:
    | {
        readonly operationType: 'POLICY_PUBLISH';
        readonly approvalIdRaw: unknown;
        readonly resourceType: 'policy';
        readonly resourceId: string;
      }
    | {
        readonly operationType: 'KEY_EXPORT';
        readonly approvalIdRaw: unknown;
        readonly resourceType: 'key_export';
        readonly resourceId: string;
      },
): Promise<
  | { readonly ok: true; readonly approval: ConsoleApprovalRequestRecord }
  | { readonly ok: false; readonly response: Response }
> {
  if (!ctx.approvals) {
    return {
      ok: false,
      response: json(
        { ok: false, code: 'approval_unavailable', message: 'Approval service is unavailable' },
        { status: 503 },
      ),
    };
  }

  const approvalId = String(input.approvalIdRaw || '').trim();
  if (!approvalId) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          code: 'approval_required',
          message: `Field approvalId is required for ${input.operationType} when approvals service is configured`,
        },
        { status: 400 },
      ),
    };
  }

  let approval: Awaited<ReturnType<ConsoleApprovalService['getApprovalRequest']>> = null;
  try {
    approval = await ctx.approvals.getApprovalRequest(toApprovalContext(claims), approvalId);
  } catch (error: unknown) {
    return { ok: false, response: sendApprovalError(error) };
  }

  if (!approval) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          code: 'approval_not_found',
          message: `Approval request ${approvalId} was not found`,
        },
        { status: 404 },
      ),
    };
  }

  if (approval.operationType !== input.operationType) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          code: 'approval_operation_mismatch',
          message: `Approval request ${approvalId} is ${approval.operationType}; expected ${input.operationType}`,
        },
        { status: 409 },
      ),
    };
  }

  if (approval.status !== 'APPROVED') {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          code: 'approval_not_approved',
          message: `Approval request ${approvalId} is ${approval.status}; expected APPROVED`,
        },
        { status: 409 },
      ),
    };
  }

  if (
    claims.role === 'MEMBER' &&
    !(await memberCanAccessApproval(ctx, claims, approval, 'editor'))
  ) {
    return {
      ok: false,
      response: json(
        { ok: false, code: 'approval_not_found', message: 'Approval request was not found' },
        { status: 404 },
      ),
    };
  }

  if (approval.resourceType !== input.resourceType) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          code: 'approval_resource_mismatch',
          message: `Approval request ${approvalId} resource type does not match request`,
        },
        { status: 409 },
      ),
    };
  }

  if (approval.resourceId !== input.resourceId) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          code: 'approval_resource_mismatch',
          message: `Approval request ${approvalId} resource id does not match request`,
        },
        { status: 409 },
      ),
    };
  }

  return { ok: true, approval };
}

async function requireActiveApiKeyEnvironmentForCreate(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  environmentId: string,
): Promise<Response | null> {
  const environmentsOrResponse = requireWalletEnvironmentService(ctx);
  if (environmentsOrResponse instanceof Response) return environmentsOrResponse;
  try {
    const environments = await environmentsOrResponse.listEnvironments(
      toWalletEnvironmentContext(claims),
    );
    const environment = environments.find((entry) => entry.id === environmentId);
    if (!environment) {
      return json(
        {
          ok: false,
          code: 'invalid_environment',
          message: `Environment ${environmentId} was not found for this organization`,
        },
        { status: 400 },
      );
    }
    if (!hasConsoleProjectAccess(claims, environment.projectId, 'editor')) {
      return json(
        { ok: false, code: 'forbidden', message: 'No access to this Wallet project' },
        { status: 403 },
      );
    }
    if (environment.status !== 'ACTIVE') {
      return json(
        {
          ok: false,
          code: 'environment_archived',
          message: `Environment ${environmentId} is archived and cannot be used for API keys`,
        },
        { status: 409 },
      );
    }
    return null;
  } catch (error: unknown) {
    return sendOrganizationMetadataError(error);
  }
}

async function emitApprovalWebhookEvent(
  ctx: CloudflareConsoleContext,
  input: {
    orgId: string;
    actorUserId: string;
    eventType: 'policy.approval.created' | 'policy.approval.approved' | 'policy.approval.rejected';
    payload: Record<string, unknown>;
  },
): Promise<void> {
  if (!ctx.webhooks) return;
  try {
    await ctx.webhooks.emitEvent(
      {
        orgId: input.orgId,
        actorUserId: input.actorUserId,
      },
      {
        eventType: input.eventType,
        payload: input.payload,
      },
    );
  } catch (error: unknown) {
    ctx.logger.warn('[console][webhooks] failed to emit approval event', {
      eventType: input.eventType,
      orgId: input.orgId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function emitConsoleAuditEvent(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuditActorScope,
  input: {
    category:
      | 'POLICY'
      | 'SETTINGS'
      | 'KEY_EXPORT'
      | 'BILLING'
      | 'WEBHOOK'
      | 'API_KEY'
      | 'TEAM'
      | 'APPROVAL'
      | 'ORG_PROJECT_ENV'
      | 'RUNTIME_SNAPSHOT'
      | 'SYSTEM';
    action: string;
    summary: string;
    outcome?: 'SUCCESS' | 'FAILURE' | 'PENDING';
    actorUserId?: string;
    actorType?: 'USER' | 'SYSTEM';
    projectId?: string;
    environmentId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!ctx.audit) return;
  try {
    await ctx.audit.appendEvent(toAuditContext(claims), {
      category: input.category,
      action: input.action,
      outcome: input.outcome || 'SUCCESS',
      summary: input.summary,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.actorType ? { actorType: input.actorType } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  } catch (error: unknown) {
    ctx.logger.warn('[console][audit] failed to append audit event', {
      orgId: claims.orgId,
      userId: input.actorUserId || claims.userId,
      category: input.category,
      action: input.action,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function decodePathPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

async function handleConsoleOpsCockpit(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isConsoleOpsCockpitPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;
  const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
  if (routePolicy) return routePolicy;

  try {
    const telemetryRequest = parseGetConsoleOnboardingTelemetryRequest({
      windowMinutes: ctx.url.searchParams.get('windowMinutes') || undefined,
    });
    const summary = await buildConsoleOpsCockpitSummary({
      claims: auth.claims,
      approvals: ctx.approvals,
      billing: ctx.billing,
      webhooks: ctx.webhooks,
      auditExports: ctx.auditExports,
      enterpriseIsolation: ctx.enterpriseIsolation,
      onboarding: ctx.onboarding,
      canViewOnboardingTelemetry: auth.claims.platformSupport,
      telemetryWindowMinutes: telemetryRequest.windowMinutes,
      logger: ctx.logger,
    });
    return json({ ok: true, summary }, { status: 200 });
  } catch (error: unknown) {
    return sendOnboardingError(error);
  }
}

async function handleConsoleObservability(ctx: CloudflareConsoleContext): Promise<Response | null> {
  return await handleConsoleObservabilityRoutes(ctx, {
    json,
    isConsoleObservabilityPath,
    requireConsoleAuth,
    requireConsoleRoutePolicy,
    requireObservabilityService,
    requireWalletEnvironmentService,
    toAuditContext,
    sendObservabilityError,
  });
}

function isWalletBillingPath(pathname: string): boolean {
  return (
    pathname === '/console/billing/sponsored-executions' ||
    pathname === '/console/billing/sponsored-executions/reconciliation' ||
    pathname === '/console/billing/usage/monthly-active-wallets'
  );
}

function isConsoleOpsCockpitPath(pathname: string): boolean {
  return pathname === '/console/ops-cockpit/summary';
}

function isConsoleObservabilityPath(pathname: string): boolean {
  return (
    pathname === '/console/observability/summary' ||
    pathname === '/console/observability/events' ||
    pathname === '/console/observability/timeseries' ||
    pathname === '/console/observability/services'
  );
}

function isConsoleApprovalPath(pathname: string): boolean {
  return pathname === '/console/approvals' || pathname.startsWith('/console/approvals/');
}

function isConsoleAuditExportsPath(pathname: string): boolean {
  return pathname === '/console/audit/exports' || pathname.startsWith('/console/audit/exports/');
}

function isConsoleEnterpriseIsolationPath(pathname: string): boolean {
  return pathname === '/console/isolation/status' || pathname === '/console/isolation/trigger';
}

function isConsoleWalletPath(pathname: string): boolean {
  return (
    pathname === '/console/wallets' ||
    pathname === '/console/wallets/search' ||
    pathname.startsWith('/console/wallets/')
  );
}

function isConsolePolicyPath(pathname: string): boolean {
  return pathname === '/console/policies' || pathname.startsWith('/console/policies/');
}

function isConsoleInsightsPath(pathname: string): boolean {
  return (
    pathname === '/console/policy/coverage' ||
    pathname === '/console/gas/readiness' ||
    pathname === '/console/export/governance'
  );
}

function isConsoleApiKeyPath(pathname: string): boolean {
  return pathname.startsWith('/console/api-keys');
}

function isConsoleWebhookPath(pathname: string): boolean {
  return pathname.startsWith('/console/webhooks');
}

function isConsoleKeyExportPath(pathname: string): boolean {
  return pathname === '/console/key-exports' || pathname.startsWith('/console/key-exports/');
}

function isConsoleRuntimeSnapshotPath(pathname: string): boolean {
  return (
    pathname === '/console/runtime-snapshots' ||
    pathname === '/console/runtime-snapshots/latest' ||
    pathname === '/console/runtime-snapshots/publish-current'
  );
}

async function requireWalletEnvironmentProjectAccess(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  environmentId: string,
  projectId: string | undefined,
  level: 'viewer' | 'editor',
): Promise<Response | null> {
  const environmentsOrResponse = requireWalletEnvironmentService(ctx);
  if (environmentsOrResponse instanceof Response) return environmentsOrResponse;
  const environments = await environmentsOrResponse.listEnvironments(
    toWalletEnvironmentContext(claims),
  );
  const environment = environments.find((entry) => entry.id === environmentId);
  if (!environment || (projectId && projectId !== environment.projectId)) {
    return json(
      { ok: false, code: 'invalid_environment', message: 'Wallet environment was not found' },
      { status: 404 },
    );
  }
  if (!hasConsoleProjectAccess(claims, environment.projectId, level)) {
    return json(
      { ok: false, code: 'forbidden', message: 'No access to this Wallet project' },
      { status: 403 },
    );
  }
  return null;
}

async function visibleConsoleKeyExports(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  keyExports: ConsoleKeyExportService,
  request: ListConsoleKeyExportsRequest,
  level: 'viewer' | 'editor',
): Promise<readonly ConsoleKeyExportRequestRecord[] | Response> {
  const rows = await keyExports.listKeyExports(toBillingContext(claims), request);
  if (claims.role !== 'MEMBER') return rows;

  const environmentsOrResponse = requireWalletEnvironmentService(ctx);
  if (environmentsOrResponse instanceof Response) return environmentsOrResponse;
  const environments = await environmentsOrResponse.listEnvironments(
    toWalletEnvironmentContext(claims),
  );
  const projectByEnvironment = new Map(
    environments.map((environment) => [environment.id, environment.projectId]),
  );
  return rows.filter((row) => {
    const projectId = projectByEnvironment.get(row.environmentId);
    return projectId !== undefined && hasConsoleProjectAccess(claims, projectId, level);
  });
}

async function handleConsoleKeyExports(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isConsoleKeyExportPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const keyExportsOrResponse = requireKeyExportService(ctx);
  if (keyExportsOrResponse instanceof Response) return keyExportsOrResponse;
  const keyExports = keyExportsOrResponse;
  const approveMatch = ctx.pathname.match(/^\/console\/key-exports\/([^/]+)\/approve$/);

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/key-exports') {
      const request = parseListConsoleKeyExportsRequest({
        environmentId: ctx.url.searchParams.get('environmentId') || undefined,
        status: ctx.url.searchParams.get('status') || undefined,
      });
      const keyExportRows = await visibleConsoleKeyExports(
        ctx,
        auth.claims,
        keyExports,
        request,
        'viewer',
      );
      if (keyExportRows instanceof Response) return keyExportRows;
      return json({ ok: true, exports: keyExportRows }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/key-exports') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseCreateConsoleKeyExportRequest(await readJson(ctx.request));
      const accessFailure = await requireWalletEnvironmentProjectAccess(
        ctx,
        auth.claims,
        request.environmentId,
        undefined,
        'editor',
      );
      if (accessFailure) return accessFailure;
      const keyExport = await keyExports.createKeyExport(toBillingContext(auth.claims), request);
      return json({ ok: true, keyExport }, { status: 201 });
    }

    if (ctx.method === 'POST' && approveMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const exportId = decodePathPart(approveMatch[1]);
      const visible = await visibleConsoleKeyExports(ctx, auth.claims, keyExports, {}, 'editor');
      if (visible instanceof Response) return visible;
      if (!visible.some((row) => row.id === exportId)) {
        return json(
          { ok: false, code: 'key_export_not_found', message: 'Key export request was not found' },
          { status: 404 },
        );
      }
      const rawBody = await readJson(ctx.request);
      const approvalRequired = await requireApprovedOperationApproval(ctx, auth.claims, {
        operationType: 'KEY_EXPORT',
        approvalIdRaw: readApprovalIdFromBody(rawBody),
        resourceType: 'key_export',
        resourceId: exportId,
      });
      if (!approvalRequired.ok) return approvalRequired.response;
      const requestBody = parseApproveConsoleKeyExportRequest(rawBody);
      const stepUp = await requireFreshConsoleStepUp(ctx, auth.claims);
      if (!stepUp.ok) return stepUp.response;
      const keyExport = await keyExports.approveKeyExport(toBillingContext(auth.claims), exportId, {
        reason: requestBody.reason,
        stepUp: stepUp.proof,
      });
      if (!keyExport) {
        return json(
          {
            ok: false,
            code: 'key_export_not_found',
            message: `Key export request ${exportId} was not found`,
          },
          { status: 404 },
        );
      }
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'KEY_EXPORT',
        action: 'key_export.approve',
        summary: `Approved key export request ${keyExport.id}`,
        ...(keyExport.environmentId ? { environmentId: keyExport.environmentId } : {}),
        metadata: {
          keyExportId: keyExport.id,
          status: keyExport.status,
          mode: keyExport.mode,
          approvedByUserId: auth.claims.userId,
        },
      });
      return json({ ok: true, keyExport }, { status: 200 });
    }
  } catch (error: unknown) {
    return sendKeyExportError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleConsoleRuntimeSnapshots(
  ctx: CloudflareConsoleContext,
): Promise<Response | null> {
  if (!isConsoleRuntimeSnapshotPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const runtimeSnapshotsOrResponse = requireRuntimeSnapshotService(ctx);
  if (runtimeSnapshotsOrResponse instanceof Response) return runtimeSnapshotsOrResponse;
  const runtimeSnapshots = runtimeSnapshotsOrResponse;

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/runtime-snapshots') {
      const request = parseListConsoleRuntimeSnapshotsRequest({
        environmentId: ctx.url.searchParams.get('environmentId') || undefined,
        projectId: ctx.url.searchParams.get('projectId') || undefined,
        limit: ctx.url.searchParams.get('limit') || undefined,
      });
      const accessFailure = await requireWalletEnvironmentProjectAccess(
        ctx,
        auth.claims,
        request.environmentId,
        request.projectId,
        'viewer',
      );
      if (accessFailure) return accessFailure;
      const snapshots = await runtimeSnapshots.listSnapshots(
        toBillingContext(auth.claims),
        request,
      );
      return json({ ok: true, snapshots }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/runtime-snapshots/latest') {
      const request = parseGetLatestConsoleRuntimeSnapshotRequest({
        environmentId: ctx.url.searchParams.get('environmentId') || undefined,
        projectId: ctx.url.searchParams.get('projectId') || undefined,
      });
      const accessFailure = await requireWalletEnvironmentProjectAccess(
        ctx,
        auth.claims,
        request.environmentId,
        request.projectId,
        'viewer',
      );
      if (accessFailure) return accessFailure;
      const snapshot = await runtimeSnapshots.getLatestSnapshot(
        toBillingContext(auth.claims),
        request,
      );
      return json({ ok: true, snapshot }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/runtime-snapshots/publish-current') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parsePublishCurrentConsoleRuntimeSnapshotRequest(await readJson(ctx.request));
      const accessFailure = await requireWalletEnvironmentProjectAccess(
        ctx,
        auth.claims,
        request.environmentId,
        request.projectId,
        'editor',
      );
      if (accessFailure) return accessFailure;
      const payload = await resolveConsoleRuntimeSnapshotPayload({
        orgId: auth.claims.orgId,
        actorUserId: auth.claims.userId,
        environmentId: request.environmentId,
        ...(request.projectId ? { projectId: request.projectId } : {}),
        policies: ctx.policies,
      });
      const snapshot = await runtimeSnapshots.publishSnapshot(toBillingContext(auth.claims), {
        ...request,
        payload,
      });
      return json({ ok: true, snapshot }, { status: 201 });
    }
  } catch (error: unknown) {
    return sendRuntimeSnapshotError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function visibleConsoleApiKeys(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  apiKeys: ConsoleApiKeyService,
  level: 'viewer' | 'editor',
): Promise<readonly ConsoleApiKey[] | Response> {
  const keys = await apiKeys.listApiKeys(toBillingContext(claims));
  if (claims.role !== 'MEMBER') return keys;

  const environmentsOrResponse = requireWalletEnvironmentService(ctx);
  if (environmentsOrResponse instanceof Response) return environmentsOrResponse;
  const environments = await environmentsOrResponse.listEnvironments(
    toWalletEnvironmentContext(claims),
  );
  const projectByEnvironment = new Map(
    environments.map((environment) => [environment.id, environment.projectId]),
  );
  return keys.filter((key) => {
    const projectId = projectByEnvironment.get(key.environmentId);
    return projectId !== undefined && hasConsoleProjectAccess(claims, projectId, level);
  });
}

async function requireConsoleApiKeyEditor(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  apiKeys: ConsoleApiKeyService,
  apiKeyId: string,
): Promise<Response | null> {
  if (claims.role !== 'MEMBER') return null;
  const visible = await visibleConsoleApiKeys(ctx, claims, apiKeys, 'editor');
  if (visible instanceof Response) return visible;
  if (visible.some((key) => key.id === apiKeyId)) return null;
  return json(
    { ok: false, code: 'api_key_not_found', message: `API key ${apiKeyId} was not found` },
    { status: 404 },
  );
}

async function handleConsoleApiKeys(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isConsoleApiKeyPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const apiKeysOrResponse = requireApiKeyService(ctx);
  if (apiKeysOrResponse instanceof Response) return apiKeysOrResponse;
  const apiKeys = apiKeysOrResponse;
  const apiKeyCtx = toBillingContext(auth.claims);

  const apiKeyPathMatch = ctx.pathname.match(/^\/console\/api-keys\/([^/]+)$/);
  const apiKeyPurgePathMatch = ctx.pathname.match(/^\/console\/api-keys\/([^/]+)\/purge$/);
  const apiKeyRotatePathMatch = ctx.pathname.match(/^\/console\/api-keys\/([^/]+)\/rotate$/);

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/api-keys') {
      const out = await visibleConsoleApiKeys(ctx, auth.claims, apiKeys, 'viewer');
      if (out instanceof Response) return out;
      return json({ ok: true, apiKeys: out }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/api-keys') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseCreateConsoleApiKeyRequest(
        await readJson(ctx.request),
        WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
      );
      const validEnvironment = await requireActiveApiKeyEnvironmentForCreate(
        ctx,
        auth.claims,
        request.environmentId,
      );
      if (validEnvironment) return validEnvironment;
      const created = await apiKeys.createApiKey(apiKeyCtx, request);
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'API_KEY',
        action: 'api_key.create',
        summary: `Created API key ${created.apiKey.id}`,
        environmentId: created.apiKey.environmentId,
        metadata: {
          apiKeyId: created.apiKey.id,
          kind: created.apiKey.kind,
          scopeCount: Array.isArray(created.apiKey.scopes) ? created.apiKey.scopes.length : 0,
          ipAllowlistCount: Array.isArray(created.apiKey.ipAllowlist)
            ? created.apiKey.ipAllowlist.length
            : 0,
          allowedOriginCount: Array.isArray(created.apiKey.allowedOrigins)
            ? created.apiKey.allowedOrigins.length
            : 0,
        },
      });
      return json(
        {
          ok: true,
          apiKey: created.apiKey,
          secret: created.secret,
        },
        { status: 201 },
      );
    }

    if (ctx.method === 'DELETE' && apiKeyPathMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const apiKeyId = decodePathPart(apiKeyPathMatch[1]);
      const request = parseRevokeConsoleApiKeyRequest(await readJson(ctx.request));
      const accessFailure = await requireConsoleApiKeyEditor(ctx, auth.claims, apiKeys, apiKeyId);
      if (accessFailure) return accessFailure;
      const revoked = await apiKeys.revokeApiKey(apiKeyCtx, apiKeyId, request);
      if (!revoked.revoked || !revoked.apiKey) {
        return json(
          {
            ok: false,
            code: 'api_key_not_found',
            message: `API key ${apiKeyId} was not found`,
          },
          { status: 404 },
        );
      }
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'API_KEY',
        action: 'api_key.revoke',
        summary: `Revoked API key ${revoked.apiKey.id}`,
        environmentId: revoked.apiKey.environmentId,
        metadata: {
          apiKeyId: revoked.apiKey.id,
          status: revoked.apiKey.status,
          revokedReason: revoked.apiKey.revokedReason,
        },
      });
      return json(
        {
          ok: true,
          revoked: true,
          apiKey: revoked.apiKey,
        },
        { status: 200 },
      );
    }

    if (ctx.method === 'DELETE' && apiKeyPurgePathMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const apiKeyId = decodePathPart(apiKeyPurgePathMatch[1]);
      const accessFailure = await requireConsoleApiKeyEditor(ctx, auth.claims, apiKeys, apiKeyId);
      if (accessFailure) return accessFailure;
      const deleted = await apiKeys.deleteApiKey(apiKeyCtx, apiKeyId);
      if (!deleted.deleted || !deleted.apiKey) {
        return json(
          {
            ok: false,
            code: 'api_key_not_found',
            message: `API key ${apiKeyId} was not found`,
          },
          { status: 404 },
        );
      }
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'API_KEY',
        action: 'api_key.delete',
        summary: `Deleted API key ${deleted.apiKey.id}`,
        environmentId: deleted.apiKey.environmentId,
        metadata: {
          apiKeyId: deleted.apiKey.id,
          kind: deleted.apiKey.kind,
          priorStatus: deleted.apiKey.status,
        },
      });
      return json(
        {
          ok: true,
          deleted: true,
          apiKey: deleted.apiKey,
        },
        { status: 200 },
      );
    }

    if (ctx.method === 'PATCH' && apiKeyPathMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const apiKeyId = decodePathPart(apiKeyPathMatch[1]);
      const request = parseUpdateConsoleApiKeyRequest(
        await readJson(ctx.request),
        WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
      );
      const accessFailure = await requireConsoleApiKeyEditor(ctx, auth.claims, apiKeys, apiKeyId);
      if (accessFailure) return accessFailure;
      const updated = await apiKeys.updateApiKey(apiKeyCtx, apiKeyId, request);
      if (!updated) {
        return json(
          {
            ok: false,
            code: 'api_key_not_found',
            message: `API key ${apiKeyId} was not found`,
          },
          { status: 404 },
        );
      }
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'API_KEY',
        action: 'api_key.update',
        summary: `Updated API key ${updated.id}`,
        environmentId: updated.environmentId,
        metadata: {
          apiKeyId: updated.id,
          kind: updated.kind,
          scopeCount: Array.isArray(updated.scopes) ? updated.scopes.length : 0,
          ipAllowlistCount: Array.isArray(updated.ipAllowlist) ? updated.ipAllowlist.length : 0,
          allowedOriginCount: Array.isArray(updated.allowedOrigins)
            ? updated.allowedOrigins.length
            : 0,
        },
      });
      return json(
        {
          ok: true,
          apiKey: updated,
        },
        { status: 200 },
      );
    }

    if (ctx.method === 'POST' && apiKeyRotatePathMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const apiKeyId = decodePathPart(apiKeyRotatePathMatch[1]);
      const request = parseRotateConsoleApiKeyRequest(await readJson(ctx.request));
      const accessFailure = await requireConsoleApiKeyEditor(ctx, auth.claims, apiKeys, apiKeyId);
      if (accessFailure) return accessFailure;
      const rotated = await apiKeys.rotateApiKey(apiKeyCtx, apiKeyId, request);
      if (!rotated) {
        return json(
          {
            ok: false,
            code: 'api_key_not_found',
            message: `API key ${apiKeyId} was not found`,
          },
          { status: 404 },
        );
      }
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'API_KEY',
        action: 'api_key.rotate',
        summary: `Rotated API key ${rotated.apiKey.id} to version ${rotated.apiKey.secretVersion}`,
        environmentId: rotated.apiKey.environmentId,
        metadata: {
          apiKeyId: rotated.apiKey.id,
          kind: rotated.apiKey.kind,
          secretVersion: rotated.apiKey.secretVersion,
        },
      });
      return json(
        {
          ok: true,
          apiKey: rotated.apiKey,
          secret: rotated.secret,
        },
        { status: 200 },
      );
    }
  } catch (error: unknown) {
    return sendApiKeyError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleConsoleEnvironments(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (
    ctx.pathname !== '/console/environments' &&
    !ctx.pathname.startsWith('/console/environments/')
  )
    return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const environmentsOrResponse = requireWalletEnvironmentService(ctx);
  if (environmentsOrResponse instanceof Response) return environmentsOrResponse;
  const walletEnvironments = environmentsOrResponse;
  const environmentContext = toWalletEnvironmentContext(auth.claims);
  const environmentPatchMatch = ctx.pathname.match(/^\/console\/environments\/([^/]+)$/);
  const environmentArchiveMatch = ctx.pathname.match(/^\/console\/environments\/([^/]+)\/archive$/);

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/environments') {
      const request = parseListConsoleWalletEnvironmentsRequest({
        projectId: ctx.url.searchParams.get('projectId') || undefined,
        status: ctx.url.searchParams.get('status') || undefined,
      });
      const environments = await walletEnvironments.listEnvironments(environmentContext, request);
      const visibleEnvironments =
        auth.claims.role === 'MEMBER'
          ? environments.filter((environment) =>
              hasConsoleProjectAccess(auth.claims, environment.projectId, 'viewer'),
            )
          : environments;
      return json(
        { ok: true, environments: visibleEnvironments.map(serializeWalletEnvironment) },
        { status: 200 },
      );
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/environments') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseCreateConsoleWalletEnvironmentRequest(await readJson(ctx.request));
      if (request.key !== 'dev' && !ctx.opts.allowLiveEnvironmentBillingBypass) {
        if (!ctx.billing) {
          return sendBillingError(
            new ConsoleBillingError(
              'billing_required_live_environment',
              409,
              LIVE_ENVIRONMENT_BILLING_REQUIRED_MESSAGE,
            ),
          );
        }
        await ensureBillingReadyForLiveEnvironment(ctx.billing, toBillingContext(auth.claims));
      }
      const environment = await walletEnvironments.createEnvironment(environmentContext, request);
      return json(
        { ok: true, environment: serializeWalletEnvironment(environment) },
        { status: 201 },
      );
    }

    if (ctx.method === 'PATCH' && environmentPatchMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const environmentId = decodePathPart(environmentPatchMatch[1]);
      const request = parseUpdateConsoleWalletEnvironmentRequest(await readJson(ctx.request));
      const environment = await walletEnvironments.updateEnvironment(
        environmentContext,
        environmentId,
        request,
      );
      if (!environment) {
        return json(
          {
            ok: false,
            code: 'environment_not_found',
            message: `Environment ${environmentId} was not found`,
          },
          { status: 404 },
        );
      }
      return json(
        { ok: true, environment: serializeWalletEnvironment(environment) },
        { status: 200 },
      );
    }

    if (ctx.method === 'POST' && environmentArchiveMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const environmentId = decodePathPart(environmentArchiveMatch[1]);
      const environment = await walletEnvironments.archiveEnvironment(
        environmentContext,
        environmentId,
      );
      if (!environment) {
        return json(
          {
            ok: false,
            code: 'environment_not_found',
            message: `Environment ${environmentId} was not found`,
          },
          { status: 404 },
        );
      }
      return json(
        { ok: true, environment: serializeWalletEnvironment(environment) },
        { status: 200 },
      );
    }
  } catch (error: unknown) {
    if (isConsoleBillingError(error)) return sendBillingError(error);
    return sendOrganizationMetadataError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleConsoleApprovals(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isConsoleApprovalPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const approvalsOrResponse = requireApprovalService(ctx);
  if (approvalsOrResponse instanceof Response) return approvalsOrResponse;
  const approvals = approvalsOrResponse;
  const approvalCtx = toApprovalContext(auth.claims);
  const approvalPathMatch = ctx.pathname.match(/^\/console\/approvals\/([^/]+)$/);
  const approvalApprovePathMatch = ctx.pathname.match(/^\/console\/approvals\/([^/]+)\/approve$/);
  const approvalRejectPathMatch = ctx.pathname.match(/^\/console\/approvals\/([^/]+)\/reject$/);

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/approvals') {
      const request = parseListConsoleApprovalsRequest({
        status: ctx.url.searchParams.get('status') || undefined,
        operationType: ctx.url.searchParams.get('operationType') || undefined,
        projectId: ctx.url.searchParams.get('projectId') || undefined,
        environmentId: ctx.url.searchParams.get('environmentId') || undefined,
      });
      const rows = await approvals.listApprovalRequests(approvalCtx, request);
      const visibleRows: ConsoleApprovalRequestRecord[] = [];
      for (const row of rows) {
        if (
          auth.claims.role !== 'MEMBER' ||
          (await memberCanAccessApproval(ctx, auth.claims, row, 'viewer'))
        ) {
          visibleRows.push(row);
        }
      }
      return json(
        { ok: true, approvals: await projectApprovalResponses(ctx, auth.claims, visibleRows) },
        { status: 200 },
      );
    }

    if (ctx.method === 'GET' && approvalPathMatch) {
      const approvalId = decodePathPart(approvalPathMatch[1]);
      const row = await approvals.getApprovalRequest(approvalCtx, approvalId);
      if (!row) {
        return json(
          {
            ok: false,
            code: 'approval_not_found',
            message: `Approval request ${approvalId} was not found`,
          },
          { status: 404 },
        );
      }
      if (
        auth.claims.role === 'MEMBER' &&
        !(await memberCanAccessApproval(ctx, auth.claims, row, 'viewer'))
      ) {
        return json(
          { ok: false, code: 'approval_not_found', message: 'Approval request was not found' },
          { status: 404 },
        );
      }
      return json(
        { ok: true, approval: await projectApprovalResponse(ctx, auth.claims, row) },
        { status: 200 },
      );
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/approvals') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const parsedRequest = parseCreateConsoleApprovalRequest(await readJson(ctx.request));
      if (auth.claims.role === 'MEMBER') {
        const target = {
          operationType: parsedRequest.operationType,
          projectId: parsedRequest.projectId ?? null,
          environmentId: parsedRequest.environmentId ?? null,
          resourceType: parsedRequest.resourceType ?? null,
          resourceId: parsedRequest.resourceId ?? null,
        };
        if (!(await memberCanAccessApproval(ctx, auth.claims, target, 'editor'))) {
          return json(
            { ok: false, code: 'forbidden', message: 'Approval target is unavailable' },
            { status: 403 },
          );
        }
      }
      const request = await enrichPolicyApprovalCreateRequest(ctx, auth.claims, parsedRequest);
      const row = await approvals.createApprovalRequest(approvalCtx, request);
      const approvalPolicy = projectConsolePolicyPresentation({
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: row.metadata,
      });
      await emitApprovalWebhookEvent(ctx, {
        orgId: auth.claims.orgId,
        actorUserId: auth.claims.userId,
        eventType: 'policy.approval.created',
        payload: {
          approvalId: row.id,
          operationType: row.operationType,
          status: row.status,
          requestedByUserId: row.requestedByUserId,
          requiredApprovals: row.requiredApprovals,
          requireMfa: row.requireMfa,
          projectId: row.projectId,
          environmentId: row.environmentId,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          policyId: approvalPolicy.policyId,
          policyName: approvalPolicy.policyName,
          policyKind: approvalPolicy.policyKind,
        },
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'APPROVAL',
        action: 'approval.request.create',
        summary: `Created approval request ${row.id} (${row.operationType})`,
        ...(row.projectId ? { projectId: row.projectId } : {}),
        ...(row.environmentId ? { environmentId: row.environmentId } : {}),
        metadata: {
          approvalId: row.id,
          operationType: row.operationType,
          status: row.status,
          requiredApprovals: row.requiredApprovals,
          requireMfa: row.requireMfa,
          ...(row.resourceType ? { resourceType: row.resourceType } : {}),
          ...(row.resourceId ? { resourceId: row.resourceId } : {}),
          ...(String(row.resourceType || '')
            .trim()
            .toUpperCase() === 'POLICY' && row.resourceId
            ? { policyId: row.resourceId }
            : {}),
          ...(approvalPolicy.policyKind ? { policyKind: approvalPolicy.policyKind } : {}),
        },
      });
      return json(
        { ok: true, approval: await projectApprovalResponse(ctx, auth.claims, row) },
        { status: 201 },
      );
    }

    if (ctx.method === 'POST' && approvalApprovePathMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const approvalId = decodePathPart(approvalApprovePathMatch[1]);
      const target = await approvals.getApprovalRequest(approvalCtx, approvalId);
      if (
        !target ||
        (auth.claims.role === 'MEMBER' &&
          !(await memberCanAccessApproval(ctx, auth.claims, target, 'editor')))
      ) {
        return json(
          { ok: false, code: 'approval_not_found', message: 'Approval request was not found' },
          { status: 404 },
        );
      }
      const requestBody = parseApproveConsoleApprovalRequest(await readJson(ctx.request));
      let request: ApproveConsoleApprovalRequest;
      if (target.requireMfa) {
        const stepUp = await requireFreshConsoleStepUp(ctx, auth.claims);
        if (!stepUp.ok) return stepUp.response;
        request = { kind: 'with_step_up', reason: requestBody.reason, stepUp: stepUp.proof };
      } else {
        request = { kind: 'without_step_up', reason: requestBody.reason };
      }
      const row = await approvals.approveApprovalRequest(approvalCtx, approvalId, request);
      if (!row) {
        return json(
          {
            ok: false,
            code: 'approval_not_found',
            message: `Approval request ${approvalId} was not found`,
          },
          { status: 404 },
        );
      }
      await emitApprovalWebhookEvent(ctx, {
        orgId: auth.claims.orgId,
        actorUserId: auth.claims.userId,
        eventType: 'policy.approval.approved',
        payload: {
          approvalId: row.id,
          operationType: row.operationType,
          status: row.status,
          requiredApprovals: row.requiredApprovals,
          approvalsCount: row.decisions.filter((entry) => entry.decision === 'APPROVE').length,
          decisionsCount: row.decisions.length,
          resolvedAt: row.resolvedAt,
          projectId: row.projectId,
          environmentId: row.environmentId,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
        },
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'APPROVAL',
        action: 'approval.request.approve',
        summary: `Approved approval request ${row.id} (${row.operationType})`,
        ...(row.projectId ? { projectId: row.projectId } : {}),
        ...(row.environmentId ? { environmentId: row.environmentId } : {}),
        metadata: {
          approvalId: row.id,
          operationType: row.operationType,
          status: row.status,
          approvalsCount: row.decisions.filter((entry) => entry.decision === 'APPROVE').length,
          decisionsCount: row.decisions.length,
          ...(row.resourceType ? { resourceType: row.resourceType } : {}),
          ...(row.resourceId ? { resourceId: row.resourceId } : {}),
          ...(String(row.resourceType || '')
            .trim()
            .toUpperCase() === 'POLICY' && row.resourceId
            ? { policyId: row.resourceId }
            : {}),
        },
      });
      return json(
        { ok: true, approval: await projectApprovalResponse(ctx, auth.claims, row) },
        { status: 200 },
      );
    }

    if (ctx.method === 'POST' && approvalRejectPathMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const approvalId = decodePathPart(approvalRejectPathMatch[1]);
      if (auth.claims.role === 'MEMBER') {
        const target = await approvals.getApprovalRequest(approvalCtx, approvalId);
        if (!target || !(await memberCanAccessApproval(ctx, auth.claims, target, 'editor'))) {
          return json(
            { ok: false, code: 'approval_not_found', message: 'Approval request was not found' },
            { status: 404 },
          );
        }
      }
      const request = parseRejectConsoleApprovalRequest(await readJson(ctx.request));
      const row = await approvals.rejectApprovalRequest(approvalCtx, approvalId, request);
      if (!row) {
        return json(
          {
            ok: false,
            code: 'approval_not_found',
            message: `Approval request ${approvalId} was not found`,
          },
          { status: 404 },
        );
      }
      await emitApprovalWebhookEvent(ctx, {
        orgId: auth.claims.orgId,
        actorUserId: auth.claims.userId,
        eventType: 'policy.approval.rejected',
        payload: {
          approvalId: row.id,
          operationType: row.operationType,
          status: row.status,
          decisionsCount: row.decisions.length,
          resolvedAt: row.resolvedAt,
          projectId: row.projectId,
          environmentId: row.environmentId,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
        },
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'APPROVAL',
        action: 'approval.request.reject',
        summary: `Rejected approval request ${row.id} (${row.operationType})`,
        ...(row.projectId ? { projectId: row.projectId } : {}),
        ...(row.environmentId ? { environmentId: row.environmentId } : {}),
        metadata: {
          approvalId: row.id,
          operationType: row.operationType,
          status: row.status,
          decisionsCount: row.decisions.length,
          ...(row.resourceType ? { resourceType: row.resourceType } : {}),
          ...(row.resourceId ? { resourceId: row.resourceId } : {}),
          ...(String(row.resourceType || '')
            .trim()
            .toUpperCase() === 'POLICY' && row.resourceId
            ? { policyId: row.resourceId }
            : {}),
        },
      });
      return json(
        { ok: true, approval: await projectApprovalResponse(ctx, auth.claims, row) },
        { status: 200 },
      );
    }
  } catch (error: unknown) {
    return sendApprovalError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleConsoleAudit(ctx: CloudflareConsoleContext): Promise<Response | null> {
  return handleConsoleAuditRoutes(ctx, {
    categories: [...CONSOLE_AUDIT_QUERY_CATEGORIES, ...WALLET_CONSOLE_AUDIT_CATEGORIES],
    projectEvents: projectAuditEventResponses.bind(null, ctx),
  });
}

async function handleConsoleAuditExports(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isConsoleAuditExportsPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;
  const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
  if (routePolicy) return routePolicy;

  const auditExportsOrResponse = requireAuditExportsService(ctx);
  if (auditExportsOrResponse instanceof Response) return auditExportsOrResponse;
  const auditExports = auditExportsOrResponse;

  const exportMatch = ctx.pathname.match(/^\/console\/audit\/exports\/([^/]+)$/);

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/audit/exports') {
      const request = parseListConsoleAuditExportsRequest({
        status: ctx.url.searchParams.get('status') || undefined,
        domain: ctx.url.searchParams.get('domain') || undefined,
        limit: ctx.url.searchParams.get('limit') || undefined,
      });
      const exports = await auditExports.listExports(toAuditContext(auth.claims), request);
      return json({ ok: true, exports }, { status: 200 });
    }

    if (ctx.method === 'GET' && exportMatch) {
      const exportId = decodePathPart(exportMatch[1]);
      const auditExport = await auditExports.getExport(toAuditContext(auth.claims), exportId);
      if (!auditExport) {
        return json(
          {
            ok: false,
            code: 'audit_export_not_found',
            message: `Audit export ${exportId} was not found`,
          },
          { status: 404 },
        );
      }
      return json({ ok: true, export: auditExport }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/audit/exports') {
      const request = parseCreateConsoleAuditExportRequest(await readJson(ctx.request));
      const auditExport = await auditExports.createExport(toAuditContext(auth.claims), request);
      return json({ ok: true, export: auditExport }, { status: 201 });
    }
  } catch (error: unknown) {
    return sendAuditExportsError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleConsoleEnterpriseIsolation(
  ctx: CloudflareConsoleContext,
): Promise<Response | null> {
  if (!isConsoleEnterpriseIsolationPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const enterpriseIsolationOrResponse = requireEnterpriseIsolationService(ctx);
  if (enterpriseIsolationOrResponse instanceof Response) return enterpriseIsolationOrResponse;
  const enterpriseIsolation = enterpriseIsolationOrResponse;

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/isolation/status') {
      const request = parseGetConsoleEnterpriseIsolationRequest({
        scope: ctx.url.searchParams.get('scope') || undefined,
        projectId: ctx.url.searchParams.get('projectId') || undefined,
        environmentId: ctx.url.searchParams.get('environmentId') || undefined,
      });
      const isolation = await enterpriseIsolation.getIsolationState(
        toAuditContext(auth.claims),
        request,
      );
      return json({ ok: true, isolation }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/isolation/trigger') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseTriggerConsoleEnterpriseIsolationRequest(await readJson(ctx.request));
      const isolation = await enterpriseIsolation.triggerIsolation(
        toAuditContext(auth.claims),
        request,
      );
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'SYSTEM',
        action: 'enterprise_isolation.trigger',
        summary: `Triggered enterprise isolation (${isolation.scope})`,
        ...(isolation.projectId ? { projectId: isolation.projectId } : {}),
        ...(isolation.environmentId ? { environmentId: isolation.environmentId } : {}),
        metadata: {
          scope: isolation.scope,
          status: isolation.status,
          mode: isolation.mode,
          trigger: isolation.trigger,
          ticketId: isolation.ticketId,
        },
      });
      return json({ ok: true, isolation }, { status: 202 });
    }
  } catch (error: unknown) {
    return sendEnterpriseIsolationError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleConsoleWallets(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isConsoleWalletPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;
  const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
  if (routePolicy) return routePolicy;

  const walletsOrResponse = requireWalletService(ctx);
  if (walletsOrResponse instanceof Response) return walletsOrResponse;
  const wallets = walletsOrResponse;
  const walletCtx = toWalletContext(auth.claims);
  const walletMatch = ctx.pathname.match(/^\/console\/wallets\/([^/]+)$/);

  const query = {
    limit: ctx.url.searchParams.get('limit') || undefined,
    cursor: ctx.url.searchParams.get('cursor') || undefined,
    projectId:
      ctx.url.searchParams.get('projectId') ||
      (auth.claims.role === 'MEMBER' ? auth.claims.projectId : undefined),
    environmentId: ctx.url.searchParams.get('environmentId') || undefined,
    chain: ctx.url.searchParams.get('chain') || undefined,
    walletType: ctx.url.searchParams.get('walletType') || undefined,
    status: ctx.url.searchParams.get('status') || undefined,
    policyId: ctx.url.searchParams.get('policyId') || undefined,
    userId: ctx.url.searchParams.get('userId') || undefined,
    externalRefId: ctx.url.searchParams.get('externalRefId') || undefined,
    sortBy: ctx.url.searchParams.get('sortBy') || undefined,
    sortOrder: ctx.url.searchParams.get('sortOrder') || undefined,
  };

  try {
    if (ctx.method === 'POST' && ctx.pathname === '/console/wallets/balances/refresh') {
      if (!hasWalletBalanceRefresh(wallets)) {
        return json(
          {
            ok: false,
            code: 'service_unavailable',
            message: 'Wallet balance refresh is unavailable on this Console deployment',
          },
          { status: 503 },
        );
      }
      const request = parseRefreshConsoleWalletBalancesRequest(await readJson(ctx.request));
      const result = await wallets.refreshBalances(walletCtx, request);
      return json({ ok: true, ...result }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/wallets') {
      const request = parseListConsoleWalletsRequest(query);
      const page = await wallets.listWallets(walletCtx, request);
      return json(
        {
          ok: true,
          wallets: page.items,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        { status: 200 },
      );
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/wallets/search') {
      const request = parseSearchConsoleWalletsRequest({
        ...query,
        q: ctx.url.searchParams.get('q') || undefined,
      });
      const page = await wallets.searchWallets(walletCtx, request);
      return json(
        {
          ok: true,
          wallets: page.items,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        { status: 200 },
      );
    }

    if (ctx.method === 'GET' && walletMatch) {
      const walletId = decodePathPart(walletMatch[1]);
      const wallet = await wallets.getWallet(
        walletCtx,
        parseConsoleWalletKey({
          id: walletId,
          projectId: query.projectId,
          environmentId: query.environmentId,
        }),
      );
      if (!wallet) {
        return json(
          {
            ok: false,
            code: 'wallet_not_found',
            message: `Wallet ${walletId} was not found`,
          },
          { status: 404 },
        );
      }
      return json({ ok: true, wallet }, { status: 200 });
    }
  } catch (error: unknown) {
    return sendWalletError(error);
  }

  return new Response('Not Found', { status: 404 });
}

interface MemberPolicyAccessState {
  readonly assignments: readonly ConsolePolicyAssignment[];
  readonly projectByEnvironment: ReadonlyMap<string, string>;
}

async function loadMemberPolicyAccessState(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  policies: ConsolePolicyService,
): Promise<MemberPolicyAccessState> {
  const assignments = await policies.listAssignments(toBillingContext(claims));
  const projectByEnvironment = new Map<string, string>();
  if (ctx.walletEnvironments) {
    const environments = await ctx.walletEnvironments.listEnvironments(
      toWalletEnvironmentContext(claims),
    );
    for (const environment of environments) {
      projectByEnvironment.set(environment.id, environment.projectId);
    }
  }
  return { assignments, projectByEnvironment };
}

async function memberCanAccessPolicyAssignment(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  state: MemberPolicyAccessState,
  assignment: Pick<ConsolePolicyAssignment, 'scopeType' | 'scopeId'>,
  level: 'viewer' | 'editor',
): Promise<boolean> {
  switch (assignment.scopeType) {
    case 'ORG':
      return level === 'viewer' && assignment.scopeId === claims.orgId;
    case 'PROJECT':
      return hasConsoleProjectAccess(claims, assignment.scopeId, level);
    case 'ENVIRONMENT': {
      const projectId = state.projectByEnvironment.get(assignment.scopeId);
      return projectId !== undefined && hasConsoleProjectAccess(claims, projectId, level);
    }
    case 'WALLET': {
      if (level === 'editor' || !ctx.wallets || !claims.projectId || !claims.environmentId) {
        return false;
      }
      const wallet = await ctx.wallets.getWallet(toWalletContext(claims), {
        id: assignment.scopeId,
        projectId: claims.projectId,
        environmentId: claims.environmentId,
      });
      return wallet !== null && hasConsoleProjectAccess(claims, wallet.projectId, level);
    }
    default:
      return assertNever(assignment.scopeType);
  }
}

function memberCanAccessGasRules(
  claims: ConsoleAuthClaims,
  state: MemberPolicyAccessState,
  rules: ConsoleGasSponsorshipPolicyRules,
  level: 'viewer' | 'editor',
): boolean {
  if (rules.scopeType === 'ORG') return level === 'viewer';
  const environmentProjectId = rules.environmentId
    ? state.projectByEnvironment.get(rules.environmentId)
    : undefined;
  if (rules.environmentId && !environmentProjectId) return false;
  if (rules.projectId && environmentProjectId && rules.projectId !== environmentProjectId) {
    return false;
  }
  const projectId = rules.projectId || environmentProjectId;
  return projectId ? hasConsoleProjectAccess(claims, projectId, level) : false;
}

async function memberCanAccessPolicy(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  state: MemberPolicyAccessState,
  policy: ConsolePolicy,
  level: 'viewer' | 'editor',
): Promise<boolean> {
  if (policy.kind === 'GAS_SPONSORSHIP') {
    if (!isConsoleGasSponsorshipPolicyRules(policy.rules)) return false;
    return memberCanAccessGasRules(claims, state, policy.rules, level);
  }
  let assigned = false;
  let visible = policy.isSystemDefault && level === 'viewer';
  for (const assignment of state.assignments) {
    if (assignment.policyId !== policy.id) continue;
    assigned = true;
    const accessible = await memberCanAccessPolicyAssignment(ctx, claims, state, assignment, level);
    if (level === 'editor' && !accessible) return false;
    if (accessible) visible = true;
  }
  return level === 'viewer' ? visible : assigned;
}

function policyResourceNotFound(): Response {
  return json(
    { ok: false, code: 'policy_not_found', message: 'Policy was not found' },
    { status: 404 },
  );
}

async function requireMemberPolicyAccess(
  ctx: CloudflareConsoleContext,
  claims: ConsoleAuthClaims,
  policies: ConsolePolicyService,
  policyId: string,
  level: 'viewer' | 'editor',
): Promise<Response | null> {
  if (claims.role !== 'MEMBER') return null;
  const policy = await policies.getPolicy(toBillingContext(claims), policyId);
  if (!policy) return policyResourceNotFound();
  const state = await loadMemberPolicyAccessState(ctx, claims, policies);
  if (await memberCanAccessPolicy(ctx, claims, state, policy, level)) return null;
  return policyResourceNotFound();
}

async function handleConsolePolicies(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isConsolePolicyPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const policiesOrResponse = requirePolicyService(ctx);
  if (policiesOrResponse instanceof Response) return policiesOrResponse;
  const policies = policiesOrResponse;
  const policyCtx = toBillingContext(auth.claims);

  const assignmentDeleteMatch = ctx.pathname.match(/^\/console\/policies\/assignments\/([^/]+)$/);
  const policyPatchMatch = ctx.pathname.match(/^\/console\/policies\/([^/]+)$/);
  const policyDeleteMatch = ctx.pathname.match(/^\/console\/policies\/([^/]+)$/);
  const policyPublishMatch = ctx.pathname.match(/^\/console\/policies\/([^/]+)\/publish$/);
  const policySimulateMatch = ctx.pathname.match(/^\/console\/policies\/([^/]+)\/simulate$/);
  const policyVersionsMatch = ctx.pathname.match(/^\/console\/policies\/([^/]+)\/versions$/);

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/policies') {
      const request = parseListConsolePoliciesRequest({
        kind: ctx.url.searchParams.get('kind') || undefined,
      });
      const out = await policies.listPolicies(policyCtx, request);
      if (auth.claims.role !== 'MEMBER') {
        return json({ ok: true, policies: out }, { status: 200 });
      }
      const state = await loadMemberPolicyAccessState(ctx, auth.claims, policies);
      const visiblePolicies: ConsolePolicy[] = [];
      for (const policy of out) {
        if (await memberCanAccessPolicy(ctx, auth.claims, state, policy, 'viewer')) {
          visiblePolicies.push(policy);
        }
      }
      return json({ ok: true, policies: visiblePolicies }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/policies/assignments') {
      const request = parseListConsolePolicyAssignmentsRequest({
        scopeType: ctx.url.searchParams.get('scopeType') || undefined,
        scopeId: ctx.url.searchParams.get('scopeId') || undefined,
      });
      const assignments = await policies.listAssignments(policyCtx, request);
      if (auth.claims.role !== 'MEMBER') {
        return json({ ok: true, assignments }, { status: 200 });
      }
      const state = await loadMemberPolicyAccessState(ctx, auth.claims, policies);
      const visibleAssignments: ConsolePolicyAssignment[] = [];
      for (const assignment of assignments) {
        if (await memberCanAccessPolicyAssignment(ctx, auth.claims, state, assignment, 'viewer')) {
          visibleAssignments.push(assignment);
        }
      }
      return json({ ok: true, assignments: visibleAssignments }, { status: 200 });
    }

    if (ctx.method === 'GET' && policyVersionsMatch) {
      const policyId = decodePathPart(policyVersionsMatch[1]);
      const accessFailure = await requireMemberPolicyAccess(
        ctx,
        auth.claims,
        policies,
        policyId,
        'viewer',
      );
      if (accessFailure) return accessFailure;
      const versions = await policies.listPolicyVersions(policyCtx, policyId);
      if (!versions) {
        return json(
          { ok: false, code: 'policy_not_found', message: `Policy ${policyId} was not found` },
          { status: 404 },
        );
      }
      return json({ ok: true, versions }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/policies') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseCreateConsolePolicyRequest(await readJson(ctx.request));
      if (auth.claims.role === 'MEMBER') {
        const state = await loadMemberPolicyAccessState(ctx, auth.claims, policies);
        if (request.kind === 'GAS_SPONSORSHIP') {
          const rules = parseConsolePolicyRulesInput(request.rules, 'GAS_SPONSORSHIP');
          if (
            !isConsoleGasSponsorshipPolicyRules(rules) ||
            !memberCanAccessGasRules(auth.claims, state, rules, 'editor')
          ) {
            return json(
              { ok: false, code: 'forbidden', message: 'Policy scope is unavailable' },
              { status: 403 },
            );
          }
        } else if (
          !request.assignment ||
          !(await memberCanAccessPolicyAssignment(
            ctx,
            auth.claims,
            state,
            request.assignment,
            'editor',
          ))
        ) {
          return json(
            { ok: false, code: 'forbidden', message: 'Policy scope is unavailable' },
            { status: 403 },
          );
        }
      }
      const policy = await policies.createPolicy(policyCtx, request);
      const auditEvent = buildConsolePolicyAuditEvent({
        action: 'policy.create',
        policy,
        assignment: request.assignment,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'POLICY',
        action: 'policy.create',
        summary: auditEvent.summary,
        ...(auditEvent.projectId ? { projectId: auditEvent.projectId } : {}),
        ...(auditEvent.environmentId ? { environmentId: auditEvent.environmentId } : {}),
        metadata: auditEvent.metadata,
      });
      return json({ ok: true, policy }, { status: 201 });
    }

    if (ctx.method === 'PUT' && ctx.pathname === '/console/policies/assignments') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseUpsertConsolePolicyAssignmentRequest(await readJson(ctx.request));
      if (auth.claims.role === 'MEMBER') {
        const state = await loadMemberPolicyAccessState(ctx, auth.claims, policies);
        const targetAllowed = await memberCanAccessPolicyAssignment(
          ctx,
          auth.claims,
          state,
          request,
          'editor',
        );
        if (!targetAllowed) {
          return json(
            { ok: false, code: 'forbidden', message: 'Assignment scope is unavailable' },
            { status: 403 },
          );
        }
        const policyAccessFailure = await requireMemberPolicyAccess(
          ctx,
          auth.claims,
          policies,
          request.policyId,
          'editor',
        );
        if (policyAccessFailure) return policyAccessFailure;
      }
      const assignment = await policies.upsertAssignment(policyCtx, request);
      const policy = await policies.getPolicy(policyCtx, assignment.policyId);
      const auditEvent = buildConsolePolicyAssignmentAuditEvent({
        action: 'policy.assignment.upsert',
        assignment,
        policy,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'POLICY',
        action: 'policy.assignment.upsert',
        summary: auditEvent.summary,
        ...(auditEvent.projectId ? { projectId: auditEvent.projectId } : {}),
        ...(auditEvent.environmentId ? { environmentId: auditEvent.environmentId } : {}),
        metadata: auditEvent.metadata,
      });
      return json({ ok: true, assignment }, { status: 200 });
    }

    if (ctx.method === 'DELETE' && assignmentDeleteMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const assignmentId = decodePathPart(assignmentDeleteMatch[1]);
      if (auth.claims.role === 'MEMBER') {
        const state = await loadMemberPolicyAccessState(ctx, auth.claims, policies);
        const target = state.assignments.find((assignment) => assignment.id === assignmentId);
        if (
          !target ||
          !(await memberCanAccessPolicyAssignment(ctx, auth.claims, state, target, 'editor'))
        ) {
          return json(
            { ok: false, code: 'assignment_not_found', message: 'Assignment was not found' },
            { status: 404 },
          );
        }
      }
      const out = await policies.deleteAssignment(policyCtx, assignmentId);
      if (!out.removed || !out.assignment) {
        return json(
          {
            ok: false,
            code: 'assignment_not_found',
            message: `Assignment ${assignmentId} was not found`,
          },
          { status: 404 },
        );
      }
      const policy = await policies.getPolicy(policyCtx, out.assignment.policyId);
      const auditEvent = buildConsolePolicyAssignmentAuditEvent({
        action: 'policy.assignment.delete',
        assignment: out.assignment,
        policy,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'POLICY',
        action: 'policy.assignment.delete',
        summary: auditEvent.summary,
        ...(auditEvent.projectId ? { projectId: auditEvent.projectId } : {}),
        ...(auditEvent.environmentId ? { environmentId: auditEvent.environmentId } : {}),
        metadata: auditEvent.metadata,
      });
      return json({ ok: true, removed: true, assignment: out.assignment }, { status: 200 });
    }

    if (ctx.method === 'PATCH' && policyPatchMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const policyId = decodePathPart(policyPatchMatch[1]);
      const request = parseUpdateConsolePolicyRequest(await readJson(ctx.request));
      const accessFailure = await requireMemberPolicyAccess(
        ctx,
        auth.claims,
        policies,
        policyId,
        'editor',
      );
      if (accessFailure) return accessFailure;
      if (auth.claims.role === 'MEMBER' && request.rules) {
        const current = await policies.getPolicy(policyCtx, policyId);
        if (!current) return policyResourceNotFound();
        if (current.kind === 'GAS_SPONSORSHIP') {
          const rules = parseConsolePolicyRulesInput(request.rules, current.kind);
          const state = await loadMemberPolicyAccessState(ctx, auth.claims, policies);
          if (
            !isConsoleGasSponsorshipPolicyRules(rules) ||
            !memberCanAccessGasRules(auth.claims, state, rules, 'editor')
          ) {
            return json(
              { ok: false, code: 'forbidden', message: 'Policy scope is unavailable' },
              { status: 403 },
            );
          }
        }
      }
      const policy = await policies.updatePolicy(policyCtx, policyId, request);
      if (!policy) {
        return json(
          {
            ok: false,
            code: 'policy_not_found',
            message: `Policy ${policyId} was not found`,
          },
          { status: 404 },
        );
      }
      const auditEvent = buildConsolePolicyAuditEvent({
        action: 'policy.update',
        policy,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'POLICY',
        action: 'policy.update',
        summary: auditEvent.summary,
        ...(auditEvent.projectId ? { projectId: auditEvent.projectId } : {}),
        ...(auditEvent.environmentId ? { environmentId: auditEvent.environmentId } : {}),
        metadata: auditEvent.metadata,
      });
      return json({ ok: true, policy }, { status: 200 });
    }

    if (ctx.method === 'DELETE' && policyDeleteMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const policyId = decodePathPart(policyDeleteMatch[1]);
      const accessFailure = await requireMemberPolicyAccess(
        ctx,
        auth.claims,
        policies,
        policyId,
        'editor',
      );
      if (accessFailure) return accessFailure;
      const result = await policies.deletePolicy(policyCtx, policyId);
      if (!result.removed || !result.policy) {
        return json(
          {
            ok: false,
            code: 'policy_not_found',
            message: `Policy ${policyId} was not found`,
          },
          { status: 404 },
        );
      }
      const auditEvent = buildConsolePolicyAuditEvent({
        action: 'policy.delete',
        policy: result.policy,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'POLICY',
        action: 'policy.delete',
        summary: auditEvent.summary,
        ...(auditEvent.projectId ? { projectId: auditEvent.projectId } : {}),
        ...(auditEvent.environmentId ? { environmentId: auditEvent.environmentId } : {}),
        metadata: auditEvent.metadata,
      });
      return json({ ok: true, removed: true, policy: result.policy }, { status: 200 });
    }

    if (ctx.method === 'POST' && policyPublishMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const policyId = decodePathPart(policyPublishMatch[1]);
      const accessFailure = await requireMemberPolicyAccess(
        ctx,
        auth.claims,
        policies,
        policyId,
        'editor',
      );
      if (accessFailure) return accessFailure;
      const rawBody = await readJson(ctx.request);
      const approvalIdForFailure = readApprovalIdFromBody(rawBody);
      const approvalRequired = await requireApprovedOperationApproval(ctx, auth.claims, {
        operationType: 'POLICY_PUBLISH',
        approvalIdRaw: approvalIdForFailure,
        resourceType: 'policy',
        resourceId: policyId,
      });
      if (!approvalRequired.ok) return approvalRequired.response;
      const approvedRules = ConsolePolicyRulesDigest.parse(
        approvalRequired.approval.policyRulesDigest,
      );
      if (!approvedRules.ok) {
        return json(
          { ok: false, code: 'approval_stale', message: 'Policy approval has no rules digest' },
          { status: 409 },
        );
      }
      try {
        const result = await policies.publishPolicy(policyCtx, policyId, {
          kind: 'approved',
          rulesDigest: approvedRules.digest,
        });
        if (!result) {
          return json(
            {
              ok: false,
              code: 'policy_not_found',
              message: `Policy ${policyId} was not found`,
            },
            { status: 404 },
          );
        }
        const auditEvent = buildConsolePolicyAuditEvent({
          action: 'policy.publish',
          policy: result.policy,
          extraMetadata: {
            published: result.published,
          },
        });
        await emitConsoleAuditEvent(ctx, auth.claims, {
          category: 'POLICY',
          action: 'policy.publish',
          summary: auditEvent.summary,
          ...(auditEvent.projectId ? { projectId: auditEvent.projectId } : {}),
          ...(auditEvent.environmentId ? { environmentId: auditEvent.environmentId } : {}),
          metadata: auditEvent.metadata,
        });
        return json({ ok: true, result }, { status: 200 });
      } catch (error: unknown) {
        await emitApprovalFailureObservabilityEvent(ctx, auth.claims, {
          approvalId: approvalIdForFailure,
          operationType: 'POLICY_PUBLISH',
          resourceType: 'policy',
          resourceId: policyId,
          error,
        });
        throw error;
      }
    }

    if (ctx.method === 'POST' && policySimulateMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const policyId = decodePathPart(policySimulateMatch[1]);
      const accessFailure = await requireMemberPolicyAccess(
        ctx,
        auth.claims,
        policies,
        policyId,
        'viewer',
      );
      if (accessFailure) return accessFailure;
      const request = parseSimulateConsolePolicyRequest(await readJson(ctx.request));
      const simulation = await policies.simulatePolicy(policyCtx, policyId, request);
      if (!simulation) {
        return json(
          {
            ok: false,
            code: 'policy_not_found',
            message: `Policy ${policyId} was not found`,
          },
          { status: 404 },
        );
      }
      return json({ ok: true, simulation }, { status: 200 });
    }
  } catch (error: unknown) {
    return sendPolicyError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleConsoleInsights(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isConsoleInsightsPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/policy/coverage') {
      const walletsOrResponse = requireWalletService(ctx);
      if (walletsOrResponse instanceof Response) return walletsOrResponse;
      const scope = resolveConsoleInsightsScope({
        projectIdRaw: ctx.url.searchParams.get('projectId') || undefined,
        environmentIdRaw: ctx.url.searchParams.get('environmentId') || undefined,
        claimsProjectId: auth.claims.projectId,
        claimsEnvironmentId: auth.claims.environmentId ?? undefined,
      });
      const coverage = await buildConsolePolicyCoverageView({
        wallets: walletsOrResponse,
        walletCtx: toWalletContext(auth.claims),
        scope,
        ...(ctx.policies
          ? {
              resolveWalletPolicies: async (walletRows) =>
                await resolveWalletPolicyPresentationByWalletId(ctx, auth.claims, walletRows),
            }
          : {}),
      });
      return json({ ok: true, coverage }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/gas/readiness') {
      const walletsOrResponse = requireWalletService(ctx);
      if (walletsOrResponse instanceof Response) return walletsOrResponse;
      const scope = resolveConsoleInsightsScope({
        projectIdRaw: ctx.url.searchParams.get('projectId') || undefined,
        environmentIdRaw: ctx.url.searchParams.get('environmentId') || undefined,
        claimsProjectId: auth.claims.projectId,
        claimsEnvironmentId: auth.claims.environmentId ?? undefined,
      });
      const readiness = await buildConsoleGasReadinessView({
        wallets: walletsOrResponse,
        walletCtx: toWalletContext(auth.claims),
        scope,
        recentWindowDays: 7,
        ...(ctx.policies
          ? {
              resolveWalletPolicies: async (walletRows) =>
                await resolveWalletPolicyPresentationByWalletId(ctx, auth.claims, walletRows),
            }
          : {}),
      });
      return json({ ok: true, readiness }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/export/governance') {
      const keyExportsOrResponse = requireKeyExportService(ctx);
      if (keyExportsOrResponse instanceof Response) return keyExportsOrResponse;
      const environmentIdRaw = String(ctx.url.searchParams.get('environmentId') || '').trim();
      const environmentIdFilter = environmentIdRaw || auth.claims.environmentId || undefined;
      if (auth.claims.role === 'MEMBER' && !environmentIdFilter) {
        return json(
          { ok: false, code: 'environment_required', message: 'Select a Wallet environment' },
          { status: 400 },
        );
      }
      if (environmentIdFilter) {
        const accessFailure = await requireWalletEnvironmentProjectAccess(
          ctx,
          auth.claims,
          environmentIdFilter,
          undefined,
          'viewer',
        );
        if (accessFailure) return accessFailure;
      }
      const governance = await buildConsoleExportGovernanceView({
        keyExports: keyExportsOrResponse,
        keyExportCtx: toBillingContext(auth.claims),
        environmentIdFilter,
      });
      return json({ ok: true, governance }, { status: 200 });
    }
  } catch (error: unknown) {
    if (ctx.pathname.startsWith('/console/export/')) return sendKeyExportError(error);
    return sendWalletError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleConsoleWebhooks(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isConsoleWebhookPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const webhooksOrResponse = requireWebhookService(ctx);
  if (webhooksOrResponse instanceof Response) return webhooksOrResponse;
  const webhooks = webhooksOrResponse;
  const webhookCtx = toBillingContext(auth.claims);

  const endpointMatch = ctx.pathname.match(/^\/console\/webhooks\/([^/]+)$/);
  const deliveriesMatch = ctx.pathname.match(/^\/console\/webhooks\/([^/]+)\/deliveries$/);
  const attemptsMatch = ctx.pathname.match(/^\/console\/webhooks\/([^/]+)\/attempts$/);
  const deadLettersMatch = ctx.pathname.match(/^\/console\/webhooks\/([^/]+)\/dead-letters$/);
  const replayMatch = ctx.pathname.match(/^\/console\/webhooks\/([^/]+)\/replay$/);
  const testMatch = ctx.pathname.match(/^\/console\/webhooks\/([^/]+)\/test$/);
  const rotateSecretMatch = ctx.pathname.match(/^\/console\/webhooks\/([^/]+)\/rotate-secret$/);

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/webhooks') {
      const endpoints = await webhooks.listEndpoints(webhookCtx);
      return json({ ok: true, endpoints }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/webhooks') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseCreateConsoleWebhookEndpointRequest(
        await readJson(ctx.request),
        WALLET_CONSOLE_WEBHOOK_EVENT_CATEGORY_VALIDATION,
      );
      const { endpoint, signingSecret } = await webhooks.createEndpoint(webhookCtx, request);
      const auditEvent = buildConsoleWebhookEndpointAuditEvent({
        action: 'webhook.endpoint.create',
        endpoint,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'WEBHOOK',
        action: 'webhook.endpoint.create',
        summary: auditEvent.summary,
        metadata: auditEvent.metadata,
      });
      // Sole delivery of the plaintext: no read route can return it again.
      return json({ ok: true, endpoint, signingSecret }, { status: 201 });
    }

    if (ctx.method === 'POST' && rotateSecretMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const endpointId = decodePathPart(rotateSecretMatch[1]);
      const rotated = await webhooks.rotateSecret(webhookCtx, endpointId);
      if (!rotated) {
        return json(
          {
            ok: false,
            code: 'webhook_not_found',
            message: `Webhook endpoint ${endpointId} was not found`,
          },
          { status: 404 },
        );
      }
      const auditEvent = buildConsoleWebhookEndpointAuditEvent({
        action: 'webhook.endpoint.rotate_secret',
        endpoint: rotated.endpoint,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'WEBHOOK',
        action: 'webhook.endpoint.rotate_secret',
        summary: auditEvent.summary,
        metadata: auditEvent.metadata,
      });
      return json(
        { ok: true, endpoint: rotated.endpoint, signingSecret: rotated.signingSecret },
        { status: 200 },
      );
    }

    if (ctx.method === 'PATCH' && endpointMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const endpointId = decodePathPart(endpointMatch[1]);
      const request = parseUpdateConsoleWebhookEndpointRequest(
        await readJson(ctx.request),
        WALLET_CONSOLE_WEBHOOK_EVENT_CATEGORY_VALIDATION,
      );
      const endpoint = await webhooks.updateEndpoint(webhookCtx, endpointId, request);
      if (!endpoint) {
        return json(
          {
            ok: false,
            code: 'webhook_not_found',
            message: `Webhook endpoint ${endpointId} was not found`,
          },
          { status: 404 },
        );
      }
      const auditEvent = buildConsoleWebhookEndpointAuditEvent({
        action: 'webhook.endpoint.update',
        endpoint,
      });
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'WEBHOOK',
        action: 'webhook.endpoint.update',
        summary: auditEvent.summary,
        metadata: auditEvent.metadata,
      });
      return json({ ok: true, endpoint }, { status: 200 });
    }

    if (ctx.method === 'DELETE' && endpointMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const endpointId = decodePathPart(endpointMatch[1]);
      const out = await webhooks.deleteEndpoint(webhookCtx, endpointId);
      if (!out.removed) {
        return json(
          {
            ok: false,
            code: 'webhook_not_found',
            message: `Webhook endpoint ${endpointId} was not found`,
          },
          { status: 404 },
        );
      }
      if (out.endpoint) {
        const auditEvent = buildConsoleWebhookEndpointAuditEvent({
          action: 'webhook.endpoint.delete',
          endpoint: out.endpoint,
        });
        await emitConsoleAuditEvent(ctx, auth.claims, {
          category: 'WEBHOOK',
          action: 'webhook.endpoint.delete',
          summary: auditEvent.summary,
          metadata: auditEvent.metadata,
        });
      }
      return json({ ok: true, removed: true }, { status: 200 });
    }

    if (ctx.method === 'GET' && deliveriesMatch) {
      const endpointId = decodePathPart(deliveriesMatch[1]);
      const request = parseListConsoleWebhookDeliveriesRequest({
        limit: ctx.url.searchParams.get('limit') || undefined,
        cursor: ctx.url.searchParams.get('cursor') || undefined,
      });
      const page = await webhooks.listDeliveries(webhookCtx, endpointId, request);
      return json(
        {
          ok: true,
          deliveries: page.items,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        { status: 200 },
      );
    }

    if (ctx.method === 'GET' && attemptsMatch) {
      const endpointId = decodePathPart(attemptsMatch[1]);
      const request = parseListConsoleWebhookAttemptsRequest({
        deliveryId: ctx.url.searchParams.get('deliveryId') || undefined,
        limit: ctx.url.searchParams.get('limit') || undefined,
        cursor: ctx.url.searchParams.get('cursor') || undefined,
      });
      const page = await webhooks.listAttempts(webhookCtx, endpointId, request);
      return json(
        {
          ok: true,
          attempts: page.items,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        { status: 200 },
      );
    }

    if (ctx.method === 'GET' && deadLettersMatch) {
      const endpointId = decodePathPart(deadLettersMatch[1]);
      const includeResolvedRaw = ctx.url.searchParams.get('includeResolved');
      const request = parseListConsoleWebhookDeadLettersRequest({
        deliveryId: ctx.url.searchParams.get('deliveryId') || undefined,
        includeResolved: includeResolvedRaw === null ? undefined : includeResolvedRaw,
        limit: ctx.url.searchParams.get('limit') || undefined,
        cursor: ctx.url.searchParams.get('cursor') || undefined,
      });
      const page = await webhooks.listDeadLetters(webhookCtx, endpointId, request);
      return json(
        {
          ok: true,
          deadLetters: page.items,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        { status: 200 },
      );
    }

    if (ctx.method === 'POST' && testMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const endpointId = decodePathPart(testMatch[1]);
      const result = await webhooks.sendTestEvent(webhookCtx, endpointId);
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'WEBHOOK',
        action: 'webhook.test.sent',
        summary: 'Sent a test webhook event.',
        metadata: { endpointId, eventId: result.eventId },
      });
      return json({ ok: true, result }, { status: 200 });
    }

    if (ctx.method === 'POST' && replayMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const endpointId = decodePathPart(replayMatch[1]);
      const request = parseReplayConsoleWebhookDeliveryRequest(await readJson(ctx.request));
      const replay = await webhooks.replayDelivery(webhookCtx, endpointId, request);
      if (!replay.replayed) {
        if (replay.reason === 'endpoint_not_found') {
          return json(
            {
              ok: false,
              code: 'webhook_not_found',
              message: `Webhook endpoint ${endpointId} was not found`,
            },
            { status: 404 },
          );
        }
        if (replay.reason === 'delivery_not_found') {
          return json(
            {
              ok: false,
              code: 'delivery_not_found',
              message: `Webhook delivery ${request.deliveryId} was not found`,
            },
            { status: 404 },
          );
        }
        return json(
          {
            ok: false,
            code: 'no_replayable_delivery',
            message: 'No replayable delivery exists for this endpoint',
          },
          { status: 409 },
        );
      }
      if (replay.delivery) {
        const auditEvent = buildConsoleWebhookReplayAuditEvent({
          endpointId,
          delivery: replay.delivery,
          requestedDeliveryId: request.deliveryId,
        });
        await emitConsoleAuditEvent(ctx, auth.claims, {
          category: 'WEBHOOK',
          action: 'webhook.delivery.replay_requested',
          summary: auditEvent.summary,
          metadata: auditEvent.metadata,
        });
      }
      return json({ ok: true, replay }, { status: 200 });
    }
  } catch (error: unknown) {
    return sendWebhookError(error);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleSharedConsoleBilling(ctx: CloudflareConsoleContext): Promise<Response | null> {
  return handleConsoleBillingRoutes(ctx, createWalletBillingRouteHooks(ctx));
}

async function handleWalletConsoleBilling(ctx: CloudflareConsoleContext): Promise<Response | null> {
  if (!isWalletBillingPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  try {
    const billingCtx = toBillingContext(auth.claims);

    if (
      ctx.method === 'GET' &&
      ctx.pathname === '/console/billing/sponsored-executions/reconciliation'
    ) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const sponsoredCallsOrResponse = requireSponsoredCallService(ctx);
      if (sponsoredCallsOrResponse instanceof Response) return sponsoredCallsOrResponse;
      const billingOrResponse = requireBillingService(ctx);
      if (billingOrResponse instanceof Response) return billingOrResponse;
      const request = parseListConsoleSponsoredCallRecordsRequest(
        Object.fromEntries(ctx.url.searchParams.entries()),
      );
      const page = await listConsoleSponsoredCallReconciliationPage({
        sponsoredCalls: sponsoredCallsOrResponse,
        billing: billingOrResponse,
        ctx: billingCtx,
        request,
      });
      return json({ ok: true, page }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/billing/sponsored-executions') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const sponsoredCallsOrResponse = requireSponsoredCallService(ctx);
      if (sponsoredCallsOrResponse instanceof Response) return sponsoredCallsOrResponse;
      const request = parseListConsoleSponsoredCallRecordsRequest(
        Object.fromEntries(ctx.url.searchParams.entries()),
      );
      const page = await sponsoredCallsOrResponse.listRecords(billingCtx, request);
      return json({ ok: true, page }, { status: 200 });
    }

    const billingOrResponse = requireBillingService(ctx);
    if (billingOrResponse instanceof Response) return billingOrResponse;
    const billing = billingOrResponse;
    if (ctx.method === 'GET' && ctx.pathname === '/console/billing/usage/monthly-active-wallets') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const monthUtcRaw = String(ctx.url.searchParams.get('monthUtc') || '').trim();
      const monthUtc = monthUtcRaw || undefined;
      const usage = await billing.getMonthlyActiveResources(billingCtx, monthUtc);
      return json({ ok: true, usage }, { status: 200 });
    }
  } catch (error: unknown) {
    if (isConsoleOrgProjectError(error) || isConsoleWalletEnvironmentError(error)) {
      return sendOrganizationMetadataError(error);
    }
    if (isConsoleSponsoredCallError(error)) {
      return sendSponsoredCallError(error);
    }
    return sendBillingError(error);
  }

  return new Response('Not Found', { status: 404 });
}

export function createCloudflareConsoleRouter(opts: ConsoleRouterOptions = {}): FetchHandler {
  const notFound = () => new Response('Not Found', { status: 404 });
  const logger = coerceRouterLogger(opts.logger);
  const routeSurface = resolveWalletConsoleRouteSurface();
  const { routeDefinitions } = routeSurface;
  const billing = opts.billing === undefined ? null : opts.billing;
  const funds = opts.funds ?? null;
  const billingUsage = opts.billingUsage ?? null;
  const executionFunds = opts.executionFunds ?? null;
  const sponsoredCalls = opts.sponsoredCalls === undefined ? null : opts.sponsoredCalls;
  const orgProjects = opts.orgProjects ?? null;
  const walletEnvironments = opts.walletEnvironments ?? null;
  const wallets = opts.wallets === undefined ? null : opts.wallets;
  const policies = opts.policies === undefined ? null : opts.policies;
  const apiKeys = opts.apiKeys === undefined ? null : opts.apiKeys;
  const webhooks = opts.webhooks === undefined ? null : opts.webhooks;
  const keyExports = opts.keyExports === undefined ? null : opts.keyExports;
  const runtimeSnapshots = opts.runtimeSnapshots === undefined ? null : opts.runtimeSnapshots;
  const organizationAccess = opts.organizationAccess === undefined ? null : opts.organizationAccess;
  const approvals = opts.approvals === undefined ? null : opts.approvals;
  const audit = opts.audit === undefined ? null : opts.audit;
  const auditExports = opts.auditExports === undefined ? null : opts.auditExports;
  const enterpriseIsolation =
    opts.enterpriseIsolation === undefined ? null : opts.enterpriseIsolation;
  const onboarding = opts.onboarding === undefined ? null : opts.onboarding;
  const account = opts.account === undefined ? null : opts.account;
  const observability = opts.observability === undefined ? null : opts.observability;
  const observabilityIngestion =
    opts.observabilityIngestion === undefined ? null : opts.observabilityIngestion;
  const tenantStorageRouteResolver = opts.tenantStorageRouteResolver || null;
  const tenantStorageNamespace = tenantStorageRouteResolver
    ? String(opts.tenantStorageNamespace || '').trim() || null
    : null;

  const handlers: Array<(ctx: CloudflareConsoleContext) => Promise<Response | null>> = [
    handleConsoleHealth,
    handleConsoleReady,
    handleConsoleSession,
    handleConsoleAccount,
    handleConsoleOnboarding,
    handleAccountPlatformRoutes,
    handleConsoleOpsCockpit,
    handleConsoleObservability,
    handleConsoleProjects,
    handleConsoleEnvironments,
    handleConsoleOrganizationAccess,
    handleConsoleApprovals,
    handleConsoleAudit,
    handleConsoleAuditExports,
    handleConsoleEnterpriseIsolation,
    handleConsoleWallets,
    handleConsolePolicies,
    handleConsoleInsights,
    handleConsoleKeyExports,
    handleConsoleRuntimeSnapshots,
    handleConsoleApiKeys,
    handleConsoleWebhooks,
    handleSharedConsoleBilling,
    handleWalletConsoleBilling,
  ];

  const handler: FetchHandler = async function handler(
    request: Request,
    env?: CfEnv,
    cfCtx?: CfExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();
    const startedAtMs = Date.now();

    if (method === 'OPTIONS') {
      const res = new Response(null, { status: 204 });
      withConsoleCors(res.headers, opts, request);
      return res;
    }

    const ctx: CloudflareConsoleContext = {
      request,
      url,
      pathname,
      method,
      env,
      cfCtx,
      opts,
      logger,
      routeDefinitions,
      auth: opts.auth ?? null,
      session: opts.session ?? null,
      healthz: opts.healthz ?? false,
      readyz: opts.readyz ?? false,
      readyCheck: opts.readyCheck ?? null,
      authorizeTenant: null,
      waitUntil: cfCtx?.waitUntil ? cfCtx.waitUntil.bind(cfCtx) : null,
      consoleReturnOrigin: opts.corsOrigins
        ? resolveConsoleReturnOrigin(request, buildCorsOrigins(...opts.corsOrigins))
        : null,
      billingStripeWebhookSigningSecret: opts.billingStripeWebhookSigningSecret ?? null,
      accountPlatform: opts.accountPlatform ?? null,
      walletProvisioning: opts.walletProvisioning ?? null,
      satyrProvisioning: opts.satyrProvisioning ?? null,
      billing,
      funds,
      billingUsage,
      executionFunds,
      sponsoredCalls,
      orgProjects,
      walletEnvironments,
      wallets,
      policies,
      apiKeys,
      webhooks,
      keyExports,
      runtimeSnapshots,
      organizationAccess,
      approvals,
      stepUp: opts.stepUp ?? null,
      audit,
      auditExports,
      enterpriseIsolation,
      onboarding,
      account,
      observability,
      observabilityIngestion,
      tenantStorageRouteResolver,
      tenantStorageNamespace,
    };

    ctx.authorizeTenant = resolveTenantStorageRouteForConsoleRequest.bind(null, ctx);

    try {
      for (const fn of handlers) {
        const res = await fn(ctx);
        if (res) {
          withConsoleCors(res.headers, opts, request);
          void emitRouterTimingObservabilityEvent(ctx, startedAtMs, res.status);
          return res;
        }
      }
      const res = notFound();
      withConsoleCors(res.headers, opts, request);
      void emitRouterTimingObservabilityEvent(ctx, startedAtMs, res.status);
      return res;
    } catch (e: unknown) {
      const res = json(
        { code: 'internal', message: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
      withConsoleCors(res.headers, opts, request);
      void emitRouterTimingObservabilityEvent(ctx, startedAtMs, res.status);
      return res;
    }
  };

  return attachConsoleRouteSurface(handler, routeSurface);
}
