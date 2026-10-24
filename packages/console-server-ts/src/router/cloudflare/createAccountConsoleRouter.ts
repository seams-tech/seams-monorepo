import type { ConsoleAccountService } from '../../account/service';
import type { D1AccountPlatformService } from '../../accountPlatform/d1';
import type { AccountServiceProvisioningAdapterV1 } from '../../accountPlatform/provisioning';
import type { ConsoleAuditService } from '../../audit/service';
import type { ConsoleBillingService } from '../../billing/service';
import type { D1BillingUsageService } from '../../billing/usage';
import type { ConsoleBillingPrepaidReservationService } from '../../billingPrepaidReservations/service';
import type { ConsoleWebhookService } from '../../webhooks/service';
import { normalizeLogger, type RouterLogger, type SessionAdapter } from '../../boundary';
import type { ConsoleOnboardingService } from '../../onboarding/service';
import type { ConsoleOrgProjectService } from '../../orgProjectEnv/service';
import type { ConsoleOrganizationAccessService } from '../../teamRbac';
import type { ConsoleAuthAdapter } from '../consoleAuth';
import { attachConsoleRouteSurface, resolveConsoleRouteSurface } from '../consoleRouteSurface';
import {
  handleConsoleAccount,
  handleConsoleHealth,
  handleConsoleOnboarding,
  handleConsoleOrganizationAccess,
  handleConsoleProjects,
  handleConsoleReady,
  handleConsoleSession,
} from './accountRoutes';
import { resolveConsoleReturnOrigin, type AccountConsoleContext } from './context';
import { json } from './http';
import { resolveConsoleCorsOrigins, withConsoleCors } from './cors';
import { handleAccountPlatformRoutes } from './accountPlatformRoutes';
import { handleAccountConsoleAudit } from './auditRoutes';
import {
  handleConsoleBillingRoutes,
  ACCOUNT_BILLING_HOOKS,
  type ConsoleBillingRouteHooks,
} from './billingRoutes';

export interface AccountConsoleRouterServices {
  readonly account: ConsoleAccountService;
  readonly accountPlatform: D1AccountPlatformService;
  readonly audit: ConsoleAuditService;
  readonly billing: ConsoleBillingService;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billingUsage: D1BillingUsageService;
  readonly webhooks: ConsoleWebhookService | null;
  readonly onboarding: ConsoleOnboardingService;
  readonly orgProjects: ConsoleOrgProjectService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
}

export interface AccountConsoleRouterOptions {
  readonly services: AccountConsoleRouterServices;
  readonly auth: ConsoleAuthAdapter;
  readonly session: SessionAdapter;
  readonly readyCheck: () => Promise<void> | void;
  readonly walletProvisioning: AccountServiceProvisioningAdapterV1 | null;
  readonly satyrProvisioning: AccountServiceProvisioningAdapterV1 | null;
  readonly billingStripeWebhookSigningSecret: string | null;
  readonly billingHooks?: ConsoleBillingRouteHooks;
  readonly requestCompleted?: (
    context: AccountConsoleContext,
    latencyMs: number,
    statusCode: number,
  ) => Promise<void>;
  readonly corsOrigins?: readonly (string | undefined)[];
  readonly logger?: RouterLogger;
  readonly waitUntil?: (work: Promise<unknown>) => void;
}

export type AccountConsoleFetchHandler = (request: Request) => Promise<Response>;

const ACCOUNT_HANDLERS = [
  handleConsoleHealth,
  handleConsoleReady,
  handleConsoleSession,
  handleConsoleAccount,
  handleConsoleOnboarding,
  handleAccountPlatformRoutes,
  handleConsoleProjects,
  handleConsoleOrganizationAccess,
  handleAccountConsoleAudit,
] as const;

function corsResponse(
  response: Response,
  request: Request,
  origins: readonly (string | undefined)[],
): Response {
  withConsoleCors(response.headers, origins, request);
  return response;
}

async function routeAccountRequest(
  options: AccountConsoleRouterOptions,
  request: Request,
): Promise<Response> {
  if (request.method.toUpperCase() === 'OPTIONS') {
    return corsResponse(new Response(null, { status: 204 }), request, options.corsOrigins ?? []);
  }
  const startedAt = Date.now();
  const url = new URL(request.url);
  const context: AccountConsoleContext = {
    request,
    url,
    pathname: url.pathname,
    method: request.method.toUpperCase(),
    logger: normalizeLogger(options.logger),
    routeDefinitions: resolveConsoleRouteSurface().routeDefinitions,
    auth: options.auth,
    session: options.session,
    healthz: true,
    readyz: true,
    readyCheck: options.readyCheck,
    account: options.services.account,
    audit: options.services.audit,
    billing: options.services.billing,
    webhooks: options.services.webhooks,
    billingStripeWebhookSigningSecret: options.billingStripeWebhookSigningSecret,
    accountPlatform: options.services.accountPlatform,
    walletProvisioning: options.walletProvisioning,
    satyrProvisioning: options.satyrProvisioning,
    onboarding: options.services.onboarding,
    orgProjects: options.services.orgProjects,
    organizationAccess: options.services.organizationAccess,
    authorizeTenant: null,
    waitUntil: options.waitUntil ?? null,
    consoleReturnOrigin: resolveConsoleReturnOrigin(
      request,
      resolveConsoleCorsOrigins(options.corsOrigins ?? []),
    ),
  };
  const response = await dispatchAccountRequest(options, context);
  if (options.requestCompleted) {
    const work = options
      .requestCompleted(context, Math.max(0, Date.now() - startedAt), response.status)
      .catch(logAccountRequestObservationFailure.bind(null, context));
    if (context.waitUntil) context.waitUntil(work);
    else void work;
  }
  return response;
}

function logAccountRequestObservationFailure(context: AccountConsoleContext, error: unknown): void {
  context.logger.warn('[console] request observation failed', {
    message: error instanceof Error ? error.message : String(error),
  });
}

async function dispatchAccountRequest(
  options: AccountConsoleRouterOptions,
  context: AccountConsoleContext,
): Promise<Response> {
  const request = context.request;
  try {
    for (const handle of ACCOUNT_HANDLERS) {
      const response = await handle(context);
      if (response) return corsResponse(response, request, options.corsOrigins ?? []);
    }
    const billing = await handleConsoleBillingRoutes(
      context,
      options.billingHooks ?? ACCOUNT_BILLING_HOOKS,
    );
    if (billing) return corsResponse(billing, request, options.corsOrigins ?? []);
    return corsResponse(
      new Response('Not Found', { status: 404 }),
      request,
      options.corsOrigins ?? [],
    );
  } catch (error) {
    return corsResponse(
      json(
        {
          ok: false,
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      ),
      request,
      options.corsOrigins ?? [],
    );
  }
}

export function createAccountConsoleRouter(
  options: AccountConsoleRouterOptions,
): AccountConsoleFetchHandler {
  return attachConsoleRouteSurface(
    routeAccountRequest.bind(null, options),
    resolveConsoleRouteSurface(),
  );
}
