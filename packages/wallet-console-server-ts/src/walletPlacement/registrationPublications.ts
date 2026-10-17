import {
  resumeRegistrationDirectoryPublicationsV1,
  type D1DatabaseLike,
  type RegistrationDirectoryPublicationDelivery,
} from '@seams/wallet-server/cloud-host';
import type { TenantDeploymentBindingV1 } from '../tenantDeployment/types';
import type { ConsoleRegistrationHomeAdmission } from './registrationAdmission';

/**
 * Sends the registration completions that this Gateway activated but Console has
 * not acknowledged. The finalize response sends each one first; the Gateway cron
 * runs this for the ones that failed.
 */
export function resumeGatewayRegistrationPublications(input: {
  readonly database: D1DatabaseLike;
  readonly binding: TenantDeploymentBindingV1;
  readonly authority: ConsoleRegistrationHomeAdmission;
  readonly nowMs?: number;
}): Promise<Record<RegistrationDirectoryPublicationDelivery, number>> {
  return resumeRegistrationDirectoryPublicationsV1({
    database: input.database,
    scope: {
      namespace: input.binding.tenant.namespace,
      orgId: input.binding.tenant.organizationId,
      projectId: input.binding.tenant.projectId,
      envId: input.binding.tenant.environmentId,
    },
    registrationAuthority: input.authority,
    nowMs: input.nowMs,
  });
}
