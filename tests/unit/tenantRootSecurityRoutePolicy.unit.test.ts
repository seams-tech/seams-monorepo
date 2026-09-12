import { expect, test } from '@playwright/test';
import {
  consoleRouteRequiresFreshStepUpV1,
  findConsoleRouteDefinitionForRequest,
  type ConsoleRouteDefinition,
} from '../../packages/console-server-ts/src/router/consoleRouteDefinitions';
import { createComposedConsoleRouteDefinitions } from '../../packages/wallet-console-server-ts/src/router/walletConsoleRouteDefinitions';
import { authorizeConsoleRouteRequest } from '../../packages/console-server-ts/src/router/consoleRoutePolicy';
import type { ConsoleAuthClaims } from '../../packages/console-server-ts/src/router/consoleAuth';

const DEFINITIONS = createComposedConsoleRouteDefinitions();

function securityRoutes(): readonly ConsoleRouteDefinition[] {
  return DEFINITIONS.filter((route) => route.path.startsWith('/console/tenant-root/security'));
}

const OWNER_CLAIMS: ConsoleAuthClaims = {
  userId: 'user-owner',
  orgId: 'org-1',
  platformSupport: false,
  membershipId: 'membership-owner',
  role: 'OWNER',
  authorizationVersion: 1,
  adminPermissions: [],
  projectAccess: { kind: 'all' },
};

function memberClaims(accessLevel: 'editor' | 'viewer'): ConsoleAuthClaims {
  return {
    userId: `user-${accessLevel}`,
    orgId: 'org-1',
    platformSupport: false,
    membershipId: `membership-${accessLevel}`,
    role: 'MEMBER',
    authorizationVersion: 1,
    adminPermissions: [],
    projectAccess: {
      kind: 'assigned',
      assignments: [{ projectId: 'project-2', accessLevel }],
    },
  };
}

/**
 * The one mutation that deliberately takes no step-up. The CLI reports that a
 * file it downloaded is on disk and verifies; it can only upgrade evidence for
 * a digest the service itself issued, and a CLI session cannot complete a
 * browser step-up ceremony.
 */
const STEP_UP_EXEMPT_MUTATIONS: ReadonlySet<string> = new Set([
  '/console/tenant-root/security/backup/durable-verification',
]);

const DESTINATION_RESTORE_READS: ReadonlySet<string> = new Set([
  '/console/tenant-root/security/restore/status',
]);

test('every derivation-root mutation route requires fresh step-up', () => {
  const routes = securityRoutes();
  expect(routes.length).toBeGreaterThan(0);

  for (const route of routes) {
    if (DESTINATION_RESTORE_READS.has(route.path)) {
      expect(route.method, `${route.id} is a destination session read`).toBe('GET');
      expect(route.auth.requirement, `${route.id} stays outside console-session auth`).toBe(
        'owner.step_up',
      );
      expect(consoleRouteRequiresFreshStepUpV1(route)).toBe(true);
      continue;
    }
    if (route.method === 'GET') {
      expect(
        consoleRouteRequiresFreshStepUpV1(route),
        `${route.id} reads state and must not demand step-up`,
      ).toBe(false);
      expect(['project.view', 'owner']).toContain(route.auth.requirement);
      continue;
    }
    if (STEP_UP_EXEMPT_MUTATIONS.has(route.path)) {
      expect(route.auth.requirement).toBe('owner');
      continue;
    }
    expect(
      consoleRouteRequiresFreshStepUpV1(route),
      `${route.id} mutates custody and must require step-up`,
    ).toBe(true);
  }
});

test('the second-owner approval and the destination restore routes are in the table', () => {
  for (const [method, path] of [
    ['POST', '/console/tenant-root/security/operations/approve'],
    ['POST', '/console/tenant-root/security/restore/bootstrap-session'],
    ['POST', '/console/tenant-root/security/restore/import-key'],
    ['GET', '/console/tenant-root/security/restore/status'],
  ] as const) {
    const route = findConsoleRouteDefinitionForRequest(DEFINITIONS, method, path);
    expect(route?.auth.requirement, path).toBe('owner.step_up');
  }
  expect(
    findConsoleRouteDefinitionForRequest(
      DEFINITIONS,
      'POST',
      '/console/tenant-root/security/restore/status',
    ),
  ).toBeNull();
});

test('recovery custody routes require an organization owner, rotation keeps its own audience', () => {
  // Rotation is the refresh route. It keeps the projects.manage audience it has
  // always had and adds step-up; reusing the security routes' project.edit
  // requirement would have widened it to any project editor.
  const rotation = findConsoleRouteDefinitionForRequest(
    DEFINITIONS,
    'POST',
    '/console/tenant-root/refresh',
  );
  expect(rotation?.auth.requirement).toBe('projects.manage.step_up');
  expect(consoleRouteRequiresFreshStepUpV1(rotation!)).toBe(true);

  // There is no second rotation endpoint.
  expect(
    findConsoleRouteDefinitionForRequest(
      DEFINITIONS,
      'POST',
      '/console/tenant-root/security/rotation',
    ),
  ).toBeNull();

  const governance = findConsoleRouteDefinitionForRequest(
    DEFINITIONS,
    'POST',
    '/console/tenant-root/security/governance',
  );
  expect(governance?.auth.requirement).toBe('owner.step_up');

  const retire = findConsoleRouteDefinitionForRequest(
    DEFINITIONS,
    'POST',
    '/console/tenant-root/security/source/retire',
  );
  expect(retire?.auth.requirement).toBe('owner.step_up');
});

test('a step-up requirement grants exactly its base access and nothing more', () => {
  const owner = OWNER_CLAIMS;
  const editor = memberClaims('editor');
  const viewer = memberClaims('viewer');

  const authorize = (pathname: string, actor: ConsoleAuthClaims) =>
    authorizeConsoleRouteRequest({
      claims: actor,
      definitions: DEFINITIONS,
      method: 'POST',
      pathname,
      projectId: 'project-2',
    }).ok;

  // A project editor cannot rotate a tenant root; projects.manage or OWNER can.
  expect(authorize('/console/tenant-root/refresh', editor)).toBe(false);
  expect(authorize('/console/tenant-root/refresh', viewer)).toBe(false);
  expect(authorize('/console/tenant-root/refresh', owner)).toBe(true);

  expect(authorize('/console/tenant-root/security/governance', owner)).toBe(true);
  // Editing a project is not custody authority over the derivation root.
  expect(authorize('/console/tenant-root/security/governance', editor)).toBe(false);
});

test('route ids and method/path pairs stay unique', () => {
  const ids = new Set<string>();
  const endpoints = new Set<string>();
  for (const route of DEFINITIONS) {
    expect(ids.has(route.id), `duplicate route id ${route.id}`).toBe(false);
    ids.add(route.id);
    const endpoint = `${route.method} ${route.path}`;
    expect(endpoints.has(endpoint), `duplicate endpoint ${endpoint}`).toBe(false);
    endpoints.add(endpoint);
  }
});
