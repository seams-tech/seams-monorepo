import type {
  RouterApiProjectEnvironment,
  RouterApiProjectEnvironmentResolver,
} from '@seams/wallet-server/cloud-host';
import type { ConsoleWalletEnvironmentService } from '@seams-internal/wallet-console-server/environments/service';
import type {
  ConsoleWalletEnvironment,
  ConsoleWalletEnvironmentStatus,
} from '@seams-internal/wallet-console-server/environments/types';
import type { D1AccountPlatformService } from '@seams-internal/console-server/accountPlatform/d1';
import type { ServiceProducerAuthorityV1 } from '@seams-internal/console-server/accountPlatform/types';

export interface WalletOperationAdmissionV1 {
  readonly platform: Pick<D1AccountPlatformService, 'checkWalletAdmission'>;
  readonly authority: ServiceProducerAuthorityV1;
  readonly namespace: string;
}

export async function isWalletProjectAdmitted(
  admission: WalletOperationAdmissionV1,
  nativeOrganizationId: string,
  nativeProjectId: string,
): Promise<boolean> {
  const result = await admission.platform.checkWalletAdmission(admission.authority, {
    namespace: admission.namespace,
    nativeOrganizationId,
    nativeProjectId,
  });
  return result.kind === 'accepted';
}

export function walletProjectEnvironment(
  environment: ConsoleWalletEnvironment,
): RouterApiProjectEnvironment {
  return {
    id: environment.id,
    projectId: environment.projectId,
    key: environment.key,
    signingRootVersion: environment.signingRootVersion,
    status: environment.status,
  };
}

function parseEnvironmentStatus(
  value: string | undefined,
): ConsoleWalletEnvironmentStatus | undefined {
  if (value === 'ACTIVE' || value === 'DISABLED' || value === 'ARCHIVED') return value;
  return undefined;
}

export function createWalletProjectEnvironmentResolver(
  service: ConsoleWalletEnvironmentService,
  admission: WalletOperationAdmissionV1,
): RouterApiProjectEnvironmentResolver {
  return new WalletProjectEnvironmentResolver(service, admission);
}

class WalletProjectEnvironmentResolver implements RouterApiProjectEnvironmentResolver {
  constructor(
    private readonly service: ConsoleWalletEnvironmentService,
    private readonly admission: WalletOperationAdmissionV1,
  ) {}

  async listEnvironments(
    context: Parameters<RouterApiProjectEnvironmentResolver['listEnvironments']>[0],
    filters: Parameters<RouterApiProjectEnvironmentResolver['listEnvironments']>[1],
  ): Promise<RouterApiProjectEnvironment[]> {
    const status = parseEnvironmentStatus(filters?.status);
    const environments = await this.service.listEnvironments(
      context,
      status ? { status } : undefined,
    );
    const admitted: RouterApiProjectEnvironment[] = [];
    const projects = new Map<string, boolean>();
    for (const environment of environments) {
      let projectAdmitted = projects.get(environment.projectId);
      if (projectAdmitted === undefined) {
        projectAdmitted = await isWalletProjectAdmitted(
          this.admission,
          context.orgId,
          environment.projectId,
        );
        projects.set(environment.projectId, projectAdmitted);
      }
      if (projectAdmitted) admitted.push(walletProjectEnvironment(environment));
    }
    return admitted;
  }
}
