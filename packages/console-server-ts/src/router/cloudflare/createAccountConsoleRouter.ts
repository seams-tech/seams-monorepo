import type { ConsoleAccountService } from '../../account/service';
import type { D1AccountPlatformService } from '../../accountPlatform/d1';
import type { AccountServiceProvisioningAdapterV1 } from '../../accountPlatform/provisioning';
import type { ConsoleAuditService } from '../../audit/service';
import type { ConsoleBillingService } from '../../billing/service';
import type { ConsoleWebhookService } from '../../webhooks/service';
import {
  normalizeCorsOrigin,
  normalizeLogger,
  type RouterLogger,
  type SessionAdapter,
} from '../../boundary';
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
import type { AccountConsoleContext } from './context';
import { json } from './http';
import { handleAccountPlatformRoutes } from './accountPlatformRoutes';
import { handleAccountConsoleAudit } from './auditRoutes';
import { handleAccountConsoleBilling } from './billingRoutes';

export interface AccountConsoleRouterServices {
  readonly account: ConsoleAccountService;
  readonly accountPlatform: D1AccountPlatformService;
  readonly audit: ConsoleAuditService;
  readonly billing: ConsoleBillingService;
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
  readonly corsOrigins?: readonly (string | undefined)[];
  readonly logger?: RouterLogger;
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
  handleAccountConsoleBilling,
] as const;

function corsResponse(
  response: Response,
  request: Request,
  origins: readonly (string | undefined)[],
): Response {
  const allowedOrigins = origins.flatMap(splitCorsOrigins);
  const requestOrigin = request.headers.get('Origin');
  const normalizedOrigin = normalizeCorsOrigin(requestOrigin ?? undefined);
  if (allowedOrigins.includes('*')) {
    response.headers.set('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
    response.headers.set('Access-Control-Allow-Origin', requestOrigin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.append('Vary', 'Origin');
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Console-Org-Id,X-Console-User-Id,X-Console-Roles,X-Console-Project-Id',
  );
  return response;
}

function splitCorsOrigins(input: string | undefined): string[] {
  const origins: string[] = [];
  for (const part of (input ?? '').split(',')) {
    if (part.trim() === '*') origins.push('*');
    else {
      const origin = normalizeCorsOrigin(part.trim());
      if (origin) origins.push(origin);
    }
  }
  return origins;
}

async function routeAccountRequest(
  options: AccountConsoleRouterOptions,
  request: Request,
): Promise<Response> {
  if (request.method.toUpperCase() === 'OPTIONS') {
    return corsResponse(new Response(null, { status: 204 }), request, options.corsOrigins ?? []);
  }
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
  };
  try {
    for (const handle of ACCOUNT_HANDLERS) {
      const response = await handle(context);
      if (response) return corsResponse(response, request, options.corsOrigins ?? []);
    }
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
