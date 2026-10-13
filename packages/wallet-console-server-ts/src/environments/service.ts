import type { ConsoleOrganization } from '@seams-internal/console-server/orgProjectEnv/types';
import type {
  ConsoleWalletEnvironment,
  CreateConsoleWalletEnvironmentRequest,
  ListConsoleWalletEnvironmentsRequest,
  ProvisionConsoleWalletEnvironmentsRequest,
  SetConsoleWalletProjectAvailabilityRequest,
  SetConsoleWalletProjectAvailabilityResult,
  UpdateConsoleWalletEnvironmentRequest,
} from './types';

export interface ConsoleWalletEnvironmentContext {
  readonly orgId: string;
  readonly actorUserId: string;
}
export interface ConsoleWalletEnvironmentService {
  setProjectAvailability(
    context: ConsoleWalletEnvironmentContext,
    request: SetConsoleWalletProjectAvailabilityRequest,
  ): Promise<SetConsoleWalletProjectAvailabilityResult>;
  findOrganizationForEnvironment(request: {
    environmentId: string;
    projectId?: string;
  }): Promise<ConsoleOrganization | null>;
  listEnvironments(
    context: ConsoleWalletEnvironmentContext,
    request?: ListConsoleWalletEnvironmentsRequest,
  ): Promise<ConsoleWalletEnvironment[]>;
  createEnvironment(
    context: ConsoleWalletEnvironmentContext,
    request: CreateConsoleWalletEnvironmentRequest,
  ): Promise<ConsoleWalletEnvironment>;
  updateEnvironment(
    context: ConsoleWalletEnvironmentContext,
    environmentId: string,
    request: UpdateConsoleWalletEnvironmentRequest,
  ): Promise<ConsoleWalletEnvironment | null>;
  archiveEnvironment(
    context: ConsoleWalletEnvironmentContext,
    environmentId: string,
  ): Promise<ConsoleWalletEnvironment | null>;
  archiveProjectEnvironments(
    context: ConsoleWalletEnvironmentContext,
    projectId: string,
  ): Promise<ConsoleWalletEnvironment[]>;
  provisionProjectEnvironments(
    context: ConsoleWalletEnvironmentContext,
    request: ProvisionConsoleWalletEnvironmentsRequest,
  ): Promise<ConsoleWalletEnvironment[]>;
}
