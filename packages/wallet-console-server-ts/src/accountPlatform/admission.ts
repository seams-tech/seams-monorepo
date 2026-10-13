import type { D1AccountPlatformService } from '@seams-internal/console-server/accountPlatform/d1';
import type { ServiceProducerAuthorityV1 } from '@seams-internal/console-server/accountPlatform/types';
import type { ConsoleWalletEnvironmentService } from '../environments/service';

// Bind platform namespace, deployment, and native namespace as ?1, ?2, and ?3.
export const ADMITTED_WALLET_ENVIRONMENTS_FROM_SQL = `
  FROM environments e
  JOIN wallet_service_bindings b ON b.native_namespace = e.namespace
    AND b.native_org_id = e.org_id AND b.native_project_id = e.project_id
  JOIN platform_service_instances i ON i.namespace = b.namespace AND i.id = b.instance_id
  JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
  JOIN projects p ON p.namespace = i.namespace AND p.id = i.project_id AND p.org_id = i.org_id
  WHERE i.namespace = ?1 AND i.service_id = 'wallet' AND i.deployment_id = ?2
    AND b.deployment_id = ?2 AND e.namespace = ?3
    AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active'
    AND i.desired_revision = i.observed_revision AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'`;

export interface WalletApiCredentialAdmissionV1 {
  readonly platform: Pick<D1AccountPlatformService, 'checkWalletAdmission'>;
  readonly authority: ServiceProducerAuthorityV1;
  readonly namespace: string;
  readonly environments: ConsoleWalletEnvironmentService;
}

export async function admittedWalletCredentialProject(
  admission: WalletApiCredentialAdmissionV1,
  orgId: string,
  environmentId: string,
): Promise<string | null> {
  const environments = await admission.environments.listEnvironments({
    orgId,
    actorUserId: 'relay-api-key',
  });
  for (const environment of environments) {
    if (environment.id !== environmentId) continue;
    const result = await admission.platform.checkWalletAdmission(admission.authority, {
      namespace: admission.namespace,
      nativeOrganizationId: orgId,
      nativeProjectId: environment.projectId,
    });
    return result.kind === 'accepted' ? environment.projectId : null;
  }
  return null;
}
