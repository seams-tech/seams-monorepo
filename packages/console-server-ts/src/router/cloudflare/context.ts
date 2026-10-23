import type { ConsoleAccountService } from '../../account/service';
import type { ConsoleAuditService } from '../../audit/service';
import type { ConsoleBillingService } from '../../billing/service';
import type { ConsoleWebhookService } from '../../webhooks/service';
import type { D1AccountPlatformService } from '../../accountPlatform/d1';
import type { AccountServiceProvisioningAdapterV1 } from '../../accountPlatform/provisioning';
import {
  normalizeCorsOrigin,
  type NormalizedRouterLogger,
  type SessionAdapter,
} from '../../boundary';
import type { ConsoleOnboardingService } from '../../onboarding/service';
import type { ConsoleOrgProjectService } from '../../orgProjectEnv/service';
import type { ConsoleOrganizationAccessService } from '../../teamRbac';
import type { ConsoleAuthAdapter, ConsoleAuthClaims } from '../consoleAuth';
import type { ConsoleRouteDefinition } from '../consoleRouteDefinitions';

export interface AccountConsoleContext {
  readonly request: Request;
  readonly url: URL;
  readonly pathname: string;
  readonly method: string;
  readonly logger: NormalizedRouterLogger;
  readonly routeDefinitions: readonly ConsoleRouteDefinition[];
  readonly auth: ConsoleAuthAdapter | null;
  readonly session: SessionAdapter | null;
  readonly healthz: boolean;
  readonly readyz: boolean;
  readonly readyCheck: (() => Promise<void> | void) | null;
  readonly orgProjects: ConsoleOrgProjectService | null;
  readonly organizationAccess: ConsoleOrganizationAccessService | null;
  readonly account: ConsoleAccountService | null;
  readonly onboarding: ConsoleOnboardingService | null;
  readonly audit: ConsoleAuditService | null;
  readonly billing: ConsoleBillingService | null;
  readonly webhooks: ConsoleWebhookService | null;
  readonly billingStripeWebhookSigningSecret: string | null;
  readonly accountPlatform: D1AccountPlatformService | null;
  readonly walletProvisioning: AccountServiceProvisioningAdapterV1 | null;
  readonly satyrProvisioning: AccountServiceProvisioningAdapterV1 | null;
  readonly authorizeTenant: ((claims: ConsoleAuthClaims) => Response | null) | null;
  readonly waitUntil: ((work: Promise<unknown>) => void) | null;
  /** The calling Console's origin when it is on the explicit CORS list, for Stripe returns. */
  readonly consoleReturnOrigin: string | null;
  authClaims?: ConsoleAuthClaims;
}

/** A wildcard list trusts no origin as a return target. */
export function resolveConsoleReturnOrigin(
  request: Request,
  allowedOrigins: readonly string[] | '*',
): string | null {
  if (allowedOrigins === '*') return null;
  const origin = normalizeCorsOrigin(request.headers.get('Origin') ?? undefined);
  return origin && allowedOrigins.includes(origin) ? origin : null;
}
