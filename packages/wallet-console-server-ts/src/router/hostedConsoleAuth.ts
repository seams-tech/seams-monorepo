import type { CfExecutionContext, FetchHandler } from '@seams/wallet-server/cloud-host';
import { withConsoleCors } from '@seams-internal/console-server/router/cloudflare/cors';
import type { SessionAdapter } from '@seams-internal/console-server/boundary/session';
import {
  parseCreateConsoleAccountOrganizationRequest,
  isConsoleAccountError,
  type ConsoleAccountService,
  type ConsoleAccountIdentityContext,
} from '@seams-internal/console-server/account';
import type {
  ConsoleProviderIdentity,
  ConsoleGoogleLoginResult,
} from '@seams-internal/console-server/boundary/providerIdentity';
import { billingCanonicalDigest } from '@seams-internal/console-server/billing/pricing';
import { issueConsoleStepUpProviderEnrollmentProofV1 } from '../tenantRootSecurity/stepUpEnrollmentProof';
import {
  isConsoleOrganizationAccessError,
  parseRedeemOrganizationInvitationRequest,
  type ConsoleOrganizationAccessService,
} from '@seams-internal/console-server/teamRbac';

function normalizeString(input: unknown): string {
  return String(input ?? '').trim();
}

export type HostedConsoleIdentityPort = ConsoleProviderIdentity;

export type HostedConsoleProviderOptions = {
  readonly google:
    | { readonly configured: false }
    | { readonly configured: true; readonly clientId: string };
  readonly github:
    | { readonly configured: false }
    | {
        readonly configured: true;
        readonly clientId: string;
        readonly callbackUrl: string;
      };
};

type HostedConsoleLoginIdentity =
  | {
      readonly kind: 'google';
      readonly userId: string;
      readonly email: string;
      readonly name: string;
    }
  | {
      readonly kind: 'github';
      readonly userId: string;
      readonly email: string;
      readonly name: string;
    };

export interface HostedConsoleAuthHandlerOptions {
  readonly handler: FetchHandler;
  readonly identity: HostedConsoleIdentityPort;
  readonly recordVerifiedGoogleIdentity: (
    identity: Extract<ConsoleGoogleLoginResult, { readonly ok: true }>,
    verificationReceiptId: string,
  ) => Promise<void>;
  readonly providers: HostedConsoleProviderOptions;
  readonly session: SessionAdapter;
  readonly account: ConsoleAccountService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly corsOrigins: readonly string[];
}

function parseExactConsoleAuthBody(body: unknown, field: 'code' | 'idToken'): string | null {
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (Object.getPrototypeOf(body) !== Object.prototype && Object.getPrototypeOf(body) !== null)
  ) {
    return null;
  }
  const fields = new Map<string, unknown>(Object.entries(body));
  if (fields.size !== 1 || !fields.has(field)) return null;
  const value = fields.get(field);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

async function readJsonOrNull(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function normalizeConsoleLoginEmail(value: unknown): string {
  const email = normalizeString(value).toLowerCase();
  const separator = email.indexOf('@');
  if (
    separator <= 0 ||
    separator === email.length - 1 ||
    email.indexOf('@', separator + 1) !== -1 ||
    /\s/u.test(email)
  ) {
    return '';
  }
  return email;
}

function consoleAuthFailureStatus(code: string): 400 | 401 | 500 | 501 {
  switch (code) {
    case 'invalid_body':
      return 400;
    case 'internal':
      return 500;
    case 'not_configured':
    case 'unsupported':
      return 501;
    default:
      return 401;
  }
}

function consoleAuthJson(body: unknown, status: number, setCookie?: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (setCookie) headers.set('Set-Cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export class HostedConsoleAuthHandler {
  constructor(private readonly options: HostedConsoleAuthHandlerOptions) {}

  async fetch(request: Request, env?: object, ctx?: CfExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const invitation = pathname.match(
      /^\/console\/account\/invitations\/([^/]+)\/(accept|decline)$/,
    );
    if (
      request.method === 'OPTIONS' ||
      (!pathname.startsWith('/console/auth/') &&
        pathname !== '/console/account/organizations' &&
        !invitation)
    ) {
      return await this.options.handler(request, env, ctx);
    }

    let response: Response;
    try {
      if (invitation) {
        response = await this.handleInvitationRequest(
          request,
          decodeURIComponent(invitation[1]),
          invitation[2] === 'decline' ? 'decline' : 'accept',
        );
      } else if (pathname === '/console/account/organizations') {
        response = await this.handleIdentityOrganizationRequest(request, env, ctx);
      } else {
        response = await this.handleAuthRequest(request, pathname);
      }
    } catch (error: unknown) {
      response =
        isConsoleAccountError(error) || isConsoleOrganizationAccessError(error)
          ? consoleAuthJson({ ok: false, code: error.code, message: error.message }, error.status)
          : consoleAuthJson(
              { ok: false, code: 'internal', message: 'Console authentication failed' },
              500,
            );
    }
    withConsoleCors(response.headers, this.options.corsOrigins, request);
    return response;
  }

  private async handleAuthRequest(request: Request, pathname: string): Promise<Response> {
    if (request.method === 'POST' && pathname === '/console/auth/google/options') {
      return consoleAuthJson({ ok: true, ...this.options.providers.google }, 200);
    }
    if (request.method === 'POST' && pathname === '/console/auth/github/options') {
      return consoleAuthJson({ ok: true, ...this.options.providers.github }, 200);
    }
    if (request.method === 'GET' && pathname === '/console/auth/session') {
      const session = await this.readAccountSession(request);
      return session?.kind === 'console_identity_v1'
        ? consoleAuthJson({ ok: true, session: { kind: 'console_identity_v1' } }, 200)
        : consoleAuthJson({ ok: false, code: 'unauthorized', message: 'Sign in to continue' }, 401);
    }
    if (request.method !== 'POST') {
      return consoleAuthJson(
        { ok: false, code: 'method_not_allowed', message: 'Method not allowed' },
        405,
      );
    }
    if (pathname === '/console/auth/google') return await this.loginWithGoogle(request);
    if (pathname === '/console/auth/github') return await this.loginWithGithub(request);
    if (pathname === '/console/auth/revoke') {
      return consoleAuthJson(
        { ok: true, revoked: true },
        200,
        this.options.session.buildClearCookie(),
      );
    }
    return consoleAuthJson({ ok: false, code: 'not_found', message: 'Not Found' }, 404);
  }

  private async loginWithGoogle(request: Request): Promise<Response> {
    const idToken = parseExactConsoleAuthBody(await readJsonOrNull(request), 'idToken');
    if (!idToken) {
      return consoleAuthJson(
        {
          ok: false,
          code: 'invalid_body',
          message: 'Console Google login requires exact idToken',
        },
        400,
      );
    }
    const verified = await this.options.identity.verifyGoogleLogin({ idToken });
    if (!verified.ok) {
      return consoleAuthJson(
        { ok: false, code: verified.code, message: verified.message },
        consoleAuthFailureStatus(verified.code),
      );
    }
    const userId = normalizeString(verified.userId);
    if (
      verified.verified !== true ||
      verified.emailVerified !== true ||
      !userId ||
      !normalizeConsoleLoginEmail(verified.email)
    ) {
      return consoleAuthJson(
        { ok: false, code: 'not_verified', message: 'Google login could not be verified' },
        401,
      );
    }
    await this.options.recordVerifiedGoogleIdentity(
      verified,
      `google:${await billingCanonicalDigest(idToken)}`,
    );

    return await this.issueConsoleSession({
      kind: 'google',
      userId,
      email: normalizeConsoleLoginEmail(verified.email),
      name: normalizeString(verified.name) || userId,
    });
  }

  private async loginWithGithub(request: Request): Promise<Response> {
    const code = parseExactConsoleAuthBody(await readJsonOrNull(request), 'code');
    if (!code) {
      return consoleAuthJson(
        {
          ok: false,
          code: 'invalid_body',
          message: 'Console GitHub login requires exact code',
        },
        400,
      );
    }
    const verified = await this.options.identity.verifyGithubOAuthCode({ code });
    if (!verified.ok) {
      return consoleAuthJson(
        { ok: false, code: verified.code, message: verified.message },
        consoleAuthFailureStatus(verified.code),
      );
    }
    const userId = normalizeString(verified.userId);
    if (verified.verified !== true || !userId || !normalizeConsoleLoginEmail(verified.email)) {
      return consoleAuthJson(
        { ok: false, code: 'not_verified', message: 'GitHub login could not be verified' },
        401,
      );
    }

    return await this.issueConsoleSession({
      kind: 'github',
      userId,
      email: normalizeConsoleLoginEmail(verified.email),
      name: normalizeString(verified.name) || userId,
    });
  }

  private async issueConsoleSession(identity: HostedConsoleLoginIdentity): Promise<Response> {
    const account: ConsoleAccountIdentityContext = {
      userId: identity.userId,
      email: identity.email,
      name: identity.name,
      provider: identity.kind,
      orgId: null,
      projectId: null,
      platformSupport: false,
    };
    const organizations = await this.options.account.listOrganizations(account);
    const organization = organizations[0];
    const enrollmentProof = await issueConsoleStepUpProviderEnrollmentProofV1(
      this.options.session,
      account.userId,
    );
    if (organization) {
      const cookie = await this.organizationSessionCookie(account, organization.id);
      return consoleAuthJson(
        { ok: true, session: { kind: 'console_session_v1' }, enrollmentProof },
        200,
        cookie,
      );
    }
    const token = await this.options.session.signJwt(account.userId, {
      kind: 'console_identity_v1',
      email: account.email,
      name: account.name,
      provider: account.provider,
    });
    return consoleAuthJson(
      { ok: true, session: { kind: 'console_identity_v1' }, enrollmentProof },
      200,
      this.options.session.buildSetCookie(token),
    );
  }

  private async readAccountSession(request: Request): Promise<{
    readonly kind: 'console_identity_v1' | 'console_session_v1';
    readonly account: ConsoleAccountIdentityContext;
  } | null> {
    const parsed = await this.options.session.parse(Object.fromEntries(request.headers.entries()));
    if (!parsed.ok) return null;
    const kind = parsed.claims.kind;
    if (kind !== 'console_identity_v1' && kind !== 'console_session_v1') return null;
    if (kind === 'console_session_v1' && !normalizeString(parsed.claims.orgId)) return null;
    const userId = normalizeString(parsed.claims.sub);
    const email = normalizeConsoleLoginEmail(parsed.claims.email);
    const provider = parsed.claims.provider;
    if (!userId || !email || (provider !== 'google' && provider !== 'github')) return null;
    return {
      kind,
      account: {
        userId,
        email,
        name: normalizeString(parsed.claims.name),
        provider,
        orgId: null,
        projectId: null,
        platformSupport: false,
      },
    };
  }

  private async handleInvitationRequest(
    request: Request,
    invitationId: string,
    action: 'accept' | 'decline',
  ): Promise<Response> {
    if (request.method !== 'POST') {
      return consoleAuthJson(
        { ok: false, code: 'method_not_allowed', message: 'Invitation redemption requires POST' },
        405,
      );
    }
    const session = await this.readAccountSession(request);
    if (!session) {
      return consoleAuthJson(
        { ok: false, code: 'unauthorized', message: 'Sign in to continue' },
        401,
      );
    }
    const input = parseRedeemOrganizationInvitationRequest(await readJsonOrNull(request));
    const verifiedAccount = {
      userId: session.account.userId,
      verifiedEmail: session.account.email,
    };
    if (action === 'decline') {
      const invitation = await this.options.organizationAccess.declineInvitation(
        verifiedAccount,
        invitationId,
        input,
      );
      return consoleAuthJson({ ok: true, invitation }, 200);
    }
    const membership = await this.options.organizationAccess.acceptInvitation(
      verifiedAccount,
      invitationId,
      input,
    );
    const cookie = await this.organizationSessionCookie(session.account, membership.orgId);
    return consoleAuthJson({ ok: true, membership }, 200, cookie);
  }

  private async handleIdentityOrganizationRequest(
    request: Request,
    env?: object,
    ctx?: CfExecutionContext,
  ): Promise<Response> {
    const session = await this.readAccountSession(request);
    if (session?.kind !== 'console_identity_v1') return this.options.handler(request, env, ctx);
    const account = session.account;
    if (request.method === 'GET') {
      const organizations = await this.options.account.listOrganizations(account);
      return consoleAuthJson({ ok: true, organizations }, 200);
    }
    if (request.method !== 'POST')
      return consoleAuthJson(
        { ok: false, code: 'method_not_allowed', message: 'Method not allowed' },
        405,
      );
    try {
      const input = parseCreateConsoleAccountOrganizationRequest(await readJsonOrNull(request));
      const organization = await this.options.account.createOrganization(account, input);
      return this.issueOrganizationSession(account, organization.id);
    } catch (error: unknown) {
      if (isConsoleAccountError(error))
        return consoleAuthJson(
          { ok: false, code: error.code, message: error.message },
          error.status,
        );
      throw error;
    }
  }

  private async issueOrganizationSession(
    account: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<Response> {
    const cookie = await this.organizationSessionCookie(account, orgId);
    return consoleAuthJson({ ok: true, session: { kind: 'console_session_v1' } }, 200, cookie);
  }

  private async organizationSessionCookie(
    account: ConsoleAccountIdentityContext,
    orgId: string,
  ): Promise<string> {
    const scope = await this.options.account.switchOrganizationContext(account, orgId);
    const token = await this.options.session.signJwt(account.userId, {
      kind: 'console_session_v1',
      orgId: scope.orgId,
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      provider: account.provider,
      email: account.email,
      name: account.name,
    });
    return this.options.session.buildSetCookie(token);
  }
}
