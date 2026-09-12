import { createInMemoryConsoleAuditService } from '../../../packages/console-server-ts/src/audit/service';
import { createInMemoryConsoleOrgProjectEnvService } from '../../../packages/console-server-ts/src/orgProjectEnv/service';
import type {
  ConsoleAuthAdapter,
  ConsoleAuthClaims,
} from '../../../packages/console-server-ts/src/router/consoleAuth';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../../packages/shared-ts/src/tenant-root';
import type { TenantRootStepUpSessionRecordV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';

export async function consoleRestoreApprovalFixture() {
  const orgProjectEnv = createInMemoryConsoleOrgProjectEnvService();
  const context = { orgId: 'org_restoretest1', actorUserId: 'restore-owner' };
  await orgProjectEnv.upsertOrganization(context, { name: 'Restore test' });
  const project = await orgProjectEnv.createProject(context, {
    id: 'restore-test',
    name: 'Restore test',
  });
  const environments = await orgProjectEnv.listEnvironments(context, {
    projectId: project.id,
    status: 'ACTIVE',
  });
  const environment = environments[0];
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: context.orgId,
    projectId: project.id,
    envId: environment.id,
    signingRootId: `${project.id}:${environment.key}`,
    signingRootVersion: environment.runtimeVersion,
  });
  if (!identity.ok) throw new Error('Invalid fixture identity');
  const claims: ConsoleAuthClaims = {
    userId: context.actorUserId,
    orgId: context.orgId,
    platformSupport: false,
    membershipId: 'restore-membership',
    role: 'OWNER',
    authorizationVersion: 1,
    adminPermissions: [],
    projectAccess: { kind: 'all' },
    projectId: project.id,
    environmentId: environment.id,
    sessionId: 'restore-browser-session',
  };
  const auth: ConsoleAuthAdapter = { authenticate: () => ({ ok: true, claims }) };
  const stepUp: TenantRootStepUpSessionRecordV1 = {
    actorUserId: context.actorUserId,
    sessionId: 'restore-browser-session',
    method: 'webauthn_platform_v1',
    verifiedAtMs: Date.now(),
  };
  const state = { ownerActive: true, stepUp };
  return {
    audit: createInMemoryConsoleAuditService(),
    identity: identity.value,
    claims,
    state,
    auth,
    orgProjectEnv,
    stepUp: { readStepUp: async () => state.stepUp },
    isOwner: async () => state.ownerActive,
  };
}
