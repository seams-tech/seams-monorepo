import type { ConsoleAccountContext, ConsoleAccountService } from '../../account/service';
import { isConsoleAccountError } from '../../account/errors';
import {
  parseCreateConsoleAccountOrganizationRequest,
  parsePatchConsoleAccountProfileRequest,
  parseUpdateConsoleAccountOrganizationRequest,
} from '../../account/requests';
import type { ConsoleOnboardingContext, ConsoleOnboardingService } from '../../onboarding/service';
import { isConsoleOnboardingError } from '../../onboarding/errors';
import {
  parseCreateConsoleOnboardingOrganizationRequest,
  parseCreateConsoleOnboardingProjectRequest,
  parseGetConsoleOnboardingStateRequest,
  parseGetConsoleOnboardingTelemetryRequest,
} from '../../onboarding/requests';
import {
  isConsoleOrganizationAccessError,
  parseChangeOrganizationMembershipRoleRequest,
  parseInviteOrganizationMemberRequest,
  parseListOrganizationInvitationsRequest,
  parseListOrganizationMembershipsRequest,
  parseRedeemOrganizationInvitationRequest,
  parseSetOrganizationAdminPermissionsRequest,
  parseSetProjectMemberAccessRequest,
} from '../../teamRbac';
import type { ConsoleOrganizationAccessService } from '../../teamRbac';
import { isConsoleOrgProjectError } from '../../orgProjectEnv/errors';
import {
  parseCreateConsoleProjectRequest,
  parseListConsoleProjectsRequest,
  parseUpdateConsoleProjectRequest,
} from '../../orgProjectEnv/requests';
import {
  authenticateConsoleRequest,
  type ConsoleAuthClaims,
  type ConsoleAuthResult,
} from '../consoleAuth';
import { authorizeConsoleRouteRequest, hasConsoleProjectAccess } from '../consoleRoutePolicy';
import {
  buildConsoleContextSwitchSessionClaims,
  parseConsoleSessionForContextSwitch,
} from '../consoleSessionContext';
import type { AccountConsoleContext } from './context';
import { headersToRecord, json, readJson } from './http';
import type { SessionAdapter } from '../../boundary';
import type { ConsoleAuditCategory } from '../../audit/types';

export function requireConsoleRoutePolicy(
  ctx: AccountConsoleContext,
  claims: ConsoleAuthClaims,
): Response | null {
  const authz = authorizeConsoleRouteRequest({
    claims,
    definitions: ctx.routeDefinitions,
    method: ctx.method,
    pathname: ctx.pathname,
    projectId: ctx.url.searchParams.get('projectId') || claims.projectId,
  });
  if (authz.ok) return null;
  return json(authz.body, { status: authz.status });
}

export async function requireConsoleAuth(
  ctx: AccountConsoleContext,
): Promise<{ ok: true; claims: ConsoleAuthClaims } | { ok: false; response: Response }> {
  const auth = await authenticateConsoleRequest(headersToRecord(ctx.request.headers), ctx.auth);
  if (!auth.ok) {
    return { ok: false, response: sendAuthFailure(auth) };
  }
  const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
  if (routePolicy) return { ok: false, response: routePolicy };
  ctx.authClaims = auth.claims;
  const routeResolutionFailure = ctx.authorizeTenant ? ctx.authorizeTenant(auth.claims) : null;
  if (routeResolutionFailure) {
    return { ok: false, response: routeResolutionFailure };
  }
  return { ok: true, claims: auth.claims };
}

function sendAuthFailure(auth: Extract<ConsoleAuthResult, { ok: false }>): Response {
  return json(
    {
      ok: false,
      code: auth.code,
      message: auth.message,
    },
    { status: auth.status },
  );
}

function sendOrgProjectError(error: unknown): Response {
  if (isConsoleOrgProjectError(error)) {
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

function sendOrganizationAccessError(error: unknown): Response {
  if (isConsoleOrganizationAccessError(error)) {
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

export function sendOnboardingError(error: unknown): Response {
  if (isConsoleOnboardingError(error)) {
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

function sendAccountError(error: unknown): Response {
  if (isConsoleAccountError(error)) {
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

function requireOrganizationAccessService(
  ctx: AccountConsoleContext,
): ConsoleOrganizationAccessService | Response {
  if (ctx.organizationAccess) return ctx.organizationAccess;
  return json(
    {
      ok: false,
      code: 'organization_access_not_configured',
      message: 'Organization access service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireOnboardingService(ctx: AccountConsoleContext): ConsoleOnboardingService | Response {
  if (ctx.onboarding) return ctx.onboarding;
  return json(
    {
      ok: false,
      code: 'onboarding_not_configured',
      message: 'Onboarding service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireAccountService(ctx: AccountConsoleContext): ConsoleAccountService | Response {
  if (ctx.account) return ctx.account;
  return json(
    {
      ok: false,
      code: 'account_not_configured',
      message: 'Account service is not configured on this server',
    },
    { status: 501 },
  );
}

function requireSessionAdapter(ctx: AccountConsoleContext): SessionAdapter | Response {
  if (ctx.session) return ctx.session;
  return json(
    {
      ok: false,
      code: 'session_not_configured',
      message: 'Session adapter is not configured on this server',
    },
    { status: 501 },
  );
}

function toOrganizationAccessContext(claims: ConsoleAuthClaims): {
  orgId: string;
  actorUserId: string;
} {
  return {
    orgId: claims.orgId,
    actorUserId: claims.userId,
  };
}

async function bindCreatedProjectBilling(
  ctx: AccountConsoleContext,
  claims: ConsoleAuthClaims,
  projectId: string,
): Promise<Response | null> {
  if (!ctx.accountPlatform) return null;
  const binding = await ctx.accountPlatform.bindProjectBilling(
    { orgId: claims.orgId, actorUserId: claims.userId },
    projectId,
  );
  if (binding.kind === 'accepted') return null;
  return json({ ok: false, code: binding.error.code }, { status: 409 });
}

function consoleClaimsEmail(claims: ConsoleAuthClaims): string {
  const claimed = String(claims.email ?? '')
    .trim()
    .toLowerCase();
  if (claimed) return claimed;
  const emailUser = claims.userId.toLowerCase().replace(/[^a-z0-9._+-]/gu, '_');
  return `${emailUser || 'user'}@console.local`;
}

function toOnboardingContext(claims: ConsoleAuthClaims): ConsoleOnboardingContext {
  return {
    orgId: claims.orgId,
    actorUserId: claims.userId,
    actorEmail: consoleClaimsEmail(claims),
    actorDisplayName: String(claims.name ?? '').trim() || null,
    projectId: claims.projectId ?? null,
  };
}

function toAccountContext(claims: ConsoleAuthClaims): ConsoleAccountContext {
  const identity = {
    userId: claims.userId,
    orgId: claims.orgId,
    email: consoleClaimsEmail(claims),
    name: String(claims.name ?? '').trim() || null,
    provider: String(claims.provider ?? '').trim() || null,
    projectId: claims.projectId ?? null,
    platformSupport: claims.platformSupport,
    membershipId: claims.membershipId,
    authorizationVersion: claims.authorizationVersion,
  };
  switch (claims.role) {
    case 'OWNER':
      return {
        ...identity,
        role: 'OWNER',
        adminPermissions: [...claims.adminPermissions],
        projectAccess: { kind: 'all' },
      };
    case 'ADMIN':
      return {
        ...identity,
        role: 'ADMIN',
        adminPermissions: [...claims.adminPermissions],
        projectAccess: { kind: 'all' },
      };
    case 'MEMBER':
      return {
        ...identity,
        role: 'MEMBER',
        adminPermissions: [],
        projectAccess: {
          kind: 'assigned',
          assignments: claims.projectAccess.assignments.map((assignment) => ({
            projectId: assignment.projectId,
            accessLevel: assignment.accessLevel,
          })),
        },
      };
  }
}

export function decodePathPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export async function handleConsoleHealth(ctx: AccountConsoleContext): Promise<Response | null> {
  if (!ctx.healthz || ctx.method !== 'GET' || ctx.pathname !== '/console/healthz') return null;

  return json(
    {
      ok: true,
      service: 'console',
    },
    { status: 200 },
  );
}

export async function handleConsoleReady(ctx: AccountConsoleContext): Promise<Response | null> {
  if (!ctx.readyz || ctx.method !== 'GET' || ctx.pathname !== '/console/readyz') return null;
  try {
    if (ctx.readyCheck) {
      await ctx.readyCheck();
    }
    return json(
      {
        ok: true,
        service: 'console',
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    return json(
      {
        ok: false,
        code: 'console_not_ready',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}

export async function handleConsoleSession(ctx: AccountConsoleContext): Promise<Response | null> {
  if (ctx.method !== 'GET' || ctx.pathname !== '/console/session') return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  return json(
    {
      ok: true,
      claims: auth.claims,
    },
    { status: 200 },
  );
}

export async function handleConsoleAccount(ctx: AccountConsoleContext): Promise<Response | null> {
  if (!isConsoleAccountPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const accountOrResponse = requireAccountService(ctx);
  if (accountOrResponse instanceof Response) return accountOrResponse;
  const account = accountOrResponse;

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/account/profile') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const profile = await account.getProfile(toAccountContext(auth.claims));
      return json({ ok: true, profile }, { status: 200 });
    }

    if (ctx.method === 'PATCH' && ctx.pathname === '/console/account/profile') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parsePatchConsoleAccountProfileRequest(await readJson(ctx.request));
      const profile = await account.updateProfile(toAccountContext(auth.claims), request);
      return json({ ok: true, profile }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/account/organizations') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const organizations = await account.listOrganizations(toAccountContext(auth.claims));
      return json({ ok: true, organizations }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/account/organizations') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseCreateConsoleAccountOrganizationRequest(await readJson(ctx.request));
      const organization = await account.createOrganization(toAccountContext(auth.claims), request);
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'ORG_PROJECT_ENV',
        action: 'organization.create',
        summary: `Created organization ${organization.name || organization.id} from account settings`,
        metadata: {
          organizationId: organization.id,
          organizationName: organization.name,
          organizationSlug: organization.slug,
          source: 'account_settings',
        },
      });
      return json({ ok: true, organization }, { status: 201 });
    }

    const orgMatch = ctx.pathname.match(
      /^\/console\/account\/organizations\/([^/]+?)(?:\/(switch-context))?$/,
    );
    const orgId = orgMatch?.[1] ? decodePathPart(orgMatch[1]) : '';
    const action = String(orgMatch?.[2] || '').trim();

    if (!orgId) {
      return new Response('Not Found', { status: 404 });
    }

    if (ctx.method === 'PATCH' && !action) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseUpdateConsoleAccountOrganizationRequest(await readJson(ctx.request));
      const organization = await account.updateOrganization(
        toAccountContext(auth.claims),
        orgId,
        request,
      );
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'ORG_PROJECT_ENV',
        action: 'organization.update',
        summary: `Updated organization ${organization.name || organization.id} from account settings`,
        metadata: {
          organizationId: organization.id,
          organizationName: organization.name,
          organizationSlug: organization.slug,
          source: 'account_settings',
        },
      });
      return json({ ok: true, organization }, { status: 200 });
    }

    if (ctx.method === 'DELETE' && !action) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const deleted = await account.deleteOrganization(toAccountContext(auth.claims), orgId);
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'ORG_PROJECT_ENV',
        action: 'organization.delete',
        summary: `Deleted organization ${deleted.organizationName || deleted.orgId} from account settings`,
        metadata: {
          organizationId: deleted.orgId,
          organizationName: deleted.organizationName,
          source: 'account_settings',
        },
      });
      return json({ ok: true, deleted }, { status: 200 });
    }

    if (ctx.method === 'POST' && action === 'switch-context') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const sessionOrResponse = requireSessionAdapter(ctx);
      if (sessionOrResponse instanceof Response) return sessionOrResponse;
      const session = sessionOrResponse;
      const nextContext = await account.switchOrganizationContext(
        toAccountContext(auth.claims),
        orgId,
      );
      const parsedSession = await parseConsoleSessionForContextSwitch(
        session,
        headersToRecord(ctx.request.headers),
      );
      if (!parsedSession) {
        return json(
          {
            ok: false,
            code: 'unauthorized',
            message: 'A valid app session is required to switch organization context',
          },
          { status: 401 },
        );
      }
      const jwt = await session.signJwt(
        parsedSession.userId,
        buildConsoleContextSwitchSessionClaims(parsedSession.claims, nextContext),
      );
      return json(
        { ok: true, context: nextContext },
        {
          status: 200,
          headers: { 'Set-Cookie': session.buildSetCookie(jwt) },
        },
      );
    }
  } catch (error: unknown) {
    return sendAccountError(error);
  }

  return new Response('Not Found', { status: 404 });
}

export async function handleConsoleOnboarding(
  ctx: AccountConsoleContext,
): Promise<Response | null> {
  if (!isConsoleOnboardingPath(ctx.pathname)) return null;
  if (ctx.pathname === '/console/onboarding/project' && ctx.method !== 'POST') {
    return json(
      { ok: false, code: 'method_not_allowed', message: 'Project creation requires POST' },
      { status: 405, headers: { Allow: 'POST' } },
    );
  }

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const onboardingOrResponse = requireOnboardingService(ctx);
  if (onboardingOrResponse instanceof Response) return onboardingOrResponse;
  const onboarding = onboardingOrResponse;

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/onboarding/state') {
      const request = parseGetConsoleOnboardingStateRequest({});
      const state = await onboarding.getOnboardingState(toOnboardingContext(auth.claims), request);
      return json({ ok: true, state }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/onboarding/telemetry') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseGetConsoleOnboardingTelemetryRequest({
        windowMinutes: ctx.url.searchParams.get('windowMinutes') || undefined,
      });
      const telemetry = await onboarding.getOnboardingTelemetry(
        toOnboardingContext(auth.claims),
        request,
      );
      return json({ ok: true, telemetry }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/onboarding/organization') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseCreateConsoleOnboardingOrganizationRequest(await readJson(ctx.request));
      const result = await onboarding.createOnboardingOrganization(
        toOnboardingContext(auth.claims),
        request,
      );
      if (result.created.owner) {
        await emitConsoleAuditEvent(ctx, auth.claims, {
          category: 'TEAM',
          action: 'member.owner.bootstrap',
          summary: `Bootstrapped owner membership for user ${auth.claims.userId} during onboarding organization step`,
          metadata: {
            onboarding: true,
            onboardingStep: 'organization',
            userId: auth.claims.userId,
          },
        });
      }
      await emitConsoleAuditEvent(ctx, auth.claims, {
        category: 'ORG_PROJECT_ENV',
        action: 'organization.configure',
        summary: `Configured organization ${result.organization.id} via onboarding organization step`,
        metadata: {
          onboarding: true,
          onboardingStep: 'organization',
          organizationId: result.organization.id,
          organizationName: result.organization.name,
          organizationSlug: result.organization.slug,
          created: result.created.organization,
        },
      });
      const status = result.created.organization || result.created.owner ? 201 : 200;
      return json({ ok: true, result }, { status });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/onboarding/project') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseCreateConsoleOnboardingProjectRequest(await readJson(ctx.request));
      const result = await onboarding.createOnboardingProject(
        toOnboardingContext(auth.claims),
        request,
      );
      const billingFailure = await bindCreatedProjectBilling(ctx, auth.claims, result.project.id);
      if (billingFailure) return billingFailure;
      if (result.created.project) {
        await emitConsoleAuditEvent(ctx, auth.claims, {
          category: 'ORG_PROJECT_ENV',
          action: 'project.create',
          summary: `Created project ${result.project.id} via onboarding project step`,
          projectId: result.project.id,
          metadata: {
            onboarding: true,
            projectId: result.project.id,
            onboardingStep: 'project',
          },
        });
      }
      const status = result.created.project ? 201 : 200;
      return json({ ok: true, result }, { status });
    }
  } catch (error: unknown) {
    return sendOnboardingError(error);
  }

  return new Response('Not Found', { status: 404 });
}

function isConsoleAccountPath(pathname: string): boolean {
  return (
    pathname === '/console/account/profile' || pathname.startsWith('/console/account/organizations')
  );
}

function isConsoleOnboardingPath(pathname: string): boolean {
  return (
    pathname === '/console/onboarding/state' ||
    pathname === '/console/onboarding/telemetry' ||
    pathname === '/console/onboarding/organization' ||
    pathname === '/console/onboarding/project'
  );
}

function isConsoleOrganizationAccessPath(pathname: string): boolean {
  return (
    pathname === '/console/organization/memberships' ||
    pathname === '/console/organization/invitations' ||
    pathname === '/console/organization/leave' ||
    pathname.startsWith('/console/organization/memberships/') ||
    pathname.startsWith('/console/organization/invitations/') ||
    pathname.startsWith('/console/organization/projects/') ||
    pathname.startsWith('/console/account/invitations/')
  );
}

function verifiedInvitationAccountOrResponse(
  claims: ConsoleAuthClaims,
): { userId: string; verifiedEmail: string } | Response {
  const verifiedEmail = String(claims.email ?? '')
    .trim()
    .toLowerCase();
  if (!verifiedEmail) {
    return json(
      {
        ok: false,
        code: 'verified_email_required',
        message: 'A verified account email is required to redeem an organization invitation',
      },
      { status: 403 },
    );
  }
  return { userId: claims.userId, verifiedEmail };
}

export async function handleConsoleOrganizationAccess(
  ctx: AccountConsoleContext,
): Promise<Response | null> {
  if (!isConsoleOrganizationAccessPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const organizationAccessOrResponse = requireOrganizationAccessService(ctx);
  if (organizationAccessOrResponse instanceof Response) return organizationAccessOrResponse;
  const organizationAccess = organizationAccessOrResponse;
  const accessContext = toOrganizationAccessContext(auth.claims);
  const query = Object.fromEntries(ctx.url.searchParams.entries());

  const invitationResendMatch = ctx.pathname.match(
    /^\/console\/organization\/invitations\/([^/]+)\/resend$/,
  );
  const invitationMatch = ctx.pathname.match(/^\/console\/organization\/invitations\/([^/]+)$/);
  const invitationRedemptionMatch = ctx.pathname.match(
    /^\/console\/account\/invitations\/([^/]+)\/(accept|decline)$/,
  );
  const membershipActionMatch = ctx.pathname.match(
    /^\/console\/organization\/memberships\/([^/]+)\/(change-role|admin-permissions|suspend|reactivate)$/,
  );
  const membershipMatch = ctx.pathname.match(/^\/console\/organization\/memberships\/([^/]+)$/);
  const projectMemberMatch = ctx.pathname.match(
    /^\/console\/organization\/projects\/([^/]+)\/members\/([^/]+)$/,
  );

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/organization/memberships') {
      const memberships = await organizationAccess.listMemberships(
        accessContext,
        parseListOrganizationMembershipsRequest(query),
      );
      return json({ ok: true, memberships }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/organization/invitations') {
      const invitations = await organizationAccess.listInvitations(
        accessContext,
        parseListOrganizationInvitationsRequest(query),
      );
      return json({ ok: true, invitations }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/organization/invitations') {
      const issued = await organizationAccess.invite(
        accessContext,
        parseInviteOrganizationMemberRequest(await readJson(ctx.request)),
      );
      return json({ ok: true, invitation: issued.invitation }, { status: 201 });
    }

    if (ctx.method === 'POST' && invitationResendMatch?.[1]) {
      const issued = await organizationAccess.resendInvitation(
        accessContext,
        decodePathPart(invitationResendMatch[1]),
      );
      return json({ ok: true, invitation: issued.invitation }, { status: 200 });
    }

    if (ctx.method === 'DELETE' && invitationMatch?.[1]) {
      const invitation = await organizationAccess.revokeInvitation(
        accessContext,
        decodePathPart(invitationMatch[1]),
      );
      return json({ ok: true, invitation }, { status: 200 });
    }

    if (ctx.method === 'POST' && invitationRedemptionMatch?.[1]) {
      const account = verifiedInvitationAccountOrResponse(auth.claims);
      if (account instanceof Response) return account;
      const request = parseRedeemOrganizationInvitationRequest(await readJson(ctx.request));
      const invitationId = decodePathPart(invitationRedemptionMatch[1]);
      if (invitationRedemptionMatch[2] === 'accept') {
        const membership = await organizationAccess.acceptInvitation(
          account,
          invitationId,
          request,
        );
        return json({ ok: true, membership }, { status: 200 });
      }
      const invitation = await organizationAccess.declineInvitation(account, invitationId, request);
      return json({ ok: true, invitation }, { status: 200 });
    }

    if (
      ctx.method === 'POST' &&
      membershipActionMatch?.[1] &&
      membershipActionMatch[2] === 'change-role'
    ) {
      const membership = await organizationAccess.changeRole(
        accessContext,
        decodePathPart(membershipActionMatch[1]),
        parseChangeOrganizationMembershipRoleRequest(await readJson(ctx.request)),
      );
      return json({ ok: true, membership }, { status: 200 });
    }

    if (
      ctx.method === 'PATCH' &&
      membershipActionMatch?.[1] &&
      membershipActionMatch[2] === 'admin-permissions'
    ) {
      const membership = await organizationAccess.setAdminPermissions(
        accessContext,
        decodePathPart(membershipActionMatch[1]),
        parseSetOrganizationAdminPermissionsRequest(await readJson(ctx.request)),
      );
      return json({ ok: true, membership }, { status: 200 });
    }

    if (
      ctx.method === 'POST' &&
      membershipActionMatch?.[1] &&
      membershipActionMatch[2] === 'suspend'
    ) {
      const membership = await organizationAccess.suspendMembership(
        accessContext,
        decodePathPart(membershipActionMatch[1]),
      );
      return json({ ok: true, membership }, { status: 200 });
    }

    if (
      ctx.method === 'POST' &&
      membershipActionMatch?.[1] &&
      membershipActionMatch[2] === 'reactivate'
    ) {
      const membership = await organizationAccess.reactivateMembership(
        accessContext,
        decodePathPart(membershipActionMatch[1]),
      );
      return json({ ok: true, membership }, { status: 200 });
    }

    if (ctx.method === 'DELETE' && membershipMatch?.[1]) {
      const membership = await organizationAccess.removeMembership(
        accessContext,
        decodePathPart(membershipMatch[1]),
      );
      return json({ ok: true, membership }, { status: 200 });
    }

    if (ctx.method === 'PUT' && projectMemberMatch?.[1] && projectMemberMatch[2]) {
      const membership = await organizationAccess.setProjectAccess(
        accessContext,
        decodePathPart(projectMemberMatch[1]),
        decodePathPart(projectMemberMatch[2]),
        parseSetProjectMemberAccessRequest(await readJson(ctx.request)),
      );
      return json({ ok: true, membership }, { status: 200 });
    }

    if (ctx.method === 'DELETE' && projectMemberMatch?.[1] && projectMemberMatch[2]) {
      const membership = await organizationAccess.removeProjectAccess(
        accessContext,
        decodePathPart(projectMemberMatch[1]),
        decodePathPart(projectMemberMatch[2]),
      );
      return json({ ok: true, membership }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/organization/leave') {
      const membership = await organizationAccess.leaveOrganization(accessContext);
      return json({ ok: true, membership }, { status: 200 });
    }
  } catch (error: unknown) {
    return sendOrganizationAccessError(error);
  }

  return new Response('Not Found', { status: 404 });
}

interface AccountAuditActorScope {
  readonly orgId: string;
  readonly userId: string;
  readonly projectId?: string;
  readonly environmentId?: string;
}

function toAuditContext(claims: AccountAuditActorScope): {
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

export async function emitConsoleAuditEvent(
  ctx: AccountConsoleContext,
  claims: AccountAuditActorScope,
  input: {
    category: ConsoleAuditCategory;
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

export async function handleConsoleProjects(ctx: AccountConsoleContext): Promise<Response | null> {
  if (
    ctx.pathname !== '/console/org' &&
    ctx.pathname !== '/console/projects' &&
    !ctx.pathname.startsWith('/console/projects/')
  )
    return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;

  const orgProjects = ctx.orgProjects;
  if (!orgProjects) {
    return json(
      {
        ok: false,
        code: 'org_projects_not_configured',
        message: 'Organization and project service is not configured on this server',
      },
      { status: 501 },
    );
  }
  const projectContext = { orgId: auth.claims.orgId, actorUserId: auth.claims.userId };
  const projectPatchMatch = ctx.pathname.match(/^\/console\/projects\/([^/]+)$/);
  const projectArchiveMatch = ctx.pathname.match(/^\/console\/projects\/([^/]+)\/archive$/);

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/org') {
      const org = await orgProjects.getOrganization(projectContext);
      return json({ ok: true, org }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/projects') {
      const request = parseListConsoleProjectsRequest({
        status: ctx.url.searchParams.get('status') || undefined,
      });
      const projects = await orgProjects.listProjects(projectContext, request);
      const visibleProjects = projects.filter((project) =>
        hasConsoleProjectAccess(auth.claims, project.id, 'viewer'),
      );
      return json({ ok: true, projects: visibleProjects }, { status: 200 });
    }

    if (ctx.method === 'POST' && ctx.pathname === '/console/projects') {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const request = parseCreateConsoleProjectRequest(await readJson(ctx.request));
      const project = await orgProjects.createProject(projectContext, request);
      const billingFailure = await bindCreatedProjectBilling(ctx, auth.claims, project.id);
      if (billingFailure) return billingFailure;
      return json({ ok: true, project }, { status: 201 });
    }

    if (ctx.method === 'PATCH' && projectPatchMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const projectId = decodePathPart(projectPatchMatch[1]);
      const request = parseUpdateConsoleProjectRequest(await readJson(ctx.request));
      const project = await orgProjects.updateProject(projectContext, projectId, request);
      if (!project) {
        return json(
          {
            ok: false,
            code: 'project_not_found',
            message: `Project ${projectId} was not found`,
          },
          { status: 404 },
        );
      }
      return json({ ok: true, project }, { status: 200 });
    }

    if (ctx.method === 'POST' && projectArchiveMatch) {
      const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
      if (routePolicy) return routePolicy;
      const projectId = decodePathPart(projectArchiveMatch[1]);
      const project = await orgProjects.archiveProject(projectContext, projectId);
      if (!project) {
        return json(
          {
            ok: false,
            code: 'project_not_found',
            message: `Project ${projectId} was not found`,
          },
          { status: 404 },
        );
      }
      return json({ ok: true, project }, { status: 200 });
    }
  } catch (error: unknown) {
    return sendOrgProjectError(error);
  }

  return new Response('Not Found', { status: 404 });
}
