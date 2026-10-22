import {
  CONSOLE_AUDIT_QUERY_CATEGORIES,
  parseCountConsoleAuditActivityRequest,
  parseListConsoleAuditEventsRequest,
  parseListConsoleAuditEvidenceRequest,
} from '../../audit/requests';
import { isConsoleAuditError } from '../../audit/errors';
import type { ConsoleAuditCategory, ConsoleAuditEvent } from '../../audit/types';
import type { ConsoleAuthClaims } from '../consoleAuth';
import type { AccountConsoleContext } from './context';
import { requireConsoleAuth, requireConsoleRoutePolicy } from './accountRoutes';
import { json } from './http';

export interface AccountAuditPresentation {
  readonly categories: readonly ConsoleAuditCategory[];
  readonly projectEvents: (
    claims: ConsoleAuthClaims,
    events: readonly ConsoleAuditEvent[],
  ) => Promise<readonly ConsoleAuditEvent[]>;
}
function auditContext(claims: ConsoleAuthClaims) {
  return {
    orgId: claims.orgId,
    actorUserId: claims.userId,
    ...(claims.projectId ? { projectId: claims.projectId } : {}),
  };
}
async function retainEvents(
  _claims: ConsoleAuthClaims,
  events: readonly ConsoleAuditEvent[],
): Promise<readonly ConsoleAuditEvent[]> {
  return events;
}
export async function handleAccountConsoleAudit(
  ctx: AccountConsoleContext,
): Promise<Response | null> {
  return handleConsoleAuditRoutes(ctx, {
    categories: CONSOLE_AUDIT_QUERY_CATEGORIES,
    projectEvents: retainEvents,
  });
}

function isConsoleAuditPath(pathname: string): boolean {
  return (
    pathname === '/console/audit/events' ||
    pathname === '/console/audit/activity' ||
    pathname === '/console/audit/evidence'
  );
}

function sendAuditError(error: unknown): Response {
  if (isConsoleAuditError(error)) {
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

export async function handleConsoleAuditRoutes(
  ctx: AccountConsoleContext,
  presentation: AccountAuditPresentation,
): Promise<Response | null> {
  if (!isConsoleAuditPath(ctx.pathname)) return null;

  const auth = await requireConsoleAuth(ctx);
  if (!auth.ok) return auth.response;
  const routePolicy = requireConsoleRoutePolicy(ctx, auth.claims);
  if (routePolicy) return routePolicy;

  const audit = ctx.audit;
  if (!audit)
    return json(
      {
        ok: false,
        code: 'audit_not_configured',
        message: 'Audit service is not configured on this server',
      },
      { status: 501 },
    );

  try {
    if (ctx.method === 'GET' && ctx.pathname === '/console/audit/events') {
      const request = parseListConsoleAuditEventsRequest(
        {
          projectId: ctx.url.searchParams.get('projectId') || undefined,
          environmentId: ctx.url.searchParams.get('environmentId') || undefined,
          category: ctx.url.searchParams.get('category') || undefined,
          actorUserId: ctx.url.searchParams.get('actorUserId') || undefined,
          outcome: ctx.url.searchParams.get('outcome') || undefined,
          q: ctx.url.searchParams.get('q') || undefined,
          from: ctx.url.searchParams.get('from') || undefined,
          to: ctx.url.searchParams.get('to') || undefined,
          limit: ctx.url.searchParams.get('limit') || undefined,
        },
        presentation.categories,
      );
      const events = await audit.listEvents(auditContext(auth.claims), request);
      return json(
        { ok: true, events: await presentation.projectEvents(auth.claims, events) },
        { status: 200 },
      );
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/audit/activity') {
      const request = parseCountConsoleAuditActivityRequest(
        {
          projectId: ctx.url.searchParams.get('projectId') || undefined,
          environmentId: ctx.url.searchParams.get('environmentId') || undefined,
          category: ctx.url.searchParams.get('category') || undefined,
          actorUserId: ctx.url.searchParams.get('actorUserId') || undefined,
          outcome: ctx.url.searchParams.get('outcome') || undefined,
          q: ctx.url.searchParams.get('q') || undefined,
          from: ctx.url.searchParams.get('from') || undefined,
          to: ctx.url.searchParams.get('to') || undefined,
          bins: ctx.url.searchParams.get('bins') || undefined,
          includeOrgScoped: ctx.url.searchParams.get('includeOrgScoped') || undefined,
        },
        presentation.categories,
      );
      const bins = await audit.countActivity(auditContext(auth.claims), request);
      return json({ ok: true, bins }, { status: 200 });
    }

    if (ctx.method === 'GET' && ctx.pathname === '/console/audit/evidence') {
      const request = parseListConsoleAuditEvidenceRequest({
        projectId: ctx.url.searchParams.get('projectId') || undefined,
        environmentId: ctx.url.searchParams.get('environmentId') || undefined,
        domain: ctx.url.searchParams.get('domain') || undefined,
        from: ctx.url.searchParams.get('from') || undefined,
        to: ctx.url.searchParams.get('to') || undefined,
        limit: ctx.url.searchParams.get('limit') || undefined,
      });
      const evidence = await audit.listEvidence(auditContext(auth.claims), request);
      return json({ ok: true, evidence }, { status: 200 });
    }
  } catch (error: unknown) {
    return sendAuditError(error);
  }

  return new Response('Not Found', { status: 404 });
}
