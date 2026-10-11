import type {
  RouterApiProjectEnvironment,
  RouterApiProjectEnvironmentResolver,
} from '@seams/wallet-server/cloud-host';
import type { ConsoleOrgProjectEnvService } from '@seams-internal/console-server/orgProjectEnv/service';
import type {
  ConsoleEnvironment,
  ConsoleEnvironmentStatus,
} from '@seams-internal/console-server/orgProjectEnv/types';

export function walletProjectEnvironment(
  environment: ConsoleEnvironment,
): RouterApiProjectEnvironment {
  return {
    id: environment.id,
    projectId: environment.projectId,
    key: environment.key,
    signingRootVersion: environment.runtimeVersion,
    status: environment.status,
  };
}

function parseEnvironmentStatus(value: string | undefined): ConsoleEnvironmentStatus | undefined {
  if (value === 'ACTIVE' || value === 'DISABLED' || value === 'ARCHIVED') return value;
  return undefined;
}

export function createWalletProjectEnvironmentResolver(
  service: ConsoleOrgProjectEnvService,
): RouterApiProjectEnvironmentResolver {
  return {
    async listEnvironments(context, filters) {
      const status = parseEnvironmentStatus(filters?.status);
      const environments = await service.listEnvironments(context, status ? { status } : undefined);
      return environments.map(walletProjectEnvironment);
    },
  };
}
