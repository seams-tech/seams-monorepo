import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import type { ConsoleAuthAdapter } from '../../../packages/console-server-ts/src/router/consoleAuth';
import { createD1ConsoleWalletEnvironmentService } from '../../../packages/wallet-console-server-ts/src/environments/d1';
import {
  WALLET_CONSOLE_AUDIT_CATEGORIES,
  WALLET_CONSOLE_AUDIT_EVIDENCE_REFERENCE_KINDS,
} from '../../../packages/wallet-console-server-ts/src/audit';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '@seams/wallet-server/cloud-host';
import type { TenantRootStepUpSessionRecordV1 } from '../../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';
import { activateWalletProject } from '../../helpers/accountWalletProject.fixtures';
import { consoleAuthorizationClaims } from '../../helpers/consoleAuthorization.fixtures';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../../helpers/sqliteD1';

export async function consoleRestoreApprovalFixture() {
  const temporary = createTemporaryD1Database();
  await applyD1MigrationFiles(temporary.database, listD1MigrationFiles('d1-console'));
  const core = await createCloudflareD1AccountServiceBundle({
    database: temporary.database,
    namespace: 'restore-approval',
    ensureSchema: false,
    externalDeletionGuard: null,
    auditCategories: WALLET_CONSOLE_AUDIT_CATEGORIES,
    auditEvidenceReferenceKinds: WALLET_CONSOLE_AUDIT_EVIDENCE_REFERENCE_KINDS,
  });
  const context = { orgId: 'org_restoretest1', actorUserId: 'restore-owner' };
  await core.account.createOrganization(
    {
      userId: context.actorUserId,
      email: 'restore-owner@example.test',
      name: 'Restore owner',
      provider: 'oidc',
      orgId: null,
      projectId: null,
      platformSupport: false,
    },
    { id: context.orgId, name: 'Restore test' },
  );
  const project = await core.orgProjects.createProject(context, {
    id: 'restore-test',
    name: 'Restore test',
  });
  const walletEnvironments = await createD1ConsoleWalletEnvironmentService({
    database: temporary.database,
    namespace: 'restore-approval',
    ensureSchema: false,
  });
  await activateWalletProject({
    core,
    walletEnvironments,
    namespace: 'restore-approval',
    deploymentId: 'restore-approval',
    context,
    projectId: project.id,
  });
  const environments = await walletEnvironments.listEnvironments(context, {
    projectId: project.id,
    status: 'ACTIVE',
  });
  const environment = environments[0];
  if (!environment) throw new Error('Restore approval Wallet environment is unavailable');
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: context.orgId,
    projectId: project.id,
    envId: environment.id,
    signingRootId: `${project.id}:${environment.key}`,
    signingRootVersion: environment.signingRootVersion,
  });
  if (!identity.ok) throw new Error('Invalid fixture identity');
  const authorization = await core.organizationAccess.lookupAuthorization({
    orgId: context.orgId,
    userId: context.actorUserId,
  });
  if (!authorization || authorization.kind === 'denied')
    throw new Error('Restore approval fixture has no owner authorization');
  const claims = consoleAuthorizationClaims({
    authorization,
    platformSupport: false,
    email: 'restore-owner@example.test',
    name: 'Restore owner',
    provider: 'oidc',
    projectId: project.id,
    sessionId: 'restore-browser-session',
  });
  const auth: ConsoleAuthAdapter = { authenticate: () => ({ ok: true, claims }) };
  const stepUp: TenantRootStepUpSessionRecordV1 = {
    actorUserId: context.actorUserId,
    sessionId: 'restore-browser-session',
    method: 'webauthn_platform_v1',
    verifiedAtMs: Date.now(),
  };
  const state = { ownerActive: true, stepUp };
  return {
    audit: core.audit,
    identity: identity.value,
    claims,
    state,
    auth,
    walletEnvironments,
    dispose: cleanupTemporaryD1Database.bind(null, temporary.tempDir),
    stepUp: { readStepUp: async () => state.stepUp },
    isOwner: async () => state.ownerActive,
  };
}
