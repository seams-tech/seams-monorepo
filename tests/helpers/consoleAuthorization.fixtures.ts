import type { ConsoleAuthClaims } from '../../packages/console-server-ts/src/router/consoleAuth';
import type { ActiveOrganizationAuthorization } from '../../packages/console-server-ts/src/teamRbac/types';

/** Derive request claims from current authorization loaded by the membership service. */
export function consoleAuthorizationClaims(input: {
  readonly authorization: ActiveOrganizationAuthorization;
  readonly platformSupport: boolean;
  readonly email: string;
  readonly name: string;
  readonly provider: string;
  readonly projectId: string | null;
  readonly sessionId: string | null;
}): ConsoleAuthClaims {
  const authorization = input.authorization;
  const identity = {
    userId: authorization.userId,
    orgId: authorization.orgId,
    membershipId: authorization.membershipId,
    authorizationVersion: authorization.authorizationVersion,
    platformSupport: input.platformSupport,
    email: input.email,
    name: input.name,
    provider: input.provider,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
  switch (authorization.role) {
    case 'OWNER':
      return {
        ...identity,
        role: 'OWNER',
        adminPermissions: authorization.adminPermissions,
        projectAccess: { kind: 'all' },
      };
    case 'ADMIN':
      return {
        ...identity,
        role: 'ADMIN',
        adminPermissions: authorization.adminPermissions,
        projectAccess: { kind: 'all' },
      };
    case 'MEMBER':
      return {
        ...identity,
        role: 'MEMBER',
        adminPermissions: [],
        projectAccess: authorization.projectAccess,
      };
  }
}
