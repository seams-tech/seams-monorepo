import type { ConsoleAuthClaims } from './consoleAuth';
import {
  findConsoleRouteDefinitionForRequest,
  type ConsoleRouteDefinition,
  type ConsoleRouteRequirement,
} from './consoleRouteDefinitions';

export type ConsoleRouteAuthorizationResult =
  | { readonly ok: true; readonly route: ConsoleRouteDefinition }
  | {
      readonly ok: false;
      readonly status: 403 | 500;
      readonly body: {
        readonly ok: false;
        readonly code: 'forbidden' | 'route_auth_not_configured';
        readonly message: string;
      };
    };

function hasAdminPermission(
  claims: ConsoleAuthClaims,
  permission: 'members.manage' | 'projects.manage' | 'billing.view' | 'billing.manage',
): boolean {
  return claims.role === 'ADMIN' && claims.adminPermissions.includes(permission);
}

export function hasConsoleProjectAccess(
  claims: ConsoleAuthClaims,
  projectId: string,
  level: 'viewer' | 'editor',
): boolean {
  if (claims.role !== 'MEMBER') return true;
  const assignments = claims.projectAccess.assignments;
  if (!projectId) return false;
  return assignments.some(
    (assignment) =>
      assignment.projectId === projectId &&
      (level === 'viewer' || assignment.accessLevel === 'editor'),
  );
}

function meetsRequirement(
  claims: ConsoleAuthClaims,
  requirement: ConsoleRouteRequirement,
  projectId: string,
): boolean {
  switch (requirement) {
    case 'authenticated':
      return true;
    // Step-up requirements grant the same access as their base requirement.
    // The evidence itself is server-issued and verified by the handler; a
    // session claim can never stand in for it.
    case 'owner':
    case 'owner.step_up':
      return claims.role === 'OWNER';
    case 'members.read':
      return (
        claims.role === 'OWNER' ||
        hasAdminPermission(claims, 'members.manage') ||
        hasAdminPermission(claims, 'projects.manage')
      );
    case 'members.manage':
      return claims.role === 'OWNER' || hasAdminPermission(claims, 'members.manage');
    // `projects.manage.step_up` has the identical audience to
    // `projects.manage`. The suffix only tells the handler it must
    // additionally verify fresh step-up, which session claims cannot express.
    case 'projects.manage':
    case 'projects.manage.step_up':
      return claims.role === 'OWNER' || hasAdminPermission(claims, 'projects.manage');
    case 'projects.list':
      return claims.role !== 'MEMBER' || claims.projectAccess.assignments.length > 0;
    case 'project.view':
      return hasConsoleProjectAccess(claims, projectId, 'viewer');
    case 'project.edit':
    case 'project.edit.step_up':
      return hasConsoleProjectAccess(claims, projectId, 'editor');
    case 'billing.view':
      return (
        claims.role === 'OWNER' ||
        hasAdminPermission(claims, 'billing.view') ||
        hasAdminPermission(claims, 'billing.manage')
      );
    case 'billing.manage':
      return claims.role === 'OWNER' || hasAdminPermission(claims, 'billing.manage');
    case 'platform.support':
      return claims.platformSupport;
  }
}

export function authorizeConsoleRouteRequest(input: {
  readonly claims: ConsoleAuthClaims;
  readonly definitions: readonly ConsoleRouteDefinition[];
  readonly method: string;
  readonly pathname: string;
  readonly projectId?: string;
}): ConsoleRouteAuthorizationResult {
  const route = findConsoleRouteDefinitionForRequest(
    input.definitions,
    input.method,
    input.pathname,
  );
  if (!route) {
    return {
      ok: false,
      status: 500,
      body: {
        ok: false,
        code: 'route_auth_not_configured',
        message: `Missing console route definition for ${input.method.toUpperCase()} ${input.pathname}`,
      },
    };
  }

  const projectId = String(input.projectId ?? input.claims.projectId ?? '').trim();
  if (meetsRequirement(input.claims, route.auth.requirement, projectId)) {
    return { ok: true, route };
  }

  return {
    ok: false,
    status: 403,
    body: {
      ok: false,
      code: 'forbidden',
      message: `This action requires ${route.auth.requirement} access`,
    },
  };
}
