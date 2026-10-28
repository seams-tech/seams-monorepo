import {
  FundsTerminalDeliveryV1,
  MarkFundsIndeterminateRequestV1,
  PlatformUsageEventV1,
  ReserveFundsRequestV1,
  ServiceEligibilityRequestV1,
  ServiceIdentityLinkRequestV1,
  type PlatformResult,
} from '@seams-internal/console-shared/accountPlatform';
import {
  contractResult,
  exactKeys,
  object,
  textValue,
  versionOne,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import {
  createConsoleProviderIdentity,
  type ConsoleProviderIdentity,
} from '../boundary/providerIdentity';
import { billingCanonicalDigest } from '../billing/pricing';
import type { D1BillingUsageService } from '../billing/usage';
import { fundsChargeId } from '../billingPrepaidReservations/d1';
import type { ConsoleBillingPrepaidReservationService } from '../billingPrepaidReservations/service';
import {
  isConsoleOrganizationAccessError,
  parseInviteOrganizationMemberRequest,
} from '../teamRbac';
import { json, readJson } from '../router/cloudflare/http';
import type { D1AccountServiceAccess } from './serviceAccess';
import type { AccountAutomationGrantChangeV1 } from './serviceAccess';
import type { D1AccountMembershipFacade } from './membershipFacade';
import type { AuthenticatedAccountServiceProducerV1 } from './serviceIngressAuth';

export interface AccountPlatformServiceIngressOptions {
  readonly producer: AuthenticatedAccountServiceProducerV1;
  readonly access: D1AccountServiceAccess;
  readonly memberships: D1AccountMembershipFacade;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billingUsage: D1BillingUsageService;
  readonly googleIdentityFetch?: typeof fetch;
  readonly now?: () => Date;
}

export type AccountPlatformServiceIngressHandler = (request: Request) => Promise<Response | null>;

function now(): Date {
  return new Date();
}

function response(body: unknown, status = 200): Response {
  return json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function rejected(code: string, status: number): Response {
  return response({ kind: 'rejected', error: { code } }, status);
}

function unavailable(): Response {
  return response(
    { kind: 'rejected', error: { code: 'authority_unavailable', retryable: true } },
    503,
  );
}

function resultResponse<T, E extends { readonly code: string }>(
  result: PlatformResult<T, E>,
): Response {
  if (result.kind === 'accepted') return response(result);
  switch (result.error.code) {
    case 'authority_unavailable':
      return response(result, 503);
    case 'scope_forbidden':
    case 'membership_ineligible':
    case 'instance_ineligible':
      return response(result, 403);
    case 'insufficient_funds':
      return response(result, 402);
    default:
      return response(result, 409);
  }
}

function readInstanceBody(input: unknown): { readonly instanceId: string } {
  const record = object(input, 'body');
  exactKeys(record, ['version', 'instanceId']);
  versionOne(record.version);
  return { instanceId: textValue(record.instanceId, 'instanceId') };
}

function readStatusBody(input: unknown): { readonly reservationId: string } {
  const record = object(input, 'body');
  exactKeys(record, ['version', 'reservationId']);
  versionOne(record.version);
  return { reservationId: textValue(record.reservationId, 'reservationId') };
}

function readMembershipBody(input: unknown): {
  readonly instanceId: string;
  readonly membershipId: string;
} {
  const record = object(input, 'body');
  exactKeys(record, ['version', 'instanceId', 'membershipId']);
  versionOne(record.version);
  return {
    instanceId: textValue(record.instanceId, 'instanceId'),
    membershipId: textValue(record.membershipId, 'membershipId'),
  };
}

function readInvitationBody(input: unknown): {
  readonly instanceId: string;
  readonly invitation: ReturnType<typeof parseInviteOrganizationMemberRequest>;
} {
  const record = object(input, 'body');
  exactKeys(record, ['version', 'instanceId', 'invitation']);
  versionOne(record.version);
  return {
    instanceId: textValue(record.instanceId, 'instanceId'),
    invitation: parseInviteOrganizationMemberRequest(record.invitation),
  };
}

function readInvitationAcceptanceBody(input: unknown): {
  readonly instanceId: string;
  readonly invitationId: string;
  readonly token: string;
} {
  const record = object(input, 'body');
  exactKeys(record, ['version', 'instanceId', 'invitationId', 'token']);
  versionOne(record.version);
  return {
    instanceId: textValue(record.instanceId, 'instanceId'),
    invitationId: textValue(record.invitationId, 'invitationId'),
    token: textValue(record.token, 'token'),
  };
}

function readInvitationRevokeBody(input: unknown): {
  readonly instanceId: string;
  readonly invitationId: string;
} {
  const record = object(input, 'body');
  exactKeys(record, ['version', 'instanceId', 'invitationId']);
  versionOne(record.version);
  return {
    instanceId: textValue(record.instanceId, 'instanceId'),
    invitationId: textValue(record.invitationId, 'invitationId'),
  };
}

function readInstanceAccessBody(input: unknown): {
  readonly instanceId: string;
  readonly membershipId: string;
  readonly access: 'allowed' | 'revoked';
} {
  const record = object(input, 'body');
  exactKeys(record, ['version', 'instanceId', 'membershipId', 'access']);
  versionOne(record.version);
  if (record.access !== 'allowed' && record.access !== 'revoked')
    throw new Error('Invalid instance access');
  return {
    instanceId: textValue(record.instanceId, 'instanceId'),
    membershipId: textValue(record.membershipId, 'membershipId'),
    access: record.access,
  };
}

function readAutomationGrantBody(input: unknown): AccountAutomationGrantChangeV1 {
  const record = object(input, 'body');
  exactKeys(record, [
    'version',
    'instanceId',
    'automationId',
    'grantId',
    'nativePrincipalId',
    'access',
    'expectedAccessRevision',
  ]);
  versionOne(record.version);
  if (record.access !== 'allowed' && record.access !== 'revoked')
    throw new Error('Invalid automation access');
  if (
    !Number.isSafeInteger(record.expectedAccessRevision) ||
    typeof record.expectedAccessRevision !== 'number' ||
    record.expectedAccessRevision < 0
  )
    throw new Error('Invalid expected automation access revision');
  return {
    instanceId: textValue(record.instanceId, 'instanceId'),
    automationId: textValue(record.automationId, 'automationId'),
    grantId: textValue(record.grantId, 'grantId'),
    nativePrincipalId: textValue(record.nativePrincipalId, 'nativePrincipalId'),
    access: record.access,
    expectedAccessRevision: record.expectedAccessRevision,
  };
}

function badBody<E>(parsed: { readonly kind: 'rejected'; readonly error: E }): Response {
  return response({ kind: 'rejected', error: { code: 'invalid_body', detail: parsed.error } }, 400);
}

class AccountPlatformServiceIngress {
  private readonly clock: () => Date;
  private readonly providers = new Map<string, ConsoleProviderIdentity>();

  constructor(private readonly options: AccountPlatformServiceIngressOptions) {
    this.clock = options.now ?? now;
  }

  private provider(clientId: string): ConsoleProviderIdentity {
    const existing = this.providers.get(clientId);
    if (existing) return existing;
    const provider = createConsoleProviderIdentity({
      googleOidcClientId: clientId,
      fetchImpl: this.options.googleIdentityFetch,
    });
    this.providers.set(clientId, provider);
    return provider;
  }

  async fetch(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith('/account-platform/v1/')) return null;
    if (request.method !== 'POST') return rejected('method_not_allowed', 405);
    try {
      const producer = this.options.producer;
      const body = await readJson(request);
      switch (pathname) {
        case '/account-platform/v1/funds/reserve': {
          const parsed = ReserveFundsRequestV1.parse(body);
          if (parsed.kind === 'rejected') return badBody(parsed);
          return resultResponse(await this.options.funds.reserve(producer.authority, parsed.value));
        }
        case '/account-platform/v1/funds/status': {
          const parsed = contractResult(readStatusBody, body);
          if (parsed.kind === 'rejected') return badBody(parsed);
          return resultResponse(
            await this.options.funds.getReservation(producer.authority, parsed.value.reservationId),
          );
        }
        case '/account-platform/v1/funds/indeterminate': {
          const parsed = MarkFundsIndeterminateRequestV1.parse(body);
          if (parsed.kind === 'rejected') return badBody(parsed);
          return resultResponse(
            await this.options.funds.markIndeterminate(producer.authority, parsed.value, {
              statements: [],
            }),
          );
        }
        case '/account-platform/v1/funds/settle':
        case '/account-platform/v1/funds/release':
        case '/account-platform/v1/funds/reconcile':
          return await this.terminalFunds(producer, pathname, body);
        case '/account-platform/v1/usage': {
          const parsed = PlatformUsageEventV1.parse(body);
          if (parsed.kind === 'rejected') return badBody(parsed);
          return resultResponse(
            await this.options.billingUsage.record(producer.authority, parsed.value),
          );
        }
        case '/account-platform/v1/fee-policy': {
          const parsed = contractResult(readInstanceBody, body);
          if (parsed.kind === 'rejected') return badBody(parsed);
          return resultResponse(
            await this.options.access.feePolicy(producer.authority, parsed.value.instanceId),
          );
        }
        default:
          return await this.userOperation(producer, request, pathname, body);
      }
    } catch (error) {
      if (isConsoleOrganizationAccessError(error)) {
        switch (error.status) {
          case 401:
          case 403:
          case 404:
            return rejected('scope_forbidden', 403);
          default:
            return rejected('operation_conflict', 409);
        }
      }
      return unavailable();
    }
  }

  private async terminalFunds(
    producer: AuthenticatedAccountServiceProducerV1,
    pathname: string,
    body: unknown,
  ): Promise<Response> {
    if (producer.authority.serviceId !== 'satyr') return rejected('scope_forbidden', 403);
    const parsed = FundsTerminalDeliveryV1.parse(body);
    if (parsed.kind === 'rejected') return badBody(parsed);
    const delivery = parsed.value;
    if (pathname !== `/account-platform/v1/funds/${delivery.terminal.kind}`)
      return rejected('invalid_body', 400);
    const reservation = await this.options.funds.getReservation(
      producer.authority,
      delivery.terminal.request.reservationId,
    );
    if (reservation.kind === 'rejected') return resultResponse(reservation);
    const transaction = {
      chargeId: fundsChargeId(reservation.value.reservationId),
      ledgerSourceEventId: `satyr_turn:${reservation.value.instanceId}:${reservation.value.executionId}`,
      occurredAt: delivery.occurredAt,
      resourceId: reservation.value.executionId,
      txOrExecutionRef: null,
      statements: [],
    };
    switch (delivery.terminal.kind) {
      case 'settle':
        return resultResponse(
          await this.options.funds.settle(
            producer.authority,
            delivery.terminal.request,
            transaction,
          ),
        );
      case 'release':
        return resultResponse(
          await this.options.funds.release(
            producer.authority,
            delivery.terminal.request,
            transaction,
          ),
        );
      case 'reconcile':
        return resultResponse(
          await this.options.funds.reconcile(
            producer.authority,
            delivery.terminal.request,
            transaction,
          ),
        );
    }
  }

  private async userOperation(
    producer: AuthenticatedAccountServiceProducerV1,
    request: Request,
    pathname: string,
    body: unknown,
  ): Promise<Response | null> {
    const verified = await producer.verifyUserAssertion(request, this.clock());
    if (verified.kind === 'rejected') return resultResponse(verified);
    const assertion = verified.value;
    switch (pathname) {
      case '/account-platform/v1/identity/link': {
        const parsed = ServiceIdentityLinkRequestV1.parse(body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        if (parsed.value.instanceId !== assertion.instanceId)
          return rejected('scope_forbidden', 403);
        const identity = await this.provider(producer.googleClientId).verifyGoogleLogin({
          idToken: parsed.value.googleIdToken,
        });
        if (!identity.ok)
          return identity.code === 'internal' || identity.code === 'not_configured'
            ? unavailable()
            : rejected('scope_forbidden', 403);
        const receiptId = `google:${await billingCanonicalDigest(parsed.value.googleIdToken)}`;
        return resultResponse(
          await this.options.access.linkGoogleIdentity(
            producer.authority,
            assertion,
            identity,
            receiptId,
          ),
        );
      }
      case '/account-platform/v1/identity/resolve': {
        const parsed = contractResult(readInstanceBody, body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        if (parsed.value.instanceId !== assertion.instanceId)
          return rejected('scope_forbidden', 403);
        return resultResponse(
          await this.options.access.resolveIdentity(producer.authority, assertion),
        );
      }
      case '/account-platform/v1/eligibility': {
        const parsed = ServiceEligibilityRequestV1.parse(body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        return resultResponse(
          await this.options.access.checkEligibility(producer.authority, assertion, parsed.value),
        );
      }
      case '/account-platform/v1/eligibility/current': {
        const parsed = ServiceEligibilityRequestV1.parse(body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        return resultResponse(
          await this.options.access.checkCurrentEligibility(
            producer.authority,
            assertion,
            parsed.value,
          ),
        );
      }
      case '/account-platform/v1/memberships/list': {
        const parsed = contractResult(readInstanceBody, body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        return resultResponse(
          await this.options.memberships.list(
            producer.authority,
            assertion,
            parsed.value.instanceId,
          ),
        );
      }
      case '/account-platform/v1/memberships/invite': {
        const parsed = contractResult(readInvitationBody, body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        return resultResponse(
          await this.options.memberships.invite(
            producer.authority,
            assertion,
            parsed.value.instanceId,
            parsed.value.invitation,
          ),
        );
      }
      case '/account-platform/v1/memberships/revoke': {
        const parsed = contractResult(readMembershipBody, body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        return resultResponse(
          await this.options.memberships.revoke(
            producer.authority,
            assertion,
            parsed.value.instanceId,
            parsed.value.membershipId,
          ),
        );
      }
      case '/account-platform/v1/invitations/accept': {
        const parsed = contractResult(readInvitationAcceptanceBody, body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        return resultResponse(
          await this.options.memberships.acceptInvitation(
            producer.authority,
            assertion,
            parsed.value.instanceId,
            parsed.value.invitationId,
            parsed.value.token,
          ),
        );
      }
      case '/account-platform/v1/invitations/revoke': {
        const parsed = contractResult(readInvitationRevokeBody, body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        return resultResponse(
          await this.options.memberships.revokeInvitation(
            producer.authority,
            assertion,
            parsed.value.instanceId,
            parsed.value.invitationId,
          ),
        );
      }
      case '/account-platform/v1/instance-access/set': {
        const parsed = contractResult(readInstanceAccessBody, body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        return resultResponse(
          await this.options.memberships.setInstanceAccess(
            producer.authority,
            assertion,
            parsed.value.instanceId,
            parsed.value.membershipId,
            parsed.value.access,
          ),
        );
      }
      case '/account-platform/v1/automation-grants/set': {
        const parsed = contractResult(readAutomationGrantBody, body);
        if (parsed.kind === 'rejected') return badBody(parsed);
        return resultResponse(
          await this.options.access.setAutomationGrant(producer.authority, assertion, parsed.value),
        );
      }
      default:
        return rejected('operation_unsupported', 404);
    }
  }
}

export function createAccountPlatformServiceIngress(
  options: AccountPlatformServiceIngressOptions,
): AccountPlatformServiceIngressHandler {
  const ingress = new AccountPlatformServiceIngress(options);
  return ingress.fetch.bind(ingress);
}
