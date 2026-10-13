import {
  authenticateConsoleRequest,
  type ConsoleAuthAdapter,
  type ConsoleAuthClaims,
  type ConsoleAuthResult,
  type HeaderRecord,
} from '@seams-internal/console-server/router/consoleAuth';
import { hasConsoleProjectAccess } from '@seams-internal/console-server/router/consoleRoutePolicy';
import { assertNever } from '@seams-internal/console-shared/accountPlatform/boundary';

/** Wallet selection is request context. The account session supplies membership authority. */
export type WalletConsoleAuthClaims = ConsoleAuthClaims & {
  readonly environmentId: string | null;
};

export type WalletConsoleAuthResult =
  | { readonly ok: true; readonly claims: WalletConsoleAuthClaims }
  | Extract<ConsoleAuthResult, { readonly ok: false }>;

function selectedWalletEnvironment(headers: HeaderRecord): string | null {
  const value = headers['x-console-environment-id'] ?? headers['X-Console-Environment-Id'];
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function selectedWalletProject(headers: HeaderRecord, claims: ConsoleAuthClaims): string | null {
  const value = headers['x-console-project-id'] ?? headers['X-Console-Project-Id'];
  if (typeof value === 'string') return value.trim() || null;
  return claims.projectId ?? null;
}

export function buildWalletConsoleAuthClaims(
  claims: ConsoleAuthClaims,
  projectId: string | null,
  environmentId: string | null,
): WalletConsoleAuthClaims {
  const identity = {
    userId: claims.userId,
    orgId: claims.orgId,
    membershipId: claims.membershipId,
    authorizationVersion: claims.authorizationVersion,
    platformSupport: claims.platformSupport,
    environmentId,
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.name ? { name: claims.name } : {}),
    ...(claims.provider ? { provider: claims.provider } : {}),
    ...(projectId ? { projectId } : {}),
    ...(claims.sessionId ? { sessionId: claims.sessionId } : {}),
  };
  switch (claims.role) {
    case 'OWNER':
      return {
        ...identity,
        role: claims.role,
        adminPermissions: claims.adminPermissions,
        projectAccess: { kind: 'all' },
      };
    case 'ADMIN':
      return {
        ...identity,
        role: claims.role,
        adminPermissions: claims.adminPermissions,
        projectAccess: { kind: 'all' },
      };
    case 'MEMBER':
      return {
        ...identity,
        role: claims.role,
        adminPermissions: [],
        projectAccess: claims.projectAccess,
      };
    default:
      return assertNever(claims);
  }
}

export async function authenticateWalletConsoleRequest(
  headers: HeaderRecord,
  adapter: ConsoleAuthAdapter | null | undefined,
): Promise<WalletConsoleAuthResult> {
  const result = await authenticateConsoleRequest(headers, adapter);
  if (!result.ok) return result;
  const projectId = selectedWalletProject(headers, result.claims);
  if (projectId && !hasConsoleProjectAccess(result.claims, projectId, 'viewer')) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'No access to this Wallet project',
    };
  }
  return {
    ok: true,
    claims: buildWalletConsoleAuthClaims(
      result.claims,
      projectId,
      selectedWalletEnvironment(headers),
    ),
  };
}
