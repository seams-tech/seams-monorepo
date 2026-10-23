import type { PlatformServiceIdV1 } from '@seams-internal/console-shared/accountPlatform';
import { assertNever } from '@seams-internal/console-shared/accountPlatform/boundary';
import { listDashboardProjects, type DashboardConsoleProject } from '../../consoleContextApi';
import { getProjectServices, type ServiceStatus } from './consoleServicesApi';

/** A project that runs one service. Archived or absent instances are not part of it. */
export interface ServiceProject {
  readonly project: DashboardConsoleProject;
  readonly status: Exclude<ServiceStatus, { readonly kind: 'absent' | 'archived' }>;
}

export function platformServiceLabel(serviceId: PlatformServiceIdV1): string {
  switch (serviceId) {
    case 'wallet':
      return 'Wallet';
    case 'satyr':
      return 'Satyr';
    default:
      return assertNever(serviceId);
  }
}

function serviceProject(
  project: DashboardConsoleProject,
  status: ServiceStatus | undefined,
): ServiceProject | null {
  if (!status) return null;
  switch (status.kind) {
    case 'absent':
    case 'archived':
      return null;
    case 'active':
    case 'provisioning':
    case 'disabled':
    case 'failed':
      return { project, status };
    default:
      return assertNever(status);
  }
}

/** Lists the active projects of the current organization that run `serviceId`. */
export async function listServiceProjects(
  organizationId: string,
  serviceId: PlatformServiceIdV1,
): Promise<ServiceProject[]> {
  const projects = await listDashboardProjects({ status: 'ACTIVE' });
  const rows = await Promise.all(
    projects.map(async (project) => {
      const services = await getProjectServices(organizationId, project.id);
      const service = services.find((entry) => entry.serviceId === serviceId);
      return serviceProject(project, service?.status);
    }),
  );
  return rows.filter((row): row is ServiceProject => row !== null);
}
